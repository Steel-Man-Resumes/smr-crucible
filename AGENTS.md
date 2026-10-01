# smr-crucible -- Steel Man product monorepo: The Forge, The Refinery, t.ROY and the organization workspace

Status: ACTIVE. Remote: Steel-Man-Resumes/smr-crucible (PUBLIC, AGPL-3.0-or-later). Last verified: 2026-09-28.
Global rules: ~/todash/HOUSE-RULES.md (change control, privacy, writing). This file adds project rules only.

## What it is
The engine behind Steel Man Resumes for people with records and the organizations that help them. The Forge is free with no login; The Refinery is the authenticated journey (resume, disclosure plan, interview practice, job search, applications); organizations get a staff workspace. t.ROY is the in-product AI coach.
Production: https://forge.steelmanresumes.com and https://refinery.steelmanresumes.com (same app).

## Stack
- `apps/consumer`: Next.js 15 App Router, React 19, TypeScript 5, Tailwind 3.4, Auth.js (next-auth v5 beta), Vercel AI SDK (`ai`, `@ai-sdk/anthropic`); OpenAI is called by API key as a second provider.
- `packages/core` (`@crucible/core`): database access, migrations, org scoping, storage, shared logic. `packages/consumer-ui`: shared React components.
- Neon Postgres (`@neondatabase/serverless`), Cloudflare R2 for files, Resend for email, Vercel hosting and crons.
- `apps/web` and `services/worker` are DORMANT (see their `DORMANT.md`). Do not deploy, build on or extend them without Troy deciding to revive them.

## Commands (Node 20, `.nvmrc`)
- `npm run build -w packages/core` -- build core. Run it before typechecking, testing or building the consumer app.
- `npm run dev -w apps/consumer` -- local dev on port 3002.
- `npm run typecheck -w apps/consumer` / `npm run test -w apps/consumer` / `npm run test:adversarial -w apps/consumer` / `npm run test:claims -w apps/consumer`
- `npm run test -w packages/core` (same as `npm run test:core`)
- `npm run lint:rls` -- protected-table lint. `node scripts/lint-no-secrets-in-docs.mjs` -- public-repo doc lint.
- `npm run verify:isolation` / `npm run verify:directory` -- need a throwaway Neon branch and two credentials (owner and `smr_app`). With one credential they match and prove nothing.
- `npm run migrate -w packages/core` -- applies `packages/core/migrations/*.sql` to whatever `DATABASE_URL` points at.

## Layout
- `apps/consumer/app` -- route groups `(auth)`, `(dashboard)`, `(forge)`, `(mini-forge)`, plus `access`, `walkthrough`, `api/`.
- `apps/consumer/lib` -- app logic; `lib/ai/models.ts` picks models; `lib/skills/` plus `lib/skills-loader.ts` hold t.ROY coaching doctrine.
- `packages/core/src/db.ts` -- the only database API. `packages/core/src/rlsHealth.ts` -- the list of protected tables.
- `packages/core/src/orgClientView.ts` -- the only door for staff reads of participant content.
- `packages/core/migrations/` -- numbered SQL migrations.
- `scripts/` -- lints, isolation and directory checks, Neon branch tooling, seeds.
- `docs/CAPABILITIES-TRUTH-SHEET-2026-09-20.md` -- what the product can truthfully claim.
- `vercel.json` -- builds core then `apps/consumer`; defines the crons.

## Deploy
- Vercel is git-connected: a push to `main` deploys production. Every push and deploy needs Troy's approval at the prompt.
- Do not run `vercel` CLI deploys from this repo. The local `.vercel` link does not name the git-connected production project, so a CLI deploy can land on the wrong project.
- Authorization, RLS and migration work goes branch -> PR (fill in `.github/PULL_REQUEST_TEMPLATE.md`) -> CI green -> merge.
- Verify live: `curl https://forge.steelmanresumes.com/api/health/version` returns the running short SHA; wait for it to match. `/api/health/rls` must return 200 `{"ok":true}` (false/503 if the app role can bypass RLS or any protected table is not enforced); open it in a browser signed in as a platform admin to see the detail (role `smr_app`, `roleCanBypass: false`, per-table flags). `/api/health/skills` shows the coaching skills loaded.

