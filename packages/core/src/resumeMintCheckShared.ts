/**
 * Resume mint check, deterministic layer.
 *
 * The bar: a resume is never called finished while it has an open BLOCK.
 * This module is the part of that check that needs no model: it reads the
 * finished text against the person's own words (the source) and reports
 * findings by rule. It never edits the text. A finding names the rule, the
 * line, and what is wrong; the page decides how to show it.
 *
 * Severity
 * - BLOCK: false, contradicted by a check, or broken as a document.
 * - FIX:   weaker than it should be, or a claim the person should confirm.
 *
 * Rule ids follow the Steel Man resume quality standard (STD-*). Credentials
 * (STD-T03) are checked by `apps/consumer/lib/credential-truth.ts`, which is
 * already narrow and tested; they are not repeated here. The six-reader judge
 * (model-based) is a separate layer.
 *
 * Pure: no imports, no I/O, safe in the browser and on the server.
 */

export type MintSeverity = "BLOCK" | "FIX";

export interface MintFinding {
  rule: string;
  severity: MintSeverity;
  /** The line (or phrase) the finding is about, as it appears in the output. */
  line: string;
  /** Plain words for the person. */
  why: string;
}

export interface MintCheckInput {
  /** The resume (or letter) text as the person would receive it. */
  output: string;
  /** Only the person's own words: their resume text, answers, notes. */
  source: string;
  kind?: "resume" | "cover_letter";
}

export interface MintCheckResult {
  findings: MintFinding[];
  blockCount: number;
  fixCount: number;
  /** True only when there is no open BLOCK in this layer. Not "mint" by itself. */
  passesDeterministic: boolean;
}

// Spacing and hyphens are not words: "Self-Employed" on the page and
// "self employed" in the person's words are the same phrase. Compare with
// every space and hyphen (and the dash look-alikes) removed.
const squash = (s: string) => s.toLowerCase().replace(/[\s\-\u2010-\u2015]+/g, "");

/** True when the person's own words carry this phrase, ignoring spacing and hyphens. */
function saidBy(src: string, phrase: string): boolean {
  return squash(src).includes(squash(phrase));
}

function linesOf(text: string): string[] {
  return text.split("\n").map((l) => l.trim()).filter(Boolean);
}

function lineContaining(text: string, needle: string): string {
  const n = needle.toLowerCase();
  return linesOf(text).find((l) => l.toLowerCase().includes(n)) ?? needle;
}

// ---- STD-T05: dates are never moved -------------------------------------
const YEAR_RE = /\b(?:19[5-9]\d|20[0-4]\d)\b/g;

function checkYears(out: string, src: string, f: MintFinding[]) {
  const srcYears = new Set(src.match(YEAR_RE) ?? []);
  const seen = new Set<string>();
  for (const y of out.match(YEAR_RE) ?? []) {
    if (srcYears.has(y) || seen.has(y)) continue;
    seen.add(y);
    f.push({
      rule: "STD-T05",
      severity: "BLOCK",
      line: lineContaining(out, y),
      why: `The year ${y} is not in anything you told us. A date a background check can't match reads as a discrepancy.`,
    });
  }
}

// ---- STD-T02: numbers both ways ------------------------------------------
const WORD_NUMS: Record<string, string> = {
  two: "2", three: "3", four: "4", five: "5", six: "6", seven: "7", eight: "8", nine: "9", ten: "10",
  eleven: "11", twelve: "12", fifteen: "15", twenty: "20", thirty: "30", forty: "40", fifty: "50",
};
// "one" and "hundred" are left out on purpose: they are ordinary prose words
// ("no one", "one of"), and reading them as counts made false findings.

function numbersIn(text: string): Set<string> {
  const t = text
    .replace(/\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/g, " ") // phone numbers
    .replace(/\b\d{3}[\s.-]\d{4}\b/g, " ") // short phone numbers
    .replace(/\b[A-Z]{2}\s+\d{5}(?:-\d{4})?\b/g, " ") // ZIP after a state
    .replace(/\b[\w.+-]+@[\w-]+\.[\w.]+\b/g, " ") // emails
    .replace(YEAR_RE, " ");
  const out = new Set<string>();
  for (const m of t.match(/\d[\d,]*(?:\.\d+)?/g) ?? []) out.add(m.replace(/,/g, ""));
  for (const w of t.toLowerCase().match(/\b[a-z]+\b/g) ?? []) if (WORD_NUMS[w]) out.add(WORD_NUMS[w]);
  return out;
}

