// Shared source definitions for fixtures (fetch-fixtures.ts), the SQL generator (generate-sql.ts)
// and tests. Single source of truth so the fake client's tables and the onboarding SQL cannot drift.

export interface Company { ticker: string; slug: string; cik: string; name: string; sector: 'retail' | 'auto' }

// CIKs are checked against the live submissions endpoint by fetch-fixtures.ts (it fails if the name differs).
export const COMPANIES: Company[] = [
  { ticker: 'WMT', slug: 'walmart', cik: '0000104169', name: 'Walmart Inc.', sector: 'retail' },
  { ticker: 'TGT', slug: 'target', cik: '0000027419', name: 'Target Corp', sector: 'retail' },
  { ticker: 'COST', slug: 'costco', cik: '0000909832', name: 'Costco Wholesale Corp', sector: 'retail' },
  { ticker: 'KR', slug: 'kroger', cik: '0000056873', name: 'Kroger Co', sector: 'retail' },
  { ticker: 'DG', slug: 'dollar_general', cik: '0000029534', name: 'Dollar General Corp', sector: 'retail' },
  { ticker: 'BBY', slug: 'best_buy', cik: '0000764478', name: 'Best Buy Co., Inc.', sector: 'retail' },
  { ticker: 'F', slug: 'ford', cik: '0000037996', name: 'Ford Motor Co', sector: 'auto' },
  { ticker: 'GM', slug: 'gm', cik: '0001467858', name: 'General Motors Co', sector: 'auto' },
  { ticker: 'TSLA', slug: 'tesla', cik: '0001318605', name: 'Tesla, Inc.', sector: 'auto' },
];

export interface Concept { key: string; description: string; instant: boolean; tags: string[] /* priority order */ }

// us-gaap tags per normalized concept. Order = priority when a company reports several for one period
// (recipe 01_edgar_company_facts_create.sql caveat 1: filers switch revenue tags around ASC 606).
export const CONCEPTS: Concept[] = [
  { key: 'revenue', description: 'Total revenue', instant: false,
    tags: ['Revenues', 'RevenueFromContractWithCustomerExcludingAssessedTax', 'SalesRevenueNet'] },
  { key: 'net_income', description: 'Net income (loss)', instant: false, tags: ['NetIncomeLoss'] },
  { key: 'gross_profit', description: 'Gross profit', instant: false, tags: ['GrossProfit'] },
  { key: 'cost_of_revenue', description: 'Cost of revenue / cost of goods sold', instant: false,
    tags: ['CostOfRevenue', 'CostOfGoodsAndServicesSold'] },
  { key: 'inventory', description: 'Inventory, net (balance sheet date)', instant: true, tags: ['InventoryNet'] },
  { key: 'operating_income', description: 'Operating income (loss)', instant: false, tags: ['OperatingIncomeLoss'] },
];

export const WB_INDICATORS = [
  { id: 'FP.CPI.TOTL.ZG', name: 'Inflation, consumer prices (annual %)' },
  { id: 'NE.CON.PRVT.KD.ZG', name: 'Households and NPISHs final consumption expenditure (annual % growth)' },
  { id: 'NY.GDP.MKTP.KD.ZG', name: 'GDP growth (annual %)' },
];
export const WB_COUNTRY = 'USA';
export const WB_DATE_RANGE = '2015:2025';

export const SEC_USER_AGENT = 'Causa-hackathon causa.demo@example.com';
export const SIC_V4_ENDPOINT = 'https://company-dns.mediumroast.io/V4.0/na/sic/code/%25';
export const secConceptUrl = (cik: string, tag: string) => `https://data.sec.gov/api/xbrl/companyconcept/CIK${cik}/us-gaap/${tag}.json`;
export const secFactsUrl = (cik: string) => `https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`;
export const secSubmissionsUrl = (cik: string) => `https://data.sec.gov/submissions/CIK${cik}.json`;
export const wbUrl = (indicator: string) =>
  `https://api.worldbank.org/v2/country/${WB_COUNTRY}/indicator/${indicator}?format=json&date=${WB_DATE_RANGE}&per_page=100`;

/** Short ids used in Lightning object names (raw REST table `<slug>_<short>_facts`, stage view `<slug>_<short>_stage`). */
export const TAG_SHORT: Record<string, string> = {
  Revenues: 'revenues',
  RevenueFromContractWithCustomerExcludingAssessedTax: 'rfc_revenue',
  SalesRevenueNet: 'sales_revenue_net',
  NetIncomeLoss: 'net_income',
  GrossProfit: 'gross_profit',
  CostOfRevenue: 'cost_of_revenue',
  CostOfGoodsAndServicesSold: 'cogs',
  InventoryNet: 'inventory_net',
  OperatingIncomeLoss: 'operating_income',
};

export const wbShort = (indicatorId: string) => indicatorId.toLowerCase().replace(/\./g, '_');
