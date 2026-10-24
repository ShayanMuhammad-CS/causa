// Causa world state = Meterless World Model (reference implementation, vendored in server/vendor/world-model).
// Every method below calls a real World Model service (upsertEntity / relate / assertFact / views / events);
// nothing is faked. The engine is local and keyless, so CAUSA_FAKE=1 uses the same engine on a temp dir.
// Domain mapping: company, peer_group, sic_code, hypothesis, finding, evidence = entities; metrics = facts.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WorldModel, normalizeName, sha256Hex } from '../../vendor/world-model/src/index';
import type { Entity, Fact, Provenance, WorldEvent } from '../../vendor/world-model/src/index';

/** Where a state change came from. At least investigationId; evidence/query ids make it auditable. */
export interface ProvenanceRef {
  investigationId: string;
  evidenceId?: string;   // 'ev-3'
  queryId?: string;      // Zetaris QueryResult.queryId
  at?: string;           // ISO observation time, default now
}

export interface CompanyInput {
  cik: string;           // with or without leading zeros
  name: string;
  ticker?: string;
  sic?: string;
  sicDescription?: string;
  peerGroup?: string;
  aliases?: string[];
}
export interface CompanyRef {
  id: string;            // World Model entity id, e.g. 'company:sec-cik:0000104169'
  cik: string;           // zero padded to 10
  name: string;
  ticker?: string;
  sic?: string;
  peerGroup?: string;
}
export interface MetricFact {
  entityId: string;
  metric: string;        // 'Revenue'
  period: string;        // 'FY2023'
  value: number;
  unit?: string;
  confidence: number;
  provenance: ProvenanceRef;
  at: string;
  /** true when a later observation of the same metric+period replaced this one as the current value */
  superseded: boolean;
}
export interface HypothesisInput {
  id: string; statement: string; status: 'open' | 'supported' | 'refuted' | 'inconclusive';
  evidenceIds: string[]; companyIds?: string[];
}
export interface FindingInput {
  id: string; text: string; confidence: 'high' | 'medium' | 'low'; verified: boolean;
  evidenceIds: string[]; hypothesisIds?: string[];
}
export interface HistoryItem {
  seq: number;
  at: string;
  kind: WorldEvent['kind'];
  summary: string;
  provenance: ProvenanceRef;
}
export interface WorldSnapshot {
  at: string;
  counts: Record<string, number>;
  companies: CompanyRef[];
  events: number;
  /** sha256 of the canonical world state: equal fingerprints mean identical state */
  fingerprint: string;
}

export interface WorldService {
  /** Directory holding the engine's .world/ folder is `<dir>/.world`; this is the base dir. */
  readonly dir: string;
  observeCompany(c: CompanyInput, prov: ProvenanceRef): Promise<CompanyRef>;
  /** Pre-load the demo companies (Walmart, Target, Ford) so resolveEntity works offline. */
  seedKnownCompanies(): Promise<CompanyRef[]>;
  resolveEntity(nameOrTickerOrCik: string): CompanyRef | null;
  peers(entityId: string): CompanyRef[];
  observeMetric(entityId: string, metric: string, period: string, value: number, prov: ProvenanceRef, opts?: { unit?: string; confidence?: number }): Promise<MetricFact>;
  currentMetric(entityId: string, metric: string, period: string): MetricFact | null;
  factsFor(entityId: string): MetricFact[];
  observeHypothesis(investigationId: string, h: HypothesisInput, prov: ProvenanceRef): Promise<string>;
  observeFinding(investigationId: string, f: FindingInput, prov: ProvenanceRef): Promise<string>;
  /** Evidence ids cited by a hypothesis or finding entity id. */
  evidenceFor(entityId: string): string[];
  history(entityId: string): HistoryItem[];
  /** Entity record as of an ISO time (World Model snapshot view: replays the event log). */
  entityAt(entityId: string, at: string): Entity | undefined;
  snapshot(): WorldSnapshot;
}

const SERVER_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const NAMESPACE = 'causa';
const SYSTEM = 'causa';

