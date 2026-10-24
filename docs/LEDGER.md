# Causa build ledger

This is the controller's source of truth. A fact goes under **Verified** only with the command or source that proved it. Everything else stays **Unverified** until checked.

## Deadline
Submissions close **2026-10-27 23:45 UTC**. The event page "Key dates" were read on 2026-10-24.

## Verified

**Rules and scoring.** Source: the event page HTML, fetched 2026-10-24 14:19 UTC (`scratchpad/hk/strings.txt`).
- "Every submission must integrate Zetaris and Meterless."
- Scoring: Impact 30, Technical 20, Innovation 15, Demo 15, Product & UX 10, Sponsor tech 10.

**Submission requirements**, from the same source:
- a 1-4 minute demo video;
- a slide deck;
- a GitHub repo with a README;
- an explanation of the Zetaris and Meterless integration, Cursor use (if any) and where NVIDIA tech contributes.

**Meterless runtime provider contract.** Source: `Meterless/docs/agent-ready/add-meterless-provider.md`, fetched with WebFetch.
- Base URL `http://127.0.0.1:8088/v1`.
- Headers: a bearer token, plus `meterless-app` and `meterless-scope`.

**Meterless hackathon rubric.** Source: `docs/community/hackathon-guide.md`.
- It weights "Meterless engine usage" at 25%.
- The starter template uses the real H-MEM services.

**Zetaris local install.** Source: `vendor/zetaris-getting-started/docs/install/updated_zetaris_installation_guide.md`.
- Needs Docker with at least 6 GB.
- The bundle comes from Zetaris Cloud.
- Images come from the registry `zetarishackathon.azurecr.io`.

**Zetaris REST.** Source: `docs/connections/client-setup.md`.
- Base `/api/v1.0`.
- Bearer API key, numeric org ID, UUID `X-Request-ID`.

**Machine.** Checked with PowerShell CIM and `docker info`.
- Ryzen 5 7430U, 15.4 GB RAM, AMD integrated GPU only.
- Docker 29.8.2 with 8.0 GB and 12 CPUs available.
- Java is not installed, so we use REST and not JDBC.

**Repo hygiene.**
- `server/.env.local` is gitignored (checked with `git check-ignore`).
- GitHub CLI is logged in as ShayanMuhammad-CS (`gh auth status`).

**Official requirement**, quoted from the Submission Requirements in the HackOS Resources:
- "Meterless … must implement at least one Meterless Engine … in a working feature, and use Meterless Nightshift as its primary AI provider".
- The NVIDIA key goes in Nightshift Providers, not in the app.

**Nightshift 1.2.3 installed (2026-10-24).** The runtime is on 127.0.0.1:8088.
- `/healthz` returns 200.
- `/v1/models` returns 401 without a token and 69 ids with the token from `%LOCALAPPDATA%\ai.meterless.runtime\proxy-token`.
- The backend is Vulkan (integrated Radeon).
- The local fleet "Transfer Scout" (Llama 3.2 3B and others) was downloading at 20:25 local time.

**NVIDIA API key is blocked.** build.nvidia.com requires phone verification, and Pakistan is not in its country list (screenshot `tools/nv-otp.png`). The official route, per the Help NVIDIA channel, is a DM to Matt Cool. NVIDIA is NOT required; it only matters for the Nemotron award.

**OpenRouter serves Nemotron**, from the public `/api/v1/models`:
- `nvidia/nemotron-3.5-lightning(:free)`
- `nvidia/nemotron-3-ultra-550b-a55b(:free)`
- `nvidia/nemotron-3-super-120b-a12b(:free)`

All of them support tools. OpenRouter is a built-in Nightshift provider.

**Repo.** github.com/ShayanMuhammad-CS/causa, currently PRIVATE. The user must flip it to public; the safety classifier blocks Claude from creating public surfaces.

**Safety classifier blocks.** Claude may not create accounts in the user's name or publish anything. The user does those steps.

## Unverified (must be checked before we rely on it)
- **NVIDIA model IDs.** The subagent read `nvidia/nemotron-3-super-120b-a12b` and `nvidia/nemotron-3.5-embed-1b` from `/v1/models` through a summarizing tool. To confirm: a live call with a key.
- **Free NIM rate limits.** Measure them.
- **Meterless Nightshift on Windows.** The README says it needs a "dedicated GPU", and this PC has none. Assumed unavailable; we use the open engines instead.
- **Zetaris query endpoint shape and Lightning SQL dialect details.** Confirm against the live instance and its OpenAPI spec.
- **The Mars team's tasks, name and members.** Confirm by reading the board after the user signs in.

## CHECKPOINT: 2026-10-24 ~20:45 local (15:45 UTC)

### Done and verified
**Repo: github.com/ShayanMuhammad-CS/causa, PUBLIC.** An anonymous HTTP check returned 200.
- Last pushed commit: the deck commit after 2aa68d2.
- `tsc` is clean and 305/305 tests pass on the controller's own run.

