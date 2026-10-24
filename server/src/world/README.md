# world/ : Causa state and provenance (Meterless World Model)

`createWorldModel(env)` wraps the vendored reference engine (`vendor/world-model/src/index.ts`).
State persists to `server/.world/causa.json` (add `server/.world/` to .gitignore); `CAUSA_FAKE=1` uses a temp dir;
`CAUSA_WORLD_DIR` overrides the base dir. Every write carries provenance (investigationId + evidenceId / Zetaris queryId),
because the engine rejects writes without it (index.ts:~83 normalizeProvenance).

| Method | Engine service (file:line, vendor/world-model/src) |
|---|---|
| `observeCompany` | `upsertEntity` index.ts:94 (type `company`, key `company:sec-cik:<CIK10>`), `relate` index.ts:173 to `sic_code` and `peer_group` entities |
| `seedKnownCompanies` | `observeCompany` for Walmart, Target, Ford (CIKs/SICs unverified against EDGAR, check before demo) |
| `resolveEntity` | graph view `query` index.ts:441 + `aliases`; null when unknown or ambiguous |
| `peers` | graph view `neighborsOf` index.ts:376 + `incoming` index.ts:392 over `member_of` edges |
| `observeMetric` | `assertFact` index.ts:198, predicate `metric:<Metric>:<Period>`, conflict policy most-recent-wins; throws on unknown entity |
| `currentMetric`, `factsFor` | facts view `about` index.ts:450 (supersession recomputed here: the engine loses it on reload) |
| `observeHypothesis`, `observeFinding` | `upsertEntity` + `relate` (`cites`, `concerns`, `derived_from`, `answers`); edge context = target id so edges do not supersede each other |
| `evidenceFor` | graph view `neighborsOf` |
| `history` | `events()` index.ts:350, filtered to one entity: the event trail with decoded provenance |
| `entityAt` | snapshot view `entityAt` index.ts:459 (replays the event log) |
| `snapshot` | `stateShapeCanonical()` index.ts:358 hashed into a fingerprint, plus counts |

## How the agent should use it
1. Before any SQL about a company: `const c = world.resolveEntity(name)`; if `null`, do not invent it, ask the catalog or tell the user.
2. After each Evidence is created: `observeMetric(c.id, 'Revenue', 'FY2023', value, { investigationId, evidenceId, queryId })`.
3. On each hypothesis status change: `observeHypothesis`; for each verified claim: `observeFinding`.
4. For the audit view: `history(id)` and `factsFor(id)` give who/what/which query for every number.
