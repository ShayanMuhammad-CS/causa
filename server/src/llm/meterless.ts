// PRIMARY provider: Meterless Nightshift runtime (OpenAI-compatible). Hackathon rule: every submission uses
// Nightshift as its primary AI provider; the NVIDIA key lives in Nightshift's Providers, not in our .env.
// Contract: base <host>/v1; headers Authorization: Bearer <runtime token> + meterless-app: causa on every request,
// meterless-scope: user on chat; GET /v1/models is the health/discovery probe (/healthz only proves the process).
import { readFileSync } from 'node:fs';
import { LLMError } from './errors';
import { createCompatLLM, type CausaLLM } from './nim';

export const METERLESS_DEFAULT_BASE = 'http://127.0.0.1:8088/v1';
export const METERLESS_MODES = ['meterless/auto', 'meterless/fast', 'meterless/deep', 'meterless/cheap', 'meterless/local', 'meterless/fusion'];

export function normalizeMeterlessBaseURL(raw: string | undefined): string {
  let u = (raw || METERLESS_DEFAULT_BASE).trim().replace(/\/+$/, '');
  while (/\/v1$/i.test(u)) u = u.replace(/\/v1$/i, '').replace(/\/+$/, '');
  return `${u}/v1`;
}

/** METERLESS_RUNTIME_TOKEN, else the file named by CAUSA_METERLESS_TOKEN_FILE (<stateDir>/proxy-token). Never logged. */
export function resolveMeterlessToken(env: NodeJS.ProcessEnv): string {
  let token = (env.METERLESS_RUNTIME_TOKEN ?? '').trim();
  if (!token && env.CAUSA_METERLESS_TOKEN_FILE) {
    try {
      token = readFileSync(env.CAUSA_METERLESS_TOKEN_FILE, 'utf8').trim();
    } catch (e) {
      throw new LLMError('config', `cannot read Meterless token file named by CAUSA_METERLESS_TOKEN_FILE: ${(e as NodeJS.ErrnoException).code ?? 'error'}`);
    }
  }
  if (token === 'rt-local') throw new LLMError('config', "METERLESS_RUNTIME_TOKEN is the 'rt-local' placeholder; use the real runtime token (Nightshift proxy-token)");
  if (!token) throw new LLMError('config', 'Meterless runtime token missing: set METERLESS_RUNTIME_TOKEN or CAUSA_METERLESS_TOKEN_FILE');
  return token;
}

export interface MeterlessOptions {
  baseURL?: string;
  token: string;
  model?: string;                 // default 'meterless/auto'
  embedModel?: string;            // only probed if set; the runtime contract documents no /v1/embeddings
  timeoutMs?: number;             // default 180s (model load can take minutes)
  maxRetries?: number;
  maxTokens?: number;
  sendThinkingKwargs?: boolean;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  onRetry?: (info: { kind: string; attempt: number; delayMs: number }) => void;
}

export function createMeterlessLLM(o: MeterlessOptions): CausaLLM {
  const baseURL = normalizeMeterlessBaseURL(o.baseURL);
  const headers = { 'meterless-app': 'causa' };
  const doFetch = o.fetch ?? fetch;
  return createCompatLLM({
    provider: 'meterless-nightshift',
    apiKey: o.token,
    baseURL,
    model: o.model || 'meterless/auto',
    embedModel: o.embedModel,
    timeoutMs: o.timeoutMs ?? 180_000,
    maxRetries: o.maxRetries,
    maxTokens: o.maxTokens,
    defaultHeaders: headers,
    chatHeaders: { 'meterless-scope': 'user' },
    sendThinkingKwargs: o.sendThinkingKwargs ?? true,
    routeHeaderPrefix: 'meterless-',
    fetch: o.fetch,
    sleep: o.sleep,
    onRetry: o.onRetry,
    canEmbed: async (embed) => {
      if (!o.embedModel) return false;
      const v = await embed(['probe']);
      return Array.isArray(v[0]) && v[0].length > 0;
    },
    health: async () => {
      try {
        const ctl = AbortSignal.timeout(10_000);
        const res = await doFetch(`${baseURL}/models`, { headers: { authorization: `Bearer ${o.token}`, ...headers }, signal: ctl });
        if (res.status === 401 || res.status === 403) return { ok: false, status: 'unauthorized', detail: `Meterless /v1/models answered ${res.status}: runtime token rejected` };
        if (res.status !== 200) return { ok: false, status: 'offline', detail: `Meterless /v1/models answered ${res.status}` };
        const body = (await res.json().catch(() => ({}))) as { data?: { id?: string }[] };
        const ids = (body.data ?? []).map((m) => String(m.id ?? '')).filter(Boolean);
        const meterless = ids.filter((i) => i.startsWith('meterless/'));
        if (meterless.length === 0) return { ok: false, status: 'offline', models: ids, detail: 'Meterless /v1/models returned no meterless/* routes' };
        return { ok: true, status: 'online', models: ids, detail: `Meterless Nightshift online at ${baseURL}; ${ids.length} model route(s)` };
      } catch (e) {
        return { ok: false, status: 'offline', detail: `Meterless unreachable at ${baseURL}: ${(e as Error).message}` };
      }
    },
  });
}
