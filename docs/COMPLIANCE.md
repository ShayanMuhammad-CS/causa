# Causa: Hackathon Compliance Register

Project: Causa (Team MARS) for Open Agent Hackathon 2026, Track 2 "The Agent That Can Explain Why".
Compiled 2026-10-24 from the official docs in `B:\open-agent-hackathon\tools\out\docs\`.

Conventions
- Every text inside quote marks is copied verbatim from the named file. Anything marked **inference** is ours, not the docs'.
- Precedence: `Official_Rules.md` says it is "Draft status. The binding Official Rules are published on the event page at hackathon.genai.works." Other docs say "Where this document and the Official Rules on the event page disagree, the Official Rules apply." So: re-read the live Official Rules on hackathon.genai.works and the HackOS submission form before submitting.
- Not read: `Participant_Setup_Guide.md` is only a stub that links to a PDF (`https://hackathon-server.genai.works/api/v1/cdn/proxy/hackathon/7e1b7ca3995b4673b30a73555c87e71f.pdf`). Sponsor overview files still say "[TBC: ...]" for access steps. HackOS challenge pages (full Track 2 statement) are not in the extracted docs.
- Stale docs (conflict with Official Rules, ignore on conflict): `Mentor_Playbook.md` says "Registration closes | 22 October, 23:59 UTC", "Not mandatory" for partner tech, "There is no mandated provider", and uses old track names ("Autonomous Intelligence"). `Office_Hours_Guide.md` also says "Registration closes | 22 October, 23:59". Official Rules: "Registration closes 22 October 2026, 23:45 UTC".

---

## 1. HARD REQUIREMENTS CHECKLIST

### 1.1 Deadline, time zone, registration
- [ ] Submit on HackOS before the deadline. "The submission deadline is **27 October 2026, 23:45 UTC**. Late submissions are not evaluated." (`Official_Rules.md` s10). Also "Time zones do not extend it, and nothing can be added or fixed after it." (`Submission_Requirements.md` s1). "All times are **UTC** unless stated otherwise." (`Official_Rules.md` s2).
- [ ] Do not leave it to the last minute. "Submitted at 23:44 | No margin when something goes wrong, and something will" (`Disqualification_Checklist.md` s2). "You're submitting with hours to spare, not minutes" (`Disqualification_Checklist.md` s15).
- [ ] Updates allowed until the deadline. "Participants may update a submission at any time before the deadline." (`Official_Rules.md` s10.2).
- [ ] Every member registered. "Participants must register before registration closes on 22 October 2026, 23:45 UTC. Late registration is not accepted." (`Official_Rules.md` s3). "Someone who is not registered cannot be added as a team member, a contributor on the submission, or a prize recipient." (`Team_Formation_Rules.md` s3). **Registration is already closed (it is 24 Oct). All three members must already be registered.**
- [ ] Age 16+. "Participants must be at least 16 years old at the start of the build window." (`Official_Rules.md` s3).
- [ ] One account each. "One account per participant. Duplicate accounts disqualify the whole team." (`Official_Rules.md` s3).
- [ ] Accurate registration info. "False or misleading information may result in removal or disqualification of the participant's team." (`Official_Rules.md` s4).

### 1.2 Team requirements (do all members need to do anything?)
- [ ] Team on HackOS. "Every participant must create or join a team on HackOS, including solo builders." (`Official_Rules.md` s5). Team size: "Teams may have **1 to 5 members**." (3 is fine.)
- [ ] One team, one submission. "A participant may belong to **exactly one team** and appear on **only one submission**." (`Official_Rules.md` s5.2).
- [ ] Roster locks. "**Team composition locks when the first submission is created.**" (`Official_Rules.md` s5.4). "Confirm your roster before you create it" (`Submission_Requirements.md` s6). Creating a "draft" submission early locks the roster.
- [ ] Mechanics for adding a member (relevant only if someone is missing): "invite through HackOS, the person accepts, the contact confirms the updated roster, and the team grants repository access." (`Team_Formation_Rules.md` s7). That is the only "accept invite" step in the docs. No doc says every member must individually do anything at submission time. **inference:** each member must hold a registered HackOS account and be on the team roster before the first submission is created.
- [ ] Primary contact submits. "One submission per team. The team's primary contact submits on behalf of the team." (`Submission_Form_Preview.md`). "Each team should designate one primary contact responsible for coordinating the submission, confirming the roster and receiving official communications." (`Official_Rules.md` s5.3).
- [ ] Form member fields. Per member: "Full name", "HackOS account email", "GitHub username", "Role on the team", "Primary contact" (`Submission_Form_Preview.md` s3.3). "Make sure GitHub usernames match your repository contributors". "Include only people who contributed to the submitted work".
- [ ] Roster consistency. "The roster should match what's on HackOS, your repository contributors, your README credits and your demo credits." (`Team_Formation_Rules.md` s14). **inference:** commits made by AI agents will show agent or tool identities; make sure the three humans appear as contributors/credits.
- [ ] Prize split. "Agree the prize split before you submit; cash prizes are split equally unless the team submits a different split in writing" (`Submission_Form_Preview.md` s3.3).
- [ ] Credentials must not depend on one person. "The project must not depend on one person's local secrets or manual setup" (`Team_Formation_Rules.md` s16).

### 1.3 Track selection
- [ ] Exactly one track. "Each submission selects exactly **one** primary track, which determines the judging panel and the prizes it competes for." (`Official_Rules.md` s6).
- [ ] Track 2 definition: "Build agents that investigate complex questions across multiple data sources, connect findings, and produce evidence-backed answers or recommendations." (`Official_Rules.md` s6).
- [ ] Must map clearly. "Submissions must map clearly to the selected track." (`Official_Rules.md` s6). "Make sure your README, slide deck and demo all name the same track." (`Submission_Form_Preview.md` s3.2). Weak pattern: "No clear track fit | Low Impact score" (`Weak_Submission_Examples.md` s1).
- [ ] Track can be changed any time before the deadline from the team workspace.

