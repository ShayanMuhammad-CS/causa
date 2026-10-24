import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createWorldModel } from '../src/world/index';

let dir: string;
const env = () => ({ CAUSA_WORLD_DIR: dir }) as NodeJS.ProcessEnv;
const prov = { investigationId: 'inv-1', evidenceId: 'ev-1', queryId: 'q-34', at: '2026-10-01T10:00:00.000Z' };

beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'causa-world-')); });
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

async function seeded() {
  const w = createWorldModel(env());
  await w.observeCompany({ cik: '104169', name: 'Walmart Inc.', ticker: 'WMT', sic: '5331', peerGroup: 'US general retail' }, prov);
  await w.observeCompany({ cik: '27419', name: 'Target Corporation', ticker: 'TGT', sic: '5331', peerGroup: 'US general retail' }, prov);
  return w;
}

describe('World Model service', () => {
  it('resolveEntity returns null for an unknown company (the agent cannot invent companies)', async () => {
    const w = await seeded();
    expect(w.resolveEntity('Initech Holdings')).toBeNull();
    expect(w.resolveEntity('')).toBeNull();
    expect(w.resolveEntity('Walmart')?.cik).toBe('0000104169');
    expect(w.resolveEntity('tgt')?.name).toBe('Target Corporation');
    expect(w.resolveEntity('27419')?.ticker).toBe('TGT');
  });

  it('metric observation keeps provenance and an event trail', async () => {
    const w = await seeded();
    const wmt = w.resolveEntity('WMT')!;
    await w.observeMetric(wmt.id, 'Revenue', 'FY2023', 611_289_000_000, prov, { unit: 'USD' });
    await w.observeMetric(wmt.id, 'Revenue', 'FY2023', 611_300_000_000, { ...prov, evidenceId: 'ev-9', at: '2026-10-01T11:00:00.000Z' }, { unit: 'USD' });

    const facts = w.factsFor(wmt.id);
    expect(facts).toHaveLength(2);
    const first = facts.find((f) => f.provenance.evidenceId === 'ev-1')!;
    expect(first).toMatchObject({ metric: 'Revenue', period: 'FY2023', value: 611_289_000_000, unit: 'USD', superseded: true });
    expect(first.provenance).toMatchObject({ investigationId: 'inv-1', queryId: 'q-34', evidenceId: 'ev-1' });
    expect(facts.find((f) => f.provenance.evidenceId === 'ev-9')!.superseded).toBe(false);
    expect(w.currentMetric(wmt.id, 'Revenue', 'FY2023')?.value).toBe(611_300_000_000);

    const trail = w.history(wmt.id);
    expect(trail.map((t) => t.kind)).toEqual(expect.arrayContaining(['upsertEntity', 'assertFact']));
    expect(trail.filter((t) => t.kind === 'assertFact')).toHaveLength(2);
    expect(trail.every((t) => t.provenance.investigationId === 'inv-1')).toBe(true);
  });

  it('rejects metrics for entities that do not exist', async () => {
    const w = await seeded();
    await expect(w.observeMetric('company:sec-cik:0000999999', 'Revenue', 'FY2023', 1, prov)).rejects.toThrow(/unknown entity/i);
  });

  it('records hypotheses and findings linked to evidence', async () => {
    const w = await seeded();
    const tgt = w.resolveEntity('Target')!;
    await w.observeHypothesis('inv-1', { id: 'h-1', statement: 'Target lagged on grocery mix', status: 'open', evidenceIds: [], companyIds: [tgt.id] }, prov);
    await w.observeHypothesis('inv-1', { id: 'h-1', statement: 'Target lagged on grocery mix', status: 'supported', evidenceIds: ['ev-1', 'ev-2'], companyIds: [tgt.id] }, prov);
    await w.observeFinding('inv-1', { id: 'f-1', text: 'Grocery mix explains the gap', confidence: 'high', evidenceIds: ['ev-1', 'ev-2'], hypothesisIds: ['h-1'], verified: true }, prov);
    const trail = w.history('hypothesis:causa:inv-1/h-1');
    expect(trail.filter((t) => t.kind === 'upsertEntity')).toHaveLength(2);
    const snap = w.snapshot();
    expect(snap.counts).toMatchObject({ company: 2, hypothesis: 1, finding: 1, evidence: 2 });
    expect(w.evidenceFor('finding:causa:inv-1/f-1').sort()).toEqual(['ev-1', 'ev-2']);
  });

  it('persists across two instances', async () => {
    const a = await seeded();
    const wmt = a.resolveEntity('WMT')!;
    await a.observeMetric(wmt.id, 'Revenue', 'FY2022', 572_754_000_000, prov, { unit: 'USD' });
    const b = createWorldModel(env());
    expect(b.resolveEntity('Walmart')?.id).toBe(wmt.id);
    expect(b.currentMetric(wmt.id, 'Revenue', 'FY2022')?.provenance.evidenceId).toBe('ev-1');
    expect(b.history(wmt.id).length).toBe(a.history(wmt.id).length);
  });

  it('CAUSA_FAKE=1 uses a temp dir, not server/.world', () => {
    const w = createWorldModel({ CAUSA_FAKE: '1' } as NodeJS.ProcessEnv);
    expect(w.dir.startsWith(os.tmpdir())).toBe(true);
    fs.rmSync(w.dir, { recursive: true, force: true });
  });
});
