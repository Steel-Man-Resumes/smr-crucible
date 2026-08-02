# Refinery Core-Loop Proposal -- 2026-08-02

**Purpose:** Define the Refinery's core user loop and the information architecture that falls out of it, so implementation can proceed in the right order. This is the spine; the full punch lists live in `REFINERY-WALKTHROUGH-FEEDBACK-2026-08-02.md` and `FORGE-WALKTHROUGH-FEEDBACK-2026-08-02.md`.

**Audience:** A fresh session (Fable) with no prior context. Everything needed to act is in this file. Read sections 1-3 first; they are the decision. Sections 4-8 are the spec. Section 9 is the open decisions that need Troy before building.

**Status:** PROPOSAL. Nothing here is built. Do not change auth, the resume parser, or the job flow without Troy's explicit go.

**House rules (enforce in all output):** no em dashes (use double hyphens or restructure); no emojis; "justice-impacted" only (never "second-chance/ex-con/felon/offender"); never invent metrics.

---

## 1. Context (what these apps are)

Steel Man Resumes (SMR) is a free AI career platform for justice-impacted job seekers. It has two apps in one monorepo (`smr-crucible`):

- **The Forge** (`apps/consumer`, unauthenticated + `(forge)` / `(mini-forge)` routes): a **one-and-done** intake. A person enters their history any way they can, and the Forge produces a **base resume + cover letter + narrative**, then creates them a Refinery account. The Forge's output is deliberately **good, not great.**
- **The Refinery** (`apps/consumer`, authenticated dashboard + APIs): the **ongoing home.** This is where the base resume becomes real job applications.
- (`apps/web` is the separate partner/B2B dashboard -- out of scope for this proposal.)

## 2. The core thesis (this is the whole proposal in three sentences)

The Refinery's job is **not** to perfect a resume in the abstract. It is to get a person with a good-enough resume **applying to real jobs immediately**, help them **find a job they actually want**, and only then spend effort turning the good resume into a **great, targeted** one **for that specific job.** Tailoring is a consequence of choosing a job, not a prerequisite to looking.

Everything else in this document is downstream of that sentence.

## 3. What this implies (the decisions that fall out)

1. **Job Board is the center of gravity.** It is the top nav item and the default landing surface for a returning user with a base resume. (Feedback C6.)
2. **Application Tailor is an advanced/secondary feature, not a front door.** If the Forge did its job, a new user does not need it before they have chosen a job to target. (Feedback C10.)
3. **Tailoring is per-job and triggered inside the apply chain,** not a standalone thing the user is nagged to do up front. (Feedback C12.)
4. **The base resume is always visible and is the anchor object.** It is the "General" resume the user saw in Application Tailor -- that label is confusing and must change (see section 6). (Feedback C2, C8.)
5. **The app must be state-aware.** The single biggest source of the reported bugs is the app not knowing what the user has already done for a given job. A per-job application state model (section 5) fixes several bugs at once.

---

## 4. The core loop (canonical flow)

```
                    [ Job Board ]  <-- default surface, real listings
                          |
              search / browse real jobs
                          |
                    view a job
                          |
        +-----------------+------------------+
        |  On OUR platform first:            |
        |  - full description shown here     |
        |  - fit read vs the base resume     |
        +-----------------+------------------+
                          |
                   [ Save job ]  ---> lands in Applications list (state: SAVED)
                          |
              user decides: pursue this?
                          |  yes
                          v
     [ Advise ]  platform assesses fit and recommends:
        - apply as-is (base resume is strong enough), or
        - tailor recommended (gap between resume and this role), or
        - weak fit (encourage but flag)
                          |
              user chooses to apply
                          v
     [ Tailor package ] (only now, only for this job):
        - targeted resume (base resume, refocused for this role)
        - cover letter (docx-only; it must be edited)
        - intro email
                          |
              user reviews package on-platform
                          v
     [ Apply ] LAST step: link out to the employer's actual apply page
                          |
                          v
              mark APPLIED; job stays tracked in Applications
```

Key ordering rule (currently violated): **the external apply link is the LAST step, after the on-platform work -- never a shortcut that skips tailoring.** Today "Apply and view description" jumps straight to the employer site, and "Move to apply" dead-ends with no apply action. Both are the chain firing in the wrong order or not at all. (Feedback C12.)

## 5. Application state model (the technical backbone)

Give every saved job a single state per user. The UI is a pure function of that state -- this is what makes the app stop offering finished steps and stop losing context.

| State | Meaning | Primary CTA shown | Notes |
|-------|---------|-------------------|-------|
| DISCOVERED | In search results, not saved | Save | Not persisted per-user yet |
| SAVED | On the Applications list, no work done | Review this job | From the job board Save |
| REVIEWING | User opened the on-platform description | Assess fit | Auto or on-open |
| ADVISED | Fit read + recommendation exist | Tailor for this job / Apply as-is | Recommendation stored |
| TAILORING | Package being generated | (progress) | resume + letter + email |
| READY | Targeted package generated | Review package, then Apply | Do NOT re-offer "build targeted resume" here (Feedback C12 bug) |
| APPLIED | User marked applied / clicked out | View / follow up | Enables future tracking |

Rules the state model enforces (each kills a reported bug):
- **"Build a targeted resume for this job" only appears in ADVISED,** never in READY/APPLIED. (Fixes the "offered it after I just did it" bug.)
- **"Apply" (external link) only appears in READY or later,** or as an explicit "apply as-is" branch from ADVISED. (Fixes the dead "move to apply" and the premature jump-to-site.)
- **The last job search (query + results) persists** so returning to the board restores it. (Fixes the "search was gone" bug -- Feedback C14.) This is session/board state, adjacent to the per-job state.

