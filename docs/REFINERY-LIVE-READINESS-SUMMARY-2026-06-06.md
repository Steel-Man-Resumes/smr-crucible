# Refinery Live Readiness Summary - 2026-06-06

## Executive Position

The live Refinery is the Crucible app at `/home/marcu/repos/smr-crucible`, not the archived Refinery repo. The archived repo should remain archived. The live app is substantially stronger than the archive: it builds, has authenticated dashboard tooling, rate-limited AI endpoints, DB-backed artifacts/applications, decision logging, privacy settings, and real job-search integration.

The product direction should be: second-chance career operating system, not a generic resource directory. The old Resources tab diluted the mission. Replacing it with a Second Chance Job Board is the right move because it points users toward work, preparation, and disclosure strategy while still respecting real-world barriers.

Current status after this pass: improved and build-clean, but not fully "locked tight" until the remaining dependency/security migrations and visual QA are completed.

## Sweep 1: Archived Refinery

Path inspected: `/home/marcu/repos/_archived/smr-refinery`.

Assessment: archived for good reason. It is not a live target.

Findings:
- Build was blocked by module-scope Stripe/Redis env requirements.
- Vercel linkage and deployment assumptions were stale.
- Promo/access-code logic had hard-coded risk.
- Portfolio generation included XSS risk.
- Tests were stale relative to the app.
- Dependency vulnerabilities were present.
- The app did not match the live domain behavior.

Decision: do not revive it. Keep all live work in `smr-crucible`.

## Sweep 2: Live Refinery

Live domain observed in prior sweep: `https://refinery.steelmanresumes.com`.

Live deployment observed in prior sweep:
- Vercel project: `the-crucible`
- Deployment: `dpl_AR2U6XNMuTiZP3zSora8c8RCAMpo`
- Status: Ready
- Created: 2026-06-05 21:08:51 CDT
- Aliases: `forge.steelmanresumes.com`, `refinery.steelmanresumes.com`

Strengths:
- Consumer, core, and worker builds pass.
- Authenticated dashboard gates are in place.
- `/api/job-search`, `/api/hub-unlock`, and `/api/auth-check` rejected unauthenticated calls in prior live checks.
- Main API keys/envs were present in live configuration during the sweep: database, Auth, Resend, OpenAI, Anthropic, JSearch.
- Job search uses real listings through JSearch rather than fabricated openings.
- Artifacts and applications have DB-backed persistence.
- Decision logging exists for AI-assisted flows.
- User data deletion path exists.

Weaknesses before this pass:
- Resources was a helpful support directory, but not the strongest mission surface.
- Several dashboard tools expected `careerPaths` while current Forge output uses `career_paths`, causing silent personalization loss.
- Disclosure rehearsal sent `systemOverride` but the assistant route ignored it.
- Interview wrap-up logs claimed Anthropic/Claude even when the shared AI helper used OpenAI.
- Job-search code still said "Claude enrichment" even though the implementation used OpenAI.
- Download and artifact APIs needed tighter runtime validation.
- CSP did not allow browser Realtime calls to OpenAI.
- Dependency audit still had production vulnerabilities.
- No visual QA pass was run in this work session.

## Tool Effectiveness Ratings

Ratings are against the mission: help second-chance job seekers rebuild work, confidence, and employer-facing narrative.

| Tool | Rating Before | Rating After This Pass | Notes |
| --- | ---: | ---: | --- |
| Job Board | 7/10 | 7.5/10 | Real JSearch listings and fair-chance sorting are valuable. Still needs better filters for shift, pay, transport, background-check sensitivity, and apply path clarity. |
| Second Chance Board | 7/10 as Resources | 8/10 | Replaced broad resources with curated fair-chance opportunity lanes and live-search handoffs. It avoids fake jobs and points users into resume, interview, and disclosure tools. |
| Resume Builder | 7.5/10 | 7.5/10 | Strong scaffold from Forge data. Remaining risk: prompts should never estimate metrics when source material does not support them. |
| Disclosure Planner | 6/10 | 7/10 | Rehearsal now works through a restricted authenticated assistant override. Remaining need: verified jurisdiction/legal data source instead of model-only legal context. |
| Interview Practice | 6/10 | 8/10 | Added live voice practice path using OpenAI Realtime with `gpt-realtime-2`, plus existing written fallback. Needs live browser/mic QA before audience demo. |
| Applications/Progress | 6.5/10 | 6.75/10 | Progress now reflects board visits and personalization counts correctly. Still needs reminders, contact notes, follow-up templates, and outcome analytics. |
| Assistant | 7/10 | 7.5/10 | Better page context for Second Chance Board and voice interview. Still needs stronger evals and assistant abuse testing. |

## What Changed In This Pass

Product direction:
- Converted `/dashboard/resources` into a Second Chance Job Board.
- Kept the existing URL to avoid routing churn, but changed nav, dashboard cards, assistant text, quick wins, roadmap, progress, and dev toolbar labels.
- Added curated second-chance opportunity lanes in `apps/consumer/lib/second-chance-board.ts`.
- The board does not invent current openings. It gives realistic job lanes, employer examples/signals, cautions, and pushes users into live `/dashboard/jobs` searches.

Interview practice:
- Added authenticated live voice practice using OpenAI Realtime.
- New route: `/api/interview-voice/token`.
- Model: `gpt-realtime-2`.
- Architecture: server-minted ephemeral client secret, browser WebRTC, standard OpenAI API key stays server-side.
- Added hashed `OpenAI-Safety-Identifier`.
- Kept text mock interviews as fallback if mic, browser, quota, or Realtime fails.

Personalization:
- Added `apps/consumer/lib/forge-output.ts` to normalize Forge output shapes.
- Updated job board, interview practice, progress, and Forge preload to support both `career_paths` and legacy `careerPaths`.
- Fixed skills counting for array-based Forge skills.

