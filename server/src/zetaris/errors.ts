// Typed errors for the Zetaris module. The UI shows these; they are never swallowed.
export type ZetarisErrorCode =
  | 'guard_rejected' | 'config' | 'http' | 'timeout' | 'network' | 'query_failed' | 'bad_response';

export class ZetarisError extends Error {
  readonly code: ZetarisErrorCode;
  readonly retryable: boolean;
  constructor(code: ZetarisErrorCode, message: string, opts: { retryable?: boolean; cause?: unknown } = {}) {
    super(message, opts.cause === undefined ? undefined : { cause: opts.cause });
    this.name = new.target.name;
    this.code = code;
    this.retryable = opts.retryable ?? false;
  }
}

/** The SQL was refused by the read-only guard before it left the process. */
export class ZetarisGuardError extends ZetarisError {
  readonly reason: string;
  constructor(reason: string) {
    super('guard_rejected', `Rejected by read-only guard: ${reason}`);
    this.reason = reason;
  }
}

export class ZetarisConfigError extends ZetarisError {
  constructor(message: string) { super('config', message); }
}

export class ZetarisHttpError extends ZetarisError {
  readonly status: number;
  readonly body: string;
  constructor(status: number, body: string) {
    super('http', `Zetaris HTTP ${status}: ${body.slice(0, 300)}`, { retryable: status >= 500 });
    this.status = status;
    this.body = body.slice(0, 2000);
  }
}

export class ZetarisTimeoutError extends ZetarisError {
  constructor(ms: number) { super('timeout', `Zetaris request timed out after ${ms} ms`, { retryable: false }); }
}

export class ZetarisNetworkError extends ZetarisError {
  constructor(message: string, cause?: unknown) { super('network', message, { retryable: true, cause }); }
}

/** SQL executed but the engine returned an error (bad SQL, missing table...). Fed back to the agent for retry. */
export class ZetarisQueryError extends ZetarisError {
  constructor(message: string, cause?: unknown) { super('query_failed', message, { cause }); }
}

export class ZetarisBadResponseError extends ZetarisError {
  constructor(message: string) { super('bad_response', message); }
}
