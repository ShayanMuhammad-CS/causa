import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createMemoryService } from '../src/memory/index';

let dir: string;
const env = () => ({ CAUSA_HMEM_DIR: dir }) as NodeJS.ProcessEnv;

beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'causa-hmem-')); });
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

describe('H-MEM memory service', () => {
  it('persists across two service instances', async () => {
    const a = await createMemoryService(env());
    const id = await a.remember('Walmart revenue growth beat Target after 2021 because of grocery mix', {
      source: 'investigation:12/ev-1', confidence: 0.9, derivedFrom: ['ev-1', 'ev-2'],
    });
    const b = await createMemoryService(env());
    const hits = await b.recall('Why did Walmart revenue growth beat Target?');
    expect(hits.map((h) => h.id)).toContain(id);
    const hit = hits.find((h) => h.id === id)!;
    expect(hit.provenance).toEqual({ source: 'investigation:12/ev-1', confidence: 0.9, derivedFrom: ['ev-1', 'ev-2'] });
    // ids keep counting after reload (no collision)
    const id2 = await b.remember('Ford slowdown is sector-wide per SIC peers', { source: 'investigation:13/ev-3', confidence: 0.8 });
    expect(id2).not.toBe(id);
  });

  it('recall ranks the relevant memory first', async () => {
    const m = await createMemoryService(env());
    await m.remember('CPI inflation peaked in June 2022 at 9.1 percent', { source: 'sql:q-1', confidence: 0.8 });
    const target = await m.remember('Ford revenue slowdown after 2021 is company-specific, EV losses and recalls', { source: 'sql:q-2', confidence: 0.8 });
    await m.remember('Home Depot SIC code is 5211 building materials retail', { source: 'sql:q-3', confidence: 0.8 });
    const hits = await m.recall('Is the Ford revenue slowdown company-specific?', 3);
    expect(hits[0].id).toBe(target);
    expect(hits[0].score).toBeGreaterThan(0);
    for (let i = 1; i < hits.length; i++) expect(hits[i - 1].score).toBeGreaterThanOrEqual(hits[i].score);
  });

  it('audit shows the remember event', async () => {
    const m = await createMemoryService(env());
    const id = await m.remember('Target comparable sales fell in 2023', { source: 'sql:q-9', confidence: 0.7 });
    const log = await m.audit(id);
    expect(log[0].event).toBe('create');
    expect(log[0].detail).toContain('sql:q-9');
    expect(Number.isNaN(Date.parse(log[0].at))).toBe(false);
    expect(await m.audit('mem-does-not-exist')).toEqual([]);
  });

  it('records feedback with deltas, audit and a changed confidence', async () => {
    const m = await createMemoryService(env());
    const id = await m.remember('Walmart grocery share rose', { source: 'sql:q-4', confidence: 0.7 });
    await m.feedback(id, 'helpful');
    await m.feedback(id, 'unhelpful');
    const log = await m.audit(id);
    const fb = log.filter((e) => e.event === 'feedback');
    expect(fb).toHaveLength(2);
    expect(fb[0].detail).toContain('helpful');
    const [hit] = await m.recall('Walmart grocery share', 1);
    expect(hit.provenance.confidence).toBeCloseTo(0.7 + 0.05 - 0.03, 5);
  });

  it('rejects feedback for unknown ids and exposes sleepPreview', async () => {
    const m = await createMemoryService(env());
    await expect(m.feedback('mem-99', 'helpful')).rejects.toThrow();
    const p = m.sleepPreview();
    expect(p).toHaveProperty('toConsolidate');
  });

  it('CAUSA_FAKE=1 uses the real engine on a temp dir, not .hmem', async () => {
    const m = await createMemoryService({ CAUSA_FAKE: '1' } as NodeJS.ProcessEnv);
    const id = await m.remember('fake mode still real engine', { source: 'test', confidence: 0.6 });
    expect((await m.audit(id))[0].event).toBe('create');
    expect(m.dir.startsWith(os.tmpdir())).toBe(true);
  });
});
