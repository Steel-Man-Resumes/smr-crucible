# DORMANT -- not deployed, not maintained (as of 2026-08-21)

`services/worker` (the BullMQ/Redis career-intake pipeline) is **inactive**. It is
NOT part of the production deployment: `vercel.json` builds only `apps/consumer`,
and this worker is a long-running Node/Redis process that cannot run as a Vercel
function. Nothing in the deployed app imports `careerIntakeV2`, `genEmployers`, or
anything under `services/worker`.

Status decision (Troy, 2026-08-21): **archive as inactive.** Kept in the repo for
history; do not deploy or extend it without an explicit decision to revive the
`apps/web` + worker pipeline.

Known latent bugs (dead code -- they do not affect production `apps/consumer`):
- `src/pipelines/careerIntakeV2.ts` writes placeholder artifact rows, then the
  Stage-B idempotency guard in `src/index.ts` skips every generator, so a v2
  package can get stuck in `status: 'building'`. (A stale comment there claims the
  placeholder insert fails on a NOT NULL that migration 004 already dropped.)
- `src/generators/genEmployers.ts` writes `display_section: 'battle_plan'`, which
  violates the CHECK constraint in `packages/core/migrations/003_phase3.sql`.

Credentials: this service reads config from environment variables (DATABASE_URL,
Redis, etc.); there are no hardcoded secrets to rotate. If it is ever permanently
retired, remove any worker-only env vars from the deploy environment.
