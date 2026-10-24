import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { createNimLLM } from '../src/llm/nim';
import { chatJson } from '../src/llm/json';
import { LLMError } from '../src/llm/errors';
import { createFakeLLM } from '../src/llm/fake';
import type { ChatResponse, LLM } from '../src/types';

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

const okCompletion = {
  id: 'c1',
  object: 'chat.completion',
  created: 0,
  model: 'nvidia/nemotron-3-super-120b-a12b',
  choices: [
    {
      index: 0,
      finish_reason: 'tool_calls',
      message: {
        role: 'assistant',
        content: 'done',
        reasoning_content: 'I considered the peers.',
        tool_calls: [
          { id: 'call_1', type: 'function', function: { name: 'zetaris_query', arguments: '{"sql":"SELECT 1"}' } },
        ],
      },
    },
  ],
  usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
};

describe('NIM LLM client', () => {
  it('retries on 429 with backoff and then succeeds, sending the thinking toggle', async () => {
    const calls: { body: any }[] = [];
    const sleeps: number[] = [];
    const fetchImpl = async (_url: unknown, init: any) => {
      calls.push({ body: JSON.parse(init.body) });
      if (calls.length === 1) return jsonResponse(429, { error: { message: 'rate limited' } });
      return jsonResponse(200, okCompletion);
    };
    const llm = createNimLLM({
      apiKey: 'test-key',
      baseURL: 'http://nim.test/v1',
      model: 'nvidia/nemotron-3-super-120b-a12b',
      embedModel: 'e',
      fetch: fetchImpl as any,
      sleep: async (ms) => { sleeps.push(ms); },
    });
    const res = await llm.chat([{ role: 'user', content: 'hi' }], {
      thinking: true,
      tools: [{ name: 'zetaris_query', description: 'q', parameters: { type: 'object', properties: {} } }],
    });
    expect(calls).toHaveLength(2);
    expect(sleeps).toHaveLength(1);
    expect(calls[1].body.chat_template_kwargs).toEqual({ enable_thinking: true });
    expect(calls[1].body.tools[0].function.name).toBe('zetaris_query');
    expect(res.reasoning).toBe('I considered the peers.');
    expect(res.toolCalls).toEqual([{ id: 'call_1', name: 'zetaris_query', arguments: '{"sql":"SELECT 1"}' }]);
    expect(res.usage).toEqual({ promptTokens: 10, completionTokens: 5 });
  });

  it('throws a typed non-retryable error on 401 without retrying', async () => {
    let n = 0;
    const llm = createNimLLM({
      apiKey: 'k', baseURL: 'http://nim.test/v1', model: 'm', embedModel: 'e',
      fetch: (async () => { n++; return jsonResponse(401, { error: { message: 'bad key' } }); }) as any,
      sleep: async () => {},
    });
    const err = await llm.chat([{ role: 'user', content: 'x' }]).catch((e) => e);
    expect(err).toBeInstanceOf(LLMError);
    expect(err.kind).toBe('auth');
    expect(n).toBe(1);
  });

  it('gives up after max retries on persistent 503 with kind server', async () => {
    let n = 0;
    const llm = createNimLLM({
      apiKey: 'k', baseURL: 'http://nim.test/v1', model: 'm', embedModel: 'e', maxRetries: 2,
      fetch: (async () => { n++; return jsonResponse(503, { error: { message: 'down' } }); }) as any,
      sleep: async () => {},
    });
    const err = await llm.chat([{ role: 'user', content: 'x' }]).catch((e) => e);
    expect(err.kind).toBe('server');
    expect(n).toBe(3);
  });

  it('embed sends input_type and returns vectors in index order', async () => {
    let body: any;
    const llm = createNimLLM({
      apiKey: 'k', baseURL: 'http://nim.test/v1', model: 'm', embedModel: 'nvidia/embed',
      fetch: (async (_u: unknown, init: any) => {
        body = JSON.parse(init.body);
        return jsonResponse(200, {
          object: 'list', model: 'nvidia/embed',
          data: [
            { object: 'embedding', index: 1, embedding: [0, 1] },
            { object: 'embedding', index: 0, embedding: [1, 0] },
          ],
          usage: { prompt_tokens: 2, total_tokens: 2 },
        });
      }) as any,
      sleep: async () => {},
    });
    const v = await llm.embed(['a', 'b'], { inputType: 'query' });
    expect(body.input_type).toBe('query');
    expect(body.model).toBe('nvidia/embed');
    expect(v).toEqual([[1, 0], [0, 1]]);
  });
});

describe('chatJson', () => {
  it('re-asks once with the validation error when the first reply is invalid', async () => {
    const seen: string[] = [];
    const replies = ['not json at all', '```json\n{"n": 3}\n```'];
    const llm: LLM = {
      async chat(messages): Promise<ChatResponse> {
        seen.push(messages[messages.length - 1].content);
        return { content: replies.shift()!, toolCalls: [], model: 'm' };
      },
      async embed() { return []; },
    };
    const out = await chatJson(llm, [{ role: 'user', content: 'give n' }], z.object({ n: z.number() }));
    expect(out.value).toEqual({ n: 3 });
    expect(seen).toHaveLength(2);
    expect(seen[1]).toMatch(/not valid/i);
  });

  it('throws invalid_json after the second bad reply', async () => {
    const llm: LLM = {
      async chat() { return { content: '{"n":"x"}', toolCalls: [], model: 'm' }; },
      async embed() { return []; },
    };
    const err = await chatJson(llm, [{ role: 'user', content: 'n' }], z.object({ n: z.number() })).catch((e) => e);
    expect(err).toBeInstanceOf(LLMError);
    expect(err.kind).toBe('invalid_json');
  });
});

