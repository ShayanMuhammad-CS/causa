import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ZetarisConfigError, ZetarisGuardError, ZetarisHttpError, ZetarisNetworkError, ZetarisQueryError, ZetarisTimeoutError,
} from '../src/zetaris/errors.js';
import { RestZetarisClient, deriveColumns, parsePayload, parseRows, restConfigFromEnv } from '../src/zetaris/rest.js';

interface Seen { method: string; url: string; headers: IncomingMessage['headers']; body: any }
type Responder = (seen: Seen, n: number) => { status?: number; json?: unknown; text?: string; delayMs?: number };

let server: Server;
let base: string;
let seen: Seen[];
let responder: Responder;

beforeEach(async () => {
  seen = [];
  responder = () => ({ json: { data: [] } });
  server = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const s: Seen = { method: req.method!, url: req.url!, headers: req.headers, body: raw ? JSON.parse(raw) : undefined };
      seen.push(s);
      const r = responder(s, seen.length);
      setTimeout(() => {
        res.statusCode = r.status ?? 200;
        res.setHeader('content-type', 'application/json');
        res.end(r.text ?? JSON.stringify(r.json ?? null));
      }, r.delayMs ?? 0);
    });
  });
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1.0`;
});
afterEach(async () => {
  server.closeAllConnections();
  await new Promise((ok) => server.close(ok));
});

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const client = (extra: Record<string, unknown> = {}) =>
  new RestZetarisClient({ baseUrl: base, apiKey: 'sekret-key', orgId: '7', backoffMs: () => 1, ...extra });

describe('RestZetarisClient.query: request shape', () => {
  it('POSTs /sql-editor/sqls/run with bearer key, numeric org id, UUID request id and the documented body', async () => {
    responder = () => ({ json: { data: [['1']] } });
    await client().query('SELECT 1 AS one', { limit: 50 });
    expect(seen).toHaveLength(1);
    const s = seen[0]!;
    expect(s.method).toBe('POST');
    expect(s.url).toBe('/api/v1.0/sql-editor/sqls/run');
    expect(s.headers.authorization).toBe('Bearer sekret-key');
    expect(s.headers['x-org-id']).toBe('7');
    expect(s.headers['x-request-id']).toMatch(UUID);
    expect(s.headers['content-type']).toBe('application/json');
    expect(Object.keys(s.body).sort()).toEqual(['limit', 'queryId', 'source', 'sql']);
    expect(s.body.queryId).toMatch(UUID);
    expect(s.body.source).toBe('SqlEditor');
    expect(s.body.limit).toBe(50);
    expect(s.body.sql).toBe('SELECT 1 AS one LIMIT 50'); // guard-enforced LIMIT, comments/semicolon stripped
  });

  it('returns the queryId that was sent, parsed numbers, derived column names and sources', async () => {
    responder = () => ({ json: { data: [['WMT', '2024', '6.8100000000E11', '0000104169'], ['TGT', '2024', '1.07412E11', '0000027419']] } });
    const r = await client().query('SELECT ticker, fiscal_year, value_usd AS revenue, cik FROM edgar.company_financials');
    expect(r.queryId).toBe(seen[0]!.body.queryId);
    expect(r.columns).toEqual(['ticker', 'fiscal_year', 'revenue', 'cik']);
    expect(r.rows[0]).toEqual(['WMT', 2024, 681000000000, '0000104169']);
    expect(r.rowCount).toBe(2);
    expect(r.source).toEqual(['edgar.company_financials']);
    expect(r.elapsedMs).toBeGreaterThanOrEqual(0);
  });

  it('refuses non-read-only SQL without touching the network', async () => {
    await expect(client().query('DROP TABLE edgar.company_financials')).rejects.toBeInstanceOf(ZetarisGuardError);
    await expect(client().query('SELECT 1; DELETE FROM t')).rejects.toBeInstanceOf(ZetarisGuardError);
    expect(seen).toHaveLength(0);
  });

  it('uses column metadata when the API provides it, and supports object rows', async () => {
    responder = () => ({ json: { columns: [{ name: 'a' }, { name: 'b' }], data: [['1', 'x']] } });
    expect((await client().query('SELECT * FROM t')).columns).toEqual(['a', 'b']);
    responder = () => ({ json: { data: [{ k: '2.5', v: 'z' }] } });
    const r = await client().query('SELECT * FROM t');
    expect(r.columns).toEqual(['k', 'v']);
    expect(r.rows).toEqual([[2.5, 'z']]);
  });
});

describe('RestZetarisClient: errors, retries, timeout', () => {
  it('retries 5xx twice (3 attempts) and then raises ZetarisHttpError', async () => {
    responder = () => ({ status: 503, text: 'upstream down' });
    const err = await client().query('SELECT 1').catch((e) => e);
    expect(err).toBeInstanceOf(ZetarisHttpError);
    expect(err.status).toBe(503);
    expect(seen).toHaveLength(3);
    expect(new Set(seen.map((s) => s.headers['x-request-id'])).size).toBe(3);
  });

  it('succeeds when a retry recovers', async () => {
    responder = (_s, n) => (n < 3 ? { status: 500, text: 'boom' } : { json: { data: [['1']] } });
    const r = await client().query('SELECT 1 AS one');
    expect(r.rows).toEqual([[1]]);
    expect(seen).toHaveLength(3);
  });

  it('does not retry 401, and never leaks the API key in the error', async () => {
    responder = () => ({ status: 401, text: 'unauthorized' });
    const err = await client().query('SELECT 1').catch((e) => e);
    expect(err).toBeInstanceOf(ZetarisHttpError);
    expect(err.status).toBe(401);
    expect(String(err.message)).not.toContain('sekret-key');
    expect(seen).toHaveLength(1);
  });

  it('maps 400 to ZetarisQueryError (feed back to the agent) without retry', async () => {
    responder = () => ({ status: 400, text: 'Table or view not found: edgar.nope' });
    const err = await client().query('SELECT * FROM edgar.nope').catch((e) => e);
    expect(err).toBeInstanceOf(ZetarisQueryError);
    expect(err.message).toContain('edgar.nope');
    expect(seen).toHaveLength(1);
  });

  it('times out with a typed error', async () => {
    responder = () => ({ json: { data: [] }, delayMs: 400 });
    await expect(client().query('SELECT 1', { timeoutMs: 50 })).rejects.toBeInstanceOf(ZetarisTimeoutError);
  });

  it('raises ZetarisNetworkError after retrying a dead endpoint', async () => {
    const dead = new RestZetarisClient({ baseUrl: 'http://127.0.0.1:1/api/v1.0', apiKey: 'k', orgId: '1', backoffMs: () => 1, timeoutMs: 2000 });
    await expect(dead.query('SELECT 1')).rejects.toBeInstanceOf(ZetarisNetworkError);
  });

  it('rejects a malformed body', async () => {
    responder = () => ({ json: { data: 'nope' } });
    await expect(client().query('SELECT 1')).rejects.toThrow(/no `data` array/);
  });
});

describe('RestZetarisClient.health', () => {
  it('GETs /datasource/datasources then runs SELECT 1', async () => {
    responder = (s) => (s.method === 'GET' ? { json: [{ name: 'a' }, { name: 'b' }] } : { json: { data: [['1']] } });
    const h = await client().health();
    expect(h.ok).toBe(true);
    expect(seen[0]).toMatchObject({ method: 'GET', url: '/api/v1.0/datasource/datasources' });
    expect(seen[0]!.headers.authorization).toBe('Bearer sekret-key');
    expect(seen[1]!.body.sql).toBe('SELECT 1 AS one');
    expect(h.detail).toContain('2 datasources');
  });
  it('reports failure instead of throwing', async () => {
    responder = () => ({ status: 401, text: 'no' });
    const h = await client().health();
    expect(h.ok).toBe(false);
    expect(h.detail).toContain('401');
  });
});

describe('RestZetarisClient.catalog', () => {
  it('discovers views and USL tables with one statement per call, hides raw REST tables by default', async () => {
    const answers: Record<string, unknown[][]> = {
      'SHOW LIGHTNING DATABASES': [['SEC_DATA', 'SEC EDGAR REST source', '1']],
      'SHOW LIGHTNING TABLES SEC_DATA': [['walmart_revenue_facts', 'REST', 'https://data.sec.gov/x', 'json', '9']],
      'SHOW DATASOURCE VIEWS': [['edgar.company_financials', 'sql', 'none']],
      'DESCRIBE edgar.company_financials': [['ticker', 'string', 'Ticker symbol'], ['value_usd', 'double', null]],
      'SHOW NAMESPACES OR TABLES IN lightning.metastore.usl_demo': [['sic_edgar_usl']],
      'SHOW NAMESPACES OR TABLES IN lightning.metastore.usl_demo.sic_edgar_usl': [['company', 'true']],
      'SHOW NAMESPACES OR TABLES IN lightning.metastore.usl_demo.sic_edgar_usl.company': [],
      'DESCRIBE lightning.metastore.usl_demo.sic_edgar_usl.company': [['cik', 'string', 'Zero padded CIK']],
    };
    responder = (s) => {
      const sql = (s.body.sql as string).replace(/ LIMIT \d+$/, '');
      if (!(sql in answers)) return { status: 400, text: `unexpected statement: ${sql}` };
      return { json: { data: answers[sql] } };
    };
    const cat = await client().catalog();
    const names = cat.map((t) => t.fqName).sort();
    expect(names).toEqual(['edgar.company_financials', 'lightning.metastore.usl_demo.sic_edgar_usl.company']);
    const view = cat.find((t) => t.fqName === 'edgar.company_financials')!;
    expect(view.origin).toBe('schemastore');
    // live description wins; missing ones are filled from Causa's annotations (schema.ts)
    expect(view.columns[0]).toEqual({ name: 'ticker', type: 'string', description: 'Ticker symbol' });
    expect(view.columns[1]).toMatchObject({ name: 'value_usd', type: 'double', description: expect.stringContaining('US dollars') });
    expect(cat.find((t) => t.origin === 'usl')!.columns[0]).toEqual({ name: 'cik', type: 'string', description: 'Zero padded CIK' });
    for (const s of seen) expect(s.body.sql.split(';').filter(Boolean)).toHaveLength(1); // one statement per call
  });

  it('fails loudly when the primary discovery statement fails', async () => {
    responder = () => ({ status: 401, text: 'bad key' });
    await expect(client().catalog()).rejects.toBeInstanceOf(ZetarisHttpError);
  });
});

describe('helpers', () => {
  it('parseRows: per-column numeric parsing keeps codes and big ints as strings', () => {
    const rows = parseRows(['sic_code', 'v', 'mixed', 'big'], [['5331', '1.2E3', '1', '12345678901234567890'], ['5399', '-0.5', 'x', '1']]);
    expect(rows).toEqual([['5331', 1200, '1', '12345678901234567890'], ['5399', -0.5, 'x', '1']]);
  });
  it('parseRows: nulls stay null and leading-zero values stay strings', () => {
    expect(parseRows(['a', 'b'], [[null, '007'], ['3', '008']])).toEqual([[null, '007'], [3, '008']]);
  });
  it('deriveColumns: aliases, dotted names, functions, star fallback', () => {
    expect(deriveColumns('SELECT a.x, y AS why, round(z, 2) AS r, count(*) FROM t', 4)).toEqual(['x', 'why', 'r', 'col_3']);
    expect(deriveColumns('SELECT * FROM t', 2)).toEqual(['col_0', 'col_1']);
    expect(deriveColumns('SHOW LIGHTNING DATABASES', 3)).toEqual(['col_0', 'col_1', 'col_2']);
  });
  it('parsePayload: tolerates null and 204 style bodies', () => {
    expect(parsePayload(null)).toEqual({ rows: [] });
    expect(parsePayload({ data: null })).toEqual({ rows: [] });
  });
  it('restConfigFromEnv validates required settings', () => {
    expect(() => restConfigFromEnv({})).toThrow(ZetarisConfigError);
    expect(() => restConfigFromEnv({ ZETARIS_API_KEY: 'k', ZETARIS_ORG_ID: 'acme' })).toThrow(/numeric/);
    const c = restConfigFromEnv({ ZETARIS_API_KEY: 'k', ZETARIS_ORG_ID: '3' });
    expect(c.baseUrl).toBe('http://localhost:8888/api/v1.0');
    expect(restConfigFromEnv({ ZETARIS_API_KEY: 'k', ZETARIS_ORG_ID: '3', ZETARIS_REST_URL: 'http://h:1/api/v1.0/' }).baseUrl).toBe('http://h:1/api/v1.0');
  });
});
