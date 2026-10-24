// Contract stage (Scout Intent AGENTS.md section 8.2, docs/execution-contract.md):
//   signature = HMAC_SHA256(secret, canonical_json(contract_without_signature))
// Integrity check, not cryptographic-grade defense (spec says so too).
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { ExecutionContract } from '../types';

/** Canonical JSON: object keys sorted recursively, no whitespace, undefined dropped. */
export function canonicalJson(value: unknown): string {
  if (value === undefined) return 'null';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map((v) => canonicalJson(v)).join(',') + ']';
  const o = value as Record<string, unknown>;
  return '{' + Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => JSON.stringify(k) + ':' + canonicalJson(o[k])).join(',') + '}';
}

export function sign(contract: Omit<ExecutionContract, 'signature'>, secret: string): string {
  return createHmac('sha256', secret).update(canonicalJson(contract)).digest('hex');
}

export function verify(contract: ExecutionContract, secret: string, opts?: { ttlMs?: number; now?: number }): boolean {
  if (!contract || typeof contract !== 'object' || typeof contract.signature !== 'string') return false;
  if (!/^[0-9a-f]{64}$/.test(contract.signature)) return false;
  const { signature, ...rest } = contract;
  let expected: string;
  try { expected = sign(rest, secret); } catch { return false; }
  if (!timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(expected, 'hex'))) return false;
  if (opts?.ttlMs !== undefined) {
    const issued = Date.parse(contract.issuedAt);
    if (Number.isNaN(issued) || (opts.now ?? Date.now()) - issued > opts.ttlMs) return false; // s8.2 expiry
  }
  return true;
}