### 1.4 The four required components
(`Official_Rules.md` s10.1; same text in `Submission_Requirements.md` s2)
- [ ] **Demo video**: "1–4 minutes, showing the main workflow, how the agent solves the selected challenge, its key features, and how Zetaris and Meterless are integrated".
- [ ] **Slide deck**: "The problem and target users, the solution, the agent workflow or architecture, the technical stack, how Zetaris and Meterless were used, what was unique about the use of the sponsor technologies, product visuals, and future enhancements". No file format is specified in any doc (inference: PDF or PPTX/link, check the HackOS form).
- [ ] **GitHub repository**: "A public repository with all source code and a README covering setup, usage and dependencies. If agents run in Google Colab, include the Colab links".
- [ ] **Sponsor technology explanation**: "How Zetaris was integrated; which Meterless Engine(s) were implemented, what each does and the test showing it works; how the app connects to Meterless Nightshift; where NVIDIA technology contributes; and what was unique about the use of the sponsor technologies".
- [ ] Form fields besides the four: "You will also confirm your project name, description, team members and selected track in the submission form, and declare any pre-existing components." (`Submission_Requirements.md` s2). Description guidance: "a description that says who the agent is for, what it does and what it produces" (`Submission_Form_Preview.md` s3.1).

### 1.5 Sponsor integration proof (all REQUIRED)
- [ ] **Zetaris**: "Required: every submission must use Zetaris as its data layer" (`Official_Rules.md` s8.1). Must be "load-bearing, not decorative" (`Disqualification_Checklist.md` s10). Test from the docs: "if I removed Zetaris, would the agent still work? If yes, it isn't integrated yet." (`Weak_Submission_Examples.md` s4).
- [ ] **Meterless Engine**: "every submission must implement at least one Meterless Engine (H-MEM, Markovian, World Model or Scout Intent) in a working feature" (`Official_Rules.md` s8.1). Compliance checklist: "At least one Meterless Engine works in a feature of the product, with a passing test" (`Official_Rules.md` s23). "A Meterless Engine installed but no feature uses it | Fails the Meterless requirement" (`Disqualification_Checklist.md` s2).
- [ ] **Meterless Nightshift as primary AI provider**: "and use Meterless Nightshift as its primary AI provider" (`Official_Rules.md` s8.1). "Your product's model calls go through Meterless Nightshift as its primary AI provider." (`AI_Usage_Policy.md` s3.1). Disqualification: "Does not integrate Zetaris, at least one Meterless Engine and Meterless Nightshift" (`Official_Rules.md` s16).
- [ ] **A real request must pass through Nightshift** and be shown in the video: "one real request passing through Nightshift and returning a result" (`Submission_Requirements.md` s3.1).
- [ ] **NVIDIA**: "Integrate wherever it contributes to the project, workflow or use case. NVIDIA models are connected through Meterless Nightshift" (`Official_Rules.md` s8.1). Key placement: "Your NVIDIA API key belongs in Nightshift's Providers tab, not in your project." (`Submission_Requirements.md` s3.3).
- [ ] Not enough to name them. "Mentioning a sponsor technology, copying a prompt or adding an unused dependency does not meet these requirements. The integration must work in the submitted project." (`Official_Rules.md` s8.1).
- [ ] Cursor is optional: "Optional: recommended development environment" (`Official_Rules.md` s8.1). "Any AI coding tool may be used for development." (`Official_Rules.md` s7.2).
- [ ] Keep Nightshift token and NVIDIA key out of the coding tool: "Keep your Nightshift token and NVIDIA key out of your coding tool's model settings, so your product's provider is never used for writing code." (`AI_Usage_Policy.md` s2).

### 1.6 Repository visibility, licence, README
- [ ] Public: "The repository must be **public** so judges can open it without requesting access." (`Submission_Requirements.md` s3.3). Test while logged out: "test the link in a private browser window while logged out" (`Weak_Submission_Examples.md` s10).
- [ ] No licence file is required by any rules doc. The only mention: "A licence file, if you want others to use it" (`Winner_Next_Steps.md` s5). Rules s12: "Participants keep all rights to what they build." and "By submitting, participants grant the organizer a licence to access, run and evaluate the submission, and to show the demo, screenshots and description in event coverage." **inference:** add a LICENSE file anyway (Apache-2.0 is the safe choice given the vendored code), but it is not mandated.
- [ ] README must cover: "**Setup:** how to install and run the project from a clean clone", "**Usage:** how to run the agent, with sample inputs", "**Dependencies:** what the project needs, including Zetaris and Meterless Nightshift", "**Colab links**, if your agents run in Google Colab" (`Submission_Requirements.md` s3.3).
- [ ] README disclosure list (`AI_Usage_Policy.md` s6, "Your README should disclose:"): "1. Models used through Nightshift, and what each does / 2. Agent frameworks used / 3. How Zetaris is integrated, which Meterless Engine(s) you implemented, how your app connects to Nightshift, and where NVIDIA contributes / 4. The AI coding tool you used / 5. External tools and libraries / 6. Data sources, and whether any data is sample or synthetic / 7. Any open-source code or templates materially adapted / 8. Known limitations / 9. Fallback or sample-mode behaviour".
- [ ] Third-party licences: "respect licences, keep copyright notices, attribute material code you copied or adapted, avoid private or proprietary code without permission, and make sure your team's own contribution is substantial." (`AI_Usage_Policy.md` s9).
- [ ] Recommended (not mandatory): `.env.example` with placeholders, `.gitignore` for `.env`, "A `SAMPLE_MODE=true` fallback", at least three sample inputs and outputs, logs/traces, the engine test pointed to from the README, demo video link in README (`Submission_Requirements.md` s3.3; `Demo_Video_Guide.md` s8).
- [ ] "Do not submit: A private repository / A local file path or a zip file instead of a repository / A repository that needs undocumented manual setup / A repository with committed keys or secrets" (`Submission_Form_Preview.md` s3.4).

