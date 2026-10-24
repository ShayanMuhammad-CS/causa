// Meterless World Model inside the investigation (see src/world/README.md "How the agent should use it"):
//  1. seedWorldFromCatalog: companies come from the Zetaris catalog's company profile table (real SEC CIK, ticker,
//     SIC from EDGAR submissions), discovered through the catalog and read with a real query: no hard-coded CIKs.
//  2. extractEntityMentions: company names in the question are grounded with resolveEntity; names that do not
//     resolve are reported as unknown so the agent refuses to invent data for them.
//  3. observeEvidenceMetrics: every clearly identified metric row (company, metric, fiscal year, value) in an
//     Evidence record becomes a World Model fact with provenance {investigationId, evidenceId, queryId}.
import type { Evidence, ZetarisClient } from '../types';
import type { CompanyRef, WorldService } from '../world/index';
import { parseCell } from './numbers';

export type WorldEntity = { id: string; name: string; cik?: string; ticker?: string; sic?: string };

export function toWorldEntity(c: CompanyRef): WorldEntity {
  return { id: c.id, name: c.name, cik: c.cik, ...(c.ticker ? { ticker: c.ticker } : {}), ...(c.sic ? { sic: c.sic } : {}) };
}

const SUFFIX = /\b(incorporated|inc|corporation|corp|company|co|ltd|plc|holdings?)\b\.?/gi;

/** "TARGET CORP" -> "Target Corp"; "COSTCO WHOLESALE CORP /NEW" -> "Costco Wholesale Corp". */
export function displayName(raw: string): string {
  const s = raw.replace(/\s*\/[A-Z]{2,}\/?\s*$/i, '').trim();
  if (s !== s.toUpperCase()) return s;
  return s.toLowerCase().replace(/\b([a-z])/g, (m) => m.toUpperCase());
}

/** "Target Corp" -> "Target", "Tesla, Inc." -> "Tesla". */
export function shortName(name: string): string {
  return displayName(name).replace(/,/g, ' ').replace(SUFFIX, ' ').replace(/[.\s]+$/g, '').replace(/\s+/g, ' ').trim() || name;
}

/** Seed the World Model from the Zetaris catalog's company profile table. Returns the companies observed. */
export async function seedWorldFromCatalog(world: WorldService, zetaris: ZetarisClient): Promise<CompanyRef[]> {
  const catalog = await zetaris.catalog();
  const has = (cols: string[], c: string) => cols.includes(c);
  const table =
    catalog.find((t) => /(^|\.)company_profile$/i.test(t.fqName)) ??
    catalog.find((t) => {
      const cols = t.columns.map((c) => c.name.toLowerCase());
      return has(cols, 'cik') && has(cols, 'ticker') && (has(cols, 'sic_code') || has(cols, 'sic'));
    });
  if (!table) throw new Error('no company profile table (cik, ticker, sic_code) in the Zetaris catalog');
  const cols = table.columns.map((c) => c.name.toLowerCase());
  const sicCol = has(cols, 'sic_code') ? 'sic_code' : 'sic';
  const nameCol = has(cols, 'entity_name') ? 'entity_name' : has(cols, 'name') ? 'name' : 'ticker';
  const descCol = cols.find((c) => c === 'sic_description_edgar' || c === 'sic_description');
  const sql = `SELECT cik, ticker, ${nameCol} AS entity_name, ${sicCol} AS sic_code${descCol ? `, ${descCol} AS sic_description` : ''} FROM ${table.fqName}`;
  const r = await zetaris.query(sql, { limit: 2000, timeoutMs: 60_000 });
  const idx = (c: string) => r.columns.findIndex((x) => x.toLowerCase() === c);
  const [iCik, iTicker, iName, iSic, iDesc] = ['cik', 'ticker', 'entity_name', 'sic_code', 'sic_description'].map(idx);
  const out: CompanyRef[] = [];
  for (const row of r.rows) {
    const cik = String(row[iCik] ?? '').trim();
    if (!/^\d+$/.test(cik)) continue;
    const raw = String(row[iName] ?? row[iTicker] ?? cik);
    const sic = row[iSic] != null ? String(row[iSic]) : undefined;
    const desc = iDesc >= 0 && row[iDesc] != null ? String(row[iDesc]) : undefined;
    const name = displayName(raw);
    out.push(
      await world.observeCompany(
        {
          cik, name, ticker: row[iTicker] != null ? String(row[iTicker]) : undefined, sic, sicDescription: desc,
          peerGroup: sic ? `SIC ${sic}${desc ? ` ${desc}` : ''}` : undefined,
          aliases: [...new Set([raw, name, shortName(name)])],
        },
        { investigationId: 'seed', queryId: r.queryId },
      ),
    );
  }
  return out;
}

// Capitalised words that are not company names (question words, finance vocabulary, acronyms, months).
const STOP = new Set(
  `why what is are how did does do was were which who whom when where can could would should will please tell give find has have had
  in on at after before since during from to into over under between versus vs than and or but of for by with without the a an it its
  this that these those if explain compare show list describe analyze analyse assess revenue revenues sales margin margins growth
  profit profits profitability income earnings inflation consumer consumers retail retailer retailers sector sectors industry industries
  company companies market markets peer peers fiscal year years quarter quarters annual operating gross net total us usa america american
  u.s. united states fy cy yoy cpi gdp sic sec gaap xbrl usd edgar zetaris world bank january february march april may june july august
  september october november december jan feb mar apr jun jul aug sep sept oct nov dec slowdown squeeze lag decline drop rise`
    .split(/\s+/)
    .filter(Boolean),
);

