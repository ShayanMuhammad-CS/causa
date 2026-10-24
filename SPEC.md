# Causa: the analyst agent that shows its work

Open Agent Hackathon 2026 (GenAI Works). Primary track: **Track 02, The Agent That Can Explain Why**.
Also targeting **Best use of NVIDIA Nemotron**. Hard deadline: **2026-10-27 23:45 UTC**.

Rules that bind us:
- Every submission must integrate **Zetaris** and **Meterless**.
- NVIDIA tech is encouraged.

Scoring:

| Criterion | Points |
|---|---|
| Impact | 30 |
| Technical | 20 |
| Innovation | 15 |
| Demo | 15 |
| Product & UX | 10 |
| Sponsor tech | 10 |

## User and problem
Financial and FP&A analysts must answer "why" questions such as:
- "Why did Target's revenue growth lag Walmart's after 2021?"
- "Is Ford's revenue slowdown company-specific or sector-wide?"

The evidence is fragmented:
- SEC EDGAR XBRL filings
- industry classification (SIC hierarchy)
- macro statistics such as CPI
- internal spreadsheets

Today the analyst stitches these together by hand. The answer usually arrives as a slide with no audit trail, so it can't be checked and the work is redone next quarter.

## What Causa does (the demo loop)

**1. Ask.** The analyst asks a why-question in the web UI.

**2. Understand intent (Meterless Scout Intent).** The question becomes an intent record and passes a risk check:
- read-only actions are allowed;
- write or DDL actions are blocked;
- personal data is flagged.

Scout Intent then emits a signed **execution contract**: the allowed tools, the budget and the stop conditions.

**3. Recall (Meterless H-MEM).** Causa retrieves prior findings with their provenance, so a repeat or related question starts warm. It shows "Remembered from investigation #12, source: SQL q-34".

**4. Investigate (NVIDIA Nemotron + Zetaris).**
- Nemotron reads the Zetaris catalog and semantic layer (USL), proposes 2-4 competing hypotheses, and tests each with **read-only Lightning SQL** run through Zetaris across the federated sources.
- Every query and its result rows become an **Evidence** record.
- A failed query is retried with the error fed back, at most 2 times.

**5. Verify.** A second Nemotron pass acts as critic. It checks each claim against its cited evidence rows (numbers must match), then drops or downgrades any claim it cannot support.

**6. Explain.** The answer is a ranked list of causes. Each claim carries:
- a confidence level;
- citation chips that link to the evidence (SQL, rows, source lineage);
- an "evidence graph" showing claim → evidence → source.

**7. Remember.** Verified findings are written to H-MEM with provenance (source = evidence ids). The analyst can rate them helpful or unhelpful (H-MEM feedback). "Audit" opens the H-MEM trust-ledger history of any remembered fact.

## Sponsor technology map (judges score "meaningful use")

**Zetaris**
- Single governed query layer over the federated sources:
  - EDGAR REST: revenue facts for retail and auto peers;
  - company_dns SIC hierarchy;
  - a macro CPI REST source;
  - an uploaded internal CSV.
- The USL semantic layer `sic_edgar_usl`.
- The agent discovers schema through the catalog (`SHOW LIGHTNING DATABASES`, `DESCRIBE`) and never through hard-coded schemas.

**Meterless**
- H-MEM: memory, provenance, trust ledger, feedback, sleep.
- Scout Intent: intent detection, risk check, tool routing, signed execution contract.
- Optionally, Nightshift / Meterless provider routing when a hotspot is available.

**NVIDIA**
- Nemotron 3 Super (`nvidia/nemotron-3-super-120b-a12b`) for planning, SQL and the critic, through the NIM API at `https://integrate.api.nvidia.com/v1`.
- A Nemotron embedding model for schema and column retrieval.
- Optionally, the Nemotron safety guard on user input.

## Architecture
```
web (Vite + React + TS)  --SSE-->  server (Node 22 + TS + Hono)
                                     ├─ intent/   Scout Intent (Meterless spec impl)
                                     ├─ memory/   H-MEM wrapper (Meterless reference, vendored)
                                     ├─ agent/    investigation loop + critic
                                     ├─ llm/      Nemotron client (OpenAI-compatible) + embeddings
                                     └─ zetaris/  REST client, catalog, read-only SQL guard
data/  Lightning SQL onboarding scripts for our sources (run once against the instance)
```
The shared contract is in `server/src/types.ts`. Modules talk only through those types.

## Engineering rules
- TypeScript strict mode.
- Tests with vitest. Each module ships unit tests, and a test only counts if it was seen failing first.
- Secrets live only in `server/.env.local` (gitignored). They never appear in code, logs or commits.
- Every external call has a timeout, a retry and a typed error. The UI shows failures and never hides them.
- `CAUSA_FAKE=1` runs the server against recorded fixtures (`server/fixtures/`), so the demo and tests work without network access.
- Commit trailer (copy exactly): `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
