# Research Repository -- Steel Man Resumes Platform

**What this folder is**: A living research layer. Every file here is a structured brief that any AI model can contribute to. Files in this folder feed the skills library in `../` and the research context in `../../research-context.ts`.

**Who writes here**: Any AI (Claude, GPT-4, Gemini, Codex, future models) sent on a research mission by Troy Richard Carr. Files are added or updated here, then integrated into skill files and the platform by Claude Code (CC).

**Who reads here**: The platform itself (skill loader in `app/api/assistant/route.ts` can be extended to pull from this folder), CC at session start, any AI working on the skills library.

---

## How to Submit Research

### 1. Use the standard format below (required)

Every research brief must follow this structure. Files without it cannot be auto-integrated.

```markdown
# Research Brief: [Topic]

**Requested**: [YYYY-MM-DD] [context: why this was requested]
**Researched by**: [AI model name / version]
**Target skill file(s)**: [which .md files in skills/ this feeds -- e.g., legal-rights.md, barrier-navigation.md]
**Status**: DRAFT | REVIEWED | INTEGRATED
**Last updated**: [YYYY-MM-DD]

---

## Executive Summary
[2-3 sentences. What this research adds to the platform that wasn't there before.
What gap does it close?]

---

## Key Findings

[Numbered list. Each item: one claim + one citation + why it matters for coaching.
Format for each item:]

1. **[Finding headline]**
   Source: Author(s) (Year). [Title if helpful]. [Publisher/Journal or URL].
   Coaching relevance: [1 sentence -- how does a coach use this with a justice-impacted job seeker?]

---

## Directly Usable Language

[Exact phrasing that can be copied into skill files. Write as if you are the skill file author.
Include: coaching instructions, things to say, things NOT to say, facts to cite.]

---

## What's Still Thin

[Honest gaps. What questions does this research NOT answer that would be valuable?
What would require a follow-up deep dive to close?]

---

## Integration Recommendations

[For CC: specific instructions on where to put this.
Format: "Add to [skill-file.md], section [X], after [Y]. Replace/supplement [existing content]."
Be precise -- CC should be able to follow these instructions without re-reading the research.]
```

### 2. Name your file correctly

`[topic-slug].md` -- lowercase, hyphens, no dates (the content is evergreen and updated in place).

Examples:
- `wisconsin-employment-law.md`
- `ban-the-box-current-state.md`
- `industry-hiring-by-offense.md`
- `interview-science.md`
- `ats-filtering.md`
- `wotc-federal-bonding.md`
- `trauma-and-brain.md`
- `post-traumatic-growth.md`
- `salary-negotiation.md`

### 3. Update status when done

When you complete a research brief, set `Status: DRAFT`. CC reviews and either integrates it (status → INTEGRATED) or flags it for Troy (status → REVIEWED, needs Troy input).

---

## Research Priorities (Current -- Updated 2026-06-08)

Priority is set by Troy and updated here by CC.

### P1 -- Needed before next JFW pilot interaction

| Topic | File to create | Key question to answer |
|-------|---------------|----------------------|
| Wisconsin employment law | `wisconsin-employment-law.md` | What are the exact WI rules: ban-the-box scope, expungement statute 973.015 eligibility, Milwaukee city ordinance details, certificates of relief |
| Ban-the-box current state | `ban-the-box-current-state.md` | Which states/cities have it, what it covers (application vs. offer stage), private vs. public employers, enforcement |
| Industry hiring rates by offense | `industry-hiring-by-offense.md` | For manufacturing, construction, food service, healthcare, transportation, tech -- what offense types are typically disqualifying vs. hireable? What does the data show? |

### P2 -- Needed for next skill file batch

| Topic | File to create | Key question to answer |
|-------|---------------|----------------------|
| WOTC and Federal Bonding | `wotc-federal-bonding.md` | Exact WOTC eligibility and credit amounts for justice-impacted hires; Federal Bonding Program coverage and how employers access it |
| Interview science + disclosure | `interview-science.md` | How interviewers psychologically process criminal record disclosure; bias research; structured vs. unstructured interview outcomes |
| ATS filtering | `ats-filtering.md` | Do applicant tracking systems filter on criminal history keywords? Which systems? What can candidates do about it? |
| Post-traumatic growth | `post-traumatic-growth.md` | Tedeschi & Calhoun's PTG framework, mechanisms, application to reentry job seekers; what distinguishes PTG from resilience |

### P3 -- Future depth

| Topic | File to create | Key question to answer |
|-------|---------------|----------------------|
| WI occupational licensing | `wi-licensing-restrictions.md` | Which WI licenses are affected by which offense types; which have been reformed; pathway options |
| Salary research -- reentry | `salary-negotiation.md` | Starting salary benchmarks for justice-impacted hires by industry/WI; whether negotiating increases hire probability for this population |
| Cognitive distortions in job search | `job-search-psychology.md` | CBT research specific to job search anxiety; distortions most common in reentry population; MI application to career ambivalence |

---

## What's Already Covered

Do NOT re-research these. They are solid in `research-context.ts` and the skill files.

- Affect labeling (Lieberman 2007, Kircanski 2012)
- Narrative identity (McAdams & McLean 2013)
- Desistance theory (Maruna 2001, Giordano et al. 2002)
- Self-efficacy (Bandura 1977, 1997)
- Self-Determination Theory (Deci & Ryan 2000)
- Growth mindset (Dweck 2006)
- Scaffolding (Wood, Bruner & Ross 1976)
- Stages of Change (Prochaska & DiClemente 1983)
- Expressive writing (Pennebaker 1997, 2018)
- Trauma-informed care (SAMHSA 2014)
- Motivational Interviewing (Miller & Rollnick 2012)
- Structural barriers in hiring (Pager 2003, 2007)
- Fair-chance employer outcomes (SHRM 2021)
- Weak ties (Granovetter 1973)
- Employment reality statistics (Urban Institute, DOJ)
- Design for this population (Dillahunt et al., U Michigan / ACM CHI 2025)
- Disclosure timing research (Bushway & Apel 2012)

---

## Integration Protocol (for CC)

When a research brief lands in this folder with Status: DRAFT:

1. Read the Integration Recommendations section
2. Apply updates to the target skill file(s)
3. Update `research-context.ts` if new statistics or citations should be platform-wide
4. Update `ai-comms/PROTOCOL.md` doctrine index if any doctrine changed
5. Set Status → INTEGRATED in the brief
6. Write an ai-comms log entry noting what was integrated

If a brief raises a question only Troy can resolve, set Status → REVIEWED and add a NEEDS-TROY flag to the ai-comms log.
