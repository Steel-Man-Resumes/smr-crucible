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
 */

const WORK = [
  // warehouse, logistics, manufacturing
  "RF", "PPE", "FIFO", "FEFO", "LIFO", "WMS", "SKU", "SKUS", "LTL", "FTL", "DC", "UPS", "USPS", "FEDEX", "QA", "QC", "KPI", "KPIS", "SOP", "SOPS",
  "LOTO", "HVAC", "CNC", "PLC", "MIG", "TIG", "OTR", "DOT", "ERP", "MRP", "ISO", "GMP", "JIT", "BOL", "ASN", "RMA", "EDI", "TMS", "OSHA",
  // food service, retail
  "POS", "BOH", "FOH", "HACCP", "VIP", "GM", "AGM",
  // office, IT
  "MS", "CRM", "IT", "PC", "PCS", "PDF", "PDFS", "HR", "AP", "AR", "CEO", "CFO", "COO", "ID", "IDS", "FAQ", "LLC", "INC", "ASAP", "TV", "OK", "USB",
  // health care settings (the setting, not the licence)
  "EHR", "EMR", "HIPAA", "ADL", "ADLS", "ICU", "ER", "PRN", "AED", "OR", "ED",
  // education (asked about elsewhere), community
  "GED", "HSE", "ESL", "YMCA", "YWCA",
  // time, places
  "AM", "PM", "US", "USA", "UK", "NYC", "LA", "DC", "II", "III", "IV",
];

// Two-letter US state and territory codes ("Toledo, OH").
const STATES = [
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA", "HI", "ID", "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD", "MA", "MI", "MN",
  "MS", "MO", "MT", "NE", "NV", "NH", "NJ", "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI", "SC", "SD", "TN", "TX", "UT", "VT", "VA",
  "WA", "WV", "WI", "WY", "PR", "GU", "VI",
];

const SKIP = new Set([...WORK, ...STATES]);

/** True when an all-caps word is ordinary work vocabulary or a place code, never asked about as a credential. */
export function isWorkAcronym(token: string): boolean {
  return SKIP.has(token.toUpperCase());
}
