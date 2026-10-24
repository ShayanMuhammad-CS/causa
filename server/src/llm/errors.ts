export type LLMErrorKind =
  | 'rate_limit'
  | 'server'
  | 'timeout'
  | 'network'
  | 'auth'
  | 'bad_request'
  | 'invalid_json'
  | 'config'
  | 'unknown';

/** Typed error for every failure coming out of the LLM layer. */
export class LLMError extends Error {
  readonly kind: LLMErrorKind;
  readonly status?: number;
  readonly retryable: boolean;
  readonly retryAfterMs?: number;

  constructor(kind: LLMErrorKind, message: string, opts: { status?: number; retryAfterMs?: number; cause?: unknown } = {}) {
    super(message);
    this.name = 'LLMError';
    this.kind = kind;
    this.status = opts.status;
    this.retryAfterMs = opts.retryAfterMs;
    this.retryable = kind === 'rate_limit' || kind === 'server' || kind === 'timeout' || kind === 'network';
    if (opts.cause !== undefined) (this as { cause?: unknown }).cause = opts.cause;
  }
}

function parseRetryAfter(headers: unknown): number | undefined {
  try {
    const h = headers as { get?: (k: string) => string | null } | Record<string, string> | undefined;
    const raw = typeof (h as any)?.get === 'function' ? (h as any).get('retry-after') : (h as any)?.['retry-after'];
    if (!raw) return undefined;
    const secs = Number(raw);
    if (Number.isFinite(secs)) return Math.max(0, secs * 1000);
    const at = Date.parse(raw);
    return Number.isFinite(at) ? Math.max(0, at - Date.now()) : undefined;
  } catch {
    return undefined;
  }
}

/** Map anything thrown by the openai SDK / fetch into an LLMError. Never includes request headers (API key). */
export function toLLMError(err: unknown): LLMError {
  if (err instanceof LLMError) return err;
  const e = err as { status?: number; name?: string; message?: string; headers?: unknown; constructor?: { name?: string } };
  const ctor = e?.constructor?.name ?? e?.name ?? '';
  const msg = String(e?.message ?? err).slice(0, 500);
  if (ctor === 'APIConnectionTimeoutError' || /timed? ?out/i.test(msg)) {
    return new LLMError('timeout', `LLM request timed out: ${msg}`, { cause: err });
  }
  if (typeof e?.status === 'number') {
    const status = e.status;
    const retryAfterMs = parseRetryAfter(e.headers);
    if (status === 429) return new LLMError('rate_limit', `LLM rate limited (429): ${msg}`, { status, retryAfterMs, cause: err });
    if (status >= 500) return new LLMError('server', `LLM server error (${status}): ${msg}`, { status, retryAfterMs, cause: err });
    if (status === 401 || status === 403) return new LLMError('auth', `LLM auth failed (${status}): ${msg}`, { status, cause: err });
    if (status === 408) return new LLMError('timeout', `LLM request timeout (408): ${msg}`, { status, cause: err });
    return new LLMError('bad_request', `LLM rejected request (${status}): ${msg}`, { status, cause: err });
  }
  if (ctor === 'APIConnectionError' || /ECONN|ENOTFOUND|EAI_AGAIN|fetch failed|socket/i.test(msg)) {
    return new LLMError('network', `LLM network error: ${msg}`, { cause: err });
  }
  return new LLMError('unknown', `LLM error: ${msg}`, { cause: err });
}
