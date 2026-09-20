# t.ROY -- plan after the Codex assessment

Date: 2026-09-20. Answers `TROY-AGENT-ASSESSMENT-AND-DEFENSE-ARCHITECTURE-2026-09-20.md`.
Companion to `ORG-RLS-AND-STAFF-CRM-PLAN-v2-2026-09-20.md`. Status: items marked DONE are
shipped; everything else is NOT BUILT.

## 0. Disposition

I checked five of the twelve source findings by hand before accepting the rest (1, 2, 3, 9,
12). All five are accurate as written. I accept all twelve, the architecture, and the judgment
that "unhackable" is not an engineering target. The one-line version of the whole document is
the right north star and I am adopting it as the acceptance test for every t.ROY change:

> t.ROY reliably knows **who is acting, whose work is involved, what is known, what is
> authorized, and what actually happened.**

What I am NOT doing: changing the staff prompt or its checker before Tuesday. Session 6 took
four production batches to get staff answers from 7/20 flagged to 0/30. Findings 6 and 7 are
correct and both live inside that tuned path; they get fixed with a fifth batch behind them,
not in the last 24 hours before a demo.

## 1. Shipped now (small, outside the tuned prompt and checker)

| # | Finding | Fix |
|---|---------|-----|
| 1 | Browser `context.org` selected the staff assistant and supplied its "verified" facts for anyone the resolver did not recognise | `org` and `audience: "org_staff"` are server-owned and stripped from the incoming context before anything reads it |
| 2 | Org lookup failure silently turned a case manager into a job seeker | A partner/admin whose caseload cannot be resolved gets a plain 503 ("I am not going to guess"); participants carry on |
| 4 | `sanitize.ts` claimed to prevent injection | Comment now says what it does (normalizes) and that nothing may rely on it as a boundary |
| 12 | `counts.savedJobs` was the length of a ten-row list of every status | Counts saved jobs from the unbounded profile list; the list length is reported as what it is |

## 2. After 9/22, in this order

**Wave T1 -- finish repairing the current boundary (each with a regression test on BOTH routes)**
- F5 transcript provenance: persist canonical turns server-side; the browser may return only
  narrowly typed acknowledgements for navigate/highlight, bound to a server-issued call id.
  Never accept a data-tool result from the client. Needs an integration test against the AI
  SDK before and after, because exploitability depends on SDK behaviour.
- F3 rehearsal override: server-owned persona templates; the participant supplies bounded
  scenario FIELDS (employer type, gentleness), treated as data. Rehearsal purpose and its
  memory isolation become server-issued session attributes, not a page label from the browser.
- F9 approvals: `file_feedback` and reminders stop trusting a model-supplied `confirmed`. A
  short-lived, single-use approval bound to the actor and an argument hash, minted only by an
  authenticated user gesture. Navigation and explicitly requested reversible actions stay
  frictionless.
- F6 + F7, together, with a production batch: unsupported MATERIAL claims are repaired or
  withheld, not shown with a caution; the judge loses "inactivity = dropout risk"; a
  participant's or staff member's assertion stays an attributed report. Add Codex's three
  layer-1 misses to `scripts/verify-org-output-judge.mts` as known-false cases first:
  "All 3 participants have started work" (contradicts the hire total), "Wes has started work"
  (unsupported attribution), "Your placement rate is 100%" (unsupported percentage).

**Wave T2 -- one runtime**
- F10: `/api/assistant` and `/api/coach` call one policy-controlled runtime with different
  authorized tools. Nobody gets a different security model by choosing an endpoint.
- Server-issued task context (actor, workspace, org/subject, effective capabilities, purpose,
  session, authorization revision, allowed tools, budget). This is the same `OrgActor` +
  `orgClientView` boundary the CRM already uses; t.ROY becomes another caller of it, which is
  what makes revocation reach him.
- F8 memory by workspace and purpose (participant / org-case / demo / developer), never by
  `user_id` alone. Stored text is re-authorized when loaded: copying something into memory must
  not exempt it from a later revocation. This is the t.ROY half of CRM plan finding 9.
- Tool broker: each tool declares workspaces, schema, capability, resource predicate, side
  effects, cost, timeout, audit. Structured receipts; "saved" is said only after a success
  receipt; idempotency keys.

**Wave T3 -- the staff workflows this unlocks** (the part Troy actually asked for)
- Per-participant staff t.ROY built ONLY from `orgClientView` reads: "prep me for Thursday
  with Wes", "what changed since we spoke", "draft a case note from this week", and **Save as
  note** (`case_note.drafted_by_assistant` and the API already exist).
- An unshared scope is handed to the model as a FACT ("resume: not shared"), so he says "Wes
  has not shared his resume; you can ask him" rather than guessing. A required-but-
  unacknowledged scope likewise.
- Evidence status on every outcome claim: participant-reported / staff-reported /
  staff-verified / externally sourced. "Wes said he starts Monday" never becomes "verified
  placement" because t.ROY repeated it.

**Wave T4 -- retrieval and verification**
- F11: web search results are another model's answer, not proof. Query minimization (no names,
  no private narrative), source excerpts, jurisdiction and date, evidence validation.
- Risk-sensitive checking: deterministic rendering for metrics, normal generation for low-risk
  coaching, strong evidence checks for legal facts, resumes, outcomes and staff records.

**Wave T5 -- separate workspaces**
- Demo workspace: synthetic tenant only, no outbound real-world actions. The `(Demo)` orgs and
  the "Sample data" line are the start of this, not the whole of it.
- Developer workspace: NOT in the shared assistant. Separate worker, credentials and network;
  reviewable patches; no production secrets in ordinary chat. Troy is recognised by
  authenticated identity and an explicit workspace choice, never by name or writing style.

**Wave T6 -- earn the claim**
- The evaluation table in the assessment, built on the two-org fixtures the isolation suite
  already has (they need: duplicate names, one person who is both staff and participant, a
  removed staff member). A mock malicious model that PROPOSES forbidden calls, so policy tests
  pass regardless of model obedience. Held-out cases the agent under test cannot edit.
- Measure legitimate completion, false refusals, groundedness, latency and cost alongside
  attack success. A defense that refuses everything is a failure.

## 3. What makes this the best reentry platform, not the most defended one

From the assessment, adopted as product direction because they are what a competitor with a
bigger job board cannot copy:
1. **A truthful skills history** -- every resume claim traces to something the participant
   confirmed. (The Forge truth gate is the beginning of this.)
2. **Inspectable confidence** -- what the person said, what the system recorded, what staff
   verified, what is unknown, kept visibly apart everywhere: t.ROY, Insights, funder exports.
3. **Visible, attributed assistance** -- staff suggest, participants decide what becomes their
   own work. Already the CRM's rule; t.ROY must obey it too.
4. **Continuity without forced disclosure** -- tablet, Forge, Refinery, staff, employment
   follow-up build on each other; a new audience never inherits an old one's access.
5. **Durable outcomes** -- retention, progression, wage growth, not just "hired".
6. **Tested with justice-impacted participants and working practitioners.** A secure assistant
   that is confusing, patronising or slow is not world class. This is the item no amount of
   code closes, and it needs Troy.
