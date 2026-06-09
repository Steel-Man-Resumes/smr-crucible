# 2026-06-09 -- Opus 4.8 -- Refinery overhaul kickoff (+ skills foundation, coach doctrine)

**Model**: Opus 4.8 (claude-opus-4-8)
**Session focus**: Evaluation -> fix silent prod failures -> skills-library foundation -> approved + started the Refinery dashboard overhaul.
**Status**: OPEN (Refinery overhaul Phase 1 in progress -- see handoff)

## What Changed (headlines -- full list in docs/HANDOFF-2026-06-09-SESSION-CLOSE.md)
- Skill doctrine now actually reaches prod (`outputFileTracingIncludes`) and the AUTHENTICATED coach (`/api/coach`) for the first time. Both coaches load via shared `lib/skills-loader.ts`.
- Skills library FOUNDATION: SKILL.md folder standard + `lib/skills/manifest.json` (source of truth) + manifest-driven loader. Adding a skill = manifest entry + folder.
- Web-search tool (`lib/tools/web-search.ts`, Perplexity, cited) wired into `/api/coach`.
- Model router `lib/ai/models.ts`; WOTC/legal fix; onboarding handoff; journey test harness; `/api/health/skills` probe.
- Refinery overhaul APPROVED (7-phase plan, `docs/REFINERY-OVERHAUL-PLAN-2026-06-09.md`). Phase 1 started: disclosure planner now reads Forge from server context, not localStorage.

## Doctrine Notes
- Legal claims: always jurisdiction + date + verify-locally; never categorical; WOTC is expired for 2026 hires, use Federal Bonding. (PROTOCOL never-do updated 2026-06-08.)
- Interview deliverable = analysis-only PDF + user notes + copy-a-practice-summary-for-any-AI. NO verbatim transcript (privacy: frame, never words).
- Progressive-intake engine confirmed as the shared "intelligent follow-up questions" pattern.

## Open Items
- NEEDS-AI: finish Phase 1 (interview + jobs onto server context; build the progressive-intake engine), then Phases 2-7 per the plan.
- NEEDS-TROY: smoke-test the Forge-first -> create-account -> Refinery-ready onboarding path.

## Handoff Notes
Read `docs/HANDOFF-2026-06-09-SESSION-CLOSE.md` first -- it has THE NEXT MOVE, the architecture gotchas (two coaches, per-route skill tracing, the manifest), and the build/deploy/verify loop. Mirror the disclosure server-context change (commit 5686bdd) onto interview + jobs, then build `/api/intake/followups` + `<ProgressiveIntake>`.
