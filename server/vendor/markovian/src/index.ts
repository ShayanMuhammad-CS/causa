// Markovian reference implementation facade. Deterministic, zero runtime
// dependencies. Implements AGENTS.md: config bounds and validation, marker
// protocol, compression cascade, mode prompts, orchestrator loop, progress,
// history with mandatory config snapshots, reflection, and the section 14
// accounting rules (chars/4 labeled "estimated"; [OVERLAP] implemented).

import { resolveConfig } from "./configManager.js";
import { CarryoverService } from "./carryover.js";
import { HistoryService } from "./history.js";
import { orchestrate } from "./orchestrator.js";
import { ProgressService } from "./progress.js";
import type { ChunkConfig, Generator, MarkovianOptions, MarkovianRun, ProgressState, RunOptions } from "./types.js";

export * from "./types.js";
export { resolveConfig, projectionCurve, runEfficiency, modelTotals, DOC_DEFAULTS } from "./configManager.js";
export { parseMarkers, cleanMarkers } from "./markers.js";
export { CarryoverService, canonicalBlock } from "./carryover.js";
export { buildPrompt, overlapSlice } from "./promptBuilder.js";
export { ProgressService } from "./progress.js";
export { HistoryService } from "./history.js";
export { resetRunSeq } from "./orchestrator.js";

export class Markovian {
  readonly config: ChunkConfig;
  readonly history: HistoryService;
  readonly progress: ProgressService;
  private carryoverService: CarryoverService;
  private clock: () => number;
  private defaultGenerator?: Generator;

  constructor(opts: MarkovianOptions = {}) {
    this.config = resolveConfig(opts.chunkConfig);
    this.clock = opts.clock ?? Date.now;
    this.history = new HistoryService(opts.historyDir);
    this.progress = new ProgressService(this.clock, this.config.maxChunks);
    this.carryoverService = new CarryoverService(opts.compressorFn);
    this.defaultGenerator = opts.generator;
  }

  onProgress(fn: (s: ProgressState) => void): () => void {
    return this.progress.subscribe(fn);
  }

  async run(options: RunOptions): Promise<MarkovianRun> {
    const run = await orchestrate({
      options,
      config: this.config,
      clock: this.clock,
      progress: this.progress,
      carryoverService: this.carryoverService,
      defaultGenerator: this.defaultGenerator,
    });
    this.history.record(run);
    return run;
  }
}
