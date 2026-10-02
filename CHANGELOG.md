# Changelog

A dated, high-level history of what shipped, built from the commit log. Product facts only.

## 2026-10 Security maintenance

- Forge and Refinery moved from Next.js 14 to Next.js 15.5 and React 19. Next.js 14 no longer
  receives security fixes; the upgrade closes the framework advisories that were only fixed in 15.
  Request data (cookies, headers, page parameters) is now read asynchronously, as Next.js 15
  requires. No product behavior changed.
- Non-major dependency updates closed the high-severity advisories that had a same-major fix.

## 2026-10 -- Privacy hardening: shared computers, IP counts, AI records, analytics

- The Forge has a "Clear this computer" button in the header and a "Done, clear this computer"
  panel on the results page. It erases the site's browser storage and signs out. A Forge run
  left untouched for 24 hours is erased the next time the Forge loads.
- Per-IP abuse counts store a keyed HMAC of the address that changes every day, never the raw
  IP. A daily cron deletes usage counts older than 30 days and any leftover raw-IP rows.
- Every AI decision record now carries the user id when signed in, so "delete my data" removes
  it, and record notes no longer include job titles, companies, locations or roles a person typed.
- AI decision records now keep a keyed fingerprint of the input (an HMAC made with a server
  secret, 32 characters) instead of a plain 16 character hash, so a short input such as a job
  title cannot be recovered by guessing. Older records keep their old value.
- Analytics stay off the Vault documents page and `/access` invitation links (which carry a code
  and names), GA's opt-out flag blocks history page views on excluded pages, and Vercel events
  drop query strings. The Security & Privacy page caveats were updated to match.

## 2026-10 -- Privacy page matches the code

- The Security & Privacy page now says what anonymous use leaves behind (IP-based abuse counts,
  short AI records that can include a job title, work saved in the browser), names OpenAI's role
  in resume reading and as Claude's fallback, and drops claims the code did not support
  ("nothing is stored", "every AI interaction is logged", a US-only hosting line). The false
  phrases were added to the banned-claims check.

## 2026-09 -- Organization workspace, database-enforced boundaries, tablet package

- Organization boundaries moved into the database: Postgres row-level security on membership,
  staff, assignments, notes, tasks, outcomes, sharing records and audit tables. The application
  connects as a restricted role that cannot bypass those rules.
- Owner-only row-level security on a participant's applications, resumes, profile, vault
  documents and progress events. Staff read shared items through restricted views that do not
  contain private job notes, pay, or disclosure plans.
- An isolation suite runs as the restricted role on every pull request. A lint fails the build
  when application code touches a protected table through an unscoped helper. A live health
  check reports whether the rules are enabled, forced and non-bypassable.
- Participant-controlled sharing (built; enabled for demonstration organizations only):
  participants choose what to share with their case manager, item by item, and can stop at any
  time. Participants can see who opened what, and when. Disclosure plans, interview practice
  and stored documents stay private, and no program can require them.
- Staff workspace (built; enabled for demonstration organizations only): a work queue grouped
  by reason, caseload with filters, saved views and bulk assignment, versioned notes, tasks,
  job suggestions and comments beside shared documents, outcomes with retention check-ins,
  an organization chart with per-person access, staff invitations, and a funder export in
  which every figure says what it was counted over.
- Joining an organization now asks one plain question, once: may the organization see your
  progress? Yes sets the same sharing consent as the Settings switch and is recorded with the
  wording shown. "Not now" sends nothing. Not asked where a program requires sharing, of staff,
  or of anyone who already chose.
- The organization console tells a staff member with an empty list why it is empty and who to
  ask, and gives owners and admins the per-person "See everyone" switch on the main console.
  The default is unchanged: staff see only their own caseload until an admin decides otherwise.
