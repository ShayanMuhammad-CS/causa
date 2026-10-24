// Offline Zetaris stand-in for CAUSA_FAKE=1. Runs REAL SQL (DuckDB) over fixture tables whose names, columns and
// column order mirror what data/sql onboards into a real Zetaris instance (see schema.ts), so SQL the agent writes
// against the catalog works in both modes. It also emulates the catalog statements the agent / REST client issue
// (SHOW LIGHTNING DATABASES/TABLES, SHOW DATASOURCE VIEWS, DESCRIBE, SHOW NAMESPACES OR TABLES IN, SHOW SERVER VERSION).
//
// Differences from real Zetaris (Spark SQL) that the fake papers over: backtick identifiers are rewritten to double
// quotes and the four-part USL name lightning.metastore.usl_demo.sic_edgar_usl.<t> to the DuckDB schema sic_edgar_usl.
// Spark-only functions are NOT emulated; the agent should stick to ANSI SQL + window functions.
// Safety: guardSql() runs first, and DuckDB external access (files, network, extensions) is disabled and locked
// after the fixtures are loaded.
import { DuckDBInstance, type DuckDBConnection } from '@duckdb/node-api';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CatalogTable, QueryResult, ZetarisClient } from '../types.js';
import { ZetarisConfigError, ZetarisQueryError, ZetarisTimeoutError } from './errors.js';
import { DEFAULT_LIMIT, extractSources, guardSql } from './guard.js';
import { parseRows, type Cell } from './rest.js';
import { LIGHTNING_DATABASES, TABLES, USL_MODEL, USL_NAMESPACE, findTable, toCatalogTable, type ColType, type TableDef } from './schema.js';

export const DEFAULT_FIXTURE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../fixtures/zetaris');
const DUCK_TYPE: Record<ColType, string> = { string: 'VARCHAR', int: 'INTEGER', bigint: 'BIGINT', double: 'DOUBLE' };
const SPARK_TYPE: Record<ColType, string> = { string: 'string', int: 'int', bigint: 'bigint', double: 'double' };

export interface FakeOptions { fixtureDir?: string; defaultTimeoutMs?: number }

interface RawTableInfo { db: string; table: string; endpoint: string }

export class FakeZetarisClient implements ZetarisClient {
  private readonly dir: string;
  private readonly timeoutMs: number;
  private ready?: Promise<DuckDBConnection>;
  private chain: Promise<unknown> = Promise.resolve();
  private raw: RawTableInfo[] = [];
  private fetchedAt = 'unknown';

  constructor(opts: FakeOptions = {}) {
    this.dir = opts.fixtureDir ?? DEFAULT_FIXTURE_DIR;
    this.timeoutMs = opts.defaultTimeoutMs ?? 60_000;
  }

  private init(): Promise<DuckDBConnection> {
    this.ready ??= this.load();
    return this.ready;
  }

