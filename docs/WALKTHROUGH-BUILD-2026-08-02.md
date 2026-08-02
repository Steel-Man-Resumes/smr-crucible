# Walkthrough Build -- 2026-08-02

What shipped from the two walkthrough feedback docs, what is dark behind env
flags awaiting Troy's credentials, and what was deliberately held.

## Shipped and live (verified on production)

**P0 batch** (commit `49ff955`): Contact Troy button removed; bullet-workshop
work can no longer be lost (localStorage persistence per bullet); field
overflow fixed (auto-growing textareas for bullets/credentials); preview panel
labeled + letter-page proportions; skills bubbles get three genuinely distinct
colors; partner demo end + partner sign-in dead-ends closed; job-search
failures surface to the user instead of a silent empty result; last job search
persists 6h; "General" chip is now "Base resume" and cannot be deleted;
apply_url stored (migration 021, applied to prod DB) with a real apply action
in the pipeline; dashboard shows the resume front and center.

**P1 batch** (commit `0810c03`): Refinery nav reordered (Job Board leads,
Application Tailor repositioned advanced); GuidedTour first-run orientation
wired in; journey banner shows path + payoff + CTA; t.ROY intro states it is
AI; three paths moved up with button affordance; goals questions open by
default with voice input; preferences multi-select; paste path routed through
the AI parser with a "have your own AI write it" prompt; downloads at the
build stage collapsed behind an explained "need it now?" control; confetti on
completion (reduced-motion safe).

## Dark builds -- flip on by adding env vars (Vercel project `consumer`)

### Sign in with Google
Code is live but invisible until these exist:

1. Google Cloud console (console.cloud.google.com) > APIs & Services >
   Credentials > Create OAuth client ID (Web application).
   - Authorized origins: `https://forge.steelmanresumes.com` (and the
     refinery domain if separate)
   - Redirect URI: `https://forge.steelmanresumes.com/api/auth/callback/google`
2. Set env vars: `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`, and
   `NEXT_PUBLIC_GOOGLE_AUTH=1` (the last one shows the button).
3. Redeploy. Existing same-email accounts link automatically (intentional --
   Google verifies emails; see comment in `auth.ts`).

### Turnstile bot defense (account creation)
1. Cloudflare dash > Turnstile > Add site (domain: steelmanresumes.com).
2. Set `NEXT_PUBLIC_TURNSTILE_SITE_KEY` (shows the widget) and
   `TURNSTILE_SECRET_KEY` (enforces server-side on /api/auth/register).
3. Redeploy. Fails open if Cloudflare is unreachable -- shield, not gate.

### Job-search providers
- JSearch quota is the near-certain cause of the "4-5 searches then nothing"
  bug. Check the RapidAPI dashboard plan/quota for `JSEARCH_API_KEY`. Failures
  now show the user an honest error either way.
- CareerOneStop fallback exists but its creds returned 401 (2026-06-07).
  Re-register at careeronestop.org/Developers -- set `CAREERONESTOP_USER_ID` +
  `CAREERONESTOP_TOKEN` and the fallback goes live with zero code changes.

## Held (documented, not built this session)

- Twilio SMS reminders -- scaffolding exists (env checks, profile fields); the
  send/reminder wiring is a design decision (what messages, when) before code.
- Indeed as a second provider + cross-provider de-dup.
- Email-me-my-package capture at Forge end.
- Company/role research assist button (accepted AI cost -- needs a spec pass).
- Print take-away package (narrative pamphlet + resources + QR to Refinery).
- Methodology page layered disclosure restructure.
- Partner dashboard build-out (Marianne/workers hierarchy) and
  PartnerView/User toggle + assist-as-user with acting-as banner.
- Defensibility checklist made mandatory with typed-name ownership.
- Extending guided multiple-choice to more analysis fields.
- Per-screen purpose headers as a sweep; final-output lead-with-preview
  reordering; t.ROY icon rebrand; help-resource link refresh; file-upload
  submission education; "coming soon" tracking stub.
