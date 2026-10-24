// Meterless engines inside the investigation loop: World Model grounding + metric facts, Markovian bounded
// context per hypothesis, and model_call proof for every LLM call (NVIDIA award: "show which model handled the request").
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runInvestigation, newInvestigation } from '../src/agent';
import { checkClaimNumbers } from '../src/agent/numbers';
import { instrumentLLM, modelCallScope } from '../src/agent/modelcalls';
import { extractEntityMentions } from '../src/agent/world';
import { createFakeLLM } from '../src/llm/fake';
import { PHASE } from '../src/agent/prompts';
import { createIntentEngine } from '../src/intent/index';
import { findIntent } from '../src/intent/registry';
import { createWorldModel, type WorldService } from '../src/world/index';
import { createMarkovian } from '../src/markov/index';
import type {
  CatalogTable, ChatMessage, ChatResponse, ExecutionContract, IntentEngine, IntentRecord,
  InvestigationEvent, LLM, MemoryService, QueryResult, ToolSpec, ZetarisClient,
} from '../src/types';

const CATALOG: CatalogTable[] = [
  { fqName: 'edgar.company_financials', origin: 'schemastore', description: 'Annual revenue by company (EDGAR XBRL)',
    columns: [{ name: 'ticker', type: 'string' }, { name: 'fiscal_year', type: 'int' }, { name: 'revenue_usd', type: 'double' }] },
  { fqName: 'worldbank.us_macro_indicators', origin: 'schemastore', description: 'US CPI inflation',
    columns: [{ name: 'year', type: 'int' }, { name: 'cpi_inflation_pct', type: 'double' }] },
];

function zetarisDouble() {
  const queries: string[] = [];
  const z: ZetarisClient & { queries: string[] } = {
    queries,
    async health() { return { ok: true, detail: 'test' }; },
    async catalog() { return CATALOG; },
    async query(sql: string): Promise<QueryResult> {
      queries.push(sql);
      const macro = /macro|cpi/i.test(sql);
      return {
        queryId: `q-${queries.length}`, sql,
        columns: macro ? ['year', 'cpi_inflation_pct'] : ['ticker', 'fiscal_year', 'revenue_usd'],
        rows: macro ? [[2022, 8.0], [2023, 4.12]] : [['WMT', 2022, 611289000000], ['WMT', 2023, 648125000000], ['TGT', 2022, 109120000000], ['TGT', 2023, 107412000000]],
        rowCount: macro ? 2 : 4, elapsedMs: 3, source: [macro ? 'worldbank.us_macro_indicators' : 'edgar.company_financials'],
      };
    },
  };
  return z;
}

function intentDouble(budget: Partial<ExecutionContract['budget']> = {}): IntentEngine {
  return {
    async analyze(): Promise<IntentRecord> { return { intent: 'explain_metric_change', entities: [], metrics: ['revenue'], risk: 'low', riskReasons: [] }; },
    issueContract(intent) {
      return { id: 'c-1', intent, allowedTools: ['zetaris.catalog', 'zetaris.query', 'memory.recall', 'memory.remember'],
        budget: { maxQueries: 12, maxLlmCalls: 30, maxSeconds: 60, ...budget }, stopConditions: [], signature: 's', issuedAt: new Date().toISOString() };
    },
    verifyContract() { return true; },
  };
}

const memoryDouble = (): MemoryService => ({
  async recall() { return []; }, async remember() { return 'm-1'; }, async feedback() {}, async audit() { return []; },
});

function recordingLLM(override?: (m: ChatMessage[], o?: { tools?: ToolSpec[] }) => ChatResponse | undefined) {
  const base = createFakeLLM();
  const calls: ChatMessage[][] = [];
  const llm: LLM & { calls: ChatMessage[][] } = {
    calls,
    async chat(messages, opts) { calls.push(messages.map((m) => ({ ...m }))); return override?.(messages, opts) ?? base.chat(messages, opts); },
    embed: (t) => base.embed(t),
  };
  return llm;
}

let dir: string;
let world: WorldService;
beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'causa-agent-world-'));
  world = createWorldModel({ CAUSA_WORLD_DIR: dir } as NodeJS.ProcessEnv);
  const seed = { investigationId: 'seed', queryId: 'q-seed' };
  await world.observeCompany({ cik: '0000104169', name: 'Walmart Inc.', ticker: 'WMT', sic: '5331', peerGroup: 'SIC 5331' }, seed);
  await world.observeCompany({ cik: '0000027419', name: 'TARGET CORP', ticker: 'TGT', sic: '5331', peerGroup: 'SIC 5331' }, seed);
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

