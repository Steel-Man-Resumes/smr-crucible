# Handoff & Analysis Charter -- Steel Man Resumes, full Forge -> Refinery flow

**From:** Claude Opus 4.8 (built Phase 7 this session, 2026-06-09)
**For:** the high-capability, large-context model Troy is bringing in behind me ("Fable")
**Subject:** a high-level analysis + deep bug / edge-case hunt of the entire platform, after a major build, with Troy's live full-flow test notes as primary evidence.

---

## 0. Your charter -- read this first

Troy built **Steel Man Resumes (SMR)**: a platform that helps **justice-impacted jobseekers** (people with criminal records, gaps, reentry) build a resume, tell their story, and get hired. A major build just shipped (**Phase 7** -- the resume builder + the extraction intelligence). Troy is, right now, running a **full manual end-to-end test** with the account `d3vt3st3rt.roy@gmail.com`, and is dropping the **documents the system produced** plus **his running notes** into a folder he named **"dev tester forage output v2"** ("forage" = Forge). Find that folder and read every file in it -- those notes and outputs are your highest-signal evidence, because they are the real system behaving on real input.

**You have a very large context window. Use it.** Open the actual files and read them end to end. Trace every branch. Do not analyze from summaries -- this document orients you, it does not substitute for the code. Where I give you a file path, go read it.

**Your deliverables (be specific, cite `file:line`, separate confirmed from suspected):**
1. **High-level assessment** -- does the system meet the goals in section 2? Is the architecture sound? Where is it fragile or over-built?
2. **Bug list**, prioritized, each with the file/line and the reasoning or repro that makes it a bug.
3. **Edge-case list** -- inputs, paths, and states that break or silently degrade (empty/garbled/huge/adversarial input; the branches in section 4; auth/session/subdomain boundaries; mobile; AI-provider failure).
4. **Gaps vs. the stated goals + doctrine** (section 2), and vs. the locked spec.

**Tone:** Troy wants the truth, not reassurance. If something is weak, wrong, or half-built, say so plainly with evidence. I have tried to be honest below about what I did not verify and where I think the risk is -- treat that as a starting point and go past it, not as the ceiling. Find what I missed.

---

## 1. What to read, in order

1. **This document.**
2. **Troy's folder "dev tester forage output v2"** -- his live-run notes + the produced documents (resume, cover letter, disclosure brief, etc.). Judge the *quality* of what the system generates, and reconcile his notes against the code.
3. `docs/RESUME-BUILDER-SPEC-2026-06-09.md` -- **section 11 is the locked, authoritative spec** for Phase 7 (sections 1-7 are background; section 8 is superseded by 11.4). This is the contract; check the build against it.
4. **My own final-pass analysis:** `docs/PHASE-7-ANALYSIS-2026-06-09.md` -- start your bug hunt where I stopped. I found two real bugs in my last pass (both fixed); assume there are more.
5. **Build history / reasoning:** `docs/HANDOFF-2026-06-09-PHASE-7-PLAN-AND-RENAME.md`, `docs/HANDOFF-2026-06-09-PHASE-7-BUILD.md`, and the earlier `docs/HANDOFF-2026-06-09-PHASES-2-6-CLOSE.md` (the Refinery overhaul that preceded Phase 7).
6. **The code** -- the map is in sections 3-4.
7. **Git log** -- `git log --oneline -40` reads like a narrated build; the commit messages carry the "why."

---

## 2. The mission and the doctrine (the lens for everything)

SMR exists because the standard resume/job-search market writes off people with records. The thesis: **truth-preserving extraction from a real life** -- pull the genuine, defensible story out of someone the world has taught to undersell themselves, without inventing anything. The platform is two halves:

- **The Forge** (`forge.steelmanresumes.com`): pre-auth, no login wall. Builds your **base resume** and a behavioral-science **Career Intelligence Report** (narrative, strengths, career paths).
- **The Refinery** (`refinery.steelmanresumes.com/dashboard`): post-auth. Tools that consume the Forge profile -- the **Application Tailor** (aims the base resume at a specific job), Disclosure Planner, Interview Practice, Job Board, Resources, the Vault ("My Materials").

