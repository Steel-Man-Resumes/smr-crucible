# Phase 7 -- Resume Builder (Forge) + Application Tailor (Refinery): Spec

**Date**: 2026-06-09
**Author**: CC (Opus 4.8), planning session with Troy
**Status**: SPEC. Decisions below are locked. The build is a LATER session, run increment-by-increment with the same loop as the overhaul (build-verify -> commit -> deploy -> Playwright-verify on prod).
**Reads first**: `REFINERY-OVERHAUL-PLAN-2026-06-09.md` (this is the "spec separately" that section 5/H called for) and `HANDOFF-2026-06-09-PHASES-2-6-CLOSE.md`.

---

## 0. Decisions locked this session (Troy, 2026-06-09)

1. **The industry-best resume builder lives in the Forge and BECOMES the Forge's resume spine.** It is how every user creates and enriches their resume on the way in -- not a buried tool, not just the "no resume" fallback. Standalone-capable route so the public website (steelmanresumes.com) can link straight into it.
2. **The Refinery tool currently mislabeled "Resume Builder" is renamed "Application Tailor."** It is not a builder. It takes a finished base resume plus a live posting and produces the tailored application package: tailored resume + cover letter + disclosure brief.
3. **Extraction is adaptive for everyone.** Every user is assessed and interviewed, but depth scales to need -- light for those with rich material, deep for those who need the most help, including people who do not know they need it. We lean on the intelligence layer already built and extract as much as we need to.

---

## 1. The reframe

Two distinct jobs were jammed under one word. Split them:

- **Forge = build your BASE resume.** Extract the gold from a person's lived experience into one strong, structured, reusable resume. This is the entrance job and the "industry best" target.
- **Refinery (Application Tailor) = aim a base resume at a specific job.** Tailor + cover letter + disclosure for one posting.

Today this is backwards: the polished structured builder sits in the Refinery (misnamed, bolted to a target job) while the Forge entrance only has a plain-text intake. Phase 7 fixes the placement and the naming. Clean split going forward: **Forge builds the base, Application Tailor aims it.**

---

## 2. Current-state facts (verified 2026-06-09 -- do not re-derive)

| | Route / file | What it really is |
|---|---|---|
| Forge "Resume **Intake**" | `app/(forge)/resume/page.tsx` (1,199 ln) | 5 ingest paths: upload, paste, LinkedIn/Indeed import, external-tool links, and a bare `GuidedBuilder` Q&A that assembles **plain text**. Output = raw `session.resumeText` for the AI analysis. Pre-auth, in the linear flow. |
| Refinery "Resume Builder" | `app/(dashboard)/dashboard/resume-builder/page.tsx` (15 ln, `TierGate` client) -> `components/resume/ResumeWorkspace.tsx` (1,171 ln) | The real structured builder: `ResumeDocument` model, live preview, section scoring, auto-save, DOCX/PDF export -- bolted to a target job + the "Career Package" generator. Post-auth. **This becomes Application Tailor.** |

**Shared resume components already exist** in `components/resume/`: `resumeModel.ts` (`ResumeDocument`, `createEmptyResume`, `scoreResume`, `formatResumeDownload`, `migrateLegacyResume`), `resumeParsers.ts` (`parseForgeToResume`, `parseRushToResume`), `ResumePreview.tsx`, `SectionWrapper.tsx`, `sections.tsx` (Contact/Summary/Experience/Education/Skills section editors). These are the seed of the shared core in section 4.

**Known gap to fix in this phase**: the vault's `toText` resume case is empty (per the Phases 2-6 handoff), so base resumes do not render as text in Materials. Fix when base resumes start being produced.

**Hand-off links that assume the current route** (all must be updated on the rename, section 6): lane cards pass `?role=`; job board hands off via `?from=job` (+ sessionStorage `resume_target_job`); next-step cards use `?job=<applicationId>`; loads use `?id=`; rush uses `?from=rush`; `save()` does `router.replace("/dashboard/resume-builder?id=...")`; nav label in `app/(dashboard)/layout.tsx`; H1 strings "Resume Builder" inside `ResumeWorkspace`.

---

## 3. The two bars, made concrete

