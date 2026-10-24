# Causa: the analyst agent that shows its work

**Open Agent Hackathon 2026 · Track 02: The Agent That Can Explain Why · Team MARS**

Causa answers *why* questions about company performance. Examples:
- "Why did Target's revenue growth lag Walmart's from FY2022 to FY2024?"
- "Is Ford's slowdown company-specific or sector-wide?"

It doesn't just guess. It works through these steps:
1. Ground the companies in the data.
2. Propose competing hypotheses: company-specific, sector-wide, or macro.
3. Test each hypothesis with **read-only SQL through Zetaris** across fragmented sources:
   - SEC EDGAR XBRL filings
   - the SIC industry hierarchy
   - World Bank macro data
4. Run a **critic pass** that checks every number in every claim against the rows it cites.
5. Return ranked causes. Each cause carries a confidence level and links to the exact query, rows and source behind it.

Verified findings are remembered with their provenance, so the next related question starts warm and can be audited.

**Who it is for:** equity, credit and FP&A analysts who must explain movements across filings, peers and macro data. Today they stitch this together by hand, and the result is a slide with no audit trail.

---

## How it works

```
 question ─▶ Scout Intent (Meterless)  intent · risk check · signed execution contract (tools, budget, stop rules)
          ─▶ World Model (Meterless)   resolve companies to real CIK/ticker/SIC; unknown names are refused, not invented
          ─▶ H-MEM recall (Meterless)  prior verified findings + provenance
          ─▶ Nemotron via Nightshift   2–4 competing hypotheses (company / sector / macro)
          ─▶ per hypothesis: Nemotron ⇄ Zetaris tools (catalog · describe · read-only SQL), retries with the error fed back
               └─ Markovian (Meterless) keeps each step's carried context bounded (flat cost per step)
          ─▶ verdicts ─▶ synthesis ─▶ CRITIC (second Nemotron pass + deterministic number check)
          ─▶ answer: ranked claims with evidence ids ─▶ H-MEM remember (derivedFrom = evidence + Zetaris query ids)
```

Everything streams live to the web UI over Server-Sent Events. The stream includes:
- the contract and its budget meters;
- grounded entities;
- the hypothesis board;
- an evidence card for every query (SQL, result rows, source lineage, failures and retries);
- the critic's verdicts and the evidence graph;
- the **AI provider log**, showing which model handled each call;
- the H-MEM audit trail.

| Layer | Technology | Where |
|---|---|---|
| Data | **Zetaris** Lightning SQL over REST (`POST /sql-editor/sqls/run`), federated REST sources + Unified Semantic Layer | `server/src/zetaris/`, `data/` |
| Power | **Meterless Nightshift**: the primary AI provider (OpenAI-compatible runtime) | `server/src/llm/meterless.ts` |
| Model | **NVIDIA Nemotron**, served through Nightshift | configured in Nightshift, model recorded per call |
| Memory | **Meterless H-MEM** (vendored reference engine) | `server/src/memory/`, `server/vendor/hmem/` |
| Grounding | **Meterless World Model** (vendored reference engine) | `server/src/world/`, `server/vendor/world-model/` |
| Context | **Meterless Markovian** (vendored reference engine) | `server/src/markov/`, `server/vendor/markovian/` |
| Intent and safety | **Meterless Scout Intent** (implemented from its AGENTS.md spec) | `server/src/intent/` |
| UI | Vite + React + TypeScript | `web/` |
| API | Node 22 + Hono, SSE | `server/src/index.ts` |

---

## Quick start

Sample mode needs no services and no keys.

```bash
git clone https://github.com/ShayanMuhammad-CS/causa.git
cd causa/server && npm install
SAMPLE_MODE=true npm start          # API on http://localhost:8700
# new terminal
cd causa/web && npm install && npm run dev   # UI on http://localhost:5173
```

In sample mode, Zetaris is replaced by an in-process DuckDB over **real** data fetched from SEC EDGAR and the World Bank, kept in `server/fixtures/zetaris/`. The table names are the same ones our onboarding creates in Zetaris, so the agent's SQL is identical in both modes.
- If Nightshift is reachable, the reasoning still runs on Nemotron.
- If not, a deterministic analyst runs real SQL instead.

