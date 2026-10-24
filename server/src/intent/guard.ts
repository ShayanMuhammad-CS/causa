// Guard stage (Scout Intent AGENTS.md section 6, docs/risk-and-policy.md): deterministic, no model.
// Layers implemented: 1 injection check, 2/3 policy+scope reduced to "read-only analytics only",
// 4 PII / credentials. Layer 5 (rate limit) is out of scope for a single-user demo.
// Aggregate output follows section 6: { level, flags, redactions, reason }. Our contract type names the
// top level 'blocked' where the spec says 'block'.
import type { RiskLevel } from '../types';

export type GuardVerdict = 'pass' | 'warn' | 'block';
export interface GuardFlag { layer: 'injection' | 'policy' | 'pii'; kind: string; verdict: GuardVerdict; reason: string }
export interface GuardResult { level: RiskLevel; flags: GuardFlag[]; reasons: string[]; redactions: string[]; redacted: string }

// Out-of-band tool references (s6.1): tools Causa knows; anything else named like a tool is out of scope.
const KNOWN_TOOL_WORDS = new Set(['zetaris_query', 'memory_recall']);

const INJECTION: [string, RegExp][] = [
  ['instruction-override', /\b(ignore|disregard|forget|override)\b[^.\n]{0,40}\b(previous|prior|above|earlier|all|any|the)\b[^.\n]{0,30}\b(instructions?|rules?|prompts?|guidelines?|polic(y|ies))\b/i],
  ['instruction-override', /\bdisregard (the )?user\b/i],
  ['role-drift', /\byou are now\b|\b(unrestricted|jailbreak|developer|dan) mode\b|\bpretend (to be|you are)\b|\bact as (the )?(system|admin|root)\b/i],
  ['role-confusion', /<\/?\s*(system|user|assistant)\s*>|\[\/?INST\]|<<\/?SYS>>|<\|im_(start|end)\|>/i],
  ['prompt-exfil', /\b(reveal|show|print|repeat|leak)\b[^.\n]{0,30}\b(system|hidden|initial) (prompt|instructions?)\b/i],
  ['privilege-grant', /\bgrant (me|us)\b[^.\n]{0,20}\b(admin|root|superuser|access|privileges?)\b/i],
  // bidi/zero-width control characters, real or spelled out as an escape sequence
  ['control-chars', /[\u202A-\u202E\u2066-\u2069\u200B-\u200F\u2060\uFEFF]|\\u(202[A-E]|206[6-9]|200[B-F]|2060|FEFF)/i],
];

const WRITE_DDL: [string, RegExp][] = [
  ['ddl', /\b(drop|truncate)\s+(table|database|schema|index|view|column|catalog)\b/i],
  ['ddl', /\b(alter|create)\s+(table|database|schema|index|view|user|role)\b/i],
  ['write', /\bdelete\b/i],
  ['write', /\binsert\s+into\b|\bupdate\s+\w+(\.\w+)*\s+set\b|\bmerge\s+into\b|\bupsert\b/i],
  ['write', /\b(overwrite|wipe|erase|purge)\b/i],
  ['privilege', /\b(grant|revoke)\s+\w+/i],
];

const EXFIL: RegExp[] = [
  /\b(export|dump|download|extract|exfiltrate|email|send|list|give me|show me)\s+(me\s+)?(all|every|each|the entire|the whole|full)\b[^.\n]{0,40}\b(customers?|users?|employees?|clients?|accounts?|e-?mails?|records?|contacts?|ssns?|passwords?|phone numbers?)\b/i,
  /\b(send|email|upload|post|forward)\b[^.\n]{0,60}\b(to|at)\b[^.\n]{0,30}(@|https?:\/\/|\bftp\b)/i,
];

const CREDENTIALS =
  /\b(reveal|show|give|print|list|dump|tell|share|leak|steal|get)\b[^.\n]{0,40}\b(api[ _-]?keys?|passwords?|secrets?|tokens?|credentials?|private keys?|connection strings?)\b/i;

const PII: [string, RegExp][] = [
  ['email', /\b[\w.+-]+@[\w-]+(\.[\w-]+)+\b/],
  ['ssn', /\b\d{3}-\d{2}-\d{4}\b/],
  ['credit-card', /\b(?:\d[ -]?){13,16}\b/],
  ['phone', /(?<!\d)(\+?\d{1,2}[ -.]?)?\(?\d{3}\)?[ -.]\d{3}[ -.]\d{4}(?!\d)/],
];

export function guard(question: string): GuardResult {
  const flags: GuardFlag[] = [];
  const redactions: string[] = [];
  const text = question;

  for (const [kind, re] of INJECTION) {
    if (re.test(text)) flags.push({ layer: 'injection', kind, verdict: 'block', reason: `prompt-injection pattern (${kind})` });
  }
  // Out-of-band tool reference: "use internal_admin_panel", "call foo_bar".
  for (const m of text.matchAll(/\b(?:use|call|invoke|run|via|through)\s+([a-z]+(?:_[a-z0-9]+)+)\b/gi)) {
    if (!KNOWN_TOOL_WORDS.has(m[1].toLowerCase())) {
      flags.push({ layer: 'injection', kind: 'tool-ref', verdict: 'block', reason: `out-of-band tool reference (${m[1]})` });
    }
  }
  for (const [kind, re] of WRITE_DDL) {
    if (re.test(text)) flags.push({ layer: 'policy', kind, verdict: 'block', reason: `${kind === 'ddl' ? 'DDL' : kind} action requested; Causa is read-only` });
  }
  for (const re of EXFIL) {
    if (re.test(text)) flags.push({ layer: 'policy', kind: 'exfiltration', verdict: 'block', reason: 'bulk data export / exfiltration request' });
  }
  if (CREDENTIALS.test(text)) flags.push({ layer: 'policy', kind: 'credentials', verdict: 'block', reason: 'request for credentials or secrets' });

  let redacted = text;
  for (const [kind, re] of PII) {
    const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
    if (g.test(text)) {
      flags.push({ layer: 'pii', kind, verdict: 'warn', reason: `PII detected (${kind})` });
      redactions.push(kind);
      redacted = redacted.replace(g, `[REDACTED:${kind}]`);
    }
  }

  const blocked = flags.some((f) => f.verdict === 'block');
  const warned = flags.some((f) => f.verdict === 'warn');
  const level: RiskLevel = blocked ? 'blocked' : warned ? 'medium' : 'low';
  const reasons = [...new Set(flags.map((f) => f.reason))];
  return { level, flags, reasons, redactions, redacted };
}
