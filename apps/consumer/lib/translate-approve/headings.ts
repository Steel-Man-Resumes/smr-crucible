/**
 * Translate and approve (lane D2, slice 1): the fixed pieces that never go to a model.
 *
 *   1. The Spanish-to-English section headings, by a table. No model, no guess:
 *      a heading that is not in the table is an ordinary line (it is translated
 *      and checked like any other).
 *   2. The contact-line rule. A line that carries the person's contact details,
 *      or the name line at the top, is copied unchanged and is never sent
 *      anywhere. A name must never be "translated", and the model does not need
 *      the person's phone, email or address.
 *
 * Pure: no imports of anything with side effects, no network, no model.
 * Internal lists here that a bilingual reader should look at are in
 * smr/spanish-2026-11-12/lane-d2-reader-list.md.
 */
import { foldAccents } from "@crucible/core/src/statusLexicon";
import { isSectionHeader } from "@crucible/core/src/pageFitShared";

export type SectionName = "summary" | "experience" | "education" | "credentials" | "skills" | "references" | "other";

export interface HeadingEntry {
  /** The English heading as the existing page code writes it (all of them are in pageFitShared SECTION_HEADERS). */
  en: string;
  section: SectionName;
}

/**
 * Folded (no accents), upper-case Spanish heading -> English heading. Every English
 * value is a heading `isSectionHeader` already knows (a test pins that), so the
 * assembled page styles and reads the same as a pasted English one.
 *
 * Left OUT on purpose: RECONOCIMIENTOS, PREMIOS, LOGROS (an awards heading is
 * itself a result claim), and OBJETIVO (goal text, not work history). Those are
 * ordinary lines: translated and checked.
 */
const TABLE: Record<string, HeadingEntry> = {
  RESUMEN: { en: "SUMMARY", section: "summary" },
  "RESUMEN PROFESIONAL": { en: "PROFESSIONAL SUMMARY", section: "summary" },
  "RESUMEN DE CARRERA": { en: "CAREER SUMMARY", section: "summary" },
  PERFIL: { en: "PROFILE", section: "summary" },
  "PERFIL PROFESIONAL": { en: "PROFESSIONAL PROFILE", section: "summary" },

  EXPERIENCIA: { en: "EXPERIENCE", section: "experience" },
  "EXPERIENCIA LABORAL": { en: "WORK EXPERIENCE", section: "experience" },
  "EXPERIENCIA PROFESIONAL": { en: "PROFESSIONAL EXPERIENCE", section: "experience" },
  "EXPERIENCIA RELEVANTE": { en: "RELEVANT EXPERIENCE", section: "experience" },
  "HISTORIAL LABORAL": { en: "WORK HISTORY", section: "experience" },
  "HISTORIAL DE TRABAJO": { en: "WORK HISTORY", section: "experience" },
  "HISTORIAL DE EMPLEO": { en: "EMPLOYMENT HISTORY", section: "experience" },
  "HISTORIAL DE EMPLEOS": { en: "EMPLOYMENT HISTORY", section: "experience" },
  "TRAYECTORIA LABORAL": { en: "WORK HISTORY", section: "experience" },
  "TRAYECTORIA PROFESIONAL": { en: "PROFESSIONAL HISTORY", section: "experience" },
  EMPLEOS: { en: "EMPLOYMENT", section: "experience" },
  "EXPERIENCIA DE VOLUNTARIADO": { en: "VOLUNTEER EXPERIENCE", section: "experience" },
  VOLUNTARIADO: { en: "VOLUNTEER", section: "experience" },
  "SERVICIO MILITAR": { en: "MILITARY SERVICE", section: "experience" },

  EDUCACION: { en: "EDUCATION", section: "education" },
  FORMACION: { en: "EDUCATION", section: "education" },
  "FORMACION ACADEMICA": { en: "EDUCATION", section: "education" },
  ESTUDIOS: { en: "EDUCATION", section: "education" },
  "EDUCACION Y CERTIFICACIONES": { en: "EDUCATION & CERTIFICATIONS", section: "education" },
  "EDUCACION Y CREDENCIALES": { en: "EDUCATION & CREDENTIALS", section: "education" },
  "EDUCACION Y CAPACITACION": { en: "EDUCATION & TRAINING", section: "education" },
  "EDUCACION Y FORMACION": { en: "EDUCATION & TRAINING", section: "education" },

  CERTIFICACIONES: { en: "CERTIFICATIONS", section: "credentials" },
  CERTIFICACION: { en: "CERTIFICATION", section: "credentials" },
  CERTIFICADOS: { en: "CERTIFICATES", section: "credentials" },
  LICENCIAS: { en: "LICENSES", section: "credentials" },
  LICENCIA: { en: "LICENSE", section: "credentials" },
  "LICENCIAS Y CERTIFICACIONES": { en: "LICENSES & CERTIFICATIONS", section: "credentials" },
  "LICENCIAS Y CERTIFICADOS": { en: "LICENSES & CERTIFICATIONS", section: "credentials" },
  "CERTIFICACIONES Y LICENCIAS": { en: "CERTIFICATIONS & LICENSES", section: "credentials" },
  "CERTIFICACIONES Y CAPACITACION": { en: "CERTIFICATIONS & TRAINING", section: "credentials" },
  CAPACITACION: { en: "TRAINING", section: "credentials" },
  ENTRENAMIENTO: { en: "TRAINING", section: "credentials" },
  CURSOS: { en: "TRAINING", section: "credentials" },
  "FORMACION COMPLEMENTARIA": { en: "TRAINING", section: "credentials" },

  HABILIDADES: { en: "SKILLS", section: "skills" },
  APTITUDES: { en: "SKILLS", section: "skills" },
  DESTREZAS: { en: "SKILLS", section: "skills" },
  "HABILIDADES CLAVE": { en: "KEY SKILLS", section: "skills" },
  "HABILIDADES TECNICAS": { en: "TECHNICAL SKILLS", section: "skills" },
  "HABILIDADES PROFESIONALES": { en: "PROFESSIONAL SKILLS", section: "skills" },
  COMPETENCIAS: { en: "COMPETENCIES", section: "skills" },
  "COMPETENCIAS CLAVE": { en: "KEY COMPETENCIES", section: "skills" },

  PROYECTOS: { en: "PROJECTS", section: "other" },
  IDIOMAS: { en: "LANGUAGES", section: "other" },
  REFERENCIAS: { en: "REFERENCES", section: "references" },
  "INFORMACION ADICIONAL": { en: "ADDITIONAL INFORMATION", section: "other" },
};