  private async load(): Promise<DuckDBConnection> {
    const instance = await DuckDBInstance.create(':memory:');
    const con = await instance.connect();
    const j = (p: string) => path.join(this.dir, p).replace(/\\/g, '/');
    for (const schema of new Set(TABLES.map((t) => t.duckdb.split('.')[0]!))) await con.run(`CREATE SCHEMA IF NOT EXISTS ${schema}`);
    for (const t of TABLES.filter((x) => x.fixture)) {
      const file = j(t.fixture!);
      if (!existsSync(file)) throw new ZetarisConfigError(`Fake Zetaris fixture missing: ${file} (run: npx tsx ../data/fetch-fixtures.ts)`);
      const ddl = t.columns.map((c) => `${c.name} ${DUCK_TYPE[c.type]}`).join(', ');
      const cols = t.columns.map((c) => `'${c.name}': '${DUCK_TYPE[c.type]}'`).join(', ');
      await con.run(`CREATE TABLE ${t.duckdb} (${ddl})`);
      await con.run(`INSERT INTO ${t.duckdb} SELECT ${t.columns.map((c) => c.name).join(', ')} FROM read_json('${file}', format='array', columns={${cols}})`);
    }
    // derived objects (mirror the views / USL tables our onboarding creates)
    await con.run(`CREATE VIEW company_dns.sic_codes_v4_compat_table AS
      SELECT class_id AS sic_code, class_desc AS description, section_id AS division, section_desc AS division_desc,
             division_id AS major_group, division_desc AS major_group_desc, group_id AS industry_group, group_desc AS industry_group_desc
      FROM company_dns.sic_codes_v4_table`);
    await con.run(`CREATE VIEW sic_edgar_usl.sic_code AS SELECT * FROM company_dns.sic_codes_v4_compat_table`);
    await con.run(`CREATE VIEW sic_edgar_usl.company AS
      SELECT cik, ticker, entity_name, sic_code AS sic, sic_description_edgar FROM edgar.company_profile`);

    const rawFile = path.join(this.dir, 'raw_tables.json');
    if (existsSync(rawFile)) this.raw = JSON.parse(readFileSync(rawFile, 'utf8'));
    const srcFile = path.join(this.dir, 'sources.json');
    if (existsSync(srcFile)) this.fetchedAt = JSON.parse(readFileSync(srcFile, 'utf8')).fetchedAt ?? 'unknown';

    await con.run('SET enable_external_access=false');
    await con.run('SET lock_configuration=true');
    return con;
  }

  async health(): Promise<{ ok: boolean; detail: string }> {
    try {
      const r = await this.query('SELECT count(*) AS n FROM edgar.company_financials');
      return { ok: true, detail: `fake DuckDB over fixtures fetched ${this.fetchedAt} (${r.rows[0]![0]} financial facts)` };
    } catch (e) {
      return { ok: false, detail: e instanceof Error ? e.message : String(e) };
    }
  }

  async catalog(): Promise<CatalogTable[]> {
    return TABLES.map(toCatalogTable);
  }

  async query(sql: string, opts: { limit?: number; timeoutMs?: number } = {}): Promise<QueryResult> {
    const limit = opts.limit ?? DEFAULT_LIMIT;
    const guarded = guardSql(sql, { limit });
    const t0 = Date.now();
    const queryId = crypto.randomUUID();
    const source = guarded.kind === 'select' ? extractSources(guarded.sql) : [];

    let columns: string[];
    let raw: unknown[][];
    if (guarded.kind === 'select') {
      const rewritten = toDuckDb(guarded.sql);
      ({ columns, rows: raw } = await this.exec(rewritten, opts.timeoutMs ?? this.timeoutMs));
    } else {
      await this.init();
      ({ columns, rows: raw } = this.metadata(guarded.sql));
    }
    return { queryId, sql: guarded.sql, columns, rows: parseRows(columns, raw) as Cell[][], rowCount: raw.length, elapsedMs: Date.now() - t0, source };
  }

  /** Serialise access: one DuckDB connection, one statement at a time. */
  private exec(sql: string, timeoutMs: number): Promise<{ columns: string[]; rows: unknown[][] }> {
    const run = async () => {
      const con = await this.init();
      let timer: NodeJS.Timeout | undefined;
      const timeout = new Promise<never>((_, rej) => {
        timer = setTimeout(() => { con.interrupt(); rej(new ZetarisTimeoutError(timeoutMs)); }, timeoutMs);
      });
      try {
        const result = await Promise.race([con.runAndReadAll(sql), timeout]);
        return { columns: result.columnNames(), rows: result.getRowsJson() as unknown[][] };
      } catch (e) {
        if (e instanceof ZetarisTimeoutError) throw e;
        throw new ZetarisQueryError(cleanDuckError(e), e);
      } finally {
        if (timer) clearTimeout(timer);
      }
    };
    const next = this.chain.then(run, run);
    this.chain = next.catch(() => undefined);
    return next;
  }

