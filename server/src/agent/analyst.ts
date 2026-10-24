// SAMPLE_MODE deterministic analyst: the model stand-in used when SAMPLE_MODE=true and Meterless Nightshift has no
// usable model. It is NOT a replay of saved answers: it runs inside the same investigation loop (contract, budget,
// World Model, Markovian, critic), parses the question and the grounded entities, writes real analytic SQL against
// the tables it finds in the Zetaris catalog, decides each hypothesis with explicit numeric rules, and builds claims
// whose numbers are copied from (or simply derived from) the returned rows, so the deterministic critic can check them.
//
// Hypotheses (company-specific vs sector-wide vs macro, plus a margin angle) and their rules:
//   revenue questions: company_growth, sector_growth, macro_demand, margin_tradeoff
//   margin questions:  company_margin, sector_margin, cost_mix, macro_inflation
// Fiscal years: edgar.company_financials.fiscal_year = YEAR(period_end - 45 days), so claims cite each period's END
// DATE ("FY ending 2025-01-31") instead of a company's own fiscal-year label.
import type { ChatMessage, ToolCall } from '../types';
import type { CausaChatResponse, CausaLLM } from '../llm/nim';
import { fakeEmbedding } from '../llm/fake';
import { checkClaimNumbers, parseCell } from './numbers';
import { PHASE } from './prompts';
import { shortName } from './world';

export const SAMPLE_ANALYST_MODEL = 'causa/sample-analyst';

type Cell = string | number | null;
interface Table { columns: string[]; rows: Cell[][] }
interface Ent { name: string; ticker: string; cik?: string; sic?: string }
type Metric = 'revenue' | 'margin';
type Kind = 'company_growth' | 'sector_growth' | 'macro_demand' | 'margin_tradeoff' | 'company_margin' | 'sector_margin' | 'cost_mix' | 'macro_inflation';
interface Spec { kind: Kind; focus?: string; named: string[]; sic: string[]; from?: number; to?: number }
type Status = 'supported' | 'refuted' | 'inconclusive';
interface Assessment { status: Status; rationale: string; claims: string[] }
interface Ctx { focus?: Ent; entities: Ent[]; sic: string }

// ---------- parsing ----------
function jsonLines(text: string, prefix: string): any[] {
  const out: any[] = [];
  for (const line of text.split('\n')) {
    if (!line.startsWith(prefix + ' ')) continue;
    try {
      out.push(JSON.parse(line.slice(prefix.length + 1)));
    } catch {
      /* ignore */
    }
  }
  return out;
}

const entitiesOf = (text: string): Ent[] => jsonLines(text, 'ENTITY').filter((e) => e && typeof e.ticker === 'string');

export function metricOf(question: string): Metric {
  return /margin|profitab|squeeze|\bcosts?\b/i.test(question) ? 'margin' : 'revenue';
}

/** Years in the question, read as edgar fiscal_year labels. */
export function yearsOf(question: string): { from?: number; to?: number } {
  const range = /(?:FY\s?)?((?:19|20)\d\d)\s*(?:-|–|to|through|until|and)\s*(?:FY\s?)?((?:19|20)\d\d)\b/i.exec(question);
  if (range) {
    const [a, b] = [Number(range[1]), Number(range[2])].sort((x, y) => x - y);
    return { from: a, to: b === a ? a + 1 : b };
  }
  const after = /\b(?:after|since|from)\s+(?:FY\s?)?((?:19|20)\d\d)\b/i.exec(question);
  if (after) return { from: Number(after[1]) };
  const single = /\b(?:in|during|for)\s+(?:FY\s?)?((?:19|20)\d\d)\b/i.exec(question);
  if (single) return { from: Number(single[1]) - 1, to: Number(single[1]) };
  return {};
}