/** The English headings that are in the table (for the test that pins them against the page code). */
export const HEADING_TABLE_VALUES: readonly string[] = Array.from(new Set(Object.values(TABLE).map((e) => e.en)));
/** Every Spanish heading in the table, folded and upper-case. */
export const HEADING_TABLE_KEYS: readonly string[] = Object.keys(TABLE);

// A trailing colon, period or dash (the en and em dash are built from code points so this file holds no dash character).
const TRAILING_MARKS = new RegExp(`[:.${String.fromCharCode(0x2013)}${String.fromCharCode(0x2014)}-]+\\s*$`, "g");

function headingKey(line: string): string {
  return foldAccents(line)
    .replace(TRAILING_MARKS, "")
    .replace(/\s*&\s*/g, " y ")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

const SECTION_BY_ENGLISH: Array<[RegExp, SectionName]> = [
  [/\b(?:SUMMARY|PROFILE|OBJECTIVE)\b/, "summary"],
  [/\b(?:SKILLS|COMPETENCIES|QUALIFICATIONS|EXPERTISE)\b/, "skills"],
  [/\b(?:CERTIFICATIONS?|CERTIFICATES|LICENSES?|CREDENTIALS|TRAINING)\b/, "credentials"],
  [/\bEDUCATION\b/, "education"],
  [/\bREFERENCES\b/, "references"],
  [/\b(?:EXPERIENCE|HISTORY|EMPLOYMENT|BACKGROUND|SERVICE|VOLUNTEER)\b/, "experience"],
];

/**
 * The heading a line is, or null. A line is a heading only when it is short,
 * has no digit or pipe, and is in the fixed Spanish table, or is already an
 * English heading the page code knows (kept exactly as the person wrote it).
 */
export function headingFor(line: string): (HeadingEntry & { alreadyEnglish: boolean }) | null {
  const t = (line || "").trim();
  if (!t || t.length > 60 || /[\d|@]/.test(t)) return null;
  const hit = TABLE[headingKey(t)];
  if (hit) return { ...hit, alreadyEnglish: false };
  if (isSectionHeader(t.replace(/:$/, ""))) {
    const upper = t.replace(/:$/, "").toUpperCase();
    const section = SECTION_BY_ENGLISH.find(([re]) => re.test(upper))?.[1] ?? "other";
    return { en: t.replace(/:$/, ""), section, alreadyEnglish: true };
  }
  return null;
}

// ---- contact lines -----------------------------------------------------------------------------

const EMAIL_RE = /[^\s@]+@[^\s@]+/;
const PHONE_RE = /(?:\+?\d{1,2}[\s.-]?)?\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}\b/;
const URL_RE = /\b(?:https?:\/\/|www\.)\S+|\b(?:linkedin|facebook|instagram)\.com\S*/i;
const STATE_ZIP_RE = /\b[A-Z]{2}\s+\d{5}(?:-\d{4})?\b/;
/** Particles that sit inside a name ("María de la Cruz", "Juan de Dios"). */
const NAME_PARTICLES = new Set(["de", "del", "la", "las", "los", "y", "e", "van", "von", "da", "di", "mc", "st"]);

/** True when a line holds an email, a phone number or a link: copied unchanged, never sent, anywhere in the resume. */
export function carriesContactDetails(line: string): boolean {
  const t = line || "";
  return EMAIL_RE.test(t) || PHONE_RE.test(t) || URL_RE.test(t);
}

/**
 * True when a line looks like the name line at the very top: at most five
 * words, every word capitalized (or a name particle), no digit, no pipe, no
 * sentence punctuation. Only ever asked about the first non-empty line, before
 * any heading.
 */
export function looksLikeNameLine(line: string): boolean {
  const t = (line || "").trim();
  if (!t || /[\d|@:;!?]/.test(t) || /[.,]$/.test(t)) return false;
  const words = t.split(/\s+/);
  if (words.length > 5) return false;
  return words.every((w) => NAME_PARTICLES.has(w.toLowerCase()) || /^[\p{Lu}][\p{L}'’.-]*$/u.test(w));
}

/**
 * The contact-line rule. `beforeFirstHeading` and `firstLine` come from the caller's
 * walk down the text. A contact line is copied as written and is never a unit.
 */
export function isContactLine(line: string, ctx: { beforeFirstHeading: boolean; firstLine: boolean }): boolean {
  if (carriesContactDetails(line)) return true;
  if (!ctx.beforeFirstHeading) return false;
  if (STATE_ZIP_RE.test(line)) return true;
  return ctx.firstLine && looksLikeNameLine(line);
}
