# Session Summary -- 2026-06-07

**From a correct-but-inert engine to a verified platform, live in production.**

Author: Claude Opus 4.8 (CC), working session with Troy Carr.
Scope: Steel Man (the Crucible monorepo -- The Forge and The Refinery).

This is a narrative record of a single, long working session. It is written to
capture not only what shipped, but the reasoning, research, and judgment behind it,
because most of the value created here was decided before it was coded.

---

## The mission this serves

Steel Man turns a person's story into a job. It is built for justice-impacted people
and the organizations that support them, and the product is not a tool list -- it is a
single, guided journey from self-understanding to an offer. That framing set the bar
for every decision below: the platform must be trustworthy to a vulnerable population,
honest about what it stores, and intelligent about what to do next.

## The headline

The platform began the session with an excellent intelligence engine that did not
actually move. By the end it was a live, instrumented, end-to-end system running on a
clean, monitorable production universe, with real verified employer data, a
consent-gated partner view, an admin health readout, and open-source-ready licensing.

The work fell into six themes. None of them was primarily "write code."

---

## 1. Making the intelligence engine real

The journey engine (`computeNextStep` over `getUserProfile`) was correct as a rules
ladder, but several of its gates read from data sources nothing ever wrote. The
journey could not advance past the resume step, and -- this was the part the inbound
handoff missed -- it actually halted one stage earlier, at disclosure, because that
gate was also unfed. A second subtle gap: the engine's own "next step" card linked to
a route the resume workspace silently ignored.

The fix was instrumentation, not new features: wire the real completion signals
(resume linked to its saved job, disclosure plan persisted, interview practice
recorded, application status and follow-up) and invalidate the cached next step when
state changes. Each gate transition was proven against the live database with
throwaway scripts (Stage 3, then 4/5, then 6), not assumed from a green build.

The judgment that mattered here: treat an upstream handoff as a hypothesis, not a
spec. Verifying it against the running code surfaced the earlier halt, a stale-cache
behavior, and a route mismatch that a literal implementation would have shipped
broken.

## 2. A privacy and pedagogy decision, not a feature

The interview and disclosure tools displayed "Nothing here is saved or shared," yet
the journey needed a persisted completion signal to advance. That is a genuine
conflict, and for this audience -- people practicing how to talk about a record -- it
is a trust decision, not an implementation detail. Rather than quietly flip a promise,
the conflict was surfaced for the operator's call.

The resulting doctrine, set by Troy: keep data so the experience is progressive and
the tools work as designed, but teach frames, not scripts. The platform now stores the
frame a person practiced and whether their point landed (the coach's assessment),
never their words, transcripts, or audio. The on-screen copy was rewritten to say
exactly that, honestly. A latent bug was found and fixed in the same pass: consent
writes could fail on a fresh database because an audit event required a record that
did not exist yet; an audit failure must never block a person's consent.

This is privacy engineering for a vulnerable population, with the compliance posture
made explicit (data minimization, consent-gated sharing, deletability, and a flag that
the final user-facing language deserves an attorney pass before public launch).

## 3. Refusing to break production

When asked to deploy, the responsible move was to look first. The investigation found
that the Vercel project is git-connected (a push to `main` is a production deploy),
that production was many commits behind on the old shared database, and that the new
code required schema the old database did not have. Pushing blindly would have taken
down a live partner pilot.

That finding was surfaced instead of executed. It led to a deliberate decision -- a
clean cutover to a brand-new, fully separate, monitorable Steel Man universe (new
database, new keys, new accounts) -- rather than an accidental one. The two sessions of
unpushed work were first backed up to a branch (a safe preview, no production impact)
while the cutover was planned properly.

## 4. Building for monitorability

A separate universe is only safe if you can see it. A system-health module was built
(`getSystemHealth`) and exposed as an admin-only panel: database connectivity and row
counts, latest migration, auth configuration, email sending-domain verification, live
AI-key validity (via free metadata calls, no generation spend), and integration
status -- all without exposing a single secret value. Run against the new universe, it
confirmed the operator's environment setup was correct and complete (verified sending
domain, valid AI keys) and surfaced the exact, small list of cutover seed steps that
remained. This doubled as the "check my work" the operator wanted, achieved without
adding any new secret.

## 5. Real, verified data -- and the integrity to publish conservatively

The fair-chance employer board was populated from the operator's own research base,
not invented. Pulling it required noticing that the available integration could not
reach the base and that only a scoped token could -- a small access puzzle solved
without ever printing the secret. Sixty-seven employers were imported; the board
publishes only the verified, best-fit tier (and caught that the data had a tier above
"Good" that the first rule missed). The source had duplicate rows, so the board
dedupes defensively and the duplication was flagged for cleanup at the source. The
principle throughout: never fabricate, never over-claim verification, protect the
operator's reputation.

## 6. Open-source readiness

For the planned public release, a full secret scan was run across the working tree and
all of git history: clean, zero matches, with the env files confirmed ignored and only
placeholder examples tracked. The repository was given a verbatim AGPL-3.0 license, a
public-facing README, and a SECURITY and CONTRIBUTING policy that encode the mission
and privacy guardrails as contribution standards.

---

## The disciplines that ran through all of it

- **Verify, do not assume.** Every behavioral claim was proven against the live
  database or running system. "It compiled" was never treated as "it works." Roughly
  forty assertions across disposable, self-cleaning verification scripts.
- **Surface, do not barrel through.** Genuine decisions (a trust promise, a deploy that
  would break a pilot, an ambiguous data model) were raised for the operator rather
  than resolved unilaterally.
- **Reuse, do not duplicate.** New capabilities were built on the existing consent,
  artifact, and access-code models rather than parallel structures, keeping one source
  of truth.
- **Mission and brand as constraints.** Justice-impacted language, fair-chance framing,
  coaching not legal advice, plain reading level, and no leaked secrets were treated as
  requirements, not preferences.

## Verification ledger

- Stage 3 instrumentation: 13/13 against the live database.
- Stages 4/5/6: 10/10 and 5/5.
- Partner dashboard (consent gating, ownership, CSV, admin): 14/14.
- System health: run live against the new universe (all green except the intended
  local-only mock flag).
- Employer import: 67 imported, 18 distinct verified employers published.
- Secret scan: 0 matches across all history.

## What is live now

The full guided journey advancing on real data; the AI coach; the fair-chance board
with eighteen verified Wisconsin employers; resume, disclosure, and interview tools
with an honest privacy posture; a follow-up generator and a materials vault; a
consent-gated partner dashboard; an admin health panel; a seeded demonstration cohort;
and open-source-ready licensing. Deployed to production on a clean, separate,
monitorable universe.

## What is next

End-user testing is underway. The immediate priority is to triage and resolve that
feedback. Remaining engineering: a Playwright smoke pass, PWA packaging, calendar and
SMS (pending carrier approval), encrypted document upload, and an admin publish toggle
for the employer board. See `HANDOFF-2026-06-07-SESSION-CLOSE-LIVE.md` for the
operational state.
