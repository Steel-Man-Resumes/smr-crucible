# Steel Man -- Session Handoff (Opus 4.8, 2026-06-07)

**For:** the next chat (fresh full-context window).
**Read in this order:** (1) this file, (2) `~/todash/smr/SMR-OPUS-ASSESSMENT-AND-BUILD-DESIGN-2026-06-07.md`, (3) `~/todash/smr/SMR-MASTER-PLAN-2026-06-06.md`, (4) `~/repos/smr-crucible/HANDOFF.md`. The master plan is the product vision; the assessment is the reconciliation with reality; this file is the current state.

---

## 0. TL;DR

A single Opus 4.8 session assessed the locked master plan, reconciled it with the live code, and built a complete verified vertical: the intelligence engine, the seven-stage journey shell + guided tour, the fair-chance rename, and the AI career coach (brain + memory + chat + settings + proactive triggers), plus the CareerOneStop fallback. **27 commits, all local, NONE pushed.** The fresh dedicated Neon DB has the full schema live and verified. A local dev server is running on port 3002.

---

## 1. Non-negotiable reconciliations (do NOT re-break these)

These are where the master plan diverged from the deployed reality. Verified against the live code + live docs.

1. **Voice interview Section 9.1 is STALE -- do NOT "fix" it.** The deployed code's `gpt-realtime-2` + `/v1/realtime/client_secrets` + `/v1/realtime/calls` + voice `marin` are CORRECT (verified against current OpenAI docs + the gpt-realtime GA announcement). The plan's instruction to revert would break working voice. Real work = browser QA behind a flag, NOT a rewrite.
2. **Canonical user table is `users` (plural, NextAuth)** per `008_fix_consumer_fks.sql`. The application tracker table is `job_application` (singular). The plan's `job_applications` was wrong. All migrations target these.
3. **Storage is Cloudflare R2**, not Vercel Blob. The Document Vault (when built) uses R2 + a dedicated `DOCUMENT_ENCRYPTION_KEY` (NOT `AUTH_SECRET`).
4. **The coach consolidates the assistant**, it is not a 5th chatbot. t.ROY stays on the Forge/public surface; the user-named coach takes the authenticated Refinery chat drawer. Done -- see Section 4.
   Also: `refinery_artifact` (+R2 `file_object`) already is the document store; `consumer_consent` is layered/granular -- reuse these rather than the plan's parallel `user_documents` / `partner_progress_visible` bool when you build vault/partner.

## 2. Current environment state