Security and governance:
- Assistant `systemOverride` is now honored only for authenticated `disclosure-rehearsal`.
- The override is sanitized, length-limited, and layered under the base assistant rules.
- Added request-size cap to `/api/assistant`.
- Added runtime artifact type validation to `/api/artifacts`.
- Added request/content caps and type/format validation to `/api/forge/download`.
- CSP now permits only `https://api.openai.com` and `https://api.anthropic.com` for external API connections, plus `media-src 'self' blob:` for voice playback.
- Interview wrap-up decision logs now use actual `AI_PROVIDER`/`AI_MODEL`.
- Job-search enrichment naming/logging no longer falsely says Claude.
- Ran non-force `npm audit fix`, reducing production audit findings from 20 to 12.

## Competitor / Platform Landscape

The market has AI interview practice tools, and many are moving toward voice:
- Prepra: voice-only mock interview practice with role-specific tracks and rubric feedback.
- Intervator: browser mock interviews by voice/text, live avatar option, and structured outcomes.
- JumpToJob: resume/job-description-driven AI voice mock interviews and feedback.
- Better Interview / similar tools: live voice interviews with scoring rubrics.

Second-chance/reentry employment tools exist, but they are usually not the same thing:
- ReRoute presents fair-chance employer/support connections.
- CareerOneStop provides reentry and ex-offender job-search guidance.
- LinkedIn exposes fair-chance employer filtering/signals.
- Honest Jobs / 70 Million Jobs-style boards focus on fair-chance listings.

Gap/opportunity for Steel Man:
- Most AI interview tools are generic career prep.
- Most reentry tools are directories/job boards.
- The differentiated product is the loop: Forge narrative -> second-chance job lanes -> live listings -> targeted resume -> disclosure plan -> written/voice interview rehearsal -> application tracking.

## Research Grounding

The research spine is generally sound:
- Stages of Change for readiness-aware support.
- Narrative identity/redemption sequence for reframing work history.
- Bandura/self-efficacy for interview practice.
- Scaffolding for resume/interview development.
- Weak-tie/institutional access logic for employment pathways.
- Trauma-informed framing for dignity and control.

Where it needs strengthening:
- Legal/disclosure guidance must use verified jurisdiction data, not model inference alone.
- Employer fair-chance claims need confidence tiers and verification dates.
- Voice interview effectiveness should be evaluated with real users, not assumed from general practice theory.
- Job-board fit should eventually consider offense-job relationship, recency, supervision, transport, schedule, and licensing constraints.

## Remaining Go-Live Risks

Security/dependencies:
- Production audit still reports 12 vulnerabilities after non-force fixes.
- Full audit reports 14 vulnerabilities.
- Remaining items require breaking or force-level upgrades around Next, NextAuth, AI SDK, eslint-config-next/glob, and exceljs/uuid.
- CSP still uses `unsafe-inline` and `unsafe-eval`; likely framework-driven, but this should be reviewed before a high-stakes launch.
- Build shows Edge runtime warnings from `bcryptjs` through `auth.ts`; build still passes, but middleware/auth packaging should be reviewed.

Voice:
- The Realtime implementation compiles, but still needs browser QA with microphone permissions and a real OpenAI project that has `gpt-realtime-2` access.
- Need cost guardrails for live voice sessions: max session duration, visible stop state, server-side usage logging, and maybe per-user voice quota separate from text interview quota.
- Need transcript/feedback capture policy before storing voice-derived data.

Data/compliance:
- AI decision logs exist, but there is not yet a full governance dashboard.
- Disclosure/legal content needs source-backed jurisdiction data.
- Employer signal data needs verification workflow and stale-data policy.
- LocalStorage still stores Forge/progress data; acceptable for current architecture, but not ideal for sensitive long-term state.

QA:
- No Playwright visual pass was run in this session.
- No live Vercel smoke test was run after these edits.
- No real Realtime call was executed from a browser in this session.

## Go-Live Readiness Call

For a controlled live audience demo: yes, with caveats. The app builds, the mission direction is sharper, and the highest-impact product confusion has been corrected.

For broad public launch: not yet. The remaining audit items, voice QA, visual QA, and legal/employer-data verification should be completed first.

Recommended next work:
1. Run Playwright visual QA across dashboard, second-chance board, jobs, interview, and disclosure.
2. Test Realtime voice in Chrome with a real authenticated user.
3. Add max voice-session duration and explicit quota/cost tracking.
4. Plan dependency migrations for Next, NextAuth, AI SDK, and Excel-related packages.
5. Add verified legal/employer data sources with verification dates.
6. Add board filters for shift, pay, transport, background-check sensitivity, and immediate-hire roles.

## Sources Used For Current External Facts

- OpenAI Realtime overview: https://developers.openai.com/api/docs/guides/realtime
- OpenAI WebRTC Realtime guide: https://developers.openai.com/api/docs/guides/realtime-webrtc
- OpenAI Realtime prompting/model guide: https://developers.openai.com/api/docs/guides/realtime-models-prompting
- OpenAI `gpt-realtime-2` model page: https://developers.openai.com/api/docs/models/gpt-realtime-2
- CareerOneStop reentry job-search resources: https://blog.careeronestop.org/job-search-resources-for-prisoners-and-ex-offenders/
- SHRM / Getting Talent Back to Work pledge list via Cornell ILR: https://www.ilr.cornell.edu/cjei/getting-back-work-pledge
- LinkedIn fair-chance employer signal help: https://www.linkedin.com/help/linkedin/answer/a415496
- Prepra: https://www.prepraai.com/
- Intervator: https://intervator.ai/
- JumpToJob: https://www.jumptojob.com/
- ReRoute: https://reroutejobs.com/
