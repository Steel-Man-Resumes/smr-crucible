/**
 * Phase 1 multilingual -- the invariants that protect the core rule:
 * COACHING translates, application ARTIFACTS (resume/cover letter) do NOT.
 *
 * Run:  cd apps/consumer && npx tsx test/language.mts
 *
 * These are pure-unit guards. The end-to-end assertion (a user set to Spanish
 * gets Spanish coaching but an ENGLISH resume) is a preview e2e, since it needs a
 * live model call -- see the plan doc. The guardrail SENTENCE living inside the
 * directive is what this file locks down so it can never be silently dropped.
 */

import {
  languageDirective,
  normalizeLanguage,
  isSupportedLanguage,
  pickLanguage,
  languageName,
  LANGUAGES,
  SUPPORTED_LANGUAGE_CODES,
} from "@crucible/core";

let failed = 0;
function check(name: string, cond: boolean) {
  if (!cond) {
    failed++;
    console.error(`FAIL: ${name}`);
  } else {
    console.log(`ok: ${name}`);
  }
}

// English is a no-op -- no directive appended, so English callers are unchanged.
check("en directive is empty", languageDirective("en") === "");

// A non-English directive names the language and carries the artifact guardrail.
const es = languageDirective("es");
check("es directive names Spanish", es.includes("Spanish"));
check(
  "es directive keeps resumes in the application language (the core rule)",
  /do not translate/i.test(es) && /resume/i.test(es)
);
check("es directive keeps interface labels in English", /english/i.test(es));

// Every beta language also carries the guardrail (no language is exempt).
for (const l of LANGUAGES) {
  if (l.code === "en") continue;
  const d = languageDirective(l.code);
  check(`${l.code} directive has the resume guardrail`, /do not translate/i.test(d));
  check(`${l.code} directive names the language`, d.includes(languageName(l.code)));
}

// Normalization defaults unknown/garbage to English (fail-safe: never a broken code).
check("normalize unknown -> en", normalizeLanguage("klingon") === "en");
check("normalize undefined -> en", normalizeLanguage(undefined) === "en");
check("normalize es -> es", normalizeLanguage("es") === "es");
check("normalize vi -> vi", normalizeLanguage("vi") === "vi");

check("isSupportedLanguage rejects junk", !isSupportedLanguage("xx"));
check("isSupportedLanguage accepts ht", isSupportedLanguage("ht"));

// pickLanguage prefers a real non-English candidate, else English.
check("pick prefers body over stored", pickLanguage("es", "en") === "es");
check("pick falls back to en", pickLanguage(undefined, null, "en") === "en");
check("pick skips junk", pickLanguage("nope", "vi") === "vi");

// Registry sanity: en + es launched, the rest beta, codes unique.
check("en and es are launched (not beta)", LANGUAGES.filter((l) => !l.beta).map((l) => l.code).sort().join(",") === "en,es");
check("codes are unique", new Set(SUPPORTED_LANGUAGE_CODES).size === SUPPORTED_LANGUAGE_CODES.length);

if (failed) {
  console.error(`\n${failed} check(s) failed.`);
  process.exit(1);
}
console.log("\nAll language guards passed.");
