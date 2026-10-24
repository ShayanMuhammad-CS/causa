# HackOS submission: copy-paste worksheet

This follows the official *Submission Form Preview*, field by field.
- **Who submits:** the team's primary contact (Shayan).
- **Deadline:** 27 Oct 2026 23:45 UTC.
- **Updates:** the submission can be edited until the deadline.
- **Roster lock:** the team roster locks when the first submission is created, so confirm the roster first.

## 1. Project name
Causa

## 2. Short description (one sentence)
An agent that helps financial and FP&A analysts explain why a company's performance diverged from its peers. It tests competing hypotheses with read-only SQL over SEC filings, industry classifications and macro data in Zetaris, and returns ranked, critic-verified causes, each linked to the exact query and rows behind it.

## 3. Description (short paragraph)
Analysts are constantly asked "why": why Target's growth lagged Walmart's, or whether Ford's slowdown is company-specific or sector-wide. The evidence is fragmented across filings, industry classifications and macro statistics. Today the answer ends up as a slide with no audit trail.

Causa works through the question in five steps:
1. It grounds the companies with the Meterless World Model.
2. It recalls prior verified findings from Meterless H-MEM.
3. It proposes competing company, sector and macro hypotheses with NVIDIA Nemotron, served through Meterless Nightshift.
4. It tests each hypothesis with read-only Lightning SQL through Zetaris. Each reasoning step's context stays bounded with Meterless Markovian.
5. It runs a critic pass that checks every number in every claim against the cited rows.

A signed Scout Intent execution contract bounds the whole run. Every claim links to its evidence, and every model call records which model handled it. Verified findings are remembered with provenance, so the work compounds instead of being redone.

## 4. Track
**The Agent That Can Explain Why** (Track 02). The README, deck and video all name this same track.

## 5. Team members
The roster on HackOS is: Shayan Muhammad (Leader), Umar Farooq (Member), Afshan Farooq.

The form asks for each member's full name, HackOS email, GitHub username, role and primary contact. Fill this in per member:

| Name | HackOS email | GitHub | Role | Primary contact |
|---|---|---|---|---|
| Shayan Muhammad | shayanmuhammad.cs@gmail.com | ShayanMuhammad-CS | Lead: product, agent architecture, integration | Yes |
| Umar Farooq | (ask Umar) | (ask Umar) | (fill in) | No |
| Afshan Farooq | (ask Afshan) | (ask Afshan) | Backend / ML (fill in) | No |

The rules say: "Include only people who contributed to the submitted work". Agree the prize split before you submit; the default is an equal split.

## 6. GitHub repository (public)
https://github.com/ShayanMuhammad-CS/causa

## 7. Demo video (1–4 min)
(link, added once it is recorded from a real run)

## 8. Slide deck
(link, added once it is made: 8 required sections)

## 9. Sponsor technology explanation

**Zetaris (data layer).**
- Every query the agent runs goes through Zetaris Lightning SQL over the REST API (`POST /api/v1.0/sql-editor/sqls/run`).
- The data is federated from REST sources onboarded with our scripts in `data/`:
  - SEC EDGAR XBRL company facts for 9 retail and auto peers;
  - the company_dns SIC hierarchy;
  - World Bank US macro indicators;
  - the `sic_edgar_usl` Unified Semantic Layer.
- The agent discovers the schema through the Zetaris catalog (`SHOW` / `DESCRIBE`) rather than hard-coding it.
- A read-only guard (single `SELECT` / `WITH` / `SHOW` / `DESCRIBE`, enforced `LIMIT`, 121 bypass tests) sits in front of every call.

**Meterless.**
- **Nightshift is the primary AI provider.** It uses the OpenAI-compatible Runtime: a Bearer token, the `meterless-app: causa` and `meterless-scope: user` headers, and `/v1/models` discovery. The model that handled each call is captured and shown in the UI's AI-provider log.
- **Four engines, each powering a feature, each with passing tests:**
  - **H-MEM:** memory of verified findings with provenance (`derivedFrom` = evidence ids plus Zetaris query ids), recall before investigating, a trust-ledger audit drawer and feedback. Tests: `server/test/memory.test.ts`, plus the upstream suite 10/10.
  - **World Model:** grounds companies to their real CIK, ticker and SIC from the Zetaris profile table. Unknown names are refused rather than invented. Metric observations keep their provenance, and the UI has an entity-trail drawer. Tests: `server/test/world.test.ts`, plus upstream 10/10.
  - **Markovian:** keeps each hypothesis loop's carried context bounded, so cost per step stays flat. Bounded-versus-naive token figures appear per step in the UI. Tests: `server/test/markov.test.ts`, plus upstream 10/10.
  - **Scout Intent:** intent detection; a risk check that blocks write, DDL and exfiltration requests before any model call; tool routing; and an HMAC-signed execution contract whose tool allow-list and budgets are enforced in code. Tests: `server/test/intent.test.ts`.

**NVIDIA.** Nemotron models act as planner, SQL investigator and critic, served through Meterless Nightshift. Every call's handling model id is recorded in the trace and shown in the UI.

**Cursor.** Not used. Causa was built with Claude Code; the organisers made Cursor optional on 22 Oct.

**What was unique.** The sponsor technologies form a verification chain, not a feature list:
- Scout Intent decides what the agent may do.
- World Model decides what exists.
- Zetaris is the only source of facts.
- Nemotron reasons.
- A critic, plus a deterministic number check, refuses any number that is not in the evidence rows.
- H-MEM remembers only what survived, with provenance.

## 10. Pre-existing components
- None of our own code; everything was built during the build window, from 24 Oct 2026.
- Vendored open source: the Meterless H-MEM, World Model and Markovian reference implementations (Apache-2.0, `server/vendor/`, see `NOTICE.md`).
- Data: SEC EDGAR, World Bank and SIC data, fetched on 24 Oct 2026 during the window.

## 11. Colab links
Not used.
