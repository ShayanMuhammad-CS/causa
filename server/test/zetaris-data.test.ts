import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { loadTagsUsed } from '../../data/generate-sql.js';
import { generate } from '../../data/lib/sqlgen.js';
import { COMPANIES, CONCEPTS } from '../../data/lib/sources.js';
import { fiscalYear, isAnnualFact, normalizeFinancials, type RawFact } from '../../data/lib/normalize.js';
import { applyUserAgent, splitStatements } from '../../data/lib/split.js';
import { buildPlan, main } from '../../data/run-onboarding.js';
import { FakeZetarisClient } from '../src/zetaris/fake.js';
import { ZetarisGuardError } from '../src/zetaris/errors.js';
import { guardSql } from '../src/zetaris/guard.js';
import { TABLES } from '../src/zetaris/schema.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.resolve(here, '../../data');
const fixtures = path.resolve(here, '../fixtures/zetaris');
const gen = generate(loadTagsUsed());

describe('splitStatements (port of zetaris_sql.split_statements)', () => {
  it('splits on semicolons outside quotes and drops comments', () => {
    expect(splitStatements("SELECT 'a;b'; -- c;d\nSELECT 2 /* ; */;")).toEqual(["SELECT 'a;b'", 'SELECT 2']);
  });
  it('keeps a multi-table COMPILE USL whole', () => {
    const s = splitStatements('COMPILE USL x DEPLOY NAMESPACE n DDL CREATE TABLE a (b INT);\nCREATE TABLE c (d INT);\nSELECT 1;');
    expect(s).toHaveLength(2);
    expect(s[0]).toContain('CREATE TABLE c');
  });
  it('applyUserAgent fills the placeholder and refuses vague values', () => {
    const st = ['CREATE x HEADER (user-agent "YOUR_APP_NAME YOUR_CONTACT_EMAIL")'];
    expect(applyUserAgent(st, 'Causa a@b.co')[0]).toContain('"Causa a@b.co"');
    expect(() => applyUserAgent(st, undefined)).toThrow(/placeholder/);
    expect(() => applyUserAgent(st, 'vague')).toThrow(/identify/);
    expect(() => applyUserAgent(st, 'a "b" c@d.io')).toThrow(/quotes/);
  });
});

