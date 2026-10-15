/**
 * The record on the page is a spectrum the person chooses (DEC-51), applied to
 * the WRITTEN document, not only to the source text.
 *
 * Troy, 2026-10-15, after his first live run: the finish page said it had kept
 * "Toulon Correctional Facility" off the resume while the page still named the
 * facility as the employer twice. The old rule withheld record lines from the
 * person's source by dated entry; a facility line without a year slipped past
 * it, and the writer rebuilt the employer from the words around it. This pass
 * runs on what the writer actually produced, so the page can never contradict
 * the card.
 *
 * Three choices:
 *   off       (default) inside jobs come off the page, header and duties, and
 *             any other sentence naming the facility or the record goes too.
 *   state     the work stays; the employer reads "State of <X>" (the state on
 *             the header), never the facility; title, years and duties as written.
 *   facility  everything as the person wrote it (the old keepInsideLines).
 *
 * Nothing here adds a word about a record. "State of Illinois" is a name the
 * person chose for an employer they listed; the gate counts it as their words
 * through recordChoiceWords, which both the page and the server derive from
 * the same source text, so receipts stay consistent.
 */
import { jobsIn } from "@crucible/core/src/jobResolver";
import { hasRecordWords } from "./record-lines";

export type RecordChoice = "off" | "state" | "facility";
export const RECORD_CHOICES: readonly RecordChoice[] = ["off", "state", "facility"];

export function isRecordChoice(v: unknown): v is RecordChoice {
  return v === "off" || v === "state" || v === "facility";
}

/** Runs saved before the choice existed carry only keepInsideLines: true meant the facility named as written. */
export function recordChoiceFrom(choice: unknown, keepInsideLines?: unknown): RecordChoice {
  if (isRecordChoice(choice)) return choice;
  return keepInsideLines === true ? "facility" : "off";
}

/** The person's source lines about inside work stay in the writer's source unless the record is left off entirely. */
export function keepSourceRecordLines(choice: RecordChoice): boolean {
  return choice !== "off";
}

export const FACILITY_RE =
  /\b(?:correctional|corrections|penitentiary|prison|jail|detention(?:\s+cent(?:er|re))?|reformatory|work\s?camp|boot\s?camp|department of corrections|d\.?o\.?c\.?)\b/i;

const STATES: Record<string, string> = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California", CO: "Colorado", CT: "Connecticut", DE: "Delaware",
  DC: "the District of Columbia", FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho", IL: "Illinois", IN: "Indiana", IA: "Iowa",
  KS: "Kansas", KY: "Kentucky", LA: "Louisiana", ME: "Maine", MD: "Maryland", MA: "Massachusetts", MI: "Michigan", MN: "Minnesota",
  MS: "Mississippi", MO: "Missouri", MT: "Montana", NE: "Nebraska", NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey", NM: "New Mexico",
  NY: "New York", NC: "North Carolina", ND: "North Dakota", OH: "Ohio", OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania", RI: "Rhode Island",
  SC: "South Carolina", SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah", VT: "Vermont", VA: "Virginia", WA: "Washington",
  WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming",
};
const STATE_NAME_RE = new RegExp(`\\b(${Object.values(STATES).filter((n) => !n.startsWith("the ")).join("|")})\\b`, "i");

/** When nothing on the header says which state, the employer still reads as public work, never as the facility. */
export const GENERIC_SUBSTITUTE = "State work program";

/** "State of Illinois" from a header's "Toulon, IL" (or a state name in it); null when no state is there. */
export function stateSubstituteIn(text: string): string | null {
  const afterComma = text.match(/,\s*([A-Z]{2})\b/);
  if (afterComma && STATES[afterComma[1]]) return `State of ${STATES[afterComma[1]]}`;
  const byName = text.match(STATE_NAME_RE);
  if (byName) {
    const name = Object.values(STATES).find((n) => n.toLowerCase() === byName[1].toLowerCase());
    if (name) return `State of ${name}`;
  }
  const bare = Array.from(text.matchAll(/\b([A-Z]{2})\b/g)).map((m) => m[1]).find((c) => STATES[c] && c !== "DC");
  return bare ? `State of ${STATES[bare]}` : null;
}

