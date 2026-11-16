/**
 * Translate and approve (lane D2, slice 1): split a Spanish work history into units.
 *
 * One unit is one line the person will see side by side with its English and
 * approve, edit or remove. Units come from three places, the same three the
 * design names (D2-DESIGN 2.2):
 *
 *   resume      every line of `session.resumeText` that is not a heading, a
 *               contact line or blank
 *   hook        every sentence of `session.hookNarrative` ("work the old resume missed")
 *   credential  the name of every licenses-and-training row
 *
 * Record lines: the text goes through `withholdRecordLines(text, keepSourceRecordLines(choice))`
 * first, the same two functions the writer uses (lib/forge-resume-prompt.ts) with the
 * person's current record choice. A withheld line is never a unit, so it is never
 * sent, never hashed into a cache key and never logged. `goalNarrative`, record
 * answers and challenge narratives are not inputs here at all.
 *
 * Headings come from a fixed table and contact lines are copied unchanged
 * (headings.ts); both stay in the layout so the assembled English keeps the
 * shape of the original page. Pure: no network, no model.
 */
import { withholdRecordLines, hasRecordWords } from "../record-lines";
import { keepSourceRecordLines, type RecordChoice } from "../record-choice";
import { headingFor, isContactLine, type SectionName } from "./headings";

export type UnitField = "resume" | "hook" | "credential";
export type UnitKind = "header" | "duty" | "education" | "skills" | "summary" | "line" | "hook" | "credential";

export interface Unit {
  /** Stable inside one split: r0, r1 ... (resume), h0 ... (hook), c0 ... (credential rows). */
  id: string;
  field: UnitField;
  kind: UnitKind;
  section: SectionName;
  /** The Spanish line as the person wrote it, without its bullet. Never changed by the machine. */
  es: string;
  /** Binds an approval to this exact Spanish line. See lineHash. */
  hash: string;
  /** The bullet marker and its space ("- "), put back in front of the English. "" when there was none. */
  prefix: string;
  /** For a duty line: the id of the job header it sits under. A dropped header drops its duties. */
  job?: string;
  /** What followed a hook sentence in the original ("\n" or " "). */
  sep?: string;
  /** For a credential name: the index of its row. */
  row?: number;
}

export type LayoutItem =
  | { t: "unit"; id: string }
  | { t: "heading"; es: string; en: string; section: SectionName; alreadyEnglish: boolean }
  | { t: "copy"; text: string; why: "contact" }
  | { t: "blank" };

export interface CredentialRowIn {
  name: string;
  kind?: string;
  when?: string;
}

export interface SplitInput {
  resumeText?: string;
  hookNarrative?: string;
  credentialRows?: ReadonlyArray<CredentialRowIn>;
  /** The person's CURRENT record choice. Defaults to "off", the stricter reading (nothing about inside work goes anywhere). */
  recordChoice?: RecordChoice;
}

export interface SplitResult {
  units: Unit[];
  /** The page in order: units by id, headings, copied contact lines, blank lines. Resume field only. */
  layout: LayoutItem[];
  /** The record lines the choice holds back. They never became units. Counts only should leave this module. */
  withheld: string[];
}

/* ----------------------------------------------------------------- hash --- */

/** The line as compared: NFC, one space between words, trimmed. Case and accents are kept: a changed accent is an edit. */
export function normalizeLine(s: string): string {
  return (s || "").normalize("NFC").replace(/\s+/g, " ").trim();
}

