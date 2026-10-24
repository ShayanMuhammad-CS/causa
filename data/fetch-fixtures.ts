// Fetches REAL data and writes normalised fixtures to server/fixtures/zetaris/.
//   npx tsx data/fetch-fixtures.ts     (run from causa/server or anywhere; paths are resolved from this file)
// SEC: User-Agent required, <= 5 req/s (we sleep 250 ms). World Bank: no key.
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  COMPANIES, CONCEPTS, SEC_USER_AGENT, SIC_V4_ENDPOINT, WB_INDICATORS, secFactsUrl, secSubmissionsUrl, wbUrl,
} from './lib/sources.js';
import { normalizeFinancials, type FinancialRow, type RawFact } from './lib/normalize.js';

const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../server/fixtures/zetaris');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function getJson(url: string, headers: Record<string, string> = {}): Promise<any> {
  for (let attempt = 1; attempt <= 3; attempt++) {
    const res = await fetch(url, { headers: { 'User-Agent': SEC_USER_AGENT, Accept: 'application/json', ...headers } });
    if (res.ok) return res.json();
    if (attempt === 3 || (res.status < 500 && res.status !== 429)) throw new Error(`GET ${url} -> HTTP ${res.status}`);
    await sleep(2000 * attempt);
  }
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const fetchedAt = new Date().toISOString();
  const financials: FinancialRow[] = [];
  const profiles: Record<string, unknown>[] = [];
  const tagsUsedByCompany: Record<string, Record<string, string[]>> = {};
  const availableTags: Record<string, string[]> = {};
  const wantedTags = new Set(CONCEPTS.flatMap((c) => c.tags));

  const sic = await getJson(SIC_V4_ENDPOINT);
  const sicRows: Record<string, string>[] = sic.data;
  if (!Array.isArray(sicRows) || sicRows.length < 900) throw new Error('unexpected SIC payload');
  const sicByClass = new Map(sicRows.map((r) => [r.class_id, r]));

  for (const co of COMPANIES) {
    const sub = await getJson(secSubmissionsUrl(co.cik)); await sleep(250);
    const facts = await getJson(secFactsUrl(co.cik)); await sleep(250);
    const entityName: string = facts.entityName;
    console.log(`${co.ticker}: submissions name="${sub.name}" sic=${sub.sic}`);
    const gaap = facts.facts?.['us-gaap'] ?? {};
    const factsByTag: Record<string, RawFact[]> = {};
    for (const tag of wantedTags) {
      const usd = gaap[tag]?.units?.USD as any[] | undefined;
      if (!usd) continue;
      factsByTag[tag] = usd.map((f) => ({ start: f.start, end: f.end, val: f.val, accn: f.accn, fy: f.fy, fp: f.fp, form: f.form, filed: f.filed, frame: f.frame }));
    }
    availableTags[co.ticker] = Object.keys(factsByTag);
    const { rows, tagsUsed } = normalizeFinancials(co, entityName, factsByTag, CONCEPTS);
    financials.push(...rows);
    tagsUsedByCompany[co.ticker] = tagsUsed;
    const ref = sicByClass.get(String(sub.sic));
    profiles.push({
      cik: sub.cik, ticker: co.ticker, entity_name: sub.name, sic_code: String(sub.sic),
      sic_description_edgar: sub.sicDescription, state_of_incorporation: sub.stateOfIncorporation ?? null,
      sic_description_reference: ref?.class_desc ?? null, division: ref?.section_id ?? null, division_desc: ref?.section_desc ?? null,
      major_group: ref?.division_id ?? null, major_group_desc: ref?.division_desc ?? null,
      industry_group: ref?.group_id ?? null, industry_group_desc: ref?.group_desc ?? null,
    });
  }

  const macro: Record<string, unknown>[] = [];
  for (const ind of WB_INDICATORS) {
    const body = await getJson(wbUrl(ind.id));
    for (const p of body[1] ?? []) {
      macro.push({ country_code: p.countryiso3code, indicator_id: p.indicator.id, indicator_name: p.indicator.value, year: Number(p.date), value: p.value });
    }
    await sleep(300);
  }

  const w = (name: string, data: unknown) => writeFile(path.join(OUT, name), JSON.stringify(data, null, 1) + '\n');
  await w('company_financials.json', financials);
  await w('company_profile.json', profiles);
  await w('sic_codes_v4_table.json', sicRows);
  await w('us_macro_indicators.json', macro.sort((a: any, b: any) => a.indicator_id.localeCompare(b.indicator_id) || a.year - b.year));
  await w('sources.json', {
    fetchedAt, secUserAgent: SEC_USER_AGENT,
    endpoints: { secFacts: 'https://data.sec.gov/api/xbrl/companyfacts/CIK{cik}.json', secSubmissions: 'https://data.sec.gov/submissions/CIK{cik}.json', sicV4: SIC_V4_ENDPOINT, worldBank: wbUrl('{indicator}') },
    companies: COMPANIES, availableTags, tagsUsed: tagsUsedByCompany,
    counts: { company_financials: financials.length, company_profile: profiles.length, sic_codes_v4_table: sicRows.length, us_macro_indicators: macro.length },
  });
  console.log('wrote fixtures to', OUT, { financials: financials.length, sic: sicRows.length, macro: macro.length });
}
main().catch((e) => { console.error(e); process.exit(1); });
