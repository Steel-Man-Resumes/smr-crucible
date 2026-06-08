# SMR Crucible -- Session Handoff
**Date**: 2026-06-08
**Session focus**: Refinery UX overhaul, unlock gate fixes, intelligence architecture pivot, disclosure coaching skill file
**Deploy status**: ALL changes pushed to `main`, live at forge/refinery.steelmanresumes.com

---

## What Was Built This Session

### Round 1 -- Disclosure Planner UX (from previous session carry-over)

All committed to main, deployed:

**Adjust button** (`dashboard/disclosure/page.tsx`)
- Was: `setStep("assess")` -- destroyed the generated plan and reset to step 1
- Now: opens an inline refinement panel with 5 quick-select chips (tone, length, strengths focus, legal detail, shorter) + freetext field
- "Refine My Plan" calls `/api/disclosure-guide` with existing context + `refinementNote` param
- API (`disclosure-guide/route.ts`) injects refinementNote before the generation rules so the plan is adjusted, not regenerated from scratch
- "Start over instead" link still exists for users who want it

**PDF Download**
- "Save PDF" button in plan header opens a styled print-ready HTML document in new tab
- Section headers in sage green, script as a blockquote, footer "this plan is yours, never shared"
- Uses `window.open()` + `window.print()` pattern (same as resume PDF)

**Voice Input (Practice Mode)**
- Mic button added to left of the rehearsal text input
- Web Speech API: `window.SpeechRecognition || window.webkitSpeechRecognition`
- Pulses red while recording (CSS animate-pulse on border)
- On speech-end: appends transcript to existing input text
- Chrome/Edge only -- shows helpful message in unsupported browsers

**Confetti celebration**
- `MilestoneCelebration` component inlined at bottom of disclosure page
- Fires on FIRST plan generation only (suppressed on refinement re-runs via `!refinementNote` check)
- Dignified: 38 particles, sage/gold palette (`#4D7C5A`, `#C4A35A`, `#D4B896`), CSS keyframe `smr-confetti`
- Auto-dismisses at 3.2 seconds
- "Disclosure Plan Built -- Saved to your materials" toast overlay
- `disclosure-saved` event dispatched to nav after artifact saves

**t.ROY nudge in Practice Mode**
- Sage card at bottom of rehearsal step: "Ask t.ROY" for live coaching on responses

### Round 2 -- Dashboard improvements

**JourneyProgressBanner** (`components/JourneyProgressBanner.tsx` -- NEW)
- 4-step progress: Forge → Profile → Resume → Practice
- Driven by `useOnboarding.state`
- Renders at top of all dashboard pages except Settings/Admin/Partner
- Shows percentage + encouraging message for next step
- Sage green dots/bar, step labels

**Floating button cleanup** (`layout.tsx`)
- `ContactTroyButton` and `GuidedTour` REMOVED from dashboard layout
- Only `AssistantDrawer` (Ask t.ROY) remains as floating element

### Round 3 -- Unlock system overhaul

**Root cause of unlock not working (TWO places):**

BUG 1 (workspace): `runCareerPackage` in `ResumeWorkspace.tsx` set `createdFrom: "forge"` in the pre-fill updateDoc call. Fixed to `"job"`.

BUG 2 (API -- the real root cause): `resume-generate-full/route.ts` line 197 returned `createdFrom: "forge"` in the resume document. When `setDoc(resume)` was called after generation, this OVERWROTE the workspace-level fix. Fixed to `"job"`. Added `"job"` to the `createdFrom` union type in `resumeModel.ts`.

**Resume-saved event dispatch**
- After first artifact POST in `save()` function: `window.dispatchEvent(new Event("resume-saved"))`
- `useOnboarding` listens for this event and refreshes after 500ms
- Nav update is now automatic without page refresh

**useOnboarding enhancements** (`lib/useOnboarding.ts`)
- Added `disclosureComplete: boolean` to `OnboardingData` interface
- Third parallel fetch: `/api/artifacts?type=disclosure_plan&limit=1`
- Admin god-mode sets `disclosureComplete: true`
- Listens for `resume-saved` AND `disclosure-saved` events

**Nav gate changes** (`layout.tsx`)
- Added `requiresDisclosure?: boolean` to `NavItem` interface
- `isNavUnlocked()` now takes `disclosureComplete: boolean` as 4th param
- Fair-Chance Lanes: `minState` changed from `full_access` → `needs_profile` (always open)
- Interview Prep: `requiresDisclosure: true` added (unlocks only after disclosure plan exists)
- Lock tooltips are now human-readable: "Complete your Disclosure Planner to unlock" vs the old "Complete the Forge to unlock"

