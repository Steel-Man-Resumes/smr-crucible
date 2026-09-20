# Codex review: organization security, staff CRM, and career-development leadership

Reviewed 2026-09-20 against local commit `8741349` and `ORG-RLS-AND-STAFF-CRM-PLAN-2026-09-20.md`. This is a source review and proposed revision, not a production security certification. No database policies, live grants, deployment state, or user journeys were executed in this review. The plan cites production `9611457`; production was not independently verified.

**Verdict:** retain the participant-authorship principle, explicit sharing, unified staff read boundary, and production rehearsal. Revise the authorization and membership design before implementing the SQL. The opportunity is a continuous career-development service from preparation through employment and advancement, with evidence that people benefit and retain control over their story.

## Findings that change the implementation

### 1. Redemption is a privilege boundary, not just cohort membership — blocker

The assertion in §2.3 that redemption grants no staff power is not true for all existing codes. `accessCode.ts` permits `admin` codes; `userTier.ts:50` derives the cached user tier from redeemed codes; `apps/consumer/lib/org-guard.ts:86` authorizes platform administration using that tier.

The proposed self-INSERT policy checks only the subject ID. It does not enforce knowledge of a code, capacity, expiry, permitted tier, or acknowledgement. This is a policy gap, not proof that a public route presently allows arbitrary SQL. An org-scoped INSERT also allows attachment without testing a staff capability.

**Change:** separate platform-admin authorization from redeemable entitlements. Route membership mutation through a narrowly authorized operation that validates the code and business rules; do not describe an unrestricted self-INSERT grant as equivalent. Specify the app-server trust boundary: the shared application role can set its own GUCs, so RLS protects against missing predicates under correctly resolved identity, not arbitrary SQL execution with that credential.

**Acceptance:** a participant cannot redeem an administrative entitlement through the ordinary route; direct app-role insertion cannot bypass whichever membership rules are claimed to be database-enforced; an ordinary staff identity cannot attach arbitrary people by setting an org context alone.

### 2. Fix the inventory and distinguish rollout from refactoring

In `apps` and `packages/core/src`, excluding comments, there are **23 textual references in 22 SQL call sites across 14 files**. The two auth references at lines 365 and 368 belong to one statement. The plan's numbered table already contains 22 sites. Recount services and scripts separately as part of the implementation inventory.

Pure wrapper conversion can be behavior-preserving while RLS is off. Consolidating redemption, changing auth from fire-and-forget to awaited, and introducing a privileged binding function are behavioral changes. They require independent regression and failure handling before enforcement.

The proposed migration is labeled idempotent but its sample `CREATE POLICY` statements have no preceding drops. Follow migration 046's drop/create pattern and verify the effective policy set, including inherited grants.

### 3. Decide what membership means before enforcing first-code-wins — blocker

`partnerTracking.ts:58` and `orgInvite.ts:104` implement first-code-wins checks, but `accessCode.ts` permits another user/code pair. Migration 006 enforces uniqueness of `(user_id, access_code_id)`, not a single organization per user. `partnerDashboard.ts` explicitly accommodates multiple codes and organizations.

The proposed claim CTE prevents duplicate use of the same code; it does not prevent concurrent redemption into different organizations. A prior binding lookup cannot make that invariant atomic.

**Change:** distinguish the organization, enrollment, invitation/code, entitlement, and funding attribution. Longer term use a stable organization ID rather than an access-code ID as the organization identity. Preserve current behavior until the intended cardinality is explicit; do not add a global unique-user constraint blindly. For a single-active-enrollment rule, serialize every enrollment path on the subject and enforce an appropriate database constraint. For multiple enrollments, keep grants and attribution organization-specific.

The new redemption operation must include expiry in the atomic claim, return distinct already-member/full/expired/inactive outcomes, and make acknowledgement plus required grants part of the same authorized enrollment transition. Test two different orgs competing for one user, not just two users competing for one seat.

### 4. Seat accounting and invite revocation need explicit semantics

