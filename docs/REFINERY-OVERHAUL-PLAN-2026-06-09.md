# Refinery Dashboard -- Overhaul Analysis & Plan

**Date**: 2026-06-09
**Source**: Troy's full walkthrough of the live Refinery dashboard
**Status**: AWAITING TROY'S APPROVAL -- do not build until approved

---

## 1. Feedback captured (by tab)

**Disclosure Planner**
- Personalization is happening but not clearly visible.
- The "personalized plan" vs "generic plan" choice does not sell why the deeper path matters. Our job to make it crystal clear.
- Forge-brought data (strengths/skills, charge type, recency) is greyed out / not editable. Users must be able to edit, add to, and go much deeper -- to talk about real things in a real interview.
- After the user answers the initial questions, the tool should ask more specific follow-ups based on those answers (progressive intake).
- "Build Disclosure Plan" UX is confusing: clicked it a few times, ~30s processing, then jumped back to the top of the screen. Unclear what happened. The plan did land in Materials (only one, no dupes -- good), but the flow must be clear.
- The plan was good, but: a Copy button (unnecessary) and a Download .txt (should be PDF). Information management must be better.
- Needs a talk/practice feature so the user can rehearse out loud.

**Interview Prep**
- Worked, and felt cool. But it did not seem to ask questions off the EXACT resume + the specific job being applied to. That is the goal.
- At the end it should produce a transcript-style recap + results (what to work on, what was missed) -- a PDF deliverable.

**Fair-Chance Lanes**
- Each career card has 4 buttons. "Practice interview" and "Plan disclosure" do not belong on a generic career card. "Build resume" is good (keep it, save to Materials). "Search live jobs" should pre-populate the job search for that kind of job.
- If Verified Employers match a lane category, link to them from the card. The site should be more connected, with relevant cross-links.

**Verified Employers**
- Good. Cards + an Apply button. Apply should lead to a real application, and if it does, pre-populate with the user's info as much as possible (we already have it).

**Applications**
- Clear and functional. Jobs of interest + build-targeted-resume + move-to-applied. No changes needed.

**Job Board**
- The initial criteria selectors are too basic. Need finer tuning.
- Auto-populate the search from the user's resume work history (especially most recent), and advise them better. Many users do not know what they are looking for -- help them every step.

**Progress**
- Cool, but it is not reflecting tonight's work live. It must update live.
- Important to manage this for them: a job search is hard (many jobs, resumes, employers, interview times). Add a calendar; set us up to manage this data well.

**Resume Builder**
- Make it a standalone feature of the app + website. Award-winning in efficiency and in pulling the most meaningful information out of any user regardless of experience. Our responsibility to extract what we need -- we are the experts.

---

## 2. Root-cause analysis (the ~25 items trace to 8 patterns)

**A. Forge context is read from localStorage, not the server.** disclosure, interview, and jobs all read `localStorage["forge_session"]`. On the `refinery.*` origin that store is often empty (the Forge wrote it on `forge.*`), and for users whose Forge was persisted server-side at signup (the new onboarding fix) it is not in localStorage at all. So personalization is inconsistent and often invisible -- the root of "it is not clear it is personalized." Fix once, centrally: every tool reads the user's full context from `/api/user/context`.

**B. Forge-derived fields are display-only.** Strengths/skills, charge type, recency are shown but locked. Root of "greyed out, cannot change, want more depth."

**C. Intake is static.** No follow-ups based on the user's answers. Root of "ask more specific questions after the initial ones." This is the core "intelligent" gap.

**D. Deliverables are weak.** Copy buttons nobody needs; `.txt` downloads instead of PDF; no interview analysis artifact. Root of the materials/management complaints.

**E. Sections are not connected.** Generic buttons that do not belong; no link from lanes to matching employers; job board not seeded from the resume; employer apply does not carry the user's materials. Root of "the site should be more connected."

**F. State is not live and the search is unguided.** Progress does not refresh; no calendar; job criteria too basic; users do not know what they want. Root of "manage this for them, advise them."

**G. Flow clarity.** "Build Disclosure Plan" jumps to the top with no clear result; the generic-vs-personalized choice does not motivate; unclear what to do with surfaced strengths.

**H. Resume Builder** is its own standalone, best-in-class workstream.

---

## 3. Direct answers to your questions