function checkNumbers(out: string, src: string, f: MintFinding[], kind: MintCheckInput["kind"]) {
  const srcNums = numbersIn(src);
  const outNums = numbersIn(out);
  for (const n of outNums) {
    if (srcNums.has(n)) continue;
    f.push({
      rule: "STD-T02",
      severity: "BLOCK",
      line: lineContaining(out, n),
      why: `The number ${n} is not in anything you told us. Only numbers you gave go on the page.`,
    });
  }
  // A letter need not carry every number; a resume must (dropping one is a FIX).
  if (kind === "cover_letter") return;
  for (const n of srcNums) {
    if (outNums.has(n) || n.length < 2) continue;
    f.push({
      rule: "STD-T02",
      severity: "FIX",
      line: lineContaining(src, n),
      why: `You gave the number ${n} and it did not make it onto the page. A number you know is one of the strongest things a resume can carry.`,
    });
  }
}

// ---- STD-T07: no character or setting claims the person did not make -----
const CHARACTER_RE = /\b(dependable|reliable|hard[- ]?working|trustworthy|punctual|consistent|fast[- ]paced|high[- ]volume|busy|peak)\b/gi;

function checkCharacter(out: string, src: string, f: MintFinding[]) {
  const seen = new Set<string>();
  for (const m of out.match(CHARACTER_RE) ?? []) {
    const w = squash(m);
    if (seen.has(w)) continue;
    seen.add(w);
    if (saidBy(src, m)) continue;
    f.push({
      rule: "STD-T07",
      severity: "FIX",
      line: lineContaining(out, m),
      why: `"${m}" is a claim you didn't make about yourself or the work. Keep it only if it's true and you'd say it.`,
    });
  }
}

// ---- STD-C05: no euphemism a record will contradict ----------------------
const EUPHEMISM_RE = /\b(contract (?:ended|completed|concluded)|personal (?:growth|development) period|sabbatical|career break|self[- ]employ\w*|freelanc\w*|independent contractor|family (?:responsibilities|matters)|personal (?:reasons|circumstances|matters)|time away)\b/gi;

// "self-employ" and "freelanc" are word families in the rule itself: the
// person's "self employed" covers the page's "Self-Employment".
const familyStem = (m: string) => {
  const s = squash(m);
  return /^selfemploy/.test(s) ? "selfemploy" : /^freelanc/.test(s) ? "freelanc" : s;
};

function checkEuphemisms(out: string, src: string, f: MintFinding[]) {
  for (const m of out.match(EUPHEMISM_RE) ?? []) {
    if (squash(src).includes(familyStem(m))) continue;
    f.push({
      rule: "STD-C05",
      severity: "BLOCK",
      line: lineContaining(out, m),
      why: `"${m}" is not in your words. A phrase that a record could contradict will come up at the background check.`,
    });
  }
}

// ---- STD-C07: legal status never overstated -------------------------------
const LEGAL_STATUS_RE = /\b(fully resolved|completed (?:all )?(?:probation|parole|supervision)|expunged|sealed|pardoned|record (?:is )?(?:clean|cleared))\b/gi;

function checkLegalStatus(out: string, src: string, f: MintFinding[]) {
  for (const m of out.match(LEGAL_STATUS_RE) ?? []) {
    if (saidBy(src, m)) continue;
    f.push({
      rule: "STD-C07",
      severity: "BLOCK",
      line: lineContaining(out, m),
      why: `"${m}" says something about your legal status that you didn't say. Never put that on paper unless it's exactly true.`,
    });
  }
}

// ---- STD-F05 / STD-F02: placeholders and filler entries ------------------
const PLACEHOLDER_RE = /\[[^\]]{1,40}\]|\(?X{3}\)?[\s.-]*X{3}[\s.-]*X{4}|email@email\.com|your\.?email@|\bCandidate\s*$/m;
// A section that says it has nothing ("No formal education provided") is an
// empty entry printed as content. Leave the section off instead.
const FILLER_RE = /^(?:no (?:formal )?(?:education|certifications?|experience|skills)(?: (?:provided|listed|given|available))?|none (?:provided|listed|given)|n\/?a|not (?:provided|applicable|available))\.?$/i;

