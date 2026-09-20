# Capabilities truth sheet -- what may be said about the organization side of Steel Man Resumes

Date: 2026-09-20, revised the same night. Production `ce10bba`. For whoever writes website, SEO/AEO, sales or grant copy.

**How to use this.** A claim may be published only if its row says LIVE and you keep the
qualifier in the "Say it like this" column. "DEMO ORGS ONLY" means it works in production
today but no real organization can use it yet; describe it as available, not as something
customers are using. "NOT BUILT" means do not mention it as a feature. Every LIVE row names
the evidence: a test in `scripts/verify-org-isolation.mjs` (250 assertions, run as the
restricted database role on every pull request) or a production check recorded in `HANDOFF.md`.

**Scope.** This sheet covers what was built or verified on 2026-09-19/20: the organization
workspace, sharing, and database enforcement. The participant tools (Forge, Refinery, job
search, truth gate, disclosure planner, interview practice, vault, tablet package) are NOT
re-verified here; take claims about them from `HANDOFF.md` and
`~/todash/smr/MT-DOC-DEMO-RUN-SHEET-2026-09-22.md` section 5 (the claims check).

**On competitors.** Nothing here says what another product does or does not do. I have not
verified any competitor's features, and a comparison published without that is the kind of
claim this whole document exists to prevent. The defensible move is to state plainly what
Steel Man does, with evidence, and let the reader compare. If a head-to-head table is wanted,
it needs its own sourced research pass first.

## 1. Who controls the data

| Claim | Status | Say it like this | Evidence |
|---|---|---|---|
| Participants decide what their organization can see, one item at a time | DEMO ORGS ONLY | "Participants choose what to share with their case manager, item by item, and can stop at any time." | suite: "staff cannot insert a grant for their participant", "nobody can insert a grant in another person's name" |
| An organization cannot give itself access | DEMO ORGS ONLY | "No setting an organization controls can open a participant's resume. Only the participant can." | the grant INSERT policy has no organization clause (`051_sharing.sql`); suite as above |
| Participants see every time staff open something | DEMO ORGS ONLY | "Participants can see who opened what, and when." Say OPENED, never READ. | suite: "every allowed read is in the participant's log"; the log row is written in the same transaction as the read |
| Private job notes and pay never reach staff | DEMO ORGS ONLY | "A participant's private notes on a job and the pay they wrote down are never shown to staff, even when applications are shared." | suite: "the person's private notes and pay are NOT in what staff receive"; production run, zero matches |
| Disclosure plans, interview practice and stored documents are never visible to staff and can never be required | LIVE (nothing can read them) | "Disclosure plans, interview practice and stored documents stay private. No program can require them." | suite: "a disclosure plan can never be required", "even called directly, the database refuses"; vault is owner-only RLS (059) |
| Staff never edit a participant's work | DEMO ORGS ONLY | "Case managers suggest. Participants decide what becomes their own work." | suite: "suggesting a job does NOT put it in the participant's tracker", "ticking is ALL the participant can do" |
| Staff never sign in as a participant | LIVE | "Case managers never see a participant's screen from the inside. They get a map of it, and see inside an area only if it was shared." | `ClientPage.tsx` TheirScreen; staff have no impersonation path |
| Leaving an organization ends all sharing and keeps the person's work | LIVE | as written | suite: "leaving the organization revokes everything", "rejoining does NOT bring the old sharing back" |

## 2. Programs that require sharing

| Claim | Status | Say it like this | Evidence |
|---|---|---|---|
| A program can make sharing a condition | DEMO ORGS ONLY, **pending legal review of the participant wording** | Do not market yet. Internally: "supported; switched on per organization after legal review." | `054_required_sharing.sql`; suite "required sharing" block |
| Turning a requirement on exposes nobody | DEMO ORGS ONLY | "Nothing opens until each person has read the requirement and acknowledged it themselves." | suite: "turning a requirement on exposes nobody" |
| It is never called consent | DEMO ORGS ONLY | Never use the word consent for required sharing, anywhere. | `sharingScopes.ts` SHARING_REQUIRED_TEXT |
| "Only my case manager" is enforced | DEMO ORGS ONLY | as written | suite + mutation check: breaking the rule fails two assertions |

