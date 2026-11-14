/**
 * Spanish words for a record, custody, court or supervision (Spanish first).
 *
 * The record gates (staff t.ROY's withholding, the resume record-line guard,
 * the justice filter, the facility hint, the record choice, page fit) used to
 * read English only, so a Spanish sentence about a record went through
 * unseen. One list here, read by all of them, so a new word is added once.
 *
 * Every alternative starts and ends on a plain ASCII letter, so \b is safe
 * (JavaScript's \b treats an accented letter as a non-letter). Accents are
 * matched with explicit classes, and the unaccented spelling matches too.
 * Over-matching is safe where a gate only asks or withholds a sentence, but the resume
 * record-line guard DELETES a line, so ambiguous words stay out: "detenida" (stopped),
 * "presa" (a dam) and "medio camino" (halfway) are not here on their own.
 */

/** A record, custody, court or supervision word, as a regex alternation (no flags, no \b). */
export const ES_RECORD_SOURCE = String.raw`c[aá]rcel(?:es)?|prisi[oó]n(?:es)?|presos?|presidio|penitenciar[ií][ao]s?|correccional(?:es)?|centros?\s+de\s+(?:detenci[oó]n|reclusi[oó]n|readaptaci[oó]n)|reclusorios?|reclusi[oó]n|reclus[oa]s?|recluid[oa]s?|encarcelad[oa]s?|encarcelamiento|encarcel(?:ar|aron|aba|aban)|libertad\s+(?:condicional|vigilada|supervisada|bajo\s+palabra|bajo\s+fianza)|condenas?|condenad[oa]s?|sentencias?|sentenciad[oa]s?|convict[oa]s?|antecedentes\s+(?:penales|criminales|policiales|judiciales)|delitos?(?:\s+grave)?|arrestad[oa]s?|arrest(?:ar|aron|aban|aba)|condenaron|condenar|sentenciaron|arresto\s+domiciliario|me\s+detuvieron|fui\s+detenid[oa]|detenci[oó]n|(?:tobillera|brazalete|monitoreo)\s+electr[oó]nic[oa]|reinserci[oó]n|reformatorio|casa\s+de\s+(?:transici[oó]n|medio\s+camino)`;

/** A place of confinement, as a regex alternation: for the facility hint and the record choice. */
export const ES_FACILITY_SOURCE = String.raw`c[aá]rcel(?:es)?|prisi[oó]n(?:es)?|presidio|penitenciar[ií][ao]s?|correccional(?:es)?|centros?\s+de\s+(?:detenci[oó]n|reclusi[oó]n|readaptaci[oó]n)|reclusorios?|reformatorio|casa\s+de\s+transici[oó]n`;

const RECORD_RE = new RegExp(String.raw`\b(?:${ES_RECORD_SOURCE})\b`, "i");
const FACILITY_RE = new RegExp(String.raw`\b(?:${ES_FACILITY_SOURCE})\b`, "i");

/** True when the text carries a Spanish record, custody, court or supervision word. */
export function hasSpanishRecordWords(text: string | null | undefined): boolean {
  return typeof text === "string" && RECORD_RE.test(text);
}

/** True when the text names a Spanish place of confinement. */
export function hasSpanishFacilityWords(text: string | null | undefined): boolean {
  return typeof text === "string" && FACILITY_RE.test(text);
}
