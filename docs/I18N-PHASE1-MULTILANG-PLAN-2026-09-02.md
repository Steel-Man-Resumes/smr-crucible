# Phase 1 Multilingual AI Output -- Build Plan

**Status: PROPOSED, awaiting Troy's review. Nothing below is built yet.**
Date: 2026-09-02. Author: CC. Trigger: Troy wants the whole SMR toolset to meet a
person in their language, the way the coach already does in Spanish.

---

## 1. Goal and scope

**Phase 1 makes every AI-generated *coaching* output honor a user's language
preference.** It does NOT translate the app's interface chrome (buttons, menus,
labels). That is a separate, much larger project (Phase 2) and is explicitly out
of scope here.

Why this split: the tools' *value* is the AI text -- the reflection, the
disclosure timing, the interview feedback, the coach. That is 90 percent of the
benefit for a non-English speaker, and the plumbing to deliver it already exists.
The interface chrome is hundreds of hardcoded English strings across 40+ pages
with no i18n framework, and translating it is weeks of extraction work for a much
smaller marginal gain once the coaching already speaks the user's language.

---

## 2. The one rule that governs everything

**Coaching and explanation get translated. Application artifacts do NOT.**

A resume, cover letter, or anything the person hands to a US employer must stay
in the *application's* language (English by default), even when the user is
navigating in Spanish. This is already the documented intent
(`docs/BUILD-CHECKLIST.md` line 64: "resumes stay application-language").

The Forge `/analyze` route is the sharp edge: its `headline` and `summary` fields
are labeled "RESUME-READY ... may appear on actual job applications"
(`app/api/analyze/route.ts` lines 387-388). Translating those would actively harm
the user. So the language directive is applied **per prompt-site by category**,
never blanket.

| Category | Translate? | Examples |
|---|---|---|
| Coaching / explanation the user READS | Yes | Coach chat, t.ROY, disclosure timing_advice + tips, interview feedback, barrier explanations, Mini Forge guidance, the private Forge "reflection" field |
| Application artifacts the user SENDS | No, stay in application language | Tailored resume, cover letter, the Forge `headline`/`summary`, skills as resume keywords |
| Legal context | Yes, but flagged for native review | disclosure `legal_context` (already kept general + points to legal aid) |

---

## 3. Current state (what already exists)

- **The pattern:** `packages/core/src/coachPrompt.ts` lines 54-57 -- a one-line
  `languageRule` appended to the coach system prompt when `coachLanguage === "es"`.
  This is the exact mechanism to generalize.
- **Storage:** `users.coach_language TEXT NOT NULL DEFAULT 'en'`, CHECK `IN ('en','es')`
  (`packages/core/migrations/025_assistant_hands.sql`).
- **Settings API:** `app/api/coach/settings/route.ts`, `LANGUAGES = ["en","es"]`,
  read/written as `coachLanguage`. Partial-update POST already supported.
- **Settings UI:** a "Reply in Spanish" toggle in `AssistantChat.tsx` (line 423)
  and `AccessibilitySettingsSection.tsx` (lines 119-126).
- **The AI choke point:** `app/consumer/lib/ai-call.ts` `callAI(system, messages,
  maxTokens, model, meta, signal)` -- used by most tool routes (analyze,
  disclosure-guide, interview-practice, resume-*, mini-forge, etc.).
- **The exception path:** `app/api/assistant/route.ts` (t.ROY) does NOT use
  `callAI`; it calls `streamText()` with `@ai-sdk/anthropic` directly.

**Known bug to fix in this phase:** t.ROY ignores the language flag. The "Reply in
Spanish" toggle writes `coach_language`, but `app/api/assistant/route.ts` /
`lib/assistant-prompt.ts` never read it, so t.ROY answers in English regardless.
Fold the fix into this work since we are touching language plumbing anyway.

---

## 4. Architecture

Four small pieces, designed so adding a language later is a one-line config
change.

