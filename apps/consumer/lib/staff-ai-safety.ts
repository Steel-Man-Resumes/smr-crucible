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
    "halfway house", "work release", "on supervision", "under supervision", "curfew",
    "re-?entry center", "residential reentry", "community corrections", "department of corrections", "corrections? (?:center|facility|institution|complex|camp|unit|officer|department|dept)",
    "(?:his|her|their|my) agent", "agent visits?", "court", "courts", "sentence (?:ends?|ended|expires?|is up|up)", "max(?:imum)? discharge", "discharge date",
    "release (?:next|this|date)", "(?:was|were|been) inside (?:for |since )?\\d", "while inside", "on the inside",
    "drug (?:test|tests|testing|screens?)", "urine (?:test|screen)", "(?:no[- ]contact|restraining|protective) orders?",
    "deferred (?:prosecution|adjudication|sentence)", "diversion program", "public defender", "pre-?sentence", "sheriff", "booked into", "mug ?shot",
    // Fix round 2.
    "pending charges?", "charges? (?:pending|filed|dropped)", "revok\\w*", "violat(?:ed|ions?)", "got out \\d", "got out this",
    "released (?:\\w+day|from)", "did \\d+ (?:years?|months?)", "on paper", "wears? an? (?:ankle )?bracelet", "(?:gps|monitor\\w*) (?:bracelet|tether)",
    "tether", "back in (?:county|jail)",
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
const RECORD_ABBREVIATIONS = /\b(?:DOC|D\.O\.C\.?|P\.O\.|BOP|RRC|UA|UAs|PSI|DOJ|ICE)(?=\W|$)|\bCorrections?\b|\bEM\b|\bPO\b(?!\s*(?:[Bb]ox|#|[Nn]umber))|\b(?:[Mm]y|[Hh]is|[Hh]er|[Tt]heir|[Tt]he|[Aa]|[Ww]ith|[Tt]o|[Ss]ee|[Ss]aw|[Cc]all|[Cc]alled|[Mm]eets?|[Mm]et)\s+PO\b(?!\s*(?:[Bb]ox|#|[Nn]umber))/;
// "no" and "num" must be whole words: "case notes" is the workspace's own term, not "case no. tes"
// (2026-10-30, harness TRAP-ACT-04: "Save that to her case notes." reached t.ROY as a withheld blank).
// Production's pattern (crude on purpose: "case number ..." always matches, the "ber" read as the id),
// with only "case notes" excluded (review R5-1: requiring the id right after the label let "Her case
// number is 24-CF-1182." through). "\s*(?::\s*)?" instead of "\s*:?\s*": the same matches without the
// quadratic split of a long run of spaces (review G6-1).
const RECORD_NUMBERS = /\b(?:case|docket|booking|inmate|offender|cause)\s*(?:#|no(?!tes?\b)\.?|num(?:ber)?\.?)\s*(?::\s*)?[A-Za-z0-9][A-Za-z0-9-]{2,}/i;
/** A record-number label ("case no.", "docket number", "booking #", "case notes:"). Linear: no nested repeats. */
const RECORD_LABEL = /\b(?:case|docket|booking|inmate|offender|cause)\s*(?:#|nos?\b\.?|num(?:ber)?s?\b\.?|id\b|notes?\s*[:#-])/i;
/**
 * A token shaped like a record number, whole tokens only: compatibility-normalized, Unicode dashes as
 * "-". Letters and digits with a hyphen or colon ("24-CF-1182", "B-445566", "1:24-cr-00123"), 5+ digits,
 * or 6+ letters and digits with at least 2 digits ("2024CF001182", "CR99812"). Never an ISO date or a
 * phone number (review G7-1, G7 over-withholding).
 */
const recordShapedToken = (t: string): boolean => {
  const w = t.normalize("NFKC").replace(/[\u2010-\u2015\u2212]/g, "-").replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, "");
  if (w.length < 5 || !/^[A-Za-z0-9:-]+$/.test(w) || !/\d/.test(w)) return false;
  if (/^\d{4}-\d{2}-\d{2}$/.test(w) || /^(?:\d{3}-)?\d{3}-\d{4}$/.test(w)) return false;
  return /[-:]/.test(w) || /^\d+$/.test(w) || (w.length >= 6 && (w.match(/\d/g) ?? []).length >= 2);
};
/** "case notes ... CR-99812": a notes label in a sentence that also holds a record-shaped token (review G6-3, G7-1). */
const NOTES_LABEL = /\b(?:case|docket|booking|inmate|offender|cause)\s*notes?\b/i;

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
const SENSITIVE_FIELD_SUBJECT = /\b(?:offen[cs]e|charge|conviction|record|criminal|felony|misdemeanou?r|court|case|docket|doc|inmate|parole|probation|supervision|po|release|custody|warrant|registry|sentence|agent|officer|discharge|corrections?|facility|diagnos\w*|medical|health|mental|medication|disabilit\w*|substance|recovery|treatment|drug|alcohol|immigration|ssn|social security|dob|birth)\b/i;

/**
 * Lane L4 owns `isSensitiveField`. Until its module is on main this is the
 * guard: unmarked (null) counts as sensitive, a marked field is sensitive, and
 * so is any field whose key or label names a sensitive subject. The boss may
 * point this at L4's helper after merge; the stricter of the two must win.
 */
export function isSensitiveFieldDef(def: CustomFieldDefLike): boolean {
  if (def.sensitive !== false) return true;
  const words = `${def.key} ${def.label}`.replace(/[_-]+/g, " ");
  return SENSITIVE_FIELD_SUBJECT.test(words) || hasStaffRecordWords(words);
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
 * sensitive field, never a staff-member id (it names a colleague by id). A
 * field whose label or value carries a record word is dropped whole (fix
 * round 1): even a marker beside a label says too much.
 */
export function safeCustomFields(rows: { def: CustomFieldDefLike; value: unknown }[], gate = staffTextGate()): { label: string; value: string }[] {
  const out: { label: string; value: string }[] = [];
  for (const { def, value } of rows) {
    if (def.retired_at || isSensitiveFieldDef(def) || def.type === "staff_member") continue;
    const text = fieldText(value);
    if (text === null) continue;
    const label = String(def.label).slice(0, 80);
    if (gate.pass(label) !== label || gate.pass(text) !== text) continue;
    out.push({ label, value: text });
  }
  return out.slice(0, 20);
}

/* -------------------------------------------- the staff member's own words -- */

/** Shown to the staff member when their own message had record words taken out. */
export const STAFF_INPUT_NOTICE = "Record details were left out of what t.ROY saw. Add them yourself after.";

/**
 * The staff member's own message, before it goes to a model (fix round 1,
 * CC default until Troy rules otherwise): every line or sentence that carries
 * a record word becomes the marker; the rest goes through, so a note from
 * bullets still works on everything else.
 */
export function withholdRecordSentences(text: string): { text: string; withheld: boolean } {
  const source = String(text ?? "");
  const shaped = (sentence: string) => sentence.split(/\s+/).some(recordShapedToken);
  // Sentences grouped by line in one pass (review G7-2: linear in the number of lines). "case no.
  // 24-CF-1182" is one sentence: never split after an abbreviated "no.", "num." or "nr." (R4-1).
  const lines = source.split("\n").map((line) => {
    const segs = line.split(/(?<=[.!?;])(?<!\b(?:no|num|nr)\.)\s+/i).map((s) => ({ s, hit: hasStaffRecordWords(s) || (NOTES_LABEL.test(s) && shaped(s)) }));
    return { line, segs };
  });
  // A label in one sentence and a record-shaped number in the next ("Her case number. 24-CF-1182",
  // "case no.\n24-CF-1182"): both are withheld (review R5-2).
  let prev: { s: string; hit: boolean } | null = null;
  for (const l of lines) for (const g of l.segs) {
    if (prev && RECORD_LABEL.test(prev.s) && shaped(g.s)) { prev.hit = true; g.hit = true; }
    prev = g;
  }
  // A line that names a record when no single sentence does (the label and the number split apart) is
  // withheld whole (review R4-1).
  for (const l of lines) if (!l.segs.some((g) => g.hit) && hasStaffRecordWords(l.line)) for (const g of l.segs) g.hit = true;
  const withheld = lines.some((l) => l.segs.some((g) => g.hit));
  // A record number split across a line break that nothing above caught: the whole text is withheld.
  if (!withheld && RECORD_NUMBERS.test(source.replace(/\n/g, " "))) return { text: RECORD_WITHHELD, withheld: true };
  // A line with nothing withheld comes back exactly as it was (review G7-3).
  return { text: lines.map((l) => (l.segs.some((g) => g.hit) ? l.segs.map((g) => (g.hit ? RECORD_WITHHELD : g.s)).join(" ") : l.line)).join("\n"), withheld };
}

/** Every string inside a value (tool args and results from the client), record sentences withheld. */
function gateDeep(value: unknown, depth = 0): unknown {
  if (typeof value === "string") return withholdRecordSentences(value).text;
  if (depth > 12 || value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((v) => gateDeep(v, depth + 1));
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, gateDeep(v, depth + 1)]));
}

/**
 * Every message in a staff conversation as the client sent it: user and
 * assistant text, text parts, and tool invocations (args and results), record
 * sentences withheld (fix round 2: nothing from the client reaches a model
 * ungated). `withheld` is about the NEWEST user message, which is the one the
 * notice speaks to.
 */
export function gateStaffMessages<M extends Record<string, unknown>>(messages: readonly M[]): { messages: M[]; withheld: boolean } {
  let lastUser = -1;
  messages.forEach((m, i) => { if (m.role === "user") lastUser = i; });
  let withheld = false;
  const out = messages.map((m, i) => {
    let hit = false;
    const next: Record<string, unknown> = { ...m };
    if (typeof m.content === "string") { const g = withholdRecordSentences(m.content); next.content = g.text; hit = hit || g.withheld; }
    if (Array.isArray(m.parts)) {
      next.parts = (m.parts as Record<string, unknown>[]).map((p) => {
        if (p?.type === "tool-invocation") return { ...p, toolInvocation: gateDeep(p.toolInvocation) };
        if (p?.type !== "text" || typeof p.text !== "string") return p;
        const g = withholdRecordSentences(p.text);
        hit = hit || g.withheld;
        return { ...p, text: g.text };
      });
    }
    if (Array.isArray(m.toolInvocations)) next.toolInvocations = gateDeep(m.toolInvocations);
    if (i === lastUser && hit) withheld = true;
    return next as M;
  });
  return { messages: out, withheld };
}

/** Draft skills: the log keeps only the label, never what was typed for the draft (fix round 1). */
const LABEL_ONLY_SKILLS = new Set(["Note from my bullets", "Draft a message", "Funder narrative", "Draft a check-in", "Write the outcome note"]);

/**
 * The input summary a skill run is logged with (ai_skill_run.input_summary):
 * the staff member's words with record text withheld, one line, 200
 * characters at most. Never a note body.
 */
export function skillRunInputSummary(skillLabel: string, userText: string | null | undefined): string {
  if (LABEL_ONLY_SKILLS.has(skillLabel)) return skillLabel.slice(0, 200);
  const said = String(userText ?? "").replace(/\s+/g, " ").trim();
  const safe = said ? withholdRecordText(said, { recordConsent: false }) : "";
  return `${skillLabel}${safe ? `: ${safe}` : ""}`.slice(0, 200);
}
