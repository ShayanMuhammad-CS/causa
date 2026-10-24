// Single definition of the tables Causa onboards into Zetaris. Used by:
//  - fake.ts           (DuckDB DDL + catalog + SHOW/DESCRIBE emulation, so SQL written for one mode runs in the other)
//  - data/generate-sql (column order of the CREATE SCHEMASTORE VIEW / ACTIVATE USL statements is checked against this)
//  - rest.ts           (annotateCatalog: Causa-side column descriptions, because the SQL docs show no column-comment
//                       syntax for schemastore views; descriptions are merged into the live catalog by name)
import type { CatalogTable } from '../types.js';

export type ColType = 'string' | 'int' | 'bigint' | 'double';
export interface ColDef { name: string; type: ColType; description: string }
export interface TableDef {
  fqName: string;               // name as queried in Lightning SQL
  duckdb: string;               // name inside the DuckDB fake
  origin: CatalogTable['origin'];
  description: string;
  fixture?: string;             // JSON file under fixtures/zetaris (base tables only)
  columns: ColDef[];
}

const c = (name: string, type: ColType, description: string): ColDef => ({ name, type, description });

export const TABLES: TableDef[] = [
  {
    fqName: 'edgar.company_financials', duckdb: 'edgar.company_financials', origin: 'schemastore', fixture: 'company_financials.json',
    description:
      'Annual (10-K, full fiscal year) US-GAAP financial facts from SEC EDGAR XBRL for 9 peers: Walmart, Target, Costco, Kroger, Dollar General, Best Buy (retail) and Ford, GM, Tesla (auto). One row per ticker, concept and fiscal year. Source: data.sec.gov companyconcept/companyfacts via Zetaris REST tables.',
    columns: [
      c('ticker', 'string', 'Stock ticker: WMT, TGT, COST, KR, DG, BBY, F, GM, TSLA.'),
      c('cik', 'bigint', 'SEC CIK as a bare integer (company_profile.cik is the zero-padded 10-char string: join with LPAD(CAST(cik AS STRING), 10, \'0\')).'),
      c('entity_name', 'string', 'Legal entity name as reported to the SEC.'),
      c('concept', 'string', 'Normalised metric: revenue, net_income, gross_profit, cost_of_revenue, inventory (balance-sheet date), operating_income. Not every company reports every concept.'),
      c('xbrl_tag', 'string', 'us-gaap tag the value came from (filers switch revenue tags: Revenues, RevenueFromContractWithCustomerExcludingAssessedTax, SalesRevenueNet).'),
      c('fiscal_year', 'int', 'Calendar year in which most of the fiscal year falls, = YEAR(period_end - 45 days). Retailers with a Jan/Feb year end therefore map to the prior calendar year (Walmart year ended 2023-01-31 is 2022), which aligns them with Dec-year-end peers.'),
      c('period_start', 'string', 'ISO date (yyyy-MM-dd) the fiscal period began; NULL for balance-sheet (instant) concepts such as inventory.'),
      c('period_end', 'string', 'ISO date (yyyy-MM-dd) the fiscal period ended.'),
      c('value_usd', 'double', 'Value in US dollars (not millions). Net income and operating income can be negative.'),
      c('form_type', 'string', 'SEC form, always 10-K here.'),
      c('filed_date', 'string', 'ISO date the filing was submitted; the latest filing wins when a period was restated.'),
      c('accession_number', 'string', 'SEC accession number of the filing: the audit trail back to the source document.'),
    ],
  },
  {
    fqName: 'edgar.company_profile', duckdb: 'edgar.company_profile', origin: 'schemastore', fixture: 'company_profile.json',
    description:
      'One row per peer company: EDGAR submissions profile (name, SIC code, state of incorporation) enriched with the company_dns SIC hierarchy. LEFT JOIN, so a SIC code missing from the reference (IBM 3570 in the vendor recipes) shows NULL hierarchy columns instead of silently dropping the company.',
    columns: [
      c('cik', 'string', 'Zero-padded 10-character CIK string (edgar.company_financials.cik is the bare integer).'),
      c('ticker', 'string', 'Stock ticker.'),
      c('entity_name', 'string', 'Company name per EDGAR submissions, as filed (often UPPERCASE, e.g. FORD MOTOR CO; company_financials.entity_name uses the XBRL entity name instead). Join on ticker, not on name.'),
      c('sic_code', 'string', '4-digit Standard Industrial Classification code assigned by the SEC, e.g. 5331 Variety Stores, 3711 Motor Vehicles.'),
      c('sic_description_edgar', 'string', 'SIC description as worded by EDGAR.'),
      c('state_of_incorporation', 'string', 'US state / jurisdiction code of incorporation; may be empty.'),
      c('sic_description_reference', 'string', 'SIC description from the company_dns reference hierarchy.'),
      c('division', 'string', 'SIC division letter (top level, e.g. G Retail Trade, D Manufacturing).'),
      c('division_desc', 'string', 'SIC division name.'),
      c('major_group', 'string', 'SIC 2-digit major group.'),
      c('major_group_desc', 'string', 'SIC major group name.'),
      c('industry_group', 'string', 'SIC 3-digit industry group.'),
      c('industry_group_desc', 'string', 'SIC industry group name.'),
    ],
  },
  {
    fqName: 'company_dns.sic_codes_v4_table', duckdb: 'company_dns.sic_codes_v4_table', origin: 'schemastore', fixture: 'sic_codes_v4_table.json',
    description: 'SIC hierarchy reference (1,005 codes) from company_dns V4 with V4 column names: section > division > group > class. Use this to ask whether two companies share an industry.',
    columns: [
      c('section_id', 'string', 'Top-level letter (V3 name: division).'),
      c('section_desc', 'string', 'Top-level name, e.g. Manufacturing, Retail Trade.'),
      c('division_id', 'string', '2-digit level (V3 name: major_group).'),
      c('division_desc', 'string', '2-digit level name (NOT the letter level: V3 used division_desc for that).'),
      c('group_id', 'string', '3-digit level (V3 name: industry_group).'),
      c('group_desc', 'string', '3-digit level name.'),
      c('class_id', 'string', '4-digit SIC code (V3 name: sic_code).'),
      c('class_desc', 'string', '4-digit SIC description.'),
    ],
  },
  {
    fqName: 'company_dns.sic_codes_v4_compat_table', duckdb: 'company_dns.sic_codes_v4_compat_table', origin: 'schemastore',
    description: 'Same 1,005 SIC codes as sic_codes_v4_table behind the V3 column names (sic_code, division, major_group, industry_group). Column order matches the vendor recipe 12_company_dns_create.sql.',
    columns: [
      c('sic_code', 'string', '4-digit SIC code.'),
      c('description', 'string', '4-digit SIC description.'),
      c('division', 'string', 'Top-level letter.'),
      c('division_desc', 'string', 'Top-level name (letter level, V3 meaning).'),
      c('major_group', 'string', '2-digit level.'),
      c('major_group_desc', 'string', '2-digit level name.'),
      c('industry_group', 'string', '3-digit level.'),
      c('industry_group_desc', 'string', '3-digit level name.'),
    ],
  },
  {
    fqName: 'worldbank.us_macro_indicators', duckdb: 'worldbank.us_macro_indicators', origin: 'schemastore', fixture: 'us_macro_indicators.json',
    description: 'US macroeconomic indicators 2015-2025 from the World Bank API (annual): CPI inflation, household consumption growth, real GDP growth. Use it to test whether a company slowdown is sector/macro-wide.',
    columns: [
      c('country_code', 'string', 'ISO3 country code, USA.'),
      c('indicator_id', 'string', 'World Bank indicator id: FP.CPI.TOTL.ZG (CPI inflation %), NE.CON.PRVT.KD.ZG (household consumption growth %), NY.GDP.MKTP.KD.ZG (real GDP growth %).'),
      c('indicator_name', 'string', 'Indicator label.'),
      c('year', 'int', 'Calendar year.'),
      c('value', 'double', 'Annual percentage; NULL when not yet published (recent years).'),
    ],
  },
  {
    fqName: 'lightning.metastore.usl_demo.sic_edgar_usl.company', duckdb: 'sic_edgar_usl.company', origin: 'usl',
    description: 'USL model sic_edgar_usl, table company: peer companies with CIK, ticker, name and SIC code (semantic layer over EDGAR submissions). FK sic -> sic_code.sic_code.',
    columns: [
      c('cik', 'string', 'Zero-padded 10-character CIK.'),
      c('ticker', 'string', 'Stock ticker.'),
      c('entity_name', 'string', 'Company name.'),
      c('sic', 'string', '4-digit SIC code (FK to sic_code.sic_code).'),
      c('sic_description_edgar', 'string', 'SIC description as worded by EDGAR.'),
    ],
  },
  {
    fqName: 'lightning.metastore.usl_demo.sic_edgar_usl.sic_code', duckdb: 'sic_edgar_usl.sic_code', origin: 'usl',
    description: 'USL model sic_edgar_usl, table sic_code: SIC hierarchy reference (same content as company_dns.sic_codes_v4_compat_table).',
    columns: [
      c('sic_code', 'string', '4-digit SIC code (primary key).'),
      c('description', 'string', 'SIC description.'),
      c('division', 'string', 'Top-level letter.'),
      c('division_desc', 'string', 'Top-level name.'),
      c('major_group', 'string', '2-digit level.'),
      c('major_group_desc', 'string', '2-digit level name.'),
      c('industry_group', 'string', '3-digit level.'),
      c('industry_group_desc', 'string', '3-digit level name.'),
    ],
  },
];

