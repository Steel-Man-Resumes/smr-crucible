# t.ROY 10x -- Build Handoff (2026-08-03)

Troy's mandate, verbatim intent: "he needs to be singularly impressive." Troy
approved ALL items below ("yes yes yes to all") on 2026-08-03. This document
is the complete brief for the building session. Read it fully before writing
code.

## 0. Required pre-reading (doctrine -- do not skip)

1. Memory: `feedback-troy-ai-chatbot-doctrine.md` (auto-memory) -- t.ROY
   doctrine is STANDING.
2. `~/todash/brand/TROY-AI-REASSESSMENT-KICKOFF-2026-07-25.md` -- the t.ROY
   architecture rulings. KEY FACT: the SMR Crucible assistant is BESPOKE code,
   NOT the troy-ai-core kernel. Improving it here is allowed and does not
   touch the kernel rulings (R1/R2). Do not migrate it onto the kernel in
   this wave -- that is kickoff plan item 4, Troy rules separately.
3. Doctrine constraints that bind every change:
   - Humanistic output, never .md-style status dumps.
   - Honest freshness -- never claim data is more current than it is.
   - Knows WHICH surface it is on and WHO it talks to; guarded when unsure.
   - Identity honesty (see item 9 below -- Troy explicitly approved).

## 1. The diagnosis (why this wave exists)

Troy chatted with the Refinery assistant ("Guide"). It correctly advised
"tailor your resume for the Myticas Consulting job you saved" and then handed
him a URL. Troy: "it would be cool if he would have helped me get there
instead of just giving directions. how could he be a real ASSISTANT vs chat
bot." The gap is not intelligence -- the assistant is context-rich (page,
readiness stage, skills, goals, forge output) but has NO HANDS. Every build
item below converts knowledge into action.

## 2. Ground truth -- current architecture (verified 2026-08-03)

- **UI**: `apps/consumer/components/AssistantChat.tsx` (~264 lines), rendered
  inside `AssistantDrawer` (from `packages/consumer-ui`). Mounted by
  `ForgeShell.tsx` (all Forge pages) and RefineryShell equivalent. Read the
  component before touching -- note how it streams and manages messages.
- **API**: `apps/consumer/app/api/assistant/route.ts` -- Vercel AI SDK
  `streamText`, model `MODEL_CHAT` (claude-sonnet-4-6) via `@ai-sdk/anthropic`,
  `maxTokens` 400 for clients / 1200 for partner/observer, temperature 0.7.
  Dual rate limiting (IP pre-auth 20/day; per-user post-auth). Logs to
  `decision_log` AND (new, keep it) exact tokens to `ai_token_usage` via
  `recordTokenUsage` in onFinish.
- **Prompt**: `apps/consumer/lib/assistant-prompt.ts` -- `buildSystemPrompt`
  with `AssistantContext` (currentPage, readinessStage, skills, barriers,
  audience client/partner/observer, mode intro/guide/chat, goals, prefs,
  userFullContext...). Plus `apps/consumer/lib/skills-loader.ts` per-page
  skill snippets and `lib/research-context.ts`.
- **Coach naming**: the GuidedTour lets clients name their coach (default
  "Guide"); persisted via `/api/onboarding/tour` (`coachName`).
- **Conversation persistence**: `coach_conversation` table (user_id, role
  user/assistant/system, content, context_digest) -- written by the coach
  routes (`/api/coach/*`), NOT currently by `/api/assistant`. There is a
  dormant `/api/coach/proactive` route (simple GET) -- inspect before reuse.
- **Coach-marks**: `components/GuidedTour.tsx` renders modal screens (not
  true anchored coach-marks yet); nav element highlighting must be built.
- **Voice in**: `components/SpeechInputButton.tsx` (Web Speech API, free,
  renders nothing when unsupported) -- already used in Forge goals/paste.
- **Live data available server-side**: job_application, refinery_artifact,
  users.current_stage + next_step_cache, access codes, ai_token_usage. The
  `/api/next-step` route serves the journey engine's next action.
- **Impersonation caveat**: `/api/assistant` deliberately uses REAL
  `auth()` (not effectiveAuth) -- keep it that way; assistant actions during
  a dev view session would be blocked at the edge for writes anyway.

## 3. Approved build items (ALL green-lit), in build order