Existing code to build on: `apps/consumer/app/api/applications/route.ts` (applications persistence), `apps/consumer/components/resume/ResumeWorkspace.tsx` (workspace UI), `apps/consumer/app/api/job-search/route.ts` (search). Verify current schema before adding states; extend, do not fork.

## 6. IA / navigation (what the loop dictates)

Nav order for a new user (top to bottom = priority):
1. **Job Board** (default landing for a user who has a base resume)
2. **Applications** (their saved jobs + states from section 5)
3. **My Resume** (the base resume -- prominent, see below)
4. **Interview Practice** (locked-but-visible until profile complete + a demonstrated readiness gate; see section 7)
5. **Application Tailor** (advanced; most users reach tailoring through the apply chain, not here)
6. **Profile / Settings**

Resume prominence (Feedback C2): the base resume must be **front and center in a regular-sized window** on the dashboard, collapsible but not hidden in a squished sidebar.

Rename the "General" object (Feedback C8): the deletable "General" chip in Application Tailor is the user's base resume. Relabel it clearly (e.g., "Base resume -- from your Forge session") and protect it from one-click deletion. A base resume is the anchor of the whole loop; it should not be casually X-able.

Per-screen clarity (recurring theme): every screen states its purpose on landing. A returning user should never wonder "what is this and what do I do here."

## 7. Gating (protect tokens, stay aspirational)

Token-expensive features (interview practice especially) are **locked-but-visible**: shown as world-class and on the table, unlocked after (a) profile complete and (b) a readiness signal (e.g., at least one application in flight). The lock communicates value and a clear path to earn it -- it does not hide the feature. (Feedback C4.) Pair with a profile-completion UI that shows the path to 100% and the payoff of getting there. (Feedback C3.)

## 8. Dependencies this loop assumes (owned elsewhere, flagged here)

The core loop only works if these hold. They are specified in the feedback docs; do not solve them inside this proposal, but do not assume them away:
- **Job search actually returns real jobs and fails loudly.** Today it is single-provider (JSearch/RapidAPI) and returns an empty array silently on quota/rate-limit, which reads as "the AI broke." The loop needs reliable multi-provider search (JSearch + Indeed via MCP, de-duplicated) and user-visible errors on failure. (See `REFINERY-WALKTHROUGH-FEEDBACK` A.1, C11, C15.)
- **The Forge -> Refinery handoff feels continuous** (data already carries over; the sign-in wall makes it feel like starting over). (Feedback C1.)
- **Role/identity switching** (PartnerView vs User; act-as-user) with a persistent "acting as X" indicator, since Troy operates in multiple roles. (Feedback C7.)

## 9. Decisions -- RESOLVED (Troy, 2026-08-02)

All five confirmed. Build to these; do not re-litigate.

1. **Default landing surface:** Job Board directly for a returning user with a base resume. CONFIRMED.
2. **"Apply as-is" branch:** allow apply-as-is when the base resume is a strong match -- speed is the point. CONFIRMED.
3. **Readiness gate for interview practice:** profile complete AND at least one application in flight. CONFIRMED.
4. **Tailoring depth:** the targeted resume is a **lighter refocus of the base**, not a full regeneration. A user who wants a fuller remodel does that by **starting from scratch** (a separate, deliberate action). CONFIRMED.
5. **Resume length:** **cap most resumes at one page**, but **allow two pages when qualifications are genuinely lengthy.** This is a rule-based judgment (fit to one page by default; expand to a clean two-page layout only when content warrants), not a hard truncation. CONFIRMED.

## 9b. Finished-resume design customization (new feature -- Troy, 2026-08-02)

Give the user a section to **tailor the visual design of the finished resume** -- a few controlled options, not a full design editor:
- **Color** (accent/theme color, from a curated safe set that stays ATS-friendly and print-safe).
- **Font** (a small curated list, not arbitrary fonts).
- **General style** (a couple of layout/tone presets).

Intent: give the person real control over the look of their resume with a couple of tasteful knobs, without letting them break readability or ATS-parseability. Keep the option set small and every combination export-safe (docx + pdf). This is a **polish-tier feature** -- valuable and wanted, but sequence it after the core loop and state model land (see section 10).

## 10. Suggested build order (section 9 resolved -- ready to build)

1. Application state model (section 5) + persist last search (C14). This is the backbone; it removes several bugs by itself.
2. Wire the apply chain to the state model (section 4 ordering): kill the dead "move to apply," gate the external link to READY, stop re-offering finished steps. Tailoring here is a lighter refocus of the base (9.4).
3. IA reorder + resume prominence + rename/protect the base resume (section 6).
4. Gating + profile-completion UI (section 7).
5. Reposition Application Tailor as advanced; tailoring is reached through the chain.
6. **Polish tier (after the loop is solid):** resume length rule -- one page default, clean two-page when warranted (9.5) -- and finished-resume design customization (color/font/style, section 9b). Keep every option export-safe and ATS-friendly.

Dependencies in section 8 (reliable search, handoff, role switching) run as parallel tracks and are specified in the feedback docs.

---

## Handoff note
This proposal is the agreed spine per Troy's 2026-08-02 walkthrough analysis. The two feedback docs in this same `docs/` folder hold the complete item-level lists and the code ground-truth. Start with section 9 (get Troy's five answers), then section 10.