**4a. A language registry (single source of truth for wording).**
New file `packages/core/src/language.ts`:
```ts
export const SUPPORTED_LANGUAGES = ["en","es","vi","zh","ht","ar"] as const;
export type LangCode = typeof SUPPORTED_LANGUAGES[number];

// The directive appended to a COACHING system prompt. Generalizes the existing
// coachPrompt languageRule. One entry per language = the only thing to add when
// onboarding a new language.
export function languageDirective(lang: LangCode): string {
  if (lang === "en") return "";
  const name = LANGUAGE_NAMES[lang]; // "Spanish", "Vietnamese", ...
  return `\nReply in ${name} (plain, natural, 6th-grade reading level). ` +
         `The app interface stays in English -- refer to pages and buttons by ` +
         `their English labels. Any resume, cover letter, or job-application ` +
         `text you produce stays in the language of the job posting (English ` +
         `unless told otherwise); only your coaching and explanation are in ${name}.`;
}
```
The last sentence is the guardrail against translating application artifacts even
inside a mixed prompt.

**4b. `resolveLanguage()` -- one call per route to get the code.**
- Authenticated surfaces: read `preferred_language` from the `users` row (the
  coach already does this via `getUserProfile`).
- Anonymous Forge: read `language` from the request body (the intake collects it,
  same way it already collects `readinessStage`).
- Mini Forge kiosk: read from the `tablet_session` (language chosen at kiosk start).

**4c. Optional `language` on `callAI` meta.** When set and not `en`, and the call
is flagged as a coaching call, append `languageDirective(lang)` to `system` before
sending. Coaching routes pass it; artifact routes (resume/cover-letter generation)
do NOT pass it, so they stay English by construction. This covers all
`callAI`-based coaching routes by threading one value, not rewriting each prompt.

**4d. The `streamText` path (t.ROY).** Append `languageDirective(lang)` to the
assembled `systemPrompt` in `app/api/assistant/route.ts`. Resolve `lang` from the
session (authed) or the request context (anon Forge). This also fixes the no-op bug.

---

## 5. Storage / migration

New migration `packages/core/migrations/0XX_preferred_language.sql`:
1. `ALTER TABLE users ADD COLUMN preferred_language TEXT NOT NULL DEFAULT 'en'`
   with `CHECK (preferred_language IN ('en','es','vi','zh','ht','ar'))`.
2. Backfill: `UPDATE users SET preferred_language = coach_language`.
3. Keep `coach_language` for now (coach reads `preferred_language` going forward;
   drop `coach_language` in a later cleanup once nothing references it).
4. Mini Forge: `ALTER TABLE tablet_session ADD COLUMN language TEXT NOT NULL
   DEFAULT 'en'` (same CHECK).

Settings API: widen `LANGUAGES` to the supported set, expose `preferredLanguage`.

---

## 6. Surface-by-surface work list

| Surface | File(s) | Change | Translate? |
|---|---|---|---|
| Coach | `packages/core/src/coachPrompt.ts` | Generalize `languageRule` to `languageDirective`, read `preferred_language` | Yes |
| t.ROY assistant | `app/api/assistant/route.ts`, `lib/assistant-prompt.ts` | Resolve lang, append directive (fixes the no-op bug) | Yes |
| Disclosure Planner | `app/api/disclosure-guide/route.ts` | Pass `language` on the coaching `callAI`; keep `legal_context` flagged for review | Yes (coaching + tips) |
| Interview Practice (text) | `app/api/interview-practice/route.ts` | Pass `language` | Yes |
| Interview Practice (voice) | `app/api/interview-voice/route.ts` | See voice caveat (Sec 8) | Deferred to 1.5 |
| Barrier explanations | `app/api/analyze/route.ts` (`analyzeBarriers`) | Pass `language` on this sub-call only | Yes |
| Forge narrative | `app/api/analyze/route.ts` (`analyzeNarrative`) | `reflection` may translate; `headline`/`summary` stay English | Mixed -- see note |
| Forge career paths / skills | `app/api/analyze/route.ts` | Stay English (resume-facing keywords) | No |
| Application Tailor / resume / cover letter | `app/api/resume-generate*`, worker `genResume`/`genCoverLetter` | No directive -- artifacts stay application-language | No |
| Mini Forge | `lib/mini-forge-ai.ts` | Add `language` to intake, append directive; `resume_starter` stays English | Yes (guidance) / No (resume_starter) |
| Settings UI | `AccessibilitySettingsSection.tsx` | Replace the Spanish boolean toggle with a language picker | n/a |
| Forge intake UI | Forge intro/preferences step | Add a language picker for anonymous users, carried in the request | n/a |
| Mini Forge kiosk UI | `(mini-forge)` flow | Add a language pick at kiosk start | n/a |

