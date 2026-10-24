// Real Zetaris client over the DIRECT REST API (bearer API key). UNVERIFIED against a live instance: the
// instance was not running when this was written, so every request/response shape below is taken from the
// vendored getting-started repo (B:/open-agent-hackathon/vendor/zetaris-getting-started) and cited by file:line.
//
// Shapes used (all paths relative to the vendor repo root):
//  - Base URL: ZETARIS_REST_URL, default http://localhost:8888/api/v1.0
//      scripts/zetaris_sql.py:24 (DEFAULT_REST_URL), :206 (ZETARIS_REST_URL read), docs/connections/client-setup.md:168
//  - Headers on every call: Authorization: Bearer <API key>, X-Org-ID: <numeric org id>, X-Request-ID: <uuid>,
//      Content-Type: application/json            -> scripts/zetaris_sql.py:210-221; org id must be numeric:
//      docs/connections/client-setup.md:169,200-203; "400 on a valid request: X-Request-ID and queryId must be UUIDs":
//      docs/connections/client-setup.md:296-297 (REST `400` troubleshooting rows)
//  - Run one SQL statement: POST {base}/sql-editor/sqls/run
//      body {"queryId": "<uuid>", "sql": "<one statement>", "source": "SqlEditor", "limit": <int>}
//      -> scripts/zetaris_sql.py:233-238
//  - Response: JSON object whose `data` is the list of rows, each row a list of STRING cells
//      -> scripts/zetaris_sql.py:238 (out.get("data")), scripts/preflight.py:61 (SELECT 1 == [["1"]])
//      "REST returns values as strings, and decimals may use exponent format" -> docs/connections/client-setup.md:241-242
//  - Cross-check (controller note, official Participant Setup Guide p.11 + smoke_test.py p.24): same POST
//      {ZETARIS_REST_URL}/sql-editor/sqls/run, same three headers, same body, success = response["data"] rows with
//      data[0][0] == "1" for SELECT 1. No difference from the repo scripts. The UI-proxy route
//      (scripts/query_zetaris.py:41-43, POST /api/proxy/sql-editor/sqls/run-query, body {sql, limit[, engineId]}) is NOT used.
//  - NO column names are documented in the response. We therefore (a) look for a column list under a few
//    plausible keys, (b) accept rows that are objects, and (c) otherwise derive names from the SELECT list.
//    This is the single most important thing to verify live (see data/README.md "live checklist").
//  - Health: GET {base}/datasource/datasources then SELECT 1 -> scripts/preflight.py:58-61
//  - Catalog statements: SHOW LIGHTNING DATABASES (docs/guides/zetaris-lightning-sql-commands.md:481-496: "name,
//      description and id"), SHOW LIGHTNING TABLES <db> (:499-518), SHOW DATASOURCE VIEWS (:1661-1676),
//      DESCRIBE <container>.<view> (open_data/rest_apis/sql/rate_limited/12_company_dns_select.sql:40-43),
//      DESCRIBE DATASOURCE TABLE <db>.<table> (docs/guides/zetaris-lightning-sql-commands.md:279-298),
//      SHOW NAMESPACES OR TABLES IN <ns> (:1789-1803; used by scripts/preflight.py:105)
//  - One statement per call: docs/connections/client-setup.md:118.
import { randomUUID } from 'node:crypto';
import type { CatalogTable, QueryResult, ZetarisClient } from '../types.js';
import {
  ZetarisBadResponseError, ZetarisConfigError, ZetarisError, ZetarisHttpError, ZetarisNetworkError, ZetarisQueryError,
  ZetarisTimeoutError,
} from './errors.js';
import { DEFAULT_LIMIT, extractSources, guardSql } from './guard.js';
import { annotateCatalog } from './schema.js';

export const DEFAULT_REST_URL = 'http://localhost:8888/api/v1.0';

export interface RestConfig {
  baseUrl: string;
  apiKey: string;
  orgId: string;
  timeoutMs?: number;
  retries?: number;
  /** ms to wait before retry n (1-based). Default 300 * 2^(n-1). Injectable so tests do not sleep. */
  backoffMs?: (attempt: number) => number;
  fetchImpl?: typeof fetch;
  /** Include raw REST tables (nested JSON) in catalog(); default false, the agent should use flattened views. */
  includeRaw?: boolean;
  /** Schemastore containers to probe with DESCRIBE when SHOW DATASOURCE VIEWS does not return qualified names. */
  viewContainers?: string[];
  /** USL namespace to browse, default lightning.metastore.usl_demo (open_data/usl/sql/02_sic_edgar_usl_create.sql:87-88). */
  uslNamespace?: string;
  catalogTtlMs?: number;
}