**3 real sample investigations** are in `docs/samples` (Target/Walmart, Ford, Dollar General). Every claim is critic-verified. Numbers were spot-checked against public filings:
- WMT 611.3B → 648.1B
- TGT 109.12B
- F 158.06B
- TGT operating margin 3.53%

**HackOS submission is SUBMITTED** (2026-10-24, about 21:45 local). Status "Submitted" was verified after a page reload. Fields: Track 02, team MARS, description, video v1 uploaded to HackOS (2:13, sample mode, honestly labelled), the GitHub URL and the deck PDF. Previously it was a DRAFT, not submitted. "1/3 submissions created", and the roster is locked.
- Filled: Track 02 *The Agent That Can Explain Why*, description (1391 chars), the GitHub URL, the deck PDF URL.
- **Missing: the Video field (required).**

**Deck:** `docs/deck/Causa-deck.pptx` and `.pdf`, 11 slides. Slides 8 and 9 still show MOCK screenshots and must be replaced with real-run screenshots.

**Nightshift 1.2.3 is running.** Restarted with `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9334`, so the UI is drivable via `tools/ns-key.js`.
- No provider and no lane yet.
- The local fleet "Transfer Scout" (Llama 3.2 3B, ~2 GB) is downloading slowly: ~350 MB at 20:28.
- Background watcher: `bpem36o7g`.

**Zetaris local bundle**, in `B:\open-agent-hackathon\zetaris\zetaris-platform`:
- Registry `docker login` succeeded.
- `.env` admin password was replaced; it is in `zetaris/admin.pass.private`. The org is `mars`.
- Preflight passed with 1 warning (7 GB of memory available to Docker).
- `docker compose pull` + `up -d` were running in background task `byqryqwv9`, started 20:26.

### Next steps (in order)
1. **Video v1.** Convert `docs/video/raw.webm` to `docs/video/causa-demo-v1.mp4` with `ffmpeg -c:v libx264 -pix_fmt yuv420p -crf 23 -movflags +faststart`.
   - Check that ffprobe reports ≤ 4:00.
   - Look at ~8 frames: is the Recalled panel empty on Q1? Do the markov meter and the audit drawer show?
   - Then upload it to the HackOS draft (Video → Upload File) and press **Submit**, which the user authorised.
   - Delete `docs/video/raw*` before committing; commit `web/scripts/record-demo.cjs`.
2. **Zetaris.** Once `docker compose ps` is healthy, run `./verify.sh`.
   - Log in to the UI at localhost:3000 (admin@zetaris.com / admin.pass.private).
   - Create an API key and read the org ID; put them in `server/.env.local`.
   - Run `data/run-onboarding.ts --apply`. Then check that the agent's SQL works on the real Lightning dialect (column names, `SHOW` / `DESCRIBE` layouts are unverified).
3. **Nightshift.** When Llama 3.2 3B is installed, activate the lane, send a test chat through `:8088`, and run Causa live with `SAMPLE_MODE=false`.
4. **Nemotron.** Needs either the user signing in to OpenRouter (key into Nightshift → OpenRouter) or NVIDIA verification via a DM to Matt Cool (draft in chat).
5. **Video v2** with live Zetaris + Nightshift. Replace the deck screenshots with real ones. Do a final Opus review (security: SQL guard, secrets). Then update the submission. Deadline: 27 Oct 23:45 UTC.

### Known issues
- The analyst's sector-wide rule only compares growth with peers, so "Costco slowdown" is marked sector-wide even though Costco's growth rose.
- The Meterless `/v1/models` route list includes local models that are not installed.

## Status
| Track | Owner | State |
|---|---|---|
| Spec, types, scaffold | controller | done (commits f3fc00e, 7a31f34) |
| Zetaris data layer + onboarding | dev A (Sonnet) | in progress |
| Meterless H-MEM + Scout Intent | dev B (Sonnet) | in progress |
| Agent loop, Nemotron, API | dev C (Opus) | in progress |
| Web UI | dev D (Sonnet) | in progress |
| Zetaris instance | user registers, then controller installs | waiting on user |
| NVIDIA key | user | waiting on user |
| Board / team info | user sign-in, then script | waiting on user |
| Integration, live recording, Opus review | controller | next |
| README, deck, video script, submission | controller + user | after integration |

## Acceptance gates (none skipped)
1. `npx tsc --noEmit` and `npx vitest run` exit 0. Each is run on its own and its exit status checked (lesson G14).
2. A live end-to-end run against **real Zetaris and real Nemotron**. Its events are recorded and the numbers are spot-checked against SEC EDGAR by hand.
3. An Opus review of the full diff, with security focus on the read-only SQL guard and secret handling.
4. A fresh clone plus the README steps works on this machine.
5. The demo video shows only real runs. Mock data is never presented as real.
