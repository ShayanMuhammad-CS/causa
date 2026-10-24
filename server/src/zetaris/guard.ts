// Read-only SQL guard shared by BOTH Zetaris clients (REST and fake). Deliberately conservative:
// anything it cannot positively classify as a single read-only statement is rejected.
//
// Design notes (each one closes a bypass in test/zetaris-guard.test.ts):
//  - Non-ASCII outside string literals is rejected: fullwidth/greek lookalikes of `;` or letters, zero-width
//    characters, NBSP and bidi controls never reach the engine. Non-ASCII inside string literals is fine.
//  - Backslashes are rejected everywhere outside comments: Spark treats `\'` as an escaped quote, DuckDB does
//    not, so a backslash makes the string boundary ambiguous between this scanner and the engine.
//  - Block comments are NOT nested here (`/* a /* b */`): ending a comment early only exposes more text to the
//    scanner, never hides text from it. `/*! ... */` (executable comment) is rejected.
//  - Denied keywords are matched as whole words outside string literals and quoted identifiers, anywhere in
//    the statement (so CTE-wrapped DML and `SELECT ... INTO` are caught).
//  - SHOW is limited to catalog-style subjects (SHOW AUTH / USERS ... can expose credentials).
//  - LIMIT is appended at the very end (not by wrapping in a subquery) so ORDER BY is preserved.
import { ZetarisGuardError } from './errors.js';

export interface GuardedSql { sql: string; kind: 'select' | 'show' | 'describe' }
export const DEFAULT_LIMIT = 1000;

type TokType = 'word' | 'number' | 'string' | 'qid' | 'punct';
interface Tok { t: TokType; v: string; start: number; depth: number }

const DENY_WORDS = new Set([
  'INSERT', 'UPDATE', 'DELETE', 'MERGE', 'CREATE', 'DROP', 'ALTER', 'GRANT', 'REVOKE', 'TRUNCATE', 'CACHE', 'UNCACHE',
  'REFRESH', 'COMPILE', 'ACTIVATE', 'REMOVE', 'REGISTER', 'MATERIALIZE', 'SET', 'UNSET', 'RESET', 'USE', 'LOAD', 'COPY',
  'ATTACH', 'DETACH', 'INSTALL', 'PRAGMA', 'EXPORT', 'IMPORT', 'CALL', 'EXEC', 'EXECUTE', 'INTO', 'OVERWRITE', 'ANALYZE',
  'MSCK', 'VACUUM', 'CHECKPOINT', 'RENAME', 'REPAIR', 'RUN', 'UPSERT',
]);
const DENY_FUNCS = [/^reflect$/i, /^try_reflect$/i, /^java_method$/i, /^query$/i, /^query_table$/i, /^glob$/i, /^getenv$/i,
  /^current_setting$/i, /^sniff_csv$/i, /^read_/i, /^parquet_/i, /^duckdb_/i, /^pragma_/i, /^http_/i];
const FILE_FORMATS = new Set(['PARQUET', 'CSV', 'JSON', 'ORC', 'TEXT', 'AVRO', 'DELTA', 'BINARYFILE', 'JDBC']);
const SHOW_SUBJECTS = new Set(['LIGHTNING', 'DATASOURCE', 'DATASOURCES', 'NAMESPACES', 'TABLES', 'DATABASES', 'SCHEMAS',
  'COLUMNS', 'VIEWS', 'SERVER', 'DQ', 'DATAMARTS', 'DATAMART']);
const FROM_END_KEYWORDS = new Set(['WHERE', 'JOIN', 'ON', 'GROUP', 'ORDER', 'LIMIT', 'UNION', 'INNER', 'LEFT', 'RIGHT', 'FULL',
  'CROSS', 'LATERAL', 'HAVING', 'WINDOW', 'USING', 'NATURAL', 'OUTER', 'EXCEPT', 'INTERSECT', 'SELECT', 'TABLESAMPLE', 'OFFSET']);

interface Scanned { out: string; tokens: Tok[] }

function reject(reason: string): never { throw new ZetarisGuardError(reason); }

