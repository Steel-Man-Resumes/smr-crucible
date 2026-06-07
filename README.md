# Steel Man (Crucible)

A career-services platform built for justice-impacted people and the organizations
that support them. It turns a person's story into a job: a guided, research-grounded
journey from self-understanding to a tailored resume, a disclosure plan, interview
practice, real fair-chance employers, and an offer.

Built by The Midnight Garden LLC. This is the engine behind Steel Man Resumes
(steelmanresumes.com) -- The Forge (free, no login) and The Refinery (the full
authenticated journey).

> Coaching, not legal advice. The platform helps people prepare and decide; it does
> not provide legal advice.

## What it does

A seven-stage journey, with one intelligent "next step" surfaced at every point:

0. **Orient** -- a short guided tour; name your AI coach.
1. **Foundation (The Forge)** -- narrative-first analysis of strengths, skills, and
   career paths. No scoring, no grading.
2. **Find fair-chance work** -- a job board plus a directory of employers verified as
   open to people with records.
3. **Tailor a resume** -- an ATS-aware resume targeted to a saved job.
4. **Plan disclosure** -- how to talk about a record, grounded in the relevant
   ban-the-box and expungement law. The user's own words are never stored.
5. **Practice interviews** -- text or live voice. We coach the frame and whether the
   point lands, never the person's words.
6. **Apply and follow up** -- track applications and draft follow-up messages.

Throughout: an AI coach that knows where the person is, a consent-gated partner
dashboard so a support organization can see progress (only what the person chooses
to share, never their content), and a privacy posture that stores progress, not
transcripts.

## Architecture

Monorepo (npm workspaces):

- `apps/consumer` -- the product. Next.js 15 App Router, deployed on Vercel.
- `packages/core` -- shared library: database access, migrations, the intelligence
  engine (`getUserProfile` + `computeNextStep`), consent, artifacts, the AI coach,
  partner dashboard, employer directory, and system health.

Stack: Next.js 15, Neon Postgres, Auth.js (NextAuth) with a Postgres adapter,
Cloudflare R2 for files, Anthropic (primary) with OpenAI fallback for AI, Resend for
email. Every high-risk system is behind a feature flag.

## Local development

```bash
source ~/.nvm/nvm.sh && nvm use 20
npm install
cp apps/consumer/.env.example apps/consumer/.env.local   # then fill in your own keys
npm run migrate -w packages/core                          # DATABASE_URL must be set
npm run dev -w apps/consumer                              # http://localhost:3000
```

Set `MOCK_AI=true` in development to exercise the generation flows with zero AI spend.
Never commit real secrets; `.env.local` is gitignored.

## License

- **Code:** GNU Affero General Public License v3.0 or later (AGPL-3.0-or-later). See
  [LICENSE](./LICENSE).
- **Content and documentation:** Creative Commons Attribution 4.0 (CC BY 4.0).

Copyright (C) 2026 The Midnight Garden LLC.

## Security

Please report vulnerabilities privately. See [SECURITY.md](./SECURITY.md). Do not open
a public issue for a security report.

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md). The mission and language guardrails
(always "justice-impacted," never "ex-offender"; "fair-chance," not "second-chance")
are part of the contribution standard.
