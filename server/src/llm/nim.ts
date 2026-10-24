// OpenAI-compatible chat/embeddings core shared by the Meterless Nightshift client (primary) and the
// NVIDIA-direct dev fallback. Retries with jittered backoff on 429/5xx/timeouts, typed errors, reasoning capture,
// native tool calling, and "who handled this request" capture (response.model + meterless-* headers).
import OpenAI from 'openai';
import type { ChatMessage, ChatResponse, ToolCall, ToolSpec } from '../types';
import { LLMError, toLLMError } from './errors';
import { withRetry } from './retry';

export type EmbedInputType = 'query' | 'passage';

/** ChatMessage plus the assistant's tool calls (types.ts has no slot for them; native multi-turn tool calling needs it). */
export interface AgentChatMessage extends ChatMessage {
  toolCalls?: ToolCall[];
}

export interface ChatOptions {
  tools?: ToolSpec[];
  thinking?: boolean;
  temperature?: number;
  model?: string;
}

/** Which model/provider actually served a request. Also folded into ChatResponse.model as a readable string. */
export interface HandledBy {
  provider: string;
  requested: string;
  model: string;
  headers: Record<string, string>;
  latencyMs: number;
}

export type CausaChatResponse = ChatResponse & { handledBy?: HandledBy };

export interface LLMHealth {
  ok: boolean;
  detail: string;
  status?: 'online' | 'unauthorized' | 'offline';
  models?: string[];
}

/** Superset of the LLM contract; still assignable to `LLM`. */
export interface CausaLLM {
  readonly provider: string;
  readonly modelId: string;
  readonly fake: boolean;
  chat(messages: ChatMessage[], opts?: ChatOptions): Promise<CausaChatResponse>;
  embed(texts: string[], opts?: { inputType?: EmbedInputType }): Promise<number[][]>;
  /** true only if this provider is known/probed to serve embeddings. */
  canEmbed(): Promise<boolean>;
  health(): Promise<LLMHealth>;
}

export interface CompatOptions {
  provider: string;
  apiKey: string;
  baseURL: string;
  model: string;
  embedModel?: string;
  timeoutMs: number;
  maxRetries?: number;
  maxTokens?: number;
  defaultTemperature?: number;
  defaultHeaders?: Record<string, string>;
  chatHeaders?: Record<string, string>;
  sendThinkingKwargs?: boolean;     // send chat_template_kwargs.enable_thinking (Nemotron chat template)
  routeHeaderPrefix?: string;       // response headers to capture, e.g. 'meterless-'
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  onRetry?: (info: { kind: string; attempt: number; delayMs: number }) => void;
  health: (client: OpenAI) => Promise<LLMHealth>;
  canEmbed: (embed: (texts: string[]) => Promise<number[][]>) => Promise<boolean>;
}

function toOpenAIMessages(messages: ChatMessage[]): OpenAI.Chat.Completions.ChatCompletionMessageParam[] {
  return messages.map((m) => {
    const tc = (m as AgentChatMessage).toolCalls;
    if (m.role === 'tool') return { role: 'tool', tool_call_id: m.tool_call_id ?? 'unknown', content: m.content };
    if (m.role === 'assistant' && tc && tc.length > 0) {
      return {
        role: 'assistant',
        content: m.content || null,
        tool_calls: tc.map((c) => ({ id: c.id, type: 'function' as const, function: { name: c.name, arguments: c.arguments } })),
      };
    }
    if (m.role === 'system') return { role: 'system', content: m.content };
    if (m.role === 'assistant') return { role: 'assistant', content: m.content };
    return { role: 'user', content: m.content };
  });
}

/** Split "<think>..</think>answer" when a server inlines reasoning into content. */
export function splitThink(content: string): { content: string; reasoning?: string } {
  const m = content.match(/^\s*<think>([\s\S]*?)<\/think>\s*/i);
  if (!m) return { content };
  return { content: content.slice(m[0].length), reasoning: m[1].trim() };
}

export function describeHandledBy(h: HandledBy): string {
  const hdr = Object.entries(h.headers).map(([k, v]) => `${k}=${v}`).join('; ');
  return `${h.model}${h.requested !== h.model ? ` (requested ${h.requested})` : ''} via ${h.provider}${hdr ? ` [${hdr}]` : ''}`;
}

