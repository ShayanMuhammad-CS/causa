// Investigations in memory + JSON persistence (one file per investigation under server/.data/investigations).
// The directory gets its own '.gitignore' ('*') so nothing under it can be committed by accident.
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Investigation, InvestigationEvent } from './types';
import { newInvestigation } from './agent/investigate';

export interface InvestigationSummary {
  id: string;
  question: string;
  status: Investigation['status'];
  startedAt: string;
  finishedAt?: string;
  claimCount: number;
  verifiedCount: number;
  evidenceCount: number;
}

type Listener = (e: InvestigationEvent) => void;
interface Entry {
  investigation: Investigation;
  events: InvestigationEvent[];
  listeners: Set<Listener>;
}

export function isTerminal(e: InvestigationEvent): boolean {
  return e.type === 'done' || e.type === 'error';
}

export class InvestigationStore {
  private readonly entries = new Map<string, Entry>();
  private readonly dir: string | null;
  private seq = 0;
  private writes = new Map<string, Promise<void>>();
  private timers = new Map<string, NodeJS.Timeout>();

  constructor(opts: { dir?: string | null } = {}) {
    this.dir = opts.dir ?? null;
  }

  /** Create a store backed by `dir` and load what is already there. */
  static async open(dir: string): Promise<InvestigationStore> {
    const s = new InvestigationStore({ dir });
    await s.load();
    return s;
  }

  private file(id: string) {
    return join(this.dir!, 'investigations', `${id}.json`);
  }

  async load(): Promise<void> {
    if (!this.dir) return;
    const sub = join(this.dir, 'investigations');
    await mkdir(sub, { recursive: true });
    const ignore = join(this.dir, '.gitignore');
    if (!existsSync(ignore)) await writeFile(ignore, '*\n', 'utf8');
    for (const name of await readdir(sub)) {
      if (!name.endsWith('.json')) continue;
      try {
        const raw = JSON.parse(await readFile(join(sub, name), 'utf8')) as { investigation: Investigation; events: InvestigationEvent[] };
        const entry: Entry = { investigation: raw.investigation, events: raw.events ?? [], listeners: new Set() };
        this.entries.set(raw.investigation.id, entry);
        const n = Number(raw.investigation.id.match(/(\d+)$/)?.[1]);
        if (Number.isFinite(n)) this.seq = Math.max(this.seq, n);
        if (entry.investigation.status === 'running') {
          // The process died mid-run: close it out so the UI never waits forever.
          this.append(entry.investigation.id, { type: 'error', message: 'Server restarted before this investigation finished.' });
        }
      } catch (e) {
        console.warn(`[store] skipping unreadable ${name}: ${(e as Error).message}`);
      }
    }
  }

  create(question: string): Investigation {
    const id = `inv-${++this.seq}`;
    const investigation = newInvestigation(id, question);
    this.entries.set(id, { investigation, events: [], listeners: new Set() });
    this.scheduleSave(id, 0);
    return investigation;
  }

  has(id: string) {
    return this.entries.has(id);
  }

  get(id: string): Investigation | undefined {
    return this.entries.get(id)?.investigation;
  }

  events(id: string): InvestigationEvent[] {
    return [...(this.entries.get(id)?.events ?? [])];
  }

  isFinished(id: string): boolean {
    const ev = this.entries.get(id)?.events;
    return !!ev && ev.length > 0 && isTerminal(ev[ev.length - 1]);
  }

  list(): InvestigationSummary[] {
    return [...this.entries.values()]
      .map(({ investigation: i }) => ({
        id: i.id,
        question: i.question,
        status: i.status,
        startedAt: i.startedAt,
        finishedAt: i.finishedAt,
        claimCount: i.answer?.claims.length ?? 0,
        verifiedCount: i.answer?.claims.filter((c) => c.verified).length ?? 0,
        evidenceCount: i.evidence.length,
      }))
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt) || Number(b.id.slice(4)) - Number(a.id.slice(4)));
  }

  /** Record an event, keep the investigation snapshot in sync, notify live subscribers, persist. */
  append(id: string, e: InvestigationEvent): void {
    const entry = this.entries.get(id);
    if (!entry) throw new Error(`unknown investigation ${id}`);
    if (entry.events.length > 0 && isTerminal(entry.events[entry.events.length - 1])) return; // closed
    entry.events.push(e);
    if (e.type === 'done') {
      entry.investigation = e.investigation;
    } else if (e.type === 'error') {
      entry.investigation.status = 'failed';
      entry.investigation.error ??= e.message;
      entry.investigation.finishedAt ??= new Date().toISOString();
    }
    for (const l of entry.listeners) {
      try {
        l(e);
      } catch (err) {
        console.error('[store] listener failed', err);
      }
    }
    this.scheduleSave(id, isTerminal(e) ? 0 : 250);
  }

  subscribe(id: string, l: Listener): () => void {
    const entry = this.entries.get(id);
    if (!entry) throw new Error(`unknown investigation ${id}`);
    entry.listeners.add(l);
    return () => entry.listeners.delete(l);
  }

  private scheduleSave(id: string, delayMs: number) {
    if (!this.dir) return;
    const existing = this.timers.get(id);
    if (existing) clearTimeout(existing);
    const run = () => {
      this.timers.delete(id);
      const prev = this.writes.get(id) ?? Promise.resolve();
      const next = prev.then(() => this.save(id)).catch((e) => console.error(`[store] save ${id} failed: ${(e as Error).message}`));
      this.writes.set(id, next);
    };
    if (delayMs === 0) run();
    else this.timers.set(id, setTimeout(run, delayMs));
  }

  private async save(id: string) {
    const entry = this.entries.get(id);
    if (!entry || !this.dir) return;
    await mkdir(join(this.dir, 'investigations'), { recursive: true });
    const target = this.file(id);
    const tmp = `${target}.${process.pid}.tmp`;
    await writeFile(tmp, JSON.stringify({ investigation: entry.investigation, events: entry.events }), 'utf8');
    await rename(tmp, target);
  }

  /** Write all pending changes now (tests, shutdown). */
  async flush(): Promise<void> {
    for (const [id, t] of [...this.timers]) {
      clearTimeout(t);
      this.timers.delete(id);
      this.scheduleSave(id, 0);
    }
    await Promise.all([...this.writes.values()]);
  }
}
