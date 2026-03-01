# CRUCIBLE

## What This Is
AI-assisted career services platform. Replaces smr-forge and smr-refinery with unified persistent architecture. Produces a complete career services package — resume, cover letters, employer battle plan, interview prep, salary negotiation sheet, portfolio, and more — from a single resume upload.

## Architecture
- apps/web: Next.js 14 App Router, deployed to Vercel (B2B career services platform)
- apps/consumer: Next.js 14 App Router, deployed to Vercel as "smr-app" (consumer-facing Forge + Refinery + Ghost)
- services/worker: BullMQ job consumer, runs in Docker on VPS (76.13.98.230)
- packages/core: Shared TypeScript types, event definitions, schema validators, DB/storage/event utilities, rate limiting, access codes
- packages/consumer-ui: Shared React components for consumer app (CardSelect, AssistantDrawer, ProgressRing, etc.)

## Tech Stack
- Database: PostgreSQL on Neon (connection string in DATABASE_URL)
- Object Storage: Cloudflare R2 (S3-compatible, credentials in R2_* env vars)
- Queue: Redis + BullMQ (REDIS_URL env var)
- Auth: Auth.js v5 with Resend email magic link + dev-mode Credentials bypass
- Payments: Stripe (future phase)
- AI: Anthropic Claude Sonnet (narrative generation), OpenAI GPT-4o-mini (structured extraction), Perplexity (enrichment)
- Job Data: JSearch via RapidAPI (JSEARCH_API_KEY)

## Key Principles
1. All canonical state in Postgres. Browser state is cache only.
2. Every significant action emits a structured event to the event table.
3. Heavy compute runs on the worker, never in Vercel serverless functions.
4. Files stored in R2, never in the database. DB stores metadata + pointers.
5. AI responses are validated before storage. No trusting raw output.
6. Human review gates before artifacts reach downloadable status.
7. Config (prompts, options, output defs) stored as versioned immutable JSON.

## Current State (as of 2026-02-28)

### What Works
- **v1 pipeline (career_intake_v1)**: 4-step sequential pipeline. Extract → Parse → Analyze → Generate. Produces a single DOCX resume. Fully functional end-to-end.
- **v2 pipeline (career_intake_v2)**: 10-step Stage A pipeline + 13 parallel Stage B artifact generators + Stage C assembly. Produces a full career package from a single resume upload. Tested end-to-end with real resume (Nicholas Vicich).
- **First real test results (v2)**: 10 of 13 artifacts generated successfully on first run. Cover letters targeted real employers (McDonald's, Wendy's, Texas Roadhouse) found via JSearch. Alloy Report correctly triggered for employment gap barrier.
- **Auth**: Magic link via Resend (prod) + Credentials bypass (dev). Dev login auto-creates users.
- **Upload + Storage**: File upload to R2, signed URL generation, artifact download all working.
- **Dashboard**: Shows pipeline progress, artifact list with download buttons, activity timeline. Auto-loads latest run on page load.

### What's Been Fixed (lessons from real-world testing)
- **JSON control characters**: AI models emit literal newlines/tabs inside JSON string values. `sanitizeJsonStrings()` in jsonParser.ts now escapes them before `JSON.parse`. This was the #1 cause of generator failures.
- **Stage C partial completion**: Stage C now counts both completed AND failed artifacts toward the expected total. Previously, if any generator failed, Stage C would never fire (stuck forever at N/expected).
- **Artifact failure recording**: When a generator job fails, the worker now inserts a placeholder artifact with `review_status: 'generation_failed'` so Stage C knows the job is resolved.
- **BullMQ job replay idempotency**: Worker restarts cause BullMQ to replay completed jobs. `processArtifactJob` now checks if the artifact already exists before running the generator (avoids duplicate key errors AND wasted AI API calls).
- **Archiver race condition**: ZIP archive event listeners (`on('end')`) must be attached BEFORE calling `archive.finalize()`, otherwise the 'end' event fires before the listener is registered.
- **ZIP generation non-fatal**: If ZIP creation fails, Stage C still proceeds — artifacts are individually downloadable.

