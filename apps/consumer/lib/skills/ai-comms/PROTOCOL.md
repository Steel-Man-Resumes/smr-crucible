# AI Communications Protocol -- Steel Man Resumes Platform

**What this folder is**: A shared communication layer between every AI model that works on or with this platform. When something important changes, is decided, or is discovered, it gets logged here. The next AI that opens this folder knows what the previous ones knew.

**Who writes here**: Any AI model with write access to this repo (currently: Claude Code / CC). Any AI model reading this platform's skill files should read this folder first.

**Who reads here**: Every AI, every session, before substantive work. This is a 2-minute read that prevents hours of repeated mistakes.

---

## Reading Protocol

At the start of any session involving this platform:

1. Read `PROTOCOL.md` (this file) -- understand the system
2. Read the most recent 3 entries in `log/` (sorted by filename = date order)
3. Check `log/` for any entry flagged `STATUS: OPEN` -- these are unresolved items that may affect your work
4. Proceed with your session, writing a log entry at the end

If your session is short or tactical (a single bug fix, a single file change), a log entry is optional. If your session involves platform architecture, new features, doctrine changes, or anything that changes how t.ROY behaves, a log entry is required.

---

## Log Entry Format

Filename: `YYYY-MM-DD-[model-id]-[topic-slug].md`

Examples:
- `2026-06-08-cc-intelligence-layer.md`
- `2026-06-09-codex-resume-builder.md`
- `2026-07-01-cc-skill-library-expansion.md`

Entry structure:

```markdown
# [Date] -- [Model] -- [Topic]

**Model**: [CC / Codex / Claude / GPT-4 / other]
**Session focus**: [1 sentence]
**Status**: OPEN | CLOSED | FLAGGED

## What Changed
[Bullet list of files created/modified and what they do]

## Doctrine Notes
[Any change to how t.ROY should behave, what it should say, what it should never say.
This section is critical -- doctrine drift across AI sessions kills consistency.]

## Observations
[Things noticed during the session that future AI instances should know.
Include: unexpected behavior, user patterns, architectural friction, anything surprising.]

## Open Items
[Unresolved things. Flag anything that needs Troy's input as NEEDS-TROY.]
[Flag anything that needs a future AI session as NEEDS-AI.]

## Handoff Notes
[What the next AI should know before starting work on this platform.
Write this like you're briefing a smart colleague who just walked in cold.]
```

---

## Doctrine Index

This section is maintained by the AI writing each log entry. When doctrine changes, update this index so any AI can see the current state of what t.ROY believes.

| Doctrine | Current State | Last Updated | Source |
|----------|--------------|-------------|--------|
| Anti-fragility framing | Past adversity = workplace credential; not "second chance," not "despite blemishes" -- BECAUSE of them | 2026-06-08 | Troy direct + career-narrative.md |
| Ownership over perfection | Never hand a finished script to a user without checking: "Does this sound like you? Say it out loud right now." | 2026-06-08 | Troy direct + disclosure-coaching.md |
| Consistency doctrine | Every touchpoint (resume/cover/phone/interview/thank you/references) must carry the same person | 2026-06-08 | Troy direct + career-narrative.md |
| Interview > Resume | The resume gets you in the room. The interview gets you the job. Disclosure is an interview problem, not a paper problem. | 2026-06-08 | Troy direct + disclosure-coaching.md |
| Language rule | "Justice-impacted" always. Never "ex-con," "felon," "offender," "second-chance" | 2026-06-08 | CLAUDE.md (operator standing rule) |
| Em dashes | Never. Use double hyphens (--) | 2026-06-08 | CLAUDE.md (operator standing rule) |
| Practice standard | 5 repetitions minimum before any live use. Authenticity test: it sounds like talking, not reciting. | 2026-06-08 | disclosure-coaching.md + career-narrative.md |
| Skill file reading | Load relevant skill files into system prompt context server-side. Routing: disclosure-coaching.md on disclosure/interview/dashboard pages for criminal-record users | 2026-06-08 | assistant/route.ts |

---

## Platform Architecture -- Quick Reference for Incoming AI

