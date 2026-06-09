# SMR Crucible -- Session Handoff (Refinery Overhaul Phases 2-6)

**Date**: 2026-06-09 (continuation session, after the Phase-1 close)
**Model**: Opus 4.8 (claude-opus-4-8)
**Session focus**: Rotated/verified live credentials, then shipped Refinery Overhaul **Phases 2 through 6** -- each build-verified, deployed, and Playwright-verified end-to-end on prod with real AI.
**Deploy status**: 9 commits pushed to `main`, all auto-deployed READY on forge/refinery.steelmanresumes.com. Latest = `b9bf4dc`.

Supersedes `HANDOFF-2026-06-09-SESSION-CLOSE.md` (which teed up Phase 2). Read the memory note `project_refinery_overhaul` first; it is the one-paragraph state.

---

## >> THE NEXT MOVE: Phase 7 is a PLANNING SESSION, not a build (Troy's call, 2026-06-09)

**Do NOT start coding Phase 7.** Troy's explicit directive: **run a full planning session for the standalone Resume Builder before writing any code.** Phases 1-6 are done; Phase 7 is the last and largest, and it gets designed first.

### Troy's intentions for Phase 7 (the Resume Builder)

Captured from the approved overhaul plan (`docs/REFINERY-OVERHAUL-PLAN-2026-06-09.md`, section 5/feedback) and Troy's framing:

- **Standalone feature of BOTH surfaces** -- the Refinery app *and* the public website (steelmanresumes.com). Not just a dashboard tool buried behind auth; a front-door product.
- **Award-winning in efficiency.** The fastest, least-painful resume build anywhere. Respect the user's time and energy.
- **Award-winning at EXTRACTION.** "Pull the most meaningful information out of any user regardless of experience." Many users do not know what is impressive about their own work. **It is OUR responsibility to extract what we need -- we are the experts.** This is the heart of it: the builder interviews the user intelligently and surfaces the gold they would never think to write down.
- This is the natural home for the **progressive-intake engine** (Phase 1, `lib/intake-engine.ts` + `<ProgressiveIntake>`) -- the same "ask the sharp follow-up" intelligence, pointed at building resume bullets from a real person's lived experience.
- Justice-impacted framing throughout: anti-fragility as credential, the Steel Man principle, gaps reframed honestly (see `lib/skills/career-narrative/`).

### How to run the Phase 7 planning session (recommended cadence -- same as this overhaul)

1. **Current-state audit.** Read the existing builder end-to-end: `app/(dashboard)/dashboard/resume-builder/page.tsx`, the generation route(s) (`/api/resume-*`), the resume artifact shape (`refinery_artifact` type `resume`, `content` + `target_context`), and how Forge output feeds it. Note: the vault does NOT yet render resume `content` as text (the `toText` resume case is empty), and `?role=` / `?id=` params are passed in from lanes/vault -- check what the builder actually consumes.
2. **Goals + non-negotiables** with Troy: the two "award-winning" bars (efficiency + extraction), the dual surface (app + website), what "standalone" means for routing/auth (logged-out flow on the website?), and the deliverable (the unified PDF pattern is now in place -- reuse it).
3. **Architecture options** -- progressive-intake-driven build vs. form-first; how the website (smr-website repo) and the app share the builder; where generation runs (MODEL_DEEP for synthesis, per `lib/ai/models.ts`); how extraction questions adapt to experience level.
4. **Phased build plan** for Troy's approval, then build increment-by-increment with the same loop: build-verify -> commit -> deploy -> Playwright-verify on prod.

---

## What shipped this session (9 commits, all verified)

| Phase | Commit | What | Verified |
|------|--------|------|----------|
| Creds | -- | Resend rotation verified local + **prod** (real password-reset email delivered to admin inbox in 2s) | real email |
| 2 | `d0f1f0f` | Disclosure ANCHOR -- `<ProgressiveIntake>` wired into a new "deepen" step -> AI follow-ups; `/api/disclosure-guide` accepts optional `intakeAnswers` (sanitized, woven in, NEVER persisted -- only the plan/frame is stored) | 11/11 |
| 2 | `e8dfe71` | Disclosure -- editable Forge strengths (add/remove); motivating generic-vs-personalized choice; processing banner + scroll-to-plan + persistent "Saved to your Materials" link | 11/11 |
| 3 | `db67173` | Interview off the REAL application -- pick a saved resume + paste the posting, both fed to `/api/interview-practice`; wrapup on MODEL_DEEP returns better-answer models + the frame; analysis PDF + notes + "Copy a practice summary for any AI" (no transcript) | 11/11 |
| 4A | `0242228` | Lane cards -- dropped generic Practice/Disclosure buttons; Build-a-resume carries `?role`; "Verified employers" link `?q=lane`; employers page honors `?q` (filter + banner + Suspense) | 9/9 |
| 4B | `6507390` | Verified Employers "Prepare to apply" panel -- paste-able name/email/location + Copy, resume-in-Materials link, open-application button | E2E + visual |
| 4C | `0709208` | Job board -- role seeded from the user's most recent resume; "Fair chance only"/"Remote only" result filters + "N of M shown" | build-verified* |
| 5 | `9a18620` | Live Progress -- loader extracted, re-runs on focus/visibility/storage + save events (was load-once); new "Upcoming" application-follow-up timeline | E2E + visual |
| 6 | `b9bf4dc` | Materials/vault -- one formatted "Save PDF" for every artifact type (print window); removed per-item Copy + Download .txt | 4/4 |

