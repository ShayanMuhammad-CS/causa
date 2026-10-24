// Causa HTTP server (SPEC "HTTP API"). createApp() is dependency-injected for tests; main() wires real
// modules from env (wiring.ts is imported lazily so tests never load other modules' implementations).
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { streamSSE } from 'hono/streaming';
import { z } from 'zod';
import type { InvestigationEvent } from './types';
import { runInvestigation, type AgentConfig, type AgentDeps } from './agent/investigate';
import { InvestigationStore, isTerminal } from './store';

export interface AppOptions {
  store: InvestigationStore;
  deps: AgentDeps;
  agentConfig?: Partial<AgentConfig>;
  corsOrigins?: string[];
  maxConcurrent?: number;
  heartbeatMs?: number;
}

type Health = { ok: boolean; detail: string };

function timed<T>(p: Promise<T>, ms: number): Promise<T> {
  let t: NodeJS.Timeout | undefined;
  return Promise.race([p, new Promise<never>((_, rej) => (t = setTimeout(() => rej(new Error(`timed out after ${ms}ms`)), ms)))]).finally(() =>
    clearTimeout(t),
  );
}

async function probe(fn: () => Promise<Health>): Promise<Health> {
  try {
    return await timed(fn(), 10_000);
  } catch (e) {
    return { ok: false, detail: (e as Error).message };
  }
}

const QuestionBody = z.object({ question: z.string().trim().min(3).max(2000) });
const FeedbackBody = z.object({ verdict: z.enum(['helpful', 'unhelpful']) });

export function createApp(opts: AppOptions): Hono {
  const { store, deps } = opts;
  const app = new Hono();
  const running = new Set<string>();
  const heartbeatMs = opts.heartbeatMs ?? 15_000;

  app.use('/api/*', cors({ origin: opts.corsOrigins ?? ['http://localhost:5173'], allowMethods: ['GET', 'POST', 'OPTIONS'], allowHeaders: ['content-type', 'last-event-id'] }));

  app.onError((err, c) => {
    console.error('[http]', err);
    return c.json({ error: err.message }, 500);
  });

  app.post('/api/investigations', async (c) => {
    const body = QuestionBody.safeParse(await c.req.json().catch(() => undefined));
    if (!body.success) return c.json({ error: 'body must be { question: string (3-2000 chars) }' }, 400);
    if (running.size >= (opts.maxConcurrent ?? 3)) return c.json({ error: 'too many investigations running; try again shortly' }, 429);
    const inv = store.create(body.data.question);
    running.add(inv.id);
    void runInvestigation({ investigation: inv, deps, emit: (e) => store.append(inv.id, e), config: opts.agentConfig })
      .catch((e) => {
        if (!store.isFinished(inv.id)) store.append(inv.id, { type: 'error', message: (e as Error).message });
      })
      .finally(() => running.delete(inv.id));
    return c.json({ id: inv.id }, 201);
  });

  app.get('/api/investigations', (c) => c.json(store.list()));

  app.get('/api/investigations/:id', (c) => {
    const inv = store.get(c.req.param('id'));
    return inv ? c.json(inv) : c.json({ error: 'not found' }, 404);
  });

  app.get('/api/investigations/:id/events', (c) => {
    const id = c.req.param('id');
    if (!store.has(id)) return c.json({ error: 'not found' }, 404);
    // EventSource reconnects send Last-Event-ID: resume after it; a finished stream answers 204 so the browser stops retrying.
    const lastId = Number(c.req.header('last-event-id'));
    const skip = Number.isInteger(lastId) && lastId >= 0 ? lastId + 1 : 0;
    const past = store.events(id);
    if (skip > 0 && skip >= past.length && store.isFinished(id)) return c.body(null, 204);

    return streamSSE(c, async (stream) => {
      // Snapshot + subscribe in the same tick so no event can fall between replay and live.
      const queue: InvestigationEvent[] = past.slice(skip);
      let seq = skip;
      let wake: (() => void) | undefined;
      let closed = false;
      const unsubscribe = store.subscribe(id, (e) => {
        queue.push(e);
        wake?.();
      });
      stream.onAbort(() => {
        closed = true;
        unsubscribe();
        wake?.();
      });
      try {
        while (!closed) {
          while (queue.length > 0) {
            const e = queue.shift()!;
            await stream.writeSSE({ event: e.type, data: JSON.stringify(e), id: String(seq++) });
            if (isTerminal(e)) return;
          }
          const gotEvent = await new Promise<boolean>((r) => {
            const t = setTimeout(() => r(false), heartbeatMs);
            wake = () => {
              clearTimeout(t);
              r(true);
            };
          });
          wake = undefined;
          if (!gotEvent && !closed) await stream.write(': keep-alive\n\n');
        }
      } finally {
        unsubscribe();
      }
    });
  });

  app.get('/api/memory/:id/audit', async (c) => c.json(await deps.memory.audit(c.req.param('id'))));

  app.post('/api/memory/:id/feedback', async (c) => {
    const body = FeedbackBody.safeParse(await c.req.json().catch(() => undefined));
    if (!body.success) return c.json({ error: "body must be { verdict: 'helpful' | 'unhelpful' }" }, 400);
    await deps.memory.feedback(c.req.param('id'), body.data.verdict);
    return c.json({ ok: true });
  });

  app.get('/api/catalog', async (c) => {
    try {
      return c.json(await timed(deps.zetaris.catalog(), 30_000));
    } catch (e) {
      return c.json({ error: `catalog unavailable: ${(e as Error).message}` }, 502);
    }
  });

  app.get('/api/health', async (c) => {
    const llmHealth = (deps.llm as { health?: () => Promise<Health> }).health;
    const [zetaris, llm, memory] = await Promise.all([
      probe(() => deps.zetaris.health()),
      probe(async () => (llmHealth ? llmHealth.call(deps.llm) : { ok: true, detail: 'no health probe' })),
      probe(async () => {
        const hits = await deps.memory.recall('health check', 1);
        return { ok: true, detail: `recall ok (${hits.length} hit)` };
      }),
    ]);
    return c.json({ zetaris, llm, memory });
  });

  return app;
}

export async function main() {
  const serverDir = resolve(fileURLToPath(new URL('..', import.meta.url)));
  const dotenv = await import('dotenv');
  dotenv.config({ path: resolve(serverDir, '.env.local') });
  const { buildDeps } = await import('./wiring');
  const { serve } = await import('@hono/node-server');
  const deps = await buildDeps(process.env);
  const store = await InvestigationStore.open(resolve(serverDir, '.data'));
  const extraOrigins = (process.env.CAUSA_WEB_ORIGIN ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const app = createApp({ store, deps, agentConfig: deps.agentConfig, corsOrigins: ['http://localhost:5173', ...extraOrigins] });
  const port = Number(process.env.PORT) || 8700;
  const server = serve({ fetch: app.fetch, port }, () =>
    console.log(`[causa] listening on http://localhost:${port} (llm=${deps.llm.provider}, model=${deps.llm.modelId})`),
  );
  const shutdown = async () => {
    await store.flush();
    server.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

const entry = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : '';
if (entry === import.meta.url) {
  main().catch((e) => {
    console.error('[causa] failed to start:', e);
    process.exit(1);
  });
}