const linesOf = (text: string) => (text || "").replace(/\r\n?/g, "\n").split("\n");
const namesFacility = (line: string) => FACILITY_RE.test(line);
const namesRecord = (line: string) => FACILITY_RE.test(line) || hasRecordWords(line);

/**
 * The employer names the person's choice would put on the page, derived from
 * the SOURCE text alone (the facility lines and the state near them). The page
 * and the server call this with the same text, so the result is part of the
 * person's words on both sides and the written header is never flagged as a
 * change t.ROY made.
 */
export function recordChoiceWords(sourceText: string | undefined, choice: RecordChoice): string {
  if (choice !== "state" || !sourceText) return "";
  const lines = linesOf(sourceText);
  const out = new Set<string>();
  lines.forEach((line, i) => {
    if (!namesFacility(line)) return;
    const near = [lines[i - 1] ?? "", line, lines[i + 1] ?? "", lines[i + 2] ?? ""].join(" ");
    out.add(stateSubstituteIn(near) ?? GENERIC_SUBSTITUTE);
  });
  return Array.from(out).join("\n");
}

export interface RecordEntry {
  /** The header as it stood before this pass (title, employer, place, dates), for the card. */
  header: string;
  /** The employer text that named the facility. */
  employer: string;
  /** Duty lines under the header. */
  lines: number;
  /** For "state": what the employer reads as now. */
  substitute?: string;
}

export interface RecordPass {
  resume: string;
  letter: string;
  entries: RecordEntry[];
  swaps: Array<{ from: string; to: string }>;
}

interface Span {
  /** Index of the first header line in the full line array. */
  start: number;
  /** Index after the last line of the entry. */
  end: number;
  headerLines: number;
  employer: string;
}

