// End to end: the real HTTP server (node-server on an ephemeral port) wired by buildDeps in SAMPLE_MODE with no
// Nightshift credentials, streaming an investigation over SSE to `done`.
import { describe, it, expect, afterAll } from 'vitest';
import type { AddressInfo } from 'node:net';
import { serve } from '@hono/node-server';
import { createApp } from '../src/index';
import { InvestigationStore } from '../src/store';
import { buildDeps } from '../src/wiring';

let close: (() => void) | undefined;
afterAll(() => close?.());

describe('e2e: SAMPLE_MODE HTTP app', () => {
  it('POST a question, stream SSE to done, then read the World Model history of a grounded company', async () => {
    const deps = await buildDeps({ SAMPLE_MODE: 'true' } as NodeJS.ProcessEnv);
    expect(deps.modelMode).toBe('sample-analyst');
    const app = createApp({ store: new InvestigationStore(), deps, agentConfig: deps.agentConfig });
    const server = serve({ fetch: app.fetch, port: 0 });
    close = () => server.close();
    await new Promise((r) => server.once('listening', r));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    const post = await fetch(`${base}/api/investigations`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ question: "Why did Target's revenue growth lag Walmart's from FY2022 to FY2024?" }),
    });
    expect(post.status).toBe(201);
    const { id } = (await post.json()) as { id: string };
    const sse = await (await fetch(`${base}/api/investigations/${id}/events`)).text();
    const events = sse.split('\n\n').map((b) => b.match(/^event: (.*)$/m)?.[1]).filter(Boolean) as string[];
    expect(events[0]).toBe('contract');
    expect(events.at(-1)).toBe('done');
    for (const t of ['world', 'hypothesis', 'evidence', 'markov', 'model_call', 'verdict', 'answer']) expect(events).toContain(t);

    const inv = (await (await fetch(`${base}/api/investigations/${id}`)).json()) as any;
    expect(inv.status).toBe('done');
    expect(inv.answer.claims.filter((c: any) => c.verified).length).toBeGreaterThanOrEqual(2);
    expect(inv.answer.models).toEqual(['causa/sample-analyst']);

    const tgt = 'company:sec-cik:0000027419';
    const hist = (await (await fetch(`${base}/api/world/${encodeURIComponent(tgt)}/history`)).json()) as any;
    expect(hist.entity.ticker).toBe('TGT');
    expect(hist.history.some((h: any) => h.kind === 'assertFact' && h.provenance.investigationId === id && h.provenance.queryId)).toBe(true);
    expect(hist.facts.some((f: any) => f.metric === 'Revenue')).toBe(true);
    expect((await fetch(`${base}/api/world/company:sec-cik:0000000001/history`)).status).toBe(404);
  }, 90_000);
});
