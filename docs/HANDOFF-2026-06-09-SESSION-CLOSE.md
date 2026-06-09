# SMR Crucible -- Session Handoff

**Date**: 2026-06-09
**Model**: Opus 4.8 (claude-opus-4-8)
**Session focus**: Independent platform evaluation -> fixed critical silent failures -> built skills-library foundation -> approved + started the Refinery dashboard overhaul.
**Deploy status**: 11 commits pushed to `main`, live at forge/refinery.steelmanresumes.com. The load-bearing ones verified live in production.

---

## >> THE NEXT MOVE (start here, do not miss a beat)

**Phase 1 is COMPLETE (continuation session 2026-06-09).** Next up is **Phase 2 -- Disclosure Planner overhaul**. Read, in order:
1. This file (esp. the "Phase 1 COMPLETE" section just below).
2. `docs/REFINERY-OVERHAUL-PLAN-2026-06-09.md` -- the full plan Troy APPROVED. Sequencing is locked: 1 -> 2 -> 3 -> 4 -> 5 -> 6 -> 7. Phase 2 spec is section 5 "Phase 2".
3. `apps/consumer/lib/skills/ai-comms/log/` -- the two most recent entries.

**Phase 2's first task = wire `<ProgressiveIntake>` into the disclosure planner** (`app/(dashboard)/dashboard/disclosure/page.tsx`), its intended first consumer. The engine is built and verified; Phase 2 is where it goes live. Phase 2 also: motivating generic-vs-personalized choice, editable Forge data, fix the build flow (land ON the finished plan, not the top; explicit "Saved to Materials"), wire the existing voice rehearsal, PDF export, remove the copy button.

### Phase 1 COMPLETE -- what shipped this continuation (3 commits, pushed to main)

- (1A) **Every Refinery tool now reads Forge from the SERVER**, not `localStorage["forge_session"]`. Disclosure was done in `5686bdd`; this session finished the set:
  - `636b0df` -- interview page -> `useUserContext()`. NOTE for Phase 3: interview must ALSO feed the user's SPECIFIC tailored resume + the target job description (today still only generic Forge skills/strengths). Phase 1 was just the server-context swap.
  - `122a026` -- job board -> `useUserContext()`. Privacy: `/api/user/context` does NOT expose the record TYPE, so the optional `recordType` search hint was dropped (only `hasRecord` drives fair-chance filtering). Phase 4 adds richer filters + resume-work-history seeding.
- (1B) **Progressive-intake engine** (`1e1a3e9`) -- the reusable "intelligent" intake. Contract for wiring it in:
  - **API:** `POST /api/intake/followups` body `{ topic, context, answersSoFar, round }` -> `{ questions: string[], done: boolean }`. Uses `MODEL_DEEP` (Opus 4.8). Hard-caps at 2 follow-up rounds; fails OPEN (returns `done:true`) on any error so it never traps the user. Mock-gated for dev.
  - **Component:** `<ProgressiveIntake topic context initialQuestions onComplete submitLabel maxFollowUpRounds busy />` from `@/components/ProgressiveIntake`. Renders initial questions, loops AI follow-ups, returns the enriched `IntakeAnswer[]` via `onComplete`. Every Forge-seeded field is editable (pass `seedValue` + optional `seedNote`); nothing is locked.
  - **Pure logic:** `lib/intake-engine.ts` (`buildFollowupsSystemPrompt`, `buildAnswersBlock`, `parseFollowups`). Parser fails SAFE; verified by a 12-check tsx harness this session.
  - This route does NOT read skill files, so it needs NO `outputFileTracingIncludes` entry (footgun avoided). Live end-to-end verification happens when it is wired into disclosure in Phase 2.

**The build/deploy/verify loop (NON-NEGOTIABLE -- this is how we caught everything):**
```
source ~/.nvm/nvm.sh && nvm use 20
npm --prefix /home/marcu/repos/smr-crucible/apps/consumer run build   # MUST pass before commit
# atomic commit per feature, then: git push origin main  (auto-deploys to Vercel the-crucible)
```
For anything that reads skill files or changes prod behavior, VERIFY live, do not assume. Probe: `GET https://refinery.steelmanresumes.com/api/health/skills` -> `{ok:true}`. Tests: `npm --prefix .../packages/core run test`.

