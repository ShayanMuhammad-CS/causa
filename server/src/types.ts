// Shared contract between modules. Change only with the controller's agreement.

// ---------- Zetaris ----------
export interface QueryResult {
  queryId: string;          // UUID sent to Zetaris
  sql: string;
  columns: string[];
  rows: (string | number | null)[][]; // REST returns strings; numeric parsing done by client
  rowCount: number;
  elapsedMs: number;
  source: string[];         // lightning objects referenced, e.g. ["SEC_DATA.edgar.walmart_revenue_facts"]
}

export interface CatalogTable {
  fqName: string;           // fully qualified Lightning name
  description?: string;
  columns: { name: string; type: string; description?: string }[];
  origin: 'rest' | 'filestore' | 'usl' | 'schemastore' | 'other';
}

export interface ZetarisClient {
  health(): Promise<{ ok: boolean; detail: string }>;
  catalog(): Promise<CatalogTable[]>;
  /** Read-only only: implementations MUST reject anything that is not a single SELECT/SHOW/DESCRIBE/WITH. */
  query(sql: string, opts?: { limit?: number; timeoutMs?: number }): Promise<QueryResult>;
}

// ---------- LLM (Nemotron) ----------
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_call_id?: string;
  name?: string;
}
export interface ToolSpec { name: string; description: string; parameters: Record<string, unknown> }
export interface ToolCall { id: string; name: string; arguments: string }
export interface ChatResponse {
  content: string;
  reasoning?: string;       // Nemotron reasoning_content when thinking is enabled
  toolCalls: ToolCall[];
  model: string;
  usage?: { promptTokens: number; completionTokens: number };
}
export interface LLM {
  chat(messages: ChatMessage[], opts?: { tools?: ToolSpec[]; thinking?: boolean; temperature?: number; model?: string }): Promise<ChatResponse>;
  embed(texts: string[]): Promise<number[][]>;
}

// ---------- Meterless: Scout Intent ----------
export type RiskLevel = 'low' | 'medium' | 'high' | 'blocked';
export interface IntentRecord {
  intent: string;                 // e.g. 'explain_metric_change', 'compare_entities', 'lookup'
  entities: string[];
  metrics: string[];
  timeRange?: string;
  risk: RiskLevel;
  riskReasons: string[];
}
export interface ExecutionContract {
  id: string;
  intent: IntentRecord;
  allowedTools: string[];         // e.g. ['zetaris.catalog','zetaris.query','memory.recall']
  budget: { maxQueries: number; maxLlmCalls: number; maxSeconds: number };
  stopConditions: string[];
  signature: string;              // HMAC over the canonical contract JSON
  issuedAt: string;
}

export interface IntentEngine {
  analyze(question: string): Promise<IntentRecord>;
  issueContract(intent: IntentRecord): ExecutionContract;
  verifyContract(contract: ExecutionContract): boolean;
}

// ---------- Module factories (each module's index.ts exports exactly this) ----------
// src/zetaris/index.ts : export function createZetarisClient(env: NodeJS.ProcessEnv): ZetarisClient
// src/llm/index.ts     : export function createLLM(env: NodeJS.ProcessEnv): LLM
// src/memory/index.ts  : export async function createMemoryService(env: NodeJS.ProcessEnv): Promise<MemoryService>
// src/intent/index.ts  : export function createIntentEngine(deps: { llm: LLM; secret: string }): IntentEngine
// When env.CAUSA_FAKE === '1' each factory returns its offline/fixture implementation.

// ---------- Meterless: H-MEM ----------
export interface MemoryHit {
  id: string;
  text: string;
  score: number;
  provenance: { source: string; confidence: number; derivedFrom?: string[] };
}
export interface MemoryService {
  recall(query: string, k?: number): Promise<MemoryHit[]>;
  remember(text: string, provenance: { source: string; confidence: number; derivedFrom?: string[] }): Promise<string>;
  feedback(id: string, verdict: 'helpful' | 'unhelpful'): Promise<void>;
  audit(id: string): Promise<{ at: string; event: string; detail: string }[]>;
}

// ---------- Agent ----------
export interface Evidence {
  id: string;                     // 'ev-1'
  hypothesisId: string;
  purpose: string;                // why this query was run
  result: QueryResult;
  summary: string;                // short factual readout of the rows
}
export interface Hypothesis {
  id: string;                     // 'h-1'
  statement: string;
  status: 'open' | 'supported' | 'refuted' | 'inconclusive';
  evidenceIds: string[];
}
export interface Claim {
  text: string;
  confidence: 'high' | 'medium' | 'low';
  evidenceIds: string[];
  verified: boolean;              // critic confirmed numbers match evidence rows
  criticNote?: string;
}
export interface Investigation {
  id: string;
  question: string;
  contract: ExecutionContract;
  recalled: MemoryHit[];
  hypotheses: Hypothesis[];
  evidence: Evidence[];
  answer?: { summary: string; claims: Claim[]; models?: string[] };
  rememberedIds: string[];
  status: 'running' | 'done' | 'failed' | 'blocked';
  error?: string;
  startedAt: string;
  finishedAt?: string;
}

// Server -> web streaming events (SSE, event name = type)
export type InvestigationEvent =
  | { type: 'contract'; contract: ExecutionContract }
  | { type: 'recall'; hits: MemoryHit[] }
  | { type: 'hypothesis'; hypothesis: Hypothesis }
  | { type: 'query_started'; hypothesisId: string; sql: string; purpose: string }
  | { type: 'evidence'; evidence: Evidence }
  | { type: 'query_failed'; hypothesisId: string; sql: string; error: string; attempt: number }
  | { type: 'thinking'; text: string }
  // Which model handled each LLM call (NVIDIA award evidence: "show which model handled the request")
  | { type: 'model_call'; role: 'intent' | 'planner' | 'sql' | 'verdict' | 'synthesis' | 'critic'; model: string; provider: 'meterless-nightshift' | 'nvidia-direct' | 'sample'; ms: number }
  // Meterless World Model: entities grounded before investigating (unknown names are refused, not invented)
  | { type: 'world'; entities: { id: string; name: string; cik?: string; ticker?: string; sic?: string }[]; unknown: string[] }
  // Meterless Markovian: bounded carried context per reasoning step vs naive full history (engine's token estimates)
  | { type: 'markov'; hypothesisId: string; step: number; tokensBounded: number; tokensNaive: number }
  | { type: 'verdict'; hypothesis: Hypothesis }
  | { type: 'answer'; answer: NonNullable<Investigation['answer']> }
  | { type: 'remembered'; ids: string[] }
  | { type: 'done'; investigation: Investigation }
  | { type: 'error'; message: string };