/** Two 32-bit-seeded string hashes (cyrb53 family). Not a secret: it only has to change when the Spanish line changes. */
function cyrb53(str: string, seed: number): number {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

/**
 * The hash that binds an approval to the exact Spanish line. Runs in the browser
 * and on the server (no node:crypto). Two seeds and the length keep an accidental
 * collision out of reach; nobody gains by forging one (the person can already type
 * their own English).
 */
export function lineHash(es: string): string {
  const n = normalizeLine(es);
  return `${cyrb53(n, 0).toString(36)}-${cyrb53(n, 0x9e3779b9).toString(36)}-${n.length.toString(36)}`;
}

/* ------------------------------------------------------------- splitting --- */

const BULLET_RE = /^(\s*[-*•●▪]\s+)/;
const YEAR_RE = /\b(?:19|20)\d{2}\b/;
const PRESENT_RE = /\b(?:presente|actualidad|actualmente|present|current)\b/i;

/** A job header: not a bullet, and it carries a year, a pipe or a present-day word. */
function looksLikeJobHeader(text: string): boolean {
  return YEAR_RE.test(text) || text.includes("|") || PRESENT_RE.test(text);
}

function unit(base: Omit<Unit, "hash">): Unit {
  return { ...base, hash: lineHash(base.es) };
}

/** Split the resume text into units and a layout. `kept` is the text after record lines are withheld. */
function splitResumeText(kept: string): { units: Unit[]; layout: LayoutItem[] } {
  const units: Unit[] = [];
  const layout: LayoutItem[] = [];
  let section: SectionName = "other";
  let job: string | undefined;
  let seenHeading = false;
  let firstLine = true;
  let n = 0;
  for (const raw of kept.replace(/\r\n?/g, "\n").split("\n")) {
    const trimmed = raw.trim();
    if (!trimmed) {
      layout.push({ t: "blank" });
      continue;
    }
    const wasFirst = firstLine;
    firstLine = false;
    const heading = headingFor(trimmed);
    if (heading) {
      layout.push({ t: "heading", es: trimmed, en: heading.en, section: heading.section, alreadyEnglish: heading.alreadyEnglish });
      section = heading.section;
      job = undefined;
      seenHeading = true;
      continue;
    }
    if (isContactLine(trimmed, { beforeFirstHeading: !seenHeading, firstLine: wasFirst })) {
      layout.push({ t: "copy", text: trimmed, why: "contact" });
      continue;
    }
    const bullet = raw.match(BULLET_RE);
    const prefix = bullet ? "- " : "";
    const text = bullet ? raw.slice(bullet[1].length).trim() : trimmed;
    if (!text) continue;
    const id = `r${n++}`;
    let kind: UnitKind;
    let jobId: string | undefined;
    if (section === "education" || section === "credentials") kind = "education";
    else if (section === "skills") kind = "skills";
    else if (section === "summary") kind = "summary";
    else if (section === "references") kind = "line";
    else if (!bullet && looksLikeJobHeader(text)) {
      kind = "header";
      job = id;
    } else {
      kind = "duty";
      jobId = job;
    }
    units.push(unit({ id, field: "resume", kind, section, es: text, prefix, ...(jobId ? { job: jobId } : {}) }));
    layout.push({ t: "unit", id });
  }
  return { units, layout };
}

/** The sentences of the "work the old resume missed" text, each with what followed it. */
function splitHookText(kept: string): Unit[] {
  const out: Unit[] = [];
  const text = kept.replace(/\r\n?/g, "\n").trim();
  if (!text) return out;
  const re = /[^.!?\n]+(?:[.!?]+|(?=\n)|$)\s*/g;
  let n = 0;
  for (const m of text.matchAll(re)) {
    const sentence = m[0].trim();
    if (!sentence || !/[\p{L}\d]/u.test(sentence)) continue;
    const sep = /\n/.test(m[0].slice(m[0].trimEnd().length)) ? "\n" : " ";
    out.push(unit({ id: `h${n++}`, field: "hook", kind: "hook", section: "other", es: sentence, prefix: "", sep }));
  }
  return out;
}

/**
 * Everything the person wrote in Spanish that D2 may translate, as units, plus the page layout.
 * The record choice is applied first with the writer's own function, so the units are exactly
 * the lines the writer would have seen.
 */
export function splitHistory(input: SplitInput): SplitResult {
  const choice: RecordChoice = input.recordChoice ?? "off";
  const keep = keepSourceRecordLines(choice);
  const resume = withholdRecordLines(input.resumeText, keep);
  const hook = withholdRecordLines(input.hookNarrative, keep);
  const { units: resumeUnits, layout } = splitResumeText(resume.kept);
  const hookUnits = splitHookText(hook.kept);
  const withheld = [...resume.withheld, ...hook.withheld];
  const credUnits: Unit[] = [];
  (input.credentialRows ?? []).forEach((row, i) => {
    const name = normalizeLine(row?.name ?? "");
    if (!name) return;
    // A credential name that is itself a record word follows the same choice. It never becomes a unit.
    if (!keep && hasRecordWords(name)) {
      withheld.push(name);
      return;
    }
    credUnits.push(unit({ id: `c${i}`, field: "credential", kind: "credential", section: "credentials", es: name, prefix: "", row: i }));
  });
  return { units: [...resumeUnits, ...hookUnits, ...credUnits], layout, withheld };
}
