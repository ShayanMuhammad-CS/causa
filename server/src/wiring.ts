// Builds every module from env using the factories named in types.ts.
// Data mode and model mode are separate:
//   data:  SAMPLE_MODE=true (or CAUSA_FAKE=1) => Zetaris = DuckDB over the real SEC EDGAR / World Bank fixtures;
//          otherwise the Zetaris REST client.
//   model: Meterless Nightshift is the primary provider (CAUSA_LLM_PROVIDER=nvidia is a labelled dev fallback).
//          In SAMPLE_MODE, Nightshift is still used when it is online AND answers a tiny probe chat (real Nemotron
//          reasoning on sample data); otherwise the deterministic sample analyst (src/agent/analyst.ts) runs.
//          CAUSA_SAMPLE_MODEL=analyst forces the analyst, =nightshift skips the probe.
// Meterless engines wired here: Scout Intent (contract), World Model (seeded from the Zetaris catalog), Markovian
// (one bounded run per hypothesis), H-MEM (memory).
import { randomBytes } from 'node:crypto';
import type { AgentConfig, AgentDeps } from './agent/investigate';
import { createSampleAnalystLLM } from './agent/analyst';
import { instrumentLLM } from './agent/modelcalls';
import { seedWorldFromCatalog } from './agent/world';
import { createLLM, createMeterlessLLM, isFakeMode, resolveMeterlessToken, roleModelsFromEnv, type CausaLLM } from './llm/index';
import { createZetarisClient } from './zetaris/index';
import { createMemoryService } from './memory/index';
import { createIntentEngine } from './intent/index';
import { createWorldModel, type WorldService } from './world/index';
import { createMarkovian } from './markov/index';

export type ModelMode = 'nightshift' | 'nvidia-direct' | 'sample-analyst';

export interface BuiltDeps extends AgentDeps {
  llm: CausaLLM;
  world: WorldService;
  agentConfig: Partial<AgentConfig>;
  dataMode: 'sample' | 'zetaris';
  modelMode: ModelMode;
  modelDetail: string;
}

const log = (msg: string) => console.log(`[causa] ${msg}`);

function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  let t: NodeJS.Timeout | undefined;
  return Promise.race([p, new Promise<never>((_, rej) => (t = setTimeout(() => rej(new Error(`${what} timed out after ${ms}ms`)), ms)))]).finally(() => clearTimeout(t));
}

/**
 * SAMPLE_MODE model choice. Nightshift counts as usable only if /v1/models is online AND a one-token chat succeeds
 * (Nightshift can be online with no provider connected; then every chat fails).
 */
async function chooseSampleModel(rawEnv: NodeJS.ProcessEnv): Promise<{ llm: CausaLLM; mode: ModelMode; detail: string }> {
  const forced = (rawEnv.CAUSA_SAMPLE_MODEL ?? '').toLowerCase();
  const analyst = (why: string) => ({ llm: createSampleAnalystLLM({ reason: why }), mode: 'sample-analyst' as const, detail: `deterministic sample analyst (${why})` });
  if (forced === 'analyst') return analyst('CAUSA_SAMPLE_MODEL=analyst');
  const liveEnv: NodeJS.ProcessEnv = { ...rawEnv, CAUSA_FAKE: undefined, SAMPLE_MODE: undefined };
  const provider = (liveEnv.CAUSA_LLM_PROVIDER || 'meterless').toLowerCase();
  if (provider !== 'meterless') return analyst(`CAUSA_LLM_PROVIDER=${provider} is not Nightshift`);
  let token: string;
  try {
    token = resolveMeterlessToken(liveEnv);
  } catch (e) {
    return analyst(`Nightshift not configured: ${(e as Error).message}`);
  }
  if (forced !== 'nightshift') {
    const probeMs = Number(liveEnv.CAUSA_PROBE_TIMEOUT_MS) || 20_000;
    const probe = createMeterlessLLM({
      baseURL: liveEnv.METERLESS_BASE_URL, token, model: liveEnv.METERLESS_MODEL || 'meterless/auto',
      timeoutMs: probeMs, maxRetries: 0, maxTokens: 16, sendThinkingKwargs: false,
    });
    try {
      const h = await withTimeout(probe.health(), 10_000, 'Nightshift /v1/models');
      if (h.status !== 'online') return analyst(`Nightshift ${h.status ?? 'offline'}: ${h.detail}`);
      const res = await withTimeout(probe.chat([{ role: 'user', content: 'Reply with the single word OK.' }], { thinking: false, temperature: 0 }), probeMs + 2_000, 'Nightshift probe chat');
      if (!res.content.trim() && !res.reasoning) return analyst('Nightshift answered the probe with an empty reply');
    } catch (e) {
      return analyst(`Nightshift online but no usable model: ${(e as Error).message.slice(0, 200)}`);
    }
  }
  const llm = createLLM(liveEnv) as CausaLLM;
  return { llm, mode: 'nightshift', detail: `Meterless Nightshift (${llm.modelId}) on sample data` };
}

export async function buildDeps(rawEnv: NodeJS.ProcessEnv): Promise<BuiltDeps> {
  const sample = isFakeMode(rawEnv);
  // Normalise the alias so every data module (they check CAUSA_FAKE === '1') sees the same mode.
  const env: NodeJS.ProcessEnv = sample ? { ...rawEnv, CAUSA_FAKE: '1' } : rawEnv;
  let secret = env.CAUSA_CONTRACT_SECRET || '';
  if (!secret) {
    secret = randomBytes(32).toString('hex');
    console.warn('[causa] CAUSA_CONTRACT_SECRET not set: using an ephemeral random contract secret (contracts will not verify across restarts).');
  }

  let llm: CausaLLM;
  let modelMode: ModelMode;
  let modelDetail: string;
  if (sample) {
    ({ llm, mode: modelMode, detail: modelDetail } = await chooseSampleModel(rawEnv));
  } else {
    llm = createLLM(env) as CausaLLM;
    modelMode = llm.provider.startsWith('nvidia') ? 'nvidia-direct' : 'nightshift';
    modelDetail = `${llm.provider} (${llm.modelId})`;
  }

  const zetaris = createZetarisClient(env);
  const memory = await createMemoryService(env);
  // Scout Intent: its LLM calls report model_call to the running investigation. The sample analyst is not a
  // classifier, so the deterministic Stage-1 rules decide the intent then.
  const intent = createIntentEngine({ llm: instrumentLLM(llm, 'intent'), secret, useLlm: modelMode !== 'sample-analyst' });
  const world = createWorldModel(env);

  // World Model seeding from the Zetaris catalog: memoised on success, retried by the next investigation on failure.
  let seeded: Promise<unknown> | undefined;
  const seedWorld = () =>
    (seeded ??= seedWorldFromCatalog(world, zetaris).then(
      (cs) => {
        log(`World Model seeded with ${cs.length} companies from the Zetaris company profile table`);
        return cs;
      },
      (e) => {
        seeded = undefined;
        throw e;
      },
    ));
  try {
    await seedWorld();
  } catch (e) {
    console.warn(`[causa] World Model seeding deferred (Zetaris catalog/query failed: ${(e as Error).message}); will retry on the first investigation.`);
  }

  return {
    llm, zetaris, memory, intent, world, seedWorld,
    markov: () => createMarkovian(env),
    agentConfig: { models: roleModelsFromEnv(env) },
    dataMode: sample ? 'sample' : 'zetaris',
    modelMode,
    modelDetail,
  };
}