### Known Issues / Not Yet Fixed
- **3 generators still fragile**: `gen_employers` (large prompts, 32K+ char responses), `gen_actionplan`, and `gen_salary` still occasionally fail on JSON parse even with the repair pipeline. The control character fix should help significantly but hasn't been re-tested yet.
- **Perplexity contact enrichment**: JSON parse failures on enrichment responses (bad control chars in addresses/URLs). Non-fatal — pipeline continues without enrichment data.
- **No user intake form**: The full package works from just a resume (extracts location, target roles, barriers from text), but output quality would be dramatically better with explicit user input for: target city, dream roles, salary goals, barriers to disclose. This is Phase 4.
- **Dashboard UX is minimal**: No manifest-driven artifact sections, no portfolio preview, no customization panel. Currently just a flat list of artifacts with download buttons.
- **Next.js dev cache corruption**: The `.next` cache can get corrupted (especially the `@auth.js` vendor chunk). Fix: `rm -rf apps/web/.next` and restart. This is a dev-only issue.

## Database
Neon Postgres. Migrations in packages/core/migrations/ as sequential numbered SQL files.
Run migrations: npm run migrate -w packages/core

### Migrations
| File | Description |
|------|-------------|
| 001_foundation.sql | org, user, membership, subject, project, file_object, document, event, consent_record |
| 002_auth_tables.sql | Auth.js required tables (account, session, verification_token) |
| 002_pipeline.sql | workflow_run, run_step, artifact (with UNIQUE on run_id+artifact_type+version) |
| 003_phase3.sql | run_data, bundle, artifact extensions (artifact_key, bundle_id, display_title, etc.) |
| 004_artifact_failures.sql | artifact.file_object_id nullable, review_status adds 'generation_failed' |
| 005_consent.sql | consent_record, consent_event tables for participant consent tracking |
| 005_consumer.sql | consumer_profile, forge_session, decision_log, refinery_artifact, data_access_log tables for consumer app |
| 006_access_control.sql | access_code, ai_usage, access_code_redemption tables for rate limiting + partner codes |

## Core Utilities (packages/core/src/)
- db.ts: query(), getOne(), insert() — thin wrappers around @neondatabase/serverless
- events.ts: emitEvent(), emitStepEvent(), emitAICallEvent() — structured event logging
- storage.ts: uploadFile(), getSignedUrl(), createFileObject() — R2 via S3 SDK
- types.ts: All TypeScript types, event type unions, CrucibleEvent interface (includes ACCESS_CODE_CREATED, ACCESS_CODE_REDEEMED, RATE_LIMIT_EXCEEDED)
- pipeline.ts: PipelineDef, StepContext, StepHandler types + runPipeline() generic runner
- jsonParser.ts: extractAndParseJSON(), sanitizeJsonStrings(), parseWithRepair() — robust AI JSON handling
- runData.ts: putRunData(), getRunData(), hasRunData(), listRunData() — typed write-once data products
- consent.ts: recordConsent(), getConsent() — participant consent tracking
- decision.ts: recordDecision() — decision audit trail
- rateLimit.ts: checkUserRateLimit(), checkIpRateLimit(), incrementUserUsage(), incrementIpUsage(), getUserDailyLimit() — per-user/IP daily rate limiting with atomic upserts
- accessCode.ts: createAccessCode(), validateAccessCode(), redeemAccessCode(), getUserAccessCodes() — partner access code management
- forgeSession.ts: saveForgeSession(), loadForgeProfile() — Forge data persistence (upsert to consumer_profile + forge_session tables)

## Pipeline Framework
Generic pipeline runner that executes step definitions in sequence:
- PipelineDef: key, version, steps[] (each with key, critical, maxRetries, timeoutMs)
- StepHandler: (ctx, input) => output. Each step receives previous step's output.
- runPipeline(): Creates run_step records, handles retries, emits events, manages failure.
- Critical steps abort pipeline on failure. Optional steps skip and continue.

