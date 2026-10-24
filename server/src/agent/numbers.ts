// Deterministic numeric audit: every number in a claim must appear (within display rounding, allowing unit
// rescaling) in the cited evidence rows, or be a simple derivation from two cited values
// (% change, share, difference, ratio, sum). Counts <= 10 and bare years are treated as context, not claims.

export interface ClaimNumber {
  raw: string;
  value: number;      // in base units (billion -> 1e9) or percent points for percentages
  percent: boolean;
  halfUnit: number;   // half of the last displayed digit, in the same units as value
}

const UNIT: Record<string, { mult: number; percent?: boolean; ratio?: boolean }> = {
  '%': { mult: 1, percent: true }, percent: { mult: 1, percent: true }, pp: { mult: 1, percent: true },
  'percentage point': { mult: 1, percent: true }, 'percentage points': { mult: 1, percent: true },
  bps: { mult: 0.01, percent: true }, 'basis points': { mult: 0.01, percent: true },
  x: { mult: 1, ratio: true }, '×': { mult: 1, ratio: true },
  trillion: { mult: 1e12 }, tn: { mult: 1e12 }, t: { mult: 1e12 },
  billion: { mult: 1e9 }, bn: { mult: 1e9 }, b: { mult: 1e9 },
  million: { mult: 1e6 }, mn: { mult: 1e6 }, mm: { mult: 1e6 }, m: { mult: 1e6 },
  thousand: { mult: 1e3 }, k: { mult: 1e3 },
};

const NUM_RE =
  /(\$)?\s?([-−]?)(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d+))?\s*(percentage points?|basis points|percent|bps|pp|%|trillion|billion|million|thousand|tn|bn|mn|mm|[tbmk×x](?![a-z]))?/gi;

export function extractClaimNumbers(text: string): ClaimNumber[] {
  const cleaned = text
    .replace(/\[[^\]]*\]/g, ' ')                       // citation chips [ev-1, ev-2]
    .replace(/(?:19|20)\d\d-\d\d-\d\d/g, ' ')        // ISO dates (period ends) are context, not claims
    .replace(/\b(?:ev|h|q|m|inv|c)-[\w-]+/gi, ' ')     // ids
    .replace(/\b(?:FY|CY|Q|H)\s?'?\d{1,4}\b/gi, ' ')   // FY2022, Q3, H1
    .replace(/\b(?:SIC|NAICS)\s*(?:code\s*)?\d+/gi, ' ');
  const out: ClaimNumber[] = [];
  for (const m of cleaned.matchAll(NUM_RE)) {
    const [raw, dollar, sign, intPart, dec, unitRaw] = m;
    const start = (m.index ?? 0) + (raw.length - raw.trimStart().length);
    const prev = cleaned[start - 1];
    if (prev && /[a-z_]/i.test(prev)) continue; // part of an identifier
    const unitKey = unitRaw?.toLowerCase().trim();
    const unit = unitKey ? UNIT[unitKey] : undefined;
    const base = Number(intPart.replace(/,/g, '') + (dec ? '.' + dec : ''));
    if (!Number.isFinite(base)) continue;
    const decimals = dec?.length ?? 0;
    if (!unit && !dollar && !dec && base >= 1900 && base <= 2100) continue; // a year
    if (!unit && !dollar && !dec && base <= 10) continue;                   // a count ("3 hypotheses")
    const mult = unit?.mult ?? 1;
    const value = (sign ? -1 : 1) * base * mult;
    out.push({ raw: raw.trim(), value, percent: !!unit?.percent, halfUnit: 0.5 * 10 ** -decimals * mult });
  }
  return out;
}

export function parseCell(cell: unknown): number | undefined {
  if (typeof cell === 'number') return Number.isFinite(cell) ? cell : undefined;
  if (typeof cell !== 'string') return undefined;
  const s = cell.trim().replace(/[$,%\s]/g, '');
  if (s === '' || !/^[-+]?\d*\.?\d+(e[-+]?\d+)?$/i.test(s)) return undefined;
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
}

const YEARISH_COL = /year|fy|date|period|quarter|month|^yr$/i;

export interface EvidenceTable { columns: string[]; rows: (string | number | null)[][] }

const SCALES = [1, 1e3, 1e6, 1e9, 1e12, 1e-3, 1e-6, 1e-9];

function close(target: number, candidate: number, tol: number): boolean {
  return Math.abs(Math.abs(target) - Math.abs(candidate)) <= tol;
}

export function checkClaimNumbers(text: string, tables: EvidenceTable[]): { ok: boolean; unsupported: string[]; checked: number } {
  const nums = extractClaimNumbers(text);
  const direct: number[] = [];
  const derivable: number[] = [];
  for (const t of tables) {
    for (const row of t.rows) {
      row.forEach((cell, i) => {
        const v = parseCell(cell);
        if (v === undefined) return;
        direct.push(v);
        if (!YEARISH_COL.test(t.columns[i] ?? '')) derivable.push(v);
      });
    }
  }
  const uniq = [...new Set(derivable)].slice(0, 400);
  const unsupported: string[] = [];
  for (const n of nums) {
    const tol = n.halfUnit * 1.0001 + 1e-9;
    let found = false;
    // direct (with unit rescaling; fractions shown as percents)
    for (const r of direct) {
      if (n.percent ? close(n.value, r, tol) || close(n.value, r * 100, tol) : SCALES.some((s) => close(n.value, r * s, tol))) {
        found = true;
        break;
      }
    }
    // derived from a pair of cited values
    outer: for (let i = 0; !found && i < uniq.length; i++) {
      for (let j = 0; j < uniq.length; j++) {
        if (i === j) continue;
        const a = uniq[i];
        const b = uniq[j];
        if (n.percent) {
          if (a !== 0 && (close(n.value, ((b - a) / a) * 100, tol) || close(n.value, (b / a) * 100, tol))) { found = true; break outer; }
          if (close(n.value, b - a, tol)) { found = true; break outer; } // percentage-point gap between two rates
        } else {
          const cands = [b - a, a + b, a !== 0 ? b / a : NaN];
          for (const c of cands) {
            if (Number.isFinite(c) && SCALES.some((s) => close(n.value, c * s, tol))) { found = true; break outer; }
          }
        }
      }
    }
    if (!found) unsupported.push(n.raw);
  }
  return { ok: unsupported.length === 0, unsupported, checked: nums.length };
}
