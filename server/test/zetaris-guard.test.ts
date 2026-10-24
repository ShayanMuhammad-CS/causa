import { describe, expect, it } from 'vitest';
import { ZetarisGuardError } from '../src/zetaris/errors.js';
import { extractSources, guardSql } from '../src/zetaris/guard.js';

const rejected = (sql: string) => expect(() => guardSql(sql), `should reject: ${JSON.stringify(sql)}`).toThrow(ZetarisGuardError);

describe('guard: accepted read-only statements', () => {
  const ok: [string, string][] = [
    ['plain select', 'SELECT 1'],
    ['select with trailing semicolon', 'SELECT 1;'],
    ['trailing semicolon + whitespace', 'SELECT 1 ;  \n'],
    ['lowercase', 'select a, b from edgar.company_financials'],
    ['CTE select', 'WITH t AS (SELECT 1 AS x) SELECT x FROM t'],
    ['multi CTE', 'WITH a AS (SELECT 1 x), b AS (SELECT 2 y) SELECT * FROM a, b'],
    ['show lightning databases', 'SHOW LIGHTNING DATABASES'],
    ['show lightning tables', 'SHOW LIGHTNING TABLES SEC_DATA'],
    ['show namespaces', 'SHOW NAMESPACES OR TABLES IN lightning.metastore'],
    ['show datasource views', 'SHOW DATASOURCE VIEWS'],
    ['describe view', 'DESCRIBE company_dns.sic_codes_v4_table'],
    ['describe datasource table', 'DESCRIBE DATASOURCE TABLE NY_TAXI.taxi_zones'],
    ['denied word inside string literal', "SELECT * FROM edgar.company_profile WHERE entity_name = 'DROP TABLE; DELETE FROM x'"],
    ['semicolon inside string literal', "SELECT 'a;b' AS x"],
    ['doubled quote inside string', "SELECT 'it''s; fine' AS x"],
    ['denied word as backticked identifier', 'SELECT `update`, `delete` FROM t'],
    ['REPLACE function (not DDL)', "SELECT replace(entity_name, 'Inc', '') FROM edgar.company_profile"],
    ['block comment stripped', 'SELECT /* hello */ 1'],
    ['optimizer hint is just a comment', 'SELECT /*+ BROADCAST(t) */ * FROM t'],
    ['line comment stripped', 'SELECT 1 -- trailing note'],
    ['non-ASCII inside a string literal', "SELECT * FROM t WHERE n = 'Café ＄'"],
    ['window function', 'SELECT ticker, value_usd, LAG(value_usd) OVER (PARTITION BY ticker ORDER BY fiscal_year) FROM edgar.company_financials'],
    ['parenthesised union', '(SELECT 1) UNION ALL (SELECT 2)'],
    ['column named like a keyword prefix', 'SELECT created_at, updated_by, dropped FROM t'],
    ['GROUPING SETS', 'SELECT a, b, count(*) FROM t GROUP BY GROUPING SETS ((a), (b))'],
  ];
  for (const [name, sql] of ok) it(name, () => { expect(() => guardSql(sql)).not.toThrow(); });
});