---

## Platform architecture the next AI MUST know (hard-won this session)

- **There are TWO coaches.** `/api/assistant` = t.ROY on the pre-auth Forge surface. `/api/coach` = the AUTHENTICATED Refinery coach (where logged-in users actually work). `use-assistant.ts` routes to `/api/coach` when `coach` is true (it is, on the dashboard). Both now load doctrine via the shared `lib/skills-loader.ts`. Do not assume a change to one affects the other.
- **Skill doctrine = folders + manifest.** `lib/skills/<id>/SKILL.md`, indexed by `lib/skills/manifest.json` (source of truth). Add a skill = manifest entry + folder. The loader is manifest-driven and strips frontmatter.
- **THE FOOTGUN:** skill files are read off disk at runtime (fs), not imported. They reach prod ONLY via `next.config.mjs` `experimental.outputFileTracingIncludes`, which is PER-ROUTE. Every route that reads skills MUST be listed (currently `/api/assistant`, `/api/coach`, `/api/health/skills`). A new skill-reading route that isn't listed silently loads nothing in prod (works in local dev because cwd has the files). Verify with `/api/health/skills`.
- **Model selection is centralized** in `lib/ai/models.ts`: `MODEL_DEEP` = Opus 4.8 (high-stakes synthesis), `MODEL_CHAT` = Sonnet 4.6 (live chat), `MODEL_FAST` = Haiku 4.5 (mechanical). Never hardcode a model string in a route. Generators go through `lib/ai-call.ts` (raw fetch, Anthropic primary + OpenAI fallback; `callAI(system, messages, maxTokens, model?)`). The streaming chat uses the Vercel AI SDK (`streamText` + `@ai-sdk/anthropic`).
- **Web search tool** exists: `lib/tools/web-search.ts` (Perplexity `sonar`, cited), wired into `/api/coach` only (authenticated) via the AI SDK tool loop (`maxSteps`). `PERPLEXITY_API_KEY` is in env and works.
- **Server context** for Refinery tools: `useUserContext()` (`lib/use-user-context.ts`) -> `/api/user/context` returns normalized `{profile, forge{strengths,skills,careerPaths,...}, resumes, disclosurePlan, applications, journey}`. It deliberately does NOT return raw criminal-record details (privacy). For the full forge profile use `/api/forge/load` (`loadForgeProfile`).
- **MOCK_AI** is `true` in local `.env.local` only (saves tokens in dev); confirmed NOT set in Vercel prod (Troy checked). Generators gate on `isMockEnabled()`; the streaming chat does not.
- **Onboarding** now carries Forge work + name/phone into the account at registration (`/api/auth/register` -> `lib/forge-persist.ts`). The localStorage cross-domain relay is the OLD fragile path -- prefer server reads everywhere.
- **Test harness:** `packages/core/src/__tests__/journey.test.ts` (node:test + tsx, zero deps). Add tests for new pure logic here.
- **Preview-as-client** already exists: Settings -> "Test as Client" toggle (`admin_test_mode`), `useUserTier` honors it, and an amber `AdminTestModeBanner` shows when active. Admins are god-mode otherwise (they never see the real gated UX).

---

## What this session shipped (11 commits)

