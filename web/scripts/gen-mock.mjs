// Generates src/mock/events.json. MOCK DATA: hand-written, NOT a real recording.
// Replace src/mock/events.json with a real recording ({ t, event }[]) later.
import { writeFileSync } from 'node:fs';
const q = (id, sql, cols, rows, ms, source) => ({ queryId: `q-${id}`, sql, columns: cols, rows, rowCount: rows.length, elapsedMs: ms, source });
const contract = {
  id: 'ctr-7f3a91', issuedAt: '2026-10-24T09:14:02Z',
  intent: { intent: 'explain_metric_change', entities: ['Target', 'Walmart'], metrics: ['revenue growth'], timeRange: 'FY2022-FY2024', risk: 'low',
    riskReasons: ['read-only analytics question', 'no personal data referenced'] },
  allowedTools: ['zetaris.catalog', 'zetaris.query (SELECT only)', 'memory.recall', 'memory.remember'],
  budget: { maxQueries: 8, maxLlmCalls: 14, maxSeconds: 120 },
  stopConditions: ['all hypotheses resolved', 'budget exhausted', 'critic rejects all claims'],
  signature: 'hmac-sha256:9c41e07ab3d25f1e88c0a6174d2be93f50a7c61d',
};
const hits = [
  { id: 'mem-34', text: "Walmart FY2023 revenue growth (6.7%) was driven mainly by grocery and Sam's Club fuel pricing.", score: 0.88,
    provenance: { source: 'investigation #12, SQL q-34', confidence: 0.82, derivedFrom: ['ev-2'] } },
  { id: 'mem-51', text: 'Target discretionary categories (home, apparel) declined in 2022-2023 while food and beverage grew.', score: 0.79,
    provenance: { source: 'investigation #19, SQL q-77', confidence: 0.74, derivedFrom: ['ev-5'] } },
];
const hyps = [
  { id: 'h-1', statement: "Target's mix skews to discretionary goods, which fell as consumers shifted spend to groceries.", status: 'open', evidenceIds: [] },
  { id: 'h-2', statement: 'Walmart grew faster mainly through price inflation, not volume.', status: 'open', evidenceIds: [] },
  { id: 'h-3', statement: 'The gap is sector-wide: both firms share the same retail SIC peers and macro conditions.', status: 'open', evidenceIds: [] },
];
const S1 = "SELECT company, fiscal_year, revenue_usd_m FROM sic_edgar_usl.retail_revenue\nWHERE company IN ('TARGET CORP','WALMART INC') AND fiscal_year BETWEEN 2021 AND 2024\nORDER BY company, fiscal_year";
const ev1 = { id: 'ev-1', hypothesisId: 'h-3', purpose: 'Measure annual revenue for both firms to establish the growth gap.',
  result: q(101, S1, ['company', 'fiscal_year', 'revenue_usd_m'], [['TARGET CORP', 2021, 106005], ['TARGET CORP', 2022, 109120], ['TARGET CORP', 2023, 107412], ['TARGET CORP', 2024, 106566], ['WALMART INC', 2021, 559151], ['WALMART INC', 2022, 572754], ['WALMART INC', 2023, 611289], ['WALMART INC', 2024, 648125]], 842, ['SEC_DATA.edgar.target_revenue_facts', 'SEC_DATA.edgar.walmart_revenue_facts']),
  summary: 'Walmart revenue rose 13.2% FY2022-FY2024 ($572.8B to $648.1B); Target fell 2.3% ($109.1B to $106.6B) after peaking in FY2022.' };
const S2bad = 'SELECT category, SUM(net_sales) FROM sic_edgar_usl.target_segments GROUP BY category';
const S2 = 'SELECT segment, fiscal_year, sales_usd_m\nFROM SEC_DATA.edgar.target_segment_facts\nWHERE fiscal_year IN (2022, 2024)\nORDER BY segment, fiscal_year';
const ev2 = { id: 'ev-2', hypothesisId: 'h-1', purpose: 'Compare Target category sales (discretionary vs. essentials) FY2022 to FY2024.',
  result: q(102, S2, ['segment', 'fiscal_year', 'sales_usd_m'], [['Apparel & accessories', 2022, 18890], ['Apparel & accessories', 2024, 17110], ['Home furnishings', 2022, 18640], ['Home furnishings', 2024, 15980], ['Hardlines', 2022, 17180], ['Hardlines', 2024, 16240], ['Food & beverage', 2022, 24390], ['Food & beverage', 2024, 25870]], 1210, ['SEC_DATA.edgar.target_segment_facts']),
  summary: 'Discretionary segments fell $4.0B in total (apparel -9.4%, home -14.3%, hardlines -5.5%); food and beverage rose 6.1%.' };
const S3 = 'SELECT year, cpi_food_at_home, cpi_all_items\nFROM MACRO.cpi_rest.cpi_series\nWHERE year BETWEEN 2021 AND 2024';
const ev3 = { id: 'ev-3', hypothesisId: 'h-2', purpose: "Check whether food price inflation can explain Walmart's growth.",
  result: q(103, S3, ['year', 'cpi_food_at_home', 'cpi_all_items'], [[2021, 3.5, 4.7], [2022, 11.4, 8.0], [2023, 5.0, 4.1], [2024, 1.2, 2.9]], 397, ['MACRO.cpi_rest.cpi_series']),
  summary: 'Food-at-home CPI ran 11.4% in 2022 and 5.0% in 2023, above all-items inflation in both years.' };