  /** Emulates the Lightning catalog statements (guard already limited SHOW/DESCRIBE to catalog subjects). */
  private metadata(sql: string): { columns: string[]; rows: unknown[][] } {
    const s = sql.replace(/\s+/g, ' ').trim();
    const up = s.toUpperCase();
    if (up === 'SHOW LIGHTNING DATABASES') {
      return { columns: ['name', 'description', 'id'], rows: LIGHTNING_DATABASES.map((d, i) => [d.name, d.description, String(i + 1)]) };
    }
    let m = /^SHOW LIGHTNING TABLES (\w+)$/i.exec(s);
    if (m) {
      const db = m[1]!.toUpperCase();
      const rows = this.raw.filter((r) => r.db.toUpperCase() === db).map((r, i) => [r.table, 'REST', r.endpoint, 'json', String(i + 1)]);
      return { columns: ['name', 'type', 'path', 'format', 'id'], rows };
    }
    if (up === 'SHOW DATASOURCE VIEWS') {
      return { columns: ['name', 'generator', 'cached_table'], rows: TABLES.filter((t) => t.origin === 'schemastore').map((t) => [t.fqName, 'schemastore', '']) };
    }
    if (up === 'SHOW DATASOURCES') return { columns: ['name', 'description', 'id'], rows: [] };
    if (up === 'SHOW SERVER VERSION') return { columns: ['version'], rows: [['fake-duckdb']] };
    m = /^SHOW NAMESPACES OR TABLES IN ([\w.]+)$/i.exec(s);
    if (m) {
      const ns = m[1]!.toLowerCase();
      const model = `${USL_NAMESPACE}.${USL_MODEL}`;
      if (ns === 'lightning.metastore') return { columns: ['name'], rows: [['usl_demo']] };
      if (ns === USL_NAMESPACE) return { columns: ['name'], rows: [[USL_MODEL]] };
      if (ns === model) return { columns: ['name', 'activated'], rows: TABLES.filter((t) => t.origin === 'usl').map((t) => [t.fqName.split('.').pop(), 'true']) };
      return { columns: ['name'], rows: [] };
    }
    m = /^DESCRIBE (?:DATASOURCE TABLE )?([\w.]+)$/i.exec(s);
    if (m) {
      const def: TableDef | undefined = findTable(m[1]!);
      if (!def) throw new ZetarisQueryError(`Table or view not found: ${m[1]} (fake catalog knows: ${TABLES.map((t) => t.fqName).join(', ')})`);
      return { columns: ['col_name', 'data_type', 'comment'], rows: def.columns.map((c) => [c.name, SPARK_TYPE[c.type], c.description]) };
    }
    throw new ZetarisQueryError(`Statement not supported by the fake Zetaris client: ${s}`);
  }
}

/** Spark-isms -> DuckDB: backtick identifiers, four-part USL names. String literals are left untouched. */
export function toDuckDb(sql: string): string {
  let out = '';
  let i = 0;
  while (i < sql.length) {
    const ch = sql[i]!;
    if (ch === "'") {
      let j = i + 1;
      while (j < sql.length) { if (sql[j] === "'") { if (sql[j + 1] === "'") { j += 2; continue; } break; } j++; }
      out += sql.slice(i, j + 1);
      i = j + 1;
    } else if (ch === '`') {
      const j = sql.indexOf('`', i + 1);
      out += `"${sql.slice(i + 1, j).replace(/"/g, '""')}"`;
      i = j + 1;
    } else { out += ch; i++; }
  }
  return out.replace(/lightning\s*\.\s*metastore\s*\.\s*usl_demo\s*\.\s*sic_edgar_usl\s*\./gi, 'sic_edgar_usl.');
}

function cleanDuckError(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e);
  return m.split('\n')[0]!.replace(/^(Binder|Catalog|Parser|Conversion|Invalid Input|Permission) Error: /, '$1 error: ');
}
