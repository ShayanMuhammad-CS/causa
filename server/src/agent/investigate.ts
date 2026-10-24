// The investigation loop (SPEC "What Causa does"):
// contract -> (blocked? stop) -> recall -> schema retrieval -> hypotheses -> per-hypothesis tool loop
// -> verdicts -> synthesis -> critic -> answer -> remember. The signed contract is enforced in code
// through Budget (allowedTools, maxQueries, maxLlmCalls, maxSeconds).
import { z } from 'zod';
import type {
  CatalogTable, ChatMessage, ChatResponse, Evidence, ExecutionContract, Hypothesis, IntentEngine,
  Investigation, InvestigationEvent, LLM, MemoryService, QueryResult, ZetarisClient,
} from '../types';
import { chatJson, type ChatFn } from '../llm/json';
import type { AgentChatMessage } from '../llm/nim';
import { Budget, BudgetExceededError, isToolAllowed } from './budget';
import { critique, type DraftClaim } from './critic';
import { investigateMessages, planMessages, synthesizeMessages, VERDICT_NUDGE } from './prompts';
import { retrieveSchema } from './schema';
import { allowedToolSpecs, executeTool, summarizeResult, type HypothesisToolState } from './tools';

export interface AgentDeps {
  llm: LLM;
  zetaris: ZetarisClient;
  memory: MemoryService;
  intent: IntentEngine;
}

export interface AgentConfig {
  schemaTopK: number;
  maxStepsPerHypothesis: number;
  reserveLlmCalls: number;          // kept back for synthesis + critic
  intentTimeoutMs: number;
  thinking: { plan: boolean; investigate: boolean; synthesize: boolean; critic: boolean };
  /** Per-role model ids (e.g. a pinned Nemotron route on Meterless). planner = plan/investigate/synthesize. */
  models: { planner?: string; critic?: string };
}

export const DEFAULT_CONFIG: AgentConfig = {
  schemaTopK: 6,
  maxStepsPerHypothesis: 6,
  reserveLlmCalls: 2,
  intentTimeoutMs: 60_000,
  thinking: { plan: true, investigate: true, synthesize: true, critic: true },
  models: {},
};

const PENDING_CONTRACT: ExecutionContract = {
  id: 'pending',
  intent: { intent: 'pending', entities: [], metrics: [], risk: 'low', riskReasons: [] },
  allowedTools: [],
  budget: { maxQueries: 0, maxLlmCalls: 0, maxSeconds: 0 },
  stopConditions: [],
  signature: '',
  issuedAt: new Date(0).toISOString(),
};

export function newInvestigation(id: string, question: string): Investigation {
  return {
    id,
    question,
    contract: { ...PENDING_CONTRACT, issuedAt: new Date().toISOString() },
    recalled: [],
    hypotheses: [],
    evidence: [],
    rememberedIds: [],
    status: 'running',
    startedAt: new Date().toISOString(),
  };
}

const PlanSchema = z.object({
  hypotheses: z
    .array(
      z.object({
        statement: z.string().min(5),
        layer: z.string().optional(),
        test: z.string().optional().default(''),
        refutedIf: z.string().optional().default(''),
      }),
    )
    .min(1),
});

const VerdictSchema = z.object({
  status: z.enum(['supported', 'refuted', 'inconclusive']),
  rationale: z.string().optional().default(''),
  evidenceIds: z.array(z.string()).optional().default([]),
});

const AnswerSchema = z.object({
  summary: z.string(),
  claims: z.array(
    z.object({
      text: z.string().min(3),
      confidence: z.enum(['high', 'medium', 'low']).catch('low'),
      evidenceIds: z.array(z.string()).default([]),
    }),
  ),
});

function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  let t: NodeJS.Timeout | undefined;
  return Promise.race([
    p,
    new Promise<never>((_, rej) => {
      t = setTimeout(() => rej(new Error(`${what} timed out after ${ms}ms`)), ms);
    }),
  ]).finally(() => clearTimeout(t));
}