export function createCompatLLM(o: CompatOptions): CausaLLM {
  const client = new OpenAI({
    apiKey: o.apiKey,
    baseURL: o.baseURL,
    timeout: o.timeoutMs,
    maxRetries: 0, // we own retries (typed errors + jitter + Retry-After)
    defaultHeaders: o.defaultHeaders,
    ...(o.fetch ? { fetch: o.fetch as any } : {}),
  });
  const retry = <T>(fn: () => Promise<T>) =>
    withRetry(fn, {
      maxRetries: o.maxRetries ?? 3,
      sleep: o.sleep,
      onRetry: (err, attempt, delayMs) => o.onRetry?.({ kind: err.kind, attempt, delayMs }),
    });

  const embedRaw = async (texts: string[], inputType: EmbedInputType) => {
    if (!o.embedModel) throw new LLMError('config', `${o.provider}: no embedding model configured`);
    if (texts.length === 0) return [];
    const out: number[][] = [];
    for (let i = 0; i < texts.length; i += 32) {
      const body = {
        model: o.embedModel,
        input: texts.slice(i, i + 32),
        encoding_format: 'float',
        // NVIDIA retrieval embedders are asymmetric: 'passage' when indexing, 'query' when searching.
        input_type: inputType,
        truncate: 'END',
      };
      const res = await retry(() => client.embeddings.create(body as any));
      for (const d of [...res.data].sort((a, b) => a.index - b.index)) out.push(d.embedding as number[]);
    }
    return out;
  };
  let embedProbe: Promise<boolean> | undefined;

  return {
    provider: o.provider,
    modelId: o.model,
    fake: false,

    async chat(messages, opts = {}) {
      const requested = opts.model ?? o.model;
      const body: Record<string, unknown> = {
        model: requested,
        messages: toOpenAIMessages(messages),
        temperature: opts.temperature ?? o.defaultTemperature ?? 0.6,
        top_p: 0.95,
        max_tokens: o.maxTokens ?? 8192,
      };
      // Nemotron 3 reasons by default; the chat template toggle makes it explicit.
      if (o.sendThinkingKwargs !== false) body.chat_template_kwargs = { enable_thinking: opts.thinking ?? false };
      if (opts.tools && opts.tools.length > 0) {
        body.tools = opts.tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } }));
        body.tool_choice = 'auto';
      }
      const started = Date.now();
      const { data: res, response } = await retry(() =>
        client.chat.completions.create(body as any, { headers: o.chatHeaders }).withResponse() as Promise<{
          data: OpenAI.Chat.Completions.ChatCompletion;
          response: Response;
        }>,
      );
      const choice = res.choices?.[0];
      if (!choice) throw new LLMError('server', `${o.provider}: response had no choices`);
      const msg = choice.message as OpenAI.Chat.Completions.ChatCompletionMessage & { reasoning_content?: string; reasoning?: string };
      const split = splitThink(msg.content ?? '');
      const reasoning = msg.reasoning_content ?? msg.reasoning ?? split.reasoning;
      const toolCalls: ToolCall[] = (msg.tool_calls ?? [])
        .filter((c) => c.type === 'function')
        .map((c, i) => ({ id: c.id || `call_${i}`, name: c.function.name, arguments: c.function.arguments ?? '{}' }));
      const headers: Record<string, string> = {};
      if (o.routeHeaderPrefix) {
        response.headers.forEach((v, k) => {
          if (k.toLowerCase().startsWith(o.routeHeaderPrefix!)) headers[k.toLowerCase()] = v;
        });
      }
      const handledBy: HandledBy = { provider: o.provider, requested, model: res.model ?? requested, headers, latencyMs: Date.now() - started };
      return {
        content: split.content.trim(),
        reasoning: reasoning ? String(reasoning) : undefined,
        toolCalls,
        model: describeHandledBy(handledBy),
        handledBy,
        usage: res.usage ? { promptTokens: res.usage.prompt_tokens, completionTokens: res.usage.completion_tokens } : undefined,
      };
    },

    embed: (texts, opts = {}) => embedRaw(texts, opts.inputType ?? 'passage'),

    canEmbed() {
      embedProbe ??= o.canEmbed((t) => embedRaw(t, 'query')).catch(() => false);
      return embedProbe;
    },

    health: () => o.health(client),
  };
}

export interface NimOptions {
  apiKey: string;
  baseURL: string;
  model: string;
  embedModel: string;
  timeoutMs?: number;
  maxRetries?: number;
  maxTokens?: number;
  defaultTemperature?: number;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  onRetry?: (info: { kind: string; attempt: number; delayMs: number }) => void;
}

/** DEV FALLBACK ONLY (CAUSA_LLM_PROVIDER=nvidia): talks to NVIDIA NIM directly, bypassing Meterless Nightshift. */
export function createNimLLM(o: NimOptions): CausaLLM {
  if (!o.apiKey) throw new LLMError('config', 'NVIDIA_API_KEY is not set (nvidia-direct dev fallback)');
  return createCompatLLM({
    ...o,
    provider: 'nvidia-direct (dev fallback)',
    timeoutMs: o.timeoutMs ?? 120_000,
    sendThinkingKwargs: true,
    canEmbed: async () => true,
    health: async (client) => {
      try {
        const page = await client.models.list({ timeout: 10_000, maxRetries: 0 } as any);
        const ids = page.data.map((m) => m.id);
        return { ok: ids.includes(o.model), status: 'online', models: ids.filter((i) => /nemotron|embed/i.test(i)).slice(0, 20), detail: `NVIDIA NIM (dev fallback); ${o.model} ${ids.includes(o.model) ? 'listed' : 'NOT listed'}` };
      } catch (e) {
        const err = toLLMError(e);
        return { ok: false, status: err.kind === 'auth' ? 'unauthorized' : 'offline', detail: `${err.kind}: ${err.message}` };
      }
    },
  });
}
