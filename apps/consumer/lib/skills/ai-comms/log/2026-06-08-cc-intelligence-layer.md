# 2026-06-08 -- Claude Code (CC) -- Intelligence Layer + Skill Library Foundation

**Model**: Claude Code / claude-sonnet-4-6
**Session focus**: Full intelligence layer for t.ROY + first two skill files + inter-AI communication system
**Status**: CLOSED (session work complete; open items noted below)

---

## What Changed

### New Files
- `app/api/user/context/route.ts` -- Authenticated endpoint assembling the user's full journey snapshot. Calls `getUserProfile()` + two targeted DB queries for full Forge output and recent artifacts. Returns: profile, forge (strengths/skills/paths/narrative), resumes (last 5 with targets), disclosure plan (exists + script excerpt), applications (last 10), journey (onboardingState, disclosureComplete, counts).
- `lib/use-user-context.ts` -- Client hook. Fetches `/api/user/context` on mount. Refreshes on `resume-saved`, `disclosure-saved`, `forge-synced` events (500ms debounce). Returns `{ context: UserFullContext | null, loading: boolean }`.
- `lib/skills/disclosure-coaching.md` -- First skill file. Encodes Troy's 4 core coaching beliefs + 4-part disclosure structure + follow-up Q protocols + anti-patterns + industry matrix + legal scaffolding + coaching language guide + practice protocol.
- `lib/skills/career-narrative.md` -- Second skill file. The philosophical foundation. Anti-fragility doctrine + Steel Man principle + 5-part narrative arc + gap handling + turning point story + language guide. Everything else builds on this.
- `lib/skills/ai-comms/PROTOCOL.md` -- This communication system (reading protocol, log format, doctrine index, platform quick reference, t.ROY never-do list).
- `lib/skills/ai-comms/log/` -- This folder (log entries from all AI sessions).

### Modified Files
- `lib/assistant-prompt.ts` -- Added `userFullContext?: UserFullContext | null` to `AssistantContext`. Added `buildFullUserSection()` which formats the full user context into a dense, structured system prompt section: name/location, forge narrative, strengths, skills, career paths, what they've built, disclosure plan state, applications, coaching gaps. Replaced sparse "PSYCHIC AWARENESS" bullet list with live user data.
- `app/(dashboard)/layout.tsx` -- Added `useUserContext()` hook. AssistantChat now receives `readinessStage`, `skills`, `barriers`, `hasCriminalRecord`, and `userFullContext` from the live context fetch (was previously just `currentPage` + `forgeComplete` boolean).
- `app/api/assistant/route.ts` -- Added `loadSkillsForContext(page, hasCriminalRecord)`. Loads relevant skill `.md` files from `lib/skills/` server-side and injects them after the base system prompt. Current routing: `disclosure-coaching.md` loads on disclosure, interview, and dashboard pages for criminal-record users.

### Previous Session (also CC, 2026-06-07/08)
- Disclosure planner UX overhaul (adjust panel, PDF download, voice input, confetti)
- JourneyProgressBanner component
- Unlock gates fix (createdFrom:"job" bug -- was in two places: workspace + API)
- Job descriptions (full_description field, 2000 chars)
- Resume tailoring transparency (tailoringNotes panel)
- Three commits: 992af08, a5d5d19, a15e856

---

## Doctrine Notes

Troy gave these beliefs verbatim in this session. They are now encoded in skill files and should never be softened or overridden:

1. **The interview is the job.** The resume is a gate. Disclosure is an interview problem, not a paper problem. Coaching that stops at generating content has failed.

2. **Consistency is the actual threat vector.** Not the record. A small drift between resume/cover/phone/interview is what eliminates candidates. Check consistency before coaching the specific touchpoint.

3. **Anti-fragility as credential.** Troy's exact framing: "anti-fragility means past adversity strengthened you and made you a soldier and better equipped to handle stressful situations in the workplace." The coaching problem is getting users to believe and articulate it.

4. **Ownership over perfection.** Troy's exact framing: "If I give them a perfect resume and a perfect job description, they'll still go and fuck up the interview. I have to help them build it themselves so that they own it and they care about it. Then they'll go in and work as hard as they can on that interview and that authenticity will show through. They'll get the job from their true authenticity despite their blemishes."

These four beliefs are not suggestions. They are the architecture. Any skill file that contradicts them is wrong.

---

## Observations

**On t.ROY's previous state**: Before this session, t.ROY received `currentPage` (a string) and `forgeComplete` (a boolean). That is not intelligence. That is a status flag. The gap between what t.ROY was receiving and what it needed to coach effectively was significant. The intelligence layer addresses this structurally.

