# Session handover -- SMR Crucible, 2026-09-20 (session 7)

For the session taking over. Read this, then `HANDOFF.md` (top entry, session 7) for the full
narrative. Production `7f11e07`. Migrations 047-060 applied. `GET /api/health/rls` = 200,
role `smr_app`, 19 tables enforcing. Isolation suite 250/250 as the restricted role.
Working tree clean, everything pushed, no open PRs.

Troy's goal, in his words: "the single best reentry platform." He sends ideas as separate
prompts as they occur to him; that is normal, not scope creep. He said he will pressure test
this portion next, then fix the SMR website for SEO/AEO and wants capability claims accurate.
Demo: Tuesday 2026-09-22, 3:00 PM Mountain (Montana DOC/DLI). Troy is handling the demo and
rehearsal himself. He does all browser checks if given step-by-step directions.

## 1. What this session built (all live in production)

**Database enforcement**
- App connects as `smr_app` (NOBYPASSRLS). 19 row-level-protected tables: org_staff,
  client_staff_assignment, org_audit, access_code_redemption, sharing_grant, sharing_request,
  case_note, case_note_version, org_sharing_policy_version, sharing_ack, staff_task,
  outcome_record, retention_check, staff_suggestion, vault_document, user_progress_event,
  consumer_profile, refinery_artifact, job_application.
- Participant-owned tables are OWNER-ONLY. Staff/admin read through security_barrier views:
  `staff_shared_application`, `staff_shared_artifact`, `staff_progress_counts`,
  `admin_job_application`, `admin_refinery_artifact`. Aggregate reports and the nightly
  tracking cron use `smr_funnel_counts` (seven integers, nothing about any person).
- Still enforced in APPLICATION code, and documented as such: which colleague inside an
  organization may open a given participant (`packages/core/src/orgClientView.ts`).
- Helpers in `packages/core/src/db.ts`: `runScoped`, `runPerOrg`, `runAsUser`, `queryAsUser`,
  `getOneAsUser`, `insertAsUser`. `query`/`getOne`/`insert` are UNSCOPED and return nothing
  from a protected table without throwing.
- Gates: `scripts/lint-protected-tables.mjs` (CI, every push), `scripts/verify-org-isolation.mjs`
  (CI on PRs, fresh Neon branch, as smr_app), `scripts/lib/restricted-grants.mjs` (asserted),
  `/api/health/rls` and `/api/health/version`.

**Identity and membership**
- `platform_admin` table: the app can read it and not write it. Make an admin only with
  `node scripts/platform-admin.mjs grant <email>` (owner credential).
- `smr_redeem_code` is the only way a membership row is created. `smr_leave_all_orgs`,
  `smr_invite_binding`. Membership changes are audited.

**Sharing (flag `access_code.crm_v2`, demo orgs only)**
- Only the participant can create a grant. Scopes: applications, resume, documents.
  Never shareable or requirable: disclosure plans, interview practice, vault files.
- Staff request with a reason; participant answers; participant sees who opened what.
- Required sharing (flag `access_code.required_sharing_enabled`, demo orgs only): immutable
  policy versions, nothing opens without the person's own acknowledgement, never called
  consent, "only my case manager" and "from today on" enforced in SQL.
- Participant-facing wording lives in `packages/core/src/sharingScopes.ts`, versioned
  (`2026-09-20.3`) and stamped on every grant.

**Staff workspace (behind `crm_v2`)**
- Today queue, caseload (find/sort/filters/saved views/bulk assign), participant page
  (notes, tasks, suggestions, outcomes + retention, "their screen", shared tabs), team org
  chart with per-person capability switches, staff invites, Insights with funder export,
  sharing policy page, one org-wide "quiet after N days".
