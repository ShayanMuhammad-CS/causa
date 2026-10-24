import type { LLM } from '../types';
import { createFakeLLM } from './fake';
import { createMeterlessLLM, resolveMeterlessToken } from './meterless';
import { createNimLLM, type CausaLLM } from './nim';

export { LLMError } from './errors';
export type { LLMErrorKind } from './errors';
export { chatJson, extractJson } from './json';
export type { ChatFn } from './json';
export { createNimLLM, createCompatLLM, splitThink, describeHandledBy } from './nim';
export type { AgentChatMessage, CausaLLM, CausaChatResponse, EmbedInputType, ChatOptions, HandledBy, LLMHealth } from './nim';
export { createMeterlessLLM, normalizeMeterlessBaseURL, resolveMeterlessToken, METERLESS_MODES } from './meterless';
export { createFakeLLM } from './fake';
export { withRetry } from './retry';

/** CAUSA_FAKE=1 or SAMPLE_MODE=true (the hackathon requirements' recommended offline fallback). */
export function isFakeMode(env: NodeJS.ProcessEnv): boolean {
  return env.CAUSA_FAKE === '1' || String(env.SAMPLE_MODE ?? '').toLowerCase() === 'true';
}

const onRetry = (i: { kind: string; attempt: number; delayMs: number }) => console.warn(`[llm] retry ${i.attempt} after ${i.kind}, waiting ${i.delayMs}ms`);

/**
 * Factory per types.ts. Primary path: Meterless Nightshift (CAUSA_LLM_PROVIDER unset or 'meterless').
 * CAUSA_LLM_PROVIDER=nvidia is an explicitly labelled DEV FALLBACK that calls NVIDIA NIM directly.
 */
export function createLLM(env: NodeJS.ProcessEnv): LLM & CausaLLM {
  if (isFakeMode(env)) return createFakeLLM();
  const provider = (env.CAUSA_LLM_PROVIDER || 'meterless').toLowerCase();
  if (provider === 'nvidia') {
    console.warn('[llm] CAUSA_LLM_PROVIDER=nvidia: DEV FALLBACK, bypassing Meterless Nightshift (not valid for submission)');
    return createNimLLM({
      apiKey: env.NVIDIA_API_KEY ?? '',
      baseURL: env.NVIDIA_BASE_URL || 'https://integrate.api.nvidia.com/v1',
      model: env.CAUSA_MODEL || 'nvidia/nemotron-3-super-120b-a12b',
      embedModel: env.CAUSA_EMBED_MODEL || 'nvidia/llama-3.2-nv-embedqa-1b-v2',
      timeoutMs: Number(env.CAUSA_LLM_TIMEOUT_MS) || 120_000,
      maxRetries: env.CAUSA_LLM_RETRIES !== undefined ? Number(env.CAUSA_LLM_RETRIES) : 3,
      maxTokens: Number(env.CAUSA_MAX_TOKENS) || 8192,
      onRetry,
    });
  }
  if (provider !== 'meterless') throw new Error(`unknown CAUSA_LLM_PROVIDER '${provider}' (use 'meterless' or 'nvidia')`);
  return createMeterlessLLM({
    baseURL: env.METERLESS_BASE_URL,
    token: resolveMeterlessToken(env),
    model: env.METERLESS_MODEL || 'meterless/auto',
    embedModel: env.CAUSA_METERLESS_EMBED_MODEL || undefined,
    timeoutMs: Number(env.CAUSA_LLM_TIMEOUT_MS) || 180_000,
    maxRetries: env.CAUSA_LLM_RETRIES !== undefined ? Number(env.CAUSA_LLM_RETRIES) : 3,
    maxTokens: Number(env.CAUSA_MAX_TOKENS) || 8192,
    sendThinkingKwargs: env.CAUSA_THINKING_KWARGS !== '0',
    onRetry,
  });
}

/** Per-role model overrides (e.g. pin the critic to a Nemotron route). Undefined = provider default. */
export function roleModelsFromEnv(env: NodeJS.ProcessEnv): { planner?: string; critic?: string } {
  return { planner: env.CAUSA_MODEL_PLANNER || undefined, critic: env.CAUSA_MODEL_CRITIC || undefined };
}