const S4 = "SELECT c.company, s.sic_code, s.industry_title, r.fiscal_year, r.revenue_usd_m\nFROM company_dns.sic.company_sic s\nJOIN sic_edgar_usl.retail_revenue r ON r.company = s.company\nWHERE s.sic_code = '5331' AND r.fiscal_year IN (2022, 2024)";
const ev4 = { id: 'ev-4', hypothesisId: 'h-3', purpose: 'Compare against SIC 5331 (variety stores) peers to test the sector-wide explanation.',
  result: q(104, S4, ['company', 'sic_code', 'industry_title', 'fiscal_year', 'revenue_usd_m'], [['DOLLAR GENERAL CORP', '5331', 'Variety Stores', 2022, 37845], ['DOLLAR GENERAL CORP', '5331', 'Variety Stores', 2024, 40612], ['COSTCO WHOLESALE CORP', '5331', 'Variety Stores', 2022, 226954], ['COSTCO WHOLESALE CORP', '5331', 'Variety Stores', 2024, 254453]], 1633, ['company_dns.sic.company_sic', 'SEC_DATA.edgar.retail_revenue_facts']),
  summary: "Variety-store peers grew 7.3% (Dollar General) and 12.1% (Costco) over the same period, so Target's decline is not sector-wide." };
const hv = (i, status, ids) => ({ ...hyps[i], status, evidenceIds: ids });
const claims = [
  { text: "Target's discretionary mix is the main driver: apparel, home and hardlines sales fell $4.0B (FY2022 to FY2024) while Walmart's grocery-heavy mix kept growing.", confidence: 'high', evidenceIds: ['ev-2', 'ev-1'], verified: true },
  { text: 'The lag is company-specific, not sector-wide: variety-store peers grew 7-12% over the same period while Target shrank 2.3%.', confidence: 'high', evidenceIds: ['ev-4', 'ev-1'], verified: true },
  { text: "Food inflation inflated Walmart's top line (food-at-home CPI +11.4% in 2022), but it explains only part of the 13.2% gap.", confidence: 'medium', evidenceIds: ['ev-3'], verified: false, criticNote: 'Downgraded from high: CPI is a national series and the evidence has no Walmart grocery sales to quantify the effect.' },
];
const answer = { summary: "Target's growth lagged Walmart's mainly because Target is exposed to discretionary categories that shrank, while Walmart's grocery base held up. Peer data shows this is a company-specific gap.", claims };
const inv = { id: 'inv-demo', question: "Why did Target's revenue growth lag Walmart's from FY2022 to FY2024?", contract, recalled: hits,
  hypotheses: [hv(0, 'supported', ['ev-2']), hv(1, 'inconclusive', ['ev-3']), hv(2, 'refuted', ['ev-1', 'ev-4'])],
  evidence: [ev1, ev2, ev3, ev4], answer, rememberedIds: ['mem-90', 'mem-91'], status: 'done', startedAt: '2026-10-24T09:14:02Z', finishedAt: '2026-10-24T09:14:41Z' };
const T = [];
let t = 0; const at = (d, event) => { t += d; T.push({ t, event }); };
at(300, { type: 'contract', contract });
at(900, { type: 'recall', hits });
at(1100, { type: 'thinking', text: 'Reading Zetaris catalog: sic_edgar_usl, SEC_DATA.edgar, MACRO.cpi_rest, company_dns.sic. Proposing three competing hypotheses.' });
for (const h of hyps) at(500, { type: 'hypothesis', hypothesis: h });
at(900, { type: 'query_started', hypothesisId: 'h-3', sql: S1, purpose: ev1.purpose });
at(1400, { type: 'evidence', evidence: ev1 });
at(700, { type: 'query_started', hypothesisId: 'h-1', sql: S2bad, purpose: ev2.purpose });
at(1000, { type: 'query_failed', hypothesisId: 'h-1', sql: S2bad, attempt: 1, error: 'Table or view not found: sic_edgar_usl.target_segments (did you mean SEC_DATA.edgar.target_segment_facts?)' });
at(1200, { type: 'thinking', text: 'Query failed: table not found. Re-reading catalog, switching to SEC_DATA.edgar.target_segment_facts.' });
at(600, { type: 'query_started', hypothesisId: 'h-1', sql: S2, purpose: ev2.purpose });
at(1500, { type: 'evidence', evidence: ev2 });
at(500, { type: 'verdict', hypothesis: hv(0, 'supported', ['ev-2']) });
at(900, { type: 'query_started', hypothesisId: 'h-2', sql: S3, purpose: ev3.purpose });
at(1000, { type: 'evidence', evidence: ev3 });
at(500, { type: 'verdict', hypothesis: hv(1, 'inconclusive', ['ev-3']) });
at(800, { type: 'query_started', hypothesisId: 'h-3', sql: S4, purpose: ev4.purpose });
at(1700, { type: 'evidence', evidence: ev4 });
at(500, { type: 'verdict', hypothesis: hv(2, 'refuted', ['ev-1', 'ev-4']) });
at(1200, { type: 'thinking', text: 'Critic pass: checking every number in each claim against its cited rows.' });
at(1800, { type: 'answer', answer });
at(700, { type: 'remembered', ids: ['mem-90', 'mem-91'] });
at(300, { type: 'done', investigation: inv });
writeFileSync(new URL('../src/mock/events.json', import.meta.url), JSON.stringify({ _MOCK: 'MOCK DATA. Hand-written sample, not a real recording. Numbers are illustrative.', events: T }, null, 1));
console.log('events', T.length);