async function run(question: string, llm: LLM, opts: { budget?: Partial<ExecutionContract['budget']>; zetaris?: ZetarisClient } = {}) {
  const events: InvestigationEvent[] = [];
  const inv = newInvestigation('inv-9', question);
  const zetaris = (opts.zetaris ?? zetarisDouble()) as ReturnType<typeof zetarisDouble>;
  await runInvestigation({
    investigation: inv,
    deps: { llm, zetaris, memory: memoryDouble(), intent: intentDouble(opts.budget), world, markov: () => createMarkovian({}) },
    emit: (e) => events.push(e),
  });
  return { inv, events, zetaris };
}

describe('World Model grounding', () => {
  it('extracts company mentions and separates known from unknown names', () => {
    const r = extractEntityMentions("Why did Kohl's revenue growth lag Walmart's and TGT from FY2022 to FY2024 (CPI, SIC)?", world);
    expect(r.entities.map((e) => e.ticker).sort()).toEqual(['TGT', 'WMT']);
    expect(r.unknown).toEqual(["Kohl's"]);
    expect(extractEntityMentions('What explains retail margin squeeze in 2023?', world).unknown).toEqual([]);
  });

  it('a question about an unknown company only: says so, runs no SQL and invents nothing', async () => {
    const llm = recordingLLM();
    const { inv, events, zetaris } = await run("Why did Initech's revenue fall in 2023?", llm);
    const w = events.find((e) => e.type === 'world');
    expect(w).toMatchObject({ type: 'world', entities: [], unknown: ["Initech's"] });
    expect(inv.status).toBe('done');
    expect(zetaris.queries).toHaveLength(0);
    expect(llm.calls).toHaveLength(0);
    expect(inv.hypotheses).toHaveLength(0);
    expect(inv.answer!.claims).toHaveLength(0);
    expect(inv.answer!.summary).toMatch(/Initech.*not in the data/i);
  });

  it('a mixed question restricts hypotheses to known companies and states which names were not in the data', async () => {
    const llm = recordingLLM();
    const { inv, events } = await run("Why did Kohl's revenue growth lag Walmart's after 2021?", llm);
    const w = events.find((e) => e.type === 'world') as Extract<InvestigationEvent, { type: 'world' }>;
    expect(w.entities.map((e) => e.ticker)).toEqual(['WMT']);
    expect(w.entities[0]).toMatchObject({ cik: '0000104169', sic: '5331', id: 'company:sec-cik:0000104169' });
    expect(w.unknown).toEqual(["Kohl's"]);
    const plan = llm.calls.find((m) => m[0].content.includes(PHASE.plan))!;
    expect(plan[1].content).toMatch(/NOT IN THE DATA[^\n]*Kohl's/);
    expect(plan[1].content).toMatch(/KNOWN ENTITIES[\s\S]*WMT/);
    expect(inv.answer!.summary).toMatch(/Kohl's[^.]*not in the data/i);
    expect(inv.answer!.claims.some((c) => /kohl/i.test(c.text))).toBe(false);
  });

  it('records clearly identified metric rows as World Model facts with evidence + query provenance', async () => {
    const { inv } = await run("Why did Target's revenue growth lag Walmart's after 2021?", recordingLLM());
    const tgt = world.resolveEntity('TGT')!;
    const fact = world.currentMetric(tgt.id, 'Revenue', 'FY2023');
    expect(fact?.value).toBe(107412000000);
    const ev = inv.evidence.find((e) => e.id === fact!.provenance.evidenceId)!;
    expect(ev).toBeDefined();
    expect(fact!.provenance).toMatchObject({ investigationId: 'inv-9', queryId: ev.result.queryId });
    expect(world.history(tgt.id).some((h) => h.kind === 'assertFact' && /Revenue FY2023 = 107412000000/.test(h.summary))).toBe(true);
  });
});

describe('Markovian bounded context per hypothesis', () => {
  it('emits a markov event per tool step; bounded < naive after a few steps; carried state keeps evidence ids + numbers', async () => {
    let n = 0;
    const llm = recordingLLM((messages, o) => {
      if (messages[0].content.includes(PHASE.investigate) && o?.tools?.length && n < 4) {
        n++;
        return { content: `Querying again.\n[STATE_CHECKPOINT]\nCOMPLETED: query ${n}\nREMAINING: compare peers\nDECISIONS: use revenue\nCONTEXT: none`, model: 'g',
          toolCalls: [{ id: `g${n}`, name: 'zetaris_query', arguments: JSON.stringify({ sql: `SELECT ticker, fiscal_year, revenue_usd FROM edgar.company_financials WHERE ${n}=${n}`, purpose: `revenue pull ${n}` }) }] };
      }
      return undefined;
    });
    const { events } = await run("Why did Target's revenue growth lag Walmart's after 2021?", llm);
    const mk = events.filter((e): e is Extract<InvestigationEvent, { type: 'markov' }> => e.type === 'markov' && e.hypothesisId === 'h-1');
    expect(mk.length).toBeGreaterThanOrEqual(3);
    expect(mk.map((e) => e.step)).toEqual(mk.map((_, i) => i + 1));
    const last = mk.at(-1)!;
    expect(last.tokensBounded).toBeLessThan(last.tokensNaive);
    // no ever-growing transcript: later investigate calls carry no tool-role messages, only the bounded state
    const later = llm.calls.filter((m) => m[0].content.includes(PHASE.investigate) && m[1].content.includes('HYPOTHESIS h-1') && m.some((x) => x.content.includes('[CARRYOVER STATE]')));
    expect(later.length).toBeGreaterThanOrEqual(3);
    for (const m of later) expect(m.some((x) => x.role === 'tool' || x.role === 'assistant')).toBe(false);
    const carried = later.at(-1)!.at(-1)!.content;
    expect(carried).toMatch(/ev-1\b/);
    expect(carried).toMatch(/ev-3\b/);
    expect(carried).toMatch(/107412000000/);
  });
});

describe('model_call proof', () => {
  it('emits one model_call per LLM call with role, provider-reported model, provider and ms; answer.models lists them', async () => {
    const llm = recordingLLM();
    const { inv, events } = await run("Why did Target's revenue growth lag Walmart's after 2021?", llm);
    const mc = events.filter((e): e is Extract<InvestigationEvent, { type: 'model_call' }> => e.type === 'model_call');
    expect(mc).toHaveLength(llm.calls.length);
    expect(new Set(mc.map((e) => e.role))).toEqual(new Set(['planner', 'sql', 'synthesis', 'critic']));
    for (const e of mc) {
      expect(e.model).toBe('fake/nemotron-scripted');
      expect(e.provider).toBe('sample');
      expect(e.ms).toBeGreaterThanOrEqual(0);
    }
    expect(inv.answer!.models).toEqual(['fake/nemotron-scripted']);
    expect(events.some((e) => e.type === 'thinking' && /handled by/.test(e.text))).toBe(true);
  });

  it('labels Meterless Nightshift responses by the model the provider reported, and covers intent calls via the scope', async () => {
    const nightshift: LLM = {
      async chat() {
        return { content: '{"intent":"explain_metric_change","entities":["Target"],"metrics":["revenue"],"timeRange":null}', toolCalls: [],
          model: 'nvidia/nemotron-3-super-120b-a12b via meterless-nightshift',
          handledBy: { provider: 'meterless-nightshift', requested: 'meterless/auto', model: 'nvidia/nemotron-3-super-120b-a12b', headers: {}, latencyMs: 5 } } as ChatResponse;
      },
      async embed(t) { return t.map(() => [1]); },
    };
    const intent = createIntentEngine({ llm: instrumentLLM(nightshift, 'intent'), secret: 's' });
    const seen: InvestigationEvent[] = [];
    await modelCallScope.run({ emit: (e) => seen.push(e) }, () => intent.analyze('Why did Target revenue lag?'));
    expect(seen).toEqual([expect.objectContaining({ type: 'model_call', role: 'intent', model: 'nvidia/nemotron-3-super-120b-a12b', provider: 'meterless-nightshift' })]);
  });
});

describe('numbers + budgets', () => {
  it('ISO period-end dates are context, not claims', () => {
    const t = { columns: ['ticker', 'period_end', 'revenue_usd'], rows: [['TGT', '2025-02-01', 106566000000]] };
    expect(checkClaimNumbers('Target revenue was $106.57B in the FY ending 2025-02-01.', [t]).ok).toBe(true);
  });

  it('Scout Intent explain budgets fit a Nemotron run; blocked stays zero', () => {
    expect(findIntent('explain_metric_change')!.budget).toEqual({ maxQueries: 14, maxLlmCalls: 28, maxSeconds: 300 });
    const c = createIntentEngine({ llm: createFakeLLM(), secret: 's', useLlm: false }).issueContract({ intent: 'x', entities: [], metrics: [], risk: 'blocked', riskReasons: ['ddl'] });
    expect(c.budget).toEqual({ maxQueries: 0, maxLlmCalls: 0, maxSeconds: 0 });
  });
});