// A section heading in the writer's format: upper case words, no pipes, no digits.
const SECTION_RE = /^[A-Z][A-Z &/,'-]{2,60}$/;

function entrySpans(lines: string[]): Span[] {
  const jobs = jobsIn(lines.slice(1).join("\n"));
  const starts: Array<{ start: number; headerLines: number; employer: string }> = [];
  let from = 1;
  for (const job of jobs) {
    const idx = lines.indexOf(job.lines[0], from);
    if (idx < 0) continue;
    starts.push({ start: idx, headerLines: Math.max(1, job.lines.length), employer: job.employer || "" });
    from = idx + 1;
  }
  return starts.map((s, i) => {
    let end = lines.length;
    for (let k = s.start + s.headerLines; k < lines.length; k++) {
      const next = starts[i + 1];
      if (next && k >= next.start) { end = next.start; break; }
      const line = lines[k].trim();
      if (line && SECTION_RE.test(line)) { end = k; break; }
      if (!line && k + 1 < lines.length && SECTION_RE.test(lines[k + 1].trim())) { end = k; break; }
    }
    return { ...s, end };
  });
}

/** Sentences that name the facility or the record come out of a line; a line left with nothing goes. */
function scrubSentences(line: string): string {
  if (!namesRecord(line)) return line;
  const bullet = line.match(/^\s*[-•*]\s*/)?.[0] ?? "";
  const body = line.slice(bullet.length);
  const kept = body.split(/(?<=[.!?])\s+/).filter((s) => s.trim() && !namesRecord(s));
  return kept.length ? bullet + kept.join(" ") : "";
}

function replaceAll(text: string, from: string, to: string): string {
  if (!from.trim()) return text;
  return text.replace(new RegExp(from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), to);
}

/**
 * Apply the choice to the written resume and letter. Entries are the inside
 * jobs found on the written page (not the source), so the card describes what
 * the reader will and will not see.
 */
export function applyRecordChoice(resume: string, letter: string, choice: RecordChoice, sourceText?: string): RecordPass {
  const lines = linesOf(resume);
  const spans = entrySpans(lines).filter((s) => lines.slice(s.start, s.start + s.headerLines).some(namesRecord));
  const sourceSubs = recordChoiceWords(sourceText, "state").split("\n").filter(Boolean);
  const entries: RecordEntry[] = [];
  const swaps: Array<{ from: string; to: string }> = [];
  const drop = new Set<number>();
  const replaced = new Map<number, string>();

  for (const span of spans) {
    const headerText = lines.slice(span.start, span.start + span.headerLines).map((l) => l.trim()).filter(Boolean).join(" | ");
    const facilitySegment =
      lines
        .slice(span.start, span.start + span.headerLines)
        .flatMap((l) => l.split("|"))
        .map((p) => p.trim())
        .find(namesFacility) ?? span.employer;
    const entry: RecordEntry = { header: headerText, employer: facilitySegment || span.employer, lines: Math.max(0, span.end - span.start - span.headerLines) };
    if (choice === "off") {
      for (let k = span.start; k < span.end; k++) drop.add(k);
    } else if (choice === "state") {
      const fromHeader = stateSubstituteIn(headerText);
      const substitute = fromHeader && (sourceSubs.length === 0 || sourceSubs.includes(fromHeader)) ? fromHeader : sourceSubs[0] ?? fromHeader ?? GENERIC_SUBSTITUTE;
      entry.substitute = substitute;
      if (entry.employer) swaps.push({ from: entry.employer, to: substitute });
      for (let k = span.start; k < span.start + span.headerLines; k++) {
        const line = lines[k];
        if (!namesFacility(line)) continue;
        const next = line.includes("|")
          ? line.split("|").map((p) => (namesFacility(p) ? p.replace(/^(\s*)\S[\s\S]*?(\s*)$/, `$1${substitute}$2`) : p)).join("|")
          : line.replace(/[^,|]*(?:correctional|corrections|penitentiary|prison|jail|detention|reformatory|work\s?camp|boot\s?camp|department of corrections|d\.?o\.?c\.?)[^,|]*/i, substitute);
        replaced.set(k, next);
      }
      for (let k = span.start + span.headerLines; k < span.end; k++) {
        const scrubbed = scrubSentences(replaceAll(lines[k], entry.employer, substitute));
        if (scrubbed !== lines[k]) replaced.set(k, scrubbed);
      }
    }
    entries.push(entry);
  }

  const nextLines: string[] = [];
  lines.forEach((line, i) => {
    if (drop.has(i)) return;
    let out = replaced.has(i) ? (replaced.get(i) as string) : line;
    // Outside the inside entries (the summary, skills), a sentence about the
    // facility or the record never stays once the person left the record off.
    if (choice === "off" && !SECTION_RE.test(out.trim())) out = scrubSentences(out);
    if (choice === "state" && !SECTION_RE.test(out.trim())) {
      for (const s of swaps) out = replaceAll(out, s.from, s.to);
      out = scrubSentences(out);
    }
    if (out === "" && line.trim() !== "") return;
    nextLines.push(out);
  });
  let nextResume = nextLines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  if (choice === "facility") nextResume = resume;

  let nextLetter = letter;
  if (choice === "off") {
    nextLetter = linesOf(letter).map(scrubSentences).join("\n").replace(/\n{3,}/g, "\n\n");
  } else if (choice === "state") {
    for (const s of swaps) nextLetter = replaceAll(nextLetter, s.from, s.to);
    nextLetter = linesOf(nextLetter).map(scrubSentences).join("\n").replace(/\n{3,}/g, "\n\n");
  }
  return { resume: nextResume, letter: nextLetter, entries, swaps };
}

/** The card's one-line label for an entry the choice touched. */
export function recordEntryLabel(entry: RecordEntry, choice: RecordChoice): string {
  const under = entry.lines > 0 ? ` (and the ${entry.lines} ${entry.lines === 1 ? "line" : "lines"} under it)` : "";
  if (choice === "state" && entry.substitute) return `${entry.header.replace(entry.employer, entry.substitute)}`;
  return `${entry.header}${under}`;
}
