// Port of scripts/zetaris_sql.py split_statements/_push (vendor repo, lines 104-153): split on semicolons outside
// quotes, drop comments, and keep a multi-table COMPILE USL whole (a CREATE TABLE after COMPILE USL is merged back).
export function splitStatements(text: string): string[] {
  const statements: string[] = [];
  let buf = '';
  let quote: string | null = null;
  const push = (raw: string) => {
    const stmt = raw.trim();
    if (!stmt) return;
    const prev = statements[statements.length - 1];
    if (stmt.toUpperCase().startsWith('CREATE TABLE') && prev && prev.toUpperCase().startsWith('COMPILE USL')) {
      statements[statements.length - 1] = `${prev};\n${stmt}`;
    } else statements.push(stmt);
  };
  let i = 0;
  const n = text.length;
  while (i < n) {
    const c = text[i]!;
    if (quote) {
      buf += c;
      if (c === quote) quote = null;
    } else if (c === "'" || c === '"' || c === '`') {
      quote = c;
      buf += c;
    } else if (text.startsWith('--', i)) {
      while (i < n && text[i] !== '\n') i++;
      continue;
    } else if (text.startsWith('/*', i)) {
      const end = text.indexOf('*/', i + 2);
      i = end === -1 ? n : end + 2;
      continue;
    } else if (c === ';') {
      push(buf);
      buf = '';
    } else buf += c;
    i++;
  }
  push(buf);
  return statements;
}

export const PLACEHOLDER_UA = 'YOUR_APP_NAME YOUR_CONTACT_EMAIL';
const UA_FORMAT = /^\S.*\s[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Mirrors zetaris_sql.apply_user_agent (lines 156-190): fill the placeholder; refuse vague or quoted values. */
export function applyUserAgent(statements: string[], ua: string | undefined): string[] {
  if (!statements.some((s) => s.includes(PLACEHOLDER_UA))) return statements;
  const v = (ua ?? '').trim();
  if (!v) throw new Error(`Statements contain the placeholder '${PLACEHOLDER_UA}'. Set ZETARIS_USER_AGENT to 'app_name user@domain.tld'.`);
  if (v.includes('"') || v.includes("'")) throw new Error('ZETARIS_USER_AGENT must not contain quotes.');
  if (!UA_FORMAT.test(v)) throw new Error("ZETARIS_USER_AGENT does not identify you: use 'app_name user@domain.tld'.");
  return statements.map((s) => s.split(PLACEHOLDER_UA).join(v));
}