/** Strip comments, collapse whitespace and tokenise. Throws on anything ambiguous. Token `start` indexes into `out`. */
function scan(input: string): Scanned {
  if (typeof input !== 'string') reject('SQL must be a string');
  const n = input.length;
  let out = '';
  const tokens: Tok[] = [];
  let depth = 0;
  const ws = () => { if (out.length && !out.endsWith(' ')) out += ' '; };
  let i = 0;
  while (i < n) {
    const c = input[i]!;
    const code = input.charCodeAt(i);
    if (code === 0) reject('NUL byte');
    // line comment
    if (c === '-' && input[i + 1] === '-') {
      const nl = input.indexOf('\n', i);
      i = nl === -1 ? n : nl;
      ws();
      continue;
    }
    // block comment (not nested, no executable /*! form)
    if (c === '/' && input[i + 1] === '*') {
      if (input[i + 2] === '!') reject('executable block comment /*! is not allowed');
      const end = input.indexOf('*/', i + 2);
      if (end === -1) reject('unterminated block comment');
      i = end + 2;
      ws();
      continue;
    }
    // whitespace: only space, tab, LF, CR
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') { ws(); i++; continue; }
    // quoted: string '...', identifier `...` or "..."; a doubled quote is an escape
    if (c === "'" || c === '`' || c === '"') {
      const start = out.length;
      let j = i + 1;
      let body: string = c;
      for (;;) {
        if (j >= n) reject('unterminated quoted string or identifier');
        const cj = input[j]!;
        const cc = input.charCodeAt(j);
        if (cc === 0 || (cc < 0x20 && cj !== '\t' && cj !== '\n' && cj !== '\r')) reject('control character in quoted text');
        if (cj === '\\') reject('backslash is not allowed (escape handling differs between engines)');
        body += cj;
        if (cj === c) {
          if (input[j + 1] === c) { body += c; j += 2; continue; }
          j++;
          break;
        }
        j++;
      }
      out += body;
      tokens.push({ t: c === "'" ? 'string' : 'qid', v: body, start, depth });
      i = j;
      continue;
    }
    // everything else must be printable ASCII
    if (code < 0x20 || code > 0x7e) reject(`disallowed character U+${code.toString(16).toUpperCase().padStart(4, '0')} outside a string literal`);
    if (c === '\\') reject('backslash is not allowed (escape handling differs between engines)');
    const start = out.length;
    if (/[A-Za-z_]/.test(c)) {
      let j = i + 1;
      while (j < n && /[A-Za-z0-9_$]/.test(input[j]!)) j++;
      const v = input.slice(i, j);
      out += v;
      tokens.push({ t: 'word', v, start, depth });
      i = j;
      continue;
    }
    if (/[0-9]/.test(c)) {
      let j = i + 1;
      while (j < n && /[0-9A-Za-z_.]/.test(input[j]!)) j++;
      const v = input.slice(i, j);
      out += v;
      tokens.push({ t: 'number', v, start, depth });
      i = j;
      continue;
    }
    if (c === '(') { tokens.push({ t: 'punct', v: c, start, depth }); depth++; }
    else if (c === ')') { depth--; if (depth < 0) reject('unbalanced parentheses'); tokens.push({ t: 'punct', v: c, start, depth }); }
    else tokens.push({ t: 'punct', v: c, start, depth });
    out += c;
    i++;
  }
  if (depth !== 0) reject('unbalanced parentheses');
  return { out: out.trimEnd(), tokens };
}

