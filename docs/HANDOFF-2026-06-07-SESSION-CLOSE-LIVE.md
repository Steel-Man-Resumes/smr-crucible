# Steel Man -- Session Close + LIVE (2026-06-07, Opus 4.8)

**For the next Claude Code instance. Read this first, then `HANDOFF.md`, then
`~/todash/smr/SMR-OPUS-ASSESSMENT-AND-BUILD-DESIGN-2026-06-07.md` + the master plan.**

---

## 0. YOUR JOB WHEN YOU PICK UP

The platform is **deployed LIVE in production**. Troy is about to test the **entire
flow end-to-end as a brand-new user** -- "a stranger from the streets" -- using a fresh
Google account under the name **Marcus Raleigh**. He is taking **a complete set of
notes of everything that is wrong.**

**Expect a feedback / bug dump as his next message.** Your job: receive it, analyze and
triage it (severity + root cause), reproduce against the live app/DB, fix, verify, and
redeploy. Do not start new features until his feedback is worked through. He is testing
as the user, so prioritize anything that breaks or confuses the real journey.

---

## 1. Live state (as of this close)

- **Production:** `forge.steelmanresumes.com` + `refinery.steelmanresumes.com`. Vercel
  project **the-crucible** (`prj_Y05eliHgrKIr4Y0TcCgvG8VATwZH`, team
  `troy-carrs-projects`). **Git-connected: a push to `main` auto-deploys production.**
  Deployed commit this session: `04cdd8c` (verify it reached READY).
- **DB:** the new dedicated Neon (Steel-Man-only), 18 migrations (001-018), **seeded**:
  sentinel org, admins (`troyrichardcarr@gmail.com` + `marcusinplainsight@gmail.com`),
  Dr. Baker partner + `BAKER2026` (linked) + `JFW2026`, a labelled demo client
  (`demo-client@steelmanresumes.demo`, Stage 5), and 67 employers (18 published).
- **Env:** prod + preview set with the new keys. Health-verified: Resend sending domain
  `steelmanresumes.com` **verified**, Anthropic + OpenAI keys **valid**, R2 +
  `DOCUMENT_ENCRYPTION_KEY` set. **`MOCK_AI` is OFF in prod -- real AI, real spend** on
  Troy's test (intended).
- **Sign-in:** email magic link via Resend (no Google OAuth provider exists). Troy's new
  Gmail receives the link. Admin tier = his email. Health/admin: `/dashboard/admin` +
  `/dashboard/admin/health`.

## 2. How Troy is testing (so you can reproduce)

- He starts on **steelmanresumes.com** (the marketing site -- a SEPARATE repo
  `smr-website`, NOT this one, not redeployed this session), clicks through to **The
  Forge** (`forge.steelmanresumes.com`, this repo), runs the Forge (he has a sample
  resume on his Desktop: `Marcus-Raleigh-Sample-Resume.txt` -- warehouse/CDL background
  matching the verified employers), creates an account (magic link to his new Gmail),
  then walks **The Refinery** journey: jobs, resume builder, disclosure, interview,
  applications, coach, **Verified Employers** (`/dashboard/employers`), **My Materials**
  (`/dashboard/vault`). As admin he can also see the **Partner Dashboard** and
  **System Health**.
- If something in the marketing-site -> Forge handoff is wrong, that may be the
  `smr-website` repo, not this one.

## 3. What was built this session (all live now)

- **Journey instrumentation, Stages 3-6** -- the engine now advances on real data
  (resume link, disclosure save, interview practice record, apply/follow-up). 13/13 +
  10/10 + 5/5 verified vs the live DB.
- **Privacy + pedagogy revision** -- practice tools store the FRAME + whether the point
  landed, never the user's words/transcript/audio; the "Nothing here is saved" copy was
  replaced with honest, secure wording. (Troy's rule: teach frames, not scripts.)
- **W7 partner dashboard** -- consent-gated cohort (`/dashboard/partner`), client
  "share progress" toggle in Settings, CSV export. Keyed on access-code ownership.
- **W5 materials** -- follow-up generator (applications page) + "My Materials" vault.
- **W9** -- system health panel (`/dashboard/admin/health`, `getSystemHealth()`) +
  **verified-employer board** from the SMR Employers Airtable (real data).
- **Cutover tooling** -- `packages/core/scripts/seed-universe.ts` (idempotent) +
  `packages/core/scripts/import-employers.ts`.
- **W10 OSS prep** -- AGPL-3.0 LICENSE, public README/SECURITY/CONTRIBUTING; secret
  scan CLEAN (0 matches in all history); `MOCK_AI` excluded from prod.

## 4. Critical things to know

- **Verify, don't assume.** Prove against the live DB / running app; "it built" is not
  "it works." Throwaway verify scripts go in `packages/core/src/_verify_*.ts`, run with
  `npx tsx`, then delete. Load `DATABASE_URL` from `apps/consumer/.env.local` inside the
  script (never print secrets).
- **Brand/mission guardrails:** justice-impacted (never ex-offender/second-chance),
  fair-chance, no em dashes, no emojis, coaching not legal advice, 6th-grade copy.
- **Privacy doctrine:** never store practice answers/transcripts/audio; progress +
  frames only; sharing is consent-gated.
- **Deploy care:** push to `main` = production. For risky changes, use a branch (Vercel
  builds a preview) and only merge to `main` when verified. The backup branch
  `session/journey-instrumentation-2026-06-07` mirrors what shipped.
- **Tier tension (unresolved):** redeeming a partner access code elevates the redeemer
  to tier `partner`, which skips the client journey/onboarding. Pilot job-seekers should
  not redeem the partner code, or split "role" from "rate-limit tier." W7 sidesteps it.
- **WSL friction:** the `vercel` CLI on PATH is the Windows binary and HANGS -- deploy
  via git push, not CLI. `tsx` transpiles to CJS (async IIFE, no top-level await /
  `import.meta`). `source ~/.nvm/nvm.sh && nvm use 20`.
- **Airtable employers:** base `appiBoJpK5Q7DgkDU`, PAT in `apps/consumer/.env.local`
  (the MCP connector can't see it). Re-import: `npx tsx packages/core/scripts/import-employers.ts`.
- **Legal/entity:** Steel Man Resumes LLC (WI), EIN on file. Filing + EIN PDFs saved
  privately at `~/todash/smr/legal/` (gitignored). Copyright = Steel Man Resumes LLC
  until the nonprofit transition. Repo goes public Aug 15.

## 5. What remains (after Troy's feedback is worked through)

1. **Triage + fix Troy's test feedback (PRIMARY).**
2. Coach real browser QA.
3. Playwright smoke pass (none exist; needs a running target -- use the preview).
4. PWA (manifest + service worker + icons).
5. W6 Twilio (A2P pending), W5 R2 encrypted upload, employer admin publish-toggle,
   feature-flag UI, `api_key_registry`.
6. Airtable employer data has ~8+ duplicate rows -- Troy to dedupe at source.
