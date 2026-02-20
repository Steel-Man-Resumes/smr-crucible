# CRUCIBLE

## What This Is
AI-assisted career services platform. Replaces smr-forge and smr-refinery with unified persistent architecture.

## Architecture
- apps/web: Next.js 14 App Router, deployed to Vercel
- services/worker: BullMQ job consumer, runs in Docker on VPS (76.13.98.230)
- packages/core: Shared TypeScript types, event definitions, schema validators

## Tech Stack
- Database: PostgreSQL on Neon (connection string in DATABASE_URL)
- Object Storage: Cloudflare R2 (S3-compatible, credentials in R2_* env vars)
- Queue: Redis + BullMQ (REDIS_URL env var)
- Auth: Auth.js v5 with Resend email magic link
- Payments: Stripe (future phase)
- AI: Anthropic Claude, OpenAI GPT, Perplexity

## Key Principles
1. All canonical state in Postgres. Browser state is cache only.
2. Every significant action emits a structured event to the event table.
3. Heavy compute runs on the worker, never in Vercel serverless functions.
4. Files stored in R2, never in the database. DB stores metadata + pointers.
5. AI responses are validated before storage. No trusting raw output.
6. Human review gates before artifacts reach downloadable status.
7. Config (prompts, options, output defs) stored as versioned immutable JSON.

## Database
Neon Postgres. Migrations in packages/core/migrations/ as sequential numbered SQL files.
Run migrations: npm run migrate -w packages/core

Tables (Phase 0-2): org, user, membership, subject, project, file_object, document, event, consent_record, workflow_run, run_step, artifact, _migrations
Tables (Phase 3): run_data, bundle + artifact extensions (artifact_key, bundle_id, display_title, display_section, preview_type, order_index, depends_on_keys)

## Core Utilities (packages/core/src/)
- db.ts: query(), getOne(), insert() — thin wrappers around @neondatabase/serverless
- events.ts: emitEvent(), emitStepEvent(), emitAICallEvent() — structured event logging
- storage.ts: uploadFile(), getSignedUrl(), createFileObject() — R2 via S3 SDK
- types.ts: All TypeScript types, event type unions, CrucibleEvent interface
- pipeline.ts: PipelineDef, StepContext, StepHandler types + runPipeline() generic runner
- jsonParser.ts: extractAndParseJSON(), safeParseJSON() — robust AI response parser

## Pipeline Framework
Generic pipeline runner that executes step definitions in sequence:
- PipelineDef: key, version, steps[] (each with key, critical, maxRetries, timeoutMs)
- StepHandler: (ctx, input) => output. Each step receives previous step's output.
- runPipeline(): Creates run_step records, handles retries, emits events, manages failure.
- Critical steps abort pipeline on failure. Optional steps skip and continue.

### career_intake_v1 Pipeline (services/worker/src/pipelines/careerIntakeV1.ts)
Steps: extract → parse → analyze → generate
1. extract: Pull text from uploaded docs (PDF via pdf-parse, DOCX via mammoth, OCR via tesseract.js)
2. parse: GPT-4o-mini structured resume parsing with confidence scoring
3. analyze: Parallel AI analysis — Claude (narrative + strategy) + GPT (skills/ATS)
4. generate: Resume DOCX artifact via docx package, stored in R2, artifact record created

### Worker Job Flow
1. Web app POSTs to /api/projects/[id]/run → creates workflow_run (queued) → enqueues to Redis
2. Worker picks up job → looks up pipeline by key → calls runPipeline()
3. Pipeline runner iterates steps → emits events at each stage → stores artifacts
4. UI polls GET /api/runs/[id] every 2s for progress → shows step cards + artifacts

## API Routes (apps/web)
All routes require auth. Org resolved from authenticated user's membership.
- POST /api/orgs — Create org + admin membership
- GET /api/projects — List projects for user's org
- POST /api/projects — Create project (auto-creates subject)
- GET /api/projects/[id] — Project detail with documents + recent events
- POST /api/projects/[id]/upload — Multipart file upload to R2
- POST /api/projects/[id]/run — Start pipeline run (enqueues to Redis)
- GET /api/projects/[id]/documents — List documents with signed URLs
- GET /api/projects/[id]/events — Activity timeline (last 50 events)
- GET /api/runs/[id] — Run status + steps + recent events
- GET /api/runs/[id]/artifacts — Artifacts with signed download URLs
- POST /api/artifacts/[id]/review — Human review (approved/rejected)

