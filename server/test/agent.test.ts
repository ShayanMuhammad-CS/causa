import { describe, it, expect } from 'vitest';
import { runInvestigation, newInvestigation } from '../src/agent';
import { checkClaimNumbers } from '../src/agent/numbers';
import { Budget, BudgetExceededError, isToolAllowed } from '../src/agent/budget';
import { createFakeLLM } from '../src/llm/fake';
import { PHASE } from '../src/agent/prompts';
import type {
  CatalogTable, ChatMessage, ChatResponse, ExecutionContract, IntentEngine, IntentRecord,
  InvestigationEvent, LLM, MemoryService, QueryResult, ToolSpec, ZetarisClient,
} from '../src/types';

// ---------- in-file test doubles ----------
const CATALOG: CatalogTable[] = [
  { fqName: 'SEC_DATA.edgar.retail_revenue', origin: 'rest', description: 'Annual revenue by company (EDGAR XBRL)',
    columns: [{ name: 'company', type: 'string' }, { name: 'fiscal_year', type: 'int' }, { name: 'revenue_usd_m', type: 'double', description: 'revenue, USD millions' }] },
  { fqName: 'MACRO.bls.cpi_annual', origin: 'rest', description: 'US CPI-U annual average',
    columns: [{ name: 'year', type: 'int' }, { name: 'cpi', type: 'double' }] },
  { fqName: 'REF.company_dns.sic', origin: 'other', description: 'SIC hierarchy',
    columns: [{ name: 'company', type: 'string' }, { name: 'sic_code', type: 'string' }] },
];

function fakeZetaris(opts: { failTimes?: number; alwaysFail?: boolean } = {}) {
  const queries: string[] = [];
  let failures = 0;
  const z: ZetarisClient & { queries: string[]; catalogCalls: number } = {
    queries,
    catalogCalls: 0,
    async health() { return { ok: true, detail: 'test' }; },
    async catalog() { z.catalogCalls++; return CATALOG; },
    async query(sql: string): Promise<QueryResult> {
      queries.push(sql);
      if (opts.alwaysFail || failures < (opts.failTimes ?? 0)) {
        failures++;
        throw new Error('Table or view not found: SEC_DATA.edgar.retail_revnue; line 1 pos 14');
      }
      const isCpi = /cpi/i.test(sql);
      return {
        queryId: `q-${queries.length}`,
        sql,
        columns: isCpi ? ['year', 'cpi'] : ['company', 'fiscal_year', 'revenue_usd_m'],
        rows: isCpi
          ? [[2021, '270.97'], [2022, '292.66']]
          : [['WALMART', 2021, '572754'], ['WALMART', 2022, '611289'], ['TARGET', 2021, '106005'], ['TARGET', 2022, '109120']],
        rowCount: isCpi ? 2 : 4,
        elapsedMs: 5,
        source: [isCpi ? 'MACRO.bls.cpi_annual' : 'SEC_DATA.edgar.retail_revenue'],
      };
    },
  };
  return z;
}

function fakeIntent(over: Partial<IntentRecord> = {}, budget: Partial<ExecutionContract['budget']> = {}, valid = true) {
  const calls = { analyze: 0, verify: 0 };
  const engine: IntentEngine & { calls: typeof calls } = {
    calls,
    async analyze() {
      calls.analyze++;
      return { intent: 'explain_metric_change', entities: ['Target', 'Walmart'], metrics: ['revenue'], risk: 'low', riskReasons: [], ...over };
    },
    issueContract(intent) {
      return {
        id: 'c-1', intent,
        allowedTools: ['zetaris.catalog', 'zetaris.query', 'memory.recall', 'memory.remember'],
        budget: { maxQueries: 12, maxLlmCalls: 30, maxSeconds: 60, ...budget },
        stopConditions: ['budget_exhausted'], signature: 'sig', issuedAt: new Date().toISOString(),
      };
    },
    verifyContract() { calls.verify++; return valid; },
  };
  return engine;
}

function fakeMemory() {
  const remembered: { text: string; provenance: { source: string; confidence: number; derivedFrom?: string[] } }[] = [];
  const m: MemoryService & { remembered: typeof remembered } = {
    remembered,
    async recall() { return [{ id: 'm-7', text: 'Target revenue growth slowed in 2022', score: 0.8, provenance: { source: 'investigation:inv-3', confidence: 0.8 } }]; },
    async remember(text, provenance) { remembered.push({ text, provenance }); return `m-${100 + remembered.length}`; },
    async feedback() {},
    async audit() { return []; },
  };
  return m;
}

