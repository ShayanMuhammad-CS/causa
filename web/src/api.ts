import type { Investigation, InvestigationEvent } from '@causa/types';
import mockData from './mock/events.json';

// MOCK MODE (?mock=1): replays src/mock/events.json (hand-written MOCK DATA, not a real recording).
// ?speed=3 plays it 3x faster.
export const MOCK = new URLSearchParams(location.search).get('mock') === '1';
const SPEED = Number(new URLSearchParams(location.search).get('speed')) || 1;

export interface Summary { id: string; question: string; status: string; startedAt?: string }
type Probe = { ok: boolean; detail: string };
export interface Health { zetaris: Probe; llm: Probe; memory: Probe }
export interface AuditEntry { at: string; event: string; detail: string }

const MOCK_EVENTS = (mockData as unknown as { events: { t: number; event: InvestigationEvent }[] }).events;
// MOCK DATA below
const MOCK_HISTORY: Summary[] = [
  { id: 'inv-19', question: "Is Ford's slowdown company-specific or sector-wide?", status: 'done', startedAt: '2026-10-23T16:02:00Z' },
  { id: 'inv-12', question: "What explains Dollar General's margin squeeze?", status: 'done', startedAt: '2026-10-22T11:40:00Z' },
  { id: 'inv-7', question: 'Why did Kroger revenue stall in FY2023?', status: 'failed', startedAt: '2026-10-21T08:15:00Z' },
];
const MOCK_AUDIT: AuditEntry[] = [
  { at: '2026-10-24T09:14:41Z', event: 'written', detail: 'Stored from investigation inv-demo; source = ev-2, ev-1; confidence 0.86' },
  { at: '2026-10-24T09:14:41Z', event: 'trust:init', detail: 'Initial trust 0.60 (critic-verified, 2 evidence rows)' },
  { at: '2026-10-24T09:20:13Z', event: 'recalled', detail: 'Retrieved for "Why did Walmart outgrow Target?" (score 0.88)' },
  { at: '2026-10-24T09:21:02Z', event: 'feedback:helpful', detail: 'Analyst rated helpful; trust 0.60 to 0.72' },
];

async function j<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, init);
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
    const r = await j<Summary[] | { investigations: Summary[] }>('/api/investigations');
    return Array.isArray(r) ? r : r.investigations ?? [];
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
    const r = await j<AuditEntry[] | { entries: AuditEntry[] }>(`/api/memory/${encodeURIComponent(id)}/audit`);
    return Array.isArray(r) ? r : r.entries ?? [];
  },
  async feedback(id: string, verdict: 'helpful' | 'unhelpful'): Promise<void> {
    if (MOCK) return;
    await j(`/api/memory/${encodeURIComponent(id)}/feedback`, post({ verdict }));
  },
};

const TYPES = ['contract', 'recall', 'hypothesis', 'query_started', 'evidence', 'query_failed', 'thinking', 'verdict', 'answer', 'remembered', 'done', 'error'] as const;

/** Opens the SSE stream (or the mock replay). Returns a close function. */
export function openStream(id: string, onEvent: (e: InvestigationEvent) => void, onLost: (msg: string) => void): () => void {
  if (MOCK) {
    const timers = MOCK_EVENTS.map(({ t, event }) => window.setTimeout(() => onEvent(event), t / SPEED));
    return () => timers.forEach(clearTimeout);
  }
  const es = new EventSource(`/api/investigations/${encodeURIComponent(id)}/events`);
  let finished = false;
  for (const type of TYPES) {
    es.addEventListener(type, (m: MessageEvent) => {
      try {
        const raw = JSON.parse(m.data) as { type?: string };
        onEvent((raw.type ? raw : { ...raw, type }) as InvestigationEvent);
        if (type === 'done' || type === 'error') { finished = true; es.close(); }
      } catch { /* ignore malformed frame */ }
    });
  }
  es.onerror = () => {
    if (finished) return;
    es.close();
    onLost('Lost connection to the Causa server. Reopen this investigation from History to resume.');
  };
  return () => es.close();
}