\* 4C's filter toggles only render when the live JSearch API returns listings; it returned none at test time, so the toggles were not visually exercised (code is build-clean; the empty-search path was handled gracefully). Re-check when the board returns jobs.

---

## Architecture / patterns the next AI MUST know

- **Progressive-intake engine (Phase 1, reusable):** `POST /api/intake/followups` (MODEL_DEEP, 2-round cap, fails OPEN) + `lib/intake-engine.ts` (pure, parser fails SAFE) + `<ProgressiveIntake>` (`@/components/ProgressiveIntake`; every Forge-seeded field editable, never locked). Live in disclosure; the intended engine for Phase 7 extraction.
- **Privacy doctrine (hard rule):** store the FRAME, never the user's words/transcript/audio. Disclosure intake answers and interview practice words are NEVER persisted; only the plan/frame + feedback are stored. Decision logs record shape, not words. Interview notes stay client-side.
- **Unified PDF pattern:** disclosure (`downloadPlan`), interview (`downloadAnalysis`), and now the vault (`downloadPDF`) all build HTML and `window.open(...).print()` with the same Georgia/sage styling. Reuse this for Phase 7 resume export.
- **Two coaches:** `/api/assistant` (pre-auth Forge t.ROY) and `/api/coach` (authenticated Refinery coach). Both load doctrine via `lib/skills-loader.ts`.
- **THE FOOTGUN:** skill `.md` files reach prod ONLY via `next.config.mjs` `experimental.outputFileTracingIncludes` (PER-ROUTE). Verify delivery with `GET /api/health/skills` -> `{ok:true}`.
- **Model tiers** centralized in `lib/ai/models.ts`: `MODEL_DEEP` (Opus 4.8, synthesis), `MODEL_CHAT` (Sonnet 4.6), `MODEL_FAST` (Haiku 4.5). Wrapups/plans use MODEL_DEEP. Never hardcode a model string.
- **Server context:** `useUserContext()` -> `/api/user/context` returns `{profile, forge, resumes[], disclosurePlan, applications[], journey}`. It deliberately does NOT expose the criminal-record TYPE (only `hasCriminalRecord`). `applications[].followUpAt` drives the new Progress timeline.
- **Connectedness wiring (Phase 4):** lanes `?q=` -> employers filter; lanes `?role=` -> resume-builder; jobs `?q=` -> auto-search; jobs seeds role from `resumes[0].targetJob`.

## Verification: Playwright drives from WSL (no Windows needed for public-site E2E)

- Chromium is cached at `~/.cache/ms-playwright`; `@playwright/test` lives in `~/repos/tmg-client-ppp/node_modules`. Smoke scripts are in `/tmp/smoke/*.cjs` (login + walk a flow + assert + screenshot). Run: `SMR_EMAIL=... SMR_PASS=... node /tmp/smoke/<x>.cjs`.
- Dev test account: `d3vt3st3rt.roy@gmail.com` (a throwaway client-tier login Troy keeps for exactly this). It has Forge strengths + at least one tailored resume ("Production Operator at Junior Snacks").
- **Deploy verification:** `the-crucible` Vercel ids = project `prj_Y05eliHgrKIr4Y0TcCgvG8VATwZH`, team `team_XmJN97KS4xaZdLom6qF8R6ys`. `get_deployment` on the branch alias lags until the new deploy promotes -- poll until `githubCommitSha` matches before testing.

## Decisions + near-misses this session (miner input)

- **Resend:** the app SENDS via `AUTH_RESEND_KEY` (not `RESEND_API_KEY`, which is only a fallback). Verified prod by triggering a real `/api/auth/reset-password/request` to the admin inbox and confirming receipt via Gmail. The `/api/auth-check` probe is gated by `AUTH_CHECK_SECRET`, which is Vercel-only (not in local `.env.local`) -- could not run it from here.
- **Never re-expose secrets:** declined to drive the authenticated intake via curl because it would have re-printed the dev password in the transcript -- used Playwright (creds via env) instead. The whole session opened on a credential leak, so this matters.
- **Edit anchors:** an Edit failed on a blank-line / em-dash mismatch -- re-read the exact lines before retrying. Line numbers shift after each edit batch.
- **Phase 6 scope:** the interview "Copy a practice summary for any AI" button is a DELIBERATE feature (Troy's locked decision), NOT one of the "unnecessary copy buttons" the plan said to drop. Only the vault's generic Copy + .txt were removed.

## Standing rules (operator)

Atomic commits per feature; never accumulate. Never em dashes (use `--`). Never emojis in professional content. "Justice-impacted" always. Deploy = `git push origin main`. Build must pass before commit (no `ignoreBuildErrors` in next.config, so green = types+lint clean). Verify prod, do not assume. Do NOT write to `~/todash/smr/research-ground-truth/` (read only). Admin: troyrichardcarr@gmail.com.