**Note on the Forge narrative:** `headline`/`summary`/`skills` are resume-facing
and stay English; `reflection` is private and readable. Because they come back in
one JSON object, Phase 1 keeps the whole `analyzeNarrative` output English for
safety and translates the clearly-safe surfaces first. Per-field translation of
`reflection` is a fast-follow (1.5), not a Phase 1 blocker.

---

## 7. Languages to launch

Adding a language after the framework exists is a one-line registry entry, so the
list is a product choice, not an engineering cost.

- **Tier 1 (launch, finish properly):** Spanish `es`.
- **Tier 2 (top US reentry / limited-English languages):** Vietnamese `vi`,
  Simplified Chinese `zh`, Haitian Creole `ht`, Arabic `ar`.
- **Tier 3 (add on demand):** Tagalog, Korean, Russian, Portuguese, French.

Arabic note: Phase 1 is AI *output* only, so Arabic text renders fine inside the
existing LTR interface. A fully RTL Arabic *interface* is Phase 2 and not required
to ship Arabic coaching.

---

## 8. Risks and gotchas

- **Application-artifact leakage (highest risk).** If a resume/cover-letter prompt
  accidentally gets the directive, a user's resume comes back in the wrong
  language. Mitigation: artifact routes never pass `language`, the directive text
  itself reasserts "resume stays in the job's language," and we add an adversarial
  test (Sec 9) that asserts artifact output stays English when the user is set to `es`.
- **Voice interview / coach voice.** TTS/STT must support the target language. Text
  practice translates trivially; voice needs the voice provider configured
  per-language. Scope voice as Phase 1.5 after confirming provider language support.
- **PDF/.docx fonts.** CJK and Arabic glyphs need embedded fonts in exports. Phase
  1 avoids this because exports are resume artifacts (English). Only bites if we
  ever export coaching content in-language -- flagged for later.
- **Legal nuance.** `disclosure legal_context` is sensitive. It is already kept
  general and points to legal aid, but translations should get a native-speaker
  spot-check before a language is promoted from beta.
- **Research context is English.** `lib/research-context.ts` stays English; the
  model still answers in the target language from English context. Minor token
  bloat, not a blocker.
- **Translation quality.** Excellent for es/pt/fr, strong for the rest. Gate the
  less-common languages behind a "beta" label until a native speaker reviews the
  high-stakes surfaces (disclosure, barriers).

---

## 9. Testing

- Unit: `languageDirective` returns the artifact-guardrail sentence for every non-en language.
- Adversarial: with a user set to `es`, assert (a) coach/disclosure/interview
  output is Spanish, and (b) resume/cover-letter output is still English. This is
  the test that protects the core rule.
- Manual QA pass per launch language on: coach, t.ROY, disclosure, interview text,
  Mini Forge. Native-speaker spot-check on disclosure + barriers.

---

## 10. Effort and sequencing

Roughly **5 to 6 developer-days** for a solid Phase 1.

1. Registry + migration + settings API (0.5d)
2. `callAI` language param + `resolveLanguage` (0.5d)
3. Thread coaching surfaces: coach, t.ROY (+bug fix), disclosure, interview text,
   barriers, Mini Forge (1.5-2d)
4. Language pickers: settings select, Forge intake, Mini Forge kiosk (1-1.5d)
5. Testing + per-language QA + native spot-check coordination (1d)

Ship Spanish first (finishes an existing half-built feature and fixes the t.ROY
bug), then enable Tier 2 by config once QA clears.

---

## 11. Explicitly NOT in Phase 1

- UI chrome translation (next-intl adoption, string extraction) -- Phase 2.
- RTL interface layout for Arabic/Hebrew -- Phase 2.
- Voice interview/coach in non-English -- Phase 1.5.
- Per-field translation of the Forge narrative `reflection` -- Phase 1.5.
- Translating exported documents -- deferred (font work).

---

## 12. Open decisions for Troy

1. Launch language set: Spanish only first, or Spanish + all of Tier 2 at once?
2. Beta-gate the less-common languages until native review, or launch all as "full"?
3. Add a language picker to the anonymous Forge, or Phase 1 authenticated-only
   (simpler, but anonymous Forge users could not pick a language until they make
   an account)?
4. Is fixing the t.ROY Spanish no-op in this phase approved (it is a real bug)?
