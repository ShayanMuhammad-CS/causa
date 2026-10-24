# markov/ : bounded per-step context (Meterless Markovian)

`createMarkovian(env, { compressor? })` wraps the vendored reference engine (`vendor/markovian/src`). Causa's agent loop
drives the steps, so the wrapper calls the engine services directly instead of `Markovian.run`. All token numbers are
`estimated` (chars/4, the engine's estimator, types.ts:30).

| Method | Engine service (file:line, vendor/markovian/src) |
|---|---|
| `begin(goal)` | resets the run; config validated by `resolveConfig` (configManager.ts) through `new Markovian` (index.ts:23) |
| `step(obs)` | `parseMarkers` markers.ts:30 / `cleanMarkers` :60, then `CarryoverService.next` carryover.ts:21 (cascade marker -> optional LLM compressor -> key-phrase heuristic -> tail truncation, always within `carryoverTokens`), then `buildPrompt` promptBuilder.ts:14 for the next call |
| `stats()` | per-step bounded vs naive tokens, plus `runEfficiency` configManager.ts:47 |
| `finish()` / `cumulative()` | `HistoryService.record` history.ts:26 / `cumulativeStats` history.ts:57 |

Bounded = framing + goal + carried state (flat, about 400 tokens in a 30-step test). Naive = same framing + every step replayed (grows linearly).

## How the agent should use it
```ts
const m = createMarkovian(process.env, { compressor });   // compressor optional: (prompt, system) => nemotron text
m.begin(question);
// after every tool call / result / critic note:
const { nextPrompt, tokensBounded, tokensNaive } = await m.step({ kind: 'tool_result', text: summary });
// send nextPrompt (goal + [CARRYOVER STATE]) as the context for the next LLM call, NOT the full transcript
// emit { step, tokensBounded, tokensNaive } in an SSE event; at the end m.stats() / m.finish()
```
Ask Nemotron to end each reply with `[STATE_CHECKPOINT]` + COMPLETED/REMAINING/DECISIONS/CONTEXT (or pass `state`): that is the
cheapest, highest-fidelity level. Pass only compact summaries (Evidence.summary), not raw rows, as `text`; raw rows live in Evidence.
Without a compressor or marker the heuristic/truncation levels keep only the tail, which loses early decisions.
