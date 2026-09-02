/**
 * Language registry -- single source of truth for multilingual AI output.
 *
 * Phase 1 (2026-09) makes AI COACHING output honor a user's language. It does
 * NOT translate the app interface (chrome stays English) and it NEVER translates
 * application artifacts (a resume/cover letter stays in the job's language). See
 * docs/I18N-PHASE1-MULTILANG-PLAN-2026-09-02.md.
 *
 * Adding a language = add one entry to LANGUAGES below and widen the CHECK
 * constraint in the preferred_language migration. Everything else reads from here.
 */

export type LangCode = "en" | "es" | "vi" | "zh" | "ht" | "ar";

export interface LanguageDef {
  code: LangCode;
  /** English name, used inside the AI directive ("Reply in Spanish"). */
  name: string;
  /** Endonym shown in the picker so a speaker recognizes their own language. */
  native: string;
  /**
   * false = fully launched. true = available but pending native-speaker review
   * of the high-stakes surfaces (disclosure, barriers); the picker labels it.
   */
  beta: boolean;
}

/**
 * The supported set. `en` and `es` are launched; the rest are beta until a
 * native speaker reviews disclosure + barrier output for that language.
 */
export const LANGUAGES: LanguageDef[] = [
  { code: "en", name: "English", native: "English", beta: false },
  { code: "es", name: "Spanish", native: "Espanol", beta: false },
  { code: "vi", name: "Vietnamese", native: "Tieng Viet", beta: true },
  { code: "zh", name: "Simplified Chinese", native: "简体中文", beta: true },
  { code: "ht", name: "Haitian Creole", native: "Kreyol Ayisyen", beta: true },
  { code: "ar", name: "Arabic", native: "العربية", beta: true },
];

export const SUPPORTED_LANGUAGE_CODES: LangCode[] = LANGUAGES.map((l) => l.code);

const BY_CODE = new Map<string, LanguageDef>(LANGUAGES.map((l) => [l.code, l]));

export function isSupportedLanguage(value: unknown): value is LangCode {
  return typeof value === "string" && BY_CODE.has(value);
}

/** Coerce any value to a supported code, defaulting to English. */
export function normalizeLanguage(value: unknown): LangCode {
  return isSupportedLanguage(value) ? value : "en";
}

/** First supported, non-English candidate wins; otherwise English. Handy for
 *  "prefer the request body, fall back to the stored preference" resolution. */
export function pickLanguage(...candidates: unknown[]): LangCode {
  for (const c of candidates) {
    if (isSupportedLanguage(c) && c !== "en") return c;
  }
  return "en";
}

export function languageName(code: LangCode): string {
  return BY_CODE.get(code)?.name ?? "English";
}

/**
 * The directive appended to a COACHING system prompt so the model replies in the
 * user's language. Returns "" for English (no-op). The final sentence is the
 * guardrail that keeps resumes and cover letters in the application's language
 * even when this directive rides along on a mixed prompt -- do not remove it.
 */
export function languageDirective(code: LangCode): string {
  if (code === "en") return "";
  const name = languageName(code);
  return (
    `\n\nLANGUAGE: Reply in ${name}. Use plain, natural ${name} at a 6th-grade ` +
    `reading level -- not a stiff, literal translation. Keep proper nouns, tool ` +
    `names, page and button labels in English (the app interface is English; ` +
    `refer to controls by their English labels). Do NOT translate any resume, ` +
    `cover letter, or job-application text you produce: that stays in the ` +
    `language of the job posting (English unless stated otherwise). Only your ` +
    `coaching, explanation, and conversation are in ${name}.`
  );
}
