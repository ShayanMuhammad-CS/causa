import type { Evidence, ExecutionContract, Hypothesis, Investigation, InvestigationEvent, MemoryHit } from '@causa/types';

export type FeedItem = {
  key: string;
  hypothesisId: string;
  sql: string;
  purpose: string;
  state: 'running' | 'failed' | 'done';
  attempt: number;
  error?: string;
  evidence?: Evidence;
};

export type ModelCall = Extract<InvestigationEvent, { type: 'model_call' }>;
export type WorldEvent = Extract<InvestigationEvent, { type: 'world' }>;
export type WorldEntity = WorldEvent['entities'][number];
export interface MarkovStep { step: number; bounded: number; naive: number }

export interface View {
  id: string;
  question: string;
  contract?: ExecutionContract;
  recalled: MemoryHit[];
  hypotheses: Hypothesis[];
  feed: FeedItem[];
  thinking: string[];
  answer?: Investigation['answer'];
  modelCalls: ModelCall[];
  world?: { entities: WorldEntity[]; unknown: string[] };
  markov: Record<string, MarkovStep[]>;
  remembered: string[];
  verdicts: number;
  status: Investigation['status'];
  error?: string;
  startedAt: number;
  finishedAt?: number;
}

export type Action =
  | { kind: 'reset'; id: string; question: string }
  | { kind: 'event'; e: InvestigationEvent }
  | { kind: 'load'; inv: Investigation }
  | { kind: 'fail'; message: string };

export const emptyView = (id: string, question: string): View => ({
  id, question, recalled: [], hypotheses: [], feed: [], thinking: [], modelCalls: [], markov: {}, remembered: [], verdicts: 0,
  status: 'running', startedAt: Date.now(),
});

const upsert = (list: Hypothesis[], h: Hypothesis) =>
  list.some(x => x.id === h.id) ? list.map(x => (x.id === h.id ? h : x)) : [...list, h];

export function fromInvestigation(inv: Investigation): View {
  return {
    id: inv.id, question: inv.question, contract: inv.contract, recalled: inv.recalled, hypotheses: inv.hypotheses,
    feed: inv.evidence.map(ev => ({
      key: ev.id, hypothesisId: ev.hypothesisId, sql: ev.result.sql, purpose: ev.purpose,
      state: 'done' as const, attempt: 1, evidence: ev,
    })),
    thinking: [], modelCalls: [], markov: {}, answer: inv.answer, remembered: inv.rememberedIds, verdicts: inv.hypotheses.length,
    status: inv.status, error: inv.error, startedAt: Date.parse(inv.startedAt) || Date.now(),
    finishedAt: inv.finishedAt ? Date.parse(inv.finishedAt) : undefined,
  };
}

// On `done` the server's Investigation is authoritative, but we keep our feed (it has failed attempts the Investigation lacks).
function mergeDone(s: View, inv: Investigation): View {
  const v = fromInvestigation(inv);
  const feed = s.feed.length
    ? s.feed.map(f => (f.state === 'running' ? { ...f, state: 'failed' as const, error: 'No result received' } : f))
    : v.feed;
  return {
    ...v, feed, thinking: s.thinking, modelCalls: s.modelCalls, world: s.world, markov: s.markov,
    startedAt: Date.parse(inv.startedAt) || s.startedAt, finishedAt: (inv.finishedAt ? Date.parse(inv.finishedAt) : NaN) || Date.now(),
  };
}

const lastRunning = (feed: FeedItem[], hypothesisId: string) =>
  feed.map(f => f.state === 'running' && f.hypothesisId === hypothesisId).lastIndexOf(true);

export function reducer(s: View | null, a: Action): View | null {
  if (a.kind === 'reset') return emptyView(a.id, a.question);
  if (a.kind === 'load') return fromInvestigation(a.inv);
  if (!s) return s;
  if (a.kind === 'fail') {
    return { ...s, status: s.status === 'running' ? 'failed' : s.status, error: a.message, finishedAt: Date.now() };
  }
  const e = a.e;
  switch (e.type) {
    case 'contract': return { ...s, contract: e.contract };
    case 'recall': return { ...s, recalled: e.hits };
    case 'hypothesis': return { ...s, hypotheses: upsert(s.hypotheses, e.hypothesis) };
    case 'verdict': return { ...s, hypotheses: upsert(s.hypotheses, e.hypothesis), verdicts: s.verdicts + 1 };
    case 'thinking': return { ...s, thinking: [...s.thinking, e.text] };
    case 'query_started': {
      const prior = s.feed.filter(f => f.hypothesisId === e.hypothesisId && f.purpose === e.purpose).length;
      const item: FeedItem = {
        key: `q${s.feed.length}`, hypothesisId: e.hypothesisId, sql: e.sql, purpose: e.purpose,
        state: 'running', attempt: prior + 1,
      };
      return { ...s, feed: [...s.feed, item] };
    }
    case 'query_failed': {
      const idx = lastRunning(s.feed, e.hypothesisId);
      const base = idx >= 0 ? s.feed[idx] : undefined;
      const item: FeedItem = {
        key: base?.key ?? `q${s.feed.length}`, hypothesisId: e.hypothesisId, sql: e.sql,
        purpose: base?.purpose ?? '', state: 'failed', attempt: e.attempt, error: e.error,
      };
      return { ...s, feed: idx >= 0 ? s.feed.map((f, i) => (i === idx ? item : f)) : [...s.feed, item] };
    }
    case 'evidence': {
      const idx = lastRunning(s.feed, e.evidence.hypothesisId);
      const item: FeedItem = {
        key: e.evidence.id, hypothesisId: e.evidence.hypothesisId, sql: e.evidence.result.sql,
        purpose: e.evidence.purpose, state: 'done', attempt: idx >= 0 ? s.feed[idx].attempt : 1, evidence: e.evidence,
      };
      return { ...s, feed: idx >= 0 ? s.feed.map((f, i) => (i === idx ? item : f)) : [...s.feed, item] };
    }
    case 'model_call': return { ...s, modelCalls: [...s.modelCalls, e] };
    case 'world': return { ...s, world: { entities: e.entities, unknown: e.unknown } };
    case 'markov': {
      const prev = (s.markov[e.hypothesisId] ?? []).filter(m => m.step !== e.step);
      const next = [...prev, { step: e.step, bounded: e.tokensBounded, naive: e.tokensNaive }].sort((a, b) => a.step - b.step);
      return { ...s, markov: { ...s.markov, [e.hypothesisId]: next } };
    }
    case 'answer': return { ...s, answer: e.answer };
    case 'remembered': return { ...s, remembered: e.ids };
    case 'done': return mergeDone(s, e.investigation);
    case 'error': return { ...s, status: 'failed', error: e.message, finishedAt: Date.now() };
  }
}
