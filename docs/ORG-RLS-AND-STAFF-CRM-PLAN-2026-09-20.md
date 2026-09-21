# Org RLS Completion + Staff CRM With Participant Sharing -- Plan

Date: 2026-09-20 (Sunday). Author: CC. Status: DRAFT FOR CODEX REVIEW, not yet built.

> **SUPERSEDED IN PART by `ORG-RLS-AND-STAFF-CRM-PLAN-v2-2026-09-20.md`** after Codex review. Known wrong here: 2.3 ("grants no staff power"), 2.6 fallback, 2.7 seat invariant, 3.2 staff row policy, 4.3 "leave at any time", 5.5 staff bundle, D5.
Production at time of writing: `9611457`. Demo: Tuesday 2026-09-22, 3:00 PM Mountain.

Troy's instruction: finish the RLS work now, make the staff CRM really good,
let staff see participant data when the participant shares it, account for
programs where sharing is REQUIRED, and give staff a real interface to help.

## 0. How to review this document (Codex)

Every factual claim about the code below was read from the repo on 2026-09-20,
but a plan is a hypothesis. Please attack these first:

1. **The call-site inventory in 2.1.** I count 23 SQL statements in 14 files;
   session 6 counted 22 in 13. Recount. A missed site is a silent empty result.
2. **The classification column in 2.1**, especially sites 6, 8 and 5, where an
   empty result does not show an error, it takes a WRONG ACTION.
3. **The policy SQL in 2.3.** Permissive policies OR together. Look for a
   clause that lets an UPDATE move a row across orgs (defect 2 of session 5).
4. **Section 4.3, required sharing.** Is there any path where flipping an org
   setting exposes data a participant shared under older, narrower wording?
5. **Section 3.2**: can a policy subquery against another RLS table behave
   differently than I claim? I have not run it. It is marked UNTESTED.

Claims I have NOT tested are marked UNTESTED. Everything else is "read in the
code", which is still weaker than "run as smr_app".

## 1. What exists today (verified by reading, 2026-09-20)

- RLS enabled and forced on `org_staff`, `client_staff_assignment`, `org_audit`.
  App connects as `smr_app` (no BYPASSRLS). GUCs: `app.org_id`, `app.user_id`,
  `app.org_role`, transaction-local. Helpers in `packages/core/src/db.ts`:
  `runScoped`, `runAsUser`, `queryAsUser`, `getOneAsUser`. `query`/`getOne`
  are unscoped.
- CI gate `.github/workflows/org-isolation.yml` runs the suite as `smr_app` on
  a throwaway Neon branch. 13 assertions.
- Staff console is ONE component, `apps/consumer/components/org/OrgDashboard.tsx`
  (820 lines): stat tiles, staff tiles, roster, invite form, one client table.
  **There is no per-client page.** No dynamic route exists under the dashboard.
- Staff see, per sharing participant: name, email, stage, next-step action,
  counts (applications, saved jobs, practice sessions), three booleans (resume
  tailored, disclosure plan exists, hired), last active, assigned staff.
  **Zero content.** Query at `partnerDashboard.ts:182-201`.
- Staff can write: assign client, add/re-role/remove staff, invite/resend/
  revoke. **No notes, tasks, contact log, outcome records, or messaging.**
  t.ROY drafts a case note and nothing can save it.
- Consent: `consumer_consent` (current state) + `consumer_consent_event`
  (append-only, records `text_version`). Layers: core, enhanced, research,
  sharing, outcome_anonymous, outcome_named. **One boolean, `sharing`, decides
  whether a participant appears in the cohort at all.** No scopes, no
  per-purpose grants, no required mode, no staff-side request flow.
- `data_access_log` exists and cohort reads already write to it
  (`recordDataAccess`). No participant-facing view of it.
- Capabilities are an allowlist in `packages/core/src/authz/capabilities.ts`.

### 1.1 Promises already made in the product that this work would break

These are live, public, and currently TRUE. Shipping content sharing without
changing them first makes them false.

- `components/SharingConsentSection.tsx:61` -- "They never see your resume,
  your disclosure plan, ..."
- `components/SecurityContent.tsx:60-61` -- "Not your case manager", "Not your
  parole officer".
