import type { ExecutionContract } from '../types';

export type BudgetKind = 'maxQueries' | 'maxLlmCalls' | 'maxSeconds';

export class BudgetExceededError extends Error {
  constructor(readonly kind: BudgetKind, detail: string) {
    super(`Budget exhausted (${kind}): ${detail}`);
    this.name = 'BudgetExceededError';
  }
}

export class ContractViolationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ContractViolationError';
  }
}

/**
 * Tool permission check against contract.allowedTools. Supports exact names and 'prefix.*' wildcards.
 * 'zetaris.describe' is a catalog read, so 'zetaris.catalog' also grants it.
 * 'memory.remember' is also granted by 'memory.write'.
 */
export function isToolAllowed(contract: ExecutionContract, tool: string): boolean {
  const allowed = contract.allowedTools;
  const has = (t: string) => allowed.includes(t) || allowed.includes(t.split('.')[0] + '.*') || allowed.includes('*');
  if (has(tool)) return true;
  if (tool === 'zetaris.describe') return has('zetaris.catalog');
  if (tool === 'memory.remember') return has('memory.write');
  return false;
}

/**
 * Enforces the signed execution contract's budget in code. Every chat call and every Zetaris query is
 * charged here BEFORE it is made; once a limit is hit, further charges throw BudgetExceededError.
 */
export class Budget {
  queries = 0;
  llmCalls = 0;
  readonly startedAt: number;
  readonly deadline: number;

  constructor(readonly contract: ExecutionContract, private readonly now: () => number = Date.now) {
    this.startedAt = now();
    this.deadline = this.startedAt + Math.max(1, contract.budget.maxSeconds) * 1000;
  }

  get maxQueries() { return this.contract.budget.maxQueries; }
  get maxLlmCalls() { return this.contract.budget.maxLlmCalls; }
  remainingQueries() { return Math.max(0, this.maxQueries - this.queries); }
  remainingLlmCalls() { return Math.max(0, this.maxLlmCalls - this.llmCalls); }
  remainingMs() { return Math.max(0, this.deadline - this.now()); }
  elapsedMs() { return this.now() - this.startedAt; }
  /** Soft deadline: stop starting new investigation work after this fraction of maxSeconds (leave time to synthesize). */
  pastSoftDeadline(fraction = 0.7) { return this.elapsedMs() >= fraction * this.contract.budget.maxSeconds * 1000; }

  requireTool(tool: string) {
    if (!isToolAllowed(this.contract, tool)) throw new ContractViolationError(`Tool '${tool}' is not allowed by contract ${this.contract.id}`);
  }

  chargeQuery() {
    this.checkTime();
    if (this.queries >= this.maxQueries) throw new BudgetExceededError('maxQueries', `${this.queries}/${this.maxQueries} queries used`);
    this.queries++;
  }

  chargeLlm() {
    this.checkTime();
    if (this.llmCalls >= this.maxLlmCalls) throw new BudgetExceededError('maxLlmCalls', `${this.llmCalls}/${this.maxLlmCalls} LLM calls used`);
    this.llmCalls++;
  }

  checkTime() {
    if (this.now() >= this.deadline) throw new BudgetExceededError('maxSeconds', `${this.contract.budget.maxSeconds}s elapsed`);
  }

  /** Race a promise against the hard deadline so a slow external call cannot overrun maxSeconds. */
  async withinDeadline<T>(p: Promise<T>): Promise<T> {
    const ms = this.remainingMs();
    if (ms <= 0) throw new BudgetExceededError('maxSeconds', `${this.contract.budget.maxSeconds}s elapsed`);
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new BudgetExceededError('maxSeconds', `${this.contract.budget.maxSeconds}s elapsed`)), ms);
    });
    try {
      return await Promise.race([p, timeout]);
    } finally {
      clearTimeout(timer);
    }
  }

  snapshot() {
    return {
      queries: `${this.queries}/${this.maxQueries}`,
      llmCalls: `${this.llmCalls}/${this.maxLlmCalls}`,
      seconds: `${(this.elapsedMs() / 1000).toFixed(1)}/${this.contract.budget.maxSeconds}`,
    };
  }
}
