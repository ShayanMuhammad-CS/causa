# Demo video script (target 3:00, hard limit 4:00)

The required coverage comes from the official *Demo Video Guide* and *Submission Requirements*:
- problem and users;
- solution;
- a real run;
- agent behaviour (critique and retry);
- key features;
- Zetaris querying;
- the feature each Meterless engine powers;
- **one real request passing through Nightshift and returning a result**;
- which Nemotron model handled it.

**Never show keys or tokens on screen.** Record at 1280×720 or 1920×1080, with clear audio.

| Time | Screen | Voice-over |
|---|---|---|
| 0:00–0:20 | Title card: Causa · Track 02 *The Agent That Can Explain Why* · Team MARS | "Analysts get asked *why* all day: why Target lagged Walmart, whether Ford's slowdown is company-specific or sector-wide. The evidence is scattered across SEC filings, industry codes and macro data, and the answer usually ends up as a slide nobody can audit. Causa is an agent that answers why, and shows its work." |
| 0:20–0:35 | Causa UI, ask screen. Type the Target vs Walmart question. | "I'll ask a real question." |
| 0:35–0:55 | Contract panel + grounded entities panel | "First, Meterless Scout Intent classifies the request, checks risk and issues a signed execution contract: which tools, how many queries and model calls. The Meterless World Model grounds Target and Walmart to their real SEC CIKs and SIC codes. If I name a company that isn't in the data, Causa says so instead of inventing it." |
| 0:55–1:10 | Recalled memories (H-MEM) | "H-MEM recalls verified findings from earlier investigations, each with its provenance." |
| 1:10–1:50 | Hypothesis board + evidence cards streaming; point at one SQL card and its rows; point at a failed query and its retry | "Nemotron proposes competing hypotheses: company-specific, sector-wide, macro. It tests each one with read-only SQL through Zetaris, across EDGAR filings, the SIC hierarchy and World Bank macro data. Here's a query Zetaris rejected; the error goes back to the model and it fixes the query. Markovian keeps each step's context bounded: this meter shows the carried context staying flat while a naive transcript would keep growing." |
| 1:50–2:20 | Answer panel: ranked claims, confidence, "verified by critic", citation chips, one critic downgrade; evidence graph | "A second Nemotron pass acts as a critic, and a deterministic check refuses any number that isn't in the cited rows. Here it downgraded a claim the evidence couldn't fully support. Every claim links to the exact query, rows and source." |
| 2:20–2:45 | AI provider panel (model per call) → switch to the Nightshift window showing the same request in its run details / receipt | "Every model call goes through Meterless Nightshift, our primary AI provider. Here is the request in Nightshift, handled by NVIDIA Nemotron, the same model id the app recorded." |
| 2:45–3:00 | Remembered section → Audit drawer (H-MEM trust ledger) → close | "Verified findings are written to H-MEM with provenance, so the next question starts warm and anyone can audit why the agent said what it said. Causa: answers you can check." |

Recording checklist:
- Run against live Zetaris and live Nightshift + Nemotron, not mock mode, so the "mock data" pill is absent.
- Close Notepad, `.env` files and terminals that show tokens.
- Keep a backup recording.
- Upload as public or unlisted; test the link in a private window.
