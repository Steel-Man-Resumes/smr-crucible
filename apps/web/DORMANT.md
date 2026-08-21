# DORMANT -- not deployed, not maintained (as of 2026-08-21)

`apps/web` is the older Forge/Refinery web app. It is **inactive** and NOT the
production deployment. Production is `apps/consumer` (see `vercel.json`, which
builds only that app). `apps/web` pairs with the dormant `services/worker`
pipeline (see `services/worker/DORMANT.md`).

Status decision (Troy, 2026-08-21): **archive as inactive.** Kept in the repo for
history. Do not deploy or extend it without an explicit decision to revive the
`apps/web` + worker pipeline; the live product work happens in `apps/consumer`.

Credentials: configured via environment variables, no hardcoded secrets.