### career_intake_v1 Pipeline
Steps: extract → parse → analyze → generate
1. extract: Pull text from uploaded docs (PDF via pdf-parse, DOCX via mammoth, OCR via tesseract.js)
2. parse: GPT-4o-mini structured resume parsing with confidence scoring
3. analyze: Parallel AI analysis — Claude (narrative + strategy) + GPT (skills/ATS)
4. generate: Resume DOCX artifact via docx package, stored in R2, artifact record created

### career_intake_v2 Pipeline (Three-Stage Architecture)

```
STAGE A: CORE (sequential)          STAGE B: GENERATE (parallel)         STAGE C: ASSEMBLE
─────────────────────────           ─────────────────────────────        ──────────────────
1. extract_resume_text              Fan-out: each artifact is an         1. update_manifest
2. parse_profile                    independent BullMQ job consuming     2. generate_zip
3. compute_signals                  frozen research snapshots            3. set bundle status
4. research_jobs (JSearch)                                                  → awaiting_review
5. build_employer_tiers             ┌─ resume_docx
6. enrich_contacts (Perplexity)     ├─ coverletter_bold
7. market_salary                    ├─ coverletter_friendly
8. local_resources (conditional)    ├─ coverletter_professional
9. plan_package → RunPlan           ├─ employers_battleplan
10. init_bundle                     ├─ action_plan_30day
                                    ├─ alloy_report (conditional)
                                    ├─ interview_prep
                                    ├─ salary_negotiation
                                    ├─ portfolio_html
                                    ├─ tracker_xlsx
                                    ├─ quickstart_guide
                                    └─ readme_toc
```

### Queue Architecture

Two separate BullMQ queues:
- `crucible-pipeline` (concurrency: 1) — Stage A pipeline processing, sequential
- `crucible-artifacts` (concurrency: 5) — Stage B artifact generation, parallel fan-out
- `crucible-jobs` — Legacy queue name, still listened on for backwards compatibility

Worker registers separate processors. Stage A completes → plan_package decides what to generate → init_bundle enqueues artifact jobs to crucible-artifacts. After each artifact job completes (or fails), the worker checks if all jobs are resolved and triggers Stage C.

### Worker Job Flow
1. Web app POSTs to /api/projects/[id]/run with `{ pipeline: "v1" | "v2" }` → creates workflow_run → enqueues to `crucible-pipeline`
2. Worker picks up job → looks up pipeline by key → calls runPipeline()
3. v1: Pipeline iterates steps → emits events → stores single artifact
4. v2: Stage A runs 10 steps → init_bundle enqueues 13 artifact jobs to `crucible-artifacts` → Stage B generators run in parallel → each completion triggers Stage C check → when all resolved, Stage C assembles manifest + ZIP + sets bundle to awaiting_review
5. UI polls GET /api/runs/[id] every 2s for progress → shows step cards + artifacts

### Frozen Snapshot Rule (CRITICAL)

Once a data product is written to `run_data`, it is immutable for that run. All downstream steps and artifact generators consume the same snapshot. If enrichment data needs updating, create a new key version (e.g. `employers.v2`). `putRunData()` is write-once — errors if key already exists.

This is what makes the package cohesive: the cover letter references the same employer the Battle Plan describes. The 30-day plan directs the user to the same resources the Alloy Report details. One truth, many presentations.

### Data Products (run_data keys)

| Key | Producer Step | Description |
|-----|--------------|-------------|
| profile.v1 | parse_profile | Normalized user profile — name, contact, work_history[], education[], certs[], military |
| signals.v1 | compute_signals | Derived features — industry, seniority, years_exp, barriers{}, ats_score, skills, target_roles |
| jobs.v1 | research_jobs | Raw + normalized job listings from JSearch — jobs[], query_used, fetched_at |
| employers.v1 | build_employer_tiers | Tiered employer list — tier1[] (full profile), tier2[] (mid), tier3[] (basic) |
| employers_enriched.v1 | enrich_contacts | Merged employer data + Tier 1 contact enrichment from Perplexity |
| market.v1 | market_salary | Salary intelligence — ranges, sources, confidence, negotiation leverage |
| resources.v1 | local_resources | Local support resources (conditional on barriers) |
| portfolio_prefs.v1 | (user input) | User customization — theme, accent_color, tagline_style, sections_enabled |
| runplan.v1 | plan_package | Artifact generation plan — tasks[], conditional_exclusions[] |
| artifact_manifest.v1 | init_bundle / update_manifest | Bundle TOC — sections[], artifacts[], statuses |

