// SAMPLE_MODE deterministic analyst over the REAL SEC EDGAR / World Bank fixtures (DuckDB): real SQL, numeric
// verdict rules, claims whose numbers come from the rows and pass the deterministic critic check.
import { describe, it, expect, beforeAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runInvestigation, newInvestigation } from '../src/agent';
import { createSampleAnalystLLM } from '../src/agent/analyst';
import { seedWorldFromCatalog } from '../src/agent/world';
import { checkClaimNumbers } from '../src/agent/numbers';
import { createIntentEngine } from '../src/intent/index';
import { FakeZetarisClient } from '../src/zetaris/fake';
import { createWorldModel, type WorldService } from '../src/world/index';
import type { Investigation, InvestigationEvent, MemoryService } from '../src/types';

const zetaris = new FakeZetarisClient();
let world: WorldService;
const memory: MemoryService = { async recall() { return []; }, async remember() { return 'm-1'; }, async feedback() {}, async audit() { return []; } };

beforeAll(async () => {
  world = createWorldModel({ CAUSA_WORLD_DIR: fs.mkdtempSync(path.join(os.tmpdir(), 'causa-analyst-')) } as NodeJS.ProcessEnv);
  const seeded = await seedWorldFromCatalog(world, zetaris);
  expect(seeded.length).toBeGreaterThanOrEqual(9);
}, 60_000);

async function ask(question: string) {
  const llm = createSampleAnalystLLM();
  const intent = createIntentEngine({ llm, secret: 'test', useLlm: false });
  const events: InvestigationEvent[] = [];
  const inv = newInvestigation(`inv-${Math.random().toString(36).slice(2, 7)}`, question);
  await runInvestigation({ investigation: inv, deps: { llm, zetaris, memory, intent, world }, emit: (e) => events.push(e) });
  return { inv, events };
}

function expectGroundedClaims(inv: Investigation) {
  const byId = new Map(inv.evidence.map((e) => [e.id, e]));
  expect(inv.answer!.claims.length).toBeGreaterThanOrEqual(2);
  for (const c of inv.answer!.claims) {
    expect(c.verified, `${c.text} :: ${c.criticNote}`).toBe(true);
    expect(c.evidenceIds.length).toBeGreaterThan(0);
    const det = checkClaimNumbers(c.text, c.evidenceIds.map((id) => ({ columns: byId.get(id)!.result.columns, rows: byId.get(id)!.result.rows })));
    expect(det.ok, `${c.text}: ${det.unsupported.join(',')}`).toBe(true);
    expect(det.checked).toBeGreaterThan(0);
  }
}

describe('sample analyst (SAMPLE_MODE without Nightshift)', () => {
  it("answers Target vs Walmart FY2022-FY2024: company-specific, not sector or macro, numbers from rows", async () => {
    const { inv, events } = await ask("Why did Target's revenue growth lag Walmart's from FY2022 to FY2024?");
    expect(inv.status).toBe('done');
    const w = events.find((e) => e.type === 'world') as Extract<InvestigationEvent, { type: 'world' }>;
    expect(w.entities.map((e) => e.ticker).sort()).toEqual(['TGT', 'WMT']);
    expect(w.entities.find((e) => e.ticker === 'TGT')!.cik).toBe('0000027419'); // from edgar.company_profile, not hard-coded
    expect(inv.evidence.some((e) => /LAG\(/i.test(e.result.sql))).toBe(true);
    expect(inv.evidence.some((e) => /us_macro_indicators/.test(e.result.sql))).toBe(true);
    const byLayer = (re: RegExp) => inv.hypotheses.find((h) => re.test(h.statement))!;
    expect(byLayer(/^Company-specific/).status).toBe('supported');
    expect(byLayer(/^Sector-wide/).status).toBe('refuted');
    expect(byLayer(/^Macro/).status).toBe('refuted');
    expectGroundedClaims(inv);
    const text = inv.answer!.claims.map((c) => c.text).join(' ');
    expect(text).toMatch(/\$109\.12B \(FY ending 2023-01-28\)/);
    expect(text).toMatch(/\$106\.57B \(FY ending 2025-02-01\)/);
    const mc = events.filter((e) => e.type === 'model_call') as Extract<InvestigationEvent, { type: 'model_call' }>[];
    expect(mc.length).toBeGreaterThan(0);
    expect(mc.every((e) => e.provider === 'sample')).toBe(true);
    expect(events.some((e) => e.type === 'markov')).toBe(true);
  }, 60_000);

  it('Ford slowdown is sector-wide (peers slowed too), from different rows than the retail question', async () => {
    const { inv } = await ask("Is Ford's revenue slowdown company-specific or sector-wide?");
    expect(inv.status).toBe('done');
    expect(inv.hypotheses.find((h) => /^Sector-wide/.test(h.statement))!.status).toBe('supported');
    expect(inv.hypotheses.find((h) => /^Company-specific/.test(h.statement))!.status).toBe('refuted');
    expectGroundedClaims(inv);
    expect(inv.answer!.claims.map((c) => c.text).join(' ')).toMatch(/Ford|\bF\b/);
  }, 60_000);

  it("Dollar General's margin squeeze is company-specific (SIC peers' margins held)", async () => {
    const { inv, events } = await ask("What explains Dollar General's margin squeeze?");
    expect(inv.status).toBe('done');
    // "General" inside "Dollar General" must not also ground General Motors
    expect((events.find((e) => e.type === 'world') as Extract<InvestigationEvent, { type: 'world' }>).entities.map((e) => e.ticker)).toEqual(['DG']);
    expect(inv.evidence.every((e) => !/'GM'/.test(e.result.sql))).toBe(true);
    expect(inv.hypotheses.find((h) => /^Company-specific/.test(h.statement))!.status).toBe('supported');
    expectGroundedClaims(inv);
    expect(inv.answer!.claims.map((c) => c.text).join(' ')).toMatch(/operating margin/i);
  }, 60_000);
});