### 1.7 Demo video format, length, hosting
- [ ] Length: "| **Minimum** | 1 minute |", "| **Maximum** | 4 minutes |", "| **Recommended** | 2 minutes 30 seconds to 3 minutes 30 seconds |". "A video over 4 minutes does not meet the requirement." (`Demo_Video_Guide.md` s1).
- [ ] Format: "| Format | MP4 preferred |", "| Resolution | 1080p preferred |", "| Audio | Required |", "| Captions | Optional, but helpful for judges in other time zones and languages |" (`Demo_Video_Guide.md` s7). Naming: `OAH2026-TeamName-Track-Demo.mp4`.
- [ ] Hosting: "Submit the video through the submission form on HackOS. If you share it as a link, test it in a private browser window first. The link must: Open without requesting permission / Play with audio / Stay live until judging is complete / Not need special software or access to a private workspace" (`Demo_Video_Guide.md` s7).
- [ ] "Do not submit: A local file path / A link only visible to your own account / A broken or expiring link / A video with no audio / A video over 4 minutes / A video that shows API keys or sensitive data" (`Demo_Video_Guide.md` s7).
- [ ] Backup plan: "Primary copy", "Backup copy: hosted somewhere different", "Local copy", "Team copy: at least one teammate has the final file", "README link: add the video link to your README" (`Demo_Video_Guide.md` s8).
- [ ] Dead link cost: "A dead or permission-locked link costs you the whole 15 points." (`Disqualification_Checklist.md` s12).

### 1.8 Pre-existing code, vendored libraries
- [ ] "Work committed before the build window opens is not eligible, except for clearly declared pre-existing components." (`Official_Rules.md` s8.2). Window opens "22 October, 00:00 UTC". Our build starts 24 Oct, so everything committed from 22 Oct 00:00 UTC onward is in-window.
- [ ] "Pre-existing open-source libraries are permitted." (`Official_Rules.md` s8.2). "Pre-existing open-source libraries do not need to be declared." (`Submission_Form_Preview.md` s3.8).
- [ ] "Pre-existing product code must be declared in the submission form." (`Official_Rules.md` s8.2). "Data prepared before the build window must be declared as a pre-existing component." (`Submission_Requirements.md` s5).
- [ ] Meterless engines: "Open-source libraries, the open-source Meterless Engines and public examples are fine. Comply with their licences and attribute where required." (`AI_Usage_Policy.md` s4.3).
- [ ] "Open source and third-party components. Participants must comply with all applicable licences and identify material dependencies." (`Official_Rules.md` s12).
- [ ] Undeclared pre-existing work is a disqualification trigger: "Includes undeclared pre-existing work" (`Official_Rules.md` s16).
- [ ] The "pre-existing" bucket in the form example: "Declare anything built before the build window opened on **22 October, 00:00 UTC**: product code, prepared data, models or prior prototypes." (`Submission_Form_Preview.md` s3.8).
- [ ] Strong README example ends with: "#### 11. Pre-existing components / None. All code was written during the build window." (`Strong_Submission_Examples.md` s6).

### 1.9 AI-generated code disclosure
- [ ] Allowed: "Generated code is allowed and expected; the team owns the result and is accountable for it." (`Official_Rules.md` s9).
- [ ] Disclose the tool in the README: "The AI coding tool you used" (`AI_Usage_Policy.md` s6). Recommended wording from the docs: "Built with [Cursor / other AI coding tool]. AI-assisted coding was used for scaffolding, debugging and documentation. / All generated code was reviewed and tested by the team." There is no separate AI-disclosure form field in the docs; "You do not need to log every prompt you typed into a coding assistant." (`AI_Usage_Policy.md` s6).
- [ ] Team must be able to explain it: "Judges may ask how something works, and "the AI wrote it" is not an answer." (`AI_Usage_Policy.md` s3.2). Disqualification trigger: "The team cannot explain how their own solution works". Checklist: "Every team member can explain how the system works" (`AI_Usage_Policy.md` s13).
- [ ] "Generated code must be reviewed, tested and understood by your team." (`AI_Usage_Policy.md` s3.2).
- [ ] Docs may be AI-assisted but must be accurate: "Documentation may be AI-assisted, but it must be accurate. Do not claim capabilities your system does not have." (`AI_Usage_Policy.md` s3.4).

