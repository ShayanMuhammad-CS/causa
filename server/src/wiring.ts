// Builds every module from env using the factories named in types.ts.
// CAUSA_FAKE=1 (or SAMPLE_MODE=true) makes each factory return its offline/fixture implementation.
// LLM: Meterless Nightshift is the primary provider; CAUSA_LLM_PROVIDER=nvidia is a labelled dev fallback.
import type { AgentConfig, AgentDeps } from './agent/investigate';
import { createLLM, isFakeMode, roleModelsFromEnv, type CausaLLM } from './llm/index';
import { createZetarisClient } from './zetaris/index';
import { createMemoryService } from './memory/index';
import { createIntentEngine } from './intent/index';

export async function buildDeps(rawEnv: NodeJS.ProcessEnv): Promise<AgentDeps & { llm: CausaLLM; agentConfig: Partial<AgentConfig> }> {
  const fake = isFakeMode(rawEnv);
  // Normalise the alias so every module (they check CAUSA_FAKE === '1') sees the same mode.
  const env: NodeJS.ProcessEnv = fake ? { ...rawEnv, CAUSA_FAKE: '1' } : rawEnv;
  const secret = env.CAUSA_CONTRACT_SECRET || (fake ? 'causa-fake-contract-secret' : '');
  if (!secret) throw new Error('CAUSA_CONTRACT_SECRET is required (set it in server/.env.local)');
  const llm = createLLM(env);
  const zetaris = createZetarisClient(env);
  const memory = await createMemoryService(env);
  const intent = createIntentEngine({ llm, secret });
  return { llm, zetaris, memory, intent, agentConfig: { models: roleModelsFromEnv(env) } };
}