/** Raw REST tables that exist in real Zetaris (not materialised in the fake). Filled by data/lib/raw-tables for README/tests. */
export const LIGHTNING_DATABASES = [
  { name: 'SEC_DATA', description: 'SEC EDGAR XBRL company facts and submissions REST source' },
  { name: 'COMPANY_DNS', description: 'company_dns SIC reference data REST source' },
  { name: 'WORLDBANK_REST', description: 'World Bank macro indicators REST source' },
];

export const USL_NAMESPACE = 'lightning.metastore.usl_demo';
export const USL_MODEL = 'sic_edgar_usl';

const byName = new Map(TABLES.map((t) => [t.fqName.toLowerCase(), t]));
export const findTable = (fq: string) => byName.get(fq.toLowerCase());

/** Causa-side semantic annotations merged into a live catalog (adds descriptions where Zetaris returned none). */
export function annotateCatalog(tables: CatalogTable[]): CatalogTable[] {
  return tables.map((t) => {
    const def = findTable(t.fqName);
    if (!def) return t;
    return {
      ...t,
      description: t.description ?? def.description,
      columns: t.columns.map((col) => {
        const d = def.columns.find((x) => x.name.toLowerCase() === col.name.toLowerCase());
        return d && !col.description ? { ...col, description: d.description } : col;
      }),
    };
  });
}

export function toCatalogTable(def: TableDef): CatalogTable {
  return {
    fqName: def.fqName, description: def.description, origin: def.origin,
    columns: def.columns.map((x) => ({ name: x.name, type: x.type, description: x.description })),
  };
}