### Stage B Artifact Generators

All generators in `services/worker/src/generators/`. Each receives `{ runId, bundleId, orgId, projectId, artifactKey, params }` and consumes frozen run_data.

| Artifact Key | Generator File | Output Format | AI Model | Status |
|-------------|---------------|---------------|----------|--------|
| resume_docx | genResume.ts | DOCX | Claude Sonnet | Working |
| coverletter_bold | genCoverLetter.ts | DOCX | Claude Sonnet | Working |
| coverletter_friendly | genCoverLetter.ts | DOCX | Claude Sonnet | Working |
| coverletter_professional | genCoverLetter.ts | DOCX | Claude Sonnet | Working |
| employers_battleplan | genEmployers.ts | DOCX | Claude Sonnet | Fragile (large JSON) |
| action_plan_30day | genActionPlan.ts | DOCX | Claude Sonnet | Fragile (JSON parse) |
| alloy_report | genAlloy.ts | DOCX | Claude Sonnet | Working (conditional) |
| interview_prep | genInterview.ts | DOCX | Claude Sonnet | Working |
| salary_negotiation | genSalary.ts | DOCX | Claude Sonnet | Fragile (JSON parse) |
| portfolio_html | genPortfolio.ts | HTML | Claude Sonnet | Working |
| tracker_xlsx | genTracker.ts | XLSX | Template + data | Working |
| quickstart_guide | genQuickstart.ts | DOCX | Claude Sonnet | Working |
| readme_toc | genReadme.ts | TXT | Template | Working |

"Fragile" = has failed on real data due to JSON issues. Control character sanitization fix (2026-02-20) should resolve these but needs re-testing.

### JSON Robustness Stack

AI-generated JSON goes through multiple repair layers:
1. `extractAndParseJSON()` in core — strips markdown fences, smart quotes, trailing commas, comments; then `sanitizeJsonStrings()` escapes control characters inside string literals
2. `parseWithRepair()` in core — wraps above with a repair callback; on failure, calls the callback (typically another AI model) to fix the JSON, then retries
3. `parseAIJson()` in `repairJson.ts` — worker-side wrapper that uses Claude Sonnet as the repair model
4. Generator-level `parseWithRepair` — genEmployers.ts has its own inline repair (it was built before the shared helper)

Common AI JSON failure modes encountered:
- **Bad control characters** (most common): Literal `\n`, `\t`, `\r` inside JSON string values instead of `\\n`, `\\t`, `\\r`. Fixed by `sanitizeJsonStrings()`.
- **Unescaped quotes**: AI puts `"he said "hello""` inside a JSON string. Partially handled by brace matching.
- **Truncated output**: AI hits max_tokens and the JSON is cut off mid-object. Repair model can sometimes close brackets.
- **Markdown wrapping**: AI wraps JSON in ` ```json ``` ` fences. Stripped by `extractAndParseJSON`.

### Stage C Assembly

Triggered automatically after each artifact job completes or fails. `runStageC(bundleId)` in `stageC.ts`:

1. **Guard**: Skip if bundle status is not 'building' (prevents double-execution)
2. **Check completion**: Count completed artifacts (have `file_object_id`) + failed artifacts (`review_status = 'generation_failed'`). Compare to expected count from `runplan.v1`. Return null if not all resolved.
3. **Update manifest**: Group artifacts by `display_section`, generate signed download URLs, write manifest JSON to bundle record
4. **Generate ZIP** (non-fatal): Download all artifact files from R2, bundle into ZIP, upload ZIP to R2, store `zip_file_object_id` on bundle
5. **Set status**: Bundle → 'awaiting_review', emit RUN_COMPLETED event

### Idempotency Pattern