const SEED: CompanyInput[] = [
  { cik: '104169', name: 'Walmart Inc.', ticker: 'WMT', sic: '5331', sicDescription: 'Retail-Variety Stores', peerGroup: 'US general retail' },
  { cik: '27419', name: 'Target Corporation', ticker: 'TGT', sic: '5331', sicDescription: 'Retail-Variety Stores', peerGroup: 'US general retail' },
  { cik: '37996', name: 'Ford Motor Company', ticker: 'F', sic: '3711', sicDescription: 'Motor Vehicles & Passenger Car Bodies', peerGroup: 'US auto manufacturers' },
];

const padCik = (cik: string) => cik.replace(/\D/g, '').padStart(10, '0');
const companyId = (cik: string) => `company:sec-cik:${padCik(cik)}`;
const slug = (s: string) => normalizeName(s).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const SUFFIX = /\b(incorporated|inc|corporation|corp|company|co|ltd|plc|holdings?)\b\.?/g;
const bare = (s: string) => normalizeName(s).replace(/[.,]/g, ' ').replace(SUFFIX, ' ').replace(/\s+/g, ' ').trim();

function toProvenance(p: ProvenanceRef): Provenance {
  return {
    kind: p.queryId ? 'sql' : p.evidenceId ? 'evidence' : 'agent',
    by: p.evidenceId ?? p.investigationId,
    at: p.at ?? new Date().toISOString(),
    url: p.queryId ? `zetaris:query/${p.queryId}` : p.evidenceId ? `causa:evidence/${p.evidenceId}` : undefined,
    runId: p.investigationId,
  };
}
function fromProvenance(s: { kind: string; by?: string; url?: string; runId?: string; at: string }): ProvenanceRef {
  const queryId = s.url?.startsWith('zetaris:query/') ? s.url.slice('zetaris:query/'.length) : undefined;
  return {
    investigationId: s.runId ?? '',
    ...(s.kind !== 'agent' && s.by ? { evidenceId: s.by } : {}),
    ...(queryId ? { queryId } : {}),
    at: s.at,
  };
}