The existing code calls seats durable and refunds only a never-activated invitation. `delete-data` deletes membership without refunding a seat. Consequently, §2.7's counter-equals-current-row-count invariant is incompatible with existing durable-seat behavior after deletion.

**Change:** define whether the counter means lifetime redemptions, active enrollments, or billable seats. Use separate fields or a ledger if more than one is needed. Make pending-invite revocation, refund, token cleanup, and any shell-account removal one controlled transition. A separate `smr_redemption_binding()` lookup followed by account deletion is still vulnerable to concurrent attachment/sign-in. Prefer leaving a harmless shell over deleting an account whose ownership is uncertain.

Remove assignments when membership ends, but also enforce that assignments cannot be created without valid enrollment. A delete trigger alone does not establish the full invariant.

### 5. Required-sharing acknowledgement is not yet represented sufficiently — blocker

`org_sharing_policy` is mutable and `sharing_grant` lacks an explicit immutable policy-version relationship. A scope/text version alone does not establish which program rule, audience, purpose, and historical content the person acknowledged. A resume scope can expose older resumes on its first grant unless the participant is told that clearly.

Existing invite, auth attribution, hub-unlock, and ordinary redemption paths all need coverage. Gating only the code-entry screen leaves alternate paths. Pending invitations may reserve capacity without becoming active membership or opening content access.

**Change:** store immutable policy versions and acknowledgment records; identify the version being accepted, allowed scopes, audience, effective date, and whether historical or future artifacts are covered. Verify that version at enrollment commit. Bind the grant to an enrollment episode so leaving and rejoining cannot revive an old grant. Revoke access atomically when leaving. Policy edits must never widen an existing grant.

Do not ship “You can leave the program at any time” as an unconditional promise for court-connected programs. The platform can explain its own sharing controls; it cannot promise the absence of external consequences. Keep real required mode gated for the plan's requested legal review. This is a copy/product finding, not a determination of legal obligations.

### 6. Row policies cannot enforce private fields inside a shared row — blocker for content sharing

The proposed application-row SELECT policy can admit a row containing private notes and salary. It does not hide individual columns. `refinery_artifact` also needs artifact-type-specific rules so a resume grant cannot expose disclosure or other document types.

**Change:** define an allowlisted staff projection per scope and use it in APIs, exports, queues, and AI context. If field privacy is advertised as database-enforced, split sensitive fields or use an appropriately permissioned projection architecture; application-role SELECT on the underlying row remains broader. The proposed vault schema also lacks a document identifier despite promising per-document grants. Add a separate document grant model or constrained resource-specific grants.

### 7. Role checks must honor capability denies and current membership — blocker

The proposed owner/admin-or-assigned clause bypasses `computeOrgCapabilities()` and its explicit deny-wins behavior. Assignment alone is also insufficient without current staff membership, active participant enrollment, and the relevant capability.

**Change:** specify a single authorization predicate covering identity, current staff membership, effective capability, caseload reach, active enrollment, scope grant, and resource. Implement equivalent database and application checks. Prove parity with denied-admin, custom-granted-staff, removed-staff, reassigned-client, and expired/revoked-grant cases.

Section 5.5 gives ordinary staff the first five capabilities, including `org.note.view_all`. That conflicts with assigned-client-only notes unless “all” means something unusually narrow. Rename or remove it from the ordinary staff bundle.

PostgreSQL evaluates policy expressions with the caller's privileges, including accesses to other tables. Nested RLS can work as proposed, but inadequate privileges can raise an error rather than merely hide rows, recursive policies can fail, and concurrent policy-data changes need testing. See [PostgreSQL row security](https://www.postgresql.org/docs/17/ddl-rowsecurity.html).

### 8. Harden privileged functions and retain the separate admin role

The binding function is a deliberate cross-org membership-existence disclosure. Limit who can invoke it and which workflows can query arbitrary identities. Returning a word rather than a row does not remove the need for authorization.