BullMQ can replay jobs after worker restart. The worker has guards:
- `processArtifactJob`: Checks `SELECT id FROM artifact WHERE run_id = $1 AND artifact_type = $2 AND version = 1` before running generator. Skips if exists.
- `failed` handler: Catches duplicate key errors silently when recording failed artifacts.

## API Routes (apps/web)
All routes require auth. Org resolved from authenticated user's membership.
- POST /api/orgs — Create org + admin membership
- GET /api/projects — List projects for user's org
- POST /api/projects — Create project (auto-creates subject)
- GET /api/projects/[id] — Project detail with documents, recent events, latestRun
- POST /api/projects/[id]/upload — Multipart file upload to R2
- POST /api/projects/[id]/run — Start pipeline run. Body: `{ pipeline: "v1" | "v2" }`, defaults to v2
- GET /api/projects/[id]/documents — List documents with signed URLs
- GET /api/projects/[id]/events — Activity timeline (last 50 events)
- GET /api/runs/[id] — Run status + steps + recent events
- GET /api/runs/[id]/artifacts — Artifacts with signed download URLs, display_title, display_section, order_index
- POST /api/runs/[id]/prefs — Write portfolio customization prefs to run_data
- POST /api/artifacts/[id]/review — Human review (approved/rejected)

## Auth Pattern
- auth.ts at web root configures Auth.js with Resend provider
- **Dev mode**: Credentials provider auto-creates users, JWT session strategy. No email needed.
- **Prod mode**: Resend magic link, database session strategy. Free Resend tier only sends to account owner email.
- middleware.ts protects /dashboard and /api (except /api/auth)
- lib/api-auth.ts: getAuthContext() resolves user + org from session
- Users without an org get 403 on project routes; must create org first

## Dashboard Pages
- /dashboard — Project list, new project creation, org onboarding
- /dashboard/[id] — Project detail with:
  - Pipeline version toggle (v1/v2)
  - File upload
  - "Run Analysis" button
  - Pipeline progress view (step cards with status badges, dynamic labels per pipeline version)
  - "Generating Artifacts..." progress indicator (Stage B)
  - Artifact list with download buttons (shows display_title)
  - Artifact review (approve/reject)
  - Activity timeline with human-readable events
  - Auto-loads latest run on page load (fetches latestRun from project API)
- /login — Dev login (gold button, no email) + magic link form
- /check-email — Post-login confirmation

## Environment Variables Required
### apps/web (.env.local)
- DATABASE_URL (Neon connection string)
- REDIS_URL
- AUTH_SECRET (Auth.js secret)
- AUTH_URL (app URL for magic link callbacks)
- AUTH_RESEND_KEY (Resend API key for magic link emails)
- R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_ENDPOINT, R2_BUCKET_NAME

### services/worker (.env)
- DATABASE_URL
- REDIS_URL
- R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_ENDPOINT, R2_BUCKET_NAME
- ANTHROPIC_API_KEY
- OPENAI_API_KEY
- PERPLEXITY_API_KEY
- JSEARCH_API_KEY (RapidAPI key for JSearch job discovery)

## Commands
- npm run dev -w apps/web          # Start web app dev server (port 3000)
- npm run dev -w services/worker   # Start worker in dev mode (uses --env-file=.env)
- npm run migrate -w packages/core # Run DB migrations
- npm run build -w packages/core   # Build core package (MUST run before worker build)
- npm run build -w apps/web        # Build web for production
- npm run build -w services/worker # Build worker for production

### Dev Tips
- If web app shows 404 on all pages: `rm -rf apps/web/.next` and restart (webpack cache corruption)
- Worker dev script uses `tsx watch --env-file=.env` — .env must exist in services/worker/
- Always build core before building worker (worker imports from @crucible/core)
- Resend free tier only sends magic links to account owner email. Use dev Credentials login for testing.

## Git
- Branch: main
- All commits on main
- No secrets in code — use .env.local for web, .env for worker

