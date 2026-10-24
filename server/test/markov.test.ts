import { describe, it, expect } from 'vitest';
import { createMarkovian } from '../src/markov/index';

const env = { CAUSA_FAKE: '1' } as NodeJS.ProcessEnv;
const bigResult = (i: number) =>
  `Step ${i} query result: ` + `revenue row cik=${1000 + i} value=${i * 1234567} fiscal_year=${2000 + (i % 24)}; `.repeat(60);

describe('Markovian context bounding', () => {
  it('carried state stays under the engine bound over 30 steps while naive history grows', async () => {
    const m = createMarkovian(env);
    m.begin('Why did Target revenue growth lag Walmart after 2021?');
    const bound = m.config.carryoverTokens;
    const naive: number[] = [];
    const bounded: number[] = [];
    for (let i = 1; i <= 30; i++) {
      const r = await m.step({ kind: 'tool_result', text: bigResult(i), note: i % 5 === 0 ? `Decision: hypothesis h-${i} supported; Next: test peers` : undefined });
      expect(r.tokensCarried).toBeLessThanOrEqual(bound);
      expect(r.carriedState.length).toBeGreaterThan(0);
      naive.push(r.tokensNaive);
      bounded.push(r.tokensBounded);
    }
    for (let i = 1; i < naive.length; i++) expect(naive[i]).toBeGreaterThan(naive[i - 1]);
    expect(Math.max(...bounded.slice(5))).toBeLessThanOrEqual(Math.min(...bounded.slice(5)) + bound);
    expect(bounded[29]).toBeLessThan(naive[29] / 5);
  });

  it('stats report both numbers and the cascade level used', async () => {
    const m = createMarkovian(env);
    m.begin('goal');
    await m.step({ kind: 'tool_result', text: bigResult(1) });
    await m.step({ kind: 'note', text: 'x', state: 'COMPLETED: queried revenue\nREMAINING: compare peers\nDECISIONS: none\nCONTEXT: retail' });
    const s = m.stats();
    expect(s.steps).toBe(2);
    expect(s.perStep).toHaveLength(2);
    expect(s.totalBounded).toBeGreaterThan(0);
    expect(s.totalNaive).toBeGreaterThan(0);
    expect(s.perStep[1].level).toBe('marker');
    expect(s.label).toBe('estimated');
    expect(typeof s.efficiencyPercent).toBe('number');
  });

  it('uses the injected LLM compressor when provided and falls back when it fails', async () => {
    let calls = 0;
    const m = createMarkovian(env, {
      compressor: async () => {
        calls++;
        if (calls === 2) throw new Error('boom');
        return 'COMPLETED: a lot of things\nREMAINING: few\nDECISIONS: d\nCONTEXT: c';
      },
    });
    m.begin('goal');
    const a = await m.step({ kind: 'tool_result', text: 'plain text without key phrases '.repeat(50) });
    const b = await m.step({ kind: 'tool_result', text: 'Status: more work done. ' + 'filler '.repeat(50) });
    expect(a.level).toBe('llm');
    expect(b.level).toBe('heuristic');
  });
});
