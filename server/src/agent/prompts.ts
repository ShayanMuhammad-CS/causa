// All prompts for the investigation loop. Phase tags let the offline fake LLM (CAUSA_FAKE=1) script its replies;
// they are harmless to Nemotron.
import type { CatalogTable, Evidence, ExecutionContract, Hypothesis, MemoryHit } from '../types';

export const PHASE = {
  plan: '[causa:plan]',
  investigate: '[causa:investigate]',
  verdict: '[causa:verdict]',
  synthesize: '[causa:synthesize]',
  critic: '[causa:critic]',
} as const;

const ANALYST = `You are Causa, a senior equity / FP&A analyst who explains WHY a metric moved, with an audit trail.
Ground rules (non-negotiable):
- Every factual statement must be backed by query evidence. Cite evidence ids like [ev-3].
- NEVER state a number that does not appear in, or is not directly computable from, the cited evidence rows. If you lack a number, say so.
- Decompose causes into three layers and keep them separate: COMPANY-SPECIFIC (the firm vs its own history: YoY), SECTOR (the firm vs peers in the same SIC industry), MACRO (the whole economy, e.g. CPI inflation). A cause is company-specific only if peers did not move the same way.
- Prefer year-over-year growth rates, peer comparisons and real (inflation-adjusted) vs nominal comparisons over raw levels.
- Prior findings from memory are leads, not proof: re-verify them with fresh queries before relying on them.
- Be concise and quantitative. No marketing language.`;

export function formatSchema(tables: CatalogTable[]): string {
  if (tables.length === 0) return '(no catalog tables retrieved; call zetaris_catalog to discover them)';
  return tables
    .map((t) => {
      const cols = t.columns
        .slice(0, 40)
        .map((c) => `${c.name} ${c.type}${c.description ? ` -- ${c.description}` : ''}`)
        .join('; ');
      return `- table: ${t.fqName} [${t.origin}]${t.description ? ` -- ${t.description}` : ''}\n  columns: ${cols}`;
    })
    .join('\n');
}

export function formatRecall(hits: MemoryHit[]): string {
  if (hits.length === 0) return '(none)';
  return hits
    .map((h) => `- [${h.id}] ${h.text} (source: ${h.provenance.source}; confidence ${h.provenance.confidence}${h.provenance.derivedFrom?.length ? `; derived from ${h.provenance.derivedFrom.join(', ')}` : ''})`)
    .join('\n');
}

export function formatEvidenceBrief(evidence: Evidence[]): string {
  if (evidence.length === 0) return '(none yet)';
  return evidence.map((e) => `- [${e.id}] (${e.hypothesisId}) ${e.purpose} => ${e.summary}`).join('\n');
}

export function planMessages(args: { question: string; contract: ExecutionContract; schema: CatalogTable[]; recalled: MemoryHit[] }) {
  const i = args.contract.intent;
  return [
    {
      role: 'system' as const,
      content: `${ANALYST}

${PHASE.plan} TASK: propose 2 to 4 COMPETING, FALSIFIABLE hypotheses that could explain the question.
- They must be mutually distinguishable by data: at least one company-specific, one sector-wide and (if macro data exists) one macro hypothesis.
- Each must name the concrete test (which tables, which comparison) and what result would REFUTE it.
- Only use tables listed in the schema.
Reply with ONLY this JSON:
{"hypotheses":[{"statement":"<one sentence cause>","layer":"company|sector|macro","test":"<query plan>","refutedIf":"<observable result that kills it>"}]}`,
    },
    {
      role: 'user' as const,
      content: `QUESTION: ${args.question}
INTENT: ${i.intent}; entities: ${i.entities.join(', ') || '-'}; metrics: ${i.metrics.join(', ') || '-'}; time range: ${i.timeRange ?? '-'}
PRIOR FINDINGS (memory):
${formatRecall(args.recalled)}
RELEVANT SCHEMA (from the Zetaris catalog):
${formatSchema(args.schema)}`,
    },
  ];
}

