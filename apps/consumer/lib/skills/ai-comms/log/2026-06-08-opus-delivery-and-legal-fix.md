# 2026-06-08 -- Opus 4.8 -- Delivery hardening + legal doctrine fix

**Model**: Opus 4.8 (claude-opus-4-8)
**Session focus**: Prove + fix skill-file delivery to prod; tiered model router; correct the WOTC legal error
**Status**: CLOSED (delivery verified; more workstreams open -- see below)

## What Changed
- **Skill delivery (was silently broken in prod).** Skill `.md` files are fs-read at runtime in `app/api/assistant/route.ts` but never imported, so Next never traced them into the Lambda -- t.ROY ran with ZERO doctrine in production while local dev looked fine. Fix: `next.config.mjs` -> `experimental.outputFileTracingIncludes` for `/api/assistant`. The loader now logs `[skills] MISSING` loudly instead of returning "" silently. New `GET /api/health/skills` reports presence from inside the Lambda. Verified live: `ok:true`, both files at `/var/task/apps/consumer/lib/skills`.
- **Model router.** New `lib/ai/models.ts` -- single source of truth: Opus 4.8 (deep synthesis) / Sonnet 4.6 (live chat) / Haiku 4.5 (mechanical). Live t.ROY chat upgraded off `claude-sonnet-4-20250514` -> Sonnet 4.6. `callAI()` takes an optional `model` so deep routes can opt into Opus without touching other call sites.
- **maxTokens** in the assistant route is now audience-aware (400 client / 1200 partner-observer) so evidence mode stops truncating mid-citation.
- **Legal doctrine fix in `disclosure-coaching.md`.** Per ground-truth research (`~/todash/smr/research-ground-truth`, IRS/DOL primary sources): WOTC expired for hires beginning after 2025-12-31 -- removed the claim that it is a current incentive; Federal Bonding is now the incentive t.ROY points to. Added a legal-claims discipline note (jurisdiction + date + verify-locally; no categorical promises; no universal "seven-year rule"; expungement != universal erasure). Qualified the Milwaukee ban-the-box threshold as medium-confidence / needs-verification.

## Doctrine Notes
- NEW never-do entries (PROTOCOL.md): present an expired/unauthorized employer incentive as current; state a legal point without jurisdiction + date or give a categorical legal promise.
- All legal content in skill files must follow `~/todash/smr/research-ground-truth/AI-USAGE-RULES.md`: High/Medium/Low confidence, jurisdiction + date, no categorical advice.

## Observations
- Two AI invocation patterns coexist: generators use raw fetch via `lib/ai-call.ts` (already Sonnet 4.6 / Haiku 4.5); only the streaming chat used the old model. MOCK_AI is gated per-route via `isMockEnabled()` and is `true` in local `.env.local` only -- confirm Vercel prod has it off/unset.
- No prompt caching yet on the assistant route (the large static prefix is re-billed every message). `@ai-sdk/anthropic` 1.2.12 supports `cacheControl` -- next up.

## Open Items
- NEEDS-AI: route disclosure-plan + career-narrative generation to `MODEL_DEEP` (Opus 4.8) + add prompt caching. Forge->Refinery server-side save. Proactive t.ROY (`computeProactiveMessage` is built in core, unused). Test harness. Expand the skills library (hybrid: prose + JSON fact tables + callable tool functions + a routing manifest).
- NEEDS-TROY: confirm Vercel prod `MOCK_AI` is off/unset. Decide Opus-for-deep cost/latency (recommended yes for those two routes).

## Handoff Notes
Read this file + `PROTOCOL.md`. Skill files now actually load in prod -- verify any future skill with `GET /api/health/skills`. Do NOT write to `~/todash/smr/research-ground-truth/` (a concurrent research agent owns it); read from it. Model choice goes through `lib/ai/models.ts` -- never hardcode a model string in a route.
