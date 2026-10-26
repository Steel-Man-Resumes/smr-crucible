/**
 * The record-word gate for staff t.ROY (house build L6, review H1).
 *
 * THE GAP THIS CLOSES. Case-note bodies, task titles and ask reasons are
 * written by staff, in free text, and staff sometimes write record and
 * supervision details into them ("PO visit Tuesday", "court date for the
 * theft case"). Until this file, those words went to the model inside
 * read_participant_overview and read_recent_changes. The participant side has
 * had a consent gate on record words since #118.
 *
 * THE SAME RULE AS THE PARTICIPANT SIDE (lib/assistant-full-context.ts,
 * lib/disclosure-context.ts): record words reach a model only while the
 * person's own record_planner yes (migration 095) is current AND nobody is
 * acting for them (`consent && !actingFor`). A staff session is always
 * somebody other than the person, and that yes covers the person's own
 * planner answers at their own keyboard, never what staff wrote about them.
 * So on the staff side the gate is closed: staffRecordConsent() is false, and
 * any text that carries a record word is replaced whole by RECORD_WITHHELD.
 * Whole, not word by word: the sentence around a record word usually says the
 * rest ("for the theft case").
 *
 * WHAT COUNTS. Three detectors, any one is enough:
 *   1. the planner's own forbidden set (recordAndSensitiveText, lib/hurdles),
 *      limited to its lines that name a record, supervision, a pending case
 *      or time inside (its generic lines like "In an interview" would hide
 *      ordinary notes and reveal nothing);
 *   2. record, custody and supervision words (offense, conviction, parole,
 *      probation, jail, warrant, court date, ...);
 *   3. record identifiers: a DOC, case, docket or booking number, "DOC" and
 *      "PO" as abbreviations.
 * A false positive costs the staff member one click to open the note on
 * screen. A false negative sends a person's record to a model. The lists lean
 * toward the first.
 *
 * CUSTOM FIELDS (lane L4, migration 104). A field marked sensitive is never
 * sent, and a field whose key or label names a record or health subject is
 * treated as sensitive even when it is not marked. Every other value still
 * passes the record-word gate.
 */
import { recordAndSensitiveText } from "./hurdles/plan";

/** What the model sees in place of withheld text. Plain, and tells the staff member where the words are. */
export const RECORD_WITHHELD = "[record detail withheld; open it on screen to read it]";

/** Said in every result that withheld something. */
export const WITHHELD_NOTE = "Some staff-written text was withheld because it mentions a record, a court matter or supervision. Do not guess what it said. Tell the staff member it is on screen if it matters.";

/**
 * The staff side's answer to the record gate (header). Always false: the
 * participant's record_planner yes never covers staff-written text, and a
 * staff session is never the person themselves.
 */
export function staffRecordConsent(): boolean {
  return false;
}