## 3. Database enforcement (the strongest technical claim; keep it exact)

| Claim | Status | Say it like this | Evidence |
|---|---|---|---|
| One organization cannot see another's people, staff, notes, tasks, outcomes or sharing records | LIVE | "Organization boundaries are enforced by the database itself, not only by application code." | `GET /api/health/rls` returns 200: 19 tables enabled and forced, app role cannot bypass, unscoped reads return nothing |
| The application's database account cannot bypass those rules | LIVE | as above | health check `roleCanBypass: false`. **Re-check this before any publication: it silently reverted once on 2026-09-20.** |
| A participant's resumes, applications and profile are protected at the database level | LIVE | "A participant's applications, resumes and profile can be read only by that participant. Staff see a shared item through a restricted view that does not contain private notes, pay, or disclosure plans at all." | `060_participant_tables_rls.sql`; suite: "their own case manager, scoped to their org, reads NOTHING from the base table", "asking the view for the private notes column is an error", "the artifact view ... can never return a disclosure plan" |
| Which colleague inside an organization may open a person is enforced by the database | **NO** | Do not claim it. It is enforced in application code (`orgClientView.ts`): assignment, "sees everyone", and capability denies. | tests cover it; it is not a database rule |
| Platform administrators cannot be created by the application | LIVE | rarely worth saying publicly | suite: "the app cannot insert a platform_admin row" |
| Every access and membership change is audited | LIVE for org membership, staff, assignments, access changes, sharing policy | "Changes to who can see what are recorded." Do not say "everything is audited". | `org_audit`, written only by triggers and functions the app cannot forge |

## 4. The staff workspace (all DEMO ORGS ONLY)

Today work queue by reason; caseload with filters, saved views and bulk assignment; participant
page with notes (versioned, never deleted), tasks (shareable with the participant), job suggestions
and comments beside shared documents, outcomes with retention check-ins at 30/60/90/180 days,
and a map of the participant's own screen; team org chart with per-person access switches; staff
invitations by email; Insights with a funder export in which every figure carries what it was
counted over; one organization-wide "quiet after N days" that every screen and the assistant read.

Two sentences worth using, because they are true and unusual:
- "A retention rate here is 'still there' out of 'old enough to ask'. Someone placed last week is
  not a 30-day failure, and someone we could not reach is not counted as either answer."
- "A placement says how it is known: told to staff, known but unconfirmed, or confirmed and how."

## 5. The assistant (t.ROY), organization side

| Claim | Status | Say it like this |
|---|---|---|
| Staff answers are checked against the organization's real numbers before they are shown | LIVE | "Answers to staff are generated whole and checked against the organization's actual figures before they appear." |
| It cannot be told it is talking to staff | LIVE | not a marketing claim; a security one |
| It prepares a case manager from a participant's shared materials and saves notes | **NOT BUILT** | do not mention |
| It never gets anything wrong | **NEVER SAY** | An unsupported sentence is still SHOWN, with a warning. Codex's assessment lists this as the first thing to fix after 9/22. |

## 6. Do not say, in any form

- "Unhackable", "military-grade", "bank-level", "100% secure", "HIPAA compliant", "WIOA compliant",
  "FERPA compliant". None has been assessed.
- "Staff can never see your resume." Not true once a participant shares it.
- "Second chance", "ex-offender", "felon". Justice-impacted; fair-chance for employers.
- Any number of people helped, placed or retained. There is no verified figure.
- That any real organization uses the staff workspace. None does: it is switched on for three
  fictional demo organizations.
- That an employer is fair-chance unless it is in the verified employer table with a dated source.

## 7. What has to happen before the DEMO ORGS ONLY rows become LIVE

1. Troy rewrites the public `/security` promise ("You, and nobody in your life. Not your case
   manager."). It is true today and stops being true the first time a real participant shares a resume.
2. A lawyer reads the required-sharing wording before any real program may require anything.
3. ~~Row-level policies on resumes, applications and profiles.~~ DONE 2026-09-20 (migration 060).
4. The assistant stops showing unsupported sentences (section 5, last row).
