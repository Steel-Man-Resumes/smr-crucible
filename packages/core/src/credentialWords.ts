/**
 * One shared test for "is this a credential?" (review round 3).
 *
 * The skills check (resumeMintCheckShared) and the credential finder
 * (credentialMentions) both read this file, so no term can be both a skill
 * to keep or cut and a credential to confirm. A credential always goes to the
 * credential prompt, never to the skills card.
 *
 * Round 6: wider recall. Credential-implying titles (journeyman, master
 * plumber, notary, paramedic, "Class A driver"), certifying bodies (ASE,
 * CompTIA, NCCCO, NATE, EPA) and the short licensure initials (RN, LPN, MA,
 * PE) are credentials too. A miss here is a credential no one is asked
 * about, so the list leans toward asking.
 */

const TRADES = String.raw`electrician|plumber|carpenter|mechanic|technician|welder|hvac|barber|cosmetologist|pipefitter|lineman|linemen|steamfitter|sprinkler\s+fitter|millwright|boilermaker|ironworker|elevator\s+mechanic|gasfitter`;

// Known credentials by name (any case).
const NAMED_SOURCE = String.raw`OSHA[\s-]*\d+(?:[\s-]hour)?|(?:Class[\s-]*[A-D][\s-]+)?CDL(?:[\s-]+Class[\s-]*[A-D]|[\s-]*\(?[A-D]\)?(?![\w']))?|CNA|STNA|LPN|LVN|EMT(?:-[BP])?|Paramedic|ServSafe(?:\s+(?:Food\s+Handler|Manager|Food\s+Protection\s+Manager))?|EPA(?:\s*(?:Section\s+)?608(?:\s+Universal)?)?|CPR|BLS|ACLS|PALS|First\s+Aid|AWS\s+D\d+(?:\.\d+)?|HAZMAT(?:\s+endorsement)?(?!\s+(?:handling|awareness|storage|waste|spills?|materials?)\b)|TWIC(?:\s+card)?|Forklift\s+card|Food\s+handler(?:'?s)?\s+card|Six\s+Sigma(?:\s+\w+\s+Belt)?|PMP|NCCER|NCCCO(?:\s+[A-Za-z]+)?|NATE|CompTIA(?:\s+[A-Za-z]+\+?)?|ASE(?:\s+(?:Master\s+)?(?:Technician|Mechanic|Certified))?|Journeyman(?:\s+(?:${TRADES}))?|Master\s+(?:${TRADES})|Apprentice\s+(?:license|licence|card|${TRADES})|Notary(?:\s+Public)?|Class[\s-]*[A-D]\s+(?:driver|driving|license|licence)|(?:State[\s-])?Credentialed(?:\s+[A-Za-z]+)?|Accredited(?:\s+[A-Za-z]+){0,2}|Bonded`;

/** A fresh global regex for known credential names (global regexes keep state, so one per use). */
export function namedCredentialRe(): RegExp {
  return new RegExp(`\\b(?:${NAMED_SOURCE})(?![\\w])`, "gi");
}

// Licensure initials, read only in capitals so "ma" or "pe" in a sentence is never one.
const STRONG_INITIALS = String.raw`RN|LVN|LPN|CMA|CCMA|RMA|CNA|STNA|HHA|PCT|CPhT|EMT|ASE|NATE|NCCCO|ACLS|PALS|CDL|CPR|BLS|TWIC|PMP|CPC|CMT`;
// Two-letter initials (RN, MA, PE): only as a whole list item, never inside a sentence ("Boston, MA").
const SHORT_INITIALS = String.raw`RN|MA|PE|PA|NP|LP`;

/** Licensure initials in capitals, anywhere. */
export function credentialInitialsRe(): RegExp {
  return new RegExp(`\\b(?:${STRONG_INITIALS})\\b`, "g");
}

/** True when a whole list item is a two-letter licensure initial ("RN", "MA", "PE"). */
export function isShortInitialTerm(term: string): boolean {
  return new RegExp(`^(?:${SHORT_INITIALS})$`).test(term.trim());
}

/** Words that make a term a credential: a certification, a license, a card, an endorsement, a permit, a registry, a bond. */
export const CREDENTIAL_TERM_WORD_RE = /\b(?:certif\w*|licen[cs]\w*|card|endorsement|permit|registry|registered|journeyman|notary|bonded|accredited|credentialed)\b/i;

/** True when a term (a skills item, a name) is a credential. */
export function isCredentialTerm(term: string): boolean {
  return namedCredentialRe().test(term) || CREDENTIAL_TERM_WORD_RE.test(term) || credentialInitialsRe().test(term) || isShortInitialTerm(term);
}