**Unlock toast notification**
- `useRef<string>` tracks previous onboarding state and previous disclosureComplete
- When state transitions to `full_access` (from non-loading): "Tools unlocked -- Disclosure Planner and more are ready."
- When `disclosureComplete` flips to true (at full_access): "Interview Prep is now unlocked."
- Sage pill, bottom-center, 5-second auto-dismiss
- Suppressed on page-load state initialization (only fires on actual transitions within a session)

### Round 4 -- Job descriptions + tailoring transparency

**Job board full descriptions** (`api/job-search/route.ts`, `dashboard/jobs/page.tsx`)
- Added `full_description: string` to `EnrichedJob` interface
- JSearch mapping: `truncateDescription(j.job_description, 2000)` (HTML-stripped)
- CareerOneStop path: `full_description: ""`
- Expanded card: now shows `full_description` (or falls back to `description`) formatted as paragraphs (splits on double newlines)
- Collapsed preview: unchanged (still shows AI-simplified 1-2 sentence version)

**Full description fed to resume generator**
- `ResumeWorkspace` now passes `(job as any).full_description || job.description` to the API
- Resume AI gets up to 2000 chars of real job description instead of 200-char truncated summary
- This improves tailoring quality meaningfully

**"What we tailored for this job" panel** (`ResumeWorkspace.tsx`)
- `tailoringNotes` state added (string[])
- Resume generation API prompt now requests `tailoring_notes` field in the JSON response (max 4 items, plain language, referencing the user's specific strengths)
- API parses and returns `tailoringNotes` alongside resume/coverLetter
- Panel renders above Career Package tabs when notes exist
- Sage-green styling, connects to disclosure/interview prep use

### Round 5 -- Disclosure coaching skill file

`apps/consumer/lib/skills/disclosure-coaching.md` -- CREATED (see below for full summary)

---

## Current Platform State

### Architecture
- **Repo**: `~/repos/smr-crucible` (monorepo: `apps/consumer` + `packages/core` + `packages/consumer-ui`)
- **Deploy**: `git push origin main` → auto-deploys to Vercel `the-crucible`
- **Forge domain**: `forge.steelmanresumes.com`
- **Refinery domain**: `refinery.steelmanresumes.com`
- **Same Next.js app**, same Neon DB, same Vercel deployment
- **Database**: Neon PostgreSQL (separate from old SMR universe -- brand new as of 2026-06-07)
- **Admin account**: `troyrichardcarr@gmail.com` -- god mode, bypasses all gates, disclosureComplete=true
- **Dev test account**: `d3vt3st3rt.roy@gmail.com` / `D3vt3st3rt.r0y1!2@3#`

### Known Issue -- Dev Account Unlock
Troy confirmed he still wasn't seeing tools unlock after building a resume. The root cause fix (createdFrom:"job" in the API) is now deployed. BUT: there is a separate issue.

**The profile completeness gate** requires `name + phone` in the Refinery DB. The Forge writes its `forge_session` data to `forge.steelmanresumes.com` localStorage. The Refinery is at `refinery.steelmanresumes.com` -- a different browser origin -- so the localStorage relay in the layout finds nothing and the forge/save sync never fires for profile data.

**Action required**: Troy must go to Settings in the Refinery and save name + phone. Once that's done, the unlock chain is: profile complete → build resume from job board → auto-save fires (5 seconds) → `resume-saved` event → nav refreshes → toast fires.

**Longer-term fix needed**: The Forge completion flow needs to call `/api/forge/save` directly from the Forge side (authenticated, server-side save) so the Refinery doesn't depend on cross-domain localStorage relay. This has NOT been done yet. It requires reading the Forge completion code to find the right injection point.

### Onboarding State Machine
```
needs_profile  (name+phone missing)
     ↓  [Settings save]
needs_resume   (profile done, no job-targeted resume)
     ↓  [Job Board → Build Resume → Auto-save fires]
full_access    (has 1+ job-targeted resume)
     ↓  [Complete Disclosure Planner]
full_access + disclosureComplete=true  (Interview Prep unlocks)
```

### Nav Unlock Gates (current)
| Tool | Unlocks at | Notes |
|------|-----------|-------|
| Overview | needs_profile | Always visible |
| Resume Builder | needs_resume | Visible before full access |
| Job Board | needs_resume | Visible before full access |
| Fair-Chance Lanes | needs_profile | Always open (fixed this session) |
| My Materials | needs_resume | Available early |
| Disclosure Planner | full_access | Unlocks after job-targeted resume built |
| Verified Employers | full_access | Unlocks after job-targeted resume built |
| Applications | full_access | Unlocks after job-targeted resume built |
| Interview Prep | full_access + disclosureComplete | Only after Disclosure Planner completed |
| Progress | full_access | |

---

## The Intelligence Architecture -- Troy's Vision

### What Troy wants (exact quote context)
"I want this to be an intelligent platform. Every time somebody does something in any part of this platform, the platform in general is aware of it and it adjusts every other part of that person's experience on the front end and back end to acknowledge the work that they've done. It's going to keep track of that person's historical state and current state and their goals for the future... The AI, the Ask Troy, should be heavily involved. If the user decides to use it, it should have full knowledge of that entire information set and be able to truly help the user like no chatbot ever."

### Current state of t.ROY on the platform
`AssistantChat` receives: `currentPage`, `forgeComplete: boolean`, optional `readinessStage`

That's it. t.ROY is currently blind to:
- What resumes the user has built and for what jobs
- Whether they've applied anywhere
- Their disclosure plan content
- Their interview prep notes
- Their goals and progress
- Their Forge narrative, strengths, and skills
- How long they've been on the platform

### What "god-like" actually requires
1. **Full context assembly** -- a `/api/user/context` endpoint that aggregates EVERYTHING into one object
2. **Deep skill files** -- domain expertise in the system prompt, not just facts (disclosure-coaching.md is the first; 19 more planned)
3. **Proactive reasoning** -- t.ROY noticing what the user hasn't done and surfacing it ("You've visited the job board 3 times without building a resume. Want to talk about what's in the way?")
4. **Cross-tool synthesis** -- disclosure plan reads the resume; interview prep reads the disclosure script; t.ROY can synthesize across all three
5. **Longitudinal memory** -- tracking the user's journey over sessions, not just current page load

### Planned build: `/api/user/context`
Returns a single JSON object containing:
```ts
{
  profile: { name, phone, city, state, goals },
  forge: { headline, summary, strengths[], skills[], careerPaths[], criminalRecord },
  resumes: [{ id, targetJob, targetCompany, createdAt, summary }],  // last 5
  disclosurePlan: { hasOne: bool, targetJob, script, timingAdvice, completedAt },
  interviewPrep: { sessions[], lastCompletedAt },
  applications: [{ company, role, status, appliedAt }],  // last 10
  journeyState: { onboardingState, disclosureComplete, toolsUsed[] },
}
```

This gets injected as a richly-formatted system prompt prefix on every AssistantChat API call, replacing the current sparse context.

### The skills library plan (all 20 files)

**Tier 1 -- Core coaching (run on every page)**
1. `disclosure-coaching.md` -- DONE (this session)
2. `career-narrative.md` -- story arc, Steel Man, anti-fragility as credential
3. `resume-strategy.md` -- ATS, keyword mirroring, bullet quantification, action verbs
4. `interview-preparation.md` -- STAR method, scoring rubrics, behavioral vs technical, follow-up
5. `job-search-strategy.md` -- fair-chance employers, hidden job market, application volume math

**Tier 2 -- Reentry-specific**
6. `reentry-employment.md` -- industry-by-industry landscape, offense type vs. industry fit
7. `legal-rights.md` -- ban-the-box by state, EEOC guidance, illegal questions, record checks
8. `record-clearing.md` -- WI-specific expungement deep knowledge, sealing, pardons, COI
9. `barrier-navigation.md` -- licensing restrictions, Federal Bonding Program, WOTC tax credit

**Tier 3 -- Platform-specific**
10. `forge-interpretation.md` -- how to translate Forge output into coaching language
11. `user-journey-coaching.md` -- psychological stages of job seekers, push vs hold, hesitation vs resistance
12. `progress-recognition.md` -- dignified milestone celebration, not patronizing

**Tier 4 -- Extended support**
13. `confidence-and-mindset.md` -- imposter syndrome, reframing shame, belief work
14. `professional-communication.md` -- workplace email, follow-up protocols, tone calibration
15. `industry-pathways.md` -- CDL, OSHA, AWS, CompTIA, apprenticeships, real timelines
16. `benefits-navigation.md` -- SNAP cliff, Medicaid transitions, childcare during job search
17. `negotiation.md` -- salary negotiation as a fair-chance candidate, reference letters

**Tier 5 -- Coaching methodology**
18. `motivational-interviewing.md` -- MI framework adapted for career coaching
19. `trauma-informed-coaching.md` -- how incarceration shapes self-concept; meeting users where they are
20. `setback-response.md` -- coaching after rejection, ghosting, failed background checks

**Priority order for next session (Troy confirmed):**
1. `career-narrative.md` (philosophical foundation)
2. `reentry-employment.md` (landscape knowledge)
3. `legal-rights.md` (factual scaffolding for disclosure advice)
4. Then the rest

### Context loading architecture (not yet built)

Skills should be loaded selectively by `context-library.ts` based on:
- `currentPage` → which skills are relevant
- `userContext.criminalRecord` → reentry-specific skills activate
- `userContext.journeyState` → what stage they're in determines coaching intensity
- `onboarding.state` → needs_resume vs full_access changes what advice is relevant

The pattern: each skill file has a frontmatter header indicating which pages/states it activates on. `context-library.ts` assembles the active skills into the system prompt.

---

## Troy's Core Coaching Beliefs (Encoded in disclosure-coaching.md, must carry to ALL skills)

These are non-negotiable doctrine for every skill file:

1. **The resume gets you in the room. The interview gets you the job.** Every skill file should orient toward the live conversation, not the paper. Never stop at generating content.

2. **Consistency across every touchpoint is the actual job.** Resume → cover letter → application → phone screen → interview → thank-you → references. One small drift and a trained interviewer's alarm goes off. Check consistency before coaching the specific touchpoint.

3. **The Steel Man principle.** Anti-fragility (Taleb) as credential. The work is not finding strength -- it is getting users to see and articulate what is already there. Their past adversity is a workplace differentiator that most candidates cannot replicate.

4. **Ownership over perfection.** A perfect script given to someone who doesn't own it fails in the room every time. The AI should ask questions before giving answers, surface the user's own language, and push toward practice. Never hand over finished content without checking: "Does this sound like you? Say it out loud right now."

---

## Files Changed This Session

```
apps/consumer/app/(dashboard)/layout.tsx               -- floating buttons, progress banner, unlock toast, nav gates
apps/consumer/app/(dashboard)/dashboard/disclosure/page.tsx  -- adjust panel, PDF download, voice input, confetti, disclosure-saved event
apps/consumer/app/(dashboard)/dashboard/jobs/page.tsx  -- full_description type + expanded card
apps/consumer/app/api/disclosure-guide/route.ts        -- refinementNote param
apps/consumer/app/api/job-search/route.ts              -- full_description field
apps/consumer/app/api/resume-generate-full/route.ts    -- createdFrom:"job" fix, tailoring_notes, full context
apps/consumer/components/JourneyProgressBanner.tsx      -- NEW
apps/consumer/components/resume/ResumeWorkspace.tsx    -- tailoringNotes panel, full_description pass, resume-saved event, createdFrom fix
apps/consumer/components/resume/resumeModel.ts         -- "job" added to createdFrom union type
apps/consumer/lib/useOnboarding.ts                     -- disclosureComplete, event listeners, 3-fetch parallel
apps/consumer/lib/skills/disclosure-coaching.md        -- NEW (first skill file)
```

---

## Next Session Priorities (in order)

### P0 -- Must test
1. Verify dev test account unlocks after going to Settings + saving name/phone + building a resume
2. Verify unlock toast fires
3. Verify "What we tailored" panel appears after resume generation
4. Verify full job descriptions showing in expanded cards

### P1 -- Intelligence layer
5. Build `/api/user/context` endpoint
6. Update `AssistantChat` to fetch and use full context on every conversation start
7. Write `career-narrative.md` skill file (Troy's Steel Man doctrine in depth)
8. Write `reentry-employment.md` skill file (industry landscape)
9. Write `legal-rights.md` skill file (legal scaffolding)
10. Wire skill files into `context-library.ts` with page-based activation

### P2 -- Forge/Refinery data sync fix
11. Find the Forge completion flow (likely in `app/forge/` routes)
12. Add authenticated `/api/forge/save` call at Forge completion
13. This eliminates the cross-domain localStorage problem permanently
14. Profile completeness will then be automatic after Forge completion

### P3 -- Remaining skill files (continue)
15. Continue through the 20-skill library in Troy-priority order

---

## Reference: Commit Log This Session

```
992af08  refinery: disclosure planner UX overhaul + journey progress banner
a5d5d19  refinery: fix unlock gates + add progressive tool reveal
a15e856  refinery: job descriptions + resume tailoring transparency + unlock root fix
```

---

## Notes for Next Instance

- Troy's admin account (troyrichardcarr@gmail.com) bypasses ALL gates. Use this for testing the full tool suite.
- Dev test account (d3vt3st3rt.roy) needs Settings profile save before unlock works.
- The skills library lives at `apps/consumer/lib/skills/` -- add new files there.
- The context-library.ts at `apps/consumer/lib/context-library.ts` is where skills get loaded -- next instance should extend it.
- Troy wants the platform to be "nearly god-like" in intelligence. The skill files are the foundation. Write them at the level of a best-in-class domain expert, not a Wikipedia summary. Troy's personal coaching frameworks go in first, then layer research and best practices.
- Troy's principle: "Just giving somebody a perfect anything is never enough. That person has to own it." Every skill file should encode coaching methodology (Socratic, ownership-building) not just content delivery.
- Never use em dashes. Double hyphens (--) only.
- Never use emojis in professional content.
- "Justice-impacted" -- never "second-chance," "ex-con," "felon," "offender."
