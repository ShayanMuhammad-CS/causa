import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { FakeZetarisClient, RestZetarisClient, ZetarisConfigError, ZetarisGuardError, ZetarisQueryError, createZetarisClient } from '../src/zetaris/index.js';
import { toDuckDb } from '../src/zetaris/fake.js';
import { TABLES } from '../src/zetaris/schema.js';

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../fixtures/zetaris');
const fixture = <T = any>(f: string): T[] => JSON.parse(readFileSync(path.join(dir, f), 'utf8'));
const fake = new FakeZetarisClient();

describe('fake client: real SQL over real fixtures', () => {
  it('computes revenue YoY for Target vs Walmart with a window function and matches an independent calculation', async () => {
    const r = await fake.query(`
      WITH rev AS (
        SELECT ticker, fiscal_year, value_usd,
               value_usd / LAG(value_usd) OVER (PARTITION BY ticker ORDER BY fiscal_year) - 1 AS yoy
        FROM edgar.company_financials
        WHERE concept = 'revenue' AND ticker IN ('TGT', 'WMT')
      )
      SELECT ticker, fiscal_year, round(yoy * 100, 2) AS yoy_pct
      FROM rev WHERE fiscal_year BETWEEN 2021 AND 2023
      ORDER BY fiscal_year, ticker`);
    expect(r.columns).toEqual(['ticker', 'fiscal_year', 'yoy_pct']);
    expect(r.rowCount).toBe(6);
    expect(r.source).toEqual(['edgar.company_financials']);

    const facts = fixture('company_financials.json').filter((f) => f.concept === 'revenue');
    const val = (t: string, y: number) => facts.find((f) => f.ticker === t && f.fiscal_year === y).value_usd as number;
    const expected = (t: string, y: number) => Math.round((val(t, y) / val(t, y - 1) - 1) * 10000) / 100;
    for (const [ticker, year, pct] of r.rows) {
      expect(typeof pct).toBe('number');
      expect(pct as number).toBeCloseTo(expected(ticker as string, year as number), 2);
    }
    // sanity on real-world facts: both retailers are above $100B in FY2022, Walmart far larger than Target
    expect(val('WMT', 2022)).toBeGreaterThan(5e11);
    expect(val('TGT', 2022)).toBeGreaterThan(1e11);
  });

  it('returns numbers as numbers and identifier-like columns as strings (REST parity)', async () => {
    const r = await fake.query("SELECT cik, sic_code, state_of_incorporation FROM edgar.company_profile WHERE ticker = 'TGT'");
    expect(r.rows).toEqual([['0000027419', '5331', 'MN']]);
    const n = await fake.query("SELECT cik, fiscal_year, value_usd FROM edgar.company_financials WHERE ticker = 'TGT' AND concept = 'revenue' AND fiscal_year = 2022");
    expect(n.rows[0]![0]).toBe('27419'); // cik is an identifier column: string in both modes
    expect(typeof n.rows[0]![2]).toBe('number');
  });

  it('answers the sector-wide vs company-specific question across SIC + EDGAR + macro sources', async () => {
    const r = await fake.query(`
      SELECT p.entity_name, p.sic_code, p.industry_group_desc, f.fiscal_year, f.value_usd, m.value AS cpi_pct
      FROM edgar.company_profile p
      JOIN edgar.company_financials f ON f.ticker = p.ticker AND f.concept = 'revenue'
      JOIN worldbank.us_macro_indicators m ON m.year = f.fiscal_year AND m.indicator_id = 'FP.CPI.TOTL.ZG'
      WHERE p.sic_code = '3711' AND f.fiscal_year = 2022
      ORDER BY p.entity_name`);
    expect(r.rows.map((x) => String(x[0]).toUpperCase())).toEqual(['FORD MOTOR CO', 'GENERAL MOTORS CO', 'TESLA, INC.']);
    expect(r.source.sort()).toEqual(['edgar.company_financials', 'edgar.company_profile', 'worldbank.us_macro_indicators']);
    expect(r.rows.every((x) => typeof x[5] === 'number' && (x[5] as number) > 7 && (x[5] as number) < 9)).toBe(true); // US CPI 2022 about 8%
  });

  it('supports Spark-style backticks, the four-part USL name and the SIC hierarchy join', async () => {
    const r = await fake.query('SELECT `ticker`, sic FROM lightning.metastore.usl_demo.sic_edgar_usl.company c JOIN lightning.metastore.usl_demo.sic_edgar_usl.sic_code s ON s.sic_code = c.sic ORDER BY `ticker`');
    expect(r.rowCount).toBe(9);
    expect(r.source).toEqual(expect.arrayContaining(['lightning.metastore.usl_demo.sic_edgar_usl.company']));
    expect(toDuckDb("SELECT `a b`, 'x`y' FROM t")).toBe('SELECT "a b", \'x`y\' FROM t');
  });

  it('enforces the LIMIT cap', async () => {
    expect((await fake.query('SELECT * FROM company_dns.sic_codes_v4_table')).rowCount).toBe(1000);
    expect((await fake.query('SELECT * FROM company_dns.sic_codes_v4_table', { limit: 7 })).rowCount).toBe(7);
    expect((await fake.query('SELECT * FROM company_dns.sic_codes_v4_table LIMIT 3')).rowCount).toBe(3);
  });

  it('rejects writes via the shared guard and cannot be used to read files', async () => {
    await expect(fake.query('DROP TABLE edgar.company_financials')).rejects.toBeInstanceOf(ZetarisGuardError);
    await expect(fake.query("SELECT * FROM read_csv('/etc/passwd')")).rejects.toBeInstanceOf(ZetarisGuardError);
    await expect(fake.query('SELECT 1; SELECT 2')).rejects.toBeInstanceOf(ZetarisGuardError);
    // table still intact
    expect((await fake.query('SELECT count(*) AS n FROM edgar.company_financials')).rows[0]![0]).toBeGreaterThan(500);
  });

  it('raises a typed ZetarisQueryError for bad SQL so the agent can retry with the message', async () => {
    const err = await fake.query('SELECT nope FROM edgar.company_financials').catch((e) => e);
    expect(err).toBeInstanceOf(ZetarisQueryError);
    expect(err.message).toMatch(/nope/);
    await expect(fake.query('SELECT * FROM edgar.not_a_table')).rejects.toBeInstanceOf(ZetarisQueryError);
  });

  it('serialises concurrent queries correctly', async () => {
    const results = await Promise.all([1, 2, 3, 4, 5].map((n) => fake.query(`SELECT ${n} AS n`)));
    expect(results.map((r) => r.rows[0]![0])).toEqual([1, 2, 3, 4, 5]);
  });
});