1. `0fae3bb` -- tiered AI model router (`lib/ai/models.ts`).
2. `92fe545` -- t.ROY delivery hardening: `outputFileTracingIncludes` so skill files reach the Lambda (was SILENTLY broken in prod -- t.ROY had zero doctrine); loud `[skills] MISSING` logging; chat model `claude-sonnet-4-20250514` -> Sonnet 4.6; audience-aware maxTokens. **Verified live.**
3. `0129c5e` -- `GET /api/health/skills` deterministic delivery probe.
4. `48e6211` -- WOTC/legal doctrine fix: WOTC expired for 2026 hires (IRS/DOL), Federal Bonding is the current incentive; legal-claim discipline (jurisdiction + date + verify-locally, no categorical promises). Grounded in `~/todash/smr/research-ground-truth` (Codex).
5. `128e0d6` -- Forge->Refinery onboarding handoff: register persists Forge session + name/phone server-side; create-account form collects name/phone. (Troy: smoke-test the Forge-first -> create-account -> Refinery-ready path.)
6. `7516d09` -- **doctrine into the authenticated coach** (`/api/coach` had ZERO doctrine -- biggest hidden gap). Shared `lib/skills-loader.ts`.
7. `690a519` -- journey/unlock test harness (11 tests).
8. `17ddfb3` -- visible admin test-mode banner.
9. `ef4160a` -- skills library FOUNDATION: SKILL.md folder standard + `manifest.json` + manifest-driven loader; fixed the latent `/api/coach` tracing gap. **Verified live** (`/api/health/skills` ok:true).
10. `24c3eae` -- web-search tool (Perplexity-backed, cited) wired into `/api/coach`.
11. `5686bdd` -- Refinery Phase 1 start: disclosure planner reads Forge from server context; + the approved overhaul plan doc.

---

## Decisions Troy locked this session

- **Refinery overhaul plan APPROVED**, sequencing = my recommendation (1->7). Started.
- **Interview deliverable:** analysis-only PDF (strengths, areas to work on, better-answer models, the frame) + user notes + a "Copy a practice summary for any AI" button. NO verbatim transcript (privacy doctrine: store the frame, never the user's words).
- **Progressive-intake engine:** confirmed -- build as ONE shared pattern reused across disclosure / interview / job board.
- Model tiering doctrine: use AIs intelligently (deep/chat/fast) -- now `lib/ai/models.ts`.

---

## Standing rules (operator)

Atomic commits per feature; never accumulate. Never em dashes (use `--`). Never emojis in professional content. "Justice-impacted" always. Deploy = `git push origin main`. Build must pass before commit. Verify prod, do not assume. Do NOT write to `~/todash/smr/research-ground-truth/` (a concurrent research agent owns it) -- read from it. Admin: troyrichardcarr@gmail.com. Dev test: d3vt3st3rt.roy@gmail.com / D3vt3st3rt.r0y1!2@3#.

---

## Remaining original-plan items (lower priority than the overhaul now)

- #2 Prompt caching on the assistant/coach routes (verify `@ai-sdk/anthropic` 1.2.12 cacheControl syntax first -- do not guess).
- #8 Skills CONTENT (reentry-employment, legal-rights, resume-strategy, ...) -- the rails are built; pour content in, grounded in `~/todash/smr/research-ground-truth` with the legal-claim discipline.
- #10 Research wiring (folds into the content skills).
- Opus-for-deep: route `disclosure-guide` + `resume-generate-full` to `MODEL_DEEP` (their JSON parsing tolerates it; raw fetch sends no temperature so Opus 4.8 is safe).

---

## Progressive-intake engine -- design sketch (Phase 1 part 2)

Goal: after the user answers initial questions, ask 2-3 SPECIFIC follow-ups based on their answers + their real context, then feed the enriched answers into the downstream generation (disclosure plan, interview, job search).

- New API: `POST /api/intake/followups` -> body `{ topic, context, answersSoFar }` -> uses `callAI(system, [...], 800, MODEL_DEEP)` to return `{ questions: string[], done: boolean }` (2-3 questions, or done when enough depth). Keep it grounded: feed the user's `/api/user/context` so questions reference their real strengths/record/target job.
- New reusable component: `<ProgressiveIntake topic=... context=... onComplete={enrichedAnswers => ...} />` -- renders initial questions, calls the API for follow-ups, loops 1-2 rounds, returns the enriched answer set.
- First consumer: the disclosure planner (deepen the record + framing). Then interview + job board.
- Editability requirement (Troy): every Forge-seeded field must be editable and the user must be able to go DEEPER ("talk about real things in a real interview"). No greyed/locked Forge data.
