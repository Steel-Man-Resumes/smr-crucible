# Codex Handoff - Refinery Live Prep, Auth Reset, and Deployment

**Author:** Codex, OpenAI GPT-5 coding agent  
**Date:** 2026-06-06  
**Repo:** `/home/marcu/repos/smr-crucible`  
**Target app:** `apps/consumer` - live Forge + Refinery consumer app  
**Audience for this handoff:** Troy and CC / Claude Code

## Why This Work Happened

Troy asked for a hard live-audience inspection of the current Refinery, not the archived repo. The goal was to make the product sharper, safer, cheaper to test, and better aligned to Steel Man's mission: helping justice-impacted job seekers rebuild work, narrative, confidence, and employer-facing readiness.

Troy then redirected the old Resources area into a second-chance-friendly job board. That direction was correct: generic resources are useful, but the live product should push users toward realistic work, targeted resumes, interview practice, and disclosure strategy.

Finally, Troy hit a real auth problem: the magic link did not reset his password. Codex clarified that magic links are passwordless sign-in, not password reset, and built a true password reset email flow.

## Major Product Changes

### Second Chance Board

Changed `/dashboard/resources` from a broad local resource directory into a Second Chance Job Board.

Key files:
- `apps/consumer/app/(dashboard)/dashboard/resources/page.tsx`
- `apps/consumer/lib/second-chance-board.ts`
- `apps/consumer/app/(dashboard)/layout.tsx`
- `apps/consumer/app/(dashboard)/dashboard/page.tsx`
- `apps/consumer/lib/assistant-prompt.ts`
- `apps/consumer/lib/opus-messages.ts`
- `apps/consumer/lib/quick-wins.ts`
- `apps/consumer/lib/roadmap.ts`
- `apps/consumer/app/(dashboard)/dashboard/progress/page.tsx`

Behavior:
- Shows high-probability fair-chance job lanes instead of pretending to have verified live openings.
- Routes users into the existing live JSearch job board for current listings.
- Includes realistic cautions: fair-chance does not mean guaranteed approval.
- Connects every lane to resume building, interview practice, and disclosure planning.

Rationale:
- Keeps the app honest.
- Avoids fake listings.
- Reduces wasted applications.
- Better aligns with the mission than generic resource browsing.

### Live Voice Interview Practice

Added a live voice practice option to Interview Practice using OpenAI Realtime.

Key files:
- `apps/consumer/app/(dashboard)/dashboard/interview/page.tsx`
- `apps/consumer/app/api/interview-voice/token/route.ts`
- `apps/consumer/middleware.ts`
- `apps/consumer/auth.ts`
- `apps/consumer/next.config.mjs`

Behavior:
- Uses `gpt-realtime-2`.
- Browser connects with WebRTC.
- Server mints ephemeral client secrets.
- Standard OpenAI API key never reaches the browser.
- Sends a hashed `OpenAI-Safety-Identifier`.
- Written interview practice remains as fallback.

Remaining CC work:
- Browser/microphone QA on production.
- Add max voice-session duration.
- Add explicit voice quota/cost tracking separate from text interview usage.
- Decide transcript retention policy before storing any voice-derived data.

### Password Reset Flow

Added a true password reset flow because magic links do not change passwords.

Key files:
- `apps/consumer/app/(auth)/forgot-password/page.tsx`
- `apps/consumer/app/(auth)/reset-password/page.tsx`
- `apps/consumer/app/api/auth/reset-password/request/route.ts`
- `apps/consumer/app/api/auth/reset-password/confirm/route.ts`
- `apps/consumer/app/(auth)/login/page.tsx`
- `apps/consumer/auth.ts`

Behavior:
- `/forgot-password` sends a reset email.
- Reset link opens `/reset-password?email=...&token=...`.
- User sets a new password without being signed in.
- Token is random, hashed with SHA-256 in `verification_token`, single-use, and expires after 60 minutes.
- Confirm route deletes token after use and updates `users.password_hash`.
- Login copy now distinguishes reset email from magic sign-in link.

Rationale:
- Troy needed to recover a password, not just receive a one-time sign-in link.
- This also improves normal user account recovery.

### Dev / Demo Access

Added local-only debug controls to save time and avoid burning email/API costs.

Key files:
- `apps/consumer/auth.ts`
- `apps/consumer/app/(auth)/login/page.tsx`
- `apps/consumer/components/DevToolbar.tsx`
- `apps/consumer/app/api/auth/[...nextauth]/route.ts`

Behavior in development only:
- Fresh Client Run: clears local Forge/progress/debug state, creates a fresh dev client user, and signs in.
- Client Login: reusable client account.
- Admin Login: full admin tier.
- Reset Local Flow Only: clears local flow state and returns to `/intro`.
- Dev login no longer counts against auth email/IP magic-link rate limits.
- Fixed dev toolbar bug: it was calling `signIn("credentials")`; correct provider is `dev-login`.

Rationale:
- Troy needs fast, low-cost, repeatable flow testing.
- Email links are too slow and unreliable for routine debug loops.
- Admin testing and fresh-client testing are different jobs and need separate controls.