### 1.10 Originality, integrity, data
- [ ] Not allowed: "Hardcoded outputs presented as agent results", "Fabricated logs or traces", "Plagiarised code, content, data or another team's work", "A README or slide deck that claims more than the system does", "A single agent or a fixed chain presented as something it is not" (`AI_Usage_Policy.md` s1).
- [ ] "Never hand-write a trace. A trace that doesn't match the code is an integrity problem, not a shortcut." (`Disqualification_Checklist.md` s9).
- [ ] Data permitted: "Publicly available datasets with appropriate licences", "Small static datasets committed to the repository", "Automated download scripts that need no login or manual steps", "Public APIs called at runtime", "Synthetic or simulated data, clearly identified" (`Official_Rules.md` s11.1).
- [ ] Data not permitted: "Confidential, proprietary or restricted data the participant is not authorised to use", "Personal data without authorisation and appropriate safeguards", "Committed API keys, passwords, tokens, certificates or credentials", "Datasets used in breach of their licence terms" (`Official_Rules.md` s11.2).
- [ ] Data docs: "Document every source in your README: where it came from, the licence, what subset you used, and how to regenerate it." (`Technical_Execution_Requirements.md` s7).
- [ ] "Data loading should be automated and documented." and "Data prepared before the build window must be declared as a pre-existing component." (`Official_Rules.md` s11.3).
- [ ] Secrets: "Committed API keys, passwords, tokens" are in the not-permitted list and in disqualification ("Commits API keys, tokens, credentials or secrets", `Official_Rules.md` s16). Includes the video and deck: "No secrets visible in screenshots, the demo video or the slide deck, including Nightshift's Console and Providers tab" (`AI_Usage_Policy.md` s4.5).
- [ ] Must be runnable: "Cannot be run or evaluated" is a disqualification trigger (`Official_Rules.md` s16). "A submission judges cannot run or open cannot be scored properly. Test a clean setup from scratch before you submit." (`Submission_Requirements.md` s7).
- [ ] Evidence of reasoning: "Shows no evidence of how the agent reached its output" is a disqualification trigger (`Official_Rules.md` s16). Minimum for traces: "At least two named agents doing distinct things", "Critique, validation, retry, escalation or branching" (`Disqualification_Checklist.md` s9).
- [ ] Minimum bar: "At least two clearly defined agents that genuinely interact" (`Weak_Submission_Examples.md` s22).
- [ ] Responsible AI: "Where relevant, submissions should include input validation, safe handling of user content, clearly stated limitations, human review for high-risk outputs, disclaimers for medical, legal, financial or safety-sensitive use cases, logging and traceability, and error handling." (`Official_Rules.md` s18).

### 1.11 Demo link / live URL / "test your link"
- [ ] No doc requires a hosted live URL or deployed app. The model is clone-and-run: "a judge who has never seen your project should be able to run it, watch it work, and see how it got there." (`Disqualification_Checklist.md`). Zetaris and Nightshift are expected to run on the builder's machine; "Judges may not have Zetaris, Nightshift or your keys. Ship a documented sample mode" (`AI_Usage_Policy.md` s5).
- [ ] Test-your-link rules found: video link in private window (above); repo link: "Make the repository public before you submit, then test the link in a private browser window while logged out." (`Weak_Submission_Examples.md` s10); "Video link needs permission | Set access so anyone with the link can view" (`Submission_Form_Preview.md` s6).
- [ ] Full clean-clone test is mandated as advice: "Test it the way they will." and the 10-step flow ending with "THE ONE PEOPLE SKIP: no credentials, Zetaris and Nightshift stopped" (`Disqualification_Checklist.md` s14).

---

## 2. JUDGING

Process: "each submission is reviewed by at least three judges." (`Official_Rules.md` s14.1). Judging opens 28 Oct; results 6 Nov 16:00 UTC. "Participants receive feedback on their submissions." Ties: "Ties are resolved on the **Impact** score, then on submission timestamp." (so submit time matters only as a tiebreak).

| Criterion | Pts | Official wording (`Official_Rules.md` s14.2) | What the other docs say judges want |
|---|---:|---|---|
| Impact | 30 | "Consistency with the challenge statements: how effectively the solution addresses a meaningful real-world problem for its intended users" | "The README, deck and demo name a real user, a real problem and the track it answers." (`Strong_Submission_Examples.md` s1). "Choose a real problem with an obvious user and a decision that improves" (`How_APPROACH_...md` s13). Weak: "Unsupported claims of value." |
| Technical | 20 | "How well the solution is built, including its technical implementation, reliability and architecture" | "Runs from a clean clone. Agents have distinct roles, real interdependence and traceable behaviour. Failures are handled." (`Strong_Submission_Examples.md`). Judges prioritise "Multiple agent interactions across a run", "Outputs refined through iteration", "Agents that challenge, validate, or improve each other's work", "Clear logs and traceability" (`Hackathon_Overview.md` s14). |
| Innovation | 15 | "How original or creative the approach to solving the problem is" | "A thoughtful agent pattern, not a familiar chain with new labels." (`Strong_Submission_Examples.md`). Strong example "unique" claim: "the Evaluator verifies claims against Zetaris before approving them". |
| Demo | 15 | "How clearly the demo shows the solution, its functionality, and the value it provides to its intended users" | "Show the agent working, not slides about it." (`Submission_Requirements.md` s3.1). "1–4 minutes. A real run, a collaboration moment in the logs, the output and why it matters." |
| Product & UX | 10 | "How intuitive, accessible, and easy to use the product is for its intended users" | "The output is something the intended user could act on." Judges avoid "UI polish without technical depth." "a polished interface over a weak system scores badly" (`FAQ_01a08f.md`). A programmatic entry point is expected: "a judge should also be able to run your agent without clicking through a screen." |
| Sponsor Tech | 10 | "How effectively the solution uses the sponsors' technology to address the problem and enhance the overall product" | "Zetaris and Meterless are load-bearing" (`Strong_Submission_Examples.md`). "A sponsor named in the README but absent from the code scores worse than not mentioning it, because it reads as padding." (`Disqualification_Checklist.md` s10). "Design Zetaris and Meterless into your architecture from the start rather than bolting them on at the end." (`AI_Usage_Policy.md`). |