/** Wrap the scripted fake LLM, record every call, and optionally override individual phases. */
function recordingLLM(override?: (messages: ChatMessage[], opts: { tools?: ToolSpec[] } | undefined) => ChatResponse | undefined) {
  const base = createFakeLLM();
  const calls: { messages: ChatMessage[]; tools?: ToolSpec[] }[] = [];
  const llm: LLM & { calls: typeof calls } = {
    calls,
    async chat(messages, opts) {
      calls.push({ messages: messages.map((m) => ({ ...m })), tools: opts?.tools });
      return override?.(messages, opts) ?? base.chat(messages, opts);
    },
    embed: (t) => base.embed(t),
  };
  return llm;
}

async function run(deps: { llm: LLM; zetaris: ZetarisClient; memory: MemoryService; intent: IntentEngine }, question = 'Why did Target revenue growth lag Walmart after 2021?') {
  const events: InvestigationEvent[] = [];
  const inv = newInvestigation('inv-1', question);
  await runInvestigation({ investigation: inv, deps, emit: (e) => events.push(e) });
  return { inv, events, types: events.map((e) => e.type) };
}

// ---------- tests ----------
describe('investigation loop', () => {
  it('runs end to end with the scripted fake: hypotheses, evidence, verified answer, remembered with provenance', async () => {
    const zetaris = fakeZetaris();
    const memory = fakeMemory();
    const { inv, types } = await run({ llm: recordingLLM(), zetaris, memory, intent: fakeIntent() });
    expect(inv.status).toBe('done');
    expect(types[0]).toBe('contract');
    expect(types[1]).toBe('recall');
    expect(types.filter((t) => t === 'hypothesis')).toHaveLength(3);
    expect(types.filter((t) => t === 'verdict')).toHaveLength(3);
    expect(types.at(-1)).toBe('done');
    expect(inv.evidence.length).toBeGreaterThan(0);
    expect(inv.answer!.claims.length).toBeGreaterThan(0);
    expect(inv.answer!.claims.every((c) => c.verified)).toBe(true);
    expect(memory.remembered.length).toBe(inv.answer!.claims.length);
    expect(memory.remembered[0].provenance.derivedFrom!.some((d) => d.includes('ev-'))).toBe(true);
    expect(inv.rememberedIds).toEqual(memory.remembered.map((_, i) => `m-${101 + i}`));
  });

  it('stops a blocked contract before any catalog read or query', async () => {
    const zetaris = fakeZetaris();
    const llm = recordingLLM();
    const { inv, types } = await run({ llm, zetaris, memory: fakeMemory(), intent: fakeIntent({ risk: 'blocked', riskReasons: ['DDL: DROP TABLE'] }) });
    expect(inv.status).toBe('blocked');
    expect(zetaris.queries).toHaveLength(0);
    expect(zetaris.catalogCalls).toBe(0);
    expect(llm.calls).toHaveLength(0);
    expect(types).toEqual(['contract', 'done']);
  });

  it('refuses to run when the contract signature does not verify', async () => {
    const zetaris = fakeZetaris();
    const { inv, types } = await run({ llm: recordingLLM(), zetaris, memory: fakeMemory(), intent: fakeIntent({}, {}, false) });
    expect(inv.status).toBe('failed');
    expect(inv.error).toMatch(/contract/i);
    expect(zetaris.queries).toHaveLength(0);
    expect(types.at(-1)).toBe('error');
  });

  it('budget exhaustion stops cleanly: never exceeds maxQueries / maxLlmCalls and still finishes with an answer', async () => {
    const zetaris = fakeZetaris();
    // Greedy model: in the investigate phase it always wants another query.
    let n = 0;
    const llm = recordingLLM((messages, opts) => {
      if (messages[0].content.includes(PHASE.investigate) && opts?.tools?.length) {
        n++;
        return { content: '', model: 'g', toolCalls: [{ id: `g${n}`, name: 'zetaris_query', arguments: JSON.stringify({ sql: `SELECT * FROM SEC_DATA.edgar.retail_revenue WHERE ${n}=${n}`, purpose: 'greedy' }) }] };
      }
      return undefined;
    });
    const { inv, types, events } = await run({ llm, zetaris, memory: fakeMemory(), intent: fakeIntent({}, { maxQueries: 2, maxLlmCalls: 9 }) });
    expect(zetaris.queries.length).toBe(2);
    expect(llm.calls.length).toBeLessThanOrEqual(9);
    expect(inv.status).toBe('done');
    expect(inv.answer).toBeDefined();
    expect(inv.hypotheses[2].status).toBe('inconclusive');
    expect(types.at(-1)).toBe('done');
    expect(events.some((e) => e.type === 'thinking' && /Budget exhausted \(maxQueries\)/.test(e.text))).toBe(true);
  });

  it('never exceeds maxLlmCalls even with a tiny budget', async () => {
    const zetaris = fakeZetaris();
    const llm = recordingLLM();
    const { inv, types } = await run({ llm, zetaris, memory: fakeMemory(), intent: fakeIntent({}, { maxLlmCalls: 3 }) });
    expect(llm.calls.length).toBeLessThanOrEqual(3);
    expect(inv.status).toBe('done');
    expect(types.at(-1)).toBe('done');
  });

  it('stops at maxSeconds without hanging and still terminates with done', async () => {
    const zetaris = fakeZetaris();
    const slow = recordingLLM((messages) => {
      if (messages[0].content.includes(PHASE.investigate)) return undefined;
      return undefined;
    });
    const llm: LLM = {
      async chat(m, o) { await new Promise((r) => setTimeout(r, 400)); return slow.chat(m, o); },
      embed: (t) => slow.embed(t),
    };
    const started = Date.now();
    const { inv, types } = await run({ llm, zetaris, memory: fakeMemory(), intent: fakeIntent({}, { maxSeconds: 1 }) });
    expect(Date.now() - started).toBeLessThan(2500);
    expect(inv.status).toBe('done');
    expect(types.at(-1)).toBe('done');
    expect(inv.answer!.summary).toMatch(/budget: maxSeconds/);
  });

  it('feeds a SQL error back to the model and retries', async () => {
    const zetaris = fakeZetaris({ failTimes: 1 });
    const llm = recordingLLM();
    const { inv, events } = await run({ llm, zetaris, memory: fakeMemory(), intent: fakeIntent() });
    const failed = events.find((e) => e.type === 'query_failed');
    expect(failed).toMatchObject({ type: 'query_failed', attempt: 1 });
    // the next investigate call for that hypothesis must carry the error text (Markovian: in the latest tool results)
    const retryCall = llm.calls.find((c) => c.messages.some((m) => m.role === 'user' && m.content.includes('LATEST TOOL RESULTS') && m.content.includes('Table or view not found')));
    expect(retryCall).toBeDefined();
    expect(inv.evidence.length).toBeGreaterThan(0);
    expect(inv.status).toBe('done');
  });

  it('allows at most 2 retries of a failing query per hypothesis', async () => {
    const zetaris = fakeZetaris({ alwaysFail: true });
    let n = 0;
    const llm = recordingLLM((messages, opts) => {
      if (messages[0].content.includes(PHASE.investigate) && opts?.tools?.length) {
        n++;
        return { content: '', model: 'g', toolCalls: [{ id: `r${n}`, name: 'zetaris_query', arguments: JSON.stringify({ sql: `SELECT * FROM x${n}`, purpose: 'retry' }) }] };
      }
      return undefined;
    });
    const { inv, events } = await run({ llm, zetaris, memory: fakeMemory(), intent: fakeIntent({}, { maxQueries: 50, maxLlmCalls: 60 }) });
    const perHyp = new Map<string, number>();
    for (const e of events) if (e.type === 'query_failed') perHyp.set(e.hypothesisId, (perHyp.get(e.hypothesisId) ?? 0) + 1);
    expect(perHyp.size).toBe(3);
    for (const v of perHyp.values()) expect(v).toBe(3);
    expect(inv.hypotheses.every((h) => h.status === 'inconclusive')).toBe(true);
  });

  it('critic downgrades a claim whose number is not in the cited evidence even if the LLM critic approves it', async () => {
    const zetaris = fakeZetaris();
    const llm = recordingLLM((messages) => {
      const sys = messages[0].content;
      if (sys.includes(PHASE.synthesize)) {
        const ev = messages[1].content.match(/"id":"(ev-\d+)"/)![1];
        return {
          content: JSON.stringify({
            summary: 'Target lagged.',
            claims: [
              { text: `Walmart revenue rose to $611,289 million in FY2022 [${ev}].`, confidence: 'high', evidenceIds: [ev] },
              { text: `Target revenue grew 14.7% in 2022 [${ev}].`, confidence: 'high', evidenceIds: [ev] },
            ],
          }),
          toolCalls: [], model: 'x',
        };
      }
      if (sys.includes(PHASE.critic)) {
        return { content: JSON.stringify({ reviews: [{ index: 0, verdict: 'verified', note: 'ok' }, { index: 1, verdict: 'verified', note: 'ok' }] }), toolCalls: [], model: 'x' };
      }
      return undefined;
    });
    const memory = fakeMemory();
    const { inv } = await run({ llm, zetaris, memory, intent: fakeIntent() });
    const [good, bad] = inv.answer!.claims;
    expect(good.verified).toBe(true);
    expect(bad.verified).toBe(false);
    expect(bad.confidence).toBe('medium');
    expect(bad.criticNote).toMatch(/14\.7/);
    expect(memory.remembered.map((r) => r.text)).not.toContain(bad.text);
  });
});

