# Fable Reassessment -- t.ROY Agency + Unified Platform

**Date:** 2026-06-10 (same Fable session as `FABLE-ANALYSIS-REPORT-2026-06-09.md`)
**Trigger:** Troy's answers to the analysis + new directive: the platform's center of gravity is **t.ROY's intelligence and agency**, inside a unified suite (web + Mini Forge tablets + future native apps), open-sourced Aug 15 with seat licensing + consulting.

---

## 1. What Troy's answers changed in the analysis

| Finding | Troy's answer | Status |
|---|---|---|
| Fabricated numbers on tailored resume | "I didn't tell it any numbers; it totally fabricated those" -- and base-resume numbers too | **P0-1 operator-confirmed, both lanes.** Highest priority stands. |
| Recovery-services career path | Persona DID mention recovery | **Withdrawn.** The analysis personalized correctly -- a point FOR the intelligence layer. |
| Identity desync | Persona split was intentional; "if it would persist to a regular user, fix it" | **In scope.** The contact-clobber + Tailor-contact-source bugs hit real users (any account name != resume name; any forge re-sync wipes saved contact). Now also the FOUNDATION for agency (sec. 3). |
| From-scratch builder | Never meant to be a feature; Dr. Baker insisted; added last-minute. "Make it simply award-winning if we have to include it." | **Elevated to commitment.** Plan in sec. 4. |
| Forge emergency output | "Ill-advised... tighten the disclaimer and make the process better" | Truth-gate + honest draft framing both confirmed. |
| Cohort logistics | Unknown -- "wing it" | Build the seat model anyway (sec. 6); it's the durable answer. |
| Brand | "Steel Man" condensed is correct for the 501(c)(3); SMR stays the original business name; the name is the antidote-to-strawman story | Brand sweep = real to-do before Aug 14 public materials. |
| Refinery footer on resumes | Remove from resumes entirely; fine on websites/apps | Confirmed fix (resumeModel.ts:264). |

Open note: Troy used the from-scratch path and never touched the bullet workshop -- the most differentiated feature went unseen by its own builder on a quick pass. That is a discoverability finding, not a user error (sec. 4).

---

## 2. Why t.ROY was "clueless" -- the exact mechanism (verified in code)

There are **two half-sighted brains**:

1. **`/api/coach`** (the authenticated Refinery drawer; `AssistantChat` posts here when mounted with `coach`): its request contract is **`{ messages }` only** (`app/api/coach/route.ts:67-73`). The dashboard layout assembles rich context -- `currentPage`, `userFullContext`, readiness, skills (`app/(dashboard)/layout.tsx:419-431`) -- **and the coach API never receives any of it.** The coach knows the journey (via `getUserProfile`) but is page-blind by contract. Ask it "what does this page do?" on /dashboard/disclosure and it cannot know you are on the disclosure page.
2. **`/api/assistant`** (t.ROY on the Forge/public surface): page-aware -- it takes the full `AssistantContext` (`lib/assistant-prompt.ts:27-63`) including `userFullContext` -- but the Forge layout doesn't pass `userFullContext` (`app/(forge)/layout.tsx:41-60`), and pre-auth there is none, so the prompt falls back to "No full context loaded -- work from current page signals only" (`assistant-prompt.ts:514`).

So: **the page-aware brain lacks the journey; the journey-aware brain lacks the page.** Troy's experience was not a model problem or a prompt problem -- it is a context-plumbing problem, and it is cheap to fix relative to its impact.

**The good news discovered while tracing:** the agentic plumbing already exists in embryo. The coach route already runs AI SDK `streamText` **with a tool wired in** (`webSearchTool`, `app/api/coach/route.ts:20`), persists conversation history, and has a proactive-trigger endpoint (`/api/coach/proactive`) that the drawer already polls. `computeNextStep`, `getUserProfile`, `/api/user/context`, decision logging, and the skills library all exist in core. **t.ROY-as-agent is an integration project, not a greenfield build.**

---

## 3. The t.ROY agency architecture -- three phases

### Phase A -- Omnipresence (one brain, full sight). Target: pilot week (June 16-20)
- **One context envelope.** Coach route accepts `{ messages, context }` (the same `AssistantContext`); server-side it merges `getUserProfile` + `computeNextStep` + the page context. The assistant route, for authed users, fetches `userFullContext` server-side instead of trusting the client to pass it.
- **Page state, not page name.** Each surface passes a structured snapshot: route id, what is on screen (e.g., which resume artifact is open, which job is expanded, current step within a tool), last user action. Deterministic injection -- "knows exactly where the user is" by construction, never by model guessing.
- **Merge the brains' knowledge, keep one persona.** t.ROY is the public name (little t, big ROY). Whether `/api/assistant` and `/api/coach` stay two routes or become one, the USER experiences one t.ROY that always knows page + journey. (Recommend: keep two routes short-term -- pre-auth vs auth boundaries differ -- but share the context-builder module.)
- Wire the existing proactive triggers to page mounts ("I see you just built your disclosure plan -- want to rehearse it out loud?").