- Staff Settings: "My workflow"; job-seeker sections hidden for anyone with an org role
  (NOT flagged; applies to all orgs). Staff have NO resume workspace (Troy's ruling).

**t.ROY**: boundary fixes only. Browser-supplied `context.org` is server-owned; staff lookup
failure returns 503. The tuned staff prompt and checker were NOT changed except to read the
org's quiet threshold, byte-identical at the default.

**Fixes to pre-existing defects found along the way**
- "Download my data" was failing for every user in production (wrong column name). Fixed.
- Next.js was caching Neon HTTP queries across deploys. Fixed with `cache: "no-store"` on
  every `neon()` client. OTHER NEXT+NEON REPOS OF TROY'S LIKELY HAVE THIS BUG.
- Production had silently reverted to the owner DB role (all policies inert). Re-cut over.
- CI had been testing a database where the app could forge the audit trail.
- `_migrations` ledger was missing 044-046. `hub_preauthorizations` and
  `org_capability_override` never existed. Resource search showed Milwaukee to everyone.
- "Delete my data" did not remove progress events or release caseload assignments.

## 2. Documents to read

| File | What it is |
|---|---|
| `HANDOFF.md` (session 7 entry) | Full narrative, every decision, every mistake |
| `docs/ORG-RLS-AND-STAFF-CRM-PLAN-v2-2026-09-20.md` | Governing plan (v1 kept for its call-site table) |
| `docs/CODEX-WORLD-CLASS-REVIEW-2026-09-20.md` | Codex's 12 findings on the plan, all accepted |
| `docs/TROY-AGENT-ASSESSMENT-AND-DEFENSE-ARCHITECTURE-2026-09-20.md` | Codex on t.ROY |
| `docs/TROY-AGENT-PLAN-2026-09-20.md` | My answer: waves T1-T6 |
| `docs/CAPABILITIES-TRUTH-SHEET-2026-09-20.md` | What may be claimed publicly, with evidence. USE FOR WEBSITE COPY |
| `~/todash/smr/MT-DOC-DEMO-COHORT-AND-STAFF-HANDOFF-2026-09-20.md` + `...-RESPONSE-...` | Demo cohort source and what I did with it |
| `~/todash/clients/STATUS.md` | Operator ledger, five entries from today |

## 3. Demo

- Accounts, password `BigSkyDemo!2026`: `dana.whitcomb@mtdemo...` (owner),
  `russ.feeney@mtdemo...` and `alma.trejo@mtdemo...` (staff), `wes.duvall@mtdemo...`
  (participant), `yvonne.carrasco@midemo...` (owner, Michigan). All `@...example.invalid`.
- `node scripts/seed-demo-cohort.mjs` IS the Montana reset. Six fictional people; Wes starts
  sharing nothing so the ask/approve/read story runs live. Run before each rehearsal.
- Every demo-org staff screen carries a "Sample data" line. Employers are real and vetted;
  nothing marks any employer as fair-chance.
- OPEN HAZARD, Troy's call, not changed: demo codes are tier `partner`, so anyone who
  registers live with `MTDEMO` lands in the STAFF view. One UPDATE to tier `client` fixes it.
- The cohort is SIX people now; the run sheet may still say five.

## 4. Rules I worked by (keep them)

1. Authorization work: branch -> PR -> CI green -> merge. Never straight to main.
2. Migration order: anything new code needs to EXIST (tables, views, functions) goes to
   production BEFORE the code merges. POLICIES that old code would break go AFTER the new
   code is live. I got this wrong once: 90 seconds of staff-console errors.
3. Poll `/api/health/version` for the SHA before verifying anything live.
4. Test the claim, not the code. Mutation-check a new guard: break the rule, see the suite fail.
5. For risky RLS changes, REHEARSE: `node scripts/neon-branch.mjs create X`, migrate,
   `node scripts/rls-stage1-create-role.mjs`, build, then `next start -p 3199` with
   `DATABASE_URL` = the URL in `.env.smr-app`, and walk real routes. curl will not store the
   Secure session cookie over http: take it from the Set-Cookie header and send it by hand.
   The auth rate limiter is in-memory; restart the server if logins 429. Kill by PORT, not
   `pkill -f` (it matched and killed my own shell).
6. Inspect the schema before writing SQL against it. I guessed a column name four times today.
7. Local `apps/consumer/.env.local` DATABASE_URL is the PRODUCTION OWNER. Be careful.
   Never print or `source` it; parse it in Node.
8. Wording rules from CLAUDE.md: justice-impacted, fair-chance, no em dashes, no emojis.
9. A preference, setting or public claim that does nothing is a lie. Wire it or leave it out.

## 5. What to do next, in order

**A. Before Tuesday (small, safe)**
1. Ask Troy about the demo-code tier hazard (section 3) and fix it if he says yes.
2. Reconcile the run sheet with the six-person cohort.
3. Do not touch the staff assistant prompt or checker before the demo.

**B. The biggest gap: route-level tests for participant flows.** The export bug had no test.
The isolation suite tests core functions; nothing walks the Refinery's authenticated routes.
Build a harness on the rehearsal method in rule 5: log in as a seeded participant against a
Neon branch and assert on `/api/applications` (list/save/dedupe/status), `/api/artifacts`,
`/api/user/profile`, `/api/user/context`, `/api/user/journey`, `/api/vault/documents`,
`/api/user/export-data`, `/api/user/delete-data`, `/api/sharing`, `/api/tasks`,
`/api/suggestions`, and registration with a code. Put it in CI.

**C. t.ROY waves T1-T3** (`docs/TROY-AGENT-PLAN-2026-09-20.md`). T1 needs a production batch
of 20-30 staff prompts with every flagged answer read by hand; session 6 is the template.
Add Codex's three layer-1 misses to `scripts/verify-org-output-judge.mts` first. T3 is what
Troy actually wants: per-participant prep from shared materials, and Save as note
(`case_note.drafted_by_assistant` and the `add_note` API already accept it).

**D. Two gates before any real organization gets `crm_v2`:** Troy's rewrite of the
`/security` promise (`components/SecurityContent.tsx`), and a lawyer's read of
`SHARING_REQUIRED_TEXT`. Neither is yours to do. Remind him.

**E. Smaller items, any order**
- Lint cannot see SQL built in a variable. Consider banning that pattern for protected tables.
- `/api/hub-unlock` stores preauthorizations that nothing consumes at sign-up.
- Invite revoke leaves inert shell accounts; needs a retention sweep.
- Invites still refuse someone bound to another org although D8 = yes; relax it now that
  sharing is per organization (check the legacy `sharing` flag interaction first).
- `components/auth/AccountTypeChooser.tsx` still argues for the two-workspace model Troy reversed.
- Vercel PREVIEW `DATABASE_URL` is invalid, so no PR gets a preview build. Troy's to fix.
- `feat/multilang-phase1` has a migration numbered 044 that was run against production;
  renumber before merging.
- Not built: staff emailing a participant's resume to an employer. It needs its own consent
  scope ("send this for me"). Not built: a participant-generated proof-of-job-search log.
- Check Troy's other Next+Neon repos for the fetch-cache bug (tmg-portal, waukesha-hub,
  jbs-portal, grant-os-portal, mke-reentry-hub).

**F. Website copy.** Use the truth sheet. If Troy wants a comparison with HonestJobs or
others, that needs a sourced research pass first; nothing about competitors has been verified.
