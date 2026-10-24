// Causa context optimisation = Meterless Markovian engine (reference implementation, vendored in
// server/vendor/markovian). The investigation loop is driven by Causa's agent (not by Markovian's own
// orchestrator), so this wrapper calls the engine's services directly: marker protocol (parseMarkers),
// the compression cascade (CarryoverService.next), the continuation prompt (buildPrompt), the token
// estimator and the efficiency accounting (runEfficiency, HistoryService). Nothing is faked.
import {
  CarryoverService, HistoryService, Markovian, buildPrompt, cleanMarkers, estimateTokens, parseMarkers, runEfficiency,
} from '../../vendor/markovian/src/index';
import type { CascadeLevel } from '../../vendor/markovian/src/carryover';
import type { ChunkConfig, ChunkInfo, MarkovianRun } from '../../vendor/markovian/src/index';

export type { CascadeLevel, ChunkConfig, MarkovianRun };

export interface Observation {
  kind: 'tool_call' | 'tool_result' | 'note' | 'verdict';
  /** Raw text of this step: the tool call, its result rows, the model's note. */
  text: string;
  /** Optional extra reasoning note appended to the step text. */
  note?: string;
  /** Optional state block the LLM wrote itself (COMPLETED/REMAINING/DECISIONS/CONTEXT). Wins over compression (marker level). */
  state?: string;
}
export interface StepReport {
  step: number;
  /** The bounded state to carry into the next LLM call (<= config.carryoverTokens). */
  carriedState: string;
  level: CascadeLevel;
  tokensCarried: number;
  /** Estimated input tokens of the next call with Markovian: framing + goal + carried state. */
  tokensBounded: number;
  /** Estimated input tokens of the next call if the full history were replayed instead. */
  tokensNaive: number;
  /** Ready-to-send continuation prompt built by the engine (goal + [CARRYOVER STATE]). */
  nextPrompt: string;
}
export interface MarkovStats {
  goal: string;
  steps: number;
  carryoverBound: number;
  perStep: { step: number; tokensObservation: number; tokensCarried: number; tokensBounded: number; tokensNaive: number; level: CascadeLevel }[];
  totalBounded: number;
  totalNaive: number;
  savedTokens: number;
  efficiencyPercent: number;
  /** The engine's own accounting (section 6.3) over the observation chunks. */
  engine: ReturnType<typeof runEfficiency>;
  label: 'estimated';
}
export interface MarkovService {
  readonly config: ChunkConfig;
  begin(goal: string): void;
  step(obs: Observation): Promise<StepReport>;
  carriedState(): string;
  stats(): MarkovStats;
  /** Close the run: records it in the engine's history (cumulative stats). */
  finish(status?: MarkovianRun['status']): MarkovianRun;
  cumulative(): ReturnType<HistoryService['cumulativeStats']>;
}

export function createMarkovian(
  env: NodeJS.ProcessEnv,
  opts: { chunkConfig?: Partial<ChunkConfig>; compressor?: (prompt: string, systemPrompt: string) => Promise<string> } = {},
): MarkovService {
  // Causa's loop does at most ~30 tool steps per investigation; the engine default carryover (800 tokens) applies.
  const engine = new Markovian({
    chunkConfig: { maxChunks: 32, ...opts.chunkConfig },
    compressorFn: opts.compressor,
    historyDir: env.CAUSA_MARKOV_DIR,
  });
  const config = engine.config;
  const carry = new CarryoverService(opts.compressor);

  let goal = '';
  let carried = '';
  let started = 0;
  let chunks: ChunkInfo[] = [];
  let perStep: MarkovStats['perStep'] = [];
  let runSeq = 0;

  const promptFor = (step: number, carryover: string) =>
    buildPrompt({ mode: 'RESEARCH', goal, step, carryover, overlapText: '', attachments: [], config });

  const stats = (): MarkovStats => {
    const totalBounded = perStep.reduce((s, p) => s + p.tokensBounded, 0);
    const totalNaive = perStep.reduce((s, p) => s + p.tokensNaive, 0);
    return {
      goal, steps: perStep.length, carryoverBound: config.carryoverTokens, perStep: [...perStep],
      totalBounded, totalNaive, savedTokens: totalNaive - totalBounded,
      efficiencyPercent: totalNaive > 0 ? ((totalNaive - totalBounded) / totalNaive) * 100 : 0,
      engine: runEfficiency(chunks, config), label: 'estimated',
    };
  };

  return {
    config,

    begin(g) {
      goal = g;
      carried = '';
      started = Date.now();
      chunks = [];
      perStep = [];
    },

    async step(obs) {
      if (!goal) throw new Error('Markovian: call begin(goal) before step()');
      const raw = obs.note ? `${obs.text}\n${obs.note}` : obs.text;
      // Marker protocol: an LLM-written [STATE_CHECKPOINT] / <CARRYOVER> block in the text counts as the state too.
      const parsed = parseMarkers(raw);
      const content = cleanMarkers(raw);
      const step = chunks.length + 1;
      // Compression cascade: marker -> LLM compressor -> key-phrase heuristic -> tail truncation.
      const next = await carry.next({
        markerState: obs.state ?? parsed.state,
        previousCarryover: carried,
        chunkText: raw,
        config,
      });
      carried = next.carryover;
      chunks.push({ id: step, tokens: estimateTokens(content), carryover: carried, content });

      // Cost of the NEXT call. Bounded: continuation prompt with carried state. Naive: same framing, but the
      // whole step history replayed instead of the carried state.
      const nextPrompt = promptFor(step + 1, carried);
      const tokensBounded = estimateTokens(nextPrompt);
      const history = chunks.reduce((s, c) => s + c.tokens, 0);
      const tokensNaive = estimateTokens(promptFor(step + 1, '')) + history;
      const tokensCarried = estimateTokens(carried);
      perStep.push({ step, tokensObservation: estimateTokens(content), tokensCarried, tokensBounded, tokensNaive, level: next.level });
      return { step, carriedState: carried, level: next.level, tokensCarried, tokensBounded, tokensNaive, nextPrompt };
    },

    carriedState: () => carried,
    stats,

    finish(status = 'completed') {
      const eff = runEfficiency(chunks, config);
      const run: MarkovianRun = {
        id: `causa-run-${++runSeq}`, timestamp: started || Date.now(), prompt: goal.slice(0, 500), mode: 'RESEARCH',
        chunkConfig: { ...config }, chunks: [...chunks], totalTokensUsed: eff.totalTokensUsed, totalTokensSaved: eff.tokensSaved,
        efficiencyPercent: eff.efficiencyPercent, durationMs: Date.now() - (started || Date.now()), status, tokenLabel: 'estimated',
        output: chunks.map((c) => c.content).join('\n\n'),
      };
      engine.history.record(run);
      return run;
    },

    cumulative: () => engine.history.cumulativeStats(),
  };
}