- The join question, the Settings switch and the "Who Can See Your Data" section of the
  security page now say the same thing in the same plain words: what staff see when progress
  is shared, what can be shared one item at a time, and what no program can read. The Settings
  switch records its own wording version with each yes.
- Team & access: a line of help text showed raw escape codes instead of quote marks. Fixed.
- Platform administrator rights can no longer be granted by the application. Changes to who
  can see what are recorded in an append-only trail written by the database.
- Organization-side assistant: answers to staff are generated whole and checked against the
  organization's actual figures before they appear.
- Job search runs three providers concurrently. The truth gate names every ambiguity. ATS
  scorecard with one-click fixes. One-or-two-page rule enforced where the resume is printed.
- Forge Tablet: an offline SCORM package for in-facility learning systems, with a containment
  scanner, a printable resume, and a carry-out code that restores the work outside.
- Security sweep: partner landing pages read organization names from the database (no access
  codes in the source); the Forge package email requires a same-site request, sends only to a
  signed-in person's own address, and is capped per address and per connection each day, with an
  optional bot check; the public database health check returns only its verdict.

## 2026-08 -- Refinery revision, account security, hardening

- Refinery final execution plan, Phases 0-8: server-resolved approvals, an artifact revision
  model with provenance, consent enforcement, secure storage with encryption and a data
  lifecycle, lossless resume intake with fail-closed grounding, a job-posting snapshot with
  honest apply links, Settings and accessibility work, and a single Help and Feedback path.
- Materials and Vault as a long-term document home, a page-fit engine for DOCX output, and
  encrypted practice transcripts.
- Apply loop: find saved jobs, tailor, apply, move to the next job. Tailoring never downgrades
  a human-approved, lockable baseline. Tailoring can fetch the real posting from a pasted URL.
- Account security: hardened self-service passwords, two-factor authentication (TOTP) with
  backup codes, required for administrators, new-device sign-in alerts, active-device list
  with revoke, and a workspace switcher for people with two roles.
- Security fixes: redirect re-validation in job-posting fetch (SSRF), an account-takeover path
  in the invite registration form, server-side consent enforcement for disclosure processing,
  spend controls on the unauthenticated Forge path, and a cross-user browser storage bleed.
- Versioned Terms, Privacy and AI-consent at registration. Complete delete and export.
- The assistant gained tools: take the person to the right screen, highlight an element,
  report live status, escalate a message to a human. Optional Google sign-in and Turnstile.
- Fair-chance employer flag restricted to exact matches in a verified employer table.
  `apps/web` and `services/worker` archived as inactive.

## 2026-07 -- Hand-Forged Terminal design system

- Design system ported into the consumer app and applied across every Refinery surface.

## 2026-06 -- Truth gate, journey intelligence, first cohort readiness

- Truth gate: evidence-only generation enforced in every resume and cover-letter lane.
- Structured base-resume builder in The Forge with bullet evidence, a parser preview, and
  the rename of the Resume Builder to the Application Tailor.
- Central tiered AI model router, Anthropic primary with OpenAI failover, a skills library for
  the assistant with a deterministic delivery probe, and a cited web-search tool for the coach.
- Seven-stage journey with progress bar, progressive tool unlocks, disclosure planning with
  "coaching, not legal advice" on every output, text and live-voice interview practice,
  a follow-up message generator, and unified PDF export.
- Verified fair-chance employer directory and a Department of Labor job-data fallback.
- Cohort seat codes with code-aware usage limits, a consent-gated partner cohort view, a true
  password reset flow, a system health panel, and a cinematic product walkthrough.

## 2026-02 to 2026-05 -- Foundation

- Career-intake pipeline: staged analysis and parallel artifact generators behind a queue.
- Consumer app: The Forge (free, no login), The Refinery (authenticated), access control and
  tiered rate limits, and the page assistant, later named t.ROY.
- Rule set early and kept: incarceration never appears on paper. Resume workspace with live
  preview, a research-backed context library, security audit fixes and auth rate limiting.