### Phase B -- Bounded agency (t.ROY acts). Target: late June - mid July; flagship demo for Aug 14
Add mutation tools to the coach's existing AI SDK tool array. The flagship set:

| Tool | What it does | Why it's the demo |
|---|---|---|
| `update_identity({field, value})` | Changes name/phone/email/city ONCE at the canonical source and propagates: `users` row, `consumer_profile.contact`, base resume artifact contact, offers to update tailored artifacts | "t.ROY, change my last name from X to Z" -> changed everywhere. **This is the stage moment.** Requires the P1-1 single-source-of-truth fix first -- that bugfix IS the foundation of agency. |
| `edit_resume({artifactId, section, instruction})` | Targeted edit honoring the truth gate; returns a before/after diff | "I don't like how that bullet reads" -> fixed, truthfully |
| `regenerate_document({type, applicationId, note})` | Re-runs Tailor/cover letter with the user's spoken correction | closes the feedback loop on generation |
| `navigate({to})` | Renders a deep-link button (no auto-redirect) | already the master-plan pattern |
| `get_my_status()` | Reads computeNextStep + journey | lets t.ROY answer "where am I / what's next" exactly |

**Guardrails (non-negotiable):**
- Every mutation renders a **confirm-card with the diff** ("Here's what I'll change -- Apply?") before applying. Auto-apply can become a user setting later; confirm-first at launch.
- Every tool call decision-logged (pattern exists).
- Tools scoped to the requesting user's own rows, by construction (server derives userId from session, never from the model).
- The truth gate binds agent edits exactly as it binds generation.
- Tools never touch record/disclosure data except via the existing consent-gated flows.

### Phase C -- The adaptive platform (progressive disclosure). Target: starts pre-conference, matures after
- UI density driven by journey stage + interaction history: completed-stage noise collapses, the next action is always the loudest element (the `computeNextStep` card pattern, generalized). New-user sees 3 things; power user sees the full toolbox.
- t.ROY relationship depth: interaction count unlocks more personal tailoring (the "opens up" behavior Troy described) -- driven by `coach_conversation` volume + milestones, expressed in the prompt builder.
- **PWA shell** (manifest + service worker + installability + offline resume/interview scripts) is the same workstream -- and it is the cheapest path to the app stores: Play Store via TWA wraps the PWA; iOS via Capacitor later. **Recommendation: do NOT start native app builds before Aug 14.** Ship the PWA; announce apps as the roadmap.

**Honest Aug-14 scope:** all of Phase A; Phase B with the flagship 3-5 tools working on stage; Phase C as one or two visible behaviors (adaptive dashboard + t.ROY proactive nudges). That is demonstrably "an agent with full autonomy under user command" without promising what isn't hardened.

---

## 4. The from-scratch builder -- path to "simply award-winning"

The spine already exists (Phase 7: ingest -> assess -> build -> carry-forward). What "award-winning" requires, in order:

