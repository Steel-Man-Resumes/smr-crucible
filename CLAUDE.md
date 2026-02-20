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

Tables: org, user, membership, subject, project, file_object, document, event, consent_record, workflow_run, run_step, artifact, _migrations

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