- **"Does Search-live-jobs on a lane card pre-populate the job search?"** Yes -- it already links to `/dashboard/jobs?q=<that career>`. Keep it and make the prefill smarter.
- **"Build resume on a lane card?"** Today it goes to a GENERIC resume builder, not job-specific. We will make it build for that lane's role and save to Materials.
- **"Practice interview / Disclosure on a lane card?"** Generic links -- agreed, remove them.
- **"Does the Verified Employers Apply button lead to a real application?"** It opens the employer's own external apply URL (when we have one). We cannot auto-fill a third-party site, but we can make it one-click-easy: surface their tailored resume + their details to paste, and (where the employer matches) tie it to the lane.
- **"Why is Progress not live?"** It fetches once on load and reads cached aggregates (the next-step engine caches for 1 hour). Fix: refresh on the same events the rest of the app already fires (`resume-saved`, `disclosure-saved`, etc.) and invalidate the cache on writes.
- **Interview off the exact resume/job?** Today it feeds general Forge context (skills/strengths/narrative), not the specific tailored resume + the job description. We will feed the real resume + target job.

---

## 4. Decisions needed from you

1. **Interview "transcript" vs your privacy doctrine.** You asked for a transcript PDF. Your own practice-data rule (2026-06-07) is: store the frame and whether meaning landed, NEVER the user's words/transcript/audio. A verbatim transcript PDF conflicts with that. Options:
   - (a) **Analysis-only PDF** -- strengths, what to work on, the frame, sample better answers. Doctrine-safe. (Recommended.)
   - (b) **User-held transcript** -- the user can download their own session transcript, but we never store it server-side. Needs an explicit stance.
   - I recommend (a), optionally letting the user add their own notes.
2. **The progressive-intake feature.** This is the big "intelligent" build: an AI that asks tailored follow-ups based on the user's answers, reused across disclosure / interview / job board. Confirm we build it as a shared pattern (it is the heart of "award-winning intelligence").
3. **Sequencing.** My recommended order is below; tell me if disclosure should jump ahead of the backbone.

---

## 5. The build plan (phased)

**Phase 1 -- Intelligence backbone (fixes A, B, C; unblocks the rest)**
- A shared client context layer: every Refinery tool reads the user's full server-side context (profile, Forge narrative/strengths/skills, resumes, current target job, prior answers) from `/api/user/context` -- not localStorage. Personalization becomes consistent and visible everywhere.
- Make every Forge-seeded field editable and persistable (and clearly marked "from your Forge -- edit anytime").
- A reusable **progressive intake** component: initial questions -> AI-generated, context-aware follow-ups -> a richer profile. This is the shared intelligence used by disclosure, interview, and job board.

**Phase 2 -- Disclosure Planner overhaul**
- A clear, motivating generic-vs-personalized choice ("Answer 5 questions and I build a plan around your record, your strengths, and the job you want. Skip and get a generic template you will have to rewrite yourself.").
- Editable Forge data + the progressive intake for depth.
- Fix the build flow: clear processing state, land ON the finished plan (not the top), explicit "Saved to your Materials" confirmation with a link.
- Talk/practice mode (voice rehearsal with t.ROY, which already exists as disclosure-rehearsal -- wire it in clearly).
- PDF export; remove the copy button.

**Phase 3 -- Interview Prep**
- Feed the specific tailored resume + the target job description so questions are off the real application.
- End-of-session deliverable per the decision above (analysis PDF: strengths, areas to work on, better-answer models, the frame).

**Phase 4 -- Connectedness**
- Lane cards: keep Search-live-jobs (smarter prefill) + Build-resume-for-this-role (job-specific, saved to Materials); remove generic Practice/Disclosure; add "Verified employers in this lane" linking to matching employers.
- Verified Employers: apply + a "ready to apply" panel (tailored resume + the user's details to paste).
- Job Board: richer filters + auto-seed from the resume's recent work history + active guidance for users who do not know what they want.

**Phase 5 -- Progress + management**
- Live progress (event-driven refresh + cache invalidation).
- A calendar/timeline for applications, interviews, and follow-ups.

**Phase 6 -- Materials/deliverables**
- Unified PDF export across artifacts; drop copy; clear naming and management.

**Phase 7 -- Resume Builder as a standalone, best-in-class feature** (its own larger effort; spec separately).

---

## 6. Recommended sequencing

1, 2, 3 first (backbone -> disclosure -> interview) because they are the deepest critiques and share the same backbone. Then 4 (connectedness, mostly fast wins), 5 (progress + calendar), 6 (deliverables, can fold into 2/3), and 7 (resume builder) as its own project. Each phase ships and is verified before the next.
