// Intent registry + capability graph (Scout Intent AGENTS.md sections 3 and 7).
// "If an intent is not in the registry, it cannot be acted on" (s1): analyze() maps anything else to 'general'.
// Capabilities are abstract verbs; the graph resolves them to concrete tools (s7). Every Causa tool is local
// or a read-only Zetaris call, so the s7 selection rules (permission, availability, cost, local-first) collapse
// to a static mapping here.
export const REGISTRY_VERSION = 1;

export interface IntentDef {
  id: string;
  description: string;
  capabilities: string[];
  riskClass: 'low' | 'medium' | 'high'; // s3: policy floor; we only register read-only intents
  budget: { maxQueries: number; maxLlmCalls: number; maxSeconds: number };
  examples: string[]; // s3: examples are mandatory
}

export const INTENTS: IntentDef[] = [
  {
    id: 'explain_metric_change',
    description: 'Explain why a metric changed, lagged, slowed or diverged for one or more entities.',
    capabilities: ['catalog.read', 'sql.query', 'memory.recall', 'memory.remember'],
    riskClass: 'low',
    budget: { maxQueries: 8, maxLlmCalls: 12, maxSeconds: 240 },
    examples: ["Why did Target's revenue growth lag Walmart's after 2021?", 'Is Ford revenue slowdown company-specific or sector-wide?'],
  },
  {
    id: 'compare_entities',
    description: 'Compare entities on one or more metrics over a period.',
    capabilities: ['catalog.read', 'sql.query', 'memory.recall', 'memory.remember'],
    riskClass: 'low',
    budget: { maxQueries: 6, maxLlmCalls: 10, maxSeconds: 180 },
    examples: ['Compare Ford and GM revenue 2019-2023', 'Walmart versus Costco margins'],
  },
  {
    id: 'lookup',
    description: 'Look up a single fact or figure.',
    capabilities: ['catalog.read', 'sql.query', 'memory.recall'],
    riskClass: 'low',
    budget: { maxQueries: 3, maxLlmCalls: 5, maxSeconds: 90 },
    examples: ['What was Ford revenue in 2022?', 'Show the CPI for 2021'],
  },
  {
    // s4.4 Reject band fallback: safe intent, never routes to data tools.
    id: 'general',
    description: 'Safe fallback when nothing in the registry fits.',
    capabilities: ['memory.recall'],
    riskClass: 'low',
    budget: { maxQueries: 0, maxLlmCalls: 2, maxSeconds: 30 },
    examples: ['hello', 'what can you do?'],
  },
];

export const BLOCKED_BUDGET = { maxQueries: 0, maxLlmCalls: 0, maxSeconds: 0 };

export function findIntent(id: string): IntentDef | undefined {
  return INTENTS.find((i) => i.id === id);
}

// Capability graph (s7): abstract capability -> concrete tool.
const GRAPH: Record<string, string> = {
  'catalog.read': 'zetaris.catalog',
  'sql.query': 'zetaris.query',
  'memory.recall': 'memory.recall',
  'memory.remember': 'memory.remember',
};

export function routeTools(intentId: string): string[] {
  const def = findIntent(intentId);
  if (!def) return [];
  const tools = def.capabilities.map((c) => GRAPH[c]);
  if (tools.some((t) => !t)) throw new Error('capability with no resolvable tool: routing fails (s7)'); // never substitute silently
  return tools;
}