## Auth Pattern
- auth.ts at web root configures Auth.js with Resend provider
- middleware.ts protects /dashboard and /api (except /api/auth)
- lib/api-auth.ts: getAuthContext() resolves user + org from session
- Users without an org get 403 on project routes; must create org first

## Dashboard Pages
- /dashboard — Project list, new project creation, org onboarding
- /dashboard/[id] — Project detail with file upload, "Run Analysis" button, pipeline progress view, artifact review (approve/reject), activity timeline with human-readable pipeline events
- /login — Email magic link form
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

## Commands
- npm run dev -w apps/web          # Start web app dev server
- npm run dev -w services/worker   # Start worker in dev mode
- npm run migrate -w packages/core # Run DB migrations
- npm run build -w packages/core   # Build core package (must run before worker build)
- npm run build -w apps/web        # Build web for production
- npm run build -w services/worker # Build worker for production

## Git
- Branch: main
- All commits on main
- No secrets in code — use .env.local for web, .env for worker

---

## Phase 3: Output Expansion + Pipeline Evolution

Phase 2 produces 1 artifact (DOCX resume) from a 4-step sequential pipeline.
Phase 3 produces a complete career services package — 11+ artifacts, coordinated from shared research data, presented through a manifest-driven dashboard with human review gates. Every artifact references the same frozen intelligence. Nothing is generated in isolation.

### Three-Stage Pipeline Architecture

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
DURING STAGE A (steps 4-8):        ├─ interview_prep
User sees customization screen      ├─ salary_negotiation
→ saves portfolio_prefs.v1          ├─ portfolio_html
                                    ├─ tracker_xlsx
                                    ├─ quickstart_guide
                                    └─ readme_toc
