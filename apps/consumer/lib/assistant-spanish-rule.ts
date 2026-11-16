/**
 * The Spanish-language part of the t.ROY system prompt for a participant (app/api/assistant/route.ts).
 *
 * Only a person whose site language or coach language is Spanish ever gets this text; every other prompt is
 * the English prompt untouched. It is the model's instruction for HOW to write Spanish, so it also fixes the
 * words a Spanish answer must use (signed-in walk 2026-11-15, F19 and F20):
 *   - screens and tools are named the way the Spanish screen names them, from the same catalog the screens
 *     read (a name the screen shows as "Adaptador de solicitudes" is never "Application Tailor" or a made-up
 *     "Adaptador de postulaciones");
 *   - "currículum", never the English "resume", in a Spanish sentence;
 *   - "antecedentes penales" for a record, never "antecedentes" alone (the termbase locks it);
 *   - "cupo de IA" for the AI allowance, never "cuota".
 * Machine-written; a bilingual reader has not reviewed these words.
 */
import { MESSAGES } from "@/messages";

type Tree = { [key: string]: string | Tree };

function pick(locale: "en" | "es", path: string): string | null {
  const node = path.split(".").reduce<unknown>((n, k) => (n && typeof n === "object" ? (n as Tree)[k] : undefined), MESSAGES[locale].refineryShell as unknown as Tree);
  return typeof node === "string" && node.trim() ? node.trim() : null;
}

/** Catalog paths (refineryShell) of the screens and tools t.ROY names in an answer. */
export const NAMED_SCREEN_PATHS = [
  "access.tools.jobBoard.name",
  "access.tools.applicationTailor.name",
  "access.tools.disclosurePlanner.name",
  "access.tools.interviewPrep.name",
  "access.tools.jobPaths.name",
  "access.tools.applicationTracker.name",
  "nav.labels.master_draft",
  "nav.labels.tailor_for_a_job",
  "nav.labels.plan_what_to_say",
  "nav.labels.find_work",
  "nav.labels.apply_and_track",
  "nav.labels.vault",
  "nav.labels.local_help",
  "nav.labels.progress",
  "nav.labels.settings",
] as const;

/** The English name and the Spanish name a Spanish screen shows, for every path both catalogs have. */
export function spanishScreenNames(): Array<{ en: string; es: string }> {
  const out: Array<{ en: string; es: string }> = [];
  const seen = new Set<string>();
  for (const path of NAMED_SCREEN_PATHS) {
    const en = pick("en", path);
    const es = pick("es", path);
    if (!en || !es || en === es || seen.has(en)) continue;
    seen.add(en);
    out.push({ en, es });
  }
  return out;
}

/** The existing instruction, word for word (before the 2026-11-15 additions). */
function baseRule(siteLocale: string | null | undefined): string {
  return `LANGUAGE: Reply in Spanish (plain, Latin American neutral, "tú"). ${siteLocale === "es" ? "The person sees the app in Spanish where a screen is translated and in English elsewhere: name pages and buttons the way they appear on the person's screen, and give the English label in parentheses when a screen is still English." : "The app interface is in English, so refer to pages and buttons by their English labels."} Any resume or cover letter text stays in the language of the job posting (English unless stated otherwise); only your coaching and conversation are in Spanish. If the person writes their work history in Spanish and asks, help them say it in plain English, keeping every fact exactly as they gave it and adding nothing.`;
}

const WORD_RULES = ` Word rules for your Spanish: write "currículum" for a resume, never the English word "resume" and never "resumen" for it. Say "antecedentes penales" for a criminal record, never "antecedentes" alone (that reads as work background); say it plainly and never call the person by it. Say "cupo de IA" for the AI allowance, never "cuota". Keep The Forge, The Refinery and t.ROY in English.`;

/** The Spanish LANGUAGE block for a participant. */
export function participantSpanishRule(siteLocale: string | null | undefined): string {
  let rule = baseRule(siteLocale) + WORD_RULES;
  if (siteLocale === "es") {
    const names = spanishScreenNames();
    if (names.length) {
      rule += ` The Spanish screens name these tools and pages as follows, so say the Spanish name: ${names.map((n) => `"${n.en}" is "${n.es}"`).join("; ")}. A screen not listed here keeps the name you see on the person's screen; never invent a Spanish name for it.`;
    }
  }
  return rule;
}
