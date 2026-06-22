# SMR Crucible -- Handoff

> **NEW CHAT: START HERE ->** `docs/HANDOFF-2026-06-10-FABLE-SESSION-CLOSE.md` -- session close after the **P0 batch SHIPPED**: truth gate in every generation lane, identity single-source, legal disclaimers, export branding off, DEEP tiers, skills wave 1 (live 14/14), and seats v1 (migration 019 applied; `EXPOCREW`/`BAKERCREW`/`JFWCREW` seeded -- client tier, 10 seats, 200/day; cohort members enter via `/access?code=EXPOCREW`). **First moves for a fresh chat: reply-pull -> verify the last deploy promoted -> support Troy's certification retest (Task #4) -> then t.ROY Phase A (Task #5).** Direction + Troy's recorded decisions: `docs/FABLE-REASSESSMENT-AGENCY-2026-06-10.md`; the audit: `docs/FABLE-ANALYSIS-REPORT-2026-06-09.md`; live state by system: `docs/BUILD-CHECKLIST.md`. (TMG personal-agent build is a SEPARATE instance's lane: `~/todash/tmg/TROY-PERSONAL-AGENT-CHARTER-2026-06-10.md`.)

**Last updated:** 2026-06-10 (Fable session -- analysis + P0 batch start)
**2026-06-10 P0 batch (green-lit by Troy, "truth gate first"):** SHIPPED + pushed: `c339525` truth gate in every generation lane (fabrication table deleted from generate-docs; evidence-only rules in resume-generate-full incl. cert/education carry-forward via education entries; cover letters barred from inventing numbers/personal facts; "--" never em dash in all generation prompts) -> `283f3df` "Built with The Refinery" footer removed from exported resumes (disclosure leak; Troy: brand in-app only) -> `cc119e6` analyze/generate-docs/resume-generate-full/disclosure-guide now MODEL_DEEP per doctrine + stale OPENAI-only guards accept either provider. All build-verified (95/95 pages); live-behavior verification = fresh e2e retest, pending. **REMAINING in batch:** seats v1 (access_code.seat_limit ~10/agency: EXPO2026/BAKER2026/JFW; role!=rate-tier so seat-holders stay `client`; code-aware pre-auth forge limits replacing shared-IP buckets; admin UI minting codes+seats+variables -- Troy decision), identity single-source fix (saveForgeSession merge-preserve contact; Tailor contact from base doc w/ editable confirm; phone normalization), "coaching not legal advice" disclaimer on all disclosure outputs. Decisions log + architecture: `docs/FABLE-REASSESSMENT-AGENCY-2026-06-10.md` (t.ROY agency three-phase plan; confirm-card guardrail; disclosure voice full parity; skills-library catalog ~35-40 model-independent skill.md files; DB stays ONE Neon with per-tool domains + event spine + nightly DB-intelligence agent -- multiple physical DBs rejected as desync factory).
**Last session (Opus 4.8):** Full journey instrumentation DONE + verified -- Stages 3 (resume), 4 (disclosure), 5 (interview), and 6 (apply/follow-up) all now persist real signals, so `computeNextStep` walks the whole 0 -> 6 ladder + the follow-up loop on live data (13/13 + 10/10 + 5/5 against the live DB). **Troy's privacy decision (2026-06-07):** keep data stored so the page is progressive and the tools work as designed, but revise the wording to be honest + reassuring + secure. For interview practice specifically: teach frames, not scripts -- store the FRAME practiced and whether the meaning landed (the coach's feedback), never the user's words/transcript/audio. **Cutover decision (Troy):** brand-new SMR universe -- new dedicated Neon (migrated, verified) + new keys + new accounts, completely separate + monitorable. See the "2026-06-07 (session 2)" section below.
**2026-06-16 (Opus 4.8) -- cinematic walkthrough SHIPPED + LIVE:** New self-running demo at `/walkthrough` (commit `09ff57f`, pushed to main, prod-verified 200 at `forge.steelmanresumes.com/walkthrough`, deploy promoted after ~1 min). Built for the **Mary Ann / Expo Wisconsin** partner share (she accepted a walkthrough invite; partner-audience distributor for a 3-week-program pilot). It is a virtual-camera "interactive slideshow" (Troy's words: zoom/pan to guide attention, like a video but not), NOT new full-screen scene cuts. **Key decisions (Troy, via AskUserQuestion): crisp DOM mockups** (sharp at any zoom, never stale -- chosen over screenshots which blur on zoom), **built-in Jordan persona** for the before/after (self-contained, no consent gate -- real-client PDF deferred), **self-running shareable link** only (presenter mode deferred). Files: `apps/consumer/app/walkthrough/{page.tsx,screens.tsx,storyboard.ts,layout.tsx}`. Engine = deterministic region->CSS-transform math clamped to the stage, 1280x800 letterboxed to any viewport; 16-beat data-driven storyboard (all tuning in `storyboard.ts`); reuses `lib/demo-data.ts` (Jordan) + partner-voice captions; controls Space/arrows/edge-tap/dots/R; respects prefers-reduced-motion; fully static (no API/auth/DB). The older `app/demo/page.tsx` was left untouched as a fallback. **Reused, did not rebuild** -- the `docs/DEMO-SYSTEM-PLAN-2026-06-05.md` asset inventory + existing `/demo` markup saved most of the work (archive-first paid off). Verified: tsc 0 errors, prod build passes, `/walkthrough` prerenders static, all 9 screens render. **Open follow-ups (not built):** Troy to eyeball the camera animation/timing (I verified build+render+deploy, not playback); OG share image; swap Jordan for a consented real-client before/after PDF. **NEXT for Troy:** send Mary Ann the link.
**2026-06-18 (Opus 4.8) -- Operation Fresh Start partner access + /access greeting fix (SHIPPED + LIVE):** New warm Madison lead Aram Donabedian (CareerScape Coordinator, OFS) had a long aligned call with Troy. Minted partner code **OFS2026** (partner tier, unlimited seats, no expiry; via `createAccessCode` against prod Neon, verified active). Eval email drafted in Troy's Gmail Drafts with one-link entry `refinery.steelmanresumes.com/access?code=OFS2026&name=Operation+Fresh+Start&contact=Aram`. **Bug found + fixed:** `app/access/page.tsx` hardcoded "You're In, Dr. Baker" in the hero AND closing note for EVERY code -- the earlier "dynamic" change (`6bb0e95`) only made the seat cookie dynamic, not the greeting, so EXPO/JFW partners would also have landed on a Baker-branded page. Now driven by `?name=` (hero) + `?contact=` (closing), Baker kept as default (commit `acaf7f0`, pushed to main, **prod-verified**: new copy present in the live `app/access/page-*.js` chunk). NOTE for EXPO: Marianne's link should add `&name=EXPO+of+Wisconsin`. Contact captured across all three network planes: connections-intel dossier `dossiers/B-priority/aram-donabedian.md`, network.db (id 287), Airtable "The Network" (Contacts + linked Interaction + org Pitch Angle). **OPEN:** Aram named other Madison orgs on the call -- Troy to relay the list for warm intros.
**2026-06-22 (Opus 4.8) -- partner tracking spine + Airtable visibility (SHIPPED + LIVE):** Built funder/compliance/governance tracking, per-org, isolated, report-ready, collecting from day one. Backend (commit `7e4d3ff`, prod): migration 020 `partner_usage_event` ledger; `partnerTracking.ts` (`logPartnerUsage`, `ensureUserAttribution` first-code-wins isolation, `getPartnerTrackingRows`); attribution hooks at registration (cookie), first authed tool call (`withRateLimit`), and pre-authorized partners on sign-in (`auth.ts`, Baker->BAKER2026); anonymous Forge front-door use logged in the IP path. Verified queries against live Neon (logged+read+cleaned a test event). **KEY HONESTY:** attribution is now automatic, but outcome numbers read zero until real users actually engage -- the *instrumentation* is what's "from day one." Airtable (Troy's choice -- he created base **"SMR partners" `appwpdTyLLde44Di5`**): tables **Organizations** (`tblepYP2Axzpqdi2m`, one row/org, live metrics) + **Snapshots** (`tbl9qT2UXk94X0TIE`, dated trend rows) built via MCP; sync = `packages/core/scripts/sync-partner-tracking.ts` (Neon->Airtable, upsert on Code + dated snapshot). First sync done: all 9 codes present (zeros). `AIRTABLE_TRACKING_BASE_ID=appwpdTyLLde44Di5` added to local `.env.local` (gitignored). **NEXT (offered, not built): nightly auto-sync** -- either a Vercel cron route (needs `AIRTABLE_API_KEY` + `AIRTABLE_TRACKING_BASE_ID` in Vercel env) or a VPS cron running the script. Troy also has a leftover default "Table 1" in the base he can delete.