describe('deterministic number check', () => {
  const rows = [['WALMART', 2021, '572754'], ['WALMART', 2022, '611289'], ['TARGET', 2021, '106005'], ['TARGET', 2022, '109120']];
  const cols = ['company', 'fiscal_year', 'revenue_usd_m'];
  it('accepts direct, rescaled and derived numbers', () => {
    expect(checkClaimNumbers('Walmart revenue was $611.3 billion in 2022', [{ columns: cols, rows }]).ok).toBe(true);
    expect(checkClaimNumbers('Target grew 2.9% vs Walmart 6.7% [ev-1]', [{ columns: cols, rows }]).ok).toBe(true);
    expect(checkClaimNumbers('Walmart added $38,535 million', [{ columns: cols, rows }]).ok).toBe(true);
  });
  it('flags numbers that are neither present nor derivable', () => {
    const r = checkClaimNumbers('Target grew 14.7% in FY2022', [{ columns: cols, rows }]);
    expect(r.ok).toBe(false);
    expect(r.unsupported).toEqual(['14.7%']);
  });
});

describe('Budget (contract enforcement primitives)', () => {
  const contract = fakeIntent().issueContract({ intent: 'x', entities: [], metrics: [], risk: 'low', riskReasons: [] });
  it('throws once maxQueries / maxLlmCalls are used up', () => {
    const b = new Budget({ ...contract, budget: { maxQueries: 2, maxLlmCalls: 1, maxSeconds: 60 } });
    b.chargeQuery();
    b.chargeQuery();
    expect(() => b.chargeQuery()).toThrow(BudgetExceededError);
    b.chargeLlm();
    expect(() => b.chargeLlm()).toThrow(/maxLlmCalls/);
  });
  it('throws after maxSeconds and rejects slow calls at the deadline', async () => {
    let now = 0;
    const b = new Budget({ ...contract, budget: { maxQueries: 9, maxLlmCalls: 9, maxSeconds: 1 } }, () => now);
    now = 1000;
    expect(() => b.chargeQuery()).toThrow(/maxSeconds/);
  });
  it('checks allowedTools with wildcards and implied permissions', () => {
    expect(isToolAllowed({ ...contract, allowedTools: ['zetaris.catalog'] }, 'zetaris.query')).toBe(false);
    expect(isToolAllowed({ ...contract, allowedTools: ['zetaris.catalog'] }, 'zetaris.describe')).toBe(true);
    expect(isToolAllowed({ ...contract, allowedTools: ['zetaris.*'] }, 'zetaris.query')).toBe(true);
  });
});

