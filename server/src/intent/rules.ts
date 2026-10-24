// Stage-1 deterministic scan (Scout Intent AGENTS.md s4.1): pure rules, always available, so the LLM is an
// upgrade and never a dependency (s1 "deterministic floor, optional intelligence").
import type { IntentRecord } from '../types';

const STOP = new Set(['Why', 'What', 'Is', 'Are', 'How', 'Did', 'Does', 'Do', 'Compare', 'Show', 'List', 'Explain', 'The', 'And', 'Or', 'Was', 'Were',
  'Which', 'Who', 'When', 'Where', 'Can', 'Could', 'Please', 'Tell', 'Give', 'Find', 'Has', 'Have', 'In', 'On', 'After', 'Before', 'Since', 'During', 'From',
  'Q1', 'Q2', 'Q3', 'Q4', 'FY', 'CPI', 'SIC', 'SEC', 'GAAP', 'XBRL', 'USD', 'EDGAR', 'It', 'Its', 'This', 'That', 'These', 'Those', 'If', 'For']);
const KNOWN = ['walmart', 'target', 'ford', 'gm', 'general motors', 'costco', 'tesla', 'home depot', 'kroger', 'amazon', 'stellantis', 'toyota'];
const METRICS: [string, RegExp][] = [
  ['revenue', /\brevenues?\b/i], ['sales', /\bsales\b/i], ['growth', /\bgrowth\b/i], ['net income', /\bnet income\b|\bearnings\b/i],
  ['profit', /\bprofits?\b/i], ['margin', /\bmargins?\b/i], ['cpi', /\bcpi\b|\binflation\b/i], ['expenses', /\bexpenses?\b|\bcosts?\b/i],
  ['assets', /\bassets\b/i], ['cash flow', /\bcash flow\b/i], ['eps', /\beps\b/i],
];

export function extractEntities(q: string): string[] {
  const out = new Map<string, string>();
  for (const k of KNOWN) {
    const m = new RegExp(`\\b${k}\\b`, 'i').exec(q);
    if (m) out.set(k, m[0].replace(/^./, (c) => c.toUpperCase()));
  }
  for (const m of q.matchAll(/\b([A-Z][a-zA-Z&]{1,})(?:'s|’s)?\b/g)) {
    if (STOP.has(m[1])) continue;
    if (!out.has(m[1].toLowerCase())) out.set(m[1].toLowerCase(), m[1]);
  }
  return [...out.values()];
}

export function extractMetrics(q: string): string[] {
  return METRICS.filter(([, re]) => re.test(q)).map(([name]) => name);
}

export function extractTimeRange(q: string): string | undefined {
  const range = /\b((?:19|20)\d\d)\s*(?:-|–|to|through)\s*((?:19|20)?\d\d)\b/i.exec(q);
  if (range) return `${range[1]}-${range[2]}`;
  const rel = /\b(after|since|before|in|during|from|until)\s+((?:19|20)\d\d)\b/i.exec(q);
  if (rel) return `${rel[1].toLowerCase()} ${rel[2]}`;
  const quarter = /\b(Q[1-4])\s*((?:19|20)\d\d)?\b/i.exec(q);
  if (quarter) return quarter[0].toUpperCase().trim();
  const fy = /\bFY\s?((?:19|20)\d\d)\b/i.exec(q);
  if (fy) return `FY${fy[1]}`;
  const last = /\blast\s+(\d+|few|several)\s+(years?|quarters?|months?)\b/i.exec(q);
  if (last) return last[0].toLowerCase();
  return undefined;
}

const EXPLAIN = /\bwhy\b|\bcaus(e|es|ed)\b|\bdriv(er|ers|en|e)\b|\bexplain\b|\bslow(down|ed|er)?\b|\blag(ged|ging|s)?\b|\bdecline[ds]?\b|\bfell\b|\bfall(en|s)?\b|\bdrop(ped)?\b|\bcompany-specific\b|\bsector-wide\b|\breason\b|\bbehind\b/i;
const COMPARE = /\bcompare[ds]?\b|\bversus\b|\bvs\.?\b|\bcompared (to|with)\b|\bdifference between\b|\bbetter than\b/i;
const LOOKUP = /\bwhat (is|was|were|are)\b|\bhow (much|many)\b|\bshow\b|\blist\b|\bwhich\b|\bfind\b|\bgive me\b|\bwho\b|\btell me\b/i;

export function ruleIntent(q: string): Pick<IntentRecord, 'intent' | 'entities' | 'metrics' | 'timeRange'> {
  const entities = extractEntities(q);
  const metrics = extractMetrics(q);
  const timeRange = extractTimeRange(q);
  let intent = 'general';
  if (EXPLAIN.test(q)) intent = 'explain_metric_change';
  else if (COMPARE.test(q) || (entities.length >= 2 && metrics.length > 0)) intent = 'compare_entities';
  else if (LOOKUP.test(q) && (metrics.length > 0 || entities.length > 0)) intent = 'lookup';
  else if (metrics.length > 0 && entities.length > 0) intent = 'lookup';
  return { intent, entities, metrics, ...(timeRange ? { timeRange } : {}) };
}
