import type { ZetarisClient } from '../types.js';
import { FakeZetarisClient } from './fake.js';
import { RestZetarisClient, restConfigFromEnv } from './rest.js';

/** Factory required by types.ts. CAUSA_FAKE=1 (or SAMPLE_MODE=true, the hackathon requirements fallback) returns the offline DuckDB-backed client; otherwise the REST client. */
export function createZetarisClient(env: NodeJS.ProcessEnv): ZetarisClient {
  if (env.CAUSA_FAKE === '1' || env.SAMPLE_MODE === 'true') return new FakeZetarisClient();
  return new RestZetarisClient(restConfigFromEnv(env));
}

export { FakeZetarisClient } from './fake.js';
export { RestZetarisClient, restConfigFromEnv } from './rest.js';
export { guardSql, extractSources } from './guard.js';
export * from './errors.js';
