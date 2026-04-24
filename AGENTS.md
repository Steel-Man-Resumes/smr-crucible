# AGENTS.md -- Steel Man Resumes (Crucible)

> If you are an AI assistant working on this codebase, read this file first.

## 30-Second Context

This is the **Crucible** -- a monorepo housing Forge (behavioral career analysis) and Refinery (authenticated career workspace) for justice-impacted job seekers. Live at forge.steelmanresumes.com and refinery.steelmanresumes.com.

**Stack:** Next.js 14 monorepo (Turborepo), TypeScript, Tailwind, PostgreSQL/Neon, Cloudflare R2, Redis/BullMQ, Auth.js v5, Anthropic + OpenAI APIs, Vercel.

**Monorepo layout:**
- `apps/consumer` -- Forge + Refinery consumer app (deployed to Vercel)
- `packages/core` -- Shared types, DB helpers, rate limiting, schema validators
- `packages/consumer-ui` -- Shared React components (CardSelect, GhostGuide, FlowPage, etc.)

## Before You Change Anything

1. Read `CLAUDE.md` for full architecture, principles, and current state
2. Never put incarceration, prison, parole, probation, or justice involvement in any AI-generated resume output -- not even obliquely
3. Always say "justice-impacted" -- never "second-chance," "ex-offender," or "felon"
4. Build `packages/core` before `apps/consumer` if touching shared packages
5. All canonical state lives in PostgreSQL -- browser state is cache only
6. Heavy compute runs on the VPS worker (76.13.98.230), never in Vercel serverless

## Key Files

| Need to... | Read this |
|------------|-----------|
| Understand the platform | `CLAUDE.md` |
| Understand AI pipeline | `apps/consumer/app/api/analyze/route.ts` |
| Understand session flow | `apps/consumer/lib/forge-context.tsx` |
| Understand shared types | `packages/core/src/types/` |
| Understand DB schema | `packages/core/src/db/schema.ts` |

## What NOT To Do

- Do not expose incarceration history in any user-facing output
- Do not run heavy AI jobs in Vercel serverless -- use the worker queue
- Do not store files in the database -- use R2, store metadata + pointers
- Do not trust raw AI output -- validate before storage
- Do not commit secrets -- env vars go in Vercel dashboard

## Deploy

Push to main -- Vercel auto-deploys consumer app. Worker deploys separately to VPS.