**`?mock=1` in the UI replays a recorded stream for design work only. It is labelled "mock data".**

## Full setup (Zetaris + Nightshift + Nemotron)

**1. Zetaris.** Follow the official [getting-started guide](https://github.com/zetaris/getting-started): register at Zetaris Cloud, download the platform bundle, run `docker compose up -d`, then check that `SELECT 1` works.

**2. Onboard Causa's sources into Zetaris.** The runner is a dry run by default and prints every statement:
```bash
cd data && npx tsx run-onboarding.ts            # preview
npx tsx run-onboarding.ts --apply               # create sources, views, USL
```

**3. Meterless Nightshift.** Install it from [meterless.ai](https://meterless.ai). Then:
- Under **Setup → Providers**, add a Nemotron provider.
- Under **NIGHT → LANES**, pin a Nemotron lane.

The NVIDIA or OpenRouter key goes **only** into Nightshift, never into this repo.

**4. Configure Causa.** Copy `server/.env.example` to `server/.env.local` and set:
- `METERLESS_BASE_URL`, plus `METERLESS_RUNTIME_TOKEN` (from Nightshift → Console) or `CAUSA_METERLESS_TOKEN_FILE`;
- `METERLESS_MODEL`;
- `ZETARIS_REST_URL`, `ZETARIS_ORG_ID` and `ZETARIS_API_KEY` (from the Zetaris UI → Management).

**5. Run.** `cd server && npm start`, then `cd web && npm run dev`. `GET /api/health` reports the status of Zetaris, Nightshift (`/v1/models`) and memory.

## Usage

- **UI:** open http://localhost:5173, then ask a question or pick a suggested one.
- **API:** follow the event stream as the investigation runs.
  ```bash
  curl -X POST localhost:8700/api/investigations -H 'content-type: application/json' \
       -d '{"question":"Why did Target revenue growth lag Walmart from FY2022 to FY2024?"}'
  curl -N localhost:8700/api/investigations/inv-1/events      # live SSE trace
  curl localhost:8700/api/investigations/inv-1                # final Investigation JSON
  ```
- **Sample inputs and outputs:** see `docs/samples/`. Each holds a full Investigation JSON plus the complete event trace, including which model handled each call.

## Tests

```bash
cd server && npx vitest run      # agent loop, critic, SQL guard (121 bypass cases), Zetaris client, H-MEM, World Model, Markovian, Scout Intent, API/SSE
cd server && npx vitest run --root vendor/hmem         # upstream H-MEM conformance smoke tests
cd server && npx vitest run --root vendor/world-model  # upstream World Model tests
cd server && npx vitest run --root vendor/markovian    # upstream Markovian tests
```

## Safety
- **Read-only SQL guard.** It sits in front of every Zetaris call. It accepts a single `SELECT`, `WITH`, `SHOW` or `DESCRIBE` and enforces a `LIMIT`. It is tested against comment, semicolon, CTE-DML and unicode bypasses.
- **Scout Intent risk check.** It blocks write, DDL, exfiltration and credential requests before any model call. PII is redacted before it reaches the model.
- **Execution contracts.** They are HMAC-signed, and the agent enforces their tool allow-list and budgets in code.
- **No keys in the repo.** Secrets live in `server/.env.local`, which is gitignored. Model keys live in Nightshift.

## Data and licences
- **SEC EDGAR XBRL facts.** These are public filings. The SEC fair-access policy is respected: a declared User-Agent, at most 5 requests per second.
- **World Bank indicators.** CC BY 4.0.
- **SIC hierarchy.** From the company_dns service used by the Zetaris recipes.
- **Meterless engines.** H-MEM, World Model and Markovian are vendored from [Meterless/Meterless](https://github.com/Meterless/Meterless) under Apache-2.0. See `server/vendor/NOTICE.md`.
- **Code built with AI coding agents.** Built with Claude Code subagents during the build window (from 2026-10-24), reviewed and owned by the team.
- **Pre-existing components.** None of our own. Only open-source libraries and the Apache-2.0 Meterless reference engines listed above.

## Status (updated as we go)
See `docs/LEDGER.md` for what is verified and what is not, with evidence.