### Efficiency (award-winning)
- **Parse-first, never re-type.** If they have anything (file, paste, LinkedIn/Indeed, prior Forge), read it via `/api/parse` and pre-fill. Re-entry is a failure.
- **Adaptive question count.** The assessment (section 5) decides whether a strong resume needs 1 confirmation or a thin one needs a full interview. Zero wasted questions.
- **Smart defaults from context.** Contact from `/api/user/profile`; skills/strengths from the Forge narrative via `/api/user/context`.
- **One surface, no dead ends.** Live preview + score + autosave throughout; every step has a forward path.

### Extraction (award-winning -- Troy's emphasis)
- **Assess before asking.** The machine reads whatever exists + the user's full context and triages: how much raw material, how strong, where the un-surfaced gold and the gaps are. "Help a user where they don't know they need help."
- **Give the most attention to those who need it most.** Depth is allocated by the triage, not flat for everyone.
- **Mine each section for the gold.** Per job, probe for quantifiable impact, scope, leadership, reliability -- the things people undersell. Reframe work-program / inside experience as real experience.
- **Justice-impacted differentiator.** Anti-fragility as credential, the Steel Man principle, gaps reframed honestly -- drive this with the `career-narrative` skill (section 10).
- **Use the intelligence we built.** Progressive-intake engine + `/api/user/context` + skills library + t.ROY doctrine. This is the payoff for the Phase 1 backbone.

---

## 4. Architecture: ONE shared resume core (DRY)

Do not build a second resume editor. Extract a shared core from `ResumeWorkspace`, then have two thin wrappers consume it:

```
components/resume/  (shared core -- the single source of truth)
  resumeModel.ts        ResumeDocument, scoring, export formatting   [exists]
  ResumePreview.tsx     live preview                                 [exists]
  sections.tsx          section editors                              [exists]
  ResumeEditor.tsx      NEW: the split-pane editor + autosave + export, extracted
                        from ResumeWorkspace's workspace render (lines ~847-1168)

Forge:    components/forge/ResumeBuilder.tsx  = <ResumeEditor> + assess/extract wrapper (section 5)
Refinery: ResumeWorkspace -> ApplicationTailor = <ResumeEditor> + job-target + career-package wrapper (section 6)
```

Both wrappers persist to the same artifact (`refinery_artifact` type `resume`, `content` = `ResumeDocument` v2, `target_context`). A **base** resume from the Forge has `target_context.source = "forge"|"fresh"` and no `targetJob`; a **tailored** resume from the Application Tailor carries `targetJob`/`targetCompany`/`applicationId`. `/api/user/context` already returns `resumes[]`; the base resume becomes the default the Tailor pulls from.

---

## 5. The Forge Resume Builder -- the spine flow

Reconceive the Forge resume step around five stages. (Route decision in section 9; the builder must work pre-auth/logged-out and offer "save -> free account" to persist server-side, exactly as the Forge already operates.)

1. **Ingest** -- keep today's strong intake (upload/paste/import/external). We want their existing material. Parse to structured fields, not just raw text.
2. **Assess** (new, the intelligence) -- read what we have + `/api/user/context`; triage material volume, strength, gaps, and likely un-surfaced gold. Output: an adaptive interview plan (which sections, how deep).
3. **Extract** (the core) -- run the progressive-intake interview at the assessed depth: per-section gold-mining follow-ups, justice-impacted reframing. Powered by `lib/intake-engine.ts` + `<ProgressiveIntake>` + `/api/intake/followups` (MODEL_DEEP).
4. **Build** -- assemble a structured `ResumeDocument` and drop the user into `<ResumeEditor>`: live preview, score, edit anything, export (DOCX/PDF reuse the unified pattern).
5. **Carry forward** -- the structured base resume (a) feeds the rest of the Forge analysis/narrative and (b) is saved as the base that the Application Tailor aims at specific jobs.

Net effect: even a user who uploads a polished resume gets "we read it -- now let us make it great," and a user with nothing gets walked all the way to a strong base. Same spine, depth adapts.

---

## 6. The Application Tailor (Refinery rename + refocus)