## Commit History
| Hash | Description |
|------|-------------|
| 873069e | Phase 0: Crucible foundation scaffold |
| 4cec42c | Phase 1: Project shell with auth, upload, and event logging |
| 314d721 | Fix auth: add pg-adapter, auth tables migration, Resend test sender |
| 38ad87f | Phase 2: Pipeline framework + career intake pipeline end-to-end |
| 3d79276 | Phase 3 architecture spec |
| b0395a9 | 003_phase3 migration |
| 347a03f | Zod schemas for all Phase 3 data products |
| 9c3b740 | RunData accessor API |
| d7b61ca | Enrichment provider abstraction + JSearch + Perplexity providers |
| dc044cf | Stage A careerIntakeV2 — 10-step core pipeline |
| 68d19b2 | Portfolio prefs POST endpoint |
| 02b508e | Phase 3B first three generators — employers, cover letters, alloy |
| 85a47d7 | gen_employers JSON resilience + anti-hallucination |
| 1197d00 | gen_coverletter barrier context conditional injection |
| 2b8ad0f | gen_resume refactored as standalone generator |
| eb67bd7 | gen_actionplan, gen_interview, gen_salary |
| 1c4783e | gen_portfolio standalone HTML generator |
| b600f4d | gen_tracker XLSX + gen_quickstart + gen_readme |
| 3d74b95 | Stage C assembly — manifest, ZIP, status transition |
| 95a7b4a | v2 end-to-end fix — JSON robustness, Stage C resilience, idempotency |
| bac8e98 | Consumer app: access control, rate limiting, Ghost assistant, 12 deliverables (73 files, ~9,500 lines) |
| 8db41cb | Opus 10x: Ghost→Opus rename, intro page, three audience paths, demo mode, JBS decision logging |
| 2a378ea | Psychic Opus, resume page fixes, Forge→DB persistence |

---

## Consumer App (apps/consumer) — "SMR App"

Consumer-facing web app combining Forge (free career analysis) + Refinery (authenticated dashboard with 7 tools) + Opus (AI assistant). Deployed to Vercel. **Live at `consumer-blond.vercel.app`.**

### Architecture
- Next.js 14 App Router with two route groups: `(forge)` and `(dashboard)`
- Auth: Auth.js v5 with Resend magic link (prod) + Credentials bypass (dev)
- AI: Anthropic Claude Sonnet via Vercel AI SDK (streaming)
- DB: Shared Neon Postgres via `@crucible/core`
- UI components: `@crucible/consumer-ui` package

### Route Groups
- `(forge)` — Free, no auth required. Pages: intro → welcome → resume → goals → story → preferences → processing → output. Also: `/partner` (methodology showcase), `/overview` (evidence showcase). IP-rate-limited.
- `(auth)` — Login page with email magic link + partner code field
- `(dashboard)` — Authenticated. Dashboard home + 7 Refinery tools (Resume Builder, Disclosure Planner, Interview Practice, Job Board, Resources, Progress, + Methodology, Evidence) + settings. User-rate-limited.

### Three Audience Paths (from /intro)
1. **Client** ("I'm rebuilding my career") → `/welcome` → full Forge flow with warm Opus guidance
2. **Partner** ("I'm from a partner organization") → `/partner` → methodology showcase with appetizer content → "Watch it work" → demo mode → deep content gated behind auth (`/dashboard/methodology`)
3. **Observer** ("I'm here to learn about this tool") → `/overview` → evidence showcase with appetizer content → "See it in action" → demo mode → deep content gated behind auth (`/dashboard/evidence`)

### Demo Mode
Triggered by `?demo=true` URL param. Pre-filled sample data ("Jordan" — warehouse associate, felony, Milwaukee WI). Opus narrates methodology at each step. No user input required.
- `lib/demo-data.ts` — Complete sample ForgeSession
- `isDemo` field in ForgeSessionData (`lib/forge-context.tsx`)
- Each Forge page shows pre-filled data (not editable) with methodology callouts
- Processing page skips API call, loads pre-generated output

### The Forge (Free Tool)
8-page conversational career analysis. No resume upload required (but accepts file/image upload). Produces career paths, skills mapping, barrier analysis, resource recommendations.
- Data stored in localStorage as `forge_session`
- Auto-synced to Postgres on first authenticated dashboard visit via `/api/forge/save`
- Dashboard loads from DB first, falls back to localStorage