describe('fake LLM', () => {
  it('is deterministic and embeds into normalized vectors', async () => {
    const llm = createFakeLLM();
    const [a, b] = await llm.embed(['walmart revenue', 'walmart revenue']);
    expect(a).toEqual(b);
    const norm = Math.sqrt(a.reduce((s, x) => s + x * x, 0));
    expect(norm).toBeCloseTo(1, 5);
  });
});

// ---------- Meterless Nightshift (primary provider) ----------
import { createMeterlessLLM, normalizeMeterlessBaseURL, resolveMeterlessToken } from '../src/llm/meterless';
import { createLLM } from '../src/llm';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('Meterless LLM client', () => {
  it('normalises the base URL to <host>/v1 (never /v1/v1)', () => {
    expect(normalizeMeterlessBaseURL(undefined)).toBe('http://127.0.0.1:8088/v1');
    expect(normalizeMeterlessBaseURL('http://127.0.0.1:8088')).toBe('http://127.0.0.1:8088/v1');
    expect(normalizeMeterlessBaseURL('http://127.0.0.1:8088/v1/')).toBe('http://127.0.0.1:8088/v1');
    expect(normalizeMeterlessBaseURL('http://h:1/v1/v1')).toBe('http://h:1/v1');
  });

  it('rejects the rt-local placeholder and falls back to the token file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'causa-tok-'));
    try {
      expect(() => resolveMeterlessToken({ METERLESS_RUNTIME_TOKEN: 'rt-local' })).toThrow(/placeholder/);
      writeFileSync(join(dir, 'proxy-token'), 'tok-from-file\n');
      expect(resolveMeterlessToken({ CAUSA_METERLESS_TOKEN_FILE: join(dir, 'proxy-token') })).toBe('tok-from-file');
      expect(resolveMeterlessToken({ METERLESS_RUNTIME_TOKEN: 'tok-env', CAUSA_METERLESS_TOKEN_FILE: join(dir, 'proxy-token') })).toBe('tok-env');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('sends auth + meterless-app on every request, meterless-scope on chat, and records who handled it', async () => {
    const seen: { url: string; headers: Record<string, string>; body?: any }[] = [];
    const fetchImpl = async (url: unknown, init: any) => {
      const h = new Headers(init.headers);
      seen.push({ url: String(url), headers: Object.fromEntries(h.entries()), body: init.body ? JSON.parse(init.body) : undefined });
      if (seen.length === 1) return jsonResponse(429, { error: { message: 'busy' } });
      return jsonResponse(200, { ...okCompletion, model: 'nvidia/nemotron-3-super-120b-a12b' }, { 'meterless-route': 'meterless/deep', 'meterless-provider': 'nvidia' });
    };
    const llm = createMeterlessLLM({ baseURL: 'http://127.0.0.1:8088', token: 'tok', model: 'meterless/auto', fetch: fetchImpl as any, sleep: async () => {} });
    const res = await llm.chat([{ role: 'user', content: 'hi' }], { thinking: true });
    expect(seen).toHaveLength(2);
    expect(seen[1].url).toBe('http://127.0.0.1:8088/v1/chat/completions');
    expect(seen[1].headers.authorization).toBe('Bearer tok');
    expect(seen[1].headers['meterless-app']).toBe('causa');
    expect(seen[1].headers['meterless-scope']).toBe('user');
    expect(seen[1].body.model).toBe('meterless/auto');
    expect(res.model).toContain('nvidia/nemotron-3-super-120b-a12b');
    expect(res.model).toContain('meterless-provider=nvidia');
    expect((res as any).handledBy).toMatchObject({ model: 'nvidia/nemotron-3-super-120b-a12b', requested: 'meterless/auto', headers: { 'meterless-route': 'meterless/deep' } });
  });

  it('health is /v1/models discovery: online with ids, unauthorized on 401, offline otherwise', async () => {
    const mk = (resp: () => Response) =>
      createMeterlessLLM({ baseURL: 'http://m:8088/v1', token: 't', model: 'meterless/auto', fetch: (async () => resp()) as any, sleep: async () => {} });
    const online = await mk(() => jsonResponse(200, { object: 'list', data: [{ id: 'meterless/auto' }, { id: 'meterless/deep' }] })).health();
    expect(online).toMatchObject({ ok: true, status: 'online', models: ['meterless/auto', 'meterless/deep'] });
    expect((await mk(() => jsonResponse(401, {})).health())).toMatchObject({ ok: false, status: 'unauthorized' });
    expect((await mk(() => jsonResponse(200, { data: [{ id: 'gpt-x' }] })).health())).toMatchObject({ ok: false, status: 'offline' });
    expect((await mk(() => { throw new Error('ECONNREFUSED'); }).health())).toMatchObject({ ok: false, status: 'offline' });
  });

  it('createLLM defaults to Meterless; SAMPLE_MODE=true gives the fake; nvidia only when asked', () => {
    expect(createLLM({ METERLESS_RUNTIME_TOKEN: 'x' }).provider).toBe('meterless-nightshift');
    expect(createLLM({ SAMPLE_MODE: 'true' }).fake).toBe(true);
    expect(createLLM({ CAUSA_LLM_PROVIDER: 'nvidia', NVIDIA_API_KEY: 'k' }).provider).toBe('nvidia-direct (dev fallback)');
  });
});