export function restConfigFromEnv(env: NodeJS.ProcessEnv): RestConfig {
  const apiKey = env.ZETARIS_API_KEY;
  const orgId = env.ZETARIS_ORG_ID;
  if (!apiKey) throw new ZetarisConfigError('ZETARIS_API_KEY is not set (create a key under Management > API Tokens in the Zetaris UI)');
  if (!orgId || !/^[0-9]+$/.test(orgId)) throw new ZetarisConfigError('ZETARIS_ORG_ID must be the numeric organisation ID');
  const baseUrl = (env.ZETARIS_REST_URL ?? DEFAULT_REST_URL).replace(/\/+$/, '');
  if (!/^https?:\/\//.test(baseUrl)) throw new ZetarisConfigError('ZETARIS_REST_URL must be an http(s) URL ending in /api/v1.0');
  return {
    baseUrl, apiKey, orgId,
    timeoutMs: env.ZETARIS_TIMEOUT_MS ? Number(env.ZETARIS_TIMEOUT_MS) : undefined,
    includeRaw: env.ZETARIS_CATALOG_RAW === '1',
    viewContainers: env.ZETARIS_VIEW_CONTAINERS ? env.ZETARIS_VIEW_CONTAINERS.split(',').map((s) => s.trim()).filter(Boolean) : undefined,
    uslNamespace: env.ZETARIS_USL_NAMESPACE,
  };
}

// ---------- numeric parsing ----------

const NUM_RE = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;
/** Columns that look numeric but are identifiers: keep as strings (leading zeros, codes). */
const IDENTIFIER_COL = /(^|_)(code|id|cik|sic|accession|group|division|ticker|zip|phone)(_|$)|^class_id$/i;

export type Cell = string | number | null;

/** REST returns every cell as a string, decimals possibly in exponent form. Convert per column, never per cell. */
export function parseRows(columns: string[], raw: unknown[][]): Cell[][] {
  const numericCol = columns.map((name, ci) => {
    if (IDENTIFIER_COL.test(name)) return false;
    let seen = false;
    for (const row of raw) {
      const v = row[ci];
      if (v === null || v === undefined || v === '') continue;
      if (typeof v === 'number') { seen = true; continue; }
      if (typeof v !== 'string' || !NUM_RE.test(v.trim())) return false;
      if (/^[+-]?0\d/.test(v.trim())) return false; // 0042 is a code, not a number
      const num = Number(v);
      if (!Number.isFinite(num)) return false;
      if (/^[+-]?\d+$/.test(v.trim()) && !Number.isSafeInteger(num)) return false;
      seen = true;
    }
    return seen;
  });
  return raw.map((row) => columns.map((_, ci) => {
    const v = row[ci];
    if (v === null || v === undefined) return null;
    if (typeof v === 'number') return v;
    if (typeof v === 'boolean') return v ? 'true' : 'false';
    if (typeof v === 'object') return JSON.stringify(v);
    const s = String(v);
    if (numericCol[ci] && s.trim() !== '') return Number(s);
    return s;
  }));
}

/** Best-effort column names from a SELECT list when the API gives none. Falls back to col_<i>. */
export function deriveColumns(sql: string, width: number): string[] {
  const fallback = Array.from({ length: width }, (_, i) => `col_${i}`);
  const m = /^\s*(?:WITH[\s\S]*?\)\s*)?SELECT\s+(?:DISTINCT\s+)?([\s\S]*?)\s+FROM\b/i.exec(sql.replace(/\s+/g, ' '));
  if (!m) return fallback;
  // The lazy WITH prefix is unreliable for nested CTEs; if it picked a wrong SELECT the arity check below catches it.
  const list = m[1]!;
  const parts: string[] = [];
  let depth = 0, cur = '', quote = '';
  for (const c of list) {
    if (quote) { cur += c; if (c === quote) quote = ''; continue; }
    if (c === "'" || c === '`' || c === '"') { quote = c; cur += c; continue; }
    if (c === '(') depth++;
    if (c === ')') depth--;
    if (c === ',' && depth === 0) { parts.push(cur.trim()); cur = ''; continue; }
    cur += c;
  }
  parts.push(cur.trim());
  if (parts.length !== width || parts.some((p) => p === '*' || /\.\*$/.test(p))) return fallback;
  return parts.map((p, i) => {
    const alias = /\bAS\s+([`"]?)([A-Za-z_][\w$]*)\1\s*$/i.exec(p);
    if (alias) return alias[2]!;
    const bare = /^(?:[A-Za-z_][\w$]*\.)*[`"]?([A-Za-z_][\w$]*)[`"]?$/.exec(p);
    if (bare) return bare[1]!;
    const trailing = /\s([A-Za-z_][\w$]*)$/.exec(p); // `expr alias` without AS
    return trailing && !/[()]$/.test(p) ? trailing[1]! : fallback[i]!;
  });
}

// ---------- client ----------

interface RunPayload { rows: unknown[][]; columns?: string[] }

export class RestZetarisClient implements ZetarisClient {
  private readonly cfg: Required<Pick<RestConfig, 'baseUrl' | 'apiKey' | 'orgId' | 'timeoutMs' | 'retries'>> & RestConfig;
  private readonly fetchImpl: typeof fetch;
  private catalogCache?: { at: number; tables: CatalogTable[] };
  /** Non-fatal problems met during the last catalog() call (shown by /api/health or logs, never swallowed silently). */
  lastCatalogWarnings: string[] = [];

  constructor(cfg: RestConfig) {
    this.cfg = { timeoutMs: 60_000, retries: 2, ...cfg };
    this.fetchImpl = cfg.fetchImpl ?? fetch;
  }

  async health(): Promise<{ ok: boolean; detail: string }> {
    try {
      const res = await this.http('GET', '/datasource/datasources', undefined, 10_000);
      const list = Array.isArray(res) ? res : (res as { data?: unknown[] } | null)?.data ?? [];
      const one = await this.run('SELECT 1 AS one', 1, 10_000);
      const ok = one.rows.length === 1 && String(one.rows[0]![0]) === '1';
      return { ok, detail: ok ? `REST ok, ${Array.isArray(list) ? list.length : '?'} datasources listed, SELECT 1 ok` : `SELECT 1 returned ${JSON.stringify(one.rows)}` };
    } catch (e) {
      return { ok: false, detail: e instanceof Error ? e.message : String(e) };
    }
  }

  async query(sql: string, opts: { limit?: number; timeoutMs?: number } = {}): Promise<QueryResult> {
    const limit = opts.limit ?? DEFAULT_LIMIT;
    const guarded = guardSql(sql, { limit });
    const t0 = Date.now();
    const { rows, columns, queryId } = await this.runWithId(guarded.sql, limit, opts.timeoutMs);
    const cols = columns.length === (rows[0]?.length ?? columns.length) ? columns : deriveColumns(guarded.sql, rows[0]?.length ?? 0);
    return {
      queryId, sql: guarded.sql, columns: cols, rows: parseRows(cols, rows), rowCount: rows.length,
      elapsedMs: Date.now() - t0, source: guarded.kind === 'select' ? extractSources(guarded.sql) : [],
    };
  }

  async catalog(): Promise<CatalogTable[]> {
    const ttl = this.cfg.catalogTtlMs ?? 300_000;
    if (this.catalogCache && Date.now() - this.catalogCache.at < ttl) return this.catalogCache.tables;
    this.lastCatalogWarnings = [];
    const tables: CatalogTable[] = [];
    const seen = new Set<string>();
    const add = (t: CatalogTable) => { if (!seen.has(t.fqName.toLowerCase())) { seen.add(t.fqName.toLowerCase()); tables.push(t); } };

    // 1. Lightning databases (REST + filestore registrations). A failure here is fatal: nothing else would work.
    const dbs = await this.statement('SHOW LIGHTNING DATABASES');
    for (const row of dbs.rows) {
      const db = String(row[0] ?? '');
      if (!db) continue;
      try {
        const tbls = await this.statement(`SHOW LIGHTNING TABLES ${db}`);
        for (const r of tbls.rows) {
          const name = String(r[0] ?? '');
          if (!name) continue;
          const kindText = r.map((c) => String(c ?? '')).join(' ');
          const isRest = /rest/i.test(kindText);
          const isFile = /file|parquet|csv/i.test(kindText);
          if (isRest && !this.cfg.includeRaw) continue;
          const fq = `${db}.${name}`;
          add({ fqName: fq, description: String(row[1] ?? '') || undefined, columns: await this.describe(`DESCRIBE DATASOURCE TABLE ${fq}`), origin: isFile ? 'filestore' : 'rest' });
        }
      } catch (e) { this.warn(`lightning db ${db}: ${msg(e)}`); }
    }

    // 2. Schemastore views (the flattened tables the agent should query)
    try {
      const views = await this.statement('SHOW DATASOURCE VIEWS');
      for (const r of views.rows) {
        const cells = r.map((c) => String(c ?? ''));
        const qualified = cells.find((c) => /^\w+\.\w+$/.test(c));
        const candidates = qualified ? [qualified] : (this.cfg.viewContainers ?? ['edgar', 'company_dns', 'worldbank']).map((c) => `${c}.${cells[0]}`);
        for (const fq of candidates) {
          try { add({ fqName: fq, columns: await this.describe(`DESCRIBE ${fq}`), origin: 'schemastore' }); break; }
          catch { /* try next container candidate */ }
        }
      }
    } catch (e) { this.warn(`schemastore views: ${msg(e)}`); }

    // 3. USL tables (semantic layer), browsed breadth-first, bounded
    try { await this.browseUsl(this.cfg.uslNamespace ?? 'lightning.metastore.usl_demo', 0, add); } catch (e) { this.warn(`USL: ${msg(e)}`); }

    const annotated = annotateCatalog(tables);
    this.catalogCache = { at: Date.now(), tables: annotated };
    return annotated;
  }

  /**
   * ADMIN ONLY, bypasses the read-only guard. Used solely by data/run-onboarding.ts to run the DDL in data/sql.
   * Never expose this through the ZetarisClient interface; the agent only ever sees query()/catalog().
   */
  async unsafeExecuteStatement(sql: string, timeoutMs = 600_000): Promise<{ rows: unknown[][]; queryId: string }> {
    const { rows, queryId } = await this.runWithId(sql, 100, timeoutMs);
    return { rows, queryId };
  }

  // ----- internals -----

  private warn(m: string) { this.lastCatalogWarnings.push(m); }

  private async browseUsl(ns: string, depth: number, add: (t: CatalogTable) => void): Promise<void> {
    if (depth > 2) return;
    const res = await this.statement(`SHOW NAMESPACES OR TABLES IN ${ns}`);
    for (const r of res.rows) {
      const name = String(r[0] ?? '').split('.').pop() ?? '';
      if (!name) continue;
      const fq = `${ns}.${name}`;
      let children: Awaited<ReturnType<RestZetarisClient['statement']>> | null = null;
      try { children = await this.statement(`SHOW NAMESPACES OR TABLES IN ${fq}`); } catch { children = null; }
      if (children && children.rows.length > 0) { await this.browseUsl(fq, depth + 1, add); continue; }
      try { add({ fqName: fq, columns: await this.describe(`DESCRIBE ${fq}`), origin: 'usl' }); }
      catch (e) { this.warn(`USL table ${fq}: ${msg(e)}`); add({ fqName: fq, columns: [], origin: 'usl' }); }
    }
  }

  /** Run a catalog statement through the same guard + transport as query(), without LIMIT rewriting. */
  private async statement(sql: string): Promise<{ rows: Cell[][]; columns: string[] }> {
    const g = guardSql(sql);
    const { rows, columns } = await this.runWithId(g.sql, DEFAULT_LIMIT);
    const cols = columns.length ? columns : deriveColumns(g.sql, rows[0]?.length ?? 0);
    return { rows: parseRows(cols, rows) as Cell[][], columns: cols };
  }

  private async describe(sql: string): Promise<CatalogTable['columns']> {
    const res = await this.statement(sql);
    return res.rows
      .filter((r) => r[0] !== null && !String(r[0]).startsWith('#') && String(r[0]).trim() !== '')
      .map((r) => {
        const desc = [r[3], r[2]].map((v) => (v === null || v === undefined ? '' : String(v).trim())).find((s) => s && s.toLowerCase() !== 'null');
        return { name: String(r[0]), type: String(r[1] ?? ''), ...(desc ? { description: desc } : {}) };
      });
  }

  private async run(sql: string, limit: number, timeoutMs?: number): Promise<{ rows: Cell[][]; columns: string[] }> {
    const { rows, columns } = await this.runWithId(sql, limit, timeoutMs);
    const cols = columns.length ? columns : deriveColumns(sql, rows[0]?.length ?? 0);
    return { rows: parseRows(cols, rows) as Cell[][], columns: cols };
  }

  private async runWithId(sql: string, limit: number, timeoutMs?: number): Promise<{ rows: unknown[][]; columns: string[]; queryId: string }> {
    const queryId = randomUUID();
    const body = { queryId, sql, source: 'SqlEditor', limit };
    const payload = parsePayload(await this.http('POST', '/sql-editor/sqls/run', body, timeoutMs));
    return { rows: payload.rows, columns: payload.columns ?? [], queryId };
  }

  /** One HTTP call with timeout and retry (2 retries) on 5xx / network errors. */
  private async http(method: 'GET' | 'POST', path: string, body: unknown, timeoutMs?: number): Promise<unknown> {
    const { baseUrl, apiKey, orgId, retries } = this.cfg;
    const timeout = timeoutMs ?? this.cfg.timeoutMs;
    const backoff = this.cfg.backoffMs ?? ((n: number) => 300 * 2 ** (n - 1));
    let lastErr: ZetarisError | undefined;
    for (let attempt = 0; attempt <= retries; attempt++) {
      if (attempt > 0) await new Promise((r) => setTimeout(r, backoff(attempt)));
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), timeout);
      try {
        const res = await this.fetchImpl(`${baseUrl}${path}`, {
          method,
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'X-Org-ID': orgId,
            'X-Request-ID': randomUUID(),
            'Content-Type': 'application/json',
          },
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: ctl.signal,
        });
        const text = await res.text();
        if (res.ok) {
          if (res.status === 204 || text.trim() === '') return null;
          try { return JSON.parse(text); } catch { throw new ZetarisBadResponseError(`Zetaris returned non-JSON: ${text.slice(0, 200)}`); }
        }
        if (res.status >= 500) { lastErr = new ZetarisHttpError(res.status, text); continue; }
        if (res.status === 400 || res.status === 422) {
          throw new ZetarisQueryError(`Zetaris rejected the request (HTTP ${res.status}): ${text.slice(0, 500)}`);
        }
        throw new ZetarisHttpError(res.status, text);
      } catch (e) {
        if (e instanceof ZetarisError && !e.retryable) throw e;
        if (e instanceof ZetarisError) { lastErr = e; continue; }
        if ((e as { name?: string }).name === 'AbortError') throw new ZetarisTimeoutError(timeout);
        lastErr = new ZetarisNetworkError(`Cannot reach Zetaris at ${baseUrl}: ${msg(e)}`, e);
      } finally {
        clearTimeout(timer);
      }
    }
    throw lastErr ?? new ZetarisNetworkError('Zetaris request failed');
  }
}