### Wave A -- Hands (the 10x itself)
1. **Tool calling in /api/assistant.** Add `tools` to `streamText` with
   `maxSteps` so the model can act and then speak. Two tool classes:
   - **Client-executed (UI) tools** -- returned to the browser and executed
     by AssistantChat via the AI SDK's client `onToolCall`:
     - `take_me_there { page, prefill? }` -> router.push with optional
       query/sessionStorage prefill (e.g. Application Tailor pre-loaded with
       a discussed job via the existing `resume_target_job` sessionStorage
       pattern used by the jobs page).
     - `highlight_element { selector, note }` (Wave B walk-with-me).
   - **Server-executed tools** (run in the route, results fed back to the
     model): `get_my_live_status` (applications by status, saved jobs, stage,
     next step -- from DB, with real timestamps for honest freshness),
     `search_jobs { query }` (reuse the job-search route's internals or fetch
     it), `save_job { jobId }`, `add_follow_up_reminder { applicationId, date }`.
   - Low-risk writes (save_job, reminder) execute directly; anything bigger
     must ask in-conversation first. No destructive tools (no deletes).
   - Respect the existing rate limits; tool roundtrips must not multiply
     billed calls beyond maxSteps ~4.
2. **Quick-action chips** above the chat input, contextual per page:
   "What's next for me?", "Take me there", "Do it with me", "Explain this
   page". Chips inject a user message (visible in transcript -- no hidden
   prompts).

### Wave B -- Walk-with-me
3. **Anchored highlights**: `highlight_element` tool draws a spotlight ring +
   caption on a data-tour-id annotated element (annotate key nav/buttons with
   `data-tour` attributes). t.ROY narrates while pointing. Reduced-motion
   safe.

### Wave C -- Continuity + reach
4. **Cross-session memory**: persist assistant turns to `coach_conversation`
   (both roles) and load the last ~10 turns + context_digest into the system
   prompt. Opening line references real prior work ("Last time we were
   getting your Myticas application ready"). Truthful only -- if digest is
   stale, say when it is from.
5. **Voice out**: speaker toggle using browser `speechSynthesis` (free, no
   keys) reading assistant replies; per-user preference persisted. Pairs with
   the existing mic for full voice conversations.
6. **Proactive nudges**: on drawer open (not push), one contextual nudge chip
   computed from live data ("You saved Myticas 3 days ago -- finish the
   application?"). Reuse/replace `/api/coach/proactive`. NO new crons (7/16
   suspension stands); this is request-time only.

### Wave D -- Controls + trust
7. **Chat settings** (quiet gear in the drawer): response length
   (short/normal), plain-language level, voice on/off, Spanish replies
   (prompt-level instruction; UI stays English for now). Persist per user
   (users table pref column or consumer_profile -- inspect and choose;
   migration fine).
8. **Escalate to a human**: "Message Troy" action -> stores the thread
   excerpt + user email to a support request (simple table + admin page
   list, or email via Resend to steelmanresumes@gmail.com -- builder's
   choice; if email, verify by DELIVERY per standing doctrine).
9. **Model honesty**: when asked what it runs on, answer plainly: runs on
   Claude (Anthropic); Troy designed what it says and how it behaves. Add to
   the system prompt. Never evasive.

## 4. Non-negotiables / gotchas

- Brand: "t.ROY" naming doctrine; no em dashes in copy (double hyphens);
  no emojis in professional content; "justice-impacted" language only.
- The 400-token client cap exists for texting-style answers -- tool use may
  need more headroom; raise carefully (e.g. 700) and watch ai_token_usage
  costs (admin panel shows per-endpoint spend -- "assistant").
- MOCK_AI: `lib/mock-ai.ts` intercepts upstream in some routes; assistant
  hits the real model. Keep it working pre-auth (Forge) AND post-auth.
- AI SDK version: check package.json before writing tool code; tool API
  differs across ai@3/4 versions. Match what is installed or upgrade
  deliberately and test streaming end to end.
- Build: `npm run build -w packages/core && cd apps/consumer && npx next build`
  (WSL, nvm use 20). Deploy: `vercel --prod --yes` from repo root -- domains
  follow automatically (forge./refinery.steelmanresumes.com). Migrations:
  `scripts/run-migrate-local.sh`.
- Verify like you mean it: real Playwright run of a chat that triggers
  `take_me_there` and lands on the right page; real DB row checks for
  memory persistence; exact-token rows still landing for endpoint
  "assistant".
- The repo is PUBLIC (AGPL). No secrets, no client PII in code or docs.

## 5. Definition of done

Troy opens the Refinery, asks "what should I do next?", and t.ROY: answers
from his real live data, offers "want me to take you there?", navigates him
with the job preloaded, highlights the first field, and remembers the whole
exchange tomorrow. Every reply lands in ai_token_usage. Nothing about the
experience feels like a chatbot with a search box.