```

- Stage A creates intelligence. Sequential because each step builds on the last.
- Stage B transforms intelligence into documents. Parallel because artifacts are independent once research is frozen.
- Stage C assembles the package. Sequential because it needs all artifacts complete.

### Queue Architecture

Two separate BullMQ queues:
- `crucible-pipeline` (concurrency: 1) — Stage A pipeline processing, sequential
- `crucible-artifacts` (concurrency: 5) — Stage B artifact generation, parallel fan-out

Worker registers two processors. Stage A completes → plan_package decides what to generate → init_bundle enqueues artifact jobs to crucible-artifacts.

### Frozen Snapshot Rule (CRITICAL)

Once a data product is written to `run_data`, it is immutable for that run. All downstream steps and artifact generators consume the same snapshot. If enrichment data needs updating, create a new key version (e.g. `employers.v2`). `putRunData()` is write-once — errors if key already exists.

This is what makes the package cohesive: the cover letter references the same employer the Battle Plan describes. The 30-day plan directs the user to the same resources the Alloy Report details. One truth, many presentations.

### Database Changes — 003_phase3.sql

**New table: `run_data`** — typed, named, immutable data products per run
- id, run_id, key (e.g. 'profile.v1'), schema_version, hash (sha256), classification, producer_step_key, data (JSONB), raw_ref (optional file_object), created_at
- UNIQUE(run_id, key) enforces write-once rule

**New table: `bundle`** — package container for grouped artifacts
- id, run_id, org_id, project_id, status (building|awaiting_review|ready|published), manifest (JSONB), zip_file_object_id, created_at, published_at

**Extend `artifact`** — add columns:
- artifact_key, bundle_id, display_title, display_section (start_here|apply|interview|negotiate), preview_type (none|html|pdf_thumb), order_index, depends_on_keys (JSONB)

### Data Products (Zod Schemas in packages/core/src/schemas/)

All schemas are frozen immutable snapshots once written to run_data.

| Key | Producer Step | Description |
|-----|--------------|-------------|
| profile.v1 | parse_profile | Normalized user profile — name, contact, work_history[], education[], certs[], military |
| signals.v1 | compute_signals | Derived features — industry, seniority, years_exp, barriers{}, ats_score, skills, target_roles, risk_notes |
| jobs.v1 | research_jobs | Raw + normalized job listings from JSearch — jobs[], query_used, fetched_at |
| employers.v1 | build_employer_tiers | Tiered employer list — tier1[] (full Battle Plan), tier2[] (mid detail), tier3[] (basic) |
| employers_enriched.v1 | enrich_contacts | Merged employer data + Tier 1 contact enrichment from Perplexity |
| market.v1 | market_salary | Salary intelligence — ranges, hourly equiv, sources, confidence, negotiation leverage |
| resources.v1 | local_resources | Local support resources (conditional on barriers) — grouped by barrier type |
| portfolio_prefs.v1 | (user input) | User customization — theme, accent_color, tagline_style, sections_enabled |
| runplan.v1 | plan_package | Artifact generation plan — tasks[], conditional_exclusions[], estimated cost/duration |
| artifact_manifest.v1 | init_bundle / update_manifest | Bundle TOC for dashboard — sections[], artifacts[], recommended_next_action |

### run_data Accessor API (packages/core/src/runData.ts)

- putRunData(runId, key, data, meta) — write-once, errors if key exists
- getRunData<T>(runId, key) — read typed data product
- hasRunData(runId, key) — existence check
- listRunData(runId) — list all data products for a run

### Enrichment Providers (packages/core/src/enrichment/)

Provider abstraction layer. Pipeline steps call the orchestrator, never providers directly.

| Task Type | Primary Provider | Fallback |
|-----------|-----------------|----------|
| discover_jobs | JSearch | none |
| discover_employers | JSearch | Perplexity |
| enrich_employer_contacts | Perplexity | none (Tier 1 only) |
| market_salary | JSearch + Perplexity supplemental | — |
| local_resources | Perplexity | none |

Interface: `EnrichmentProvider` with key, capabilities, run(). `EnrichmentOrchestrator.enrich(task)` selects provider, handles fallback, normalizes output.

### Stage A Steps

| # | Step Key | Consumes | Produces | Notes |
|---|----------|----------|----------|-------|
| 1 | extract_resume_text | (upload) | doc_text.v1 | Existing (PDF, DOCX, TXT, OCR) |
| 2 | parse_profile | doc_text.v1 | profile.v1 | Existing (GPT-4o-mini) |
| 3 | compute_signals | profile.v1 | signals.v1 | NEW — barriers, industry, seniority, ATS |
| 4 | research_jobs | profile.v1, signals.v1 | jobs.v1 | JSearch via enrichment orchestrator |
| 5 | build_employer_tiers | jobs.v1, signals.v1 | employers.v1 | Claude ranks + tiers employers |
| 6 | enrich_contacts | employers.v1 | employers_enriched.v1 | Perplexity for Tier 1 contacts only |
| 7 | market_salary | signals.v1, jobs.v1 | market.v1 | JSearch + Perplexity salary data |
| 8 | local_resources | signals.v1 | resources.v1 | CONDITIONAL: only if signals.barriers_any |
| 9 | plan_package | signals.v1, employers_enriched.v1, market.v1, resources.v1 | runplan.v1 | Decides which artifacts to generate |
| 10 | init_bundle | runplan.v1 | bundle record + artifact_manifest.v1 (draft) | Creates bundle, enqueues Stage B jobs |

### Stage B Artifact Generators (parallel BullMQ jobs on crucible-artifacts queue)

Each job receives { runId, bundleId, artifactKey, params } and consumes frozen run_data.

| Artifact Key | Job Key | Consumes | AI Model |
|-------------|---------|----------|----------|
| resume_docx | gen_resume | profile.v1, signals.v1, employers_enriched.v1 | Claude Sonnet |
| coverletter_bold | gen_coverletter | profile.v1, employers_enriched.v1 | Claude Sonnet |
| coverletter_friendly | gen_coverletter | profile.v1, employers_enriched.v1 | Claude Sonnet |
| coverletter_professional | gen_coverletter | profile.v1, employers_enriched.v1 | Claude Sonnet |
| employers_battleplan | gen_employers | employers_enriched.v1, signals.v1 | Claude Sonnet |
| action_plan_30day | gen_actionplan | employers_enriched.v1, jobs.v1, resources.v1, market.v1 | Claude Sonnet |
| alloy_report | gen_alloy | signals.v1, resources.v1, profile.v1 | Claude Sonnet |
| interview_prep | gen_interview | signals.v1, employers_enriched.v1, market.v1 | Claude Sonnet |
| salary_negotiation | gen_salary | market.v1, signals.v1 | Claude Sonnet |
| portfolio_html | gen_portfolio | profile.v1, signals.v1, portfolio_prefs.v1 | Claude Sonnet |
| tracker_xlsx | gen_tracker | employers_enriched.v1 | Template + data |
| quickstart_guide | gen_quickstart | artifact_manifest.v1 | Claude Sonnet |
| readme_toc | gen_readme | artifact_manifest.v1 | Template |

AI model assignments: Claude Sonnet for all narrative generation. GPT-4o-mini for structured extraction only (parse_profile, ATS scoring). Perplexity for enrichment only.

Cover letters share `gen_coverletter` processor with tone + target employer params.

### Conditional Generation Rules

All conditionality lives in plan_package step. Generators stay dumb.
- alloy_report: only if signals.barriers_any === true
- salary_negotiation: lite variant if market.confidence < 'medium'
- local_resources step: skips if no barriers
- cover letters: use Tier 2 employers if < 3 Tier 1; placeholders if < 3 total

### Stage C Assembly

After all Stage B jobs complete:
1. update_manifest — refreshes artifact_manifest.v1 with actual file URLs and statuses
2. generate_zip — ZIP of all artifacts → R2, file_object_id on bundle
3. set_bundle_status → awaiting_review

### UX: Portfolio Customization During Research

During Stage A steps 4-8 (external API calls, 30-90 seconds), dashboard shows research progress on left + customization panel on right. User selects theme, accent color, tagline style, sections. Saves via:
- POST /api/runs/[id]/prefs — writes directly to run_data as portfolio_prefs.v1
- Default prefs apply if user doesn't customize before fan-out (theme: forge, accent: brand gold, tagline: professional, all sections)

### UX: Manifest-Driven Artifact Dashboard

Dashboard reads artifact_manifest.v1 and renders sections:
- "Start Here" — Quick Start Guide, README
- "Your Documents" — Resume, Cover Letters (labeled with target employer name)
- "Your Battle Plan" — Target Employers (50 tiered), 30-Day Action Plan, Job Tracker
- "Interview & Negotiate" — Interview Prep, Salary Negotiation
- "Your Barriers, Your Strengths" — Alloy Report (conditional)
- "Your Online Presence" — Portfolio HTML (preview inline + download)

Per-artifact: status badge, download, preview, approve/reject. Bundle-level: "Download All" ZIP, completeness indicator.

### AI Prompt Guidelines for Generators

1. Reference specific data — actual employer names, salary figures, resource addresses. Never generic.
2. Be abundant — output should overwhelm with competence. More detail, not less.
3. Use SMR voice — "Rough. Raw. Real. Direct. Redemptive." Not corporate. Not clinical.
4. Design for System 1 — short paragraphs, clear headers, actionable next steps.
5. Include the "why" — don't just say "apply here." Say why this employer fits.

Resume: proper DOCX heading styles, metrics, Claude-generated brand headline, 700-900 words experienced / 400-600 entry.
Employer Battle Plan: Tier 1 = full company profile + approach strategy + talking points + contact + insider intel. Tier 2 = website + application channel + fit statement. Tier 3 = name + location + URL + one-line note. Second-chance friendly flag on all.
Cover Letters: each targets a SPECIFIC Tier 1 employer by name. No placeholders. Ready to send.

### Implementation Sequence

**Phase 3A: Data Layer + Core Pipeline**
1. 003_phase3.sql migration
2. Zod schemas in packages/core/src/schemas/
3. runData.ts accessor API
4. Enrichment provider abstraction + JSearch + Perplexity providers
5. Refactor existing steps to use run_data
6. Add new steps 3-10 (compute_signals through init_bundle)
7. Test Stage A end-to-end

**Phase 3B: Artifact Generation**
1. crucible-artifacts queue + worker processor
2. Artifact job contract (shared interface)
3. Implement generators (resume_docx first, then employers_battleplan)
4. Portfolio customization API endpoint
5. Stage C assembly (manifest, ZIP, bundle status)
6. Test full run → all artifacts → awaiting_review

**Phase 3C: Dashboard + UX**
1. Manifest-driven artifact dashboard (replaces current project detail)
2. Per-artifact status, download, preview
3. Portfolio customization panel (during Stage A)
4. Bundle ZIP download
5. Real-time progress for Stage A steps + Stage B artifact jobs

**Parallel: Worker Docker Deployment**
1. Dockerfile (node:20-slim, copy workspaces, build core then worker)
2. Deploy to VPS (76.13.98.230)
3. Configure env vars, test production end-to-end

### Environment Variables (Phase 3 additions)
- JSEARCH_API_KEY (JSearch / RapidAPI for job discovery)
- PERPLEXITY_API_KEY (already defined, now actively used for enrichment)
