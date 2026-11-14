/**
 * Credential status words in other languages (Spanish first), read once here
 * so every gate sees the same thing.
 *
 * The documents stay English this pass, so a status a person types in Spanish
 * ("vigente", "vencida", "en curso") is turned into its English status words
 * at the two doors it passes through: the check that accepts it
 * (credentialStatus.isStrictCredentialWhen) and the line that writes it on the
 * page (credentialMentions.credentialLineText). Everything downstream then sees
 * the English words it already understands.
 *
 * Only words that mean a status are translated. Anything else stays as typed
 * and is refused by the same whitelist as before ("nunca", "no sé"), so this
 * can only accept more real statuses, never let a non-answer through.
 * Text with no Spanish status word comes back unchanged, case and all.
 */

/** Lower case, accents off, so "está" and "año" match plain ASCII rules. */
export function foldAccents(s: string): string {
  return (s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}

// Words that say something about a status, a month or a season. Order matters: phrases before single words.
const ES_CONTENT_RULES: Array<[RegExp, string]> = [
  [/\ben (?:curso|proceso|progreso)\b/g, "in progress"],
  [/\b(?:completad[oa]s?|terminad[oa]s?|finalizad[oa]s?)\b/g, "completed"],
  [/\b(?:vencid[oa]s?|caducad[oa]s?|expirad[oa]s?)\b/g, "expired"],
  [/\b(?:vence|vencera|caduca|expira|expirara|vencimiento)\b/g, "expires"],
  [/\bsuspendid[oa]s?\b/g, "suspended"],
  [/\brevocad[oa]s?\b/g, "revoked"],
  [/\binactiv[oa]s?\b/g, "inactive"],
  [/\b(?:vigentes?|actual|actualmente)\b/g, "current"],
  [/\bactiv[oa]s?\b/g, "active"],
  [/\bvalid[oa]s?\b/g, "valid"],
  [/\brenovad[oa]s?\b/g, "renewed"],
  [/\bhasta\b/g, "until"],
  [/\bdesde\b/g, "since"],
  [/\benero\b/g, "january"], [/\bfebrero\b/g, "february"], [/\bmarzo\b/g, "march"], [/\babril\b/g, "april"],
  [/\bmayo\b/g, "may"], [/\bjunio\b/g, "june"], [/\bjulio\b/g, "july"], [/\bagosto\b/g, "august"],
  [/\b(?:septiembre|setiembre)\b/g, "september"], [/\boctubre\b/g, "october"],
  [/\bnoviembre\b/g, "november"], [/\bdiciembre\b/g, "december"],
  [/\bprimavera\b/g, "spring"], [/\bverano\b/g, "summer"], [/\botono\b/g, "fall"], [/\binvierno\b/g, "winter"],
  [/\bano\b/g, "year"],
  [/\b(?:obtuve|consegui|gane)\b/g, "got"],
  [/\b(?:todavia|aun)\b/g, "still"],
];

// Small words, translated only when a content word above is also there, so "y" or "de" alone is never "Spanish".
const ES_FUNCTION_RULES: Array<[RegExp, string]> = [
  [/\b(?:es|esta)\b/g, "is"],
  [/\b(?:el|la|los|las)\b/g, "the"],
  [/\b(?:de|del)\b/g, "of"],
  [/\by\b/g, "and"],
  [/\ben\b/g, "in"],
];

/**
 * The status text with any Spanish status words in English. Unchanged (same
 * string, same case) when it holds none.
 */
export function statusToEnglish(text: string): string {
  const original = text || "";
  let t = foldAccents(original);
  // "2019 a 2021" is a range.
  t = t.replace(/\b((?:19|20)\d{2})\s+a\s+((?:19|20)\d{2})\b/g, "$1 to $2");
  let spanish = false;
  for (const [re, to] of ES_CONTENT_RULES) {
    const next = t.replace(re, to);
    if (next !== t) spanish = true;
    t = next;
  }
  if (!spanish) return original;
  for (const [re, to] of ES_FUNCTION_RULES) t = t.replace(re, to);
  return t.replace(/\s+/g, " ").trim();
}

/**
 * Spanish words that say a credential is not current, for gates that read a
 * person's free text (ASCII only, so \b works). Add to an English alternation.
 */
export const ES_NOT_CURRENT_SOURCE = String.raw`vencid[oa]s?|caducad[oa]s?|expirad[oa]s?|suspendid[oa]s?|revocad[oa]s?|inactiv[oa]s?|no (?:est[aá] )?vigente`;

/** Spanish status words that must not sit in a credential's NAME box (they belong in the status box). */
export const ES_NAME_STATUS_SOURCE = String.raw`vigentes?|vencid[oa]s?|caducad[oa]s?|expirad[oa]s?|suspendid[oa]s?|revocad[oa]s?|inactiv[oa]s?|en curso|en proceso`;