**Doctrine you must hold while analyzing (these are load-bearing -- a violation IS a bug):**
- **Truth gate.** Nothing generated may assert a fact the user did not provide. Missing detail -> ask, never invent. The single most important property to stress-test.
- **Privacy.** Store the *structured frame*, never the user's raw words / transcript / audio. (Exception: the resume document itself is the user's resume -- storing it is the point. But the bullet-workshop "evidence" must be structured facts, not free narrative.)
- **Value before the wall.** The builder + bullet workshop work fully **pre-auth**. Walling the value is wrong for this population.
- **Not graded.** Strength meter + a coaching *checklist*, never a numeric "readiness score."
- **Language.** Never the words incarceration/prison/jail/inmate/offender/felon ON the resume; disclosure is its own lane. "Justice-impacted," never "second-chance/ex-con." No em dashes (use `--`). No emojis in product copy.
- **Anti-fragility framing.** Reframe inside/work-program experience as real experience; kill the word "just"; gaps handled, not hidden.

---

## 3. The full flow, step by step -- goal, reasoning, key files

The routing is linear and was verified hop-by-hop (every page returns 200). For each step: **GOAL / WHY / FILES / WATCH-FOR.**

**Entry -- marketing -> Forge.** `steelmanresumes.com` (repo `~/repos/smr-website`) is the front-end; its CTAs point into the Forge. GOAL: get the right person to the right next action. FILES: `smr-website/src/app/page.tsx`, `/refinery/page.tsx`. WATCH-FOR: stale naming (I fixed "Resume Builder" -> "Application Tailor" in a few places; there may be more in guides/FAQ).

**`/intro` -> `/welcome`.** Entry gates / readiness framing (Prochaska stage-of-change is the science). FILES: `apps/consumer/app/(forge)/intro|welcome/page.tsx`, `(forge)/layout.tsx` (the `FORGE_STEPS` progress bar, the `ForgeProvider` localStorage session, the t.ROY assistant drawer).

