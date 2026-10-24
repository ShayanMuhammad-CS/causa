// Carried state for the Meterless Markovian loop (see src/markov/README.md). The engine keeps only this state
// between tool steps, so it must not lose what the verdict needs: every evidence id and its key numbers are kept
// verbatim in a deterministic ledger, merged with the model's own [STATE_CHECKPOINT] (REMAINING / DECISIONS).
// It is passed to the engine as marker-level state, which the engine accepts while it fits carryoverTokens.
import type { Evidence, Hypothesis, ToolCall } from '../types';

const CHECKPOINT = /\[STATE_CHECKPOINT\]\s*([\s\S]*)$/;

/** Split a model reply into its prose and its [STATE_CHECKPOINT] block (if any). */
export function splitCheckpoint(content: string): { text: string; checkpoint?: string } {
  const m = content.match(CHECKPOINT);
  if (!m) return { text: content.trim() };
  return { text: content.slice(0, m.index).trim(), checkpoint: m[1].trim() || undefined };
}

function field(block: string | undefined, name: string): string | undefined {
  const m = block?.match(new RegExp(`^\\s*${name}\\s*:\\s*(.+)$`, 'im'));
  return m?.[1]?.trim().slice(0, 300) || undefined;
}

const cell = (v: unknown) => (v === null || v === undefined ? 'null' : String(v));

/** One ledger line per evidence: id, purpose, columns and raw row values (exact numbers, no rounding). */
export function evidenceLedgerLine(ev: Evidence, maxChars = 520): string {
  const r = ev.result;
  const rows = r.rows.map((row) => row.map(cell).join(',')).join('; ');
  const line = `${ev.id} (${ev.purpose.slice(0, 90)}) cols[${r.columns.join(',')}] ${r.rowCount} row(s): ${rows}`;
  return line.length > maxChars ? `${line.slice(0, maxChars - 4)} ...` : line;
}

/** Compact rendering of one tool call + its result for the "latest tool results" slot. */
export function formatToolOutcome(call: ToolCall, content: string): string {
  let args = call.arguments;
  try {
    const a = JSON.parse(call.arguments || '{}') as Record<string, unknown>;
    args = Object.entries(a).map(([k, v]) => `${k}=${typeof v === 'string' ? v : JSON.stringify(v)}`).join(' | ');
  } catch {
    /* keep raw */
  }
  return `TOOL ${call.name} (${args.slice(0, 1500)}) -> ${content}`;
}

export function composeCarriedState(a: {
  hypothesis: Hypothesis;
  ledger: string[];
  checkpoint?: string;
  queriesLeft: number;
  lastError?: string;
  maxChars: number;
}): string {
  const remaining = field(a.checkpoint, 'REMAINING') ?? `decide the verdict for ${a.hypothesis.id} from the evidence`;
  const decisions = field(a.checkpoint, 'DECISIONS') ?? '-';
  const modelContext = field(a.checkpoint, 'CONTEXT');
  const context =
    `testing ${a.hypothesis.id}: ${a.hypothesis.statement.slice(0, 220)}; ${a.queriesLeft} query(ies) left` +
    (a.lastError ? `; last error: ${a.lastError.replace(/\s+/g, ' ').slice(0, 160)}` : '') +
    (modelContext ? `; ${modelContext}` : '');
  const build = (lines: string[]) =>
    `COMPLETED: ${lines.length ? lines.join('\n  ') : 'no evidence yet'}\nREMAINING: ${remaining}\nDECISIONS: ${decisions}\nCONTEXT: ${context}`;
  // Shrink the oldest ledger lines first (keep their ids + purpose) until the state fits the engine bound.
  const lines = [...a.ledger];
  let out = build(lines);
  for (let i = 0; out.length > a.maxChars && i < lines.length; i++) {
    lines[i] = lines[i].replace(/^(\S+ \([^)]*\)).*$/, '$1 [rows in evidence record]');
    out = build(lines);
  }
  return out.length > a.maxChars ? out.slice(0, a.maxChars) : out;
}
