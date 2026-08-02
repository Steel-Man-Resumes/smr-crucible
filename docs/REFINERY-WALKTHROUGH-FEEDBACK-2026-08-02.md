# Refinery Walkthrough Feedback -- 2026-08-02

Source: Troy's full freestyle walkthrough of The Refinery (desktop), captured and organized by CC. Companion to `FORGE-WALKTHROUGH-FEEDBACK-2026-08-02.md`. Includes three platform-level forward asks (Twilio, social sign-in, email package) plus the Refinery walkthrough.

Tags: [BUG] | [UX] | [DESIGN] | [COPY] | [FEATURE] | [DECISION]
Priority: P0 broken/confusing now | P1 strong improvement | P2 delight/polish

Code ground-truth (CC verified this session) is in section A. It is not Troy's opinion; it is what the repo actually does.

---

## A. Code ground-truth (verified in repo this session)

1. **Job board uses ONE provider: JSearch (RapidAPI).** File `apps/consumer/app/api/job-search/route.ts`. On any non-OK response (429 rate limit, quota exceeded) it logs to console and **returns an empty array silently** -- no error reaches the user. There is a **CareerOneStop (DOL) fallback**, but it is env-gated and a code comment records its creds returned 401 at build time, so it is effectively inactive.
   - **This is almost certainly the "did 4-5 searches, now null" bug.** JSearch RapidAPI tiers rate-limit/quota quickly; once tripped, every search returns `[]` with no message. Troy read it as "the AI is broken" -- it is the job API quota, silently failing. Same silent-failure pattern as the Resend/email incident.
2. **Auth providers (consumer):** Resend magic-link + password Credentials + a dev Credentials provider. **No Google/Facebook OAuth. No captcha/Turnstile.** So social sign-in and bot defense are both net-new.
3. **Twilio is scaffolded, not landed.** Env vars (`TWILIO_ACCOUNT_SID/AUTH_TOKEN/MESSAGING_SERVICE_SID`) are checked in `packages/core/src/systemHealth.ts`; `getUserProfile.ts` has SMS fields "present in the contract but populated once the Twilio/SMS migration lands"; A2P messaging service noted pending. Groundwork exists; send/reminder wiring does not.
4. **`apps/consumer`** = the whole user-facing app (Forge + Refinery). **`apps/web`** = the partner/B2B dashboard (orgs, projects, runs, artifacts) -- relevant to the Forge doc's partner-dashboard item.

---

## B. Platform-level forward asks (Troy, this session)