export async function runInvestigation(opts: {
  investigation: Investigation;
  deps: AgentDeps;
  emit: (e: InvestigationEvent) => void;
  config?: Partial<AgentConfig>;
}): Promise<Investigation> {
  const inv = opts.investigation;
  const { llm, zetaris, memory, intent } = opts.deps;
  const cfg: AgentConfig = {
    ...DEFAULT_CONFIG,
    ...opts.config,
    thinking: { ...DEFAULT_CONFIG.thinking, ...opts.config?.thinking },
    models: { ...DEFAULT_CONFIG.models, ...opts.config?.models },
  };
  const handledBy = new Map<string, number>(); // "model via provider" -> calls
  const emit = (e: InvestigationEvent) => {
    try {
      opts.emit(e);
    } catch (err) {
      console.error('[agent] emit failed', err);
    }
  };
  const think = (text: string) => emit({ type: 'thinking', text });
  const finish = (status: Investigation['status'], error?: string) => {
    inv.status = status;
    if (error) inv.error = error;
    inv.finishedAt = new Date().toISOString();
    if (status === 'failed') emit({ type: 'error', message: error ?? 'investigation failed' });
    else emit({ type: 'done', investigation: inv });
    return inv;
  };

  try {
    // 1-2. Intent -> signed contract; verify before doing anything.
    const record = await withTimeout(intent.analyze(inv.question), cfg.intentTimeoutMs, 'intent analysis');
    const contract = intent.issueContract(record);
    inv.contract = contract;
    emit({ type: 'contract', contract });
    if (!intent.verifyContract(contract)) return finish('failed', `Execution contract ${contract.id} failed signature verification; refusing to run.`);
    if (record.risk === 'blocked') {
      inv.error = `Blocked by Scout Intent: ${record.riskReasons.join('; ') || 'risk check failed'}`;
      return finish('blocked');
    }
    const budget = new Budget(contract);
    let stopReason: string | undefined;
    const noteStop = (e: BudgetExceededError) => {
      if (!stopReason) {
        stopReason = e.kind;
        think(`${e.message}. Stopping new work and answering from the evidence collected so far (budget used: ${JSON.stringify(budget.snapshot())}).`);
      }
    };

    // Metered chat: every LLM call is charged against maxLlmCalls and raced against maxSeconds.
    // Every response records which model actually served it (Meterless route headers included).
    const chatFor = (phase: string, role: 'planner' | 'critic' = 'planner'): ChatFn => async (messages, o) => {
      budget.chargeLlm();
      const model = o?.model ?? cfg.models[role];
      const started = Date.now();
      const res: ChatResponse = await budget.withinDeadline(llm.chat(messages, model ? { ...o, model } : o));
      handledBy.set(res.model, (handledBy.get(res.model) ?? 0) + 1);
      think(`[${phase}] handled by ${res.model} in ${Date.now() - started}ms (LLM call ${budget.llmCalls}/${budget.maxLlmCalls})`);
      if (res.reasoning) think(`[${phase}] ${res.reasoning.length > 1500 ? res.reasoning.slice(0, 1500) + ' ...' : res.reasoning}`);
      return res;
    };

    // 3. Recall prior findings.
    if (isToolAllowed(contract, 'memory.recall')) {
      try {
        inv.recalled = await budget.withinDeadline(memory.recall(inv.question, 5));
      } catch (e) {
        if (e instanceof BudgetExceededError) noteStop(e);
        else think(`Memory recall failed (continuing cold): ${(e as Error).message}`);
      }
    }
    emit({ type: 'recall', hits: inv.recalled });

    // 4. Schema retrieval over the Zetaris catalog (never hard-coded).
    let catalogCache: CatalogTable[] | undefined;
    const getCatalog = async () => (catalogCache ??= await zetaris.catalog());
    let schema: CatalogTable[] = [];
    if (isToolAllowed(contract, 'zetaris.catalog') && !stopReason) {
      try {
        const catalog = await budget.withinDeadline(getCatalog());
        const intentText = [inv.question, ...record.entities, ...record.metrics].join(' ');
        const r = await retrieveSchema({ llm, catalog, query: intentText, k: cfg.schemaTopK, withinDeadline: (p) => budget.withinDeadline(p) });
        schema = r.tables;
        think(
          `Schema retrieval (${r.method}${r.error ? `; embeddings unavailable: ${r.error}` : ''}): ${catalog.length} catalog tables -> top ${r.scores.length}: ` +
            r.scores.map((s) => `${s.fqName} (${s.score})`).join(', '),
        );
      } catch (e) {
        if (e instanceof BudgetExceededError) noteStop(e);
        else think(`Catalog read failed: ${(e as Error).message}. The model may call zetaris_catalog itself.`);
      }
    } else if (!stopReason) {
      think('Contract does not allow zetaris.catalog; schema retrieval skipped.');
    }

    // 5. Competing, falsifiable hypotheses.
    const plans: { test: string; refutedIf: string; rationale?: string }[] = [];
    if (!stopReason) {
      try {
        const { value } = await chatJson(chatFor('plan'), planMessages({ question: inv.question, contract, schema, recalled: inv.recalled }), PlanSchema, {
          thinking: cfg.thinking.plan,
        });
        value.hypotheses.slice(0, 4).forEach((h, i) => {
          const hyp: Hypothesis = {
            id: `h-${i + 1}`,
            statement: h.refutedIf ? `${h.statement} — refuted if ${h.refutedIf}` : h.statement,
            status: 'open',
            evidenceIds: [],
          };
          inv.hypotheses.push(hyp);
          plans.push({ test: h.test, refutedIf: h.refutedIf });
          emit({ type: 'hypothesis', hypothesis: { ...hyp } });
        });
        if (inv.hypotheses.length < 2) think('The model proposed only one hypothesis; testing it alone.');
      } catch (e) {
        if (e instanceof BudgetExceededError) noteStop(e);
        else throw e;
      }
    }

    // 6. Test each hypothesis with a bounded tool-calling loop.
    const tools = allowedToolSpecs(contract);
    const addEvidence = (result: QueryResult, purpose: string, hypothesisId: string): Evidence => {
      const ev: Evidence = { id: `ev-${inv.evidence.length + 1}`, hypothesisId, purpose, result, summary: summarizeResult(result) };
      inv.evidence.push(ev);
      emit({ type: 'evidence', evidence: ev });
      return ev;
    };

    for (let i = 0; i < inv.hypotheses.length; i++) {
      const h = inv.hypotheses[i];
      const left = inv.hypotheses.length - i;
      if (!stopReason) {
        if (budget.remainingQueries() === 0) noteStop(new BudgetExceededError('maxQueries', `${budget.queries}/${budget.maxQueries} queries used`));
        else if (budget.remainingLlmCalls() <= cfg.reserveLlmCalls) noteStop(new BudgetExceededError('maxLlmCalls', `${budget.llmCalls}/${budget.maxLlmCalls} LLM calls used (${cfg.reserveLlmCalls} reserved for synthesis + critic)`));
        else if (budget.pastSoftDeadline()) noteStop(new BudgetExceededError('maxSeconds', `${(budget.elapsedMs() / 1000).toFixed(1)}s of ${contract.budget.maxSeconds}s used`));
      }
      if (stopReason || !tools.some((t) => t.name === 'zetaris_query')) {
        h.status = 'inconclusive';
        plans[i].rationale = stopReason ? `Not tested: budget exhausted (${stopReason}).` : 'Not tested: contract does not allow zetaris.query.';
        emit({ type: 'verdict', hypothesis: { ...h } });
        continue;
      }
      const state: HypothesisToolState = {
        hypothesisId: h.id,
        queriesUsed: 0,
        queryCap: Math.max(1, Math.floor(budget.remainingQueries() / left)),
        failStreak: 0,
      };
      const llmShare = Math.max(2, Math.floor((budget.remainingLlmCalls() - cfg.reserveLlmCalls) / left));
      const maxSteps = Math.min(cfg.maxStepsPerHypothesis, llmShare - 1);
      const messages: AgentChatMessage[] = investigateMessages({
        question: inv.question,
        hypothesis: h,
        test: plans[i].test,
        refutedIf: plans[i].refutedIf,
        schema,
        priorEvidence: inv.evidence,
        queryAllowance: state.queryCap,
      });
      let verdict: z.infer<typeof VerdictSchema> | undefined;
      const ownEvidence = new Set<string>();
      try {
        for (let step = 0; step < maxSteps; step++) {
          if (budget.remainingLlmCalls() < cfg.reserveLlmCalls + 2 || budget.pastSoftDeadline()) break;
          const res = await chatFor(`investigate ${h.id}`)(messages, { tools, thinking: cfg.thinking.investigate });
          if (res.toolCalls.length === 0) {
            const parsed = VerdictSchema.safeParse(safeJson(res.content));
            if (parsed.success) verdict = parsed.data;
            else messages.push({ role: 'assistant', content: res.content });
            break;
          }
          messages.push({ role: 'assistant', content: res.content, toolCalls: res.toolCalls });
          let stop = false;
          for (const call of res.toolCalls) {
            const before = inv.evidence.length;
            const out = await executeTool(call, { zetaris, budget, catalog: getCatalog, state, emit, addEvidence });
            for (const ev of inv.evidence.slice(before)) ownEvidence.add(ev.id);
            messages.push({ role: 'tool', tool_call_id: call.id, name: call.name, content: out.content });
            if (out.stop) {
              stop = true;
              if (out.stop === 'budget') noteStop(new BudgetExceededError('maxQueries', `${budget.queries}/${budget.maxQueries} queries used`));
            }
          }
          if (stop) break;
        }
        if (!verdict && budget.remainingLlmCalls() > cfg.reserveLlmCalls) {
          const { value } = await chatJson(chatFor(`verdict ${h.id}`), [...messages, { role: 'user', content: VERDICT_NUDGE }], VerdictSchema, {
            thinking: false,
          });
          verdict = value;
        }
      } catch (e) {
        if (e instanceof BudgetExceededError) noteStop(e);
        else think(`Testing ${h.id} failed: ${(e as Error).message}`);
      }
      const known = new Set(inv.evidence.map((e) => e.id));
      const cited = (verdict?.evidenceIds ?? []).filter((id) => known.has(id));
      h.evidenceIds = [...new Set([...ownEvidence, ...cited])];
      // A verdict without evidence cannot be 'supported' or 'refuted'.
      h.status = verdict && h.evidenceIds.length > 0 ? verdict.status : 'inconclusive';
      plans[i].rationale = verdict?.rationale ?? 'No verdict reached within budget.';
      emit({ type: 'verdict', hypothesis: { ...h } });
    }

    // 7. Synthesis (ranked claims) — falls back to a deterministic summary if the LLM budget is gone.
    const hypsWithRationale = inv.hypotheses.map((h, i) => ({ ...h, rationale: plans[i]?.rationale }));
    let summary = '';
    let drafts: DraftClaim[] = [];
    let synthesized = false;
    if (budget.remainingLlmCalls() > 0 && budget.remainingMs() > 0 && inv.evidence.length > 0) {
      try {
        const { value } = await chatJson(chatFor('synthesize'), synthesizeMessages({ question: inv.question, hypotheses: hypsWithRationale, evidence: inv.evidence }), AnswerSchema, {
          thinking: cfg.thinking.synthesize,
        });
        summary = value.summary;
        drafts = value.claims;
        synthesized = true;
      } catch (e) {
        if (e instanceof BudgetExceededError) noteStop(e);
        else think(`Synthesis failed: ${(e as Error).message}; falling back to hypothesis verdicts.`);
      }
    }
    if (!synthesized) {
      const supported = hypsWithRationale.filter((h) => h.status === 'supported' && h.evidenceIds.length > 0);
      summary =
        (stopReason ? `Investigation stopped early (budget: ${stopReason}). ` : '') +
        (inv.evidence.length === 0
          ? 'No evidence could be collected, so no cause can be stated.'
          : `${supported.length} of ${inv.hypotheses.length} hypotheses were supported by the evidence collected.`);
      drafts = supported.map((h) => ({ text: `${h.statement.split(' — ')[0]}. ${h.rationale ?? ''}`.trim(), confidence: 'low', evidenceIds: h.evidenceIds }));
    }

    // 8. Critic: LLM review + deterministic numeric check.
    const canCritic = budget.remainingLlmCalls() > 0 && budget.remainingMs() > 0 && drafts.length > 0;
    const review = await critique({ claims: drafts, evidence: inv.evidence, chat: canCritic ? chatFor('critic', 'critic') : undefined, thinking: cfg.thinking.critic });
    for (const d of review.dropped) think(`Critic dropped a claim: "${d.text}" (${d.note})`);
    if (review.llmError && canCritic) think(`LLM critic unavailable: ${review.llmError}`);
    // `models` is an extra field beyond types.ts so the UI can show "handled by nvidia/nemotron-..." on the answer.
    const answer = { summary, claims: review.claims, models: [...handledBy.keys()] };
    inv.answer = answer;
    emit({ type: 'answer', answer: inv.answer });

    // 9. Remember verified findings with provenance (derivedFrom = evidence ids + Zetaris query ids).
    const verified = review.claims.filter((c) => c.verified);
    if (verified.length > 0 && isToolAllowed(contract, 'memory.remember') && budget.remainingMs() > 0) {
      const conf = { high: 0.9, medium: 0.7, low: 0.5 } as const;
      for (const c of verified) {
        try {
          const derivedFrom = [
            ...c.evidenceIds.map((id) => `${inv.id}/${id}`),
            ...c.evidenceIds.map((id) => inv.evidence.find((e) => e.id === id)?.result.queryId).filter((q): q is string => !!q).map((q) => `zetaris:query/${q}`),
          ];
          const id = await budget.withinDeadline(memory.remember(c.text, { source: `causa:investigation/${inv.id}`, confidence: conf[c.confidence], derivedFrom }));
          inv.rememberedIds.push(id);
        } catch (e) {
          think(`Could not remember a finding: ${(e as Error).message}`);
          if (e instanceof BudgetExceededError) break;
        }
      }
      if (inv.rememberedIds.length > 0) emit({ type: 'remembered', ids: [...inv.rememberedIds] });
    } else if (verified.length > 0 && !isToolAllowed(contract, 'memory.remember')) {
      think('Contract does not allow memory.remember; verified findings were not stored.');
    }

    think(`Budget used: ${JSON.stringify(budget.snapshot())}. Models: ${[...handledBy].map(([m, n]) => `${m} x${n}`).join(', ') || 'none'}`);
    return finish('done');
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return finish('failed', msg);
  }
}

function safeJson(text: string): unknown {
  try {
    const t = text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
    const m = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
    const body = m ? m[1] : t.slice(Math.max(0, t.indexOf('{')), t.lastIndexOf('}') + 1);
    return JSON.parse(body);
  } catch {
    return undefined;
  }
}

export type { ChatMessage };