**`/resume` -- THE BUILDER (Phase 7's heart).** GOAL: build a strong, structured, ATS-safe **base resume**, extracting the gold. WHY: this is the "industry-best" target and the entrance for everyone. FLOW: ingest (upload/paste/LinkedIn-Indeed import/external/guided + the "Gather Your Info" recovery links: IRS Wage & Income, The Work Number, Credly) -> parse to a structured `ResumeDocument` -> drop into `<ResumeBuilder>` (wraps the shared `<ResumeEditor>`: sections + live preview + score) with the **bullet workshop**, the assess nudge, the parser preview, and the readiness checklist -> carry forward. FILES: `app/(forge)/resume/page.tsx`, `components/forge/ResumeBuilder.tsx`, `components/resume/{ResumeEditor,resumeModel,resumeParsers,sections,ResumePreview,BulletWorkshop,ParserPreview,resumePrint}.tsx`. WATCH-FOR: **the text->structured parse fidelity** (`parseResumeText` in `resumeParsers.ts` is regex-based -- garbled OCR, unusual formats, multi-column resumes); demo + rush branches bypass the builder (intentional); the carry-forward sets `session.resumeDoc` + a regenerated `resumeText`.

**`/goals` -> `/story` -> `/preferences`.** GOAL: surface goals, the "rupture" (record/gaps/challenges), and work constraints -- the raw material for the narrative. FILES: the matching `(forge)/*/page.tsx`. WATCH-FOR: record data is sensitive; confirm it is handled per doctrine.

**`/processing` -> `/output`.** GOAL: the AI analysis (`/api/analyze`) produces `forgeOutput` (narrative, strengths, career paths) = the Career Intelligence Report. It reads `session.resumeText` (which the builder now feeds as clean structured text). FILES: `app/(forge)/processing|output/page.tsx`, `app/api/analyze/route.ts`. WATCH-FOR: this is the part I traced but did NOT walk live -- Troy's run is the first real end-to-end. Scrutinize the analyze prompt + output shape.

**Account creation -> persistence.** `/output -> /login?from=forge`. GOAL: carry the anonymous Forge work onto a real account across the `forge.* -> refinery.*` origin boundary. FILES: `app/(auth)/login/page.tsx` (posts the whole localStorage `forge_session` to `/api/auth/register`), `app/api/auth/register/route.ts`, `lib/forge-persist.ts` (saves `forge_session` + `consumer_profile` + **auto-creates the base resume artifact**, now preferring the structured `resumeDoc` with its bullet evidence), `lib/forge-to-resume.ts`, `auth.ts` (NextAuth, JWT strategy, cross-subdomain cookie, the `authorized` callback that 401s a list of API prefixes). WATCH-FOR: the cross-subdomain session; the `_syncedAt` dedupe on the dashboard relay (`app/(dashboard)/layout.tsx`) -- edits after the first sync may not re-persist; the register path's field handling.

**Dashboard / Refinery.** GOAL: onboarding (base -> tailor story) then the tool workspace. State machine in `lib/useOnboarding.ts` + `/api/user/context` (`needs_profile -> needs_resume -> full_access`; unlock = first **job-tailored** resume, `createdFrom:"job"`). FILES: `app/(dashboard)/dashboard/page.tsx`, `(dashboard)/layout.tsx`, `JourneyProgressBanner.tsx`. WATCH-FOR: the onboarding-state semantics vs. the base resume (a Forge base resume is `createdFrom:"forge"`, deliberately does NOT unlock full_access).

**Application Tailor.** GOAL: aim the base resume at a specific posting -> tailored resume + cover letter + disclosure brief. FILES: `components/resume/ResumeWorkspace.tsx`, `app/api/resume-generate-full/route.ts`. WATCH-FOR: it assumes a base resume now; the setup screen links out to the Forge to build one.

**Disclosure / Interview / Jobs / Vault.** Disclosure Planner, Interview Practice (now fed the **bullet evidence** -> probes real proof; `app/(dashboard)/dashboard/interview/page.tsx` + `app/api/interview-practice/route.ts`), Job Board (fair-chance), Vault/Materials (renders the base resume; `app/(dashboard)/dashboard/vault/page.tsx`).

---

## 4. The intelligence layer (the moat -- scrutinize this hardest)

- **The bullet workshop** (`components/resume/BulletWorkshop.tsx` + `app/api/forge/resume-assist/route.ts`, pre-auth, IP-limited). Weak/empty bullet -> 5 gold-mining prompts (did what / tool / how often / how many / what improved) -> ONE true, justice-reframed bullet, **never beyond the stated facts**. Stores structured `BulletEvidence` on the `WorkEntry`. Actions: `write_bullet` (MODEL_DEEP), `suggest_tools` (O*NET fail-open to AI), `suggest_summary`. **Stress-test the truth gate here above all else** -- try to get it to invent a number, a tool, a result. Confirm it marks unstated fields "not specified."
- **O*NET** (`lib/onet.ts`) -- fail-open memory-jogging; creds were just added but approval is pending, so it runs on AI fallback (`source:"ai"`) until then. I tightened its timeouts after a cold-start 500.
- **Progressive intake** (`lib/intake-engine.ts`, `app/api/intake/followups/route.ts`, `components/ProgressiveIntake.tsx`) -- the shared AI-followup engine (disclosure/interview); fails OPEN.
- **t.ROY** -- the assistant/coach. Pre-auth `/api/assistant`, post-auth `/api/coach`. Doctrine via the **skills library** (`lib/skills/*/SKILL.md` + `manifest.json` + `lib/skills-loader.ts`). **FOOTGUN:** skill `.md` files reach a route's Lambda ONLY via `next.config.mjs` `outputFileTracingIncludes`; verify with `GET /api/health/skills` -> `{ok:true}`. I deliberately encoded the bullet-workshop doctrine inline (a focused one-shot) rather than loading the full conversational skill file -- evaluate whether that was the right call.
- **Models** centralized in `lib/ai/models.ts` (DEEP=Opus / CHAT=Sonnet / FAST=Haiku) with an Anthropic->OpenAI failover. Never hardcoded.
- **Rate limits** (`packages/core/src/rateLimit.ts`, `lib/withRateLimit.ts`): per-IP/day for Forge, per-user/day for Refinery. **I found the workshop endpoint inheriting the default of 10/IP/day and raised it to 100 -- re-audit every pre-auth limit against the realistic call pattern, especially for shared library/program IPs (this population).**

---

## 5. History + the pivots (what did NOT work, and why -- do not re-suggest dead ends)

- **The core reframe:** the thing labeled "Resume Builder" lived in the *Refinery* but was never a builder -- it tailored a base resume to a job. Phase 7.0 renamed it **Application Tailor**; 7.2 moved the *real* builder into the Forge as its spine. If you see "Resume Builder" anywhere in the app, that is stale.
- **Route decision (Troy):** upgrade `/resume` in place rather than a new `/build` route -- explicitly because it is **least confusing for non-technical users**. One editor, one surface (DRY).
- **Pre-auth bullet workshop (Troy + me):** there is **no valid business or technical reason to wall the gold** behind login for this population; abuse is handled by IP rate-limiting like `/api/assistant`. This also fixed a latent bug: the builder's summary assist was calling the auth-gated `/api/resume-generate` (401 logged-out) -- moved to pre-auth `/api/forge/resume-assist`.
- **Doctrine in-prompt, not the full skill file:** the career-narrative `SKILL.md` is *conversational* coaching ("ask the user..."), which would mislead a one-shot bullet generator -- so the truth-gate/anti-fragility doctrine was encoded as a focused prompt. (Worth your second opinion.)
- **Base resume persistence:** `persistForgeSession` originally re-derived the base resume from text; it now prefers the exact structured `resumeDoc` (preserving edits + evidence).
- **Deliberately NOT built (the anti-drift fence, spec 11.3 -- do not propose these as "missing"):** an external-API pile (Lightcast rejected; CareerOneStop/BLS/USAJOBS/parsers deferred), a separate "evidence bank" DB subsystem, a browser extension, a second job tracker, numeric grades, a deep field-by-field base->version diff (the Tailor's "what we tailored" notes cover the intent).
- **Two real bugs found in my final pass (both fixed, both instructive about where to look):** (1) the workshop endpoint capped at 10 calls/IP/day -- would cut a user off mid-build, worse on shared IPs; (2) a one-off cold-start function timeout on the O*NET-backed `suggest_tools`. See `PHASE-7-ANALYSIS-2026-06-09.md`.
- **Process note:** there is a **parallel committer** in this repo (a commit I did not make -- "EXPO2026 partner code / dynamic /access page" -- landed mid-session). Confirm `git log` reflects a coherent history and that nothing you are reviewing was changed out from under the Phase 7 work.

---

## 6. Where I think the risk is (my honest map -- go past it)

Open these with suspicion:
1. **The truth gate under adversarial input.** Can you make `write_bullet` / `suggest_summary` / the analysis invent a quantity, a tool, a title, a result? Try empty, contradictory, and leading inputs.
2. **Parse fidelity.** `parseResumeText` (regex) on real-world resumes -- multi-column, tables, unusual headers, photos/OCR, non-US formats. What does a mangled parse do downstream (analysis, Tailor, interview)?
3. **The carry-forward chain.** `resumeDoc` (localStorage) -> register/relay -> `persistForgeSession` -> base artifact -> `/api/user/context` -> Tailor default -> interview evidence. Where can it drop data, double-persist, or desync (the `_syncedAt` guard)?
4. **Auth / session across subdomains.** The `forge.* -> refinery.*` handoff, the JWT cookie scoped to `.steelmanresumes.com`, the `authorized` 401 list. Pre-auth vs. auth-gated endpoints -- is anything mis-classified?
5. **Rate limits across the whole pre-auth surface** (analyze=5, parse=10, assistant=20, generate-docs=5, resume-assist=100, default=10) vs. realistic and shared-IP usage.
6. **Privacy.** Grep for anywhere a user's raw words/answers are persisted (decision_log, artifacts, sessions). The doctrine is frame-only.
7. **AI failover + fail-open paths.** When Anthropic AND OpenAI fail, when O*NET hangs, when the skill files are not traced into a Lambda -- does it degrade gracefully or trap the user?
8. **Mobile + the builder's density** (editor + nudge + parser preview + checklist + four export buttons on one screen).
9. **The deep Forge middle** (`/goals -> /processing -> /output -> account`) -- traced but not walked live by me; Troy's run is the first real pass.

---

## 7. How to work

- **Open the files. Trace, do not assume.** Cite `file:line`. Separate "confirmed bug (here's why)" from "suspected (here's what to check)."
- Try to run it: `cd apps/consumer && npm run build` (types + lint), and the targeted scripts. The repo is a Turborepo-style monorepo (`apps/consumer` = the app, `packages/core` = the DB/AI/rate-limit layer). Node 20 (`source ~/.nvm/nvm.sh && nvm use 20`). Deploy = `git push origin main` (git-connected Vercel, project `the-crucible`).
- Respect the **doctrine (section 2)** and the **anti-drift fence (section 5)** -- a "fix" that violates either is not a fix.
- Weight **Troy's live-run notes** heavily; they are ground truth about behavior. Reconcile every note to a code path.
- End with a crisp, prioritized synthesis, not a wall. Troy is going to act on this.

---

## 8. TROY'S LIVE-RUN NOTES (primary evidence)

> Troy is filling this in as he runs the full flow with `d3vt3st3rt.roy@gmail.com` and dropping the produced documents into **"dev tester forage output v2"**. Read both. His notes are observations from the real system on real input -- the highest-signal evidence you have. (If this section is still empty when you arrive, ask Troy for the folder path and the notes.)

```
[ Troy's notes go here -- or in the "dev tester forage output v2" folder. ]
```

---

*Built with care by Opus 4.8. The honest state: the substantive thing Troy set out to build -- a truth-preserving resume builder that extracts a real story from a real life, for people the market discards -- is built, live, and verified on the new surfaces. Your job is to find what a careful build still misses. Be rigorous; he can take it.*