- **DB:** fresh dedicated Neon `ep-little-cloud-aphpkqbd` (project is Steel-Man-only). All 17 migrations applied + verified (36 tables). `DATABASE_URL` in `apps/consumer/.env.local`.
- **Keys:** all Tier 0/1 in `.env.local` (Anthropic, OpenAI, Resend, JSearch, R2, Perplexity, DOCUMENT_ENCRYPTION_KEY, CareerOneStop, Twilio). `.env.local` is gitignored; old values backed up to `apps/consumer/.env.backup-2026-06-07.local`. `MOCK_AI=true` (zero AI spend on the 8 generation routes; NOTE: the chat/coach path uses the AI SDK directly and does NOT honor MOCK_AI -- chatting costs real Anthropic tokens).
- **Dev server:** `npm run dev -w apps/consumer` was running on **port 3002** (orphaned but alive; restart if gone). WSL2 forwards localhost to Windows.
- **Git:** **27 commits ahead of origin/main, NOTHING pushed.** Branch `main`.
- **Vercel CLI hangs from WSL** (it's the Windows install). A real preview/prod deploy must run from Troy's Windows terminal. Deploy is from workspace root: `cd ~/repos/smr-crucible && vercel --prod --yes` (the `.vercel/project.json` at root points to project `consumer` / `prj_Y05eliHgrKIr4Y0TcCgvG8VATwZH`). For a preview against the NEW DB/keys, the new keys must be pushed to Vercel preview scope first (production env still holds OLD keys/DB).

## 3. Intelligence engine (packages/core) -- DONE + verified

- `migrations/016_onboarding_coach.sql` -- onboarding + coach columns on `users` + `coach_conversation`. Applied + verified.
- `getUserProfile(userId)` -- single source of truth over `users` + `consumer_profile` + `job_application` + `refinery_artifact`. Calendar/SMS fields are in the contract with safe defaults until those migrations land.
- `computeNextStep(profile)` (pure ladder) + `getNextStep(userId)` (1h cache) + `invalidateNextStep`. Verified end-to-end.
- **Instrumentation backlog (the gates have no data source yet):** nothing sets `job_application.resume_artifact_id` (Stage 3 gate), and interview practice is localStorage-only (Stage 5 gate reads 0). Wire the resume-builder to link the tailored resume to the saved job, and the interview tool to persist an `interview_prep` artifact on completion. THIS is the real spine that makes the journey advance.

## 4. The coach (W4) -- DONE + verified (except live-stream browser QA)

- `coachPrompt.ts` `buildCoachSystemPrompt(profile)` (Section 5; style/length/focus-aware; embeds full profile). Verified.
- `coachConversation.ts` (load 50 / append / count). Verified.
- `coachProactive.ts` `computeProactiveMessage(profile)` -- deterministic opener ladder. All 6 scenarios verified.
- `apps/consumer/app/api/coach/route.ts` -- POST streams `claude-sonnet-4-6` (AI SDK, useChat `{messages}` shape), GET hydrates history, rate-limited, logs, persists each turn.
- `apps/consumer/app/api/coach/proactive/route.ts` + `apps/consumer/app/api/coach/settings/route.ts`.
- Wired into the Refinery chat drawer via a `coach` flag (useAssistant -> AssistantChat -> dashboard layout). t.ROY empty state preserved for non-coach.
- `CoachSettingsSection.tsx` in Settings (name/style/length/focus/creativity).
- **PENDING:** real browser QA of the streamed reply (only thing not verified headless -- it mirrors the proven `/api/assistant` pattern). Also pending: `context_digest` summarization for >50 messages (low priority).

## 5. Journey shell (W2) + Fair-Chance (W3) -- DONE

- W2: `JourneyHeader` (one `/api/next-step` fetch) renders the 7-stage `StageProgressBar` + `NextStepCard`; `GuidedTour` (3 screens, names coach, DB-persisted, 2 deferrals) mounted in the dashboard layout, client-tier only. All verified.
- W3: public "Second Chance" -> "Fair-Chance Lanes" everywhere; jobs<->lanes cross-link; **CareerOneStop fallback** in the job-search route (env-gated, fail-safe) + DOL logo attribution (`public/cos-logo-star.svg`). **BLOCKER: a real CareerOneStop call returned 401** -- account/token likely not active yet. The field mapping follows the documented `Jobs[]` shape but is UNVERIFIED until a successful call. Re-test once creds work. Deeper 3-layer unified-board merge + "Best Matches Today" (needs an `employer` table, migration 017) remain as Phase 2 polish.

## 6. Ops done this session

- `lib/ai-call.ts` -> Anthropic-primary (`claude-sonnet-4-6`) + OpenAI failover (the 8 generation routes). Verified tsc.
- Twilio creds in `.env.local` were mislabeled (Account SID vs API Key SID vs Messaging Service SID) -- relabeled correctly; phone in E.164; `TWILIO_MESSAGING_SERVICE_SID` left blank (needs an MG... from a created Messaging Service). Twilio A2P 10DLC pending (~2 days from 2026-06-07); SMS is W6, flag-gated.

## 7. Roadmap remaining (Phase 2+, master plan order)

1. **Instrumentation** (Section 3 above) -- makes computeNextStep gates real. High value, low effort.
2. **Materials + Vault:** cover-letter + follow-up generators; Document Vault on R2 + `DOCUMENT_ENCRYPTION_KEY` (reuse `refinery_artifact`). Migration reconciled (no `job_applications`; `job_application` already has `follow_up_at`+`notes`).
3. **Calendar + Twilio (W6):** events table (FK `job_application`), ICS, worker SMS scheduler, opt-in + STOP/HELP. Flag `twilio_sms` off until A2P clears.
4. **Partner dashboard:** consent-gated (extend `consumer_consent`), cohort list, CSV export. Dr. Baker priority.
5. **Admin/governance:** health panel, feature-flag UI, `api_key_registry`, employer CRUD + seed 15-20 verified MKE employers (migration 017 `employer` -- reconcile with `schemas/employers.ts` vocabulary; `org_listing_request` (010) is a different thing).
6. **Content-out-of-code** (quick_wins/roadmap/messages -> DB + admin CRUD).
7. **Conference + OSS:** demo mode, Playwright pass, PWA, secret scan, AGPL license, docs. Repo public Aug 15.

## 8. Working agreements (Troy)

- Slow, steady build to a fully complete platform; native iOS/Android apps come AFTER. PWA is the mobile story for now.
- Anthropic-primary + OpenAI fallback (locked).
- Opus builds the spine directly; bounded sub-agents only for parallel work (not used this session).
- Commit discipline: atomic per feature, clean messages, Co-Authored-By Claude Opus 4.8. All work LOCAL until Troy approves push/deploy.
- **Deploy gate:** nothing pushes/deploys until the `/forgot-password` email is verified delivering with the new Resend key (do this on a preview before production).
- Verification doctrine: prove against the live DB / running server, never assume "build success == working." Throwaway verify scripts in `packages/core/src/_verify_*.ts` (run with tsx + DATABASE_URL injected via a node extractor, then delete). DATABASE_URL is loaded from `.env.local` WITHOUT printing secrets.
- Keys: never printed, never committed; `.env.local` gitignored. Per-service, project-scoped. Master class: `~/todash/smr/SMR-API-KEY-MASTERCLASS-2026-06-07.md`.

## 9. Immediate next actions (suggested)

1. **Browser-QA the coach** at localhost:3002 (Fresh Client Run -> name coach -> open chat). Closes the last verification gap on the biggest feature.
2. **Wire the instrumentation** (Section 3) so the journey actually advances.
3. **Re-test CareerOneStop** once the 401 resolves; confirm the field mapping.
4. When Troy wants it shareable: preview deploy from his Windows terminal (push new keys to Vercel preview, verify reset email, deploy).
5. Then Phase 2 (materials/vault or partner dashboard).
