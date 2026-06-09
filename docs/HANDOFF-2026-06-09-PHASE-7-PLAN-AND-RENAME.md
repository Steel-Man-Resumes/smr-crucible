# SMR Crucible -- Session Handoff (Phase 7: plan locked + 7.0/7.1 shipped)

**Date**: 2026-06-09 (continuation, after `HANDOFF-2026-06-09-PHASES-2-6-CLOSE.md`)
**Model**: Opus 4.8 (claude-opus-4-8)
**Session**: Planned Phase 7 (the Resume Builder), shipped the two foundation phases (rename + shared editor), then revised and **LOCKED** the build plan against an external research pass. Troy's call: plan this session, build 7.2+ next session.

---

## >> THE NEXT MOVE: build **7.2 (Forge builder spine)** per `RESUME-BUILDER-SPEC-2026-06-09.md` **section 11**

`RESUME-BUILDER-SPEC-2026-06-09.md` **section 11 (LOCKED REVISION) is the authoritative build spec**; sections 1-7 are background, section 8 is superseded by 11.4. The `project_refinery_overhaul` memory note is the one-paragraph state.

Build order (same loop as the overhaul: build-verify -> commit -> deploy -> **authenticated Playwright walk on prod**, not just a route ping):
1. **7.2 Forge spine** -- ingest (+ "Gather Your Info" recovery links) -> assess/triage -> extract -> build (`<ResumeEditor>`) -> carry-forward. Standalone route, pre-auth. Truth gate + disclosure-safe guardrail. Rewire dashboard `needs_resume` onboarding to the Forge builder; refocus the Application Tailor to assume a base resume.
2. **7.3 Extraction intelligence** -- truth-gated bullet workshop, O*NET memory-jogging (fail-open), adaptive depth, justice reframing, User Readiness checklist.
3. **7.4 Dual surface**; 4. **7.5 deliverable + connectedness** (parser preview, base->version diff, interview handoff, fix vault `toText`).

**First build decision to make (deferred to build session):** Forge route -- upgrade `/resume` in place vs a new standalone `/build`. The builder must work logged-out and be linkable from the public site.

---

## Shipped + verified this session
- **7.0 Application Tailor rename** -- LIVE. Commit `f1f2f47`, deploy `dpl_DRzf8ab...` READY. The Refinery "Resume Builder" was never a builder; it tailors a base resume to a posting. Route `/dashboard/resume-builder` -> `/dashboard/application-tailor` (folder moved + next.config redirect; confirmed **307** on prod). 18 internal links + every label + coach page-id keys updated. `/access` relabeled (verified). External Canva/Indeed links left intact.
- **7.1 Shared `<ResumeEditor>`** -- LIVE. Commit `b5f09bd`, deploy `dpl_CEBi2L...` READY. Split-pane editor (sections + live preview + scoring + mobile toggle) extracted to `components/resume/ResumeEditor.tsx`; takes action bar + AI-summary assist as props. The Application Tailor consumes it (identical behavior); the Forge builder will too. Pure refactor; route serves (302 auth-gate).
- **Spec** `RESUME-BUILDER-SPEC-2026-06-09.md` written, then **section 11 locked** after the external-review filter.

## Locked decisions (Troy, 2026-06-09)
1. **Quality = strength meter + readiness CHECKLIST** (no second numeric grade -- doctrine: not scored/graded).
2. **Proof material = STRUCTURED evidence only** (what / tool / quantity / result); NEVER store free-form narrative or transcript (privacy doctrine).
3. **O*NET in MVP** for memory-jogging in the bullet workshop; all other external APIs deferred (CareerOneStop, BLS, USAJOBS, ESCO, parsers) or rejected (Lightcast -- paid + redundant with our AI).

## The external-review filter (what we adopted vs fenced out)
- **Adopted gems** (folded into existing phases, no new phases): truth gate, bullet workshop (did what / tool / how often / how many / what improved), O*NET memory-jogging, "Gather Your Info" recovery links (IRS Wage & Income transcript, The Work Number free EDR, Credly), User Readiness checklist, interview handoff, disclosure-safe guardrail, base->version diff, parser preview, JD structured extraction (incl. physical/schedule constraints) via our own AI, ATS-safe + TXT export.
- **Anti-drift fence** (spec 11.3): no API pile, no new "evidence bank" subsystem (use Forge base + `/api/user/context`), no browser extension, no second job tracker, no numeric readiness score.

## Gotchas for the build (carry-forward)
- Two coaches: `/api/assistant` (pre-auth Forge), `/api/coach` (auth Refinery). Skill `.md` reach prod ONLY via `next.config.mjs` `outputFileTracingIncludes` (per-route) -- verify `GET /api/health/skills` -> `{ok:true}`.
- Models in `lib/ai/models.ts` (`MODEL_DEEP`/`CHAT`/`FAST`); never hardcode. Bullet workshop + assessment = MODEL_DEEP.
- Progressive-intake engine: `lib/intake-engine.ts` + `POST /api/intake/followups` (2-round cap, fails OPEN) + `@/components/ProgressiveIntake`. This drives the bullet workshop.
- Privacy: store the frame/structured data, never the words/transcript.
- **O*NET**: needs a Web Services account -> env key (per-project, `nano .env.local` -> pipe to Vercel; activation gate). Wrap it ourselves (`lib/onet.ts`); FAIL-OPEN to AI-suggested tools.
- Shared resume core lives in `components/resume/` (`resumeModel.ts`, `ResumeEditor.tsx`, `ResumePreview.tsx`, `sections.tsx`, `SectionWrapper.tsx`). Vault `toText` resume case is still empty -- fix in 7.5.
- Deploy = `git push origin main`. the-crucible: project `prj_Y05eliHgrKIr4Y0TcCgvG8VATwZH`, team `team_XmJN97KS4xaZdLom6qF8R6ys`. Dev test login: `d3vt3st3rt.roy@gmail.com`.

## Standing rules
Atomic commits per feature; never em dashes (use `--`); no emojis; "justice-impacted" always; build green (types+lint) before commit; verify prod, do not assume.