Its owner must actually have cross-org access under FORCE RLS; table ownership alone does not guarantee that. Use qualified object names, trusted schemas, restricted ownership, and explicit execution privileges. Revoke default PUBLIC execution in the creation transaction. A function is not made safe merely by setting `search_path = public, pg_temp`; the schema must also be protected against untrusted creation. See [PostgreSQL function security](https://www.postgresql.org/docs/current/sql-createfunction.html).

Choose the read-only admin role. Remove the automatic “unanswered means platform-admin GUC” fallback. If the credential is unavailable, defer the cross-org feature. A read-only role must also lack access to mutating SECURITY DEFINER functions, role escalation, and unintended sensitive tables. Path lint is supplemental, not runtime authorization.

The existing generic audit trigger appears compatible with redemption's `access_code_id` and `user_id` fields by inspection. Still verify it as the app role, including its FORCE-RLS owner behavior and actor identity for system, self, and admin attachment.

### 9. Sharing must be enforced in summaries, caches, and AI memory

Counts, last-active signals, next-step labels, practice struggle tags, queue reasons, and empty-state distinctions can disclose sensitive facts. Treat derived information as scoped content. Practice counts and evaluative struggle tags should not automatically be one required-sharing scope.

Give `orgClientView` a typed projection, resource/version identifiers, and an authorization revision. Keep read auditing in the transaction that fetches protected data where feasible. Log the access as a fetch, not proof that a human looked at it. Do not serve content if its required audit write fails.

On revocation or reassignment, invalidate staff caches and reauthorize downloads, exports, and AI tool calls. Define the boundary for requests already in flight and already downloaded copies. Previously shared content must not remain available to subsequent staff AI turns through stored conversation context. Derived staff notes may contain copied participant information; explain this and apply retention controls rather than promising revocation erases it everywhere.

Encryption of practice transcripts is useful protection but does not itself prove staff can never receive decrypted content. Trace decryption and assistant-context paths before making that claim.

### 10. The current CI workflow is not a pre-merge release gate

`.github/workflows/org-isolation.yml` runs on push to main or manual dispatch, with path filters. It does not currently run on pull requests. Auth, user deletion/export, hub unlock, and the future sharing/client-view surfaces are not all directly covered by those filters. A main push can initiate Vercel deployment before this workflow finishes.

**Change:** make isolation a required pre-merge check, cover all authorization callers, and establish a deployment dependency or promotion gate. Add the protected-table lint gate with stable exceptions; file/line exceptions alone are fragile after edits. Test aliases and SQL fragments that simple text matching misses.

The health check should verify role attributes and enabled/forced RLS, then use maintained fixtures with known positive and negative rows. Zero unscoped rows alone is ambiguous on an empty table. Disabling RLS is a security rollback, not a neutral recovery; pair it with content-sharing shutdown and an explicit restoration plan.

### 11. Existing consent migration needs an audience rule

The legacy sharing flag is user-wide, whereas new grants are user/org-specific. Do not fan a legacy grant out to every present or future code without proving the original audience. If it is ambiguous, ask for a new grant. Preserve original text-version provenance without inventing an original per-org consent timestamp.

Keep consent history append-only and use a server-controlled event path for revocations caused by leaving or account deletion. “SELF ONLY” mutations must not make system revocation impossible or require impersonating the participant.

### 12. Public promises and staff records need a fuller lifecycle

The copy inventory must include README/public documentation, tablet/LMS materials, download exports, support scripts, and demo narration. `scorm/README.md` explicitly says intake answers live in the institution's `cmi.suspend_data`; the web app's sharing boundary does not establish what the LMS operator can read.

Staff notes need version history, authorship, correction procedures, org retention rules, and a participant-facing explanation. Removing a user ID does not de-identify free text. Do not set blanket deletion/retention behavior before reviewing the actual service relationships. Add `observed_at`, `verified_at`, verifier, verification method, and evidence provenance to outcomes; a `staff_verified` label alone proves little.

## Revised delivery sequence

1. **Before enforcement:** settle membership/seat semantics; remove admin-tier ambiguity; separate scope conversion from redemption behavior changes; build the missing negative and concurrency tests.
2. **Then RLS:** run on an isolated branch as the application role, verify migration reruns and grants, and promote only after the applicable gates pass. Time pressure is not a reason to enable an unproven boundary.
3. **Demo slice:** one participant voluntarily shares one resume/application view; the assigned staff member prepares, drafts and explicitly saves a note or suggestion; the participant can see the resulting assistance. Demonstrate denied access with a second staff identity. Use synthetic data until this slice passes. Keep required mode out of the demo's critical path.
4. **After the demo:** finish participant-table protection and field projections, then broaden the Today queue, tasks, job suggestions, outcomes, and reporting. Implement in complete vertical slices, each with export/deletion/revocation behavior.
5. **Retain Monday's freeze and rehearsal.** Treat the supplied hour estimates as guesses; the discovered authorization and lifecycle dependencies make a guaranteed Sunday/Monday finish unjustified.

Minimum release evidence includes denied capability, removed staff, two-org membership races, policy change during acknowledgement, leave/rejoin, per-document vault limits, notes excluded from application views, stale AI context after revocation, concurrent invite revoke/sign-in, and genuine business outcomes after RLS. A language-model output batch supplements these tests; it cannot replace them.

## What would make SMR distinctive

The strongest product thesis is: **people carry their career story and work forward; trusted practitioners help them turn it into sustainable employment and advancement.** Forge identifies and translates experience. Refinery supports action and learning. The staff workspace helps a practitioner deliver a useful intervention. Tablet continuity connects preparation to the next environment without forcing someone to start over.

### Build a visible career-development method

Document a versioned method: establish goals and constraints → identify evidenced skills → choose plausible roles → create truthful materials → practice → apply and follow up → support retention → pursue advancement. For each step define the participant decision, useful artifact, practitioner intervention, evidence behind the approach, and circumstances requiring human help.

Avoid turning a preferred linear journey into a mandatory sequence. A person with an interview tomorrow should reach practice immediately. Someone already employed may need wage growth or credential planning. A job loss should reopen support without framing it as failure.

Make skills traceable to experiences the participant confirms. Label uncertainty in employer openness and job suitability; record the location, role, source, and last verification date. Do not imply that an employer-wide label guarantees a particular hiring decision. Never invent experience or encourage involuntary disclosure in resumes.

### Make staff assistance demonstrably useful

The Today queue should explain the action and evidence: “Interview Thursday; resume shared; preparation requested.” Do not equate inactivity with motivation or use sensitive struggle tags as a staff performance score. Test the whole intervention: can staff find the need, help, and confirm that the participant received something useful?

Support continuity through access problems, changed contact details, mobile use, low bandwidth, and interrupted sessions. Set WCAG 2.2 AA as a design and verification target, with keyboard, screen-reader, zoom, and plain-language task testing; automated checks alone do not establish conformance. See [W3C WCAG 2.2](https://www.w3.org/TR/WCAG22/).

### Earn expert standing through evidence and teaching

Your strongest claim to expertise will be a transparent method that practitioners can learn, participants find useful, and outcomes can test. Create a practitioner guide, a consented and carefully reviewed case library, paid participant feedback sessions, and recurring external review by career-development and reentry practitioners. Publish what failed and what changed as well as successes.

Start a bounded pilot with a written evaluation protocol before collecting results. Define enrollment, start, placement, retention, follow-up windows, missing outcomes, and source reliability. Distinguish participation from improvement and observed change from causal effect. Track participant-defined career fit and advancement alongside employment, practitioner effort, and access barriers. Avoid staff rankings until case mix and missing data are understood.

For workforce partners, design data so quarter-after-exit employment and earnings can eventually be represented where appropriate. WIOA indicators include second- and fourth-quarter employment and second-quarter median earnings; these are different from 30/60/90-day retention and are not interchangeable. This is a reporting-design reference, not a claim of WIOA compliance. See [U.S. Department of Labor performance indicators](https://www.dol.gov/agencies/eta/performance/performance-indicators).

The next durable deliverables should be a versioned SMR method, an authorization matrix, an end-to-end pilot protocol, and a release evidence ledger connecting every public promise to a verified behavior. Those assets would support both a better product and a defensible reputation for expertise.