const RECORD_WORDS = new RegExp(
  "\\b(?:" + [
    "prisons?", "jails?", "jailed", "incarcerat\\w*", "imprison\\w*", "correctional", "penitentiar(?:y|ies)",
    "inmates?", "detained", "detention", "lock-?ups?", "locked up", "behind bars", "did time", "doing time", "served time", "time inside",
    "probation\\w*", "parole\\w*", "supervised release", "house arrest", "ankle (?:monitor|bracelet)", "electronic monitoring",
    "halfway house", "work release", "on supervision", "under supervision",
    "release date", "released (?:from|in|on|last)", "(?:his|her|their) release", "got out (?:of|in|on|last)", "since (?:he|she|they) got out",
    "supervision (?:officer|agent|terms|conditions|visits?|meetings?|appointments?|check-?ins?)",
    "conditions of (?:release|supervision|probation|parole|bond)",
    "convict\\w*", "felon\\w*", "felonies", "misdemeanou?rs?", "offen[cs]es?", "offenders?", "arrest\\w*", "warrants?",
    "indict\\w*", "charged with", "criminal", "pleaded guilty", "pled guilty", "plea (?:deal|bargain|agreement)", "no contest",
    "sentenc(?:ed|ing)", "(?:his|her|their) sentence", "served a sentence", "court[- ]ordered", "court (?:date|case|hearing|appearance|fees?|fines?)",
    "courthouse", "docket", "pending case", "expunge\\w*", "pardon\\w*", "sex offender", "(?:sex offender |offender )?registry",
    "revocation", "custody", "bail", "bond hearing", "DUI", "DWI", "OWI",
  ].join("|") + ")\\b",
  "i"
);
// Case-sensitive on purpose: "doc" is a document and "po" is not a word.
const RECORD_ABBREVIATIONS = /\b(?:DOC|D\.O\.C\.?|P\.O\.)(?=\W|$)|\b(?:my|his|her|their|the|a|with|to|see|saw|call|called)\s+PO\b(?!\s*[Bb]ox)/;
const RECORD_NUMBERS = /\b(?:case|docket|booking|inmate|offender|cause)\s*(?:#|no\.?|num(?:ber)?)\s*:?\s*[A-Za-z0-9][A-Za-z0-9-]{2,}/i;

let plannerLines: string[] | null = null;
/** The planner's forbidden lines that name a record subject (header, detector 1). Lower case. */
function plannerRecordLines(): string[] {
  if (!plannerLines) {
    plannerLines = recordAndSensitiveText()
      .map((t) => t.trim().toLowerCase().replace(/[.]+$/, ""))
      .filter((t) => t.length >= 6 && (RECORD_WORDS.test(t) || /\b(?:record|supervision|pending case|time inside|conditions)\b/.test(t)));
  }
  return plannerLines;
}

/** True when the text carries a record, court, custody or supervision word or identifier. */
export function hasStaffRecordWords(text: string | null | undefined): boolean {
  const t = String(text ?? "");
  if (!t.trim()) return false;
  if (RECORD_WORDS.test(t) || RECORD_ABBREVIATIONS.test(t) || RECORD_NUMBERS.test(t)) return true;
  const low = t.toLowerCase();
  return plannerRecordLines().some((line) => low.includes(line));
}

/**
 * The gate itself. Text without record words passes unchanged. Text with them
 * passes only while recordConsent is true (never, on the staff side); else it
 * becomes RECORD_WITHHELD, whole.
 */
export function withholdRecordText(text: string, opts: { recordConsent: boolean }): string;
export function withholdRecordText(text: string | null, opts: { recordConsent: boolean }): string | null;
export function withholdRecordText(text: string | null, opts: { recordConsent: boolean }): string | null {
  if (text === null || text === undefined) return text;
  if (opts.recordConsent || !hasStaffRecordWords(text)) return text;
  return RECORD_WITHHELD;
}

/** The staff gate, with the consent answer filled in. Counts what it withheld. */
export function staffTextGate() {
  let withheld = 0;
  const consent = staffRecordConsent();
  return {
    pass<T extends string | null>(text: T): T {
      const out = withholdRecordText(text, { recordConsent: consent });
      if (out !== text) withheld++;
      return out as T;
    },
    get withheld() { return withheld; },
  };
}

/* ------------------------------------------------------ custom fields -- */

/** The shape of a custom field definition t.ROY may be offered (lane L4, migration 104). */
export interface CustomFieldDefLike { key: string; label: string; type?: string | null; sensitive?: boolean | null; retired_at?: string | null }

// Subjects that make a field sensitive whatever its flag says: record, court,
// supervision, health, substance use, immigration, identity numbers.
const SENSITIVE_FIELD_SUBJECT = /\b(?:offen[cs]e|charge|conviction|record|criminal|felony|misdemeanou?r|court|case|docket|doc|inmate|parole|probation|supervision|po|release|custody|warrant|registry|diagnos\w*|medical|health|mental|medication|disabilit\w*|substance|recovery|treatment|drug|alcohol|immigration|ssn|social security|dob|birth)\b/i;

/**
 * Lane L4 owns `isSensitiveField`. Until its module is on main this is the
 * guard: unmarked (null) counts as sensitive, a marked field is sensitive, and
 * so is any field whose key or label names a sensitive subject. The boss may
 * point this at L4's helper after merge; the stricter of the two must win.
 */
export function isSensitiveFieldDef(def: CustomFieldDefLike): boolean {
  if (def.sensitive !== false) return true;
  const words = `${def.key} ${def.label}`.replace(/[_-]+/g, " ");
  return SENSITIVE_FIELD_SUBJECT.test(words);
}

/** Render a stored custom field value as short plain text. Null when there is nothing to show. */
function fieldText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value.trim() ? value.trim().slice(0, 200) : null;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) { const parts = value.map(fieldText).filter(Boolean); return parts.length ? parts.join(", ").slice(0, 200) : null; }
  if (typeof value === "object" && value && "value" in (value as Record<string, unknown>)) return fieldText((value as { value: unknown }).value);
  return null;
}

/**
 * What t.ROY may see of a person's custom fields: never a retired or
 * sensitive field, never a staff-member id (it names a colleague by id), and
 * every value through the record gate.
 */
export function safeCustomFields(rows: { def: CustomFieldDefLike; value: unknown }[], gate = staffTextGate()): { label: string; value: string }[] {
  const out: { label: string; value: string }[] = [];
  for (const { def, value } of rows) {
    if (def.retired_at || isSensitiveFieldDef(def) || def.type === "staff_member") continue;
    const text = fieldText(value);
    if (text === null) continue;
    out.push({ label: String(def.label).slice(0, 80), value: gate.pass(text) });
  }
  return out.slice(0, 20);
}

/**
 * The input summary a skill run is logged with (ai_skill_run.input_summary):
 * the staff member's words with record text withheld, one line, 200
 * characters at most. Never a note body.
 */
export function skillRunInputSummary(skillLabel: string, userText: string | null | undefined): string {
  const said = String(userText ?? "").replace(/\s+/g, " ").trim();
  const safe = said ? withholdRecordText(said, { recordConsent: false }) : "";
  return `${skillLabel}${safe ? `: ${safe}` : ""}`.slice(0, 200);
}