describe('guard: bypass table (each must be rejected)', () => {
  const bad: [string, string][] = [
    // plain write / DDL
    ['insert', 'INSERT INTO t VALUES (1)'],
    ['update', 'UPDATE t SET a = 1'],
    ['delete', 'DELETE FROM t'],
    ['merge', 'MERGE INTO t USING s ON t.id = s.id WHEN MATCHED THEN DELETE'],
    ['create table', 'CREATE TABLE x (a INT)'],
    ['create or replace view', 'CREATE OR REPLACE SCHEMASTORE VIEW v WITH CONTAINER c AS SELECT 1'],
    ['drop', 'DROP TABLE t'],
    ['alter', 'ALTER TABLE t ADD COLUMN c INT'],
    ['grant', 'GRANT ALL ON t TO u'],
    ['truncate', 'TRUNCATE TABLE t'],
    ['cache', 'CACHE TABLE company_dns.sic_codes_raw'],
    ['refresh', 'REFRESH DATASOURCE TABLES FROM crm'],
    ['compile usl', 'COMPILE USL x DEPLOY NAMESPACE n DDL CREATE TABLE a (b INT)'],
    ['activate usl', 'ACTIVATE USL TABLE a.b.c AS SELECT 1'],
    ['remove usl', 'REMOVE USL x NAMESPACE n'],
    ['register dq', 'REGISTER DQ r TABLE t AS a > 0'],
    ['materialize', "MATERIALIZE USL TABLE a.b TO STORAGE (path='/x')"],
    ['set config', 'SET spark.sql.shuffle.partitions=1'],
    ['use', 'USE db'],
    ['empty', ''],
    ['only comment', '-- nothing'],
    ['only semicolon', ';'],
    // statement stacking
    ['two selects', 'SELECT 1; SELECT 2'],
    ['select then drop', 'SELECT 1; DROP TABLE t'],
    ['semicolon + newline + drop', 'SELECT 1;\nDROP TABLE t'],
    ['semicolon then comment then drop', 'SELECT 1; /* x */ DROP TABLE t'],
    ['double semicolon then statement', 'SELECT 1;; DELETE FROM t'],
    ['semicolon after string with semicolon', "SELECT 'a;b'; DROP TABLE t"],
    // comment hiding
    ['drop after line comment newline', 'SELECT 1 --\n; DROP TABLE t'],
    ['block comment around semicolon', 'SELECT 1 /* ; */ ; DELETE FROM t'],
    ['unterminated block comment', 'SELECT 1 /* never ends'],
    ['unterminated string', "SELECT 'abc"],
    ['unterminated backtick', 'SELECT `abc'],
    ['mysql executable comment', 'SELECT 1 /*! ; DROP TABLE t */'],
    ['nested comment confusion', 'SELECT 1 /* a /* b */ ; DROP TABLE t /* c */'],
    ['comment opener inside string must not hide', "SELECT '/*' ; DROP TABLE t; SELECT '*/'"],
    ['line-comment marker inside string must not hide', "SELECT '--' ; DROP TABLE t"],
    ['keyword split by comment', 'SELECT 1; /**/ DROP/**/TABLE t'],
    // CTE / subquery wrapping of DML
    ['cte wrapping delete', 'WITH d AS (DELETE FROM t RETURNING *) SELECT * FROM d'],
    ['cte wrapping insert', 'WITH x AS (SELECT 1) INSERT INTO t SELECT * FROM x'],
    ['select into', 'SELECT * INTO newt FROM t'],
    ['insert overwrite', 'INSERT OVERWRITE TABLE t SELECT 1'],
    ['create table as select', 'CREATE TABLE t2 AS SELECT * FROM t'],
    ['subquery containing update keyword', 'SELECT * FROM (UPDATE t SET a=1) s'],
    // case and whitespace tricks
    ['mixed case drop', 'SeLeCt 1; dRoP TaBlE t'],
    ['mixed case insert', 'iNsErT iNtO t VALUES (1)'],
    ['tab separated', 'SELECT\t1;\tDROP\tTABLE\tt'],
    ['newline separated keyword', 'WITH x AS (SELECT 1)\nDELETE\nFROM t'],
    ['carriage return', 'SELECT 1;\rDROP TABLE t'],
    ['form feed', 'SELECT 1;\u000cDROP TABLE t'],
    ['NUL byte', 'SELECT 1\u0000; DROP TABLE t'],
    ['leading comment then drop', '  \n  /* c */ DROP TABLE t'],
    // unicode lookalikes
    ['fullwidth semicolon', 'SELECT 1； DROP TABLE t'],
    ['greek question mark (looks like ;)', 'SELECT 1; DROP TABLE t'],
    ['cyrillic S in SELECT', 'ЅELECT 1'],
    ['cyrillic O in DROP', 'SELECT 1; DRОP TABLE t'],
    ['zero width space inside keyword', 'SELECT 1; DR​OP TABLE t'],
    ['fullwidth letters', 'ＤＲＯＰ TABLE t'],
    ['non-breaking space separator', 'SELECT 1; DROP TABLE t'],
    ['right-to-left override', 'SELECT 1 ‮; DROP TABLE t'],
    ['non-ascii identifier outside string', 'SELECT café FROM t'],
    // quoting tricks
    ['backslash-escaped quote', "SELECT '\\'; DROP TABLE t; --'"],
    ['backslash anywhere', 'SELECT 1 \\ ; DROP TABLE t'],
    ['double-quoted string then statement', 'SELECT "a"; DROP TABLE t'],
    // SHOW / DESCRIBE abuse
    ['show auth', 'SHOW AUTH'],
    ['show users', 'SHOW USERS'],
    ['show then drop', 'SHOW LIGHTNING DATABASES; DROP TABLE t'],
    ['describe then drop', 'DESCRIBE t; DROP TABLE t'],
    ['describe with insert in tail', 'DESCRIBE t INSERT INTO x'],
    // engine-specific escape hatches (Spark/DuckDB)
    ['spark reflect', "SELECT reflect('java.lang.Runtime', 'getRuntime')"],
    ['spark java_method', "SELECT java_method('java.lang.System', 'exit', 1)"],
    ['file path table (spark parquet)', 'SELECT * FROM parquet.`s3://bucket/x.parquet`'],
    ['file path table (csv)', 'SELECT * FROM csv.`/etc/passwd`'],
    ['duckdb read_csv', "SELECT * FROM read_csv('/etc/passwd')"],
    ['duckdb read_parquet', "SELECT * FROM read_parquet('x.parquet')"],
    ['duckdb query()', "SELECT * FROM query('DROP TABLE t')"],
    ['duckdb implicit file in FROM', "SELECT * FROM '/etc/passwd'"],
    ['duckdb attach', "ATTACH 'x.db'"],
    ['duckdb copy', "COPY t TO 'x.csv'"],
    ['duckdb pragma', 'PRAGMA database_list'],
    ['duckdb install', 'INSTALL httpfs'],
    ['explain wraps', 'EXPLAIN DELETE FROM t'],
    ['call', 'CALL system.procedure()'],
    ['exec', "EXEC xp_cmdshell 'dir'"],
  ];
  for (const [name, sql] of bad) it(name, () => { rejected(sql); });
});

