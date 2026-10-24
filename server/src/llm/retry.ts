import { LLMError, toLLMError } from './errors';

export interface RetryOptions {
  maxRetries: number;          // retries after the first attempt
  baseDelayMs?: number;        // default 500
  maxDelayMs?: number;         // default 8000
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  onRetry?: (err: LLMError, attempt: number, delayMs: number) => void;
}

export const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Exponential backoff with full jitter; honours Retry-After. Only retries retryable LLMErrors (429/5xx/timeout/network). */
export async function withRetry<T>(fn: () => Promise<T>, opts: RetryOptions): Promise<T> {
  const base = opts.baseDelayMs ?? 500;
  const cap = opts.maxDelayMs ?? 8000;
  const sleep = opts.sleep ?? realSleep;
  const random = opts.random ?? Math.random;
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (raw) {
      const err = toLLMError(raw);
      if (!err.retryable || attempt >= opts.maxRetries) throw err;
      const exp = Math.min(cap, base * 2 ** attempt);
      const jittered = Math.round(exp / 2 + random() * (exp / 2));
      const delay = Math.min(cap * 2, Math.max(jittered, err.retryAfterMs ?? 0));
      opts.onRetry?.(err, attempt + 1, delay);
      await sleep(delay);
    }
  }
}
