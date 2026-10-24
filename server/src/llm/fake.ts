// Deterministic scripted LLM for unit tests (generic: works against any catalog).
// SAMPLE_MODE uses the deterministic analyst in src/agent/analyst.ts instead, which runs real analytic SQL.
// Former header: Deterministic scripted LLM for CAUSA_FAKE=1. It reads the phase tag in the system prompt and the
// structured blocks the agent puts in the conversation, so it can drive a full investigation offline
// against whatever fixture catalog the fake Zetaris client serves.
import type { ChatMessage, ToolCall } from '../types';
import { PHASE } from '../agent/prompts';
import type { CausaChatResponse, CausaLLM } from './nim';

const DIM = 64;

function hashToken(tok: string): number {
  let h = 2166136261;
  for (let i = 0; i < tok.length; i++) {
    h ^= tok.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function fakeEmbedding(text: string): number[] {
  const v = new Array<number>(DIM).fill(0);
  const toks = text.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 1);
  for (const t of toks) {
    const h = hashToken(t);
    v[h % DIM] += (h & 1) === 0 ? 1 : -1;
    v[(h >>> 8) % DIM] += 0.5;
  }
  const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
  if (norm === 0) {
    v[0] = 1;
    return v;
  }
  return v.map((x) => x / norm);
}

const YEARISH = /year|fy|date|period|quarter|month/i;

function parseLines(text: string, prefix: string): any[] {
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

const ID_COL = /(^|_)(cik|id|sic|code|zip|phone)($|_)/i;
const VALUE_COL = /revenue|value|amount|sales|cpi|index|growth|income|usd/i;

function firstNumericCell(columns: string[], rows: unknown[][]): { col: string; value: string; label: string } | undefined {
  const order = columns
    .map((_, c) => c)
    .filter((c) => !YEARISH.test(columns[c]) && !ID_COL.test(columns[c]))
    .sort((a, b) => Number(VALUE_COL.test(columns[b])) - Number(VALUE_COL.test(columns[a])));
  for (const c of order) for (const row of rows) {
    {
      const cell = row[c];
      const s = cell === null || cell === undefined ? '' : String(cell);
      if (s !== '' && Number.isFinite(Number(s.replace(/,/g, ''))) && Math.abs(Number(s.replace(/,/g, ''))) > 10) {
        const labelIdx = columns.findIndex((col, i) => i !== c && row[i] !== null && row[i] !== undefined);
        const label = labelIdx >= 0 ? `${columns[labelIdx]} ${String(row[labelIdx])}` : 'the first row';
        return { col: columns[c], value: s, label };
      }
    }
  }
  return undefined;
}

let callSeq = 0;

function toolCall(name: string, args: Record<string, unknown>): ToolCall {
  callSeq++;
  return { id: `fake_call_${callSeq}`, name, arguments: JSON.stringify(args) };
}

const STATUS_BY_HYP: Record<string, string> = { 'h-1': 'supported', 'h-2': 'supported', 'h-3': 'refuted', 'h-4': 'inconclusive' };

/** Markovian turns carry state + latest tool results in later user messages (never 'tool' role messages). */
function laterUserText(messages: ChatMessage[]): string {
  const users = messages.filter((m) => m.role === 'user');
  return users.slice(1).map((m) => m.content).join('\n');
}

function verdict(hypId: string, messages: ChatMessage[]): string {
  const ids = [...new Set([...laterUserText(messages).matchAll(/\b(ev-\d+)\b/g)].map((m) => m[1]))];
  const status = ids.length === 0 ? 'inconclusive' : STATUS_BY_HYP[hypId] ?? 'inconclusive';
  return JSON.stringify({
    status,
    rationale: ids.length ? `Scripted verdict from ${ids.map((i) => `[${i}]`).join(', ')}.` : 'No evidence could be collected.',
    evidenceIds: ids,
  });
}

function investigateStep(messages: ChatMessage[], userText: string): { content: string; toolCalls: ToolCall[] } {
  const hypId = userText.match(/HYPOTHESIS (h-\d+)/)?.[1] ?? 'h-1';
  const hypNum = Number(hypId.slice(2)) || 1;
  const tables = [...userText.matchAll(/^- table: (\S+)/gm)].map((m) => m[1]);
  const last = messages[messages.length - 1];
  const at = last?.role === 'user' ? last.content.indexOf('LATEST TOOL RESULTS') : -1;
  const latest = at >= 0 ? last.content.slice(at) : '';
  if (!latest) {
    if (tables.length === 0) return { content: '', toolCalls: [toolCall('zetaris_catalog', {})] };
    const t = tables[(hypNum - 1) % tables.length];
    return {
      content: '',
      toolCalls: [toolCall('zetaris_query', { sql: `SELECT * FROM ${t} LIMIT 20`, purpose: `Pull ${t} to test ${hypId}` })],
    };
  }
  if (/"evidenceId":"ev-\d+"/.test(latest)) return { content: verdict(hypId, messages), toolCalls: [] };
  const err = latest.match(/-> ERROR \(attempt (\d+) of (\d+)\)/);
  if (err) {
    if (Number(err[1]) >= Number(err[2])) return { content: verdict(hypId, messages), toolCalls: [] };
    const t = tables[(hypNum - 1) % Math.max(1, tables.length)] ?? latest.match(/\b[\w]+\.[\w]+\.[\w]+\b/)?.[0];
    if (!t) return { content: verdict(hypId, messages), toolCalls: [] };
    return { content: '', toolCalls: [toolCall('zetaris_query', { sql: `SELECT * FROM ${t} LIMIT 5`, purpose: `Retry simpler query on ${t}` })] };
  }
  // catalog / describe output: pick a table from it
  const listed = latest.match(/"fqName":"([^"]+)"/)?.[1];
  if (listed) {
    return { content: '', toolCalls: [toolCall('zetaris_query', { sql: `SELECT * FROM ${listed} LIMIT 20`, purpose: `Pull ${listed} to test ${hypId}` })] };
  }
  return { content: verdict(hypId, messages), toolCalls: [] };
}

export function createFakeLLM(opts: { model?: string } = {}): CausaLLM {
  const model = opts.model ?? 'fake/nemotron-scripted';
  return {
    provider: 'fake (CAUSA_FAKE=1 / SAMPLE_MODE=true)',
    modelId: model,
    fake: true,
    async chat(messages, o = {}): Promise<CausaChatResponse> {
      const system = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n');
      const users = messages.filter((m) => m.role === 'user');
      const firstUser = users[0]?.content ?? '';
      const lastUser = users[users.length - 1]?.content ?? '';
      let content = 'OK';
      let toolCalls: ToolCall[] = [];
      let phase = 'chat';

      if (system.includes(PHASE.critic)) {
        phase = 'critic';
        const claims = parseLines(firstUser, 'CLAIM');
        content = JSON.stringify({
          reviews: claims.map((c) => ({ index: c.index, verdict: 'verified', note: 'Scripted critic: numbers located in cited rows.' })),
        });
      } else if (system.includes(PHASE.synthesize)) {
        phase = 'synthesize';
        const evidence = parseLines(firstUser, 'EVIDENCE');
        const hyps = parseLines(firstUser, 'HYPOTHESIS');
        const claims = [];
        for (const h of hyps) {
          const ev = evidence.find((e) => h.evidenceIds?.includes(e.id));
          if (!ev) continue;
          const cell = firstNumericCell(ev.columns, ev.rows);
          if (!cell) continue;
          claims.push({
            text: `${h.statement.split(' — ')[0]}: ${cell.col} was ${cell.value} for ${cell.label} [${ev.id}].`,
            confidence: h.status === 'supported' ? 'high' : 'medium',
            evidenceIds: [ev.id],
          });
        }
        content = JSON.stringify({
          summary: `Scripted answer from ${evidence.length} evidence record(s); ${hyps.filter((h) => h.status === 'supported').length} hypothesis(es) supported.`,
          claims,
        });
      } else if (lastUser.includes(PHASE.verdict)) {
        phase = 'verdict';
        const hypId = firstUser.match(/HYPOTHESIS (h-\d+)/)?.[1] ?? 'h-1';
        content = verdict(hypId, messages);
      } else if (system.includes(PHASE.investigate)) {
        phase = 'investigate';
        const step = investigateStep(messages, firstUser);
        content = step.content;
        toolCalls = o.tools?.length ? step.toolCalls : [];
        if (!o.tools?.length && !content) content = verdict('h-1', messages);
      } else if (system.includes(PHASE.plan)) {
        phase = 'plan';
        const focus = firstUser.match(/^ENTITY .*"name":"([^"]+)"/m)?.[1];
        const q = focus ? 'its revenue growth versus peers' : firstUser.match(/QUESTION: (.*)/)?.[1] ?? 'the question';
        content = JSON.stringify({
          hypotheses: [
            { statement: `Company-specific execution${focus ? ` at ${focus}` : ""} explains: ${q}`, layer: 'company', test: 'Compare the company YoY revenue growth with its own history.', refutedIf: 'Growth is in line with its own history.' },
            { statement: 'The whole sector slowed at the same time', layer: 'sector', test: 'Compare YoY growth with SIC peers.', refutedIf: 'Peers kept growing.' },
            { statement: 'Macro inflation inflated nominal revenue', layer: 'macro', test: 'Compare nominal growth with CPI.', refutedIf: 'Real growth matches nominal growth.' },
          ],
        });
      }
      const requested = o.model ?? model;
      return {
        content,
        reasoning: o.thinking ? `(fake reasoning) phase=${phase}; deterministic script.` : undefined,
        toolCalls,
        model: `${requested} via fake`,
        handledBy: { provider: 'fake', requested, model: requested, headers: {}, latencyMs: 0 },
        usage: { promptTokens: messages.reduce((s, m) => s + Math.ceil(m.content.length / 4), 0), completionTokens: Math.ceil(content.length / 4) },
      };
    },
    async embed(texts) {
      return texts.map(fakeEmbedding);
    },
    async canEmbed() {
      return true;
    },
    async health() {
      return { ok: true, status: 'online' as const, models: [model], detail: `fake LLM (${model}), offline sample mode` };
    },
  };
}