function checkPlaceholders(out: string, kind: MintCheckInput["kind"], f: MintFinding[]) {
  for (const l of linesOf(out)) {
    // A cover letter may keep [Company Name] and [Hiring Manager] by design.
    if (kind === "cover_letter" && /^\[?(dear )?\[?(hiring manager|company name)\]?/i.test(l)) continue;
    const m = l.match(PLACEHOLDER_RE);
    if (m && !(kind === "cover_letter" && /\[(company name|hiring manager)\]/i.test(m[0]))) {
      f.push({ rule: "STD-F05", severity: "BLOCK", line: l, why: "A placeholder is still on the page. Fill it in with the real detail or take it out." });
    }
    if (FILLER_RE.test(l)) {
      f.push({ rule: "STD-F02", severity: "BLOCK", line: l, why: "This section says it has nothing in it. Leave the section off the page instead." });
    }
  }
}

// ---- STD-F06: no tool marks on the page ----------------------------------
const TOOL_MARK_RE = /(steel ?man|steelmanresumes|rush mode|generated by|the forge|the refinery|t\.ROY)/i;

function checkToolMarks(out: string, f: MintFinding[]) {
  for (const l of linesOf(out)) {
    if (TOOL_MARK_RE.test(l)) {
      f.push({ rule: "STD-F06", severity: "BLOCK", line: l, why: "The page names the tool that made it. Your resume should read as yours." });
    }
  }
}

// ---- STD-F01 / STD-F02: dated entries under experience -------------------
const SECTION_RE = /^(?:professional experience|work experience|experience|employment(?: history)?|work history)$/i;
const NEXT_SECTION_RE = /^[A-Z][A-Z &/]{3,}$/;
// Standard resume headings in any case ("Work Experience", "Education:"), so a
// Title Case page ends a section where an ALL CAPS page would.
const KNOWN_HEADING_RE = /^(?:(?:professional |work |relevant |volunteer )?experience|employment(?: history)?|work history|education(?: (?:and|&) training)?|training|certifications?(?: (?:and|&) licenses?)?|licenses?(?: (?:and|&) certifications?)?|volunteer(?: work)?|projects|awards|references|(?:career |professional )?summary|profile|objective|(?:core |key )?(?:skills|competencies)|languages|additional information):?$/i;

const isSectionEnd = (l: string) => (NEXT_SECTION_RE.test(l) && !l.includes("|")) || KNOWN_HEADING_RE.test(l);
const isBullet = (l: string) => /^[-•*]/.test(l);
const hasYear = (l: string) => new RegExp(YEAR_RE.source).test(l);

// A line that only carries dates, or a place and dates: "2019 - 2023",
// "Jan 2019 to Present", "Chicago, IL | 2019 - 2023". Some layouts put a job's
// dates on the line under its title.
const DATE_PART_RE = /^(?:[A-Za-z]{3,9}\.?\s+|\d{1,2}\/)?(?:19|20)\d{2}(?:\s*(?:-|\u2013|\u2014|to)\s*(?:(?:[A-Za-z]{3,9}\.?\s+|\d{1,2}\/)?(?:19|20)\d{2}|present|current|now))?$/i;
const PLACE_PART_RE = /^[A-Za-z .'-]+,\s*[A-Za-z]{2,}\.?$/;
function isDateLine(l: string): boolean {
  if (isBullet(l) || !hasYear(l)) return false;
  if (!l.includes("|")) return true;
  const parts = l.split("|").map((p) => p.trim()).filter(Boolean);
  return parts.some((p) => DATE_PART_RE.test(p)) && parts.every((p) => DATE_PART_RE.test(p) || PLACE_PART_RE.test(p));
}

// An entry header names a title or employer before its first "|". Lines that
// only use "|" to separate other things are not job entries: a page footer
// ("555-555-0100 | Page 2") or a scope line ("Reports: 12 Direct | Budget $4M").
function isEntryHeader(l: string): boolean {
  if (isBullet(l) || !l.includes("|")) return false;
  const first = l.split("|")[0].trim();
  return /[A-Za-z]{2,}/.test(first) && !first.includes(":");
}

function checkExperienceDates(out: string, f: MintFinding[]) {
  const ls = linesOf(out);
  const start = ls.findIndex((l) => SECTION_RE.test(l));
  if (start < 0) return;
  for (let i = start + 1; i < ls.length; i++) {
    const l = ls[i];
    if (isSectionEnd(l)) break;
    // An entry header: "TITLE | Company | ..." (bullets start with a dash or dot).
    if (!isEntryHeader(l)) continue;
    const next = ls[i + 1] ?? "";
    if (!hasYear(l) && !(isDateLine(next) && !isSectionEnd(next))) {
      f.push({ rule: "STD-F01", severity: "BLOCK", line: l, why: "This job has no dates. Employers expect dates, and a job without them reads as hiding something." });
    }
    const parts = l.split("|").map((p) => p.trim());
    if (parts.length >= 2 && (!parts[0] || !parts[1])) {
      f.push({ rule: "STD-F02", severity: "BLOCK", line: l, why: "This entry is missing a job title or an employer." });
    }
  }
}

// ---- STD-A02: no dash punctuation -----------------------------------------
// As the standard writes it: no em dash, no en dash, no "--". An en dash in a
// date range is still flagged: a plain hyphen ("2019 - 2023") reads the same
// and carries no machine look. A run of three or more hyphens (a divider line)
// is not a dash in a sentence and is left alone.
const DASH_PUNCT_RE = /[\u2014\u2013]|(?<!-)--(?!-)/;
// An en dash between a date and a date (or "Present").
const EN_DASH_RANGE_RE = /(\d)\s*\u2013\s*(?=\d|[A-Za-z]{3,9}\.?\s+\d|present\b|current\b|now\b)/gi;

function checkDashes(out: string, f: MintFinding[]) {
  for (const l of linesOf(out)) {
    if (!DASH_PUNCT_RE.test(l)) continue;
    // Only date ranges carry the dash: the fix is a plain hyphen, not a period.
    const rangeOnly = !DASH_PUNCT_RE.test(l.replace(EN_DASH_RANGE_RE, "$1-"));
    f.push({
      rule: "STD-A02",
      severity: "FIX",
      line: l,
      why: rangeOnly
        ? "A long dash in a date range reads as machine-written. Use a plain hyphen: 2019 - 2023."
        : "A long dash used as punctuation reads as machine-written. Use a period or a comma.",
    });
  }
}

// ---- STD-T01 (narrow): skills grid terms the person never mentioned -------
// Deterministic only for the competencies grid: a term none of whose content
// words appear in the person's words is a claim to confirm, not a fact.
const STOP = new Set(["and", "of", "the", "for", "with", "in", "on", "to", "a", "an", "&", "operations", "management", "skills"]);
const GRID_RE = /^(?:core competencies|skills|key skills|competencies)$/i;

// Match on a shared 4-letter start ("prep" in "prepped" and "preparation"),
// so a person's own word in another form is not flagged.
const head = (w: string) => w.slice(0, 4);

function checkGrid(out: string, src: string, f: MintFinding[]) {
  const ls = linesOf(out);
  const start = ls.findIndex((l) => GRID_RE.test(l));
  if (start < 0) return;
  const srcWords = new Set((src.toLowerCase().match(/[a-z]+/g) ?? []).filter((w) => w.length > 2).map(head));
  for (let i = start + 1; i < ls.length; i++) {
    const l = ls[i];
    if (isSectionEnd(l)) break;
    for (const term of l.split("|").map((t) => t.trim()).filter(Boolean)) {
      const words = (term.toLowerCase().match(/[a-z]+/g) ?? []).filter((w) => !STOP.has(w) && w.length > 2);
      if (!words.length) continue;
      if (words.some((w) => srcWords.has(head(w)))) continue;
      f.push({ rule: "STD-T01", severity: "FIX", line: term, why: `"${term}" isn't in anything you told us. Keep it only if you can give a real example of it.` });
    }
  }
}

export function runMintCheck(input: MintCheckInput): MintCheckResult {
  const out = input.output || "";
  const src = input.source || "";
  const findings: MintFinding[] = [];
  checkYears(out, src, findings);
  checkNumbers(out, src, findings, input.kind);
  checkCharacter(out, src, findings);
  checkEuphemisms(out, src, findings);
  checkLegalStatus(out, src, findings);
  checkPlaceholders(out, input.kind, findings);
  checkToolMarks(out, findings);
  if (input.kind !== "cover_letter") {
    checkExperienceDates(out, findings);
    checkGrid(out, src, findings);
  }
  checkDashes(out, findings);
  const blockCount = findings.filter((x) => x.severity === "BLOCK").length;
  return { findings, blockCount, fixCount: findings.length - blockCount, passesDeterministic: blockCount === 0 };
}