**LIVE 2026-06-07:** Pushed to production (commit `04cdd8c`). `forge`/`refinery.steelmanresumes.com` now run the full new build on the seeded new universe. Troy is testing the entire flow as a brand-new user (Marcus Raleigh, fresh Google account) and will return with a complete bug/feedback list -- the next instance should triage + fix it first. See `docs/HANDOFF-2026-06-07-SESSION-CLOSE-LIVE.md`.

**Earlier next-session note (now done -- kept for context):** Run the preview gates (Troy is setting Vercel env + will test): `/forgot-password` email via new Resend key -> sign-in -> journey 3->4->5->6 on the preview. Seed the new Neon (it's empty): admin user, access codes with **`partner_user_id` set** (so the W7 partner dashboard resolves a cohort -- e.g., `BAKER2026` owned by Dr. Baker's account), and at least one client who redeemed + toggled "share progress" so the dashboard shows data. Then merge `session/journey-instrumentation-2026-06-07` -> `main` (= prod deploy, git-connected). Coach still needs real browser QA. Privacy copy + site privacy policy should get an attorney pass before public launch. Remaining feature work: W5 R2-encrypted document upload, W6 Twilio (A2P pending), W9 feature-flag UI + api_key_registry (net-new, lower priority -- the health panel AND the verified-employer board are DONE), W10 conference/OSS -- **secret scan (clean) + AGPL-3.0 LICENSE + public README/SECURITY/CONTRIBUTING DONE**; remaining = Playwright smoke pass + PWA (demo mode already exists: the Forge walkthrough + the seeded demo account cover it). **Tier tension to resolve (flagged):** redeeming a partner code currently elevates the redeemer to tier `partner` (a rate-limit tier), which skips the client journey/onboarding -- so pilot job-seekers should NOT redeem the partner code, OR we split "role" from "rate-limit tier". W7 sidesteps this by keying the partner dashboard on code OWNERSHIP, not tier.

## MASTER PLAN (READ THIS FIRST)
`~/todash/smr/SMR-MASTER-PLAN-2026-06-06.md`

This is the complete locked architecture for the platform. Written for Opus 4.8 to implement. Contains:
- All locked decisions (brand, journey, audiences, intelligence engine, AI coach, partner dashboard)
- 7 DB migrations to run (016-022)
- 3-phase build schedule to Aug 14 conference
- Voice interview fix instructions (Section 9.1 -- endpoints are wrong, must fix before demo)
- Demo story script (Section 12)
- Open source prep for Aug 15 launch
- Guardrails (Section 16 -- read before touching anything)

**Do NOT re-litigate architecture decisions. Implement them.**

---

## 2026-06-07 (session 2) -- Opus 4.8: full journey instrumentation (Stages 3, 4, 5) + privacy-copy revision

Continuation of the instrumentation backlog in `docs/HANDOFF-2026-06-07-OPUS-SESSION.md` Section 3. **DONE + verified, committed local, NOT pushed.**

**The gap (the engine had no data source):** `computeNextStep` was correct but its Stage 3 gate (`job_application.resume_artifact_id`) was never written. Two breaks found, both fixed:
1. The next-step card links to `/dashboard/resume-builder?job=<applicationId>`, but `ResumeWorkspace` only handled `?from=job` (sessionStorage) and `?id=<artifactId>` -- the `?job=` param was silently ignored, so the journey's own CTA did nothing.
2. Even in the working job-board flow, the saved resume artifact was never linked back to the application, so `hasResumeTailoredToTarget` stayed false forever.

**What was built:**
- `app/api/artifacts/route.ts` (POST): when a `resume` (or `disclosure_plan`) artifact is created with `targetContext.applicationId`, link it to `job_application.resume_artifact_id` (/ `disclosure_plan_id`) via an **ownership-scoped** UPDATE (foreign/bogus id => 0 rows), then `invalidateNextStep`. The column names are a fixed whitelist, never user input.
- `components/resume/ResumeWorkspace.tsx`: extracted the job-board generation into a shared `runCareerPackage(job, opts)`; the `?job=<applicationId>` next-step path now loads the saved application, tailors against it (or opens the existing tailored resume if already done -- no wasted AI spend), and both paths remember the target application id so the saved resume artifact links back to it.

