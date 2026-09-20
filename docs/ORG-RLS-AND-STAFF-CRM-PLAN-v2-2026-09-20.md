# Org RLS + Staff CRM -- Plan v2 (after Codex review)

Date: 2026-09-20. Supersedes `ORG-RLS-AND-STAFF-CRM-PLAN-2026-09-20.md` (v1)
wherever they differ. v1 stays for its call-site table (2.1) and the CRM
surface descriptions (5.1-5.3), which stand. Review this answers:
`CODEX-WORLD-CLASS-REVIEW-2026-09-20.md`. Status: NOT BUILT.

## 0. Disposition of the review

I spot-checked the two findings that were cheapest to falsify before trusting
the rest. Both hold.

- **Finding 1 is right and v1 was wrong.** v1 said a self-inserted redemption
  "grants no staff power". `access_code.tier` allows `'admin'`
  (`006_access_control.sql:10`), `syncUserTierFromCodes` writes `admin` into
  `users.tier` from a redeemed code (`userTier.ts:69-75`), and
  `requirePlatformAdmin` authorizes on exactly that (`org-guard.ts:93`). A
  redemption row can be a platform-admin grant. That sentence in v1 was a
  confident guess I never tested -- the same failure as four of session 5's
  twelve defects.
- **Finding 7 is right.** `resolveOrgActor.ts:123-140` applies per-user deny
  overrides from `org_capability_override`. v1's `org_role IN (...)` policy
  clause would have handed content back to an admin whose capability was
  explicitly denied.

All twelve findings are accepted. Where I resolve one differently from the
review's suggestion, it says so below. One thing I hold to: the review's last
section (career-development method, pilot protocol, WCAG, WIOA reporting) is
good strategy and is NOT part of this build. It is recorded in section 8 so it
is not lost and does not grow the scope.

## 1. The trust boundary, stated once

Every app request connects as the one role `smr_app`, and the app sets its own
GUCs. So RLS here defends against a query that forgot its predicate, or ran
under the wrong resolved identity. It does NOT defend against arbitrary SQL
executed with the app credential. The security statement must say the first
and must not imply the second. Where this plan says "database-enforced" it
means exactly that and no more.

Consequence: anything where a forgotten predicate would MINT a privilege
(membership, grants, admin) is not left to a row policy that trusts a GUC. It
goes through one narrow function that re-checks the business rule itself.

## 2. Work that must precede enforcement (new stage P)

### P1. Platform admin stops being a redeemable entitlement (F1)

- New column `users.is_platform_admin boolean NOT NULL DEFAULT false`, set only
  by an owner-role script. `smr_app` gets no UPDATE on that column (column
  privilege). `requirePlatformAdmin` and `resolveOrgActor`'s `isPlatformAdmin`
  read it, not tier.
- `access_code.tier` CHECK drops `'admin'`. FIRST, as owner, list any existing
  `tier='admin'` codes and who redeemed them; those users get the flag by
  hand and the codes are retired (deactivate, never delete).