describe('guard: LIMIT enforcement', () => {
  it('appends default LIMIT 1000 when absent', () => {
    expect(guardSql('SELECT * FROM t').sql).toMatch(/LIMIT 1000$/);
  });
  it('honours opts.limit', () => {
    expect(guardSql('SELECT * FROM t', { limit: 5 }).sql).toMatch(/LIMIT 5$/);
  });
  it('keeps a smaller literal LIMIT', () => {
    const g = guardSql('SELECT * FROM t LIMIT 10');
    expect(g.sql).toMatch(/LIMIT 10$/);
    expect(g.sql.match(/LIMIT/g)).toHaveLength(1);
  });
  it('lowers a larger LIMIT to the cap', () => {
    const g = guardSql('SELECT * FROM t LIMIT 999999');
    expect(g.sql).toMatch(/LIMIT 1000$/);
    expect(g.sql).not.toContain('999999');
  });
  it('ignores LIMIT inside subqueries when deciding the top-level limit', () => {
    expect(guardSql('SELECT * FROM (SELECT * FROM t LIMIT 5) s').sql).toMatch(/\) s LIMIT 1000$/);
  });
  it('rejects LIMIT ALL and non-literal limits', () => {
    rejected('SELECT * FROM t LIMIT ALL');
    rejected('SELECT * FROM t LIMIT (SELECT 99999999)');
  });
  it('limit is appended after ORDER BY (ordering preserved), CTE too', () => {
    expect(guardSql('SELECT a FROM t ORDER BY a DESC').sql).toBe('SELECT a FROM t ORDER BY a DESC LIMIT 1000');
    expect(guardSql('WITH x AS (SELECT 1 a) SELECT a FROM x').sql).toBe('WITH x AS (SELECT 1 a) SELECT a FROM x LIMIT 1000');
  });
  it('does not add LIMIT to SHOW/DESCRIBE and reports kind', () => {
    expect(guardSql('SHOW LIGHTNING DATABASES')).toEqual({ sql: 'SHOW LIGHTNING DATABASES', kind: 'show' });
    expect(guardSql('DESCRIBE a.b').kind).toBe('describe');
  });
  it('strips comments and the trailing semicolon from the output', () => {
    expect(guardSql('SELECT 1 /* c */ ; -- x').sql).toBe('SELECT 1 LIMIT 1000');
  });
  it('limit option must be a positive integer', () => {
    expect(() => guardSql('SELECT 1', { limit: 0 })).toThrow(ZetarisGuardError);
    expect(() => guardSql('SELECT 1', { limit: 1.5 })).toThrow(ZetarisGuardError);
  });
});

describe('extractSources', () => {
  it('lists FROM/JOIN objects and skips CTE names and subqueries', () => {
    const sql = 'WITH x AS (SELECT * FROM edgar.company_financials) SELECT * FROM x JOIN company_dns.sic_codes_v4_table s ON 1=1 JOIN (SELECT 1) q ON 1=1';
    expect(extractSources(sql).sort()).toEqual(['company_dns.sic_codes_v4_table', 'edgar.company_financials']);
  });
  it('handles Lightning USL four-part names and aliases', () => {
    expect(extractSources('SELECT * FROM lightning.metastore.usl_demo.sic_edgar_usl.company c')).toEqual(['lightning.metastore.usl_demo.sic_edgar_usl.company']);
  });
});