**Verification (live DB, throwaway `_verify_*` scripts, then deleted):** 13/13. Fresh temp user -> Stage 3 `resume_not_tailored` with href targeting the app -> replay the route's link logic -> Stage 4 `no_disclosure_plan`. Ownership scoping confirmed (wrong user => 0 rows). Temp rows cleaned up (0 leftover). `tsc --noEmit` on the consumer app: 0 errors. core `tsc` build: clean.

**Stage 4 (disclosure) + Stage 5 (interview) -- DONE per Troy's decision (2026-06-07).** Both tools were localStorage-only and both showed the now-false line "This is a safe practice space. Nothing here is saved or shared," so those gates read 0 and the journey halted at Stage 4 (which sits *before* Stage 5). **Troy decided:** keep data stored (the page must be progressive and the tools must work as designed), but revise the wording to be honest, reassuring, and secure. **Pedagogy guardrail (Troy):** we teach frames, not scripts -- so for interview practice we store the FRAME practiced and whether the meaning landed, never the user's words.

What was built (the engine + artifacts route from Stage 3 already handle linking + `invalidateNextStep` for these types, so this was just the two tools + copy):
- `disclosure/page.tsx`: on plan generation, persist a `disclosure_plan` artifact (the user's deliverable: timing/legal/script/tips + targetJob). The rehearsal *conversation* is still never saved.
- `interview/page.tsx`: a shared `recordInterviewPractice()` saves an `interview_prep` artifact on completion (text wrap-up) and on a live voice session ending. Content is meaning-level only: role, frame (behavioral=STAR / disclosure / industry), mode (text|voice), includeDisclosure, exchange count, and the coach's structured feedback. **Never** answers, transcript, or audio.
- Copy: both `Nothing here is saved or shared` lines replaced. Interview: "We never save your words or recordings, only the frames you practice and whether your point lands... private to your account and never shared unless you choose to connect a support partner." Disclosure: "we never save your words from this practice. Your disclosure plan is saved privately... never shared unless you choose to connect a support partner. You can delete it anytime."

Security/compliance posture: stored in the existing `refinery_artifact` vault (Neon, encrypted in transit + at rest), auth-gated, ownership-checked, deletable (the delete endpoint exists, so "delete anytime" is real), consent-gated sharing via the partner dashboard only. Data-minimized (frames + assessment, not content). **NOT a lawyer:** the final user-facing privacy language + the site privacy policy should get an attorney pass before public launch.

Verification (live DB, throwaway `_verify_*`, deleted after): **10/10.** Temp user past Stage 3 -> save disclosure_plan -> Stage 5 `needs_practice` -> 1 interview_prep -> still Stage 5 -> 2nd -> Stage 6 `no_application`; `interviewSessionCount`/`practiceSessionsThisWeek` correct; explicit assertion that no `answers`/`transcript`/`messages`/`audio`/`recording` keys are persisted. Temp rows cleaned up (0 leftover). `tsc --noEmit` consumer: 0 errors.

**Stage 6 (apply / follow-up) -- DONE.** `/api/applications` POST now calls `invalidateNextStep` on create + status/follow-up update (same gap class as Stages 3-5: state changed but the 1h next-step cache didn't recompute). Verified 5/5 on the live DB: 0 apps -> `no_application`; mark applied -> `applicationCount=1`, past `no_application`; overdue `follow_up_at` -> `follow_up_due`. `saved` jobs correctly don't count as applications. The whole ladder now advances end-to-end.

**W7 partner dashboard MVP -- DONE + verified (committed local, NOT pushed).** Reused the existing models per the reconciliation note (no parallel tables): `access_code` / `access_code_redemption` for the cohort, `consumer_consent` ('sharing' / 'outcome_named') for the gate.
- **Migration 017** `access_code.partner_user_id` (FK users) -- a monitoring partner OWNS codes; their cohort = redeemers. Needed because tier `partner` is ambiguous (redeeming a partner code also makes the redeemer `partner`), so ownership is the unambiguous monitor signal. Applied to the new Neon + recorded in `_migrations`.
- **core `partnerDashboard.ts`**: `isPartnerUser` (owns a code / admin) + `getPartnerCohort` (progress SIGNALS only -- stage, app/practice counts, last active, hired, outcome; NEVER resume/disclosure/interview content; non-consenters counted but never identified) + `cohortToCsv`. `accessCode` create supports `partnerUserId`.
- **APIs**: `/api/consent` (GET/POST grant|revoke a toggleable layer), `/api/partner/cohort` (GET JSON + `?format=csv`, server-side gated on ownership/admin).
- **UI**: `/dashboard/partner` (summary + consent-gated cohort table + CSV + pending-private count), `SharingConsentSection` in Settings (client's own "share my progress" toggle with explicit what-is/isn't-shared copy), nav link (minTier partner; page also gates server-side).
- **Verified 14/14 on the live DB**: consent gating (non-sharing client never identified), owner-vs-redeemer, progress accuracy, CSV excludes private clients, admin-sees-all. tsc clean.
- **FLAGGED -- touched a shared function:** `consent.ts grantConsent`/`revokeConsent` now make the audit `emitEvent` best-effort (`.catch`), matching `accessCode.ts`. Reason: `event.org_id` is NOT NULL with an org FK and the sentinel org row doesn't exist on the fresh Neon, so `grantConsent` would THROW -- the "share progress" toggle would be broken on the new universe. An audit-row failure must never fail a consent grant. (Also: seed the sentinel org `00000000-...` at cutover so audit events actually record.)

**W5 materials -- follow-up generator + materials hub DONE (committed local, NOT pushed).** Reused `refinery_artifact` (no parallel storage), per the reconciliation note.
- New `follow_up` artifact type. `/api/follow-up` loads the application (ownership-checked), drafts a short, professional, record-safe follow-up via the AI shim (mock-aware via `MOCK_FOLLOW_UP`, rate-limited, decision-logged), saves it to the vault. Wired into the applications page (applied/heard_back/interviewing cards -> Draft / Copy / Redraft) -- closes the Stage 6 follow-up loop.
- `/dashboard/vault` ("My Materials"): one hub over `refinery_artifact` -- resumes, cover letters, follow-ups, disclosure plans, interview practice; grouped, with view / copy / download .txt / delete (resumes open in the builder). Nav link added (client tier).
- **Deferred (high-risk W5 increment):** R2-encrypted binary upload (external file storage with `DOCUMENT_ENCRYPTION_KEY`). The hub is useful as-is since all generated materials are already artifacts; the encrypted-upload piece needs R2 round-trip testing.

**W9 system health panel -- DONE (committed local, NOT pushed).** `core getSystemHealth()` (headless-runnable) + `/api/admin/health` (admin-gated) + `/dashboard/admin/health` UI + link from Admin. Reports DB/auth/email/AI/integrations with NO secret values (present/missing, counts, statuses, external-key validity). Serves "separate + monitorable" and the cutover readout without `AUTH_CHECK_SECRET`. Remaining W9: feature-flag UI, `api_key_registry` (net-new), employer CRUD + seed (needs REAL verified MKE employers -- never fabricate; `employers.ts` is a pipeline schema, not a table).

**LIVE health readout against the new universe (2026-06-07, ran with the real keys) -- env is essentially ready:**
- DB: connected, 18 migrations (001-017), **empty** (0 users/codes -- fresh universe, expected).
- Email: Resend key VALID + **`steelmanresumes.com` domain VERIFIED** (the `/forgot-password` gate should pass).
- AI: **Anthropic + OpenAI keys both VALID** (verified via free /v1/models calls). `AUTH_SECRET`/`AUTH_URL` set; integrations JSearch/CareerOneStop/R2/`DOCUMENT_ENCRYPTION_KEY` all set; Twilio keys set, messaging service pending (A2P).
- **Cutover action items it surfaced:** (1) seed the **sentinel org** `00000000-...` (else consent/access-code audit events silently fail), (2) seed an **admin** user, (3) seed **access codes** (with `partner_user_id`) + a sharing client for the partner demo, (4) ensure **`MOCK_AI` is OFF in prod** (it's on locally by design).

**W9 verified-employer board -- DONE (real data imported).** Source of truth = the SMR Employers Airtable (base `appiBoJpK5Q7DgkDU`, tables Employers / Network Partners / People Leads). Access: `AIRTABLE_API_KEY` (PAT) + `AIRTABLE_SMR_EMPLOYERS_BASE_ID` in `apps/consumer/.env.local` (the connector/MCP does NOT have this base; only the PAT does). The MCP `claude_ai_Airtable` integration only sees the JFW "Volunteers Workflow" base.
- Migration 018 `employer` table; `core/employer.ts` (listPublishedEmployers = job-seeker fields only, deduped by name, ranked; getEmployerStats; upsertEmployer); `scripts/import-employers.ts` (REST pull, key from `.env.local`, idempotent on Airtable record id, publishes Board Fit Excellent/Good only); `/api/employers` + `/dashboard/employers` page + nav.
- Ran against the new universe: 67 imported, 18 distinct published. Re-run anytime: `npx tsx packages/core/scripts/import-employers.ts`. **Source-data flag for Troy:** the Airtable has ~8+ employers entered twice -- worth deduping there (the board dedupes by name defensively).
- Remaining employer polish: admin publish-toggle UI (currently publish is set by the importer from Board Fit); "Best Matches Today" tie-in to the job board.

**W10 OSS prep -- partly DONE (committed local, NOT pushed).** For the Aug 15 public repo: **secret scan is CLEAN** (`.env.local` never committed, only `.env.example` placeholders tracked, 0 secret-pattern matches across all git history, `.gitignore` covers `.env*`/`.vercel`). Added verbatim **AGPL-3.0 LICENSE** (curl'd from gnu.org), `package.json` `license: AGPL-3.0-or-later`, a rewritten public **README** (the old one referenced the retired `apps/web`), **SECURITY.md** (private disclosure), **CONTRIBUTING.md** (language/privacy/no-legal-advice guardrails). Copyright line = "The Midnight Garden LLC" -- **confirm the legal entity**. Remaining W10: **Playwright smoke pass** (none exist; needs a running target + `npx playwright install` -- best done where a dev server/preview is reachable) and **PWA** (manifest + service worker + icons). Demo mode itself already exists (Forge walkthrough + seeded demo account).

**Deploy reality discovered this session (important):** the Vercel project `the-crucible` (team troy-carrs-projects) is **git-connected -- a push to `main` auto-deploys production** (forge/refinery.steelmanresumes.com). Prod was 32 commits behind (still `c0955e1`), so pushing `main` blind would have shipped two unverified sessions at once against the old env. Held it. Troy chose the **new-universe cutover** (new Neon + keys + accounts) and applied the new env, then **redeployed prod 3x of the OLD code (`c0955e1`)** to make the env take effect -- so prod currently runs old code on the new (empty) env; our new code is NOT in prod yet. All 32 commits are backed up on branch `session/journey-instrumentation-2026-06-07` (+ an empty `ci:` commit that triggered a fresh preview to pick up the new Preview env -- squash on merge). Preview env: Troy set full `.env`, then removed `AUTH_URL` from Preview (correct -- the app builds reset links from `request.url`; Auth.js trusts the host on Vercel via `VERCEL=1`). `AUTH_CHECK_SECRET` is NOT set, so `/api/auth-check` (the safe health readout) can't be used until Troy adds it to `.env.local` + Vercel.

**Pattern reinforced:** treat the handoff as a hypothesis, not a spec -- it flagged Stage 3 + Stage 5 but missed that Stage 4 also blocks (and blocks *earlier*), missed Stage 6's cache-invalidation gap, and missed the on-screen privacy-copy conflict. **WSL2 note:** `tsx` here transpiles to CJS -- verify scripts need an async IIFE (no top-level await) + `process.cwd()`-relative paths (no `import.meta.url`); load `DATABASE_URL` inside the script from `.env.local` so no secret hits the shell. The Windows `vercel` binary on PATH hangs from WSL -- deploys happen via git push (preview = any branch, prod = `main`).

---

## 2026-06-07 -- Opus 4.8: Master Plan Assessment + Phase 0/1 Backbone

**Assessment artifacts (in ~/todash/smr/):** `SMR-OPUS-ASSESSMENT-AND-BUILD-DESIGN-2026-06-07.md`, `SMR-API-KEY-MASTERCLASS-2026-06-07.md`. Troy approved: slow/steady build to a fully complete platform; Anthropic-primary + OpenAI fallback; Opus direct + bounded agents.

**Critical plan/reality reconciliations (verified against live repo + OpenAI docs):**
- **Voice Section 9.1 is STALE -- do NOT "fix" it.** Deployed code uses `gpt-realtime-2` + `/v1/realtime/client_secrets` + `/v1/realtime/calls` + voice `marin`, all VERIFIED CORRECT against current OpenAI docs. The plan's instruction to revert would break working voice. Real work = QA behind a flag, not a rewrite.
- **Table name:** real table is `job_application` (singular). Plan's migration 019 `job_applications` would orphan. All new migrations target `users` (plural, canonical per 008) and `job_application`.
- **Storage is Cloudflare R2**, not Vercel Blob. Vault uses R2 + a dedicated `DOCUMENT_ENCRYPTION_KEY` (NOT AUTH_SECRET).
- **Existing structures the plan would duplicate:** `job_application.follow_up_at`+`notes` (use these, not new `follow_up_date`); `refinery_artifact`+`file_object` (the vault; don't create parallel `user_documents`); `consumer_consent` layered consent (richer than `partner_progress_visible` bool). Reconcile, don't bolt on.
- **AI shim** `lib/ai-call.ts` currently routes ALL to OpenAI gpt-4o (temp). Switch to Anthropic-primary at this single point when key is live.
- **Coach must consolidate** the existing `/api/assistant` surface, not become a 5th chatbot.

**Phase 0 done (committed locally, NOT pushed):** Codex's 24 modified + 6 new files committed in 8 atomic groups (415b113..15aa455). gitignore: swap files. Fresh `.env.local` template written (Tier 0/1/2/3, every var + where to get it); old values backed up to `apps/consumer/.env.backup-2026-06-07.local` (gitignored).

**Phase 1 backbone done (committed local 332ee63, tsc clean, NOT pushed):**
- `packages/core/migrations/016_onboarding_coach.sql` -- onboarding + coach columns on `users` + `coach_conversation`. (Plan called this 018; renumbered 016 -- runner applies *.sql lexically.) **APPLIED + VERIFIED 2026-06-07** against the fresh dedicated Neon: all 17 migrations ran clean; confirmed 10 new `users` columns + `coach_conversation` table + 9 coach constraints. 36 public tables total.
- `packages/core/src/getUserProfile.ts` -- backbone profile reader over existing tables (no dup). Contract includes calendar/SMS fields with safe defaults until those migrations land.
- `packages/core/src/computeNextStep.ts` -- deterministic rules ladder + 1h cache (`getNextStep`) + `invalidateNextStep`.

**Phase 1 W2 -- Journey shell DONE + verified (committed local, NOT pushed):**
- `GET /api/next-step` -> getNextStep(); `JourneyHeader` fetches once, renders the 7-stage progress bar + the "your next step" card. Additive to the client dashboard (partner/observer/profile-setup untouched). Verified end-to-end against the live DB (fresh user -> "Build your foundation"; forge-done -> "Find your first target job"; cache persisted).
- `GET/POST /api/onboarding/tour` + `GuidedTour` (3 screens: promise, journey map, name-your-coach). DB-persisted, 2 deferrals then mandatory, mounted in the dashboard layout, client-tier only. Verified: defer increments, complete persists + names coach + invalidates next-step cache.
- Env: all Tier 0/1 keys provisioned by Troy into a fresh Steel-Man-only Neon + accounts (Anthropic, OpenAI, Resend, JSearch, R2, Perplexity, DOCUMENT_ENCRYPTION_KEY). `CAREERONESTOP_USER_ID` still blank (needs the DOL User ID alongside the token). Twilio blank (A2P pending).

**Phase 1 W3 (core) + W4 backend DONE + verified (committed local, NOT pushed):**
- W3: public "Second Chance" -> "Fair-Chance Lanes" everywhere (nav, tool cards, board heading, partner view, access, dev toolbar); jobs<->lanes cross-link added. Internal module names (second-chance-board.ts etc.) deferred per Codex. Deeper unified-board merge + CareerOneStop fallback still pending (CareerOneStop needs `CAREERONESTOP_USER_ID`).
- W4 coach -- BACKEND + UI + SETTINGS done: `buildCoachSystemPrompt(profile)` (Section 5, style/length/focus-aware), `coach_conversation` persistence, `/api/coach` (POST streams claude-sonnet-4-6 via AI SDK in the useChat `{messages}` shape; GET hydrates history; rate-limited, logged, persists each turn). **Wired into the Refinery chat drawer** via a `coach` flag through useAssistant->AssistantChat->dashboard layout (t.ROY stays on Forge/public). **Settings "Your Coach"** controls live (`/api/coach/settings` + CoachSettingsSection: name/style/length/focus/creativity). Verified: prompt embeds full profile + history round-trips against live DB; all routes 401 unauth on the running dev server; tsc clean throughout. PENDING: real browser QA of the streamed coach reply (makes a live Anthropic call), proactive triggers, context_digest for >50 msgs.
- A local dev server has been run for QA (`npm run dev -w apps/consumer`, port 3002) against the new DB/keys. Vercel CLI hangs from WSL -- a real preview deploy must run from Troy's Windows terminal (push Tier-0 keys to Vercel preview scope first).

**Instrumentation backlog (computeNextStep gates that have NO server data source yet):**
- `job_application.resume_artifact_id` is never set -> Stage 3 gate ("resume tailored to target") can't advance. Wire the resume-builder to link the tailored resume to the saved job.
- Interview practice is **localStorage-only** (`consumer_progress` key) -> Stage 5 gate reads 0. Wire the interview tool to persist an `interview_prep` artifact on session completion.
- Disclosure plans persist only if a tool calls `/api/artifacts` -- confirm the disclosure tool does.
These are small, bounded, and are the real spine of the "intelligence engine."

**Next:** apply migration 016 against the new DB, verify backbone with real data, then stage nav + next-step card.

---

## 2026-06-06 -- CC Planning Session: Master Plan Locked

---

## 2026-06-06 -- Codex Handoff: Refinery Live Prep + Auth Recovery

**Author:** Codex, OpenAI GPT-5 coding agent.

Detailed handoff: `docs/CODEX-HANDOFF-REFINERY-2026-06-06.md`
Inspection summary: `docs/REFINERY-LIVE-READINESS-SUMMARY-2026-06-06.md`

### What Codex changed
- Replaced the old `/dashboard/resources` resource hub UI with a Second Chance Job Board.
- Added curated fair-chance opportunity lanes in `apps/consumer/lib/second-chance-board.ts`.
- Added OpenAI Realtime voice practice for interviews with server-minted ephemeral tokens at `/api/interview-voice/token`.
- Added a true password reset email flow:
  - `/forgot-password`
  - `/reset-password`
  - `/api/auth/reset-password/request`
  - `/api/auth/reset-password/confirm`
- Clarified login copy: magic links sign users in, password reset links change passwords.
- Added dev-only debug login controls:
  - Fresh Client Run
  - Client Login
  - Admin Login
  - Reset Local Flow Only
- Fixed dev toolbar provider bug (`dev-login`, not `credentials`).
- Added Forge output normalization for `career_paths` and legacy `careerPaths`.
- Tightened assistant override, artifact validation, download validation, CSP, and AI decision log model/provider drift.
- Ran non-force `npm audit fix`; lockfile changed.

### Verification
- `npm run build -w apps/consumer` passes.
- `npm run build -w services/worker` passes.
- `git diff --check` passes.
- Production deploy completed: `dpl_HZmm2i3kYVzttXrCxBfryakhvdLu`.
- Verified aliases include `https://refinery.steelmanresumes.com`.
- Smoke-tested `/forgot-password`, `/reset-password`, unauth dashboard redirect, and reset-request API.

### CC: continue from here
1. Verify production password reset email delivery on `https://refinery.steelmanresumes.com/forgot-password`.
2. Verify magic link delivery separately; it is passwordless sign-in, not reset.
3. Confirm production envs: `AUTH_RESEND_KEY`, `AUTH_EMAIL_FROM`, `AUTH_URL`.
4. Browser-test Realtime voice with a microphone.
5. Add voice cost/session guardrails.
6. Plan dependency migrations for remaining audit issues. Do not run `npm audit fix --force` casually.

---

## 2026-06-04 -- AI Switch + Dr. Baker Access (commits 807b47d, 49f68ec, 04c0c0e, 0b99bfe, 5463afc)

### AI Provider -- Anthropic → OpenAI (TEMPORARY)
All 8 consumer AI routes now use OpenAI gpt-4o via single shim at `apps/consumer/lib/ai-call.ts`.
**To revert when Anthropic bill paid:** edit only `lib/ai-call.ts` -- change endpoint to `api.anthropic.com/v1/messages`, swap `Authorization: Bearer` back to `x-api-key` + `anthropic-version` headers, change response extraction from `choices[0].message.content` back to `content[0].text`, change model from `gpt-4o` to `claude-sonnet-4-20250514`.

Worker generators (genResume, genSalary, etc. in services/worker) still use Anthropic directly -- not in the live Forge/Refinery web flow, deferred.

### Dr. Baker Pre-Authorization
- `apps/consumer/auth.ts` -- `PARTNER_PRE_AUTH` array contains `latonyabakergoe@gmail.com`. On sign-in, auto-elevates to `partner` tier + updates DB.
- `apps/consumer/app/(dashboard)/layout.tsx` -- `isNavUnlocked()` updated: `partner` tier bypasses onboarding state requirements (same as admin but without admin tool access). All Refinery tools visible immediately.
- `BAKER2026` code in Neon DB: partner tier, no expiry, no redemption limit -- for her staff/team.

### /access Landing Page
`apps/consumer/app/access/page.tsx` -- public page at `forge.steelmanresumes.com/access`.
Full orientation brief: confetti (stops + fades at 15s), Forge/Refinery philosophy, 6 Refinery tools, access details (pre-auth + BAKER2026 + partner tier), Jimmy Wallace sample resume (one-click clipboard copy), personal note, CTA → `forge.steelmanresumes.com/intro` (client entry).

### .env.example updated
`apps/consumer/.env.example` -- added `OPENAI_API_KEY=` documentation (was missing).

---

## SMR Website Overhaul -- 2026-05-31 (smr-website commit 8d3d926)

- **Migration 014** -- `inquiry` + `newsletter_subscriber` tables in Neon
- **`/api/forge/summary`** -- CORS-gated safe profile endpoint for steelmanresumes.com personalization
- **PersonalizedHero** -- homepage bar for authenticated users: headline, skills chips, matched guide links
- **PersonalizedGuide** -- guide pages strip `<!--if:-->` conditional blocks that don't match user's challenges/work_type
- **Newsletter** -- Neon + Resend welcome email; inline on homepage, end of every guide, footer compact
- **InquiryForm** -- role-aware (org/employer/funder/volunteer/researcher) → Neon + Resend notify Troy
- **3 new pages**: `/coming-home` (Mini Forge import entry), `/mini-forge` (DOC showcase), `/evidence` (6 research workstreams)
- **Footer**: crisis line (988/211), Resources nav column, newsletter compact
- **Unsubscribe**: token-based one-click at `/unsubscribe?token=`
- **Guide conditions**: all 9 guides have `conditions[]` in guides.ts; interview-scripts + employment-gaps have `<!--if:-->` section markers
- **Deploy fix documented**: smr-crucible must deploy from workspace root -- `@crucible/consumer-ui` is local-only, `.vercel/project.json` must exist at root (recreation JSON in HANDOFF)

### All three projects deployed READY
- steelmanresumes.com -- smr-website 8d3d926
- forge/refinery.steelmanresumes.com -- smr-crucible b2cb355
- consumer-blond.vercel.app -- same

---

## What Was Built This Session (commit bae9d26)

### The Mini Forge -- full build

- **DB migration `013_tablet_session.sql`** -- `tablet_session` table with UUID pk, 6-char unambiguous import code (no 0/O/1/I/l), bcrypt PIN hash, `forge_intake` JSONB, `forge_output` JSONB, `processing_status`, 18-month expiry. Both 012 and 013 applied to Neon.
- **`lib/tablet-session.ts`** -- session create/read/update/claim, PIN bcrypt helpers, cookie set/get.
- **`lib/mini-forge-ai.ts`** -- Haiku 4.5 pipeline. Condensed prompt at 5th grade reading level. `MOCK_AI=true` returns Jordan fixture instantly.
- **`app/(mini-forge)/layout.tsx`** -- minimal wrapper (no analytics scripts, no third-party JS, no nav, no AssistantDrawer). Wraps all 6 routes.
- **`app/(mini-forge)/mini-forge/page.tsx`** -- landing: auto-resumes session if cookie present, shows import flow intro.
- **`app/(mini-forge)/mini-forge/pin/page.tsx`** -- PIN setup with server action; creates `tablet_session`, sets `mf_session` cookie (httpOnly, path=/mini-forge).
- **`app/(mini-forge)/mini-forge/q/[step]/page.tsx`** -- 7 questions, one per page. Server actions save each answer to `forge_intake` JSONB. Step 7 races AI against 9-second timeout: if done → redirect to results; if slow → redirect to processing.
- **`app/(mini-forge)/mini-forge/processing/page.tsx`** -- shows import code prominently + `<meta refresh=15>`. Auto-redirects if status = ready.
- **`app/(mini-forge)/mini-forge/results/page.tsx`** -- career paths, skills, barrier resources, resume starter, import code shown twice.
- **`app/(mini-forge)/mini-forge/import/page.tsx`** -- enter code + PIN to claim session into Refinery. Marks `claimed_at`, redirects to `/sign-in?from=mini-forge`.

### Route conflict fix
Route group `(mini-forge)` needs `mini-forge/` subdirectory inside -- route groups don't add URL prefix. Files live at `app/(mini-forge)/mini-forge/*`, routes resolve to `/mini-forge/*`.

### MOCK_AI=true added to apps/consumer/.env.local

---

## What Was Built Last Session (commit 980bff1)

### Bug fixes
- **TIER_RANK auth regression** -- `"default"` tier was missing from both `withRateLimit.ts` and `dashboard/layout.tsx`. Regular users (no access code) were silently blocked from "client"-gated API endpoints and nav items. Fixed.
- **Job search cache** -- Cache hits returned empty `fair_chance_info`. Added column to `job_search_cache` table (migration `012_job_cache_fair_chance.sql`), stored on write, returned on hit.
- **Disclosure jurisdiction** -- `record.state` was always undefined. Now derives state from `forgeContext.location` for WI-specific §973.015 / Milwaukee ordinance guidance.

### Research upgrades (`apps/consumer/lib/research-context.ts`)
- Added Pager (2003/2007) structural barriers audit studies
- Added SHRM (2021) fair-chance employer outcomes (85% same/better, 31% lower turnover)
- Added Granovetter (1973) weak ties / institutional connections
- Expanded Giordano et al. (2002) four cognitive transformations in full operational detail
- Strengthened SDT autonomy-restoration framing

### Analysis pipeline (`apps/consumer/app/api/analyze/route.ts`)
- All `READINESS_DIRECTIVES` updated with Giordano hooks-for-change language
- New `hookNarrative` field wired through `ForgeSessionData` → analyze prompt context
- Jurisdiction extracted from preferences.location for WI-specific barrier analysis
- Barrier analysis prompts name structural reality (Pager) + navigation strategies

### Goals page (`apps/consumer/app/(forge)/goals/page.tsx`)
- Two new goal options: "Be my own boss someday" and "Give back to my community"
- Silent disabled button fixed -- helper text shown when nothing selected
- New optional hooks-for-change prompt: "What would make work feel like yours?"

### Audience-differentiated dashboard (`apps/consumer/app/(dashboard)/dashboard/page.tsx`)
- `tier === "partner"` → `PartnerDashboard` -- methodology review mode, tool-by-tool breakdown with research basis, bypass Forge gate
- `tier === "observer"` → `ObserverDashboard` -- five headline citations, evidence/methodology deep links, demo launch CTA
- Client + admin: unchanged

### Mock AI fixture system (`apps/consumer/lib/mock-ai.ts`)
- Set `MOCK_AI=true` in `.env.local` to skip all AI API calls
- Returns Jordan fixture data (warehouse associate, Milwaukee, felony, preparation stage)
- Wired into: analyze, job-search, disclosure-guide, resume-generate routes
- Zero cost dev testing -- documented in `.env.example`

### Pending DB migration
Run before next deploy:
```bash
npm run migrate -w packages/core
```
This applies `012_job_cache_fair_chance.sql` (adds `fair_chance_info` TEXT column to `job_search_cache`).

---

## The Mini Forge -- BUILT (commit bae9d26) -- Remaining Work

### What's left (commit 02fc457 resolves the first three)
- **Facility hint** -- add optional `facility_hint` field to the PIN page for DOC-configured tablet deployments.
- **smr-website landing section** -- steelmanresumes.com needs a "Already did The Mini Forge inside?" import entry point.

### What was wired in commit 02fc457
- **Processing page** now runs AI inline with `tryClaimProcessing` mutex lock. `maxDuration=60`. Meta refresh as fallback. No BullMQ required.
- **Import flow** fully wired: `/mini-forge/import` → `/login?callbackUrl=/mini-forge/import-complete` → `/mini-forge/import-complete` reads `mf_session` cookie post-auth, calls `saveForgeSession()` to seed Refinery, clears cookie, redirects to `/dashboard?welcome=mini-forge`.
- **Analytics** excluded from `/mini-forge/*` via `AnalyticsWrapper` client component (pathname check). Root layout clean.
- **Dashboard** shows `MiniForgeBanner` on `?welcome=mini-forge`.

## The Mini Forge -- Original Spec

**What it is:** A stripped-down version of The Forge that runs on prison tablets (JPay/Securus, GTL/ViaPath, Edovo) nationwide -- WI DOC first. Users complete career intake during their sentence. On release, they enter a 6-digit import code at steelmanresumes.com and their data loads directly into The Refinery.

**URL:** `steelmanresumes.com/mini-forge` (or `/mini` for short)  
**AI model:** Haiku 4.5 (claude-haiku-4-5-20251001) -- fastest, cheapest  
**Auth:** 4-digit PIN only, no email required

### Technical constraints (hard)
- Server-rendered pages -- no React SPA behavior, no client-side JS required
- No CDN assets -- all assets self-hosted on own domain
- No outbound links anywhere
- No third-party scripts
- Works on 360px wide viewport minimum (7" tablet)
- Touch targets minimum 44px
- Page load under 3 seconds on 500kbps
- No streaming AI -- deferred processing (async via BullMQ worker)

### DB migration needed (013)
```sql
CREATE TABLE tablet_session (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  import_code TEXT NOT NULL UNIQUE,        -- 6-char alphanumeric, user-readable
  pin_hash TEXT NOT NULL,                  -- bcrypt hash of 4-digit PIN
  forge_intake JSONB NOT NULL,             -- raw intake answers
  forge_output JSONB,                      -- AI output (null until processed)
  processing_status TEXT NOT NULL DEFAULT 'pending',  -- pending|processing|ready|claimed
  facility_hint TEXT,                      -- optional, for DOC reporting
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at TIMESTAMPTZ,
  claimed_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '18 months'
);

CREATE UNIQUE INDEX ON tablet_session(import_code);
CREATE INDEX ON tablet_session(processing_status, created_at);
```

### Import code format
6 alphanumeric chars, no ambiguous (0/O, 1/I/l): chars from `[2-9A-HJ-NP-Z]{6}`  
Example: `A7B3KM`. User writes this down. Stored server-side 18 months.

### Route structure (inside apps/consumer)
```
app/(mini-forge)/
  layout.tsx        -- minimal layout, no nav, no AssistantDrawer, no analytics scripts
  page.tsx          -- landing: "The Mini Forge. Start here." + Start button
  pin/page.tsx      -- 4-digit PIN setup (create new) or entry (returning)
  q/[step]/page.tsx -- 7 intake questions, one per page, server-rendered
  processing/page.tsx -- "We're working on your results. Check back soon." (no JS polling)
  results/page.tsx  -- career paths, skills, import code displayed large
  import/page.tsx   -- "Already completed The Mini Forge? Enter your code to continue."
```

### The 7 questions
| Step | Question | Input |
|------|----------|-------|
| 1 | Where are you at right now? | Radio -- 4 SoC options |
| 2 | What do you want from work? | Checkbox -- 6 goal options |
| 3 | What's in your way? | Checkbox -- same challenge options as Forge |
| 4 | What kind of work fits you? | Radio -- physical/office/flexible/mixed |
| 5 | What are you good at? | Checkbox (skills list) + one free-text |
| 6 | Where will you be looking for work? | Text (city, state) |
| 7 | What would make work feel like yours? | Textarea (hooks-for-change prompt) |

### AI processing (Haiku)
- Triggered on form submit via BullMQ job (existing crucible-pipeline queue)
- Same pipeline structure as analyze route but condensed
- Output: 2-3 career paths, skill list, barrier resources, plain-text resume starter
- Stored in `tablet_session.forge_output`
- If processing finishes fast (< 10s): redirect to results immediately
- If slow: show processing page with "Come back tomorrow, your code is [XXXXXX]"

### Import to Refinery flow
```
/mini-forge/import → enter 6-digit code + PIN → validate tablet_session
  → if claimed: "This code has already been used"
  → if valid: create/link Refinery account via Auth.js
             copy forge_output to consumer_profile
             set tablet_session.claimed_at
             redirect to /dashboard with welcome message:
             "Welcome. You started this inside. Here's where you keep going."
```

### Content rules (tablet-specific)
- No external links -- crisis resources as text only: "Call 211 from any phone"
- Phone numbers as plain text, not tel: links
- Reading level: 5th grade (lower than standard Forge)
- No images except SMR wordmark (keep total page under 50kb)
- Session PIN: no email, no social login, nothing requiring outside accounts

### Implementation order
1. DB migration (013_tablet_session.sql)
2. Layout + landing page + PIN setup
3. 7-question intake (q/[step] dynamic route, server actions)
4. BullMQ job handler for Mini Forge processing (reuse analyze pipeline)
5. Results page + import code display
6. Import flow (code + PIN → Refinery link)
7. Performance audit (bundle size, load time on throttled connection)
8. Accessibility pass (WCAG 2.1 AA required for DOC submission)

### Whitelisting strategy
- **PPP (Abbe):** Primary pilot partner. Formal PPP partnership accelerates WI DOC approval.
- **Edovo:** `partnerships@edovo.com` -- content partner program, 15+ state footprint. Pitch as SMR content integration.
- **Submission name for DOC:** "Steel Man Pre-Release Career Tool" (The Mini Forge is what users call it)
- Required docs: privacy policy, accessibility statement, content description, technical specs

---

## Personalized SMR Website -- Future Session

Troy's idea: after Forge + Refinery, the smr-website transforms to show personalized content based on what we know about the user.

**Architecture (when ready to build):**
1. Consumer app sets auth cookie on `.steelmanresumes.com` parent domain (one config change in auth.ts)
2. smr-website reads cookie server-side on page load
3. Calls new endpoint `/api/forge/summary` in consumer app (returns safe public profile: headline, top skills, career paths -- NO sensitive data)
4. Next.js renders personalized homepage, guide recommendations, next-step CTA

**What personalizes:**
- Homepage hero: "Welcome back. 9 skills identified, 3 career paths mapped."
- Guide recommendations: Criminal record → "How to Write a Resume with a Felony." Warehouse → "Warehouse & Distribution Resumes." Shows 2-3 most relevant.
- The Forge section: shows their actual headline + top career path as live preview
- Next step CTA: knows which Refinery tool they haven't touched

**Status:** Spec'd, not started. Build after Mini Forge.

---

## Current Deployment State

| App | URL | Status |
|-----|-----|--------|
| Consumer (Forge + Refinery) | consumer-blond.vercel.app | Live at forge/refinery.steelmanresumes.com |
| SMR Website | steelmanresumes.com | Live, separate repo (smr-website) |

**CRITICAL: deploy from workspace root, not apps/consumer/**

```bash
cd ~/repos/smr-crucible   # workspace root
vercel --prod --yes
```

The `vercel.json` is at the workspace root. Deploying from `apps/consumer/` causes E404 on `@crucible/consumer-ui` (local workspace package not on npm). The `.vercel/project.json` must exist at the workspace root -- it is gitignored, recreate if missing:

```json
{"projectId":"prj_Y05eliHgrKIr4Y0TcCgvG8VATwZH","orgId":"team_XmJN97KS4xaZdLom6qF8R6ys","projectName":"consumer"}
```

MOCK_AI=true in apps/consumer/.env.local for zero-cost dev testing.

---

## Key Files for Next Session
```
apps/consumer/app/(mini-forge)/          -- CREATE THIS (doesn't exist yet)
packages/core/migrations/013_tablet_session.sql  -- CREATE THIS
apps/consumer/lib/mock-ai.ts             -- Jordan fixture data (reference for Mini Forge fixtures)
~/todash/tmg/FORGE-LITE-TABLET-SPEC-2026-05-31.md  -- full original spec
apps/consumer/app/(forge)/              -- reference for Mini Forge question pages
apps/consumer/app/api/analyze/route.ts  -- reference for Mini Forge AI processing
```

---

## Context Files
- Full ecosystem: `~/todash/COMMAND-CENTER.md`
- SMR brand + product vision: `~/todash/brand/`
- PPP partnership (Abbe): `~/todash/clients/peaceful-prisons-project/`
- Dr. Baker (MKE Reentry Hub): `~/todash/` memory index
