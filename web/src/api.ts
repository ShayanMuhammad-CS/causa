import type { Investigation, InvestigationEvent } from '@causa/types';
import mockData from './mock/events.json';

// MOCK MODE (?mock=1): replays src/mock/events.json (hand-written MOCK DATA, not a real recording).
// ?speed=3 plays it 3x faster.
export const MOCK = new URLSearchParams(location.search).get('mock') === '1';
const SPEED = Number(new URLSearchParams(location.search).get('speed')) || 1;

// Matches server/src/store.ts InvestigationSummary.
export interface Summary {
  id: string; question: string; status: string; startedAt: string; finishedAt?: string;
  claimCount?: number; verifiedCount?: number; evidenceCount?: number;
}
type Probe = { ok: boolean; detail: string };
export interface Health { zetaris: Probe; llm: Probe; memory: Probe }
export interface AuditEntry { at: string; event: string; detail: string }
/** World Model trail: server shape for GET /api/world/:id/history is not frozen, so items are kept loose and rendered defensively. */
export type WorldTrailItem = Record<string, unknown>;
export class NotFound extends Error {}

const MOCK_EVENTS = (mockData as unknown as { events: { t: number; event: InvestigationEvent }[] }).events;
// MOCK DATA below
const MOCK_HISTORY: Summary[] = [
  { id: 'inv-19', question: "Is Ford's slowdown company-specific or sector-wide?", status: 'done', startedAt: '2026-10-23T16:02:00Z' },
  { id: 'inv-12', question: "What explains Dollar General's margin squeeze?", status: 'done', startedAt: '2026-10-22T11:40:00Z' },
  { id: 'inv-7', question: 'Why did Kroger revenue stall in FY2023?', status: 'failed', startedAt: '2026-10-21T08:15:00Z' },
];
// MOCK DATA
const MOCK_WORLD: Record<string, WorldTrailItem[]> = {
  'mock-target': [
    { at: '2026-10-24T09:14:03Z', event: 'resolved', detail: 'Matched "Target" to TARGET CORP by name (MOCK DATA)' },
    { at: '2026-10-24T09:14:03Z', event: 'attribute', detail: 'SIC 5331 Variety Stores (MOCK DATA)' },
  ],
  'mock-walmart': [
    { at: '2026-10-24T09:14:03Z', event: 'resolved', detail: 'Matched "Walmart" to WALMART INC by name (MOCK DATA)' },
  ],
};
const MOCK_AUDIT: AuditEntry[] = [
  { at: '2026-10-24T09:14:41Z', event: 'written', detail: 'Stored from investigation inv-demo; source = ev-2, ev-1; confidence 0.86' },
  { at: '2026-10-24T09:14:41Z', event: 'trust:init', detail: 'Initial trust 0.60 (critic-verified, 2 evidence rows)' },
  { at: '2026-10-24T09:20:13Z', event: 'recalled', detail: 'Retrieved for "Why did Walmart outgrow Target?" (score 0.88)' },
  { at: '2026-10-24T09:21:02Z', event: 'feedback:helpful', detail: 'Analyst rated helpful; trust 0.60 to 0.72' },
];

async function j<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, init);
  if (r.status === 404) throw new NotFound(`${url}: not found`);
  if (!r.ok) throw new Error(`${init?.method ?? 'GET'} ${url} failed: HTTP ${r.status}`);
  return r.json() as Promise<T>;
}

const post = (body: unknown): RequestInit => ({
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});

export const api = {
  async create(question: string): Promise<{ id: string }> {
    if (MOCK) return { id: 'inv-demo' };
    return j('/api/investigations', post({ question }));
  },
  async list(): Promise<Summary[]> {
    if (MOCK) return MOCK_HISTORY;
    const r = await j<Summary[]>('/api/investigations');
    return Array.isArray(r) ? r : [];
  },
  async get(id: string): Promise<Investigation> {
    if (MOCK) throw new Error('No stored mock investigation for ' + id + ' (mock mode only replays one run)');
    return j(`/api/investigations/${encodeURIComponent(id)}`);
  },
  async health(): Promise<Health> {
    const ok = { ok: true, detail: 'mock' };
    if (MOCK) return { zetaris: ok, llm: ok, memory: ok };
    return j('/api/health');
  },
  async audit(id: string): Promise<AuditEntry[]> {
    if (MOCK) return MOCK_AUDIT;
    const r = await j<AuditEntry[]>(`/api/memory/${encodeURIComponent(id)}/audit`);
    return Array.isArray(r) ? r : [];
  },
  /** Meterless World Model event trail for an entity. Resolves to null when the server has no trail (404). */
  async worldHistory(id: string): Promise<WorldTrailItem[] | null> {
    if (MOCK) return MOCK_WORLD[id] ?? [];
    try {
      const r = await j<unknown>(`/api/world/${encodeURIComponent(id)}/history`);
      if (Array.isArray(r)) return r as WorldTrailItem[];
      const o = r as Record<string, unknown>;
      const inner = o.events ?? o.history ?? o.trail;
      return Array.isArray(inner) ? (inner as WorldTrailItem[]) : [];
    } catch (e) {
      if (e instanceof NotFound) return null;
      throw e;
    }
  },
  async feedback(id: string, verdict: 'helpful' | 'unhelpful'): Promise<void> {
    if (MOCK) return;
    await j(`/api/memory/${encodeURIComponent(id)}/feedback`, post({ verdict }));
  },
};

const TYPES = ['contract', 'recall', 'hypothesis', 'query_started', 'evidence', 'query_failed', 'thinking', 'model_call', 'world', 'markov', 'verdict', 'answer', 'remembered', 'done', 'error'] as const;

/**
 * Opens the SSE stream (or the mock replay). Returns a close function.
 * The server replays all past events first, then streams live, and closes after `done`/`error`.
 * Network blips: EventSource reconnects by itself with Last-Event-ID (server resumes after it; replies 204 once finished),
 * so we only report `onRetry(true)` while it is reconnecting and `onLost` once the browser gave up (readyState CLOSED).
 */
export function openStream(
  id: string, onEvent: (e: InvestigationEvent) => void, onLost: (msg: string) => void, onRetry: (retrying: boolean) => void = () => undefined,
): () => void {
  if (MOCK) {
    const timers = MOCK_EVENTS.map(({ t, event }) => window.setTimeout(() => onEvent(event), t / SPEED));
    return () => timers.forEach(clearTimeout);
  }
  const es = new EventSource(`/api/investigations/${encodeURIComponent(id)}/events`);
  let finished = false;
  es.onopen = () => onRetry(false);
  for (const type of TYPES) {
    es.addEventListener(type, (m: MessageEvent) => {
      try {
        const raw = JSON.parse(m.data) as { type?: string };
        onEvent((raw.type ? raw : { ...raw, type }) as InvestigationEvent);
      } catch { return; /* ignore malformed frame */ }
      if (type === 'done' || type === 'error') { finished = true; es.close(); onRetry(false); }
    });
  }
  es.onerror = () => {
    if (finished) return;
    if (es.readyState === EventSource.CLOSED) { es.close(); onRetry(false); onLost('Lost connection to the Causa server.'); }
    else onRetry(true);
  };
  return () => es.close();
}
