import type { ZodType, ZodTypeDef } from 'zod';
import type { ChatMessage, ChatResponse, LLM, ToolSpec } from '../types';
import { LLMError } from './errors';

type ChatOpts = { tools?: ToolSpec[]; thinking?: boolean; temperature?: number; model?: string };
export type ChatFn = (messages: ChatMessage[], opts?: ChatOpts) => Promise<ChatResponse>;

/** Pull the first JSON object/array out of a model reply (handles ```json fences, <think> blocks and prose around it). */
export function extractJson(text: string): unknown {
  let t = text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();
  try {
    return JSON.parse(t);
  } catch {
    /* fall through to bracket scan */
  }
  const start = t.search(/[[{]/);
  if (start < 0) throw new Error('no JSON object found');
  const open = t[start];
  const close = open === '{' ? '}' : ']';
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < t.length; i++) {
    const c = t[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === open) depth++;
    else if (c === close && --depth === 0) return JSON.parse(t.slice(start, i + 1));
  }
  throw new Error('unterminated JSON');
}

function validate<T>(schema: ZodType<T, ZodTypeDef, unknown>, content: string): { ok: true; value: T } | { ok: false; error: string } {
  let parsed: unknown;
  try {
    parsed = extractJson(content);
  } catch (e) {
    return { ok: false, error: `not valid JSON (${(e as Error).message})` };
  }
  const r = schema.safeParse(parsed);
  if (r.success) return { ok: true, value: r.data };
  return {
    ok: false,
    error: 'JSON is not valid against the schema: ' + r.error.issues.slice(0, 6).map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; '),
  };
}

/**
 * JSON-mode helper: ask, parse + zod-validate, and on failure re-ask exactly once with the error.
 * `llmOrChat` may be an LLM or a (metered) chat function so callers can charge budgets per call.
 */
export async function chatJson<T>(
  llmOrChat: LLM | ChatFn,
  messages: ChatMessage[],
  schema: ZodType<T, ZodTypeDef, unknown>,
  opts: ChatOpts = {},
): Promise<{ value: T; response: ChatResponse; attempts: number }> {
  const chat: ChatFn = typeof llmOrChat === 'function' ? llmOrChat : (m, o) => llmOrChat.chat(m, o);
  const first = await chat(messages, opts);
  const v1 = validate(schema, first.content);
  if (v1.ok) return { value: v1.value, response: first, attempts: 1 };
  const retryMessages: ChatMessage[] = [
    ...messages,
    { role: 'assistant', content: first.content.slice(0, 4000) },
    {
      role: 'user',
      content: `Your previous reply was not valid: ${v1.error}. Reply again with ONLY the corrected JSON object, no prose, no code fences.`,
    },
  ];
  const second = await chat(retryMessages, opts);
  const v2 = validate(schema, second.content);
  if (v2.ok) return { value: v2.value, response: second, attempts: 2 };
  throw new LLMError('invalid_json', `Model returned invalid JSON twice: ${v2.error}`);
}