## Environment
Troy enters all keys. Names only, grouped:
- Core: `DATABASE_URL`, `AUTH_SECRET`, `AUTH_TRUST_HOST`, `AUTH_URL`, `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`, `AUTH_RESEND_KEY`, `AUTH_EMAIL_FROM`, `AUTH_CHECK_SECRET`, `APP_URL`, `CRON_SECRET`, `DOCUMENT_ENCRYPTION_KEY`, `HUB_UNLOCK_SECRET`, `SKILLS_HEALTH_TOKEN`.
- AI: `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `ORG_VERIFY_MODEL`, `MOCK_AI`.
- Jobs data: `JSEARCH_API_KEY`, `ADZUNA_APP_ID`, `ADZUNA_APP_KEY`, `USAJOBS_API_KEY`, `USAJOBS_USER_AGENT`, `ONET_USERNAME`, `ONET_PASSWORD`, `CAREERONESTOP_TOKEN`, `CAREERONESTOP_USER_ID`.
- Storage: `R2_ENDPOINT`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME`, `R2_SECURE_BUCKET_NAME`; Preview only: `R2_PREVIEW_*` (same names with PREVIEW).
- Email, SMS, anti-bot: `RESEND_API_KEY`, `SUPPORT_NOTIFY_EMAIL`, `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_MESSAGING_SERVICE_SID`, `NEXT_PUBLIC_TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY`, `TURNSTILE_ENFORCE`.
- Tenant and partner: `TENANT_CONFIG_PATH`, `TENANT_GEO_*`, `NEXT_PUBLIC_PARTNER_*`, `PARTNER_PRE_AUTH`, `MINI_FORGE_DAILY_CAP`, `DIRECTORY_MARK_ENABLED`.
- Other: `AIRTABLE_API_KEY`, `AIRTABLE_TRACKING_BASE_ID`, `AIRTABLE_SMR_EMPLOYERS_BASE_ID`, `NEXT_PUBLIC_GA_ID`, `NEXT_PUBLIC_GOOGLE_AUTH`, `PAGEFIT_CHROMIUM`.

## Project rules
1. **Public repo.** Nothing goes in that would be wrong on GitHub's front page: no notes, credentials, access codes, IPs, private hostnames, or names of partners, leads, clients or participants. Use placeholders (`<ACCESS_CODE>`) and roles. No root `HANDOFF.md`. Session notes go to the private record `~/todash/smr/crucible-handoff/HANDOFF.md`. Public history goes in `CHANGELOG.md`.
2. **Database access goes through row-level security.** Production connects as `smr_app`, which cannot bypass RLS. For any table in `RLS_PROTECTED_TABLES` (`packages/core/src/rlsHealth.ts`) use the scoped helpers in `packages/core/src/db.ts`: `runScoped(scope, build)` for org work (`build` must be synchronous), `queryAsUser` / `getOneAsUser` / `runAsUser` / `insertAsUser` for a user's own rows and membership discovery, `runPerOrg` for cross-org reads. Never raw `query()`, `getOne()` or `insert()` on a protected table: it returns nothing instead of failing. A justified exception needs `// rls-lint-ok(<table>): <reason>` within 15 lines above the call.
3. **Adding a protected table:** migration with the policy, add it to `RLS_PROTECTED_TABLES`, convert call sites, run `npm run lint:rls`, then run the isolation suite on a Neon branch. Anything new code needs (views, functions) ships in an earlier migration than the code. Production migrations need Troy's approval.
4. **CI gates (`.github/workflows/`).** `ci.yml` on every push and PR: `lint-protected-tables`, `lint-no-secrets-in-docs`, core build and tests, consumer typecheck, unit, adversarial and banned-claims (`test/banned-claims.mts`) suites. `org-isolation.yml` on PRs and main pushes that touch the org or database layer (path-filtered, not every PR): throwaway Neon branch, migrations, `verify:isolation`, `verify:directory`. `gitleaks.yml` scans history for secrets. Never weaken a gate to get green. Never delete a banned-claims phrase without proving the claim against the code in the same commit.
5. **Neon reads must not be cached.** `db.ts` passes `cache: "no-store"`; keep it. A stale "fine" from a health check is the worst failure.
6. **Preview storage is isolated.** Non-Production deployments use only `R2_PREVIEW_*` buckets whose names contain `preview`; the storage module fails closed otherwise. Do not point Preview at production buckets or data.
7. **Coaching skills are served by route.** A route that reads `lib/skills/` must be listed in `next.config.mjs` `outputFileTracingIncludes`, or it loads nothing in production.
8. **Resume output never mentions incarceration**, facility names or justice involvement. Every legal-adjacent output says "coaching, not legal advice."
9. **Privacy.** Conversation text (disclosure rehearsal, interview transcripts) is stored only through `packages/core/src/conversationStore.ts`: text only, encrypted in the app, never audio. Do not add another path that stores what a person said. Privacy promises in copy must match the code; `test:claims` guards the ones already proven false.
10. **Wording.** Follows ~/todash/HOUSE-RULES.md section 5: on job-seeker surfaces the searcher's words ("felony," "jobs for felons") are allowed; never label the reader. Mini Forge and tablet copy follows each facility's and vendor's content rules instead. The employer badge reads "Hires people with records." Product names: Forge, Refinery, Crucible, t.ROY.

## State and history
Current state and session notes: `~/todash/smr/crucible-handoff/HANDOFF.md` (private). Shipped changes: `CHANGELOG.md`. Design records: `docs/`. Older notes live in git history.

## Routines
- Daily: GET the three health endpoints and the Forge and Refinery front pages; report any non-200, SHA drift or `/api/health/rls` `ok: false`.
- Weekly: `npm audit` plus a gitleaks run; report only.
- Weekly: public-repo scrub of tracked docs for names, codes or IPs; propose removals as a PR.
