// Tools exposed to Nemotron during hypothesis testing, and their contract-checked executor.
import type { CatalogTable, Evidence, InvestigationEvent, QueryResult, ToolCall, ToolSpec, ZetarisClient } from '../types';
import { Budget, BudgetExceededError, isToolAllowed } from './budget';

export const MAX_SQL_RETRIES = 2; // a failing query may be retried at most twice (3 attempts in a row)
const ROWS_TO_MODEL = 40;

export const TOOL_SPECS: ToolSpec[] = [
  {
    name: 'zetaris_catalog',
    description: 'List the Lightning tables/views available through Zetaris (fully qualified names, source type, description).',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'zetaris_describe',
    description: 'Show the columns (name, type, description) of one Lightning table from the catalog.',
    parameters: {
      type: 'object',
      properties: { table: { type: 'string', description: 'Fully qualified table name exactly as listed in the catalog' } },
      required: ['table'],
      additionalProperties: false,
    },
  },
  {
    name: 'zetaris_query',
    description:
      'Run ONE read-only Lightning SQL statement (SELECT or WITH) through Zetaris across the federated sources. The result rows become an evidence record (ev-N) you can cite.',
    parameters: {
      type: 'object',
      properties: {
        sql: { type: 'string', description: 'A single read-only SELECT/WITH statement using fully qualified table names' },
        purpose: { type: 'string', description: 'What this query tests, in one short sentence' },
      },
      required: ['sql', 'purpose'],
      additionalProperties: false,
    },
  },
];

/** LLM tool name -> contract tool name. */
export const TOOL_PERMISSION: Record<string, string> = {
  zetaris_catalog: 'zetaris.catalog',
  zetaris_describe: 'zetaris.describe',
  zetaris_query: 'zetaris.query',
};

export function allowedToolSpecs(contract: Parameters<typeof isToolAllowed>[0]): ToolSpec[] {
  return TOOL_SPECS.filter((t) => isToolAllowed(contract, TOOL_PERMISSION[t.name]));
}

export function summarizeResult(r: QueryResult): string {
  const head = `${r.rowCount} row(s) x ${r.columns.length} col(s) from ${r.source.join(', ') || 'zetaris'}`;
  const rows = r.rows
    .slice(0, 3)
    .map((row) => r.columns.map((c, i) => `${c}=${row[i] ?? 'null'}`).join(', '))
    .join(' | ');
  return `${head}${rows ? `: ${rows}` : ''}${r.rowCount > 3 ? ' | ...' : ''}`.slice(0, 500);
}

export interface HypothesisToolState {
  hypothesisId: string;
  queriesUsed: number;
  queryCap: number;
  failStreak: number;
}

export interface ToolContext {
  zetaris: ZetarisClient;
  budget: Budget;
  catalog: () => Promise<CatalogTable[]>;
  state: HypothesisToolState;
  emit: (e: InvestigationEvent) => void;
  addEvidence: (result: QueryResult, purpose: string, hypothesisId: string) => Evidence;
}

export type ToolOutcome = { content: string; stop?: 'retries' | 'hypothesis_cap' | 'budget' };

function parseArgs(raw: string): Record<string, unknown> {
  try {
    const v = JSON.parse(raw || '{}');
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export async function executeTool(call: ToolCall, ctx: ToolContext): Promise<ToolOutcome> {
  const perm = TOOL_PERMISSION[call.name];
  if (!perm) return { content: `ERROR: unknown tool '${call.name}'. Available: ${Object.keys(TOOL_PERMISSION).join(', ')}` };
  if (!isToolAllowed(ctx.budget.contract, perm)) {
    return { content: `ERROR: tool '${call.name}' (${perm}) is not permitted by execution contract ${ctx.budget.contract.id}.` };
  }
  const args = parseArgs(call.arguments);

  if (call.name === 'zetaris_catalog') {
    const tables = await ctx.budget.withinDeadline(ctx.catalog());
    return {
      content: JSON.stringify(tables.slice(0, 80).map((t) => ({ fqName: t.fqName, origin: t.origin, description: t.description ?? '', columns: t.columns.length }))),
    };
  }

  if (call.name === 'zetaris_describe') {
    const name = String(args.table ?? '').trim().toLowerCase();
    const tables = await ctx.budget.withinDeadline(ctx.catalog());
    const t = tables.find((x) => x.fqName.toLowerCase() === name) ?? tables.find((x) => name && x.fqName.toLowerCase().endsWith('.' + name));
    if (!t) {
      return { content: `ERROR: table '${args.table ?? ''}' is not in the catalog. Known tables: ${tables.slice(0, 30).map((x) => x.fqName).join(', ')}` };
    }
    return { content: JSON.stringify({ fqName: t.fqName, origin: t.origin, description: t.description ?? '', columns: t.columns }) };
  }

  // zetaris_query
  const sql = String(args.sql ?? '').trim();
  const purpose = String(args.purpose ?? '').trim() || 'unspecified purpose';
  const { state } = ctx;
  if (!sql) return { content: 'ERROR: missing required argument "sql".' };
  if (state.failStreak > MAX_SQL_RETRIES) {
    return { content: `ERROR: retry limit reached (${MAX_SQL_RETRIES} retries). Do not query again; give your verdict JSON now.`, stop: 'retries' };
  }
  if (state.queriesUsed >= state.queryCap) {
    return { content: `BUDGET: this hypothesis has used its ${state.queryCap} query allowance. Give your verdict JSON now.`, stop: 'hypothesis_cap' };
  }
  try {
    ctx.budget.chargeQuery();
  } catch (e) {
    if (e instanceof BudgetExceededError) return { content: `BUDGET: ${e.message}. Give your verdict JSON now.`, stop: 'budget' };
    throw e;
  }
  state.queriesUsed++;
  ctx.emit({ type: 'query_started', hypothesisId: state.hypothesisId, sql, purpose });
  try {
    const timeoutMs = Math.max(1000, Math.min(90_000, ctx.budget.remainingMs()));
    const result = await ctx.budget.withinDeadline(ctx.zetaris.query(sql, { limit: 200, timeoutMs }));
    state.failStreak = 0;
    const ev = ctx.addEvidence(result, purpose, state.hypothesisId);
    return {
      content: JSON.stringify({
        evidenceId: ev.id,
        rowCount: result.rowCount,
        columns: result.columns,
        rows: result.rows.slice(0, ROWS_TO_MODEL),
        truncated: result.rows.length > ROWS_TO_MODEL,
        source: result.source,
      }),
    };
  } catch (e) {
    if (e instanceof BudgetExceededError) throw e; // hard deadline: unwind the hypothesis loop
    state.failStreak++;
    const message = String((e as Error)?.message ?? e).slice(0, 800);
    ctx.emit({ type: 'query_failed', hypothesisId: state.hypothesisId, sql, error: message, attempt: state.failStreak });
    const left = MAX_SQL_RETRIES + 1 - state.failStreak;
    return {
      content: `ERROR (attempt ${state.failStreak} of ${MAX_SQL_RETRIES + 1}): ${message}\n` +
        (left > 0
          ? 'Read the error, fix the SQL (check table/column names against the schema, Lightning/Spark SQL syntax) and call zetaris_query again.'
          : 'No retries left for this query; give your verdict JSON now.'),
      stop: left > 0 ? undefined : 'retries',
    };
  }
}
