# Steel Man (Crucible)

A career-services platform built for justice-impacted people and the organizations
that support them. It is a guided journey from self-understanding to a tailored resume,
a disclosure plan, interview practice, fair-chance job search, and follow-up on real
applications.

Built by Steel Man Resumes LLC. This is the engine behind Steel Man Resumes
(steelmanresumes.com): The Forge (free, no login) and The Refinery (the full
authenticated journey).

> Coaching, not legal advice. The platform helps people prepare and decide; it does
> not provide legal advice.

## What it does

A seven-stage journey, with one suggested next step surfaced at every point:

0. **Orient** -- a short guided tour; name your AI coach.
1. **Foundation (The Forge)** -- narrative-first analysis of strengths, skills, and
   career paths. No scoring, no grading.
2. **Find fair-chance work** -- a job board fed by several job-data providers. An
   employer is flagged fair-chance only when it is in a verified employer table.
3. **Tailor a resume** -- an ATS-aware resume targeted to a saved job. Generation is
   evidence-only: a truth gate blocks claims the person never made. Justice involvement
   never appears on paper.
4. **Plan disclosure** -- how to talk about a record, with the relevant ban-the-box and
   expungement law as background. Every output carries "coaching, not legal advice."
5. **Practice interviews** -- text or live voice.
6. **Apply and follow up** -- track applications and draft follow-up messages.

Throughout: an AI coach (t.ROY) that knows where the person is in the journey, a vault
for the person's own documents, and data controls in Settings, including a full export
and Delete My Data.

## Sharing: the participant decides

A participant who joined through a support organization can choose to share specific
items with that organization (applications, a resume, documents they built), one item at
a time. They can stop at any time, and they can see who opened what, and when. No setting
an organization controls can open a participant's resume. Only the participant can.

Some things can never be shared or required: disclosure plans, interview practice, and
files stored in the vault. When applications are shared, a participant's private notes on
a job and the pay they wrote down are not shown to staff. Leaving an organization ends all
sharing and keeps the person's work.

Item-by-item sharing is built and running in production for demonstration organizations.
It is switched on for an organization by arrangement.

## For organizations

The organization workspace is built and running in production for demonstration
organizations, and is available by arrangement. The rule it is built on: staff suggest,
participants decide. Staff never edit a participant's work, and never sign in as a
participant. They get a map of the participant's screen, and see inside an area only if
it was shared.

What the staff workspace contains:

- **Work queue** -- today's work, grouped by the reason each person needs attention.
- **Caseload** -- filters, saved views, and bulk assignment.
- **Notes** -- versioned, never deleted.
- **Tasks** -- for staff, and tasks that can be shared with the participant.
- **Suggestions** -- suggest a job, or comment beside a shared document. A suggestion
  does not change the participant's tracker or documents unless the participant acts on it.
- **Outcomes** -- placements record how they are known (told to staff, known but
  unconfirmed, or confirmed and how), with retention check-ins at 30, 60, 90 and 180 days.
  A retention rate is "still there" out of "old enough to ask."
- **Funder export** -- every figure carries what it was counted over.
- **Team** -- an organization chart with per-person access switches, and staff
  invitations by email.

Answers the assistant gives to staff are generated whole and checked against the
organization's actual figures before they appear.

## How data is protected

Enforced by the database:

- Organization boundaries are enforced by the database itself, not only by application
  code. Organization boundaries and participant-owned tables are enforced by Postgres
  row-level security, under a database role that cannot bypass it.
- A participant's applications, resumes and profile can be read only by that participant.
  Staff see a shared item through a restricted view that does not contain private notes,
  pay, or disclosure plans at all.
- CI runs an isolation suite as that restricted role on every pull request
  (`scripts/verify-org-isolation.mjs`). A lint (`scripts/lint-protected-tables.mjs`) fails
  the build when application code reaches a protected table through an unscoped helper.
  `GET /api/health/rls` reports whether the rules are enabled, forced, and non-bypassable
  for the live connection.
- Changes to who can see what are recorded, in an audit table written only by database
  triggers and functions.

Still enforced in application code, not by the database: which colleague inside an
organization may open a given participant (assignment, "sees everyone" roles, and
per-person capability switches). Tests cover it. It is not a database rule, and we do
not describe it as one.

No third-party security or compliance assessment has been done. See
[`docs/CAPABILITIES-TRUTH-SHEET-2026-09-20.md`](./docs/CAPABILITIES-TRUTH-SHEET-2026-09-20.md)
for what may and may not be claimed about the organization side, with the evidence for
each claim.

## Architecture

Monorepo (npm workspaces):

- `apps/consumer` -- the product: The Forge, The Refinery and the organization workspace.
  Next.js 14 App Router, deployed on Vercel.
- `packages/core` -- shared library: database access and SQL migrations, row-level
  security health, the intelligence engine (`getUserProfile` + `computeNextStep`), consent,
  sharing, artifacts, the AI coach, the employer directory, and system health.
- `packages/consumer-ui` -- shared React components.
- `scorm` -- Forge Tablet, an offline SCORM package for learning systems that do not
  allow web access. See [`scorm/README.md`](./scorm/README.md).
- `apps/web` and `services/worker` -- an earlier pipeline, archived as inactive. See the
  `DORMANT.md` file in each.

Stack: Next.js 14.2 (App Router) and React 18, TypeScript 5, Tailwind CSS 3, Neon Postgres
through the Neon serverless driver, Auth.js v5 (NextAuth) with the Postgres adapter
(email magic link, password with optional two-factor, optional Google sign-in), Cloudflare
R2 for files, the Vercel AI SDK with Anthropic as primary and OpenAI as fallback, Resend
for email. Node 20. High-risk systems sit behind feature flags.

## Product world map

The human-facing canonical map of the public Site, The Forge, and The Refinery is
[`docs/SMR-WORLD-MAP.html`](./docs/SMR-WORLD-MAP.html). It is a standalone,
interactive file: open it directly in a browser; no application build is required.
See [`docs/SMR-WORLD-MAP.md`](./docs/SMR-WORLD-MAP.md) for provenance and the
maintenance rule.

## Local development

```bash
source ~/.nvm/nvm.sh && nvm use 20
npm install
cp apps/consumer/.env.example apps/consumer/.env.local   # then fill in your own keys
npm run build -w packages/core                            # core builds before the app
npm run migrate -w packages/core                          # DATABASE_URL must be set
npm run dev -w apps/consumer                              # http://localhost:3002
```

Set `MOCK_AI=true` in development to exercise the generation flows with zero AI spend.
Never commit real secrets; `.env.local` is gitignored.

Checks that need no database: `node scripts/lint-protected-tables.mjs` and
`node scripts/lint-no-secrets-in-docs.mjs`. The isolation suite
(`npm run verify:isolation`) needs a database and a restricted-role credential.

## Changelog

See [CHANGELOG.md](./CHANGELOG.md) for a dated, high-level history of what shipped.

## This repository is public

Working notes, credentials, access codes and the names of partners, leads or participants
never go in it. Maintainer session notes are kept in a private record outside this repo.
CI fails on credential-shaped lines in docs.

## License

- **Code:** GNU Affero General Public License v3.0 or later (AGPL-3.0-or-later). See
  [LICENSE](./LICENSE).
- **Content and documentation:** Creative Commons Attribution 4.0 (CC BY 4.0).

Copyright (C) 2026 Steel Man Resumes LLC.

## Security

Please report vulnerabilities privately. See [SECURITY.md](./SECURITY.md). Do not open
a public issue for a security report.

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md). The mission and language guardrails
(always "justice-impacted"; "fair-chance" for employers) are part of the contribution
standard.