- **Rename** everywhere: nav label, page H1s, and the route (recommend `/dashboard/application-tailor` with a redirect from `/dashboard/resume-builder`; update the ~6 hand-off link sites listed in section 2). Keep the redirect so existing artifacts/links survive.
- **Refocus** the setup screen. It currently offers "build a resume for a specific job" with from-scratch/import options. After the split it assumes you already have a base resume: pick base resume + paste/select the posting -> generate the tailored package. The "start from scratch" option becomes "Build your base resume in the Forge first" (link out).
- **Keep its real strengths**: `/api/resume-generate-full` (career package), the "what we tailored for this job" notes, the resume/cover-letter/disclosure tabs, application linking (Stage 3 journey gate). These are good and stay.
- Lane cards' "Build a resume for this role" (`?role=`) now points at the Application Tailor (job-specific is exactly its job).

---

## 7. Dual surface + privacy

- **Dual surface (app + website), DRY.** One builder implementation in the Forge app at a standalone route. The marketing site (`smr-website` repo) **links into it**, it does not re-implement the editor. Rebuilding the complex client editor in a second repo would fork the source of truth -- do not.
- **Privacy doctrine holds.** The stored artifact is the resume document itself (that is the user's resume -- storing it is the point). We do NOT persist a separate raw interview transcript or audio. Consistent with the 2026-06-07 rule and how disclosure/interview already behave: store the structured output/frame, not the words.

---

## 8. Phased build plan (later sessions -- each ships + verifies before the next)

- **7.0 Rename + refocus (lowest risk, ship first).** Refinery "Resume Builder" -> "Application Tailor": labels, route + redirect, update hand-off links, refocus the setup screen to "tailor your base resume." Delivers naming clarity immediately, no new surface.
- **7.1 Shared resume core.** Extract `<ResumeEditor>` (+ confirm model/preview/sections/scoring/export are shared) from `ResumeWorkspace`. Application Tailor consumes it with zero behavior change. Foundation for the Forge builder.
- **7.2 Forge builder spine.** Reconceive the Forge resume step as ingest -> assess -> extract -> build -> carry-forward using `<ResumeEditor>` + `<ProgressiveIntake>`. Standalone route; works pre-auth.
- **7.3 Intelligence depth.** The assess/triage logic ("most attention to those who need it most"), per-section gold-mining follow-ups, justice-impacted reframing via `career-narrative`, context-driven smart defaults.
- **7.4 Dual surface.** Standalone-route polish + public-site link-in + logged-out -> save/account flow + base resume into `/api/user/context` and the Tailor's default.
- **7.5 Deliverable + vault.** Unified PDF (reuse), fix the vault `toText` resume rendering, base-vs-tailored distinction in Materials.

---

## 9. Decisions deferred to the build session (implementation-level)

- **Route names.** Forge builder: upgrade `/resume` in place vs a new `/build`. Tailor: `/dashboard/application-tailor` + redirect (recommended) vs keep path and relabel only.
- **Assessment model + shape.** Likely MODEL_DEEP for the triage; define its output contract (interview plan) and where it runs (new `/api/resume/assess` vs extend intake-engine).
- **How aggressively the Tailor auto-loads the base resume** vs lets the user pick.

---

## 10. Intelligence-layer assets to reuse (do not rebuild)

- **Progressive intake**: `lib/intake-engine.ts` (pure, parser fails SAFE), `POST /api/intake/followups` (MODEL_DEEP, 2-round cap, fails OPEN), `<ProgressiveIntake>` (`@/components/ProgressiveIntake`).
- **Full user context**: `useUserContext()` -> `/api/user/context` (`{profile, forge, resumes[], disclosurePlan, applications[], journey}`; deliberately hides record TYPE).
- **Parsing + generation**: `/api/parse` (file -> fields), `/api/resume-generate` (summary assist), `/api/resume-generate-full` (career package -- stays in Tailor), `/api/forge/download` (DOCX).
- **Models**: `lib/ai/models.ts` -- `MODEL_DEEP` for synthesis/assessment, never hardcode.
- **Skills/doctrine**: `lib/skills/career-narrative/`; loaded via `lib/skills-loader.ts`. THE FOOTGUN: skill `.md` reach prod only via `next.config.mjs` `outputFileTracingIncludes` (per-route); verify `GET /api/health/skills` -> `{ok:true}`.
- **Unified PDF pattern**: build HTML + `window.open().print()` with the Georgia/sage styling (already in disclosure/interview/vault).