### The Refinery (Dashboard Tools)
1. **Resume Builder** — AI-generated resume from Forge data
2. **Disclosure Planner** — Practice talking about criminal record with employers
3. **Interview Practice** — AI mock interviews with feedback
4. **Job Board** — Fair-chance employer search
5. **Resources** — Categorized support resources (housing, legal, etc.)
6. **Progress** — Track sessions, skills, resumes, applications
7. **Methodology** — Auth-gated deep methodology playbook (for partners)
8. **Evidence** — Auth-gated evidence deck (for observers/funders)

### Opus (AI Assistant)
Troy's voice as an AI companion. Named "Opus" — Troy's magnum opus, but really the user's masterpiece. Available on every page via AssistantDrawer ("Ask Opus" trigger).

**Key files:**
- `lib/assistant-prompt.ts` — 10 behavioral rules, research-grounded persona, depth-on-demand evidence mode, `buildPageContext()` for psychic page awareness, `AssistantContext` interface with 15+ fields
- `lib/research-context.ts` — Condensed citations from 6 research workstreams (Bandura, Maruna, Lieberman, Pennebaker, etc.)
- `lib/use-assistant.ts` — Hook wrapping Vercel AI SDK useChat
- `lib/opus-messages.ts` — Audience-aware message lookup: `getOpusMessage(pageId, audience, isDemo)`

**Psychic page awareness:** `buildPageContext()` maps each page to detailed intelligence (what user has entered, proactive guidance, common questions). Opus references user state without being asked.

**Dual-mode:** IP-rate-limited in Forge (20/day), user-rate-limited in Refinery.

**Internal component names** (GhostGuide, AssistantDrawer, etc.) are unchanged — only display strings say "Opus".

### Data Persistence
- **localStorage** (`forge_session`) — primary during Forge flow (pre-auth)
- **Postgres** — `consumer_profile` + `forge_session` tables (post-auth)
- **Auto-sync:** Dashboard layout syncs localStorage → DB on first auth visit (one-time, `_synced` flag prevents duplicates)
- **DB-first loading:** Dashboard page tries `/api/forge/load` first, falls back to localStorage
- **Core functions:** `saveForgeSession()` and `loadForgeProfile()` in `packages/core/src/forgeSession.ts`

### JBS Decision Logging
`logDecision()` wired into all 7 AI API routes. Captures: userId, sessionId, contextPage, modelProvider, modelId, input hash, explanation, outputSummary, tokenCount, latencyMs. Stored in `decision_log` table.

### Access Control System
- **Email verification**: Magic link via Resend, no passwords
- **Rate limiting**: Per-user daily limits (default 30/day) + per-IP for Forge routes
- **Partner access codes**: Distributable codes with tiers (partner=200/day, unlimited, admin)
- **Rate limit wrapper**: `lib/withRateLimit.ts` — HOF wrapping API route handlers
- **Post-auth code redemption**: localStorage `pending_access_code` → auto-redeemed on dashboard load
- **Client-side 429 handling**: All pages show friendly message when limit exceeded

### Rate Limit Tiers
| Tier | Daily AI Calls | Who |
|---|---|---|
| default | 30/day | Any authenticated user |
| partner | 200/day | Users with partner access code |
| unlimited | No limit | Special partner codes |
| admin | No limit | Troy + staff |

### Consumer API Routes
| Route | Auth | Rate Limit | Purpose |
|---|---|---|---|
| /api/analyze | No | IP (5/day) | Forge career analysis |
| /api/parse | No | IP (10/day) | Forge data parsing |
| /api/assistant | Dual | IP or User | Opus AI chat (streaming) |
| /api/disclosure-guide | Yes | User | Disclosure coaching |
| /api/interview-practice | Yes | User | Mock interviews |
| /api/job-search | Yes | User | Fair-chance job search |
| /api/resources-search | Yes | User | Resource recommendations |
| /api/resume-generate | Yes | User | Resume generation |
| /api/forge/save | Yes | — | Persist Forge data to DB |
| /api/forge/load | Yes | — | Load Forge data from DB |
| /api/access-code/redeem | Yes | — | Redeem partner code |
| /api/access-code/mine | Yes | — | List user's codes |
| /api/usage | Yes | — | Daily usage + limit |