```
smr-crucible/
  apps/consumer/          -- Next.js 15 App Router (Forge + Refinery, same deploy)
  packages/core/          -- Shared DB layer (Neon PostgreSQL), getUserProfile(), etc.
  packages/consumer-ui/   -- Shared UI components (AssistantDrawer, etc.)
```

Key facts:
- **Deploy**: `git push origin main` -- git-connected to Vercel `the-crucible`
- **Same app, two domains**: forge.steelmanresumes.com (unauthenticated) + refinery.steelmanresumes.com (authenticated dashboard)
- **Same Neon DB** -- not separate databases despite different subdomains
- **localStorage cross-domain issue**: Forge writes to forge.* localStorage; Refinery can't read it (different browser origin). Profile data must go through `/api/forge/save` server-side at Forge completion -- THIS FIX IS NOT YET DONE (as of 2026-06-08)
- **Admin account**: troyrichardcarr@gmail.com -- bypasses all onboarding gates (tier=admin, god mode)
- **Dev test account**: d3vt3st3rt.roy@gmail.com / D3vt3st3rt.r0y1!2@3#
- **MOCK_AI**: must be OFF in production (check apps/consumer/.env.local)
- **Skill files**: `apps/consumer/lib/skills/` -- loaded server-side in `app/api/assistant/route.ts` via `loadSkillsForContext()`

Intelligence layer (as of 2026-06-08):
- `/api/user/context` endpoint returns the user's full journey snapshot
- `useUserContext()` hook fetches it client-side from the dashboard layout
- `buildFullUserSection()` in `assistant-prompt.ts` formats it into the system prompt
- t.ROY now sees: name, location, Forge strengths/narrative/skills/career paths, all resumes with targets, disclosure plan, application pipeline, journey gaps

---

## What t.ROY Must Never Do

This list is maintained across all AI sessions. Any model adding to it must note the date and reason.

| Never | Reason | Date Added |
|-------|--------|-----------|
| Repeat specific record details back to a user | Privacy + re-traumatization | pre-2026-06-08 |
| Say "second chance," "ex-con," "felon," "offender" | Operator language rule | pre-2026-06-08 |
| Invent strengths not anchored in user-provided data | Honesty doctrine | pre-2026-06-08 |
| Promise a hiring outcome | Legal + ethical | pre-2026-06-08 |
| Hand over a finished script without an ownership check | Troy's core belief (Ownership > Perfection) | 2026-06-08 |
| Use vague reassurance ("everything will work out") | Patronizing + dishonest | 2026-06-08 |
| Skip the practice prompt when a user is about to interview | Practice doctrine -- the script without practice fails | 2026-06-08 |
| Use em dashes | Operator style rule | pre-2026-06-08 |
| Use emojis in professional content | Operator style rule | pre-2026-06-08 |
| Present an expired or unauthorized employer incentive as current (e.g., WOTC for 2026 hires -- expired after 2025-12-31; use Federal Bonding instead) | Factual accuracy in the high-harm legal zone | 2026-06-08 |
| State a legal point without its jurisdiction + date, or give a categorical legal promise | Law varies by place and changes constantly; the user must verify locally | 2026-06-08 |

---

## Reading This as an Incoming AI

If you are an AI model reading this file cold, here is the summary of what this platform is and what it needs from you:

Steel Man Resumes is a career development platform for justice-impacted people -- people with criminal records, employment gaps, and systemic barriers. It was built by Troy Richard Carr, who was incarcerated, who built these systems from personal knowledge and research, not from theory.

The platform has two parts: The Forge (unauthenticated, builds the user's career narrative and intelligence report) and The Refinery (authenticated dashboard with resume builder, disclosure planner, interview practice, job board, applications tracker). t.ROY is the AI coach that lives across all of it.

The philosophy is anti-fragility: the past does not define, it prepared. The person's history is not a liability to manage -- it is a credential that most candidates cannot replicate. The coaching work is helping them see it and say it.

The operator (Troy) is direct. He wants quality over speed. He wants the platform to feel like a best-in-class practitioner, not a chatbot. The skill files are the domain expertise that makes that possible. Read them before you coach.

The most important rule: Ownership over Perfection. Never hand someone a finished product and declare it done. The thing has to be theirs.