Track-2 judging hints (`Mentor_Playbook.md` s13, stale track name but same description "investigate complex questions across multiple sources and produce evidence-backed answers"): "How are sources retrieved and validated?", "Which agent checks whether a claim is actually supported?", "How does the system avoid confident unsupported conclusions?", "Does it distinguish evidence from inference?", "What happens when the evidence is thin? Does it say so?", "Push toward a critic that can reject, not just review."
Track-2 example in `How_APPROACH_...md` s19: "Markovian keeps a multi-step investigation within bounded context", "Why it works: narrow scope, strong retrieval potential, easy to show critique, and every answer can be traced to its evidence."
Best-practice answer example in the strong docs: "Findings show correlation, not proven causation." plus "untested_factors" (`Strong_Submission_Examples.md` s6). **inference:** Causa's hypothesis-testing design maps directly to this.

What judges discount (`Hackathon_Overview.md` s14): "UI polish without technical depth.", "Single-agent systems presented as agent systems.", "Hardcoded demo paths.", "Overly broad concepts with weak implementation.", "Unsupported claims of value.", "Sponsor technology bolted on at the end with no real role in the build."

### Nemotron prize (NVIDIA DGX Spark, $4,699)
- "To compete for the NVIDIA award, a submission must use at least one NVIDIA Nemotron model through Meterless Nightshift in a working feature, and show which model handled the request." (`Official_Rules.md` s15.2).
- Award name: "Best use of NVIDIA Nemotron" (`Official_Rules.md` s15.2).
- Logging: "If you're competing for the NVIDIA award, log the model name for each request. `meterless/auto` can route to a non-NVIDIA model, so your logs should show where a Nemotron model handled the work." (`Technical_Execution_Requirements.md` s8).
- Misrepresentation: "Claiming a Nemotron model powered a feature when `meterless/auto` routed the request to a different model" is prohibited (`AI_Usage_Policy.md` s4.4).
- Strong-example usage: "We use a larger Nemotron model for the Analyst and Evaluator and a smaller one for query planning." (`Strong_Submission_Examples.md` s5).
- Example model IDs in docs: `nvidia/nemotron-3-super-120b-a12b`, `nvidia/nemotron-3.5-lightning-30b-a3b`.
- The doc does not say who selects the winner or how "best use" is scored beyond Sponsor Tech (**inference:** show model name in trace, video and sponsor explanation).
- Cash prize Track 2: 1st $1,600, 2nd $1,200, 3rd $900.

---

## 3. STRONG vs WEAK

### Strong patterns (quotes)
- Architecture: "The agents share state, critique each other, retry when evidence is weak, and block claims the data does not support." (`Strong_Submission_Examples.md` s2, ChurnWhy, same track as ours).
- "A strong system usually shows at least three of these:" Dynamic delegation, Critique loop, Retry logic, Shared state, Escalation, Role authority ("Evaluator can block the Writer until every claim is supported"), Non-linear flow (s3).
- Trace: "Agents interact more than once, in both directions / The Evaluator stops the work when a hypothesis is untested / The Planner revises its plan in response / A Zetaris query fails, retries and recovers / An unsupported claim is caught and removed / A final review adds an honest caveat / Every step carries a `trace_id`, confidence and retry count" (s4).
- Sponsor explanation: "Zetaris gives the agent one SQL access point", "What was unique. The Evaluator uses Zetaris directly to check claims: before any finding is approved, it runs its own query to confirm the numbers the Analyst cited."
- README sections used by the strong example: Problem, Agents table ("Can block or retry?"), What makes this an agent system, Tech stack, Setup, Usage, Sample mode, Failure handling, Data and licensing, Limitations, Pre-existing components.
- Judges should be able to say: "I can run it without manual setup.", "The logs prove real collaboration, not a linear chain.", "The team made thoughtful trade-offs and was honest about limits." (s16).
- Sample mode in the strong README: "`SAMPLE_MODE=true` runs the full agent loop on synthetic sample data in `data/`, with no live credentials. Agents still reason over the data; no final answers are stored."
- Output examples: "Output examples are real outputs saved after successful runs, never returned at runtime."

### Strong vs weak table (`Strong_Submission_Examples.md` s14)
- Weak "Zetaris named in the README only" vs Strong "Zetaris is the agent's access point to the data".
- Weak "Logs say "Agent started" and "Agent finished"" vs Strong "Logs show decisions, targets, confidence, retries and status".
- Weak "Demo shows only UI screens" vs Strong "Demo shows a real run, the trace and the output".
- Weak "Hardcoded sample answers" vs Strong "Real logic, with sample mode for inputs only".

### Weak-submission mistakes we must avoid (`Weak_Submission_Examples.md` s1 and s21 "Do not submit if any of these are true")
1. "Zetaris or Meterless missing | Fails a requirement".
2. "Sponsor technology bolted on | Low Sponsor Tech score" (e.g. "the code calls Zetaris once to run `SELECT 1`").
3. "Linear `A → B → C` pipeline | Low Technical and Innovation scores".
4. "Agents that are prompt wrappers".
5. "Single agent presented as many | Low Technical score, integrity question" (one system prompt "You are a planner, researcher, critic, evaluator and writer.").
6. "Hardcoded outputs | Disqualification risk" including red flags `if input_id == "example_1": return example_1_output` and a fake `run_sql` that "pretends to call Zetaris".
7. "Missing or unusable logs".
8. "Repository not public".
9. "Broken setup or manual steps".
10. "UI only, no programmatic path".
11. "API keys committed | Disqualification risk".
12. "Missing slide deck or over-length demo".
13. "Undeclared pre-existing work | Disqualification risk".
14. "No clear track fit | Low Impact score".
15. "Too Much Data, Too Slow" (full dataset downloads at runtime).
16. "No Failure Handling" (no timeout/retry/fallback).
17. Weak demo: "Slides with no working run", "Zetaris and Meterless mentioned but never shown", "No final output" (`Demo_Video_Guide.md` s4).
18. README overclaims: "README overclaims | Costs credibility across every criterion" (`Disqualification_Checklist.md` s2).
19. Weak use-case statements are "too broad" (e.g. "We will automate investment decisions."). Scope formula: "One user + one decision + one data slice + one strong output + clear agent behaviour." (`How_APPROACH_...md` s8).