- [DECISION] **Email-me-my-package: confirmed, build it.** (From Forge feedback; Troy loves it.) Capture an email at the end of the Forge and deliver the resume+cover-letter+narrative package; doubles as a re-engagement hook toward the Refinery.
- [FEATURE][P1] **Investigate Twilio SMS for the platform.** Texting would be big for the job search: reminders, application nudges, interview prep pings, and more. **Email as fallback.** (Groundwork is already in the codebase -- see A.3. Troy's ecosystem already has A2P 10DLC approved elsewhere, so the compliance path is largely walked.)
- [FEATURE][P1] **Add "Sign in with Google"** (and consider Facebook/others). Give users options, **but fight bots** at the same time. (Net-new: no OAuth or captcha today. Recommend Google OAuth + Cloudflare Turnstile on the credentials/magic-link path.)

---

## C. Refinery walkthrough

### C1. Forge -> Refinery handoff
- [UX][P1] **Handoff felt broken even though the data carried over.** Troy left the Forge expecting to arrive in the Refinery with his resume and everything -- and the data DID carry over -- but he then had to do the whole sign-in process, which made it feel disconnected. The account creation/sign-in should feel continuous with the Forge, not like starting over.

### C2. Dashboard first impression
- [UX][P0] **Resume is not obviously present.** It should be **front and center in a regular-sized window**, not squished into a sidebar. Collapsible is fine (offer to collapse), but it should be prominent at first.
- [UX][P0] **Not obvious what to do.** For new users especially, make it **stupid-obvious what to do and why.**
- [UX][P1] **Order the menu/nav by priority,** at least for new users (see C6 -- Job Board belongs at the top).

### C3. Profile completion
- [UX][P1] **"Profile 50% done" is a dead signal.** The user does not know how to reach 100%, what happens at 100%, or why to invest the time. Make the path, the payoff, and the reason explicit.

### C4. Feature gating vs aspiration
- [DECISION][P1] **Gate token-expensive features (e.g., interview practice) behind profile completion + demonstrated readiness** -- to avoid wasting AI tokens. BUT still **show the feature is on the table, world-class, and that they will get a crack at it.** Locked-but-visible, aspirational, not hidden.

### C5. Onboarding tour
- [FEATURE][P1] **Mandatory first-run guided tour with coach-mark bubbles + arrows.** "This is that. Now you do it." Advances screen to screen, walking the user through and confirming they can operate the platform.

### C6. Navigation order
- [UX][P1] **Nav should go in priority order.** **Job Board at the top** -- it is the most important thing.

### C7. Role / identity switching (Troy operates multi-role)
- [FEATURE][P1] **Toggle between PartnerView and User.** Troy's own account shows PartnerView; he also job-searches for himself, so he needs to switch.
- [FEATURE][P1] **Assist / act-as another user or organization** to help them directly.
- [UX][P0] **When operating as another person, make it abundantly clear on screen** (persistent banner/indicator) to prevent acting in the wrong context.

### C8. "Application Tailor" screen + the "General" chip
- [BUG/UX][P0] **A deletable "General" chip is unlabeled and dangerous.** In Application Tailor there is a clickable "General" button with an X; Troy almost deleted it -- it is actually his resume. Label it clearly and protect it from accidental deletion.
- [UX][P1] **Every screen's purpose must be immediately obvious on landing.** This is a recurring theme, not a one-off.

### C9. Adaptivity to the user
- [DECISION][P1] **Tailor the experience to the user's state.** With high-end AI and good data, the platform should be aware of the user's condition, comfort level, and number of visits, and adapt what it shows accordingly.

### C10. Application Tailor is an advanced feature (repositioning)
- [DECISION][P1] **Application Tailor should be advanced, not front-and-center.** If the Forge did its job, most users do not need it initially.
- [DECISION][P0] **The Refinery's core loop is: start the job search immediately with a good (not great) resume in hand -> find a job they love -> THEN turn the good resume into a great, targeted one.** This ordering should drive the whole Refinery IA.

### C11. Job board -- data sources
- [FEATURE][P1] **Use multiple job-search APIs** that reliably return current, real listings. Named: **Indeed via MCP** (OpenAI/Claude can MCP into Indeed), plus **JSearch** (RapidAPI key already held). Make the integration solid.
- [BUG][P1] **De-duplicate across providers** when using more than one at once.

### C12. The apply chain (core Refinery flow -- currently broken)
Troy's intended sequence:
1. User finds a job; sees the **description on our platform first** (do the work here, then go to their site).
2. **Save the job** -> it goes on a list (Applications).
3. Platform **advises whether the resume should be revised to focus** on this role.
4. If the user decides to apply, we **tailor the resume + generate a cover letter + intro email**, etc.
5. **Last**, we link them to the **actual external apply page.**

Observed breakage:
- [UX][P0] **"Apply and view description" jumped straight to the external site,** skipping the tailor step. The chain fires in the wrong order.
- [BUG][P0] **"Move to apply" has no actual apply action** -- the chain dead-ends after Save.
- [BUG][P1] **"Build a targeted resume for this job" is offered even though he just did it** for that role -- no awareness of completed state; should disappear once done for that role.

Confirmed-good: Saved "Mitica Consulting" (Grand Rapids, MI) correctly landed in the **Applications tab.** Clicking through to the employer site worked.

### C13. File-upload / submission education (future feature)
- [FEATURE][P2] **Teach users how to save and submit their files across job platforms.** Different sites have different rules (some take PDFs, some email). Either assist at submission time or advertise it as a feature ("talk to t.ROY about it").

### C14. Lost search state
- [BUG][P1] **Returning to the job board loses the previous search** (query + results gone). Persist the last search and results.

### C15. Silent AI/search failure
- [BUG][P0] **After ~4-5 searches, results came back null with no explanation.** Root cause is very likely the JSearch quota/rate limit silently returning `[]` (see A.1). Needs: an inactive-fallback fix, a real user-facing message on API failure, and the multi-provider work in C11.

### C16. "Coming soon" stubs
- [UX][P2] **Job application tracking shows "coming soon"** on the job board. Noting it is stubbed / not yet on the near roadmap, even though a basic Applications tab and `/api/applications` exist.

---

## D. CC analysis -- the through-lines

Four themes explain most of the individual items:

1. **The Refinery has no clear first-run spine.** Resume hidden, purpose of each screen unclear, profile % with no payoff, nav not prioritized, no tour. Fix pattern: a first-run orientation layer (tour + ordered nav + prominent resume + per-screen purpose headers + locked-but-visible aspirational features).
2. **The core job-search loop is defined but not wired in order.** C10 + C12 are the real product: Job Board -> see description here -> save -> advise -> tailor+letter+email -> external apply. Everything else (Application Tailor as advanced, nav order) falls out of getting this loop right.
3. **The app is not state-aware.** It offers "build targeted resume" after it was done, "move to apply" with no apply, loses searches, and re-offers finished steps. A shared per-user application/session state model fixes several bugs at once and enables the adaptivity in C9.
4. **Silent failures keep surfacing** (null search, earlier the paste parser, earlier the email incident). The platform needs a standing rule: **never fail silently to the user** -- every API/AI failure gets a human-readable message and, where possible, a fallback. This is Troy's own doctrine; the Refinery violates it in the job board.

## E. Recommended change sequence (for Troy's decision)

- **P0 batch -- "make it not confusing/broken":**
  - Fix the silent job-search failure: activate/replace the fallback, surface real errors, verify the JSearch quota. (Also unblocks the multi-provider work.)
  - Make the resume prominent on the dashboard; label the "General" chip and protect it.
  - Fix the apply chain ordering and the dead "move to apply."
  - Persistent "acting as" indicator for role switching.
- **P1 batch -- "give it a spine":**
  - First-run guided tour + ordered nav (Job Board top) + per-screen purpose headers.
  - Profile completion: show path, payoff, and gated-but-visible features.
  - Multi-provider job search (JSearch + Indeed MCP) with de-dup.
  - PartnerView/User toggle + assist-as-user.
  - Reposition Application Tailor as advanced; wire the save -> advise -> tailor -> apply loop.
- **Platform tracks (parallel):**
  - Google OAuth + Turnstile bot defense.
  - Twilio SMS reminders (email fallback) -- groundwork already present.
  - Email-me-my-package (shared with the Forge handoff).

## F. Status
Captured and analyzed. No code changed. Awaiting Troy's direction on sequence and on which track to start. Refinery + Forge feedback docs are now both in `docs/`.