describe('provider-facing behaviour', () => {
  it('records which model handled each call and routes the critic to its pinned model', async () => {
    const zetaris = fakeZetaris();
    const llm = recordingLLM();
    const models: (string | undefined)[] = [];
    const spy: LLM = { chat: (m, o) => { models.push(o?.model); return llm.chat(m, o); }, embed: (t) => llm.embed(t) };
    const events: InvestigationEvent[] = [];
    const inv = newInvestigation('inv-2', 'Why did Target revenue growth lag Walmart after 2021?');
    await runInvestigation({ investigation: inv, deps: { llm: spy, zetaris, memory: fakeMemory(), intent: fakeIntent() }, emit: (e) => events.push(e), config: { models: { critic: 'meterless/deep.nemotron' } } });
    expect(models.at(-1)).toBe('meterless/deep.nemotron');
    expect(models[0]).toBeUndefined();
    expect(events.some((e) => e.type === 'thinking' && /\[critic\] handled by meterless\/deep\.nemotron/.test(e.text))).toBe(true);
    expect((inv.answer as any).models.length).toBeGreaterThan(0);
  });

  it('schema retrieval works without any embeddings endpoint (BM25 over names + column descriptions)', async () => {
    const { retrieveSchema } = await import('../src/agent/schema');
    const noEmbed = { chat: async () => ({ content: '', toolCalls: [], model: 'x' }), embed: async () => { throw new Error('404 no /v1/embeddings'); }, canEmbed: async () => false } as LLM;
    const r = await retrieveSchema({ llm: noEmbed, catalog: CATALOG, query: 'consumer price inflation cpi 2022', k: 2 });
    expect(r.method).toBe('bm25');
    expect(r.tables[0].fqName).toBe('MACRO.bls.cpi_annual');
    const r2 = await retrieveSchema({ llm: noEmbed, catalog: CATALOG, query: 'Target revenue growth', k: 1 });
    expect(r2.tables[0].fqName).toBe('SEC_DATA.edgar.retail_revenue');
  });
});
