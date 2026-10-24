import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../src/index';
import { InvestigationStore } from '../src/store';
import { createFakeLLM } from '../src/llm/fake';
import type { IntentEngine, InvestigationEvent, MemoryService, ZetarisClient } from '../src/types';

// ---------- in-file doubles ----------
const zetaris: ZetarisClient = {
  async health() { return { ok: true, detail: 'zetaris double' }; },
  async catalog() {
    return [{ fqName: 'SEC_DATA.edgar.retail_revenue', origin: 'rest', columns: [{ name: 'company', type: 'string' }, { name: 'fiscal_year', type: 'int' }, { name: 'revenue_usd_m', type: 'double' }] }];
  },
  async query(sql) {
    return { queryId: 'q-1', sql, columns: ['company', 'fiscal_year', 'revenue_usd_m'], rows: [['TARGET', 2021, '106005'], ['TARGET', 2022, '109120']], rowCount: 2, elapsedMs: 3, source: ['SEC_DATA.edgar.retail_revenue'] };
  },
};
const feedbackCalls: { id: string; verdict: string }[] = [];
const memory: MemoryService = {
  async recall() { return []; },
  async remember() { return 'm-1'; },
  async feedback(id, verdict) { feedbackCalls.push({ id, verdict }); },
  async audit(id) { return [{ at: '2026-10-24T00:00:00Z', event: 'created', detail: `fact ${id}` }]; },
};
const intent: IntentEngine = {
  async analyze() { return { intent: 'explain_metric_change', entities: ['Target'], metrics: ['revenue'], risk: 'low', riskReasons: [] }; },
  issueContract(i) {
    return { id: 'c-1', intent: i, allowedTools: ['zetaris.catalog', 'zetaris.query', 'memory.recall', 'memory.remember'], budget: { maxQueries: 10, maxLlmCalls: 30, maxSeconds: 60 }, stopConditions: [], signature: 's', issuedAt: new Date().toISOString() };
  },
  verifyContract() { return true; },
};

function setup() {
  const store = new InvestigationStore({ dir: null });
  const app = createApp({ store, deps: { llm: createFakeLLM(), zetaris, memory, intent } });
  return { store, app };
}

function parseSse(text: string): { event: string; data: any }[] {
  return text
    .split('\n\n')
    .map((block) => {
      const event = block.match(/^event: (.*)$/m)?.[1];
      const data = block.match(/^data: (.*)$/m)?.[1];
      return event && data ? { event, data: JSON.parse(data) } : undefined;
    })
    .filter((x): x is { event: string; data: any } => !!x);
}

describe('HTTP API', () => {
  it('SSE replays already-emitted events to a late subscriber, then streams live ones and closes after done', async () => {
    const { store, app } = setup();
    const inv = store.create('Why did Target lag Walmart?');
    const early: InvestigationEvent[] = [
      { type: 'thinking', text: 'first' },
      { type: 'recall', hits: [] },
    ];
    for (const e of early) store.append(inv.id, e);
    const res = await app.request(`/api/investigations/${inv.id}/events`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/text\/event-stream/);
    setTimeout(() => {
      store.append(inv.id, { type: 'thinking', text: 'late' });
      inv.status = 'done';
      store.append(inv.id, { type: 'done', investigation: inv });
    }, 30);
    const events = parseSse(await res.text()); // resolves only if the server closes the stream
    expect(events.map((e) => e.event)).toEqual(['thinking', 'recall', 'thinking', 'done']);
    expect(events[0].data.text).toBe('first');
    expect(events[2].data.text).toBe('late');
  });

  it('a finished investigation replays everything and closes; Last-Event-ID at the end gets 204', async () => {
    const { store, app } = setup();
    const inv = store.create('q?');
    store.append(inv.id, { type: 'error', message: 'boom' });
    const res = await app.request(`/api/investigations/${inv.id}/events`);
    const events = parseSse(await res.text());
    expect(events.map((e) => e.event)).toEqual(['error']);
    const again = await app.request(`/api/investigations/${inv.id}/events`, { headers: { 'Last-Event-ID': '0' } });
    expect(again.status).toBe(204);
  });

  it('POST starts a run that completes; GET returns it and the list summarizes it', async () => {
    const { app } = setup();
    const post = await app.request('/api/investigations', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'http://localhost:5173' },
      body: JSON.stringify({ question: 'Why did Target revenue growth lag Walmart after 2021?' }),
    });
    expect(post.status).toBe(201);
    expect(post.headers.get('access-control-allow-origin')).toBe('http://localhost:5173');
    const { id } = await post.json();
    const sse = parseSse(await (await app.request(`/api/investigations/${id}/events`)).text());
    expect(sse[0].event).toBe('contract');
    expect(sse.at(-1)!.event).toBe('done');
    const inv = await (await app.request(`/api/investigations/${id}`)).json();
    expect(inv.status).toBe('done');
    expect(inv.answer.claims.length).toBeGreaterThan(0);
    const list = await (await app.request('/api/investigations')).json();
    expect(list[0]).toMatchObject({ id, status: 'done' });
  });

  it('validates input and 404s unknown ids', async () => {
    const { app } = setup();
    expect((await app.request('/api/investigations', { method: 'POST', body: JSON.stringify({}), headers: { 'content-type': 'application/json' } })).status).toBe(400);
    expect((await app.request('/api/investigations/nope')).status).toBe(404);
    expect((await app.request('/api/investigations/nope/events')).status).toBe(404);
    expect((await app.request('/api/memory/m-1/feedback', { method: 'POST', body: JSON.stringify({ verdict: 'meh' }), headers: { 'content-type': 'application/json' } })).status).toBe(400);
  });

  it('memory audit/feedback, catalog and health are proxied', async () => {
    const { app } = setup();
    const audit = await (await app.request('/api/memory/m-9/audit')).json();
    expect(audit[0].detail).toBe('fact m-9');
    const fb = await app.request('/api/memory/m-9/feedback', { method: 'POST', body: JSON.stringify({ verdict: 'helpful' }), headers: { 'content-type': 'application/json' } });
    expect(fb.status).toBe(200);
    expect(feedbackCalls.at(-1)).toEqual({ id: 'm-9', verdict: 'helpful' });
    const cat = await (await app.request('/api/catalog')).json();
    expect(cat[0].fqName).toBe('SEC_DATA.edgar.retail_revenue');
    const health = await (await app.request('/api/health')).json();
    expect(health.zetaris).toEqual({ ok: true, detail: 'zetaris double' });
    expect(health.llm.ok).toBe(true);
    expect(health.memory.ok).toBe(true);
  });
});

describe('InvestigationStore persistence', () => {
  it('persists investigations + events as JSON and reloads them; interrupted runs become failed', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'causa-store-'));
    try {
      const s1 = await InvestigationStore.open(dir);
      const a = s1.create('done one');
      s1.append(a.id, { type: 'thinking', text: 'x' });
      a.status = 'done';
      s1.append(a.id, { type: 'done', investigation: a });
      const b = s1.create('interrupted');
      s1.append(b.id, { type: 'thinking', text: 'y' });
      await s1.flush();
      const s2 = await InvestigationStore.open(dir);
      expect(s2.get(a.id)!.status).toBe('done');
      expect(s2.events(a.id).map((e) => e.type)).toEqual(['thinking', 'done']);
      expect(s2.get(b.id)!.status).toBe('failed');
      expect(s2.events(b.id).at(-1)!.type).toBe('error');
      const c = s2.create('next');
      expect(c.id).not.toBe(a.id);
      expect(c.id).not.toBe(b.id);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