function msg(e: unknown): string { return e instanceof Error ? e.message : String(e); }

/** Accepts {data:[[..]]}, {data:[{..}]} and optional column metadata under a few plausible keys (all unverified). */
export function parsePayload(json: unknown): RunPayload {
  if (json === null || json === undefined) return { rows: [] };
  const obj = (Array.isArray(json) ? { data: json } : json) as Record<string, unknown>;
  const data = obj.data;
  if (data === null || data === undefined) return { rows: [] };
  if (!Array.isArray(data)) throw new ZetarisBadResponseError('Zetaris response has no `data` array');
  const meta = obj.columns ?? obj.schema ?? obj.header ?? obj.headers ?? obj.fields;
  let columns: string[] | undefined;
  if (Array.isArray(meta)) {
    const names = meta.map((m) => (typeof m === 'string' ? m : typeof m === 'object' && m && 'name' in m ? String((m as { name: unknown }).name) : ''));
    if (names.every(Boolean)) columns = names;
  }
  if (data.length > 0 && data.every((r) => r && typeof r === 'object' && !Array.isArray(r))) {
    const keys = Object.keys(data[0] as object);
    return { columns: keys, rows: (data as Record<string, unknown>[]).map((r) => keys.map((k) => r[k])) };
  }
  if (!data.every((r) => Array.isArray(r))) throw new ZetarisBadResponseError('Zetaris `data` rows are neither arrays nor objects');
  return { rows: data as unknown[][], columns };
}
