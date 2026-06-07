# SMR Crucible -- Handoff
**Last updated:** 2026-06-07
**Last session (Opus 4.8):** Assessment of the master plan + Phase 0 stabilize + Phase 1 intelligence backbone. See the 2026-06-07 section below.
**Next session:** Phase 1 W2 (journey shell + guided tour) is **DONE + verified**. Next options: W3 (fair-chance job board -- rename "Second Chance" public copy, merge lanes into jobs, CareerOneStop fallback) or W4 (AI coach -- consolidate the existing `/api/assistant` surface, profile-aware via getUserProfile). DB schema live on the fresh dedicated Neon. All work is local commits -- do NOT push/deploy until password-reset email delivery is verified with the new Resend key (Twilio A2P pending ~2 days, non-blocking).

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
