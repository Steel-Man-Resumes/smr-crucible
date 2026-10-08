/**
 * One shared test for "is this a credential?" (review round 3).
 *
 * The skills check (resumeMintCheckShared) and the credential finder
 * (credentialMentions) both read this file, so no term can be both a skill
 * to keep or cut and a credential to confirm. A credential always goes to the
 * credential prompt, never to the skills card.
 */

// Known credentials by name.
const NAMED_SOURCE = String.raw`OSHA[\s-]*\d+(?:[\s-]hour)?|(?:Class[\s-]*[A-D][\s-]+)?CDL(?:[\s-]+Class[\s-]*[A-D]|[\s-]+\(?[A-D]\)?(?![\w']))?|CNA|STNA|LPN|EMT(?:-[BP])?|ServSafe(?:\s+(?:Food\s+Handler|Manager|Food\s+Protection\s+Manager))?|EPA\s*608(?:\s+Universal)?|CPR|BLS|First\s+Aid|AWS\s+D\d+(?:\.\d+)?|HAZMAT(?:\s+endorsement)?(?!\s+(?:handling|awareness|storage|waste|spills?|materials?)\b)|TWIC(?:\s+card)?|Forklift\s+card|Food\s+handler(?:'?s)?\s+card|Six\s+Sigma(?:\s+\w+\s+Belt)?|PMP|NCCER`;

/** A fresh global regex for known credential names (global regexes keep state, so one per use). */
export function namedCredentialRe(): RegExp {
  return new RegExp(`\\b(?:${NAMED_SOURCE})\\b`, "gi");
}

/** Words that make a term a credential: a certification, a license, a card, an endorsement, a permit, a registry. */
export const CREDENTIAL_TERM_WORD_RE = /\b(?:certif\w*|licen[cs]\w*|card|endorsement|permit|registry|registered)\b/i;

/** True when a term (a skills item, a name) is a credential. */
export function isCredentialTerm(term: string): boolean {
  return namedCredentialRe().test(term) || CREDENTIAL_TERM_WORD_RE.test(term);
}
