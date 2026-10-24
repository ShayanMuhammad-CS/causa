// Causa memory = Meterless H-MEM (reference implementation, vendored in server/vendor/hmem).
// Every method below calls a real H-MEM service; nothing is faked. The engine is local and
// keyless, so CAUSA_FAKE=1 uses the same engine on a temp dir instead of a fixture.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { HMEM } from '../../vendor/hmem/src/index';
import type { FeedbackKind, LedgerEntry, QueryResult, SleepPreview } from '../../vendor/hmem/src/index';
import type { MemoryHit, MemoryService } from '../types';

export interface HmemMemoryService extends MemoryService {
  /** Directory holding state.json + ledger.jsonl. */
  readonly dir: string;
  /** recall() plus the H-MEM retrieval trace (strategy, per-memory scores) and the reinjection block. */
  recallWithTrace(query: string, k?: number): Promise<{ hits: MemoryHit[]; trace: QueryResult['trace']; context: string }>;
  /** AGENTS.md section 8: preview-first sleep plan. Mutates nothing. */
  sleepPreview(): SleepPreview;
  /** Model-free mining pipeline (AGENTS.md section 4) for free text such as chat turns. */
  mine(text: string): Promise<string[]>;
}

const DEFAULT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '.hmem');
// The reference's default 0.35 threshold assumes its hash embedder is the whole signal; Causa recalls
// warm context for "related" questions, so we accept weaker matches and let ranking sort them.
const RECALL_THRESHOLD = 0.1;

export async function createMemoryService(env: NodeJS.ProcessEnv): Promise<HmemMemoryService> {
  const dir =
    env.CAUSA_HMEM_DIR ??
    (env.CAUSA_FAKE === '1' ? fs.mkdtempSync(path.join(os.tmpdir(), 'causa-hmem-')) : DEFAULT_DIR);
  const hmem = new HMEM({ persistDir: dir, actor: 'causa' });

  const toHit = (r: QueryResult['memories'][number]): MemoryHit => ({
    id: r.memory.id,
    text: r.memory.content,
    score: r.relevance,
    provenance: {
      source: r.memory.source,
      confidence: r.memory.confidence,
      ...(r.memory.derivedFrom ? { derivedFrom: r.memory.derivedFrom } : {}),
    },
  });

  const query = (q: string, k?: number) => hmem.retrieval.query(q, { topN: k ?? 5, threshold: RECALL_THRESHOLD });

  return {
    dir,

    async remember(text, provenance) {
      // MemoryStoreService.add: source/confidence are mandatory by construction, enrichment
      // (domain, entities, relatedTo) runs, and a 'create' entry is appended to the trust ledger.
      const rec = hmem.store.add({
        content: text,
        type: 'factual',
        layer: 'working',
        source: provenance.source,
        confidence: provenance.confidence,
        derivedFrom: provenance.derivedFrom,
        tags: ['causa:finding'],
        provenance: {
          origin: 'plan_completion',
          learnedAt: hmem.clock(),
          label: provenance.source,
          refs: provenance.derivedFrom,
        },
      });
      return rec.id;
    },

    async recall(q, k) {
      // MemoryRetrievalService.query: hybrid ranking (semantic/keyword/tag/domain/entity/layer/recency x confidence).
      return query(q, k).memories.map(toHit);
    },

    async recallWithTrace(q, k) {
      const res = query(q, k);
      return { hits: res.memories.map(toHit), trace: res.trace, context: res.context };
    },

    async feedback(id, verdict) {
      // MemoryRetrievalService.feedback: spec deltas helpful +0.05 / not_helpful -0.03, logged as 'feedback'.
      const kind: FeedbackKind = verdict === 'helpful' ? 'helpful' : 'not_helpful';
      hmem.retrieval.feedback(id, kind);
    },

    async audit(id) {
      // TrustLedgerService.history: the append-only record of one memory.
      return hmem.ledger.history(id).map((e) => ({
        at: new Date(e.timestamp).toISOString(),
        event: e.action,
        detail: describe(e),
      }));
    },

    sleepPreview() {
      return hmem.sleep.preview();
    },

    async mine(text) {
      const recs = await hmem.mine('chat_message', text);
      return recs.map((r) => r.id);
    },
  };
}

function describe(e: LedgerEntry): string {
  switch (e.action) {
    case 'create':
      return `created from ${e.newState?.source ?? 'unknown'} (confidence ${e.newState?.confidence}, layer ${e.newState?.layer})` +
        (e.newState?.derivedFrom?.length ? `, derived from ${e.newState.derivedFrom.join(', ')}` : '');
    case 'read':
      return `retrieved for query "${String(e.details?.query ?? '')}"`;
    case 'feedback': {
      const d = e.details as { kind?: string; delta?: number } | undefined;
      const sign = (d?.delta ?? 0) >= 0 ? '+' : '';
      return `${d?.kind} (${sign}${d?.delta}), confidence ${e.previousState?.confidence} -> ${e.newState?.confidence}`;
    }
    default:
      return e.details ? JSON.stringify(e.details) : e.action;
  }
}