describe('generated onboarding SQL', () => {
  it('committed data/sql files equal a fresh generation (no drift)', () => {
    for (const f of gen.files) expect(readFileSync(path.join(dataDir, 'sql', f.name), 'utf8'), f.name).toBe(f.content);
  });

  it('is numbered, one statement per call, and flagged unverified', () => {
    const plan = buildPlan(path.join(dataDir, 'sql'));
    expect(plan.map((p) => p.file.slice(0, 2))).toEqual(['00', '10', '20', '21', '30', '40', '50', '60', '70']);
    for (const f of gen.files) expect(f.content).toContain('UNVERIFIED');
    const comp = plan.find((p) => p.file.startsWith('60'))!.statements.filter((s) => s.startsWith('COMPILE USL'));
    expect(comp).toHaveLength(1);
    expect(comp[0]).toContain('CREATE TABLE company');
    expect(comp[0]).toContain('CREATE TABLE sic_code');
    for (const p of plan) for (const s of p.statements) expect(s.replace(/'[^']*'/g, '').includes(';') && !s.startsWith('COMPILE USL'), `${p.file}: ${s.slice(0, 60)}`).toBe(false);
  });

  it('every DDL statement is refused by the agent-side guard; only step 70 is read-only', () => {
    for (const p of buildPlan(path.join(dataDir, 'sql'))) {
      for (const s of p.statements) {
        const readOnly = p.file.startsWith('70');
        if (readOnly) expect(() => guardSql(s), s).not.toThrow();
        else expect(() => guardSql(s), s.slice(0, 80)).toThrow(ZetarisGuardError);
      }
    }
  });

  it('creates one raw table per company+tag actually used, plus one submissions table per company', () => {
    const used = Object.values(loadTagsUsed()).flatMap((m) => Object.values(m).flat()).length;
    expect(gen.rawTables.filter((r) => r.db === 'SEC_DATA')).toHaveLength(used + COMPANIES.length);
    for (const r of gen.rawTables) expect(r.endpoint).toMatch(/^https:\/\//);
    expect(JSON.parse(readFileSync(path.join(fixtures, 'raw_tables.json'), 'utf8'))).toEqual(gen.rawTables);
  });

  it('final view column lists match the catalog definitions (names and order)', () => {
    const sql = gen.files.find((f) => f.name.startsWith('40'))!.content;
    const fin = TABLES.find((t) => t.fqName === 'edgar.company_financials')!.columns.map((c) => c.name).join(', ');
    expect(sql).toContain(`CREATE SCHEMASTORE VIEW company_financials WITH CONTAINER edgar AS\nSELECT ${fin}\n`);
    const prof = TABLES.find((t) => t.fqName === 'edgar.company_profile')!.columns.map((c) => c.name);
    const block = /CREATE SCHEMASTORE VIEW company_profile[\s\S]*?FROM \(/.exec(sql)![0];
    expect([...block.matchAll(/ AS (\w+),?\n/g)].map((m) => m[1])).toEqual(prof);
  });

  it('instant concepts never select the (absent) start field; flow concepts filter the duration', () => {
    const sql = gen.files.find((f) => f.name.startsWith('30'))!.content;
    const inv = sql.split('\n\n').filter((b) => b.includes("'inventory' AS concept"));
    expect(inv.length).toBeGreaterThan(0);
    for (const b of inv) { expect(b).toContain('CAST(NULL AS STRING) AS period_start'); expect(b).not.toContain('datediff'); }
    const rev = sql.split('\n\n').find((b) => b.includes("'revenue' AS concept"))!;
    expect(rev).toContain('BETWEEN 350 AND 380');
  });

  it('World Bank step documents the top-level-array risk and a CSV fallback exists', () => {
    const sql = gen.files.find((f) => f.name.startsWith('50'))!.content;
    expect(sql).toMatch(/TOP-LEVEL JSON ARRAY/);
    expect(readFileSync(path.join(dataDir, 'csv/us_macro_indicators.csv'), 'utf8').split('\n')[0]).toBe('country_code,indicator_id,indicator_name,year,value');
  });

  it('fake SHOW LIGHTNING TABLES mirrors the raw tables the SQL creates', async () => {
    const r = await new FakeZetarisClient().query('SHOW LIGHTNING TABLES SEC_DATA');
    expect(r.rowCount).toBe(gen.rawTables.filter((x) => x.db === 'SEC_DATA').length);
  });
});

describe('runner', () => {
  it('dry-run (the default) prints statements and sends nothing', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const code = await main(['--only', '00']);
    expect(code).toBe(0);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(log.mock.calls.map((c) => c[0]).join('\n')).toContain('CREATE LIGHTNING DATABASE SEC_DATA');
    expect(log.mock.calls.map((c) => c[0]).join('\n')).toContain('dry run, nothing sent');
    vi.restoreAllMocks();
  });
  it('--apply without credentials fails before sending anything', async () => {
    const saved = { ...process.env };
    delete process.env.ZETARIS_API_KEY; delete process.env.ZETARIS_ORG_ID;
    process.env.ZETARIS_USER_AGENT = 'Causa a@b.co';
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    await expect(main(['--apply', '--only', '00'])).rejects.toThrow(/ZETARIS_API_KEY/);
    expect(fetchSpy).not.toHaveBeenCalled();
    process.env = saved;
    vi.restoreAllMocks();
  });
});

describe('normalisation rules (mirror of the SQL views)', () => {
  const f = (o: Partial<RawFact>): RawFact => ({ start: '2022-01-30', end: '2023-01-28', val: 1, accn: 'a', fy: 2023, fp: 'FY', form: '10-K', filed: '2023-03-01', ...o });
  const co = COMPANIES.find((c) => c.ticker === 'TGT')!;

  it('fiscal_year = YEAR(period_end - 45 days): Jan/Feb year ends map to the prior calendar year', () => {
    expect(fiscalYear('2023-01-28')).toBe(2022);
    expect(fiscalYear('2024-02-03')).toBe(2023);
    expect(fiscalYear('2023-12-31')).toBe(2023);
    expect(fiscalYear('2023-09-30')).toBe(2023);
  });
  it('keeps only full-year 10-K facts; instant concepts need no start', () => {
    expect(isAnnualFact(f({}), false)).toBe(true);
    expect(isAnnualFact(f({ form: '10-Q' }), false)).toBe(false);
    expect(isAnnualFact(f({ fp: 'Q3' }), false)).toBe(false);
    expect(isAnnualFact(f({ start: '2022-10-30' }), false)).toBe(false); // quarter inside a 10-K
    expect(isAnnualFact(f({ start: undefined }), true)).toBe(true);
    expect(isAnnualFact(f({}), true)).toBe(false);
  });
  it('picks the higher-priority tag per period, then the latest filing (restatement)', () => {
    const rev = CONCEPTS.find((c) => c.key === 'revenue')!;
    const r = normalizeFinancials(co, 'Target Corp', {
      RevenueFromContractWithCustomerExcludingAssessedTax: [f({ val: 5 })],
      Revenues: [f({ val: 10, filed: '2023-03-01' }), f({ val: 11, filed: '2024-03-01', accn: 'later' })],
    }, [rev]);
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]).toMatchObject({ value_usd: 11, xbrl_tag: 'Revenues', accession_number: 'later', fiscal_year: 2022 });
  });
});

describe('fixtures are real, complete and internally consistent', () => {
  const fin = JSON.parse(readFileSync(path.join(fixtures, 'company_financials.json'), 'utf8')) as any[];
  const src = JSON.parse(readFileSync(path.join(fixtures, 'sources.json'), 'utf8'));

  it('covers all nine peers with annual revenue and unique (ticker, concept, fiscal_year)', () => {
    for (const co of COMPANIES) expect(fin.filter((r) => r.ticker === co.ticker && r.concept === 'revenue').length, co.ticker).toBeGreaterThanOrEqual(8);
    const keys = fin.map((r) => `${r.ticker}|${r.concept}|${r.fiscal_year}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
  it('records its provenance', () => {
    expect(src.fetchedAt).toMatch(/^20\d\d-/);
    expect(src.secUserAgent).toBe('Causa-hackathon causa.demo@example.com');
    expect(src.counts.company_financials).toBe(fin.length);
    expect(readFileSync(path.join(fixtures, 'README.md'), 'utf8')).toContain('data.sec.gov');
  });
  it('known facts: Walmart FY2022 revenue about $611B, Target about $109B', () => {
    const v = (t: string) => fin.find((r) => r.ticker === t && r.concept === 'revenue' && r.fiscal_year === 2022).value_usd;
    expect(v('WMT')).toBeGreaterThan(6.0e11); expect(v('WMT')).toBeLessThan(6.2e11);
    expect(v('TGT')).toBeGreaterThan(1.08e11); expect(v('TGT')).toBeLessThan(1.1e11);
  });
});