## Security / Reliability Tightening

Key files:
- `apps/consumer/lib/forge-output.ts`
- `apps/consumer/app/api/assistant/route.ts`
- `apps/consumer/app/api/artifacts/route.ts`
- `apps/consumer/app/api/forge/download/route.ts`
- `apps/consumer/app/api/interview-practice/route.ts`
- `apps/consumer/app/api/job-search/route.ts`
- `apps/consumer/lib/forge-preload.ts`
- `package-lock.json`

Changes:
- Added Forge output normalizer supporting both `career_paths` and legacy `careerPaths`.
- Fixed silent personalization failures in jobs, interview, progress, and preload.
- Restricted assistant `systemOverride` to authenticated `disclosure-rehearsal`.
- Sanitized and length-limited rehearsal override.
- Added request-size cap to `/api/assistant`.
- Added runtime validation to `/api/artifacts`.
- Added type/format/content validation and caps to `/api/forge/download`.
- Fixed AI provider/model logging drift in interview wrap-up.
- Renamed job-search "Claude enrichment" drift to generic AI enrichment.
- Ran non-force `npm audit fix`.

## Written Inspection Summary

Created:
- `docs/REFINERY-LIVE-READINESS-SUMMARY-2026-06-06.md`

That file contains:
- Archived Refinery assessment.
- Live Crucible/Refinery assessment.
- Tool effectiveness ratings.
- Competitor/platform landscape.
- Research grounding review.
- Go-live risks.
- Remaining launch plan.
- Sources used for current external facts.

## Verification Performed

Commands run successfully:
- `npm run build -w apps/consumer`
- `npm run build -w services/worker`
- `git diff --check`

Audit:
- `npm audit fix` was run without `--force`.
- Production audit improved but still reports unresolved vulnerabilities requiring breaking dependency migrations.

Known audit state after this work:
- `npm audit --omit=dev` still reports production vulnerabilities.
- Full audit still reports more.
- Remaining fixes require deliberate migrations around Next, NextAuth, AI SDK, eslint-config-next/glob, and exceljs/uuid.

## Deployment Notes

Deploy from workspace root only.

Correct command:
```bash
vercel deploy --prod --yes
```

Do not deploy from `apps/consumer`; local workspace packages will fail.

After deployment, verify:
- `https://refinery.steelmanresumes.com/login`
- `https://refinery.steelmanresumes.com/forgot-password`
- `https://refinery.steelmanresumes.com/dashboard/resources`
- `https://refinery.steelmanresumes.com/dashboard/interview`

Deployment completed by Codex:
- Vercel deployment id: `dpl_HZmm2i3kYVzttXrCxBfryakhvdLu`
- Production URL: `https://the-crucible-qbxfqbowb-troy-carrs-projects.vercel.app`
- Aliases verified by `vercel inspect`:
  - `https://consumer-blond.vercel.app`
  - `https://forge.steelmanresumes.com`
  - `https://refinery.steelmanresumes.com`
  - `https://the-crucible-troy-carrs-projects.vercel.app`
- Created: 2026-06-06 18:32:36 CDT
- Status: Ready

Smoke tests performed after deploy:
- `GET https://refinery.steelmanresumes.com/forgot-password` -> `200`
- `GET https://refinery.steelmanresumes.com/reset-password` -> `200`
- `GET https://refinery.steelmanresumes.com/dashboard/resources` -> `302 /login` when unauthenticated
- `POST https://refinery.steelmanresumes.com/api/auth/reset-password/request` with a non-existing account -> `{"success":true}`

## CC / Claude Code: Where Codex Left Off

Continue here:

1. Verify production password reset email delivery for Troy's actual account.
   - Check that `AUTH_RESEND_KEY` and `AUTH_EMAIL_FROM` are correct in Vercel.
   - Send a reset email to Troy's actual account.
   - Confirm reset link writes `password_hash` and allows normal password sign-in.

2. Verify magic link separately.
   - It is now explicitly passwordless sign-in.
   - If it still fails, inspect Auth.js callback logs and Resend delivery logs.
   - Confirm production `AUTH_URL` matches `https://refinery.steelmanresumes.com`.

3. Run browser QA.
   - Login.
   - Fresh account / Forge / dashboard flow.
   - Second Chance Board.
   - Job search handoff.
   - Interview text practice.
   - Realtime voice practice with microphone permission.
   - Disclosure rehearsal.

4. Add cost guardrails for voice.
   - Max session duration.
   - Separate voice quota.
   - Better server-side usage logging.

5. Plan dependency migrations.
   - Do not run `npm audit fix --force` casually.
   - Create a migration branch for Next/NextAuth/AI SDK upgrades.

6. Employer/legal data hardening.
   - Add verification dates and confidence levels to employer signals.
   - Move legal/disclosure guidance toward source-backed jurisdiction data.

## Current Risk Call

Good for a controlled live demo after production smoke testing.

Not yet ideal for broad public launch until:
- Password reset is verified in production.
- Voice practice is QA'd in a real browser.
- Remaining production vulnerabilities are migrated deliberately.
- Legal/employer signal data has verification policy.