1. **Truth-gate `generate-docs`** (P0-1) -- an award-winning builder cannot fabricate. Done this week.
2. **Make the workshop unmissable.** Troy built a resume and never saw the product's crown jewel. In the guided/from-scratch path, weak or number-less bullets should AUTO-OPEN the workshop (or inline its 5 questions as the default way bullets get written), not wait behind a small "Strengthen with help" link. The workshop IS the from-scratch experience.
3. **Adaptive extraction depth** (spec 7.3's promise): run the progressive-intake engine inside the builder -- thin material -> deeper interview; rich import -> 1-2 confirmations. The engine exists (`lib/intake-engine.ts`); it is wired into disclosure but not the builder.
4. **Import-first posture** (Troy's instinct stands): Indeed/LinkedIn import + IRS/Work Number/Credly recovery links stay the promoted path; from-scratch is the full-care path for people with nothing -- which is exactly the population story for Dr. Baker.
5. **Honest draft framing:** until a workshop/intake pass has touched the bullets, exports carry a visible "DRAFT -- make sure you can defend every line" treatment (Troy's "tighten the disclaimer" answer).
6. Certifications field + the artifact-layer fixes from the report (they all land on this surface).

---

## 5. Unified suite -- ground truth

- **Mini Forge: FOUND -- it is already in this monorepo** (`apps/consumer/app/(mini-forge)/`), with the tablet flow + import-code handoff into the main Forge. No separate repo hunt needed. Unification task = keep it on the same builder spine + truth gate, and include it in the Aug QA pass (tablet viewport).
- **One DB, one identity, events everywhere** -- "every interaction reflects platform-wide" is exactly the single-source-of-truth discipline. The bugs in the analysis report (contact clobber, Tailor ignoring the base artifact, localStorage dependence) are precisely the places the platform violates it today. Fixing them is not cleanup; it is building the unified platform.
- **Apps:** PWA -> TWA (Play) -> Capacitor (iOS), post-conference. The PWA work doubles as conference polish (installable on phones in the room).

## 6. Seats + licensing model (Troy decision 2026-06-10: admin-assigned seats, start at 10)

Design on top of what exists (`access_code` has usage limits, redemption log, partner ownership; W7 partner dashboard keys on code OWNERSHIP):
- `access_code.seat_limit` (default 10): a redemption consumes a durable seat (one registered user, forever -- not concurrent). Redemptions beyond the limit are refused with a friendly "ask your organization" message.
- **Role/tier split (resolves the flagged tier tension):** redeeming a seat makes you a `client` (full journey, onboarding intact) with the code's `daily_limit`; the code OWNER is the `partner` (dashboard, cohort view). Seat-holders never skip the journey.
- **Pre-auth Forge limits become code-aware:** a forge session that entered via `/access?code=X` carries the code; forge endpoints validate it and count against a per-code bucket instead of the shared IP bucket. Solves classrooms/labs/libraries permanently and gives per-org pilot telemetry (the data story for Marianne + funders).
- Admin console: create/disable codes, set seats + daily limits, see redemptions + usage per org. This IS the licensing mechanism for the open-source-plus-hosted model: a "license" = a partner code with N seats on Troy's hosted instance.

## 7. Revised runway to Aug 14

| Window | Workstream |
|---|---|
| **Jun 10-13 (pre-pilot)** | Truth-gate both prompts; seats v1 + code-aware forge limits; identity single-source fix (clobber + canonical contact -- agency foundation); footer removal; legal disclaimer; model tiers (DEEP for resume/disclosure/analyze); em-dash prompt lines. Redeploy + fresh full-flow retest. |
| **Jun 16-20 (pilot live)** | t.ROY Phase A (one sighted brain, proactive on page mounts); workshop-unmissable in builder; disclosure live voice (shared LiveVoicePanel + plan/evidence injection); job-board filters + honest verified badges. Watch pilot telemetry daily. |
| **Jun 23 - Jul 11** | t.ROY Phase B tools (update_identity flagship -> edit_resume -> regenerate); Tailor loads structured base resume server-side; PDF unification (server-side generation); builder adaptive-intake pass; brand "Steel Man" sweep on public surfaces. |
| **Jul 14 - Aug 1** | PWA (manifest/SW/offline/installable); Phase C adaptive dashboard behaviors; Mini Forge QA on tablet; load test (50 concurrent); OSS prep pass (.env.example, seed docs, key handling); demo script with the t.ROY agency moment + voice moment + fallback drills. |
| **Aug 4-13** | Feature freeze; bug-only; rehearsals (3 full demo runs on conference hardware); Aug 15 repo-public checklist. |

## 8. Decisions Troy has already made in this exchange (recorded)

1. Truth gate: fix both generation lanes; tighten draft disclaimers. 2. Footer: off resumes, fine in-app. 3. Seats: admin-assigned, 10 to start. 4. Identity: fix everything that would hit a real user. 5. Builder: keep + make award-winning. 6. Brand: "Steel Man" public for the 501(c)(3); SMR remains the underlying business/domain. 7. t.ROY: omnipresent, progressively personal, and AGENTIC (typed or spoken corrections; "change my last name" propagates platform-wide).

## 9. Remaining decisions for Troy (small set)

1. **Agency guardrail default:** confirm-card before every t.ROY mutation (my strong recommendation at launch) -- or auto-apply with undo? 
2. **Seat semantics confirmed?** 1 seat = 1 registered user, durable. Partner staff get a separate staff code or owner-granted partner role.
3. **Voice scope for disclosure:** minimal (talk to the plan) or full parity (plan + strengths + evidence injected, feedback card after)? Recommendation: full parity -- it is one more prompt block.
4. **Green light** to start the Jun 10-13 P0 batch now?