---

## 4. DEMO VIDEO

Required content (`Submission_Requirements.md` s3.1): "The problem and who it is for / The main workflow, run live or recorded from a real run / How the agent solves the selected challenge / Its key features / How Zetaris and Meterless are integrated: your agent querying Zetaris, the feature your Meterless Engine powers, and one real request passing through Nightshift and returning a result".
Avoid: "Going over 4 minutes / Showing API keys, tokens, credentials or personal data on screen / A demo path that only works once or is hardcoded".

Timing (`Demo_Video_Guide.md` s3 recommended structure):
| Time | Segment |
|---|---|
| 0:00–0:20 | Problem: "Include your track, the user and the pain point." |
| 0:20–0:45 | Solution: "what goes in, what processes it, what comes out, and whether the data is real, public or synthetic." |
| 0:45–1:25 | Agents and Collaboration: "This is one of the most important segments." Show names/roles, feedback loops, validate/challenge, retries/branching/shared memory. |
| 1:25–2:15 | Live Run: "If a run takes time, you may cut the wait, but the input and output must be real". |
| 2:15–2:45 | Sponsor Technology: "Show Zetaris and Meterless doing real work, not just their logos." Show trace lines for Zetaris queries, returned data, model calls through Meterless, "Where NVIDIA technology contributes". |
| 2:45–3:30 | Output and Impact: final output, "At least one trace snippet showing collaboration", "Confidence, evidence or limitations". |

"Must show or clearly mention": "The track, the problem and the target user / At least two agents with clear roles / Real collaboration between agents / A live or recorded run on real or synthetic data / How Zetaris and Meterless are integrated / The final output / Why the output is useful".
Strong signals: "A failure, retry, critique or validation loop". Mistake line: "Weak: "We have five agents..." Strong: "The Critic rejected the Analyst's pricing claim because no pricing data was retrieved..."".
Secrets: "Clear terminal history that contains secrets / Close or hide `.env` / Never open API key pages for any service / Never paste keys into a visible terminal". Check "frame by frame around any terminal, and around Nightshift's Console and Providers tab." (`Disqualification_Checklist.md` s11).
Tech settings: "Resolution 1080p if possible", "Aspect ratio 16:9", "Audio: Clear narration", "Terminal font: Increase the size before recording".
Closing screen flow (`Demo_Video_Guide.md` s5): README header or title slide, architecture diagram, terminal/UI run, trace, final output, closing summary.
**inference:** the Causa video must also show the Nemotron model name in a trace line and the signed Scout Intent contract blocking or permitting a query.

---

## 5. RISKS FOR CAUSA

