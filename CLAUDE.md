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
- Auth: Auth.js with email magic link
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

## Environment Variables Required
### apps/web
- DATABASE_URL (Neon connection string)
- REDIS_URL
- AUTH_SECRET (Auth.js secret)
- AUTH_URL (app URL for magic link callbacks)
- R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME

### services/worker
- DATABASE_URL
- REDIS_URL
- R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME
- ANTHROPIC_API_KEY
- OPENAI_API_KEY
- PERPLEXITY_API_KEY

## Commands
- npm run dev -w apps/web        # Start web app dev server
- npm run dev -w services/worker  # Start worker in dev mode
- npm run migrate -w packages/core # Run DB migrations
- npm run build -w apps/web       # Build for production

## Git
- Branch: main
- All commits on main
- No secrets in code — use .env.local for web, .env for worker