export function createWorldModel(env: NodeJS.ProcessEnv): WorldService {
  const dir =
    env.CAUSA_WORLD_DIR ??
    (env.CAUSA_FAKE === '1' ? fs.mkdtempSync(path.join(os.tmpdir(), 'causa-world-')) : SERVER_DIR);
  // storage 'local' persists every event to <dir>/.world/causa.json (server/.world/ by default).
  const wm = new WorldModel({ namespace: NAMESPACE, storage: 'local', directory: dir, conflictPolicy: 'most-recent-wins' });
  const graph = () => wm.view('graph');

  const toCompany = (e: Entity): CompanyRef => {
    const a = e.attrs;
    return {
      id: e.id,
      cik: String(a.cik),
      name: e.name ?? String(a.cik),
      ...(a.ticker ? { ticker: String(a.ticker) } : {}),
      ...(a.sic ? { sic: String(a.sic) } : {}),
      ...(a.peerGroup ? { peerGroup: String(a.peerGroup) } : {}),
    };
  };
  const companies = () => graph().query({ type: 'company' });

  // The engine only folds supersession in memory (it is lost on reload), so "current" is recomputed
  // from the persisted facts: latest assertedAt wins, ties broken by event order.
  const seqOf = new Map<string, number>();
  const factList = (entityId: string): { fact: Fact; seq: number }[] => {
    for (const ev of wm.events()) if (ev.kind === 'assertFact') seqOf.set((ev.payload as Fact).id, ev.seq);
    return wm.view('facts').about(entityId).filter((f) => f.predicate.startsWith('metric:')).map((fact) => ({ fact, seq: seqOf.get(fact.id) ?? 0 }));
  };
  const toMetric = (fact: Fact, superseded: boolean): MetricFact => {
    const v = fact.value as { metric: string; period: string; value: number; unit?: string };
    return {
      entityId: fact.about, metric: v.metric, period: v.period, value: v.value, ...(v.unit ? { unit: v.unit } : {}),
      confidence: fact.confidence, provenance: fromProvenance(fact.source), at: fact.assertedAt, superseded,
    };
  };
  const newer = (a: { fact: Fact; seq: number }, b: { fact: Fact; seq: number }) =>
    a.fact.assertedAt === b.fact.assertedAt ? a.seq > b.seq : a.fact.assertedAt > b.fact.assertedAt;

  const ensureEvidence = async (investigationId: string, evidenceId: string, prov: ProvenanceRef) => {
    const e = await wm.upsertEntity({
      type: 'evidence', externalKey: { system: SYSTEM, id: `${investigationId}/${evidenceId}` }, name: evidenceId,
      attrs: { evidenceId, investigationId }, source: toProvenance({ ...prov, investigationId }),
    });
    return e.id;
  };
  const entityOrThrow = (id: string) => {
    const e = graph().entity(id);
    if (!e) throw new Error(`World Model: unknown entity ${id}`);
    return e;
  };

  const svc: WorldService = {
    dir,

    async observeCompany(c, prov) {
      const source = toProvenance(prov);
      const e = await wm.upsertEntity({
        type: 'company', externalKey: { system: 'sec-cik', id: padCik(c.cik) }, name: c.name,
        attrs: { cik: padCik(c.cik), ticker: c.ticker, sic: c.sic, peerGroup: c.peerGroup, aliases: c.aliases ?? [] },
        source,
      });
      if (c.sic) {
        const sic = await wm.upsertEntity({ type: 'sic_code', externalKey: { system: 'sec', id: c.sic }, name: c.sicDescription ?? c.sic, attrs: { sic: c.sic }, source });
        await wm.relate({ from: e.id, type: 'classified_as', to: sic.id, source });
      }
      if (c.peerGroup) {
        const pg = await wm.upsertEntity({ type: 'peer_group', externalKey: { system: SYSTEM, id: slug(c.peerGroup) }, name: c.peerGroup, attrs: {}, source });
        await wm.relate({ from: e.id, type: 'member_of', to: pg.id, source });
      }
      return toCompany(graph().entity(e.id)!);
    },

    async seedKnownCompanies() {
      const out: CompanyRef[] = [];
      for (const c of SEED) out.push(await svc.observeCompany(c, { investigationId: 'seed', at: '2026-01-01T00:00:00.000Z' }));
      return out;
    },

    resolveEntity(q) {
      const raw = q.trim();
      if (!raw) return null;
      const all = companies();
      if (/^\d+$/.test(raw)) {
        const hit = all.find((e) => e.attrs.cik === padCik(raw));
        return hit ? toCompany(hit) : null;
      }
      const lower = raw.toLowerCase();
      const byTicker = all.find((e) => typeof e.attrs.ticker === 'string' && e.attrs.ticker.toLowerCase() === lower);
      if (byTicker) return toCompany(byTicker);
      const nq = bare(raw);
      if (!nq) return null;
      const names = (e: Entity) => [...e.aliases, ...((e.attrs.aliases as string[] | undefined) ?? [])].map(bare);
      const exact = all.filter((e) => names(e).includes(nq));
      if (exact.length === 1) return toCompany(exact[0]);
      if (exact.length > 1) return null;
      const prefix = all.filter((e) => names(e).some((n) => n.startsWith(nq + ' ')));
      return prefix.length === 1 ? toCompany(prefix[0]) : null;
    },

    peers(entityId) {
      const pgs = graph().neighborsOf(entityId, { via: 'member_of' }).filter((e) => e.type === 'peer_group');
      const out = new Map<string, Entity>();
      for (const pg of pgs) for (const e of graph().incoming(pg.id, { via: 'member_of' })) if (e.id !== entityId && e.type === 'company') out.set(e.id, e);
      return [...out.values()].map(toCompany);
    },

    async observeMetric(entityId, metric, period, value, prov, opts = {}) {
      const e = entityOrThrow(entityId);
      const fact = await wm.assertFact({
        about: e.id, predicate: `metric:${metric}:${period}`,
        value: { metric, period, value, ...(opts.unit ? { unit: opts.unit } : {}) },
        confidence: opts.confidence ?? 0.9, source: toProvenance(prov),
      });
      const rows = factList(e.id).filter((r) => r.fact.predicate === fact.predicate);
      const cur = rows.reduce((x, y) => (newer(y, x) ? y : x));
      return toMetric(fact, cur.fact.id !== fact.id);
    },

    currentMetric(entityId, metric, period) {
      const rows = factList(entityId).filter((r) => r.fact.predicate === `metric:${metric}:${period}`);
      if (!rows.length) return null;
      const cur = rows.reduce((a, b) => (newer(b, a) ? b : a));
      return toMetric(cur.fact, false);
    },

    factsFor(entityId) {
      const rows = factList(entityId);
      const currentByPred = new Map<string, { fact: Fact; seq: number }>();
      for (const r of rows) {
        const c = currentByPred.get(r.fact.predicate);
        if (!c || newer(r, c)) currentByPred.set(r.fact.predicate, r);
      }
      return rows.map((r) => toMetric(r.fact, currentByPred.get(r.fact.predicate)!.fact.id !== r.fact.id));
    },

    async observeHypothesis(investigationId, h, prov) {
      const source = toProvenance({ ...prov, investigationId });
      const e = await wm.upsertEntity({
        type: 'hypothesis', externalKey: { system: SYSTEM, id: `${investigationId}/${h.id}` }, name: h.statement,
        attrs: { hypothesisId: h.id, investigationId, statement: h.statement, status: h.status }, source,
      });
      // Edges carry a per-target context so the engine's "same (from,type,context) supersedes" rule keeps them all.
      for (const ev of h.evidenceIds) {
        const evId = await ensureEvidence(investigationId, ev, prov);
        await wm.relate({ from: e.id, type: 'cites', to: evId, context: ev, source });
      }
      for (const cid of h.companyIds ?? []) await wm.relate({ from: e.id, type: 'concerns', to: entityOrThrow(cid).id, context: cid, source });
      return e.id;
    },

    async observeFinding(investigationId, f, prov) {
      const source = toProvenance({ ...prov, investigationId });
      const e = await wm.upsertEntity({
        type: 'finding', externalKey: { system: SYSTEM, id: `${investigationId}/${f.id}` }, name: f.text,
        attrs: { findingId: f.id, investigationId, text: f.text, confidence: f.confidence, verified: f.verified }, source,
      });
      for (const ev of f.evidenceIds) {
        const evId = await ensureEvidence(investigationId, ev, prov);
        await wm.relate({ from: e.id, type: 'derived_from', to: evId, context: ev, source });
      }
      for (const hid of f.hypothesisIds ?? []) {
        await wm.relate({ from: e.id, type: 'answers', to: `hypothesis:${SYSTEM}:${investigationId}/${hid}`, context: hid, source });
      }
      return e.id;
    },

    evidenceFor(entityId) {
      return graph().neighborsOf(entityId).filter((e) => e.type === 'evidence').map((e) => String(e.attrs.evidenceId));
    },

    history(entityId) {
      const target = graph().entity(entityId)?.id ?? entityId;
      const out: HistoryItem[] = [];
      for (const ev of wm.events()) {
        const p = ev.payload as unknown as Record<string, unknown>;
        let summary: string | undefined;
        let source: Parameters<typeof fromProvenance>[0] | undefined;
        if (ev.kind === 'upsertEntity' && p.id === target) {
          const e = p as unknown as Entity;
          summary = `${e.type} ${e.name ?? e.id} ${JSON.stringify(e.attrs)}`;
          source = e.source;
        } else if (ev.kind === 'assertFact' && p.about === target) {
          const f = p as unknown as Fact;
          const v = f.value as { metric: string; period: string; value: number };
          summary = `${v.metric} ${v.period} = ${v.value}`;
          source = f.source;
        } else if (ev.kind === 'relate' && (p.from === target || p.to === target)) {
          summary = `${String(p.from)} -[${String(p.type)}]-> ${String(p.to)}`;
          source = p.source as typeof source;
        }
        if (summary && source) out.push({ seq: ev.seq, at: ev.at, kind: ev.kind, summary, provenance: fromProvenance(source) });
      }
      return out;
    },

    entityAt(entityId, at) {
      return wm.view('snapshot').entityAt(entityId, at);
    },

    snapshot() {
      const counts: Record<string, number> = {};
      const state = wm.stateShape() as { entities: Entity[]; facts: Fact[] };
      for (const e of state.entities) counts[e.type] = (counts[e.type] ?? 0) + 1;
      counts.facts = state.facts.length;
      return {
        at: new Date().toISOString(),
        counts,
        companies: companies().map(toCompany),
        events: wm.events().length,
        fingerprint: sha256Hex(wm.stateShapeCanonical()),
      };
    },
  };
  return svc;
}