| # | Risk (rule at stake) | What the docs say | Recommended action |
|---|---|---|---|
| R1 | **Nemotron via NIM API directly instead of Nightshift** (disqualifying + loses NVIDIA prize) | "use Meterless Nightshift as its primary AI provider" (`Official_Rules.md` s8.1); "NVIDIA models are connected through Meterless Nightshift"; "Your app needs only its Zetaris and Meterless Nightshift settings." (`Technical_Execution_Requirements.md` s6); common failure "NVIDIA key in the app | Put it in Nightshift's Providers tab; the app only needs the Nightshift URL and token" | Route ALL reasoning calls through Nightshift (OpenAI-compatible client, `METERLESS_BASE_URL` + `METERLESS_RUNTIME_TOKEN`), add NVIDIA as a provider inside Nightshift, pin a Nemotron model (do not rely on `meterless/auto`), log the model per request. Do not keep a direct NIM client in the repo as a default path. If a direct-NIM fallback exists, label it non-primary and keep it out of the demo. |
| R2 | **Registration already closed (22 Oct 23:45 UTC); a member may not be registered or on a HackOS team** | "Late registration is not accepted." (`Official_Rules.md` s3); "Someone who is not registered cannot be added as a team member" | Today, verify Shayan, Umar and Afshan each have a registered HackOS account and appear on one team roster. If someone is missing, email hackathons@genai.works now. Confirm nobody is on another team. |
| R3 | **Roster lock** | "Team composition locks when the first submission is created." | Do not create even a draft submission until all three are confirmed. Agree the prize split in writing before submitting. |
| R4 | **Vendored Apache-2.0 Meterless engine code** | "Open-source libraries, the open-source Meterless Engines and public examples are fine. Comply with their licences and attribute where required."; "keep copyright notices, attribute material code you copied or adapted"; "make sure your team's own contribution is substantial."; README must disclose "Any open-source code or templates materially adapted" | Keep upstream LICENSE/NOTICE and file headers intact in the vendored directory; add a "Third-Party Code and Licences" README section (Meterless Engines, Apache-2.0, source repo `github.com/Meterless/Meterless`, commit hash, any modifications noted). Add a single line in the form's pre-existing field naming the vendored engines (safe even though the docs treat open-source libs as not needing declaration; **inference**). Wire the engine into a real feature with a passing test; a vendored but unused engine "Fails the Meterless requirement". Our own glue, agents and tests must be clearly the substantial part. |
| R5 | **"Implement" vs vendor** | Requirement is "implement at least one Meterless Engine ... in a working feature", with "the test showing it works" | Write our own engine integration code (adapters in `app/engines/`) plus a test/conformance check; point to it in README and sponsor explanation. Make 4 engines claims only if each has a feature and test; drop any engine we cannot test (overclaim risk). |
| R6 | **AI-generated code (Claude Code subagents)** | Allowed; disclose tool; "the AI wrote it is not an answer"; "The team cannot explain how their own solution works" is a disqualification trigger | README "AI and Model Usage" section naming Claude Code subagents as the coding tool (Cursor is optional, but several docs say "developed in Cursor"; the Official Rules prevail and say Cursor is optional, so state Cursor was not used rather than implying it). Each member must be able to walk through architecture, the engine test and a trace live. Review every merged change. Keep the coding tool's models separate from the product's Nightshift/Nemotron. |
| R7 | **Build-window history** | "Work committed before the build window opens is not eligible" | Window opens 22 Oct 00:00 UTC; our code starts 24 Oct so it is fine. Anything prepared earlier (specs, research, data pulls, design docs in `B:\open-agent-hackathon\`) that ends up in the repo or influences code should be declared as pre-existing; check `LEDGER.md` and git history timestamps. Prepared data "must be declared". |
| R8 | **Zetaris must be the real data layer, and runs locally** | "Zetaris ... running locally in Docker"; needs "8 GB of memory and 4 CPUs given to Docker, plus at least 15 GB of free disk space"; "Zetaris can't read a file sitting on your laptop. Put files in storage Zetaris can reach, such as an S3 bucket"; failure: `SELECT 1` only | Register EDGAR, SIC and World Bank tables in Zetaris and make the hypothesis queries go through it. Store a registration script (`scripts/register_zetaris_sources.sql`). If the box is under 16 GB RAM, use the AWS route the docs mention. Read-only SQL is consistent with "should not take unauthorised autonomous actions" (`Official_Rules.md` s18). |
| R9 | **Judges likely have no Zetaris/Nightshift** | "Ship a `SAMPLE_MODE=true` path that works without Zetaris, Nightshift or any network access"; "It still runs real agent logic on cached data, rather than replaying a saved output" | SAMPLE_MODE must run the whole agent loop on a small cached slice of EDGAR/SIC/World Bank with a local model stub or recorded provider fallback that does real parsing, not stored answers. **inference:** with no model available, SAMPLE_MODE still needs some reasoning path; decide how (e.g. deterministic rule-based fallback that is clearly labelled) and document it honestly. Test: delete `.env`, stop Zetaris and Nightshift, run all 3 examples. |
| R10 | **Hardcoded outputs / demo-only paths** (disqualification) | "Detecting a judge's input and behaving differently"; "Judges test with their own inputs" | Why-questions for companies not in our samples must work (or fail with an honest structured error). No `output_examples` read at runtime. Check outputs differ across the three example questions. |
| R11 | **Fabricated or non-matching traces/claims** | "Never hand-write a trace."; "The models you claim to use match what your logs show" | Generate traces from the real run only; log `model` on every Nightshift call; claim Nemotron only where the log shows Nemotron. |
| R12 | **Trace must show real multi-agent interaction** | "At least two named agents", "At least one feedback, critique, retry or branch event" | Hypothesis tester vs. critic/evaluator with at least one rejected claim and one retry per demo run; shared state (World Model/H-MEM) visible in logs; cap loop iterations. |
| R13 | **Data licensing / sensitivity** | "Datasets used in breach of their licence terms" not permitted; "Document every source ... the licence"; "avoid ... real personal, clinical or financial records" | Document each source in `data/README.md` (URL, licence, subset, regeneration). **inference (not in docs):** SEC EDGAR is public domain but has a fair-access policy and requires a descriptive User-Agent header, and EDGAR filings name individuals (officers/directors); World Bank open data is generally CC BY 4.0, SIC hierarchy is a public classification. Verify each before citing. Prefer pre-downloaded small samples plus an automated download script; no login. |
| R14 | **Financial-use disclaimer** | "disclaimers for medical, legal, financial or safety-sensitive use cases"; "Claiming production readiness without disclosing limitations" | Add visible "analysis, not investment advice; correlation not proven causation" caveats in output, README, deck and video. Include limitations section. |
| R15 | **Over-claiming** (disqualification trigger "materially misrepresents") | Claiming real-time data when static samples; claiming "signed execution contract" or "grounded entities" the code doesn't do | Describe data as live or cached accurately; state which engines run in which feature; README claims reviewed against code before submit. |
| R16 | **Secrets in repo, history, video, deck** | Disqualification; "rotate it rather than deleting the commit"; "Check your video frame by frame" | Pre-commit secret scan (their regex in `Disqualification_Checklist.md` s11), `.gitignore`, `.env.example`; never screen-record Nightshift Console/Providers tab or `.env`; NVIDIA key only in Nightshift. With AI subagents writing code, add a hook or CI scan. |
| R17 | **Runnable from clean clone / programmatic entry** | "Runs from a clean checkout with a documented command, no manual fixing"; `run.py` or `POST /run`; bind `0.0.0.0`; Docker recommended; `host.docker.internal` for Zetaris/Nightshift | Provide `run.py`, `POST /run` JSON in/out, Dockerfile, three `input_examples/` with real saved `output_examples/`, logs to stdout and `logs/`. Test on a different machine from a fresh clone (the docs' 10-step flow). |
| R18 | **Time: 3 days left, AI-built** | "Freeze features, harden, record the demo video, finish the slide deck, package the submission." (26 Oct) | Feature freeze 26 Oct morning UTC; record video 26 Oct; backup video host; final validation 27 Oct 12:00 UTC; submit with hours to spare. |
| R19 | **Video/deck/hosting mechanics** | Link must open "without requesting permission", with audio, "Stay live until judging is complete" | MP4 uploaded in form if allowed; else public link tested in private window; second host; copy with a teammate; link also in README. Deck format unspecified: ask in #help desk or check the HackOS form early (ask now, not on the 27th). |
| R20 | **Track fit** | "Submissions must map clearly to the selected track." | Name "The Agent That Can Explain Why" in README, deck, video and examples; tie the story to "investigate complex questions across multiple data sources, connect findings, and produce evidence-backed answers". Read the full Track 2 statement on the HackOS challenge page (not in our docs). |
| R21 | **Doc conflicts** | `Weak_Submission_Examples.md` s22 and `Submission_Form_Preview.md` list "developed in Cursor" in the minimum bar / checklist; Official Rules: "Cursor ... Optional" | Follow the Official Rules; if the HackOS form has a Cursor field, answer "not used"; if unsure ask hackathons@genai.works ("reply within one working day"). |
| R22 | **Unread material** | Participant Setup Guide (PDF), HackOS challenge pages, live Official Rules | Someone reads the PDF and the live rules today; check for rules that differ from this draft-status copy. |

---

## 6. DATES AND EVENTS IN THE NEXT 3 DAYS (today = 2026-10-24)

All times UTC.
- **24 Oct, 14:00 UTC, Mid-Sprint Community Call**: "**24 October, 14:00** | Mid-Sprint Community Call | Participants | Live halfway check-in on HackOS: progress demos, mentor feedback, Q&A." (`Event_Calendar.md`). Also "Mid-Sprint Community Call: 14:00 UTC, live on HackOS". Today; the local clock on this machine read about 19:38 when this file was checked (time zone not confirmed), so it may already be over. **inference:** a recording is not promised by the docs; check HackOS Announcements.
- **24 Oct checkpoint (Event_Calendar.md)**: "By this point, you should ideally have: ... A minimal working end-to-end version. / Zetaris and Meterless Nightshift connected and tested. / A Meterless Engine implemented in a feature, or in progress. / Agent activity being logged. / Initial input and output examples." Self-question: "If the submission deadline were tomorrow, what would fail?"
- **24-25 Oct (Participant Journey Map / Event Calendar)**: "Join the Mid-Sprint Community Call. Deepen agent behaviour, add retries and fallbacks, log activity, test with realistic inputs."; "25 Oct | Add datasets, tools, and retrieval through Zetaris. Test failures and fallbacks."
- **Day 3-4 mentor checkpoint (24-25 Oct, `Mentor_Playbook.md` s11.3)**: "It runs in Docker / Provider calls work from inside the container / At least two agents are implemented / Traces show interaction between them / There's a fallback or sample mode / Sample inputs and outputs exist". "If a team is missing more than three of these on day four, the advice is cut scope, not push harder."
- **26 Oct, morning, Submission packaging begins** ("Submission packaging begins | 26 October, morning", `Event_Calendar.md`). "26 October | Freeze features, harden, record the demo video, finish the slide deck, package the submission." Mentor "Final-day review | 20 min | Submission readiness on 26–27 October".
- **27 Oct, 12:00 UTC, Final validation** ("Final validation | 27 October, 12:00 UTC").
- **27 Oct, 23:45 UTC, submissions close** (hard).
- Mentor office hours: booked on HackOS ("Book through the office hours area on HackOS"), no fixed times in the docs. "Check submission readiness: Book on day 4 or 5, not day 6." "One active slot at a time per team". Schedules and joining links are published in HackOS Announcements ("Support and mentor office hours schedules / Live session joining links / Submission form availability" in `Event_Calendar.md` s9). Fast answers: "post in your track room" or #help desk.
- Support route for submission trouble: "If HackOS is the problem, post in the #help desk channel straight away" with template (`Demo_Video_Guide.md` s8).
- After: judging opens 28 Oct; results "6 November 2026, 16:00 UTC", live call on HackOS.
- Submission form availability on HackOS is not dated in the docs; "Submission form availability" will be announced. **inference:** check the form exists and its field list now.

---

## 7. PRE-SUBMISSION CHECKLIST DERIVED FOR CAUSA (all items trace to sections above)

- [ ] 3 members registered, on one HackOS team, roster confirmed before first submission; prize split agreed in writing.
- [ ] Track 2 selected; README, deck, video all name it.
- [ ] Nightshift is the only model path in the default config; Nemotron model pinned and logged.
- [ ] Zetaris registered sources + SQL log lines; Meterless engine(s) in a feature with a passing test and README pointer.
- [ ] Vendored Apache-2.0 code: LICENSE/NOTICE kept, attributed, listed in README and form.
- [ ] README: setup, usage, dependencies, AI/model usage, coding tool (Claude Code), data sources/licences, limitations, sample mode, third-party licences, demo video link, pre-existing components.
- [ ] `run.py` / `POST /run`, Dockerfile, 3 inputs + real outputs, `logs/trace-*.jsonl`, `.env.example`, `.gitignore`.
- [ ] Clean-clone and SAMPLE_MODE tests on a second machine; secrets scan clean.
- [ ] Video 2:30-3:30 target, under 4:00, audio, no secrets, public link tested in private window, backup host, local copy, teammate copy.
- [ ] Deck covers all 8 points.
- [ ] Sponsor explanation covers Zetaris, Meterless engine(s) and test, Nightshift connection, NVIDIA/Nemotron, what was unique.
- [ ] Repo public and tested logged out.
- [ ] Submitted well before 27 Oct 23:45 UTC.