const POSSESSIVE = /['’]s$/i;

/** Company mentions in a question, grounded through the World Model. Unknown = capitalised names that do not resolve. */
export function extractEntityMentions(question: string, world: WorldService, extra: string[] = []): { entities: CompanyRef[]; unknown: string[] } {
  const found = new Map<string, CompanyRef>();
  const unknown: string[] = [];
  const resolve = (s: string) => world.resolveEntity(s) ?? (POSSESSIVE.test(s) ? world.resolveEntity(s.replace(POSSESSIVE, '')) : null);

  // Runs of capitalised tokens, split at stopwords; tokens with digits (FY2022) break a run.
  const tokens = question.split(/\s+/).map((t) => t.replace(/^[^\w]+|[^\w'’.&]+$/g, '').replace(/\.$/, ''));
  const runs: string[][] = [];
  let cur: string[] = [];
  const flush = () => { if (cur.length) runs.push(cur); cur = []; };
  for (const t of tokens) {
    const bare = t.replace(POSSESSIVE, '');
    if (!t || /\d/.test(t) || !/^[A-Z]/.test(t) || STOP.has(bare.toLowerCase())) { flush(); continue; }
    cur.push(t);
    if (POSSESSIVE.test(t)) flush(); // "Target's revenue": the possessive ends the name
  }
  flush();

  for (const run of runs) {
    const phrase = run.join(' ');
    const allCaps = run.length === 1 && /^[A-Z.&]{1,5}$/.test(run[0].replace(POSSESSIVE, ''));
    if (allCaps && run[0].replace(POSSESSIVE, '').length < 2) continue;
    const hit = resolve(phrase);
    if (hit) { found.set(hit.id, hit); continue; }
    // a run of several names ("Target Walmart"): try each word
    const parts = run.length > 1 ? run.map(resolve).filter((x): x is CompanyRef => !!x) : [];
    if (parts.length) { for (const p of parts) found.set(p.id, p); continue; }
    if (allCaps) continue; // unresolved acronym (CPI, SIC, US...): not a company claim
    if (!unknown.includes(phrase)) unknown.push(phrase);
  }
  // Entities from Scout Intent are used only when they resolve (they may be sectors or metrics), and never when they
  // are a fragment of a name already grounded or reported ("General" inside "Dollar General's" is not General Motors).
  const covered = runs.map((r) => r.join(' ').toLowerCase());
  for (const e of extra) {
    const frag = e.trim().toLowerCase();
    if (frag.length < 2 || covered.some((c) => c.includes(frag))) continue;
    const hit = resolve(e);
    if (hit && !found.has(hit.id)) found.set(hit.id, hit);
  }
  return { entities: [...found.values()], unknown };
}

const METRIC_COL = /^(revenue|net_income|gross_profit|operating_income|cost_of_revenue|inventory)(_usd)?$/i;
const MARGIN_COL = /^(gross_margin|operating_margin)_pct$/i;
const pascal = (s: string) => s.replace(/_usd$|_pct$/i, '').split('_').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join('');

/**
 * World Model facts from one evidence record. Only rows that clearly identify company (ticker/cik), fiscal year and a
 * named metric are recorded. Returns the number of facts asserted.
 */
export async function observeEvidenceMetrics(world: WorldService, ev: Evidence, investigationId: string, max = 60): Promise<number> {
  const cols = ev.result.columns.map((c) => c.toLowerCase());
  const iCo = ['ticker', 'cik'].map((c) => cols.indexOf(c)).find((i) => i >= 0) ?? -1;
  const iYear = cols.indexOf('fiscal_year');
  if (iCo < 0 || iYear < 0) return 0;
  const iConcept = cols.indexOf('concept');
  const iValue = cols.findIndex((c) => c === 'value_usd' || c === 'value');
  const metricCols = cols.map((c, i) => ({ c, i })).filter(({ c }) => METRIC_COL.test(c) || MARGIN_COL.test(c));
  const prov = { investigationId, evidenceId: ev.id, queryId: ev.result.queryId };
  const cache = new Map<string, ReturnType<WorldService['resolveEntity']>>();
  let n = 0;
  for (const row of ev.result.rows) {
    if (n >= max) break;
    const key = String(row[iCo] ?? '');
    if (!cache.has(key)) cache.set(key, key ? world.resolveEntity(key) : null);
    const company = cache.get(key);
    const year = parseCell(row[iYear]);
    if (!company || year === undefined) continue;
    const facts: { metric: string; value: number; unit: string }[] = [];
    if (iConcept >= 0 && iValue >= 0) {
      const v = parseCell(row[iValue]);
      if (v !== undefined && row[iConcept]) facts.push({ metric: pascal(String(row[iConcept])), value: v, unit: 'USD' });
    }
    for (const { c, i } of metricCols) {
      const v = parseCell(row[i]);
      const margin = MARGIN_COL.test(c);
      if (v !== undefined) facts.push({ metric: margin ? `${pascal(c)}Pct` : pascal(c), value: v, unit: margin ? 'percent' : 'USD' });
    }
    for (const f of facts) {
      if (n >= max) break;
      await world.observeMetric(company.id, f.metric, `FY${year}`, f.value, prov, { unit: f.unit });
      n++;
    }
  }
  return n;
}