- `syncUserTierFromCodes` loses its `admin` branch. Verify it cannot downgrade
  anyone whose tier was not code-derived (today it writes `client` whenever
  the code lookup is empty -- which under RLS is also site 3's failure mode).
- Acceptance: a participant redeeming any code through any route cannot become
  platform admin; test it against all four redemption entry points.

### P2. Membership and seat semantics, written down, not changed (F3, F4)

- **Seats: already ruled.** `accessCode.ts` records Troy's 2026-06-10 ruling:
  a redemption is a durable seat, claimed once, kept. `times_redeemed` =
  lifetime seats claimed, minus only never-activated invites. v1's test
  "counter equals row count" was wrong and is deleted. The test becomes:
  counter never exceeds `max_redemptions`, increments exactly once per
  successful redemption, and delete-data does NOT refund.
- **Cardinality: preserve, do not enforce.** The code disagrees with itself:
  first-code-wins in `partnerTracking.ts:58` and `orgInvite.ts:104`, multiple
  codes allowed in `redeemAccessCode` and `hub-unlock`, and the dashboard
  handles multi-org people. No unique constraint is added. As owner, count
  users with more than one redemption in production so the decision (D8) is
  made on data. A test pins CURRENT behavior for two orgs racing for one user
  so a later change is deliberate.
- Longer term the org should be an `organization` row with enrollments,
  codes, entitlements and funding attribution as separate things (F3). That
  is post-demo and is the right home for enrollment episodes (4.2).

### P3. Split neutral conversion from behavior change (F2)

- **A1a, neutral:** sites 3, 4, 5, 7, 11, 12, 19, 22 swap `query` for a scoped
  helper. Nothing else. Deploy, run persona + staff batch.
- **A1b, behavioral, each with its own regression test and failure handling:**
  redemption consolidation, `auth.ts` fire-and-forget becoming awaited (it
  sits in the sign-in path: a thrown error there must not block sign-in; log
  and continue), invite revoke, the binding lookup.
- Corrected count: 22 SQL sites in 14 files under `apps` and `packages/core`.
  `services/` and `scripts/` are inventoried separately before A3.

### P4. The gate becomes a gate (F10)

- `org-isolation.yml` also runs on `pull_request`; path filters widen to
  `apps/consumer/auth.ts`, `api/user/**`, `api/hub-unlock/**`, `api/consent/**`,
  `api/assistant/**`, `lib/org-*`, and the new sharing/client-view paths.
- Authorization work goes branch -> PR -> required check -> merge. I do this
  myself; it does not change how Troy works elsewhere. Direct-to-main stays
  for everything outside those paths.
- Lint gate keys exceptions by file + function name + a reason string, not
  line numbers, and its own tests include an aliased table and a SQL fragment
  built by concatenation, which plain matching misses.
- `/api/health/rls` checks `pg_roles.rolbypassrls = false` for the session
  role, `relrowsecurity` AND `relforcerowsecurity` on every protected table,
  then positive and negative reads against maintained `(Demo)` fixtures. Zero
  rows from an empty table proves nothing.
- Disabling RLS is a SECURITY rollback. The runbook pairs it with turning
  `crm_v2` off everywhere and names who re-enables and when.

## 3. Part A revised -- redemption RLS

### 3.1 Policies

- SELECT: self or org-scoped, as v1.
- **No INSERT policy and no INSERT grant for `smr_app`.** No UPDATE. DELETE:
  org-scoped only (invite revoke). Self-leave goes through 3.2.
- Migration follows 046's pattern: `DROP POLICY IF EXISTS` before every
  create; after applying, assert the effective policy set and the effective
  grants from `pg_policies` / `information_schema.role_table_grants`, and run
  the migration twice.

### 3.2 Membership changes are functions, not inserts (F1, F3, F4)

SECURITY DEFINER, schema-qualified names throughout, `SET search_path =
pg_catalog, public`, `REVOKE ALL ... FROM PUBLIC` in the same transaction as
the create, EXECUTE to `smr_app` only, and `REVOKE CREATE ON SCHEMA public
FROM PUBLIC` verified. Owner must be verified to pass FORCE RLS on the tables
it touches (owner is subject to FORCE; it needs its own policy `TO` the owner
role, or BYPASSRLS). UNTESTED until run.

- `smr_redeem_code(p_user uuid, p_code text) RETURNS text` -- requires the
  code TEXT, so knowing an id is not enough. One statement claims the seat and
  inserts, with active, not expired, capacity, and tier all inside the claim.
  Returns `ok | already_member | full | expired | inactive | not_found`.
  Later (4.2) it also verifies the acknowledged policy version in the same
  transaction.
- `smr_attach_member(p_user uuid) RETURNS text` -- org attach for invites.
  Requires `app.org_id`, and requires `org.staff.invite` in `app.org_caps`
  (3.3). Same outcomes.
- `smr_leave_org(p_user uuid, p_org uuid)` -- one transition: end membership,
  remove assignments, revoke that org's grants via the system revocation path
  (F11), append consent events. No seat refund.
- Assignment invariant both ways: trigger on membership end removes
  assignments, AND `client_staff_assignment` INSERT gets a WITH CHECK that
  the client has a current redemption for that org (F4).

### 3.3 Capabilities reach the database (F7)

The resolver already computes effective capabilities with deny-wins. It sets a
fourth GUC, `app.org_caps`, a delimited list from `OrgScope`. Policies and
functions test a capability, never a role name. This stays inside the stated
trust boundary (the resolver is already trusted for `app.org_id`). `OrgScope`
gains `capabilities`; only `resolveOrgActor` can mint it, as today.

One authorization predicate, written once in SQL as
`smr_can_view(p_client uuid, p_scope text) RETURNS boolean` and mirrored once
in TypeScript: actor has a CURRENT `org_staff` row (or is owner) in
`app.org_id`; holds the capability; is assigned to the client or holds
`org.client.view_all`; client has CURRENT membership in that org; an unrevoked
grant exists for that scope in the current enrollment episode. Parity tests:
denied admin, custom-granted staff, removed staff, reassigned client, revoked
grant, expired membership.

`org.note.view_all` is removed from the staff bundle (v1 error).

### 3.4 Sites 6 and 8

- Site 8: **stop deleting shell users.** A pending shell with no membership is
  inert; deleting one whose ownership is uncertain is not. Revoke becomes one
  scoped statement: delete invite, delete this org's redemption, refund the
  never-activated seat, clear tokens. No cross-org question asked at all.
- Site 6 still needs "bound elsewhere". `smr_invite_binding(p_email text)`
  only answers inside an invite: requires `app.org_id` and `org.staff.invite`,
  returns `none | this_org | other_org`, and every call is audited. It is a
  deliberate, minimal, logged disclosure, identical to today's error message.
  It is a check for a good message, not the enforcement; enforcement is
  whatever D8 decides.

### 3.5 Platform-admin reads (F8)

The read-only `smr_admin` role, created in SQL, NOBYPASSRLS, per-table
`FOR SELECT TO smr_admin` policies, no EXECUTE on any mutating function, no
membership in other roles, grants only on the tables the admin surfaces read.
**The GUC fallback is removed.** Until Troy adds `ADMIN_DATABASE_URL`, the six
admin sites return an explicit "needs admin database credential" state.
Showing zeros is what defect 8 was. This makes D1 a precondition of A4 for the
admin surfaces only; A4 itself does not wait on it.

## 4. Sharing model revised

### 4.1 Staff never read base tables (F6)

v1 added a staff clause to the row policy on `job_application`. A row policy
admits whole rows, so it would expose the private `notes` column and salary,
and on `refinery_artifact` a resume grant would expose disclosure plans.

Base participant tables get an OWNER-ONLY policy. Staff read through
SECURITY DEFINER projection functions, one per scope
(`smr_staff_applications(p_client)`, `smr_staff_resume(p_client)`, ...), each
of which calls `smr_can_view`, returns only allowlisted columns, filters
`artifact_type` for its scope, and writes the `data_access_log` row in the
same transaction. If the audit insert fails the function raises and no content
is returned (F9). `orgClientView.ts` is the only caller, with a typed
projection per scope, used identically by API, CSV export, Today queue and
t.ROY context.

Vault: `sharing_grant` gains nullable `resource_id`; vault grants REQUIRE it.
There is no vault-wide grant (v1 promised per-document with no column for it).

### 4.2 Required sharing (F5) -- off the demo path, gated as before

- `org_sharing_policy_version`: immutable rows. Scope list, audience (assigned
  staff / all org admins), purpose, effective date, the exact text, and
  whether EXISTING artifacts are covered or only ones created after. Editing
  a policy creates a version. A new version never widens an existing grant.
- `sharing_ack(user, policy_version_id, acknowledged_at)`. Each grant
  references the version and an `enrollment_episode_id`, so leaving and
  rejoining starts clean and cannot revive an old grant.
- Enforced inside `smr_redeem_code` / `smr_attach_member`, so ALL four entry
  paths are covered, not just the code screen. A pending invite may hold a
  seat but opens no content until the person acknowledges.
- First-grant screen for `resume` and `documents` says plainly that older
  versions become visible, or the grant is "from today forward".
- Copy: the product describes its own controls only. "You can stop sharing
  here by leaving this program on Steel Man. We cannot tell you what your
  program's own rules are about that; ask them." v1's unconditional "you can
  leave at any time" is withdrawn.

### 4.3 Derived data is scoped data (F9)

- `progress` today bundles stage, counts, last-active and next-step. Counts of
  practice sessions and the existence of a disclosure plan are themselves
  sensitive. `has_disclosure_plan` moves under `disclosure`; practice counts
  under `practice`; struggle tags are a separate opt-in and never requirable.
  Queue reasons and empty states must not reveal an unshared scope ("no
  interview practice yet" vs "not shared" must look different only to someone
  allowed to know).
- Revocation/reassignment: bump an `authz_revision` per (client, org); caches,
  export jobs, downloads and AI tool calls carry the revision they were
  authorized under and re-check. Stated boundary: a request already in flight
  completes; a copy already downloaded is not recalled, and the participant
  page says so.
- Staff t.ROY: participant content is never written into stored staff
  conversation context or `decision_log` bodies; it is re-fetched through the
  projection each turn. Trace this before claiming it. Staff notes may
  contain copied participant details; say so and govern by retention, do not
  promise revocation erases them.
- The claim "staff can never see practice transcripts" is withheld until the
  decrypt and assistant-context paths are traced end to end.
- The log records a FETCH. The participant page says "opened", never "read".

### 4.4 Legacy consent backfill (F11)

The old `sharing` flag is per user, not per org. Backfill a `progress` grant
ONLY where the person had exactly one org membership when they granted it.
Anyone else is asked again. Keep the original `text_version`; record the
backfill itself as a system event with today's date rather than inventing a
per-org consent timestamp. Grants are participant-created; REVOCATIONS can
also be system-created (leave, deletion) through one server path that appends
to consent history and needs no impersonation.

### 4.5 Staff records (F12)

`case_note` gets a `case_note_version` table (append-only), author, and a
correction procedure. `outcome_record` gains `observed_at`, `verified_at`,
`verified_by`, `verification_method`, `evidence_ref`. Removing a user id does
not de-identify free text, so v1's D5 recommendation is withdrawn: no blanket
retention rule until the actual service relationships are reviewed.

Copy inventory widens to README, `scorm/README.md` and tablet/LMS material,
export files, support scripts and the demo narration. `scorm/README.md` says
intake answers live in the institution's `cmi.suspend_data`: the web app's
sharing boundary says nothing about what an LMS operator can read, and no
sentence may imply it does.

## 5. Sequence

Codex is right that a guaranteed Sunday/Monday finish is not justified, and I
said otherwise in v1. P1-P4 are new work. My recommendation to Troy: RLS is
enabled when its gates pass, on whichever day that is. The demo does not need
it enabled; it needs nothing on stage to be untrue.

1. **P1-P4** (admin flag, semantics written down, A1a/A1b split, PR gate).
2. **A**: functions + policies on a Neon branch as `smr_app`; migration run
   twice; grants asserted; then production.
3. **Demo slice, synthetic data, `crm_v2` on demo orgs only:** Wes shares his
   resume and applications by choice; Russ (assigned) opens the client page,
   asks t.ROY to prep, SAVES a note and sends one suggestion; Wes sees both,
   and sees that Russ opened his resume. A second staff identity is refused.
   App-enforced through `orgClientView.ts`; the statement says app-enforced.
   Required mode is not shown.
4. **Freeze Monday 6:00 PM Mountain, rehearsal on the frozen build.** Kept.
5. **After 9/22:** projection functions + owner-only RLS per participant table;
   then Today queue, tasks, suggestions, outcomes, reports -- each as a whole
   vertical slice including its export, deletion and revocation behavior;
   required mode last, behind legal review.

If step 3 is not clean by the freeze, the demo shows the existing console.

## 6. Release evidence (minimum, per Codex, all as `smr_app`)

denied capability; removed staff; two orgs racing for one user; two users
racing for the last seat; policy version changed during acknowledgement;
leave then rejoin; per-document vault limit; `notes` absent from every
applications projection; stale AI context after revocation; invite revoke
racing sign-in; migration re-run; and real business flows after RLS (register
with code, invite, hub-unlock, pre-auth sign-in, export, delete). The
production prompt batch supplements these. It does not replace them.

## 7. Decisions for Troy (replaces v1 section 7)

- **D1** Add `ADMIN_DATABASE_URL` in Vercel for the read-only admin role. No
  fallback now; admin cross-org pages say "unavailable" until it exists.
- **D2** Required sharing for real orgs only after legal review. Unchanged.
- **D3** `disclosure`, `vault`, and practice struggle tags never requirable.
- **D4** Salary excluded from `applications` by default.
- **D5** WITHDRAWN as a recommendation; needs review of real org
  relationships with D2.
- **D6** Per-note participant visibility, default off, plus the plain sentence
  that notes exist.
- **D7** Your wording for the "Not your case manager" promise.
- **D8 (new)** Can one person belong to two organizations at once? The code
  says both. I recommend YES (people move between programs, and the Waukesha
  hub already attaches a second code), with grants, notes and attribution
  strictly per org. Decide after seeing the production count from P2.
- **D9 (new)** Confirm platform admin becomes a flag only an owner-role script
  can set, and that `admin`-tier codes are retired.

## 8. Parked, on purpose

From the review's closing section, recorded so it is kept and not built here:
a versioned SMR career-development method, an authorization matrix, an
end-to-end pilot protocol written before results are collected, a release
evidence ledger tying each public promise to a verified behavior, WCAG 2.2 AA
as a verification target, and outcome data shaped so quarter-after-exit
employment and earnings can be represented later (distinct from 30/60/90
retention). The evidence ledger is the one I would start first, because
section 1.1 of v1 and section 6 here are already most of it.