export function guardSql(sql: string, opts: { limit?: number } = {}): GuardedSql {
  const limit = opts.limit ?? DEFAULT_LIMIT;
  if (!Number.isInteger(limit) || limit < 1) reject('limit must be a positive integer');

  const scanned = scan(sql);
  let out = scanned.out;
  const tokens = [...scanned.tokens];

  // exactly one optional trailing semicolon
  const last = tokens[tokens.length - 1];
  if (last && last.t === 'punct' && last.v === ';') {
    tokens.pop();
    out = out.slice(0, last.start).trimEnd();
  }
  if (tokens.some((t) => t.t === 'punct' && t.v === ';')) reject('multiple statements are not allowed');
  if (tokens.length === 0) reject('empty statement');

  let k = 0;
  while (tokens[k]?.t === 'punct' && tokens[k]!.v === '(') k++;
  const first = tokens[k];
  if (!first || first.t !== 'word') reject('statement must start with SELECT, WITH, SHOW or DESCRIBE');
  const kw = first.v.toUpperCase();
  let kind: GuardedSql['kind'];
  if (kw === 'SELECT' || kw === 'WITH') kind = 'select';
  else if (kw === 'SHOW' && k === 0) kind = 'show';
  else if (kw === 'DESCRIBE' && k === 0) kind = 'describe';
  else return reject(`statement type ${kw} is not allowed (read-only: SELECT / WITH / SHOW / DESCRIBE)`);

  for (let idx = 0; idx < tokens.length; idx++) {
    const tk = tokens[idx]!;
    if (tk.t !== 'word') continue;
    const up = tk.v.toUpperCase();
    if (DENY_WORDS.has(up)) reject(`keyword ${up} is not allowed`);
    const next = tokens[idx + 1];
    if (next && next.v === '(' && DENY_FUNCS.some((re) => re.test(tk.v))) reject(`function ${tk.v} is not allowed`);
    if (FILE_FORMATS.has(up) && next?.v === '.' && (tokens[idx + 2]?.t === 'qid' || tokens[idx + 2]?.t === 'string')) {
      reject('querying files by path is not allowed');
    }
    if ((up === 'FROM' || up === 'JOIN') && next?.t === 'string') reject('querying files by path is not allowed');
  }

  if (kind === 'show') {
    const subject = tokens[1];
    if (!subject || subject.t !== 'word' || !SHOW_SUBJECTS.has(subject.v.toUpperCase())) {
      reject('only catalog SHOW statements are allowed (LIGHTNING, DATASOURCE(S), NAMESPACES, TABLES, SERVER ...)');
    }
    return { sql: out, kind };
  }
  if (kind === 'describe') {
    if (tokens.slice(1).some((t) => t.t === 'punct' && t.v !== '.')) reject('DESCRIBE accepts only an object name');
    return { sql: out, kind };
  }

  // LIMIT enforcement on the top-level query
  const topLimits = tokens.filter((t) => t.depth === 0 && t.t === 'word' && t.v.toUpperCase() === 'LIMIT');
  const hasTopOffset = tokens.some((t) => t.depth === 0 && t.t === 'word' && /^(OFFSET|FETCH)$/i.test(t.v));
  if (topLimits.length === 0) {
    if (hasTopOffset) reject('OFFSET/FETCH without LIMIT is not supported');
    return { sql: `${out} LIMIT ${limit}`, kind };
  }
  const lim = topLimits[topLimits.length - 1]!;
  const li = tokens.indexOf(lim);
  const num = tokens[li + 1];
  if (!num || num.t !== 'number' || !/^\d+$/.test(num.v)) reject('LIMIT must be an integer literal');
  const rest = tokens.slice(li + 2);
  const restOk = rest.length === 0 || (rest.length === 2 && rest[0]!.v.toUpperCase() === 'OFFSET' && rest[1]!.t === 'number' && /^\d+$/.test(rest[1]!.v));
  if (!restOk) reject('unsupported LIMIT placement (must be the final clause)');
  if (Number(num.v) <= limit) return { sql: out, kind };
  const tail = rest.length ? ` ${rest[0]!.v} ${rest[1]!.v}` : '';
  return { sql: `${out.slice(0, lim.start)}LIMIT ${limit}${tail}`, kind };
}

/** Lightning objects referenced by FROM/JOIN in an (already guarded) query, e.g. ["edgar.company_financials"]. */
export function extractSources(sql: string): string[] {
  let tokens: Tok[];
  try { tokens = scan(sql).tokens; } catch { return []; }
  const ctes = new Set<string>();
  for (let i = 0; i + 2 < tokens.length; i++) {
    const a = tokens[i]!, b = tokens[i + 1]!, c = tokens[i + 2]!;
    if (a.t === 'word' && b.t === 'word' && b.v.toUpperCase() === 'AS' && c.v === '(') {
      const prev = tokens[i - 1];
      if (prev && (prev.v.toUpperCase() === 'WITH' || prev.v === ',' || prev.v.toUpperCase() === 'RECURSIVE')) ctes.add(a.v.toLowerCase());
    }
  }
  const strip = (v: string) => v.replace(/^[`"]|[`"]$/g, '');
  const found = new Set<string>();
  const readName = (i: number): { name: string; next: number } | null => {
    const parts: string[] = [];
    let j = i;
    while (tokens[j] && (tokens[j]!.t === 'word' || tokens[j]!.t === 'qid')) {
      parts.push(strip(tokens[j]!.v));
      if (tokens[j + 1]?.v === '.') j += 2; else { j++; break; }
    }
    return parts.length ? { name: parts.join('.'), next: j } : null;
  };
  for (let i = 0; i < tokens.length; i++) {
    const tk = tokens[i]!;
    if (tk.t !== 'word' || !/^(FROM|JOIN)$/i.test(tk.v)) continue;
    let j = i + 1;
    for (;;) {
      if (tokens[j]?.v === '(') break;
      const r = readName(j);
      if (!r) break;
      if (!ctes.has(r.name.toLowerCase())) found.add(r.name);
      j = r.next;
      if (tokens[j]?.t === 'word' && tokens[j]!.v.toUpperCase() === 'AS') j += 2;
      else if (tokens[j]?.t === 'word' && !FROM_END_KEYWORDS.has(tokens[j]!.v.toUpperCase())) j++;
      if (tokens[j]?.v === ',') { j++; continue; }
      break;
    }
  }
  return [...found];
}