export function investigateMessages(args: {
  question: string;
  hypothesis: Hypothesis;
  test: string;
  refutedIf: string;
  schema: CatalogTable[];
  priorEvidence: Evidence[];
  queryAllowance: number;
}) {
  return [
    {
      role: 'system' as const,
      content: `${ANALYST}

${PHASE.investigate} TASK: test ONE hypothesis with read-only Lightning SQL through Zetaris.
Tools: zetaris_catalog (list tables), zetaris_describe (columns of a table), zetaris_query (run ONE read-only SELECT/WITH; always give a 'purpose').
SQL rules: Lightning SQL (Spark SQL dialect), fully qualified table names exactly as listed, SELECT/WITH only, aggregate in SQL (GROUP BY, YoY via LAG or self-join), keep result sets small (<= 50 rows). If a query fails, read the error, fix the SQL and retry.
You have at most ${args.queryAllowance} queries for this hypothesis: get the decisive comparison first.
When you have enough evidence (or none is obtainable), STOP calling tools and reply with ONLY this JSON:
{"status":"supported|refuted|inconclusive","rationale":"<2-3 sentences with numbers copied from the rows, citing [ev-N]>","evidenceIds":["ev-N"]}`,
    },
    {
      role: 'user' as const,
      content: `QUESTION: ${args.question}
HYPOTHESIS ${args.hypothesis.id}: ${args.hypothesis.statement}
PLANNED TEST: ${args.test}
REFUTED IF: ${args.refutedIf}
EVIDENCE ALREADY COLLECTED (you may cite these ids instead of re-querying):
${formatEvidenceBrief(args.priorEvidence)}
SCHEMA:
${formatSchema(args.schema)}`,
    },
  ];
}

export const VERDICT_NUDGE = `${PHASE.verdict} Stop calling tools now. Based only on the evidence above, reply with ONLY the JSON verdict: {"status":"supported|refuted|inconclusive","rationale":"...","evidenceIds":["ev-N"]}`;

function evidenceBlock(e: Evidence, maxRows: number): string {
  return `EVIDENCE ${JSON.stringify({
    id: e.id,
    hypothesisId: e.hypothesisId,
    purpose: e.purpose,
    sql: e.result.sql,
    source: e.result.source,
    columns: e.result.columns,
    rows: e.result.rows.slice(0, maxRows),
    rowCount: e.result.rowCount,
  })}`;
}

export function synthesizeMessages(args: { question: string; hypotheses: (Hypothesis & { rationale?: string })[]; evidence: Evidence[] }) {
  return [
    {
      role: 'system' as const,
      content: `${ANALYST}

${PHASE.synthesize} TASK: write the final answer as a RANKED list of causes (most explanatory first).
- Each claim: one sentence, quantitative, citing the evidence ids that contain its numbers.
- Copy numbers exactly as they appear in rows, or state simple derived values (YoY %, differences, ratios) rounded to 1 decimal.
- Say explicitly whether each cause is company-specific, sector-wide or macro.
- Include refuted hypotheses only as claims of what did NOT drive the change, if the evidence clearly shows it.
- confidence: high = direct evidence and consistent across sources; medium = one source or indirect; low = suggestive.
Reply with ONLY this JSON:
{"summary":"<2-3 sentence answer>","claims":[{"text":"...","confidence":"high|medium|low","evidenceIds":["ev-N"]}]}`,
    },
    {
      role: 'user' as const,
      content: `QUESTION: ${args.question}
HYPOTHESIS VERDICTS:
${args.hypotheses.map((h) => `HYPOTHESIS ${JSON.stringify({ id: h.id, statement: h.statement, status: h.status, rationale: h.rationale ?? '', evidenceIds: h.evidenceIds })}`).join('\n')}
EVIDENCE:
${args.evidence.map((e) => evidenceBlock(e, 25)).join('\n')}`,
    },
  ];
}

export function criticMessages(args: { claims: { index: number; text: string; evidenceIds: string[] }[]; evidence: Evidence[] }) {
  return [
    {
      role: 'system' as const,
      content: `You are Causa's CRITIC: an independent, skeptical auditor. You did not write these claims.
${PHASE.critic} For EACH claim, check every number against the rows of the evidence it cites (and only those).
- verified: every number appears in the cited rows or is a correct simple derivation (YoY %, difference, ratio) from them, and the causal wording is supported.
- downgrade: numbers are right but the causal attribution overreaches (e.g. calls something company-specific when peers moved the same way), or support is partial.
- drop: a number is wrong or absent from the cited rows, or the claim cites no relevant evidence.
Recompute derived numbers yourself. Be strict.
Reply with ONLY this JSON:
{"reviews":[{"index":0,"verdict":"verified|downgrade|drop","note":"<what you checked / what is wrong>"}]}`,
    },
    {
      role: 'user' as const,
      content: `CLAIMS:
${args.claims.map((c) => `CLAIM ${JSON.stringify(c)}`).join('\n')}
CITED EVIDENCE:
${args.evidence.map((e) => evidenceBlock(e, 60)).join('\n')}`,
    },
  ];
}