**On the skill files**: The platform had research-grounded content in `context-library.ts` but nothing encoding Troy's specific coaching philosophy. There is a difference between "here is what research says about disclosure" and "here is the specific coaching doctrine Troy uses." The skill files are the second thing. Both matter; the second is what makes t.ROY feel like Troy's voice rather than a generic coaching chatbot.

**On the localStorage cross-domain issue**: The Forge writes to `forge.steelmanresumes.com` localStorage. The Refinery is at `refinery.steelmanresumes.com`. These are different browser origins -- the Refinery layout's cross-domain localStorage relay finds nothing. This means: a user who completes the Forge cannot have their profile auto-loaded into the Refinery without going to Settings and manually saving name + phone. **This is a known unfixed bug as of 2026-06-08.** It breaks the onboarding experience for new users. The fix requires the Forge completion flow to call `/api/forge/save` server-side before redirecting.

**On the skills library scope**: Troy's vision is 20 skill files minimum. He wants quality over speed. He explicitly said: "I want for this to be the most robust skills library that could possibly be developed for this career development platform." Two files exist. Eighteen remain. Incoming AI: do not rush these. Each file should encode domain expertise at the level of a best-in-class practitioner.

**On inter-AI communication**: Troy requested this system because different AI models work on this platform at different times (CC, Codex, future). Without a shared communication layer, each session starts blind. This folder is the fix. It must be read before substantive platform work and written to after.

---

## Open Items

**NEEDS-AI (P1 -- Intelligence):**
- Skills library completion (18 files remaining). Priority order per Troy: `career-narrative.md` (DONE this session), then `reentry-employment.md`, `legal-rights.md`, `resume-strategy.md`, `interview-preparation.md`. See the full 20-skill taxonomy in the session handoff doc.
- Wire skill file loading to additional pages: `career-narrative.md` should load on dashboard/overview for all users; `reentry-employment.md` on jobs/fair-chance-lanes for criminal-record users.

**NEEDS-AI (P2 -- Platform):**
- Forge → Refinery localStorage sync fix: find the Forge completion flow (likely in `app/forge/` or the final Forge step component), add a call to `/api/forge/save` at completion so profile data reaches the DB without depending on cross-domain localStorage. This is the root cause of the dev test account needing a manual Settings save to unlock.

**NEEDS-AI (P3 -- Platform):**
- SMR A2P Twilio brand registration (separate from TMG which was approved 2026-06-08). Use SMR LLC EIN from `~/todash/smr/legal/`. Use case: magic-link auth + resume/job notifications for opted-in users.

**NEEDS-TROY:**
- Testing the intelligence layer: open t.ROY on the Refinery dashboard and confirm it references his actual journey state (name, resumes built, what's missing). Admin account bypasses gates; dev test account needs Settings save first.
- Skills library review: Troy should read `career-narrative.md` before the next session and flag anything that doesn't match his doctrine. These files are only as good as their accuracy to his frameworks.

---

## Handoff Notes for Incoming AI

If you are reading this to start a new session on this platform, here is what you need to know:

**What was built this session**: The intelligence layer. t.ROY now assembles a full user context snapshot on every conversation. It knows the user's name, location, Forge narrative, strengths, skills, career paths, what resumes they've built and for what jobs, their disclosure plan state, their application pipeline, and specifically what they haven't done yet. Before this session, t.ROY was essentially blind to all of this.

**What the operator wants next**: Quality skill files, one at a time. He does not want speed. He wants the skills library to be the best possible coaching resource for this population. Read `career-narrative.md` and `disclosure-coaching.md` before writing anything new.

**What Troy cares about most**: The intelligence of the platform. His exact words: "I want this to be nearly god-like in intelligence." The skill files + the context endpoint are the foundation. The next step is finishing the library so that every coaching interaction is backed by real domain expertise.

**Known bugs to not break**: The `createdFrom: "job"` fix is critical for the unlock chain. Do not change it. The Forge→Refinery localStorage cross-domain issue is known and unfixed -- do not attempt to work around it by reading forge.* localStorage from the Refinery side; the fix must be server-side.

**Code that cannot be touched without understanding it first**: `lib/useOnboarding.ts` (three-fetch parallel, event-driven, disclosureComplete state), `app/(dashboard)/layout.tsx` (nav gates, unlock toast, context wiring), `app/api/assistant/route.ts` (skill loading, rate limiting, roleplay override).

**Troy's standing rules** (from CLAUDE.md and operator instructions):
- Atomic commits per feature, never accumulate
- Never use em dashes -- double hyphens (--)
- Never use emojis in professional content
- "Justice-impacted" always -- never "second-chance," "ex-con," etc.
- Deploy = `git push origin main` (git-connected to Vercel)
- Read ~/todash/COMMAND-CENTER.md for full ecosystem context if needed