const q = (s: string) => `'${s.replace(/[^A-Za-z0-9.\-]/g, '')}'`;
const num = (v: unknown) => parseCell(v);
const mean = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : undefined);
function median(xs: number[]): number | undefined {
  if (!xs.length) return undefined;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
const fmtB = (usd: number) => `$${(usd / 1e9).toFixed(2)}B`;
const fmtP = (v: number) => `${v.toFixed(2)}%`;
const fmt1 = (v: number) => `${v.toFixed(1)}%`;

function rowsOf(t: Table): Record<string, Cell>[] {
  const cols = t.columns.map((c) => c.toLowerCase());
  return t.rows.map((r) => Object.fromEntries(cols.map((c, i) => [c, r[i] ?? null])));
}

// ---------- SQL ----------
interface Tables { fin?: string; prof?: string; macro?: string }

function findTables(text: string): Tables {
  const names = [...text.matchAll(/^- table: (\S+)/gm), ...text.matchAll(/"fqName":"([^"]+)"/g)].map((m) => m[1]);
  const pick = (re: RegExp) => names.find((n) => re.test(n));
  return { fin: pick(/(^|\.)company_financials$/i), prof: pick(/(^|\.)company_profile$/i), macro: pick(/(^|\.)us_macro_indicators$/i) };
}

function bounds(spec: Spec, t: Tables): { min: string; max: string } {
  const maxSub = spec.focus
    ? `(SELECT MAX(fiscal_year) FROM ${t.fin} WHERE concept = 'revenue' AND ticker = ${q(spec.focus)})`
    : `(SELECT MAX(year) FROM ${t.macro} WHERE value IS NOT NULL)`;
  const max = spec.to !== undefined ? String(spec.to) : maxSub;
  const min = spec.from !== undefined ? String(spec.from) : `${maxSub} - 3`;
  return { min, max };
}

function peerCond(spec: Spec, t: Tables, withNamed: boolean): string {
  const parts = [`ticker = ${q(spec.focus!)}`];
  if (spec.sic.length) parts.push(`ticker IN (SELECT ticker FROM ${t.prof} WHERE sic_code IN (${spec.sic.map(q).join(', ')}))`);
  if (withNamed && spec.named.length) parts.push(`ticker IN (${spec.named.map(q).join(', ')})`);
  return parts.join(' OR ');
}

function roleCase(spec: Spec): string {
  const named = spec.named.length ? ` WHEN ticker IN (${spec.named.map(q).join(', ')}) THEN 'named'` : '';
  return `CASE WHEN ticker = ${q(spec.focus!)} THEN 'focus'${named} ELSE 'sic_peer' END`;
}

const v = (concept: string) => `MAX(CASE WHEN concept = '${concept}' THEN value_usd END)`;

function revenueCte(spec: Spec, t: Tables, withNamed: boolean): string {
  return `WITH rev AS (
  SELECT ticker, fiscal_year, period_end, value_usd AS revenue_usd,
         LAG(value_usd) OVER (PARTITION BY ticker ORDER BY fiscal_year) AS prev_revenue_usd,
         LAG(fiscal_year) OVER (PARTITION BY ticker ORDER BY fiscal_year) AS prev_fiscal_year
  FROM ${t.fin}
  WHERE concept = 'revenue' AND (${peerCond(spec, t, withNamed)})
)`;
}

function sqlFor(spec: Spec, t: Tables): { sql: string; purpose: string } {
  const { min, max } = bounds(spec, t);
  const f = spec.focus ? q(spec.focus) : "''";
  const sicTxt = spec.sic.length ? `SIC ${spec.sic.join('/')}` : 'named';
  switch (spec.kind) {
    case 'company_growth':
      return {
        purpose: `YoY revenue growth of ${spec.focus}${spec.named.length ? `, ${spec.named.join(', ')}` : ''} and ${sicTxt} peers over the window`,
        sql: `${revenueCte(spec, t, true)}
SELECT ${roleCase(spec)} AS role, ticker, fiscal_year, period_end, revenue_usd,
       ROUND(100.0 * (revenue_usd - prev_revenue_usd) / prev_revenue_usd, 2) AS yoy_growth_pct
FROM rev
WHERE prev_fiscal_year = fiscal_year - 1 AND fiscal_year BETWEEN ${min} AND ${max}
ORDER BY role, ticker, fiscal_year`,
      };
    case 'sector_growth': {
      const s = (expr: string, focus: boolean) => `SUM(CASE WHEN ticker ${focus ? '=' : '<>'} ${f} THEN ${expr} END)`;
      return {
        purpose: `Aggregate YoY revenue growth of ${sicTxt} peers excluding ${spec.focus} (same companies both years) vs ${spec.focus}`,
        sql: `${revenueCte(spec, t, false)},
y AS (SELECT * FROM rev WHERE prev_fiscal_year = fiscal_year - 1 AND fiscal_year > ${min} AND fiscal_year <= ${max})
SELECT fiscal_year,
       MAX(CASE WHEN ticker = ${f} THEN period_end END) AS focus_period_end,
       ROUND(100.0 * (${s('revenue_usd', true)} - ${s('prev_revenue_usd', true)}) / ${s('prev_revenue_usd', true)}, 2) AS focus_yoy_growth_pct,
       COUNT(CASE WHEN ticker <> ${f} THEN 1 END) AS peer_companies,
       ${s('revenue_usd', false)} AS peer_revenue_usd,
       ${s('prev_revenue_usd', false)} AS peer_prev_revenue_usd,
       ROUND(100.0 * (${s('revenue_usd', false)} - ${s('prev_revenue_usd', false)}) / ${s('prev_revenue_usd', false)}, 2) AS peer_yoy_growth_pct
FROM y
GROUP BY fiscal_year
ORDER BY fiscal_year`,
      };
    }
    case 'macro_demand':
    case 'macro_inflation': {
      const ind = (id: string) => `ROUND(MAX(CASE WHEN indicator_id = '${id}' THEN value END), 2)`;
      return {
        purpose: 'US CPI inflation, real private consumption growth and real GDP growth (World Bank) over the window',
        sql: `SELECT year,
       ${ind('FP.CPI.TOTL.ZG')} AS cpi_inflation_pct,
       ${ind('NE.CON.PRVT.KD.ZG')} AS real_consumption_growth_pct,
       ${ind('NY.GDP.MKTP.KD.ZG')} AS real_gdp_growth_pct
FROM ${t.macro}
WHERE year > ${min} AND year <= ${max}
GROUP BY year
ORDER BY year`,
      };
    }
    case 'margin_tradeoff':
    case 'company_margin':
      return {
        purpose: `Gross and operating margin of ${spec.focus}${spec.named.length ? `, ${spec.named.join(', ')}` : ''} and ${sicTxt} peers over the window`,
        sql: `SELECT ${roleCase(spec)} AS role, ticker, fiscal_year,
       MAX(CASE WHEN concept = 'revenue' THEN period_end END) AS period_end,
       ${v('revenue')} AS revenue_usd,
       ROUND(100.0 * COALESCE(${v('gross_profit')}, ${v('revenue')} - ${v('cost_of_revenue')}) / ${v('revenue')}, 2) AS gross_margin_pct,
       ROUND(100.0 * ${v('operating_income')} / ${v('revenue')}, 2) AS operating_margin_pct
FROM ${t.fin}
WHERE (${peerCond(spec, t, true)}) AND concept IN ('revenue', 'gross_profit', 'cost_of_revenue', 'operating_income')
  AND fiscal_year BETWEEN ${min} AND ${max}
GROUP BY ticker, fiscal_year
ORDER BY role, ticker, fiscal_year`,
      };
    case 'sector_margin': {
      const s = (col: string, focus: boolean) => `SUM(CASE WHEN ticker ${focus ? '=' : '<>'} ${f} THEN ${col} END)`;
      return {
        purpose: `Aggregate operating margin of ${sicTxt} peers excluding ${spec.focus} vs ${spec.focus}`,
        sql: `WITH m AS (
  SELECT ticker, fiscal_year, ${v('revenue')} AS revenue_usd, ${v('operating_income')} AS operating_income_usd
  FROM ${t.fin}
  WHERE (${peerCond(spec, t, false)}) AND concept IN ('revenue', 'operating_income') AND fiscal_year BETWEEN ${min} AND ${max}
  GROUP BY ticker, fiscal_year
), c AS (SELECT * FROM m WHERE revenue_usd IS NOT NULL AND operating_income_usd IS NOT NULL)
SELECT fiscal_year,
       ROUND(100.0 * ${s('operating_income_usd', true)} / ${s('revenue_usd', true)}, 2) AS focus_operating_margin_pct,
       COUNT(CASE WHEN ticker <> ${f} THEN 1 END) AS peer_companies,
       ${s('revenue_usd', false)} AS peer_revenue_usd,
       ${s('operating_income_usd', false)} AS peer_operating_income_usd,
       ROUND(100.0 * ${s('operating_income_usd', false)} / ${s('revenue_usd', false)}, 2) AS peer_operating_margin_pct
FROM c
GROUP BY fiscal_year
ORDER BY fiscal_year`,
      };
    }
    case 'cost_mix':
      return {
        purpose: `Margin decomposition of ${spec.focus}: gross margin vs operating costs below gross profit, as % of revenue`,
        sql: `WITH m AS (
  SELECT ticker, fiscal_year, MAX(CASE WHEN concept = 'revenue' THEN period_end END) AS period_end,
         ${v('revenue')} AS revenue_usd,
         COALESCE(${v('gross_profit')}, ${v('revenue')} - ${v('cost_of_revenue')}) AS gross_profit_usd,
         ${v('operating_income')} AS operating_income_usd
  FROM ${t.fin}
  WHERE ticker = ${f} AND concept IN ('revenue', 'gross_profit', 'cost_of_revenue', 'operating_income') AND fiscal_year BETWEEN ${min} AND ${max}
  GROUP BY ticker, fiscal_year
)
SELECT ticker, fiscal_year, period_end, revenue_usd, gross_profit_usd, operating_income_usd,
       ROUND(100.0 * gross_profit_usd / revenue_usd, 2) AS gross_margin_pct,
       ROUND(100.0 * operating_income_usd / revenue_usd, 2) AS operating_margin_pct,
       ROUND(100.0 * (gross_profit_usd - operating_income_usd) / revenue_usd, 2) AS opex_pct_of_revenue
FROM m
ORDER BY fiscal_year`,
      };
  }
}

// ---------- plan ----------
function windowText(spec: Pick<Spec, 'from' | 'to'>): string {
  if (spec.from !== undefined && spec.to !== undefined) return ` from fiscal_year ${spec.from} to ${spec.to}`;
  if (spec.from !== undefined) return ` after fiscal_year ${spec.from}`;
  return ' over the latest four fiscal years in the data';
}

function plan(question: string, entities: Ent[]) {
  const metric = metricOf(question);
  const yrs = yearsOf(question);
  const focus = entities[0];
  const base = { focus: focus?.ticker, named: entities.slice(1).map((e) => e.ticker), sic: focus?.sic ? [focus.sic] : [], ...yrs };
  const w = windowText(yrs);
  const F = focus ? shortName(focus.name) : '';
  const S = focus?.sic ? `SIC ${focus.sic}` : 'industry';
  const mk = (kind: Kind, statement: string, test: string, refutedIf: string, layer: string) => ({
    statement, layer, refutedIf, test: `${test} [spec ${JSON.stringify({ ...base, kind })}]`,
  });
  if (!focus) {
    return [mk(metric === 'margin' ? 'macro_inflation' : 'macro_demand', `Macro: the US economy (inflation, real consumer demand) explains the change${w}`,
      'Read CPI inflation and real private consumption growth.', 'real consumption kept growing at least 1% a year', 'macro')];
  }
  if (metric === 'margin') {
    return [
      mk('company_margin', `Company-specific: ${F}'s operating margin compressed while its ${S} peers' margins held${w}`,
        `Compare ${F}'s gross and operating margin path with each ${S} peer.`, `${F}'s operating margin fell by less than 1 pp, or no more than 1.5 pp beyond the peer median change`, 'company'),
      mk('sector_margin', `Sector-wide: operating margins compressed across the ${S} peers${w}`,
        `Aggregate operating margin of the ${S} peers excluding ${F}, same years.`, 'the peer aggregate operating margin fell by less than 1 pp', 'sector'),
      mk('cost_mix', `Cost structure: ${F}'s squeeze came from operating costs rising as a share of revenue, not from merchandise gross margin${w}`,
        `Decompose ${F}'s operating margin into gross margin and operating costs below gross profit.`, 'operating costs rose by less than 1 pp of revenue while operating margin fell', 'company'),
      mk('macro_inflation', `Macro: elevated CPI inflation drove cost pressure${w}`,
        'Read US CPI inflation for the same years.', 'average CPI inflation was below 2.5%', 'macro'),
    ];
  }
  return [
    mk('company_growth', `Company-specific: ${F}'s revenue growth fell short of its ${S} peers${w}`,
      `YoY revenue growth of ${F}${base.named.length ? `, ${base.named.join(', ')}` : ''} and each ${S} peer.`, `${F}'s mean YoY growth is within 2 pp of the ${S} peer median`, 'company'),
    mk('sector_growth', `Sector-wide: the ${S} industry (peers excluding ${F}) grew about as slowly as ${F}${w}`,
      `Aggregate YoY revenue growth of the ${S} peers excluding ${F}, same companies in both years.`, `the peer aggregate grew more than 2 pp a year faster than ${F} on average`, 'sector'),
    mk('macro_demand', `Macro: weak real consumer demand (inflation eroding real spending) explains the growth pattern${w}`,
      'Read US CPI inflation and real private consumption growth for the same years.', 'US real private consumption grew at least 1% a year on average', 'macro'),
    mk('margin_tradeoff', `Margin trade-off: ${F} gave up revenue growth to rebuild operating margin${w}`,
      `${F}'s operating margin path over the same fiscal years.`, `${F}'s operating margin fell by 0.5 pp or more`, 'company'),
  ];
}

// ---------- assessment (numeric rules) ----------
const fy = (r: Record<string, Cell>) => num(r.fiscal_year) ?? NaN;
const pe = (r: Record<string, Cell>) => String(r.period_end ?? r.focus_period_end ?? '');

function byTicker(rows: Record<string, Cell>[]) {
  const m = new Map<string, Record<string, Cell>[]>();
  for (const r of rows) {
    const t = String(r.ticker ?? '');
    m.set(t, [...(m.get(t) ?? []), r].sort((a, b) => fy(a) - fy(b)));
  }
  return m;
}

function kindOf(columns: string[], metric: Metric): Kind | undefined {
  const c = new Set(columns.map((x) => x.toLowerCase()));
  if (c.has('yoy_growth_pct') && c.has('role')) return 'company_growth';
  if (c.has('peer_yoy_growth_pct')) return 'sector_growth';
  if (c.has('cpi_inflation_pct')) return metric === 'margin' ? 'macro_inflation' : 'macro_demand';
  if (c.has('opex_pct_of_revenue')) return 'cost_mix';
  if (c.has('peer_operating_margin_pct')) return 'sector_margin';
  if (c.has('operating_margin_pct') && c.has('role')) return metric === 'margin' ? 'company_margin' : 'margin_tradeoff';
  return undefined;
}

function assess(kind: Kind, t: Table, ctx: Ctx): Assessment {
  const rows = rowsOf(t);
  const F = ctx.focus?.ticker ?? '';
  const nameOf = (tk: string) => {
    const e = ctx.entities.find((x) => x.ticker === tk);
    return e ? `${shortName(e.name)} (${tk})` : tk;
  };
  const FN = nameOf(F);
  const S = ctx.sic ? `SIC ${ctx.sic}` : 'industry';
  const none = (why: string): Assessment => ({ status: 'inconclusive', rationale: why, claims: [] });
  if (rows.length === 0) return none('The query returned no rows, so the rule cannot be applied.');

  switch (kind) {
    case 'company_growth': {
      const groups = byTicker(rows);
      const years = [...new Set(rows.map(fy))].sort((a, b) => a - b);
      const growth = years.length > 1 ? years.slice(1) : years;
      const g = (rs: Record<string, Cell>[]) => rs.filter((r) => growth.includes(fy(r)) && num(r.yoy_growth_pct) !== undefined);
      const avg = (rs: Record<string, Cell>[]) => mean(g(rs).map((r) => num(r.yoy_growth_pct)!));
      const focus = groups.get(F) ?? [];
      const fAvg = avg(focus);
      if (fAvg === undefined) return none(`No YoY revenue rows for ${F} in the window.`);
      const peers = [...groups.entries()].filter(([k]) => k !== F).map(([k, rs]) => ({ k, rs, a: avg(rs) })).filter((p) => p.a !== undefined);
      const med = median(peers.map((p) => p.a!));
      const levelClaim = (tk: string) => {
        const rs = groups.get(tk) ?? [];
        const first = rs[0];
        const last = rs[rs.length - 1];
        const a = num(first?.revenue_usd);
        const b = num(last?.revenue_usd);
        if (!first || !last || a === undefined || b === undefined || fy(first) === fy(last)) return undefined;
        const yoys = g(rs).map((r) => `${fmtP(num(r.yoy_growth_pct)!)} (FY ending ${pe(r)})`).join(', ');
        return `${nameOf(tk)} revenue went from ${fmtB(a)} (FY ending ${pe(first)}) to ${fmtB(b)} (FY ending ${pe(last)}), a ${fmt1(((b - a) / a) * 100)} change; YoY growth was ${yoys}`;
      };
      const yoyList = (rs: Record<string, Cell>[]) => g(rs).map((r) => fmtP(num(r.yoy_growth_pct)!)).join(' and ');
      const claims = [levelClaim(F), ...ctx.entities.slice(1).map((e) => levelClaim(e.ticker))].filter((x): x is string => !!x);
      if (med === undefined) return { status: 'inconclusive', rationale: `No ${S} peer rows to compare ${F} with.`, claims };
      const gap = fAvg - med;
      const status: Status = gap <= -2 ? 'supported' : 'refuted';
      const peerList = peers.map((p) => `${p.k} ${yoyList(p.rs)}`).join('; ');
      claims.push(
        status === 'supported'
          ? `Company-specific: over fiscal_year ${growth.join(', ')} ${FN} grew ${yoyList(focus)} YoY while its ${S} peers grew faster: ${peerList}`
          : `Not company-specific: over fiscal_year ${growth.join(', ')} ${FN}'s YoY growth (${yoyList(focus)}) was in line with its ${S} peers: ${peerList}`,
      );
      return {
        status,
        rationale: `Rule: company-specific if ${F}'s mean YoY revenue growth over fiscal_year ${growth.join(', ')} trails the median of its peers' means by 2 pp or more. ${F} ${fAvg.toFixed(2)}% vs peer median ${med.toFixed(2)}% (gap ${gap.toFixed(2)} pp).`,
        claims,
      };
    }
    case 'sector_growth': {
      const rs = rows.filter((r) => num(r.peer_yoy_growth_pct) !== undefined && num(r.focus_yoy_growth_pct) !== undefined).sort((a, b) => fy(a) - fy(b));
      if (!rs.length) return none(`No comparable ${S} peer aggregate rows in the window.`);
      const fAvg = mean(rs.map((r) => num(r.focus_yoy_growth_pct)!))!;
      const pAvg = mean(rs.map((r) => num(r.peer_yoy_growth_pct)!))!;
      const status: Status = pAvg - fAvg <= 2 ? 'supported' : 'refuted';
      const list = (col: string) => rs.map((r) => `${fmtP(num(r[col])!)} (fiscal_year ${fy(r)})`).join(', ');
      const last = rs[rs.length - 1];
      const gapLast = num(last.peer_yoy_growth_pct)! - num(last.focus_yoy_growth_pct)!;
      return {
        status,
        rationale: `Rule: sector-wide if the ${S} peer aggregate (excluding ${F}, same companies in both years) grew no more than 2 pp a year faster than ${F} on average. Peers ${pAvg.toFixed(2)}% vs ${F} ${fAvg.toFixed(2)}% (difference ${(pAvg - fAvg).toFixed(2)} pp).`,
        claims: [
          status === 'supported'
            ? `Sector-wide: ${FN}'s ${S} peers excluding ${F} grew ${list('peer_yoy_growth_pct')} in aggregate, versus ${F}'s ${list('focus_yoy_growth_pct')}, so the industry moved the same way`
            : `Not sector-wide: ${FN}'s ${S} peers excluding ${F} grew ${list('peer_yoy_growth_pct')} in aggregate, versus ${F}'s ${list('focus_yoy_growth_pct')}, a gap of ${gapLast.toFixed(2)} percentage points in fiscal_year ${fy(last)}`,
        ],
      };
    }
    case 'macro_demand':
    case 'macro_inflation': {
      const rs = rows.sort((a, b) => (num(a.year) ?? 0) - (num(b.year) ?? 0));
      const list = (col: string) => rs.filter((r) => num(r[col]) !== undefined).map((r) => `${fmtP(num(r[col])!)} in ${num(r.year)}`).join(', ');
      const cons = rs.map((r) => num(r.real_consumption_growth_pct)).filter((x): x is number => x !== undefined);
      const cpi = rs.map((r) => num(r.cpi_inflation_pct)).filter((x): x is number => x !== undefined);
      if (kind === 'macro_demand') {
        const m = mean(cons);
        if (m === undefined) return none('No real consumption data for the window.');
        const status: Status = m < 1 ? 'supported' : 'refuted';
        return {
          status,
          rationale: `Rule: macro demand explains it only if US real private consumption grew less than 1% a year on average. Mean ${m.toFixed(2)}% over ${cons.length} year(s).`,
          claims: [
            status === 'supported'
              ? `Macro: US real private consumption growth was weak (${list('real_consumption_growth_pct')}) while CPI inflation was ${list('cpi_inflation_pct')}`
              : `Not macro: US real private consumption grew ${list('real_consumption_growth_pct')} while CPI inflation was ${list('cpi_inflation_pct')}, so consumer demand was still expanding in real terms`,
          ],
        };
      }
      const m = mean(cpi);
      if (m === undefined) return none('No CPI data for the window.');
      const status: Status = m >= 4 ? 'supported' : m < 2.5 ? 'refuted' : 'inconclusive';
      return {
        status,
        rationale: `Rule: supported if mean US CPI inflation was at least 4%, refuted if below 2.5%, otherwise inconclusive. Mean ${m.toFixed(2)}% over ${cpi.length} year(s).`,
        claims:
          status === 'supported' ? [`Macro: US CPI inflation was elevated (${list('cpi_inflation_pct')}), raising cost pressure`]
            : status === 'refuted' ? [`Not macro: US CPI inflation was moderate (${list('cpi_inflation_pct')})`] : [],
      };
    }
    case 'margin_tradeoff':
    case 'company_margin': {
      const groups = byTicker(rows.filter((r) => num(r.operating_margin_pct) !== undefined));
      const path = (tk: string) => {
        const rs = groups.get(tk) ?? [];
        return rs.length >= 2 ? { first: rs[0], last: rs[rs.length - 1] } : undefined;
      };
      const fp = path(F);
      if (!fp) return none(`Fewer than two fiscal years of operating margin for ${F}.`);
      const op = (r: Record<string, Cell>) => num(r.operating_margin_pct)!;
      const d = op(fp.last) - op(fp.first);
      const span = `from ${fmtP(op(fp.first))} (FY ending ${pe(fp.first)}) to ${fmtP(op(fp.last))} (FY ending ${pe(fp.last)})`;
      if (kind === 'margin_tradeoff') {
        const status: Status = d >= 0.5 ? 'supported' : d <= -0.5 ? 'refuted' : 'inconclusive';
        return {
          status,
          rationale: `Rule: supported if ${F}'s operating margin rose by at least 0.5 pp over the window, refuted if it fell by 0.5 pp or more. Change ${d.toFixed(2)} pp.`,
          claims:
            status === 'supported' ? [`Margin trade-off: ${FN}'s operating margin rose ${span} while its revenue growth lagged, consistent with prioritising profitability over sales`]
              : status === 'refuted' ? [`Not a margin trade-off: ${FN}'s operating margin also fell, ${span}`] : [],
        };
      }
      const peers = [...groups.keys()].filter((k) => k !== F).map((k) => ({ k, p: path(k) })).filter((x) => !!x.p);
      const med = median(peers.map((x) => op(x.p!.last) - op(x.p!.first)));
      const g0 = num(fp.first.gross_margin_pct);
      const g1 = num(fp.last.gross_margin_pct);
      const claims = [
        `${FN}'s operating margin went ${span}, a change of ${d.toFixed(2)} percentage points` +
          (g0 !== undefined && g1 !== undefined ? `, while its gross margin went from ${fmtP(g0)} to ${fmtP(g1)}` : ''),
      ];
      if (med === undefined) return { status: 'inconclusive', rationale: `No ${S} peer margins to compare ${F} with.`, claims };
      const status: Status = d <= -1 && d - med <= -1.5 ? 'supported' : 'refuted';
      const peerList = peers.map((x) => `${x.k} ${fmtP(op(x.p!.first))} to ${fmtP(op(x.p!.last))}`).join('; ');
      claims.push(
        status === 'supported'
          ? `Company-specific: over the same fiscal years its ${S} peers' operating margins did not compress like ${F}'s: ${peerList}`
          : `Not company-specific: its ${S} peers' operating margins moved similarly: ${peerList}`,
      );
      return {
        status,
        rationale: `Rule: company-specific if ${F}'s operating margin fell by at least 1 pp and by at least 1.5 pp more than the ${S} peer median change. ${F} ${d.toFixed(2)} pp vs peer median ${med.toFixed(2)} pp.`,
        claims,
      };
    }
    case 'sector_margin': {
      const rs = rows.filter((r) => num(r.peer_operating_margin_pct) !== undefined).sort((a, b) => fy(a) - fy(b));
      if (rs.length < 2) return none(`Fewer than two fiscal years of ${S} peer margins.`);
      const [a, b] = [rs[0], rs[rs.length - 1]];
      const p = (r: Record<string, Cell>) => num(r.peer_operating_margin_pct)!;
      const d = p(b) - p(a);
      const status: Status = d <= -1 ? 'supported' : 'refuted';
      const f0 = num(a.focus_operating_margin_pct);
      const f1 = num(b.focus_operating_margin_pct);
      const focusPart = f0 !== undefined && f1 !== undefined ? `, while ${F}'s went from ${fmtP(f0)} to ${fmtP(f1)}` : '';
      return {
        status,
        rationale: `Rule: sector-wide if the aggregate operating margin of the ${S} peers excluding ${F} fell by at least 1 pp. Change ${d.toFixed(2)} pp.`,
        claims: [
          `${status === 'supported' ? 'Sector-wide' : 'Not sector-wide'}: the aggregate operating margin of ${FN}'s ${S} peers excluding ${F} went from ${fmtP(p(a))} in fiscal_year ${fy(a)} to ${fmtP(p(b))} in fiscal_year ${fy(b)}${focusPart}`,
        ],
      };
    }
    case 'cost_mix': {
      const rs = rows.filter((r) => num(r.operating_margin_pct) !== undefined && num(r.opex_pct_of_revenue) !== undefined).sort((a, b) => fy(a) - fy(b));
      if (rs.length < 2) return none(`Fewer than two fiscal years of margin data for ${F}.`);
      const [a, b] = [rs[0], rs[rs.length - 1]];
      const val = (r: Record<string, Cell>, c: string) => num(r[c])!;
      const dOp = val(b, 'operating_margin_pct') - val(a, 'operating_margin_pct');
      const dX = val(b, 'opex_pct_of_revenue') - val(a, 'opex_pct_of_revenue');
      const rule = `Rule: when the operating margin fell by at least 1 pp, supported if operating costs below gross profit rose by at least 1 pp of revenue, else refuted. Operating margin change ${dOp.toFixed(2)} pp, operating cost change ${dX.toFixed(2)} pp.`;
      if (dOp > -1) return none(`${rule} No operating-margin squeeze in the window.`);
      const status: Status = dX >= 1 ? 'supported' : 'refuted';
      const span = `(FY ending ${pe(a)} to FY ending ${pe(b)})`;
      const gross = `${fmtP(val(a, 'gross_margin_pct'))} to ${fmtP(val(b, 'gross_margin_pct'))}`;
      const opex = `${fmtP(val(a, 'opex_pct_of_revenue'))} to ${fmtP(val(b, 'opex_pct_of_revenue'))}`;
      return {
        status,
        rationale: rule,
        claims: [
          status === 'supported'
            ? `Cost structure: ${FN}'s operating costs below gross profit rose from ${opex} of revenue ${span} while its gross margin moved from ${gross}, so most of the squeeze came below gross profit`
            : `Not mainly operating costs: ${FN}'s gross margin moved from ${gross} ${span} while operating costs below gross profit went from ${opex} of revenue`,
        ],
      };
    }
  }
}

// ---------- phases ----------
let seq = 0;
const call = (name: string, args: Record<string, unknown>): ToolCall => ({ id: `sample_call_${++seq}`, name, arguments: JSON.stringify(args) });

function specOf(text: string): Spec | undefined {
  const m = text.match(/\[spec (\{.*?\})\]/);
  try {
    return m ? (JSON.parse(m[1]) as Spec) : undefined;
  } catch {
    return undefined;
  }
}

function ctxOf(text: string): Ctx {
  const entities = entitiesOf(text);
  return { focus: entities[0], entities, sic: entities[0]?.sic ?? '' };
}

function verdictJson(status: Status, rationale: string, evidenceIds: string[]): string {
  return JSON.stringify({ status, rationale, evidenceIds });
}

/** Latest tool result JSON + its evidence id, from the Markovian continuation turn. */
function latestResult(latest: string): { evidenceId?: string; table?: Table; error?: string; catalog?: boolean } {
  if (/-> ERROR/.test(latest)) return { error: latest.slice(latest.indexOf('-> ERROR') + 3).split('\n')[0].slice(0, 300) };
  const at = latest.lastIndexOf(') -> {');
  if (at >= 0) {
    const body = latest.slice(at + 5).split('\n')[0];
    try {
      const j = JSON.parse(body) as { evidenceId?: string; columns?: string[]; rows?: Cell[][] };
      if (j.evidenceId && j.columns && j.rows) return { evidenceId: j.evidenceId, table: { columns: j.columns, rows: j.rows } };
    } catch {
      /* fall through */
    }
  }
  return { catalog: /"fqName":"/.test(latest) };
}

function investigate(messages: ChatMessage[], first: string, question: string): { content: string; toolCalls: ToolCall[] } {
  const spec = specOf(first);
  if (!spec) return { content: verdictJson('inconclusive', 'No executable test plan for this hypothesis.', []), toolCalls: [] };
  const last = messages[messages.length - 1];
  const at = last?.role === 'user' ? last.content.indexOf('LATEST TOOL RESULTS') : -1;
  const latest = at >= 0 ? last.content.slice(at) : '';
  if (latest) {
    const r = latestResult(latest);
    if (r.error) return { content: verdictJson('inconclusive', `The query failed: ${r.error}`, []), toolCalls: [] };
    if (r.table && r.evidenceId) {
      const a = assess(spec.kind, r.table, ctxOf(first));
      return { content: verdictJson(a.status, `${a.rationale} [${r.evidenceId}]`, [r.evidenceId]), toolCalls: [] };
    }
  }
  const tables = findTables(`${first}\n${latest}`);
  const macro = spec.kind === 'macro_demand' || spec.kind === 'macro_inflation';
  const missing = macro ? !tables.macro || (!!spec.focus && !tables.fin) : !tables.fin || (spec.sic.length > 0 && !tables.prof);
  if (missing) {
    if (!latest) return { content: 'The tables this test needs are not in the retrieved schema; listing the catalog.', toolCalls: [call('zetaris_catalog', {})] };
    return { content: verdictJson('inconclusive', 'The Zetaris catalog has no table with the columns this test needs.', []), toolCalls: [] };
  }
  void question;
  const { sql, purpose } = sqlFor(spec, tables);
  return { content: `Running the decisive comparison for ${spec.kind}.`, toolCalls: [call('zetaris_query', { sql, purpose })] };
}

function synthesize(first: string, question: string) {
  const ctx = ctxOf(first);
  const metric = metricOf(question);
  const hyps = jsonLines(first, 'HYPOTHESIS') as { id: string; statement: string; status: Status; evidenceIds: string[] }[];
  const evidence = jsonLines(first, 'EVIDENCE') as { id: string; columns: string[]; rows: Cell[][] }[];
  const claims: { text: string; confidence: 'high' | 'medium' | 'low'; evidenceIds: string[] }[] = [];
  const order = [...hyps.filter((h) => h.status === 'supported'), ...hyps.filter((h) => h.status === 'refuted')];
  for (const h of order) {
    const ev = evidence.find((e) => h.evidenceIds.includes(e.id) && kindOf(e.columns, metric));
    if (!ev) continue;
    const a = assess(kindOf(ev.columns, metric)!, ev, ctx);
    const tradeoff = /^Margin trade-off/.test(h.statement);
    for (const text of a.claims) {
      claims.push({ text: `${text} [${ev.id}].`, confidence: h.status === 'supported' && !tradeoff ? 'high' : 'medium', evidenceIds: [ev.id] });
    }
  }
  const label = (h: { statement: string }) => h.statement.split(' — ')[0];
  const sup = hyps.filter((h) => h.status === 'supported');
  const ref = hyps.filter((h) => h.status === 'refuted');
  const inc = hyps.filter((h) => h.status === 'inconclusive');
  const summary = [
    sup.length ? `Supported by the data: ${sup.map(label).join('; ')}.` : 'No hypothesis was supported by the data.',
    ref.length ? `Refuted: ${ref.map((h) => label(h).split(':')[0]).join(', ')}.` : '',
    inc.length ? `Inconclusive: ${inc.map((h) => label(h).split(':')[0]).join(', ')}.` : '',
    'Company figures cite each fiscal period end date (edgar fiscal_year = calendar year in which most of the fiscal year falls).',
    "Produced by Causa's deterministic sample analyst (SAMPLE_MODE: rule-based verdicts over real SEC EDGAR / World Bank rows, no LLM).",
  ].filter(Boolean).join(' ');
  return { summary, claims };
}

function critic(first: string) {
  const claims = jsonLines(first, 'CLAIM') as { index: number; text: string; evidenceIds: string[] }[];
  const evidence = new Map((jsonLines(first, 'EVIDENCE') as { id: string; columns: string[]; rows: Cell[][] }[]).map((e) => [e.id, e]));
  return {
    reviews: claims.map((c) => {
      const tables = c.evidenceIds.map((id) => evidence.get(id)).filter((e): e is NonNullable<typeof e> => !!e);
      const det = checkClaimNumbers(c.text, tables);
      const ok = tables.length > 0 && det.ok && det.checked > 0;
      return {
        index: c.index,
        verdict: ok ? 'verified' : 'drop',
        note: ok
          ? `Sample critic (deterministic): ${det.checked} number(s) re-checked against the cited rows.`
          : `Sample critic (deterministic): ${det.unsupported.join(', ') || 'no checkable number'} not found in the cited rows.`,
      };
    }),
  };
}

export function createSampleAnalystLLM(opts: { reason?: string } = {}): CausaLLM {
  const reason = opts.reason ?? 'Meterless Nightshift unavailable';
  return {
    provider: 'sample',
    modelId: SAMPLE_ANALYST_MODEL,
    fake: true,
    async chat(messages): Promise<CausaChatResponse> {
      const started = Date.now();
      const system = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n');
      const users = messages.filter((m) => m.role === 'user');
      const first = users[0]?.content ?? '';
      const lastUser = users[users.length - 1]?.content ?? '';
      const question = first.match(/QUESTION: (.*)/)?.[1] ?? '';
      let content = '';
      let toolCalls: ToolCall[] = [];
      if (system.includes(PHASE.critic)) content = JSON.stringify(critic(first));
      else if (system.includes(PHASE.synthesize)) content = JSON.stringify(synthesize(first, question));
      else if (lastUser.includes(PHASE.verdict)) content = verdictJson('inconclusive', 'No decisive query result within the step budget.', []);
      else if (system.includes(PHASE.investigate)) ({ content, toolCalls } = investigate(messages, first, question));
      else if (system.includes(PHASE.plan)) content = JSON.stringify({ hypotheses: plan(question, entitiesOf(first)) });
      else content = 'The sample analyst only handles Causa investigation phases.';
      return {
        content,
        toolCalls,
        model: `${SAMPLE_ANALYST_MODEL} (deterministic, no LLM) via sample`,
        handledBy: { provider: 'sample', requested: SAMPLE_ANALYST_MODEL, model: SAMPLE_ANALYST_MODEL, headers: {}, latencyMs: Date.now() - started },
        usage: { promptTokens: messages.reduce((s, m) => s + Math.ceil(m.content.length / 4), 0), completionTokens: Math.ceil(content.length / 4) },
      };
    },
    async embed(texts) {
      return texts.map(fakeEmbedding);
    },
    async canEmbed() {
      return false; // BM25 schema retrieval: hash embeddings would only add noise
    },
    async health() {
      return { ok: true, status: 'online' as const, models: [SAMPLE_ANALYST_MODEL], detail: `deterministic sample analyst (SAMPLE_MODE; ${reason})` };
    },
  };
}