- `components/org/OrgDashboard.tsx:780` -- "You never see their ..."
- `app/(forge)/partner/page.tsx:39` -- "You can't see anyone who hasn't
  explicitly opted in -- that's not a limitation, it's the design."
- `docs/REFINERY-10X-PLAN.md:368,532` -- the doctrine those came from.
- From the 2026-09-18 market-lead review: tablet answers live in
  `cmi.suspend_data` while the data-flow one-pager says staff cannot see
  answers. Same family of claim; check it in the same pass.

**Rule for this whole plan: the words change in the same deploy as the
behavior, never after.** And every existing `sharing` grant was given under
the old words, so it maps to the narrow `progress` scope ONLY, forever, until
that person grants more under new words.

## 2. Part A -- RLS on `access_code_redemption`

### 2.1 Inventory and classification

"Empty means" is what happens if the site is left unconverted once RLS is on.
That column is the point of the table.

| # | Site | Who is asking | Empty means | Conversion |
|---|------|---------------|-------------|------------|
| 1 | `orgStaffAdmin.ts:123` EXISTS inside `scopedQuery` | org admin, scoped | refuses a legitimate add | none; already org-scoped. Add test. |
| 2 | `auth.ts:365,368` pre-auth INSERT via pg `Pool`, fire-and-forget | system, for subject | pre-authorized partner never attributed; swallowed | replace with `redeemForUser` (2.4) |
| 3 | `userTier.ts:50` `syncUserTierFromCodes` | subject (sometimes called inside an admin's invite) | **tier silently DOWNGRADED to client** and written to `users` | `getOneAsUser(subject)` |
| 4 | `rateLimit.ts:212` `getUserDailyLimit`, every AI call | subject | **falls to 30/day then "enter a partner code"** -- the exact session 6 symptom, for every participant | `getOneAsUser(subject)` |
| 5 | `partnerTracking.ts:58` first-code-wins check | subject | **user is REBOUND to a second org** | `getOneAsUser(subject)` |
| 6 | `orgInvite.ts:104` "is this email bound to another org" | org admin reading ANOTHER org's row | **org poaches a participant bound elsewhere** | `smr_redemption_binding()` (2.5). Cannot be a policy. |
| 7 | `orgInvite.ts:212` DELETE on revoke | org admin, own org | invite revoked but seat never freed; counter drifts | `runScoped` |
| 8 | `orgInvite.ts:230` NOT EXISTS any redemption, then DELETE user | org admin, cross-org | **deletes a `users` row that still belongs to another org; cascades** | `smr_redemption_binding()` |
| 9 | `accessCode.ts:129` already-redeemed check | subject | double redemption attempt; unique index catches it, seat refunded | folded into 2.4 |
| 10 | `accessCode.ts:157` INSERT | subject, or admin attaching | redemption fails after seat claimed | folded into 2.4 |
| 11 | `accessCode.ts:202` `getUserAccessCodes` | subject | settings shows no codes | `queryAsUser` |
| 12 | `partnerDashboard.ts:130` cohort membership, 3 modes | by code / owner across codes / platform admin | console shows zero participants | by code: `runScoped`. Owner multi-code: one transaction re-scoped per code (pattern already proven in `/api/dev/personas`). Admin: 2.6 |
| 13 | `partnerDashboard.ts:497` EXISTS inside `runScopedRows` | org admin, scoped | refuses legitimate assignment | none; add test |
| 14 | `outcomeAggregate.ts:72` funnel | platform admin (`/api/admin/evidence`) | zeros in evidence report | 2.6 |
| 15 | `outcomeAggregate.ts:173` case studies by partner | platform admin | empty | 2.6 |
| 16 | `outcomeAggregate.ts:192` partner name subquery | platform admin | NULL partner name | 2.6 |
| 17 | `api/dev/users/route.ts:25` | platform admin | blank code column | 2.6 |
| 18 | `api/dev/orgs/route.ts:35` | platform admin | every org shows 0 members (defect 8 again) | 2.6 |
| 19 | `api/user/export-data/route.ts:276` | subject | **export silently omits org membership** -- a data-rights defect | `queryAsUser` |
| 20 | `api/hub-unlock/route.ts:59` read | system (Waukesha hub), for subject | duplicate insert attempt | folded into 2.4 |
| 21 | `api/hub-unlock/route.ts:66` INSERT + counter | system, for subject | not attributed | folded into 2.4 |
| 22 | `api/user/delete-data/route.ts:126` DELETE | subject | **"data deleted" reported, membership survives** | `queryAsUser` DELETE ... RETURNING, assert |
| -- | scripts (`seed-*`, `retire-access-codes`, `verify-org-isolation`) | owner role | n/a | already assert bypass role; no change |

Sites 3, 4, 5, 6, 8, 19, 22 do not fail visibly. They are the reason this is
staged the way 2.2 stages it.

### 2.2 Rollout order -- convert first, enforce second

Session 5 enabled policies and converted callers in the same push, which is how
two silent-empty paths reached production. This time:

1. **A1. Convert every call site while RLS is still OFF on this table.** The
   helpers only set GUCs; with no policy they behave identically to `query()`.
   So A1 is a behavior-neutral deploy. Verify on production with the persona
   harness + the staff batch. Nothing can go empty yet.
2. **A2. Lint gate.** `scripts/lint-protected-tables.mjs`, run in CI: a list of
   protected tables; any SQL string naming one that is passed to `query(`,
   `getOne(`, `insert(`, `pool.query`/`c.query` or `sqlEdge` fails the build
   unless the file:line is in an explicit allowlist with a reason. Crude on
   purpose. This is what keeps site 24 from appearing next month.
3. **A3. Enable on a Neon branch.** Migration `047_redemption_rls.sql`. Run the
   extended isolation suite (2.7) as `smr_app`, printing both roles.
4. **A4. Enable in production.** Migration only, no code deploy.
   **Rollback is one statement, no deploy:**
   `ALTER TABLE access_code_redemption DISABLE ROW LEVEL SECURITY;`
5. **A5. Prove it live.** `/api/health/rls` (platform-admin gated): as the app
   role, (a) unscoped count of redemptions must be 0, (b) `queryAsUser` for a
   fixed demo participant must return exactly their row, (c) reports
   `session_user`. If (a) is nonzero, RLS is not on or the role can bypass.
   Then re-run the 30-prompt staff batch and one participant persona, because
   site 4 is on the path of every AI call.

### 2.3 Policy (migration 047, idempotent, split per command)

```sql
ALTER TABLE access_code_redemption ENABLE ROW LEVEL SECURITY;
ALTER TABLE access_code_redemption FORCE ROW LEVEL SECURITY;

-- SELECT: your own rows, or the org you are scoped to.
CREATE POLICY acr_select ON access_code_redemption FOR SELECT USING (
  user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
  OR access_code_id = NULLIF(current_setting('app.org_id', true), '')::uuid);

-- INSERT: redeeming for yourself, or an org attaching someone to ITSELF.
CREATE POLICY acr_insert ON access_code_redemption FOR INSERT WITH CHECK (
  user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
  OR access_code_id = NULLIF(current_setting('app.org_id', true), '')::uuid);

-- DELETE: leave yourself, or an org releasing its own seat.
CREATE POLICY acr_delete ON access_code_redemption FOR DELETE USING (
  user_id = NULLIF(current_setting('app.user_id', true), '')::uuid
  OR access_code_id = NULLIF(current_setting('app.org_id', true), '')::uuid);

-- NO UPDATE POLICY, and REVOKE UPDATE from smr_app. Nothing in the app
-- updates this table (verify by grep). No policy + no grant = a row can
-- never be moved between orgs or between people.
```

Self-INSERT differs from `org_staff`, where self-write was forbidden as
"self-grant". Here it is correct: redeeming a code IS the participant granting
themselves membership, gated by knowing the code and by the seat claim. It
grants no staff power. Codex: challenge this.

Also attach the existing `org_audit_write` trigger to this table. Membership
changes are the org boundary and currently leave no trace. UNTESTED: the
trigger reads `access_code_id` and `user_id` from the row generically, so it
should work unchanged. In an admin-attach the actor GUC is the admin (because
that path uses `runScoped`), in a self-redeem it is the participant.

### 2.4 One redemption path instead of four

Sites 2, 9, 10, 20, 21 are four copies of "claim a seat, insert a row", two of
them non-atomic (claim, then insert, then manual refund on failure), one
fire-and-forget on a different driver. Converting each separately is four
chances to get it wrong. Replace with one function in `accessCode.ts`:

`redeemForUser(subjectUserId, codeId, actor?: OrgScope)` -- ONE statement:

```sql
WITH claimed AS (
  UPDATE access_code SET times_redeemed = times_redeemed + 1, updated_at = now()
   WHERE id = $2 AND is_active
     AND (max_redemptions IS NULL OR times_redeemed < max_redemptions)
     AND NOT EXISTS (SELECT 1 FROM access_code_redemption
                      WHERE user_id = $1 AND access_code_id = $2)
  RETURNING id)
INSERT INTO access_code_redemption (user_id, access_code_id)
SELECT $1, id FROM claimed RETURNING id;
```

A unique-violation race raises and rolls back the claim with it, so the refund
code disappears. Run via `runScoped(actor)` when an org attaches someone,
`runAsUser(subject)` otherwise. UNTESTED: that the NOT EXISTS subquery sees the
subject's row under the self clause in both modes (in org mode it sees only
this org's rows, which is the row being asked about -- should hold).

`auth.ts` keeps its pg `Pool` for the adapter but stops writing redemptions
with it; it calls `redeemForUser`, awaited, errors logged not swallowed.

### 2.5 The cross-org question that must not become a policy

Sites 6 and 8 need to know "is this person bound to ANY org". No row policy
can answer that without letting org A read org B's membership. One
SECURITY DEFINER function, returning a word, never a row:

`smr_redemption_binding(p_user uuid, p_org uuid) RETURNS text`
-> `'none' | 'this_org' | 'other_org'`. `SET search_path = public, pg_temp`,
owned by the migration role, EXECUTE granted to `smr_app`.

It discloses exactly what the existing error message already tells the admin
("that email already belongs to another organization"), and nothing about
which one. Session 5's lesson 4 applies: inside it `current_user` is the owner.
It takes no identity from GUCs, so there is nothing to misattribute.

### 2.6 Platform-admin cross-org reads -- DECISION D1

Sites 12 (admin mode), 14-18. Today "platform admin" has no database meaning.
Two options:

- **(a) Recommended: a read-only admin role.** `smr_admin`, created IN SQL
  (console-created Neon roles get BYPASSRLS), NOBYPASSRLS, and each protected
  table opts in with `CREATE POLICY ..._admin_read FOR SELECT TO smr_admin
  USING (true)`. New env `ADMIN_DATABASE_URL`; a `queryAsPlatformAdmin()`
  helper that only `requirePlatformAdmin()`-gated routes import (lint-enforced
  by path). Cross-org READ only, per table, by explicit grant. It cannot write
  across orgs at all. Cost: Troy adds one env var in Vercel, same as the
  cutover.
- **(b) Fallback: a GUC.** `app.platform_admin = '1'` set by a helper, and an
  `OR` clause in every SELECT policy. No manual step, but every future policy
  must remember the clause, and one helper call anywhere opens everything.

If D1 is not answered before A4, ship (b) for SELECT only and migrate to (a)
after the demo. None of these six sites is on the Tuesday demo path except the
admin org directory.

### 2.7 Tests added to `verify-org-isolation.mjs` (run as `smr_app`)

Each asserts the WRONG ACTION cannot happen, not just that rows are hidden:

- unscoped SELECT on redemptions returns 0 (proves RLS is on for this role)
- org A scoped cannot see org B redemptions; A cannot insert a redemption into
  B; A cannot delete B's
- no UPDATE possible by anyone (expect permission error)
- participant self: sees own, sees nobody else's, can redeem, can delete own
- **tier sync as smr_app keeps a partner-coded user at `partner`** (site 3)
- **daily limit as smr_app returns the org allowance, not 30** (site 4)
- **a user bound to A is NOT rebound by `ensureUserAttribution` with B's
  code** (site 5)
- **org B inviting an email bound to A is refused** (site 6), and **revoking
  a pending invite in B does not delete a user who belongs to A** (site 8)
- export includes the membership; delete-data removes it and says so
- multi-code owner sees the union of their codes and nothing else
- `redeemForUser`: last seat, two concurrent redemptions, exactly one wins and
  `times_redeemed` equals the row count

### 2.8 One thing found while reading that is not RLS

`delete-data` without `deleteAccount` removes the redemption but leaves
`client_staff_assignment` rows for that person (RLS blocks an unscoped delete
there, and no code attempts one). Staff tiles would count a participant who
left. Verify, then fix inside the same self-delete path with a small
SECURITY DEFINER `smr_leave_all_orgs(p_user)`, or an `ON DELETE` trigger on
redemptions that removes the matching assignment. Trigger preferred: it makes
"no assignment without membership" a database invariant.

## 3. Part B -- participant-owned tables

Approximate SQL sites (grep, will be recounted per table):
`job_application` ~39 in 24 files, `refinery_artifact` ~33 in 12,
`consumer_profile` ~14 in 13, `vault_document` ~5 in 3,
`user_progress_event` ~3, `consumer_consent` ~13 in 6. About 100 sites.

### 3.1 Order and method

Same A1-A5 method per table, smallest first so the method is proven cheaply:
`vault_document` -> `user_progress_event` -> `consumer_profile` ->
`refinery_artifact` -> `job_application`. One table per deploy. The lint gate
from A2 gains a table each time. NOT before Tuesday, with one exception in
3.3.

To cut the conversion cost, first introduce `queryOwn(userId, sql, params)` as
the ONLY sanctioned way to touch a participant table from a participant route
and migrate callers behind it mechanically while RLS is off. Most of the 100
sites are already `WHERE user_id = $1` with the session user; the risk is the
few that are not (admin impersonation, cron/deletion tasks, the Forge pre-auth
session claim, AI tool calls acting for a user). Those get listed and
classified exactly like 2.1 before any policy exists.

### 3.2 Policy shape -- this is where sharing becomes database-enforced

```sql
-- owner
USING (user_id = NULLIF(current_setting('app.user_id', true), '')::uuid)
-- OR, SELECT only: staff of an org the owner shares THIS scope with
OR EXISTS (
  SELECT 1 FROM sharing_grant g
   WHERE g.user_id = job_application.user_id
     AND g.access_code_id = NULLIF(current_setting('app.org_id', true), '')::uuid
     AND g.scope = 'applications' AND g.revoked_at IS NULL
     AND (current_setting('app.org_role', true) IN ('owner','org_admin')
          OR EXISTS (SELECT 1 FROM client_staff_assignment a
                      WHERE a.access_code_id = g.access_code_id
                        AND a.client_user_id = g.user_id
                        AND a.staff_user_id =
                            NULLIF(current_setting('app.user_id', true), '')::uuid)))
```

Staff get SELECT through this clause and nothing else. No staff INSERT,
UPDATE or DELETE on any participant-owned table, ever. Staff help through
their own tables (4.5).

UNTESTED and must be tested before anything depends on it: subqueries inside a
policy are themselves subject to the RLS of the tables they read, under the
same GUCs. `sharing_grant` and `client_staff_assignment` are both org-scoped
for SELECT, and the org GUC is set, so the subqueries should see what they
need. If they do not, the symptom is staff seeing nothing (safe, but broken).

The sales sentence this buys, once true: "A case manager cannot read a
participant's resume unless that participant shared it. Not by policy of ours.
The database refuses."

### 3.3 Until Part B lands

Staff content reads in Part C/D go through ONE module,
`packages/core/src/orgClientView.ts`, whose every query joins `sharing_grant`
and the assignment check in SQL. App-enforced until B, database-enforced
after, same call sites. The security statement says which is true on the day.

## 4. Part C -- the sharing model

### 4.1 Scopes (allowlist in TypeScript, like capabilities)

| Scope | Staff see | Never included |
|-------|-----------|----------------|
| `progress` | what they see today: stage, counts, last active, next step | any content |
| `applications` | job title, company, status, dates, follow-up date, apply link, which resume was used | the participant's private `notes` field; salary unless D4 says otherwise |
| `resume` | current resume and tailored versions, read-only render | revision history, locked baselines' raw JSON |
| `documents` | cover letters, resource lists, job-match artifacts | |
| `practice` | session counts, struggle tags, takeaways | **transcripts, ever.** They are AES-GCM encrypted per owner and stay that way |
| `disclosure` | the disclosure plan | never requirable (D3) |
| `vault` | per-document only: the participant picks individual files | bulk vault access does not exist |

### 4.2 Tables (new, RLS from the first migration, never retrofitted)

- `sharing_grant(id, user_id, access_code_id, scope, basis
  CHECK IN ('participant_choice','program_requirement'), text_version,
  granted_at, revoked_at, revoked_reason, requested_by, UNIQUE active per
  user/org/scope)`. SELECT: self or org-scoped. INSERT/revoke: SELF ONLY. An
  org can never create or un-revoke a grant. That is the whole model.
- `sharing_request(id, access_code_id, user_id, scope, requested_by, reason,
  status, created_at, answered_at)`. Staff INSERT (org-scoped, must be assigned
  or admin). Participant answers.
- `org_sharing_policy(access_code_id, scope, mode CHECK IN
  ('optional','required'), basis_text, set_by, set_at)`. Owner-only write.
  Audited.
- Every grant/revoke also appends to the existing `consumer_consent_event` so
  there is one history, with `text_version`.

Migration of existing data: each current `sharing = granted` row becomes ONE
`sharing_grant` with scope `progress`, basis `participant_choice`, the
ORIGINAL `text_version`. Nothing wider. The cohort query then reads
`sharing_grant`, and the legacy layer is kept in sync until removed.

### 4.3 Required sharing, done honestly

Some programs (a DOC contract, a court-connected program) will make sharing a
condition of participation. The product must support that without pretending
it is consent.

- It is never labeled consent. Basis is `program_requirement`, and the
  participant-facing words are of the form: "[Org] requires participants to
  share [plain list] with their case manager as a condition of this program.
  This is the program's rule, not ours. You can leave the program at any time,
  which stops the sharing. Your practice transcripts and anything not listed
  here stay private either way."
- Shown BEFORE the code is redeemed, as its own screen with its own
  acknowledgment, and recorded with `text_version`. No acknowledgment, no
  membership, no seat claimed.
- **No retroactive exposure.** When an org turns a scope to `required`,
  existing members get the screen on next sign-in. Until a person
  acknowledges, staff see "awaiting acknowledgment" and NOT the data. There is
  no code path from `org_sharing_policy` to data; only `sharing_grant` rows
  open anything, and only the participant creates them.
- Declining = staying out of, or leaving, the program. Leaving revokes every
  grant to that org in the same transaction and the account, resume and all
  work stay with the person. Steel Man never locks someone out of their own
  material because a program ended.
- Requirable scopes: progress, applications, resume, documents. `practice`
  requirable as counts/tags only. `disclosure` and `vault` never (D3).
- The org's `basis_text` is THEIR stated reason and is shown to the
  participant verbatim under the org's name.
- This needs a lawyer's read before a real (non-demo) org is allowed to set
  `required` (D2). Build it, gate the `required` mode to demo orgs plus an
  explicit per-org enable flag until then.

### 4.4 What the participant gets in return

A "Who can see what" page in Settings replacing the single toggle: each scope,
on/off or "required by [Org]", who their assigned case manager is, and a
plain-language access history from `data_access_log` ("Russ F. viewed your
applications, Sept 20"). Pending requests appear here and as a dashboard card:
"Russ asked to see your resume so he can help before Thursday. Share / Not
now." Every content read by staff writes `data_access_log` with scope and the
staff member's id; that write lives inside `orgClientView.ts` so it cannot be
skipped.

## 5. Part D -- the staff CRM

Design rule: staff never edit a participant's work. They see (when shared),
they suggest, they keep their own records. The participant stays the author.
This matches `docs/FABLE-REASSESSMENT-AGENCY-2026-06-10.md`.

### 5.1 Surfaces

1. **Today** (`/dashboard`, replaces the landing view for staff). Not tiles,
   a work queue grouped by reason: interview in the next 7 days, follow-up
   due, offer pending, stalled 14+ days, never started, sharing request
   answered, tasks due, 30/60/90-day retention check due. Each row has its one
   obvious action. Numbers come from the same functions t.ROY is given so the
   screen and the assistant cannot disagree (session 6's counting defects).
2. **Caseload** (`/dashboard/clients`). The current table, plus search,
   filters (stage, staff, status, sharing), sort, saved views, bulk assign.
3. **Client page** (`/dashboard/clients/[id]`) -- the missing center of the
   product. Header: name, stage, assigned staff, last active, a chip per scope
   (shared / required / not shared / requested). Left: a single timeline that
   merges participant events (within shared scopes) with staff notes, contacts,
   tasks and outcomes. Tabs per scope. A tab for an unshared scope is not
   hidden and not an error: it says what it would show and offers "Ask Wes to
   share this", with a reason field.
4. **Reports** (`/dashboard/reports`, admin). Date-ranged: enrolled, active,
   applications, interviews, placements, wage, 30/60/90 retention, by staff
   member. CSV and a printable page. Staff-verified vs participant-reported
   kept distinct in every number.

### 5.2 Staff-owned records (new tables, org-scoped RLS from birth, audited)

- `case_note(id, access_code_id, client_user_id, author_user_id, kind CHECK IN
  ('note','call','meeting','text','email','referral'), body, occurred_at,
  visible_to_participant bool DEFAULT false, created_at, edited_at)`. Notes
  are amendable, never deletable by staff; edits keep the prior version.
  SELECT for staff limited to assigned clients by the same assignment clause.
- `staff_task(id, access_code_id, client_user_id NULL, owner_user_id, title,
  due_at, done_at, shared_with_participant bool)`.
- `outcome_record(id, access_code_id, client_user_id, employer, job_title,
  wage, hours, start_date, source CHECK IN ('staff_verified',
  'participant_reported'), linked_job_application_id NULL)` +
  `retention_check(outcome_id, day_mark, status, checked_by, checked_at)`.

These hold information ABOUT a person that the person does not control. That
is normal for a case file and it must be said plainly to participants on the
"Who can see what" page: "Your case manager keeps their own notes. Those
belong to [Org]." What happens to them when someone leaves or deletes their
account is D5.

### 5.3 Helping, not just watching

All of these create rows in staff-owned tables plus a participant-visible
item; none write to participant-owned tables.

- **Suggest a job**: staff push a posting; participant sees "Suggested by
  Russ" and saves or dismisses it. Only a save creates a `job_application`,
  written by the participant's own session.
- **Comment on a resume or letter**: anchored comments shown beside the
  document; the participant applies changes (or asks t.ROY to) themselves.
- **Shared task**: "Bring ID Thursday" with a due date, on the participant's
  dashboard.
- **Check-in message**: email through the existing invite mail path, logged as
  a `case_note` of kind email. In-app inbox is later.
- **Assign a practice**: "Do one mock interview before Thursday", links to the
  tool, completion shows on the timeline under the `practice` scope.
- **Record a placement**: staff-verified outcome; if a matching application
  exists the participant is asked to confirm, never silently overwritten.

### 5.4 Staff t.ROY

- Context builder moves into `orgClientView.ts`, so t.ROY can only be handed
  what the asking staff member can see, by the same queries (and after Part B,
  by the database).
- Client-page mode: "Prep me for Thursday with Wes", "What changed since we
  last spoke", "Draft a case note from this week", "What is his best next
  step". And the missing button: **Save as note** on any drafted note.
- Layer 1 verification extends from headcounts and first names to employers,
  job titles and dates: every one in the answer must exist in the handed
  context. Layer 2 stays gpt-4.1-mini until measured otherwise.
- The harness `scripts/verify-org-output-judge.mts` gains per-client cases, and
  the production batch gains a per-client block. The batch, not the harness,
  decides "done" (session 6).
- An unshared scope is stated to the model as a fact ("resume: not shared"),
  so it says "Wes has not shared his resume; you can ask him to" instead of
  guessing. Add a false case for exactly this to the harness.

### 5.5 Capabilities to add (allowlist)

`org.client.view_content`, `org.client.request_sharing`, `org.note.write`,
`org.note.view_all`, `org.task.write`, `org.outcome.write`, `org.report.view`,
`org.sharing_policy.manage` (owner only). Staff bundle gets the first five.

## 6. Sequence and the Tuesday cut line

Everything new ships behind a per-org flag `crm_v2` on `access_code`, enabled
first ONLY for the three `(Demo)` orgs. Real orgs (the live pilot cohort) see no change
until the flag is turned on for them after D2.

| Stage | Work | Est. | When |
|-------|------|------|------|
| S0 | branch, recount 2.1, resolve Codex findings on this plan | 1h | Sun |
| A1-A2 | convert 23 sites, `redeemForUser`, binding function, lint gate, deploy (behavior-neutral) | 4-5h | Sun |
| A3 | migration 047 + extended suite on Neon branch as smr_app | 2-3h | Sun |
| A4-A5 | enable in prod, `/api/health/rls`, rerun 30-prompt batch + persona | 1h | Sun night / Mon AM |
| C1 | `sharing_grant`/`sharing_request`/`org_sharing_policy`, backfill to `progress`, Settings "Who can see what", **all copy in 1.1 rewritten in the same deploy** | 5-6h | Mon |
| D1 | client page, timeline, `applications` + `resume` tabs via `orgClientView.ts`, request-to-share flow, `case_note` + Save as note | 6-8h | Mon |
| -- | **FREEZE Monday 6:00 PM Mountain.** Only what passed a production batch is on. Anything else stays flagged off. | | |
| -- | **Rehearsal, Monday evening, on the frozen build.** Untouched for seven sessions. It is a line in this schedule because it competes for the same hours. | 1.5h | Mon |
| D2 | Today queue, tasks, outcomes + retention, suggest-a-job, comments | 12-16h | after 9/22 |
| C2 | required-sharing mode end to end, pre-redemption screen | 5-6h | after 9/22, demo orgs only until D2 decision |
| D3 | reports, filters/saved views/bulk, t.ROY per-client batch | 8-10h | after 9/22 |
| B | participant-table RLS, one table per deploy | 16-24h | after 9/22 |

If Sunday runs long: A is the priority Troy named and it finishes first.
C1+D1 are the demo-visible slice. If D1 is not batch-clean by the freeze, the
demo shows A plus the existing console, and the security statement gets one
more true sentence. A half-verified client page in front of DOC is worse than
none.

## 7. Decisions for Troy

- **D1** Platform-admin reads: read-only `smr_admin` role (one Vercel env var
  from you) or a GUC clause. Recommend the role. Default if unanswered: GUC
  for now.
- **D2** Required sharing goes live for real orgs only after an attorney reads
  the participant-facing text. Until then demo orgs only. Recommend yes.
- **D3** `disclosure` and `vault` can never be made required. Recommend yes.
  The disclosure plan is the most sensitive thing a person writes here.
- **D4** Is salary part of the `applications` scope? Recommend no by default.
- **D5** When a participant leaves an org or deletes their account, staff
  notes about them are: kept by the org as its record / kept but de-identified
  / deleted. Recommend de-identified on account deletion, kept on leaving.
  This one has legal weight; pair it with D2's review.
- **D6** Are staff notes ever visible to the participant? Recommend a per-note
  switch, default off, and the plain sentence in 5.2 telling people notes
  exist.
- **D7** The "Not your case manager" line on the public security page. It
  stays true only in the form "not unless you share it, and you can see every
  time they look". Needs your wording; it is your promise.

## 8. Definition of done (per stage, no exceptions)

1. Suite green as `smr_app`, both roles printed in the log.
2. `/api/health/version` shows the expected SHA BEFORE any live check.
3. Production batch run against the live build, every flag read by hand.
4. Every sentence in `/dashboard/org-security`, `SecurityContent`,
   `SharingConsentSection`, the partner page and OrgDashboard footer re-read
   against the code that day. A claim that is not yet true is not shipped.
5. HANDOFF entry with what was NOT done and why.
