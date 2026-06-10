# Session Close -- 2026-06-10 (Fable: analysis -> P0 batch -> seats)

**Instance:** Claude Fable, inaugural SMR session (analysis charter + execution green-light).
**Read order for a fresh chat:** (1) this doc, (2) `docs/BUILD-CHECKLIST.md` (live state by system), (3) `docs/FABLE-REASSESSMENT-AGENCY-2026-06-10.md` (direction + Troy's recorded decisions), (4) `docs/FABLE-ANALYSIS-REPORT-2026-06-09.md` (the audit, file:line). The 24-item task board in the Claude Code session mirrors the checklist.

---

## 1. Where things stand (one paragraph)

The full-platform audit is done and acted on. **The entire P0 batch is shipped and live**: truth gate in every generation lane, identity single-source, legal disclaimers, export branding off, DEEP model tiers, skills library wave 1 (14 skills verified on prod), and seats v1 with code-aware Forge rate limits. **Task #4 -- Troy's hands-on certification retest -- is the gate before the EXPO cohort (~Jun 16) and is unblocked.** Next build per the runway: t.ROY Phase A (one sighted brain) during pilot week, then disclosure voice, job board v2, Phase B agency tools.

## 2. Shipped this session (commit ledger, all pushed to main = deployed)

| Commit | What |
|---|---|
| `8099849` | Full-flow analysis report (P0/P1/P2, file:line) |
| `351dac6` | Agency reassessment: t.ROY 3-phase architecture, seats design, runway, Troy's decisions |
| `c339525` | **Truth gate in every generation lane** -- fabrication table deleted from generate-docs; evidence-only rules in resume-generate-full (+ certs/education forced to carry forward); cover letters barred from invented numbers/personal facts; "--" never em dash in prompts |
| `283f3df` | "Built with The Refinery" footer OFF employer-facing exports (indirect disclosure leak) |
| `cc119e6` | MODEL_DEEP on analyze / generate-docs / resume-generate-full / disclosure-guide + either-provider key guards |
| `d9b6151`, `814a7c5`, `2f61435`, `7b5355c` | HANDOFF + living BUILD-CHECKLIST (incl. section 10: experience/compliance/security) |
| `6a93138` | **Skills wave 1**: 12 new doctrine skills + manifest v2; fixed dead `resume-builder` page-id (doctrine had stopped loading on the Tailor); verified live `/api/health/skills` -> skillCount 14 |
| `e0b4bdf` | **Identity single-source**: forgeSession upsert MERGES profile_data (clobber fixed); Tailor takes document identity from the BASE resume (localStorage -> server artifact -> profile); `lib/phone.ts` formatPhoneUS at profile read/write + document assembly |
| `b49898d` | **"Coaching, not legal advice"** on plan view + plan PDF + vault PDF + Tailor brief; non-WI prompts can no longer demand statute citations (general info + legal-aid routing) |
| `7b7d533` | **Seats v1**: `client` code tier (migration 019, APPLIED to Neon); atomic seat claims (max_redemptions = seats, no oversell); `/access?code=X` sets 60-day cookie -> per-code Forge pool (limit x seats, cap 50) replaces shared NAT-IP bucket; admin Mint Access Code form (type/seats/daily limit; admin+unlimited never mintable) |

**Seeded live in prod Neon:** `EXPOCREW`, `BAKERCREW`, `JFWCREW` (client tier, 10 seats, 200/day each). Staff codes `EXPO2026`/`BAKER2026`/`JFW2026` unchanged (partner role). **Cohort members sign up via `forge.steelmanresumes.com/access?code=EXPOCREW`; Marianne herself keeps EXPO2026.**

## 3. Troy's decisions recorded this session (full list in the reassessment doc)

Truth-gate both lanes + draft disclaimers; footer off resumes (ok in-app); seats = 1 registered user durable, ~10/agency, admin-mintable with variables; confirm-card before every t.ROY mutation; disclosure voice = full parity; users get surface-level agency (style/temperature), platform keeps deep logic; from-scratch builder must become "simply award-winning"; public brand = "Steel Man" for the 501(c)(3); t.ROY = omnipresent + progressively personal + AGENTIC; skills must cover "any conceivable task... legally and ethically within bounds" (headshot = GUIDANCE only, no face storage); Spanish + Hmong i18n; WCAG/mental-health/data compliance dive; white-hat security audit ("show me your best work"); SEO/EEO; auth portability for native apps; Kenosha court-record paste was accidental -- disregarded, never stored; **Twilio A2P approved for TMG ONLY -- SMR traffic must NOT ride it; SMR registers its own with the SMR LLC EIN (`~/todash/smr/legal/`)**.

## 4. Next session, in order

1. **Reply-pull first** (per `~/todash/tooling/self-learning/reply-pull.md`), silent no-op if empty.
2. **Verify the last deploy actually promoted** (pattern: push success != live deploy): check the latest Vercel deployment for `the-crucible`, then prod-verify seats -- visit `/access?code=EXPOCREW`, confirm the `smr_access_code` cookie sets, run one Forge tool, confirm an `ai_usage` row keyed `code:EXPOCREW` appears.
3. **Support Troy's retest (Task #4)** -- his script is in the checklist/last session message: fresh persona via EXPOCREW; zero-numbers truth check vs the v2 folder (`C:\Users\marcu\Dev\SMR stuff\d3vt3st3r-forgeOutput-v2`); identity (different signup name vs resume name -> tailored docs carry the RESUME's name, formatted phone); forklift cert survives tailoring; disclaimers visible; no footer on exports. Fix anything he finds same-day.
4. **Then Task #5: t.ROY Phase A** -- coach route accepts `{messages, context}`, server merges getUserProfile + computeNextStep + page-state; assistant fetches userFullContext server-side for authed users; proactive triggers on page mounts. (Diagnosis: coach is page-blind by contract -- `app/api/coach/route.ts:67` takes messages only; assistant falls back to "No full context loaded" at `assistant-prompt.ts:514`.)
5. Queue behind it: #6 disclosure voice (token route already supports disclosure mode; extract a shared LiveVoicePanel; inject plan + evidence; evidence into interview voice too), #7 job board v2, #11 skills wave 2 (incl. capability-breadth set), #21 security audit, #24 edge-case catalog (Troy will red-team via ChatGPT).
6. Small open items: sync `~/todash/clients/STATUS.md` (EXPOCREW/BAKERCREW/JFWCREW minted -- Marianne/Baker/Shannon lanes; Troy's Gmail draft r3808869368907902735 references EXPO2026 and may need a line about EXPOCREW for members); CareerOneStop creds still 401; O*NET approval still pending (workshop tools run on AI fallback).

## 5. Footguns + environment facts (save yourself an hour)

- **Edit/Write require a Read-tool read first** -- `cat` via Bash does NOT count. This tripped 3x this session (the known PATTERNS.md repeat).
- **Skill .md files reach a route's Lambda ONLY via** `next.config.mjs` `outputFileTracingIncludes` (glob `./lib/skills/**/*` already covers new folders). Verify with `GET /api/health/skills`.
- **Deploy = `git push origin main`** (git-connected Vercel, project `the-crucible`). Build check: `cd apps/consumer && npm run build` after `source ~/.nvm/nvm.sh && nvm use 20`.
- **Migrations:** add `packages/core/migrations/NNN_*.sql`, then `export DATABASE_URL=$(grep -m1 '^DATABASE_URL=' apps/consumer/.env.local | cut -d= -f2- | tr -d '"')` and `cd packages/core && npm run migrate`. Applied through 019.
- **Neon from scripts:** WebSocket driver fails under Node 20/sandbox; use the HTTP driver (`import { neon } from "@neondatabase/serverless"`), script must live INSIDE the repo for module resolution, Bash needs `dangerouslyDisableSandbox` for network.
- **Models:** never default-call `callAI` for high-stakes one-shots -- pass `MODEL_DEEP` (the four big lanes now do; keep new lanes honest). Decision-log labels come from a local `const AI_MODEL = MODEL_DEEP` override.
- **jq is not installed; Node for JSON. `vercel` CLI is PATH-shadowed -- prefer push-to-deploy.**
- Near-misses this session: `tier` name collision in the mint route (caught by build -- always build before commit); admin/unlimited tiers must NEVER be mintable from the API (guard added -- keep it).

## 6. Working agreement with Troy (active)

Server-side/doctrine fixes -> straight to main with a one-line "what to test" in the commit. **User-VISIBLE UX -> preview branch first** (Task #18 Ask-Troy spotlight is explicitly preview-first). Troy's hands-on retest gates the cohort. Increments small, atomic commits, report with receipts. Corrections are gifts -- fix or file, never defend.

## 7. The other lane (do not pick it up here)

The Midnight Garden personal-agent build is chartered for a SEPARATE Fable instance: `~/todash/tmg/TROY-PERSONAL-AGENT-CHARTER-2026-06-10.md` (copy on Troy's Desktop). It plans first, interviews Troy, then builds. This session's repo (smr-crucible) stays SMR-only.

*Closed clean: working tree empty, all commits pushed, board current (#1-#3 completed, #4 = Troy's retest, #5 next build). The platform stopped lying, a classroom can't knock it over, and the cohort can come. -- Fable*