### Consumer Env Vars (apps/consumer/.env.local)
- DATABASE_URL (Neon connection string — shared with apps/web)
- AUTH_SECRET, AUTH_URL, AUTH_RESEND_KEY
- ANTHROPIC_API_KEY

### Seeded Access Codes
- SECONDMILE — admin tier (Troy + staff)
- PARTNER2026 — partner tier, 200/day, max 100 redemptions
- UNLIMITED2026 — unlimited tier, max 50 redemptions

### Consumer Build & Dev
- `npm run dev -w apps/consumer` — Dev server (port 3001)
- `npm run build -w apps/consumer` — Production build
- Must build `packages/core` first: `npm run build -w packages/core`

### Deployment Status
- **Live at `consumer-blond.vercel.app`**
- Env vars set in Vercel: DATABASE_URL, AUTH_SECRET, AUTH_URL, AUTH_RESEND_KEY, ANTHROPIC_API_KEY
- Resend domain verification needed for `noreply@secondmilereentry.com`

---

## Roadmap

### Phase 3C: Dashboard UX (NEXT)
The current dashboard is functional but minimal. Needed:
1. **Manifest-driven artifact sections** — Group artifacts by display_section (Start Here, Your Documents, Battle Plan, Interview & Negotiate, Barriers, Online Presence) instead of flat list
2. **Per-artifact status badges** — pending/approved/rejected/generation_failed with color coding
3. **Portfolio HTML preview** — Inline iframe preview of the generated portfolio
4. **Bundle ZIP download** — "Download All" button for the ZIP
5. **Real-time progress for Stage B** — Show which specific artifacts are generating/complete/failed
6. **Error visibility** — Surface which generators failed and why, offer retry

### Phase 4: User Intake Form
The full package currently works from just a resume, but output quality would be dramatically better with user input:
- **Target city/region** — Currently inferred from resume address. User should confirm or override.
- **Dream roles / industries** — Currently extracted from work history. User should specify aspirations.
- **Salary expectations** — Currently estimated from market data. User input improves negotiation sheet.
- **Barriers to disclose** — Currently detected heuristically (employment gaps, no degree, etc.). User should confirm which to address.
- **Employer preferences** — Company size, culture, remote/hybrid/onsite, second-chance friendly.
- **Portfolio customization** — Theme, accent color, tagline, sections to include.

The intake form should appear DURING Stage A (steps 4-8 take 30-90 seconds on external API calls), so the user isn't idle. Saves to run_data as intake form data products.

### Phase 5: Production Deployment
1. Dockerfile for worker (node:20-slim, copy workspaces, build core then worker)
2. Deploy worker to VPS (76.13.98.230) in Docker
3. Deploy web to Vercel
4. Configure production env vars
5. Domain setup + SSL
6. Stripe integration for payments

### Phase 6: Polish + Scale
- Retry individual failed artifacts without re-running entire pipeline
- Email notification when package is ready
- Package sharing (send download link to client)
- Admin dashboard for reviewing all client packages
- Rate limiting / usage tracking
- Multi-org support

### AI Prompt Guidelines for Generators

1. Reference specific data — actual employer names, salary figures, resource addresses. Never generic.
2. Be abundant — output should overwhelm with competence. More detail, not less.
3. Use SMR voice — "Rough. Raw. Real. Direct. Redemptive." Not corporate. Not clinical.
4. Design for System 1 — short paragraphs, clear headers, actionable next steps.
5. Include the "why" — don't just say "apply here." Say why this employer fits.

Resume: proper DOCX heading styles, metrics, Claude-generated brand headline, 700-900 words experienced / 400-600 entry.
Employer Battle Plan: Tier 1 = full company profile + approach strategy + talking points + contact + insider intel. Tier 2 = website + application channel + fit statement. Tier 3 = name + location + URL + one-line note. Second-chance friendly flag on all.
Cover Letters: each targets a SPECIFIC Tier 1 employer by name. No placeholders. Ready to send.
