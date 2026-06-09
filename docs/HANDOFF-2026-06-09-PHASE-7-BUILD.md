# SMR Crucible -- Session Handoff (Phase 7 BUILD: 7.2-7.5 shipped)

**Date**: 2026-06-09 (continuation of `HANDOFF-2026-06-09-PHASE-7-PLAN-AND-RENAME.md`)
**Model**: Opus 4.8
**Session**: Built and shipped the Resume Builder + extraction intelligence. 7.2, 7.3, 7.4 (core), and 7.5 (most) are LIVE on prod and verified with authenticated Playwright walks. `RESUME-BUILDER-SPEC-2026-06-09.md` section 11.4 was the build plan.

---

## >> THE NEXT MOVE: the Phase 7 remainder (a focused follow-up)

Shipped + verified this session: the industry-best builder spine, the truth-gated bullet workshop, base-resume persistence, and the deliverable surfaces. What's LEFT (all enhancements to already-working features -- nothing is broken):

1. **Interview handoff** -- wire `WorkEntry.evidence[]` (the bullet-workshop proof, stored this session) into Interview Practice so talking points regenerate from real proof. The data is already on the resume doc; the interview setup just needs to read it.
2. **Base -> version diff** in the Application Tailor -- "what changed vs your base resume" (sharpens the existing tailoringNotes).
3. **Public-site link-in** -- a CTA on steelmanresumes.com (smr-website repo) -> `forge.steelmanresumes.com/resume`. The dashboard already links in; this is the marketing surface.
4. **Tailor auto-default to the base resume** (minor polish; it's already in the savedResumes list).
5. **Migrate `ResumeWorkspace`'s inline `printResumePdf` to the shared `components/resume/resumePrint.ts`** (created this session; the Tailor still has the duplicate -- deferred from 7.2 to avoid a risky template match mid-spine).

**TROY ACTION (unblocks O*NET memory-jogging):** register a free O*NET Web Services account at **services.onetcenter.org/developer/signup** (app name "Steel Man Resumes"), then hand me the username/password -> I pipe `ONET_USERNAME`/`ONET_PASSWORD` into `.env.local` + Vercel. Until then `lib/onet.ts` fails open to AI-suggested tools (working in prod now, `source:"ai"`).

---

## Shipped + verified on prod this session

| Phase | What | Commits | Verified |
|---|---|---|---|
| **7.2** | Forge builder spine: ingest -> structured `ResumeDocument` -> `<ResumeBuilder>`(shared `<ResumeEditor>`) -> carry-forward to /goals. "Gather Your Info" recovery links (IRS/Work Number/Credly). Dashboard `needs_resume` rewired to base->tailor. Application Tailor refocused to assume a base resume. | `102051f`, `78d888d` | Authed Playwright walk (paste->build->/goals; "WORK HISTORY" parses; Tailor refocus live) |
| **7.3** | Truth-gated bullet workshop (`/api/forge/resume-assist` pre-auth, IP-limited; `<BulletWorkshop>` on every bullet). O*NET wrapper (`lib/onet.ts`, fail-open). Justice reframing (doctrine in-prompt). Adaptive assess nudge + User Readiness checklist. `WorkEntry.evidence[]`. | `d4597ff`, `5fedb6b` | Prod walk w/ REAL AI: generated a true, quantified bullet from plain facts; accept -> resume |
| **7.4** | `persistForgeSession` now persists the exact structured `resumeDoc` (with evidence) as the base artifact (createdFrom forge) -> `/api/user/context` -> Tailor source. | `3b1eda8` | Build + reasoning (both client carry paths send `resumeDoc`) |
| **7.5** | Parser preview ("what a machine reads"). Plain-text (.txt) export. Vault `toText` resume case fixed (was empty); resumes View/Save-PDF in Materials; base-vs-tailored label. | `cf3d985`, `cf93f1a` | Authed prod walk: parser preview reads fields; vault resume expands + Save PDF |

## Key decisions (Troy, this session)
1. **Route**: upgrade `/resume` in place (one surface, least confusing for non-technical users) -- not a separate `/build`.
2. **Unlock gate unchanged**: base resume is the on-ramp; full_access still unlocks on the first job-TAILORED resume.
3. **Bullet workshop is PRE-AUTH** (Troy + CC: no business/technical reason to wall the gold; IP-limited like `/api/assistant`). This also fixed a latent 7.2 gap: the builder's summary assist was hitting the auth-gated `/api/resume-generate` (401 logged-out) -- now uses pre-auth `/api/forge/resume-assist`.
4. **Doctrine in the bullet prompt** is a focused one-shot encoding of `career-narrative/SKILL.md` (truth gate, anti-fragility, evidence anchors, kill "just", reframe inside/work-program work) -- NOT the full conversational skill file (which would mislead a one-shot generator).

## Gotchas / facts for the next session
- `auth.ts` `authorized` callback 401s a list of `/api/*` prefixes incl `/api/resume-generate`, `/api/user/*`, `/api/artifacts`. `/api/forge/*` is UNPROTECTED (pre-auth, IP-limited). Put pre-auth Forge AI under `/api/forge/`.
- Deploy = `git push origin main`. Verify prod with the authenticated Playwright walk (cached chromium at `~/.cache/ms-playwright/chromium-1223/chrome-linux64/chrome`, run via `playwright-core@1.52` in `/tmp/pwtest`). Prod hydrates slower than local `next start` -- click with a re-click-until-element-appears loop.
- Mock AI for deterministic local walks: `MOCK_AI=true` env on `next start`.
- The base resume artifact has `target_context.source = "forge"` + `content.meta.createdFrom = "forge"`; tailored resumes have `createdFrom: "job"` (the unlock signal in `/api/user/context`).

## Standing rules
Atomic commits per feature; never em dashes (`--`); no emojis; "justice-impacted"; build green (types+lint) before commit; verify prod, do not assume.
