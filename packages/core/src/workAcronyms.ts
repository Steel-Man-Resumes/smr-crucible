/**
 * Capital-letter words that are ordinary work vocabulary, not credentials
 * (review round 7, S3).
 *
 * The credential backstop asks "Do you hold X?" about any all-caps token on
 * the page that is nowhere in the person's words. These are skipped: tools,
 * methods, places, departments and systems a resume names every day. A
 * credential is never on this list; known credentials (CDL, CNA, OSHA 10,
 * ServSafe...) are found by name in credentialWords and asked about there.
 *
 * One list, so the skip is the same on the resume, the skills list and the
 * cover letter. Add to it when a common work term turns up as a pointless
 * "Do you hold ...?" prompt.
 *
 * Round 8: a listed word next to a holding or training word ("RF
 * certified", "LOTO authorized") is asked about anyway. OSHA, HACCP, GED,
 * HSE, MA and PA are not on the list: they are claims more often than not.
 * "Boston, MA" (a state after a city) is skipped where it is read.
 */

const WORK = [
  // warehouse, logistics, manufacturing
  "RF", "PPE", "FIFO", "FEFO", "LIFO", "WMS", "SKU", "SKUS", "LTL", "FTL", "DC", "UPS", "USPS", "FEDEX", "QA", "QC", "KPI", "KPIS", "SOP", "SOPS",
  "LOTO", "HVAC", "CNC", "PLC", "MIG", "TIG", "OTR", "DOT", "ERP", "MRP", "ISO", "GMP", "JIT", "BOL", "ASN", "RMA", "EDI", "TMS",
  // food service, retail
  "POS", "BOH", "FOH", "VIP", "GM", "AGM",
  // office, IT
  "MS", "CRM", "IT", "PC", "PCS", "PDF", "PDFS", "HR", "AP", "AR", "CEO", "CFO", "COO", "ID", "IDS", "FAQ", "LLC", "INC", "ASAP", "TV", "OK", "USB",
  // health care settings (the setting, not the licence)
  "EHR", "EMR", "HIPAA", "ADL", "ADLS", "ICU", "ER", "PRN", "AED", "OR", "ED",
  // community and classes (a GED, HSE or HiSET is a credential, asked about like one)
  "ESL", "YMCA", "YWCA",
  // time, places
  "AM", "PM", "US", "USA", "UK", "NYC", "LA", "DC", "II", "III", "IV",
];

// Two-letter US state and territory codes ("Toledo, OH").
const STATES = [
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA", "HI", "ID", "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD", "MI", "MN",
  "MS", "MO", "MT", "NE", "NV", "NH", "NJ", "NM", "NY", "NC", "ND", "OH", "OK", "OR", "RI", "SC", "SD", "TN", "TX", "UT", "VT", "VA",
  "WA", "WV", "WI", "WY", "PR", "GU", "VI",
];

const SKIP = new Set([...WORK, ...STATES]);

// Round 9: words a training word next to them does not make a claim ("Used an AED in training drills",
// "Completed ESL classes"). Only a holding word does ("AED certified", "ESL certificate").
const HOLDING_ONLY = new Set(["AED", "ESL"]);

/** True when only a holding word (certified, card, license...), never a training word, makes this listed word a claim. */
export function needsHoldingWord(token: string): boolean {
  return HOLDING_ONLY.has(token.toUpperCase());
}

/** True when an all-caps word is ordinary work vocabulary or a place code, never asked about as a credential. */
export function isWorkAcronym(token: string): boolean {
  return SKIP.has(token.toUpperCase());
}
