// Normalisation of raw EDGAR facts into the rows our Zetaris views produce. The SQL in generate-sql.ts
// implements the same rules (form 10-K, fp FY, 350-380 day duration, dedupe per period_end), so the
// fixture tables equal what the onboarded views return (unverified against a live instance).
import type { Company, Concept } from './sources.js';

export interface RawFact { start?: string; end: string; val: number; accn: string; fy: number; fp: string; form: string; filed: string; frame?: string }

export interface FinancialRow {
  ticker: string; cik: number; entity_name: string; concept: string; xbrl_tag: string; fiscal_year: number;
  period_start: string | null; period_end: string; value_usd: number; form_type: string; filed_date: string; accession_number: string;
}

const DAY = 86_400_000;
const d = (s: string) => Date.parse(s + 'T00:00:00Z');

/** Calendar year in which most of the fiscal year falls: YEAR(period_end - 45 days). */
export function fiscalYear(periodEnd: string): number {
  return new Date(d(periodEnd) - 45 * DAY).getUTCFullYear();
}

export function isAnnualFact(f: RawFact, instant: boolean): boolean {
  if (f.form !== '10-K' || f.fp !== 'FY') return false;
  if (instant) return !f.start;
  if (!f.start) return false;
  const days = (d(f.end) - d(f.start)) / DAY;
  return days >= 350 && days <= 380;
}

export function normalizeFinancials(
  company: Company, entityName: string,
  factsByTag: Record<string, RawFact[]>, concepts: Concept[],
): { rows: FinancialRow[]; tagsUsed: Record<string, string[]> } {
  const rows: FinancialRow[] = [];
  const tagsUsed: Record<string, string[]> = {};
  for (const c of concepts) {
    const cands: (FinancialRow & { prio: number })[] = [];
    c.tags.forEach((tag, prio) => {
      for (const f of factsByTag[tag] ?? []) {
        if (!isAnnualFact(f, c.instant)) continue;
        cands.push({
          prio, ticker: company.ticker, cik: Number(company.cik), entity_name: entityName, concept: c.key, xbrl_tag: tag,
          fiscal_year: fiscalYear(f.end), period_start: f.start ?? null, period_end: f.end, value_usd: f.val,
          form_type: f.form, filed_date: f.filed, accession_number: f.accn,
        });
      }
    });
    // ROW_NUMBER() OVER (PARTITION BY ticker, concept, fiscal_year ORDER BY period_end DESC, tag priority, filed DESC) = 1
    // (period_end first: fiscal-year changes such as Best Buy 2012 or Ford 2016/2017 year-end dating would otherwise yield 2 rows per year)
    cands.sort((a, b) => a.fiscal_year - b.fiscal_year || b.period_end.localeCompare(a.period_end) || a.prio - b.prio || b.filed_date.localeCompare(a.filed_date));
    const seen = new Set<string>();
    const used = new Set<string>();
    for (const r of cands) {
      if (seen.has(String(r.fiscal_year))) continue;
      seen.add(String(r.fiscal_year));
      used.add(r.xbrl_tag);
      const { prio: _p, ...row } = r;
      rows.push(row);
    }
    if (used.size) tagsUsed[c.key] = [...used];
  }
  return { rows, tagsUsed };
}