describe('fake client: catalog and metadata statements', () => {
  it('exposes every onboarded table with column descriptions', async () => {
    const cat = await fake.catalog();
    expect(cat.map((t) => t.fqName).sort()).toEqual(TABLES.map((t) => t.fqName).sort());
    for (const t of cat) {
      expect(t.description, t.fqName).toBeTruthy();
      expect(t.columns.length).toBeGreaterThan(2);
      for (const col of t.columns) expect(col.description, `${t.fqName}.${col.name}`).toBeTruthy();
    }
    expect(cat.find((t) => t.fqName === 'edgar.company_financials')!.columns.map((c) => c.name)).toContain('fiscal_year');
  });

  it('catalog columns match the live DuckDB tables (name and order)', async () => {
    for (const t of TABLES) {
      const real = await fake.query(`SELECT * FROM ${toDuckDbName(t.fqName)} LIMIT 1`);
      expect(real.columns, t.fqName).toEqual(t.columns.map((c) => c.name));
    }
  });

  it('emulates SHOW / DESCRIBE statements the agent uses for discovery', async () => {
    const dbs = await fake.query('SHOW LIGHTNING DATABASES');
    expect(dbs.rows.map((r) => r[0])).toEqual(expect.arrayContaining(['SEC_DATA', 'COMPANY_DNS']));
    const d = await fake.query('DESCRIBE edgar.company_financials');
    expect(d.rows.map((r) => r[0])).toContain('value_usd');
    expect(d.rows.find((r) => r[0] === 'value_usd')![1]).toBe('double');
    const views = await fake.query('SHOW DATASOURCE VIEWS');
    expect(views.rows.map((r) => r[0])).toContain('edgar.company_profile');
    await expect(fake.query('DESCRIBE edgar.nope')).rejects.toBeInstanceOf(ZetarisQueryError);
  });

  it('health reports the fixture date', async () => {
    const h = await fake.health();
    expect(h.ok).toBe(true);
    expect(h.detail).toMatch(/fixtures fetched 20\d\d-/);
  });
});

describe('createZetarisClient', () => {
  it('returns the fake client for CAUSA_FAKE=1', () => {
    expect(createZetarisClient({ CAUSA_FAKE: '1' } as NodeJS.ProcessEnv)).toBeInstanceOf(FakeZetarisClient);
  });
  it('returns the REST client when configured, and fails with a typed config error otherwise', () => {
    expect(createZetarisClient({ ZETARIS_API_KEY: 'k', ZETARIS_ORG_ID: '1' } as NodeJS.ProcessEnv)).toBeInstanceOf(RestZetarisClient);
    expect(() => createZetarisClient({} as NodeJS.ProcessEnv)).toThrow(ZetarisConfigError);
  });
});

function toDuckDbName(fq: string): string {
  return fq.replace(/^lightning\.metastore\.usl_demo\./, '');
}
