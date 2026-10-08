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
 * Rules come from the shared rulebook (resumeRules.ts); a finding's rule id
 * maps back to its rulebook rule with rulesForStd().
 *
 * Pure: no I/O, safe in the browser and on the server.
 */

import { normalizeDigits, numberTokens, numberValues } from "./numberRead";
import { stemOf } from "./wordStem";
import { isCredentialTerm } from "./credentialWords";
import { RESUME_RULES_VERSION } from "./resumeRules";

export type MintSeverity = "BLOCK" | "FIX";

export interface MintFinding {
  rule: string;
  severity: MintSeverity;
  /** The line (or phrase) the finding is about, as it appears in the output. */
  line: string;
  /** Plain words for the person. */
  why: string;
  /** Which check inside a rule raised it, when a rule has more than one. */
  kind?: "grid_term" | "sole_actor" | "missing_title" | "empty_section" | "added_number" | "dropped_number" | "credential_status" | "credential_upgrade" | "credential_unsaid" | "title_unsaid" | "grid_scope_term" | "credential_status_claimed" | "dateless_page" | "scope_unsaid";
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
  /** The rulebook version these findings were graded against. */
  rulesVersion: string;
}

// Spacing and hyphens are not words: "Self-Employed" on the page and
// "self employed" in the person's words are the same phrase. Compare with
// every space and hyphen (and the dash look-alikes) removed.
const squash = (s: string) => s.toLowerCase().replace(/[\s\-\u2010-\u2015]+/g, "");

/** True when the person's own words carry this phrase, ignoring spacing and hyphens. */
function saidBy(src: string, phrase: string): boolean {
  return squash(src).includes(squash(phrase));
}

export function linesOf(text: string): string[] {
  return text.split("\n").map((l) => l.trim()).filter(Boolean);
}

// A contact line: email, phone, or a ZIP after a state. Digits inside it
// ("59923") are not the number a finding is about.
export const CONTACT_LINE_RE = /@|\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}|\b[A-Z]{2}\s+\d{5}(?:-\d{4})?\b/;
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * The line a finding is about. Prefers the needle as a whole token ("23" in
 * "23 days", not inside "59923") on a line that is not the contact line.
 */
function lineContaining(text: string, needle: string): string {
  const n = needle.toLowerCase();
  // A digit needle may carry a unit right after it ("3x", "12k", "30%"); the
  // token must not sit inside a longer number ("23" in "2023" or "59923").
  const token = /^\d/.test(n)
    ? new RegExp(`(?<![\\w.])${escapeRe(n)}(?:x|k|m|%|\\+)?(?![\\w]|\\.\\d)`)
    : new RegExp(`(?<![\\w])${escapeRe(n)}(?![\\w]|\\.\\d)`);
  // Numbers are compared without thousands commas ("1,500" is "1500").
  const flat = (l: string) => l.toLowerCase().replace(/(\d),(?=\d{3}\b)/g, "$1");
  const ls = linesOf(text);
  const body = ls.filter((l) => !CONTACT_LINE_RE.test(l));
  return (
    body.find((l) => token.test(flat(l))) ??
    ls.find((l) => token.test(flat(l))) ??
    body.find((l) => flat(l).includes(n)) ??
    ls.find((l) => flat(l).includes(n)) ??
    needle
  );
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

// ---- STD-T02: numbers both ways, compared by value -------------------------
// numberRead reads digits, number words ("forty-two", "four hundred thousand",
// "a decade", "two thousandths"), multipliers ("3x", "doubled", "in half"),
// ranks ("ranked first") and other scripts' digits, all as values.

/** The values of every number claim in a text ("forty-two" and "42" are both "42"). */
export function numbersIn(text: string): Set<string> {
  return numberValues(text);
}

/** How a value reads to a person in a message ("~100s" reads as "hundreds"). */
function sayNumber(raw: string, value: string): string {
  return raw.trim() || value;
}

/** The first line holding a number with this value (body lines before the contact line), and how it is written there. */
function numberLine(text: string, value: string): { line: string; raw: string } | undefined {
  const ls = linesOf(text);
  const body = ls.filter((l) => !CONTACT_LINE_RE.test(l));
  for (const l of [...body, ...ls]) {
    const t = numberTokens(l).find((x) => x.value === value);
    if (t) return { line: l, raw: normalizeDigits(l).slice(t.index, t.index + t.length) };
  }
  return undefined;
}

function checkNumbers(out: string, src: string, f: MintFinding[], kind: MintCheckInput["kind"]) {
  const srcNums = numbersIn(src);
  const outNums = numbersIn(out);
  for (const n of outNums) {
    if (srcNums.has(n)) continue;
    const at = numberLine(out, n);
    f.push({
      rule: "STD-T02",
      severity: "BLOCK",
      line: at?.line ?? n,
      why: `The number ${sayNumber(at?.raw ?? "", n)} is not in anything you told us. Only numbers you gave go on the page.`,
      kind: "added_number",
    });
  }
  // A letter need not carry every number; a resume must (dropping one is a FIX).
  if (kind === "cover_letter") return;
  for (const n of srcNums) {
    if (outNums.has(n) || (/^\d$/.test(n))) continue;
    const at = numberLine(src, n);
    f.push({
      rule: "STD-T02",
      severity: "FIX",
      line: at?.line ?? n,
      why: `You gave the number ${sayNumber(at?.raw ?? "", n)} and it did not make it onto the page. A number you gave belongs on the page the way you said it.`,
      kind: "dropped_number",
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
      f.push({ rule: "STD-F02", severity: "BLOCK", line: l, why: "This section says it has nothing in it. Leave the section off the page instead.", kind: "empty_section" });
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

export const isSectionEnd = (l: string) => (NEXT_SECTION_RE.test(l) && !l.includes("|")) || KNOWN_HEADING_RE.test(l);
const isBullet = (l: string) => /^[-•*]/.test(l);
const hasYear = (l: string) => new RegExp(YEAR_RE.source).test(l);

// A line that only carries dates, or a place and dates: "2019 - 2023",
// "Jan 2019 to Present", "Chicago, IL | 2019 - 2023". Some layouts put a job's
// dates on the line under its title.
// An optional length in brackets may follow: "June 2021 - Present (3 years)".
const DATE_PART_RE = /^(?:[A-Za-z]{3,9}\.?\s+|\d{1,2}\/)?(?:19|20)\d{2}(?:\s*(?:-|\u2013|\u2014|to)\s*(?:(?:[A-Za-z]{3,9}\.?\s+|\d{1,2}\/)?(?:19|20)\d{2}|present|current|now))?(?:\s*\(\s*\d+\+?\s*(?:years?|yrs?|months?|mos?)(?:,?\s*\d+\s*(?:months?|mos?))?\s*\))?$/i;
const PLACE_PART_RE = /^[A-Za-z .'-]+,\s*[A-Za-z]{2,}\.?$/;
// "Chicago, IL 2019 - 2023" or "Chicago, IL, Jan 2019 to Present" (no pipe).
const PLACE_THEN_DATE_RE = /^([A-Za-z .'-]+,\s*[A-Za-z]{2,}\.?)[,\s]+(.+)$/;
export function isDateLine(l: string): boolean {
  if (isBullet(l) || !hasYear(l)) return false;
  // A sentence with a year in it ("Earned OSHA 10 in 2021") is not a date line.
  if (!l.includes("|")) {
    if (DATE_PART_RE.test(l)) return true;
    const m = l.match(PLACE_THEN_DATE_RE);
    return !!m && PLACE_PART_RE.test(m[1].trim()) && DATE_PART_RE.test(m[2].trim());
  }
  const parts = l.split("|").map((p) => p.trim()).filter(Boolean);
  return parts.some((p) => DATE_PART_RE.test(p)) && parts.every((p) => DATE_PART_RE.test(p) || PLACE_PART_RE.test(p));
}

// An entry header names a title or employer before its first "|". Lines that
// only use "|" to separate other things are not job entries: a page footer
// ("555-555-0100 | Page 2") or a scope line ("Reports: 12 Direct | Budget $4M").
export function isEntryHeader(l: string): boolean {
  if (isBullet(l) || !l.includes("|")) return false;
  const first = l.split("|")[0].trim();
  return /[A-Za-z]{2,}/.test(first) && !first.includes(":");
}

// A page with content and no year anywhere is a dateless page, whatever its
// headings say, bullets or not (a skills-only page counts). Never finished.
function checkDatedPage(out: string, f: MintFinding[]) {
  const ls = linesOf(out).filter((l) => !CONTACT_LINE_RE.test(l));
  // The name, a headline and one more line are not yet a page to judge.
  if (ls.length < 4) return;
  if (ls.some(hasYear)) return;
  f.push({
    rule: "STD-F01",
    severity: "BLOCK",
    line: ls.find(isBullet) ?? ls[ls.length - 1],
    why: "This page has no dates anywhere. Employers expect dates, and a page without them reads as hiding something.",
    kind: "dateless_page",
  });
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
      f.push({ rule: "STD-F02", severity: "BLOCK", line: l, why: "This entry is missing a job title or an employer.", kind: "missing_title" });
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

// ---- STD-T01 (narrow): skills terms the person never mentioned -----------
// Deterministic only for the skills section: a term none of whose content
// words appear in the person's words is a claim to confirm, not a fact. The
// section may be one comma-separated line, short labeled lines
// ("Equipment: forklift, pallet jack"), or an old pipe grid.
const STOP = new Set(["and", "of", "the", "for", "with", "in", "on", "to", "a", "an", "&", "operations", "management", "skills"]);
const GRID_RE = /^(?:core competencies|skills|key skills|competencies|core skills)$/i;

// Match on a shared 4-letter start ("prep" in "prepped" and "preparation"),
// so a person's own word in another form is not flagged.
const head = (w: string) => w.slice(0, 4);

/** The skill terms on one skills-section line, without a "Label:" prefix. */
export function skillTermsOf(line: string): string[] {
  const body = line.replace(/^[-•*]\s*/, "").replace(/^[A-Za-z][A-Za-z &/]{1,30}:\s*/, "");
  return body.split(/[|,;]/).map((t) => t.trim()).filter(Boolean);
}

// Scope words: a skills term carrying one of these claims to have run or led
// something. It passes only when the person used that same word (the
// true-scope rule, applied to skills).
const SCOPE_STEMS = ["supervis", "lead", "led", "manag", "train", "schedul", "plan", "budget", "negotiat", "forecast", "direct", "oversee", "oversaw", "coordinat", "mentor"];
const scopeOf = (w: string) => SCOPE_STEMS.find((s) => w.startsWith(s) || (s === "led" && w === "led"));
// A credential term is checked as a credential (credentialMentions), never as
// a skill. One shared test (credentialWords), so nothing is both.

function checkGrid(out: string, src: string, f: MintFinding[]) {
  const ls = linesOf(out);
  const start = ls.findIndex((l) => GRID_RE.test(l));
  if (start < 0) return;
  const srcWordList = (src.toLowerCase().match(/[a-z]+/g) ?? []).filter((w) => w.length > 2);
  const srcStems = new Set(srcWordList.map(stemOf));
  const srcFlat = ` ${srcWordList.join(" ")} `;
  for (let i = start + 1; i < ls.length; i++) {
    const l = ls[i];
    if (isSectionEnd(l)) break;
    for (const term of skillTermsOf(l)) {
      if (isCredentialTerm(term)) continue;
      const words = (term.toLowerCase().match(/[a-z]+/g) ?? []).filter((w) => !STOP.has(w) && w.length > 2);
      if (!words.length) continue;
      // The whole term as the person wrote it passes.
      if (srcFlat.includes(` ${words.join(" ")} `)) continue;
      // A scope word they never used never passes on another word's match.
      const scopeUnsaid = words.some((w) => {
        const sc = scopeOf(w);
        return sc !== undefined && !srcWordList.some((x) => x.startsWith(sc) || (sc === "lead" && x === "led") || (sc === "led" && x.startsWith("lead")));
      });
      if (!scopeUnsaid && words.some((w) => srcStems.has(stemOf(w)))) continue;
      f.push(
        scopeUnsaid
          ? { rule: "STD-T01", severity: "FIX", line: term, why: `"${term}" says you ran or led something, and that isn't in anything you told us.`, kind: "grid_scope_term" }
          : { rule: "STD-T01", severity: "FIX", line: term, why: `"${term}" isn't in anything you told us. Keep it only if you can give a real example of it.`, kind: "grid_term" }
      );
    }
  }
}

// ---- STD-T01 (narrow): shared work written as sole work -----------------
// The person said they "helped with" or "assisted with" something; the page
// names that same work on a line with no sign it was shared or supervised.
// A hint for the person to settle, never a verdict: FIX.
// "helped with X", "assisted in X", "helped out on X". Not "helped customers":
// helping a customer is the person's own work, not shared work. The object is
// the phrase after the preposition ("boiler blowdown"), and a page line is
// flagged only when it names the phrase's head noun, its last word
// ("blowdown"). A neighbouring duty that shares a modifier ("tested boiler
// water", "answered customer questions") is not flagged.
const HELPED_RE = /\b(?:helped|helping|help|assisted|assisting|assist)\s+(?:out\s+)?(?:with|in|on)\s+((?:[a-z][a-z'-]*\s*){1,5})/gi;
const OBJECT_STOP = new Set([
  "the", "a", "an", "some", "my", "our", "his", "her", "their", "under", "with", "for", "at", "on", "in", "and", "or",
  "by", "when", "from", "to", "during", "while", "as", "of", "every", "each", "them", "they", "other", "others",
  "people", "anything", "everything", "whatever", "where", "around", "stuff", "things", "out", "it",
]);
// Signs on the page line that the work was shared or supervised. A bare
// "with" is not one: "with a wrench" names a tool, not a person.
const SHARED_RE = /\b(?:help\w*|assist\w*|under|alongside|together|supported|support(?:ing)?)\b|\bwith (?:the |a |an |my |our |other |two |three )?(?:[a-z]+ )?(?:operators?|leads?|supervisors?|managers?|team|crew|foreman|mechanics?|nurses?|cooks?|chefs?|techs?|technicians?|electricians?|plumbers?|drivers?|partners?|coworkers?|others|staff)\b/i;
const h5 = (w: string) => w.slice(0, Math.min(w.length, 5));

function objectPhrase(raw: string): string[] {
  const words: string[] = [];
  for (const w of raw.toLowerCase().split(/\s+/).filter(Boolean)) {
    if (OBJECT_STOP.has(w)) {
      if (words.length) break;
      continue;
    }
    words.push(w.replace(/'s$/, ""));
  }
  return words.filter((w) => w.length >= 3).map(h5);
}

function checkSoleActor(out: string, src: string, f: MintFinding[]) {
  const phrases: string[][] = [];
  for (const m of src.matchAll(HELPED_RE)) {
    const p = objectPhrase(m[1]);
    if (p.length && p[p.length - 1].length >= 4) phrases.push(p);
  }
  if (!phrases.length) return;
  const seen = new Set<string>();
  for (const l of linesOf(out)) {
    if (isSectionEnd(l) || isEntryHeader(l) || CONTACT_LINE_RE.test(l) || SHARED_RE.test(l)) continue;
    const heads = new Set((l.toLowerCase().match(/[a-z][a-z-]+/g) ?? []).map(h5));
    if (!phrases.some((p) => heads.has(p[p.length - 1])) || seen.has(l)) continue;
    seen.add(l);
    f.push({
      rule: "STD-T01",
      severity: "FIX",
      line: l,
      why: "Your words say you helped with this work. This line reads like you did it on your own. Keep it shared if it was shared.",
      kind: "sole_actor",
    });
  }
}

// ---- STD-T03 (narrow): a credential whose type or status nobody gave -----
// Used by the draft/finished status, not by runMintCheck (credential claims on
// the page are checked by the consumer app's credential-truth module). A
// credential line passes when the page or the person's words give its year or
// a status word; otherwise it is a question for the person.
const CRED_SECTION_RE = /^(?:certifications?|licenses?|licences?|credentials?|certifications? (?:and|&) licen[cs]es?|licen[cs]es? (?:and|&) certifications?)$/i;
export const CREDENTIAL_WORD_RE = /\b(?:certif\w*|licen[cs]e[ds]?|OSHA[\s-]*\d+|CDL|CNA|ServSafe|EPA\s*608|CPR|first aid|forklift card)\b/i;
// A credential by its own name: it is a credential wherever it appears.
const NAMED_CREDENTIAL_RE = /\b(?:OSHA[\s-]*\d+|CDL|CNA|ServSafe|EPA\s*608|CPR|first aid|forklift card)\b/i;
// Outside a credentials section, a generic word ("license", "certified")
// makes a credential line only on a short line or next to a holding verb,
// so "checked customer IDs and licenses at the door" is not one.
const HOLD_VERB_RE = /\b(?:earned|obtained|got|hold|holds|held|passed|completed|received|renewed|certified|licensed)\b/i;
const isCredentialMention = (l: string) =>
  NAMED_CREDENTIAL_RE.test(l) ||
  (CREDENTIAL_WORD_RE.test(l) && ((l.replace(/^[-•*]\s*/, "").match(/\S+/g) ?? []).length <= 5 || HOLD_VERB_RE.test(l)));
export const STATUS_WORD_RE = /\b(?:active|current|valid|expired|expires|inactive|lapsed|in progress|enrolled|completed|finished|passed|renewed|suspended|revoked|through|until|good for)\b/i;
const GENERIC_CRED_WORDS = new Set(["certification", "certificate", "certified", "license", "licence", "licensed", "card", "training", "course", "class", "program", "level", "state", "issued"]);

/** The credential lines on a resume: every line under a credentials heading, plus any other line naming one. */
export function credentialLinesOf(out: string): string[] {
  const ls = linesOf(out);
  const found: string[] = [];
  let inCreds = false;
  for (let i = 0; i < ls.length; i++) {
    const l = ls[i];
    if (CRED_SECTION_RE.test(l.replace(/:$/, ""))) { inCreds = true; continue; }
    if (isSectionEnd(l)) { inCreds = false; continue; }
    if (i === 0 || CONTACT_LINE_RE.test(l)) continue;
    if (inCreds || isCredentialMention(l)) found.push(l);
  }
  return found;
}

/** True when a text gives a credential a year or a status word. */
export function hasCredentialStatus(text: string): boolean {
  return new RegExp(YEAR_RE.source).test(text) || STATUS_WORD_RE.test(text);
}

/**
 * The word that names a credential line's credential, used to find what the
 * person said about it. On a short line that is its first specific word. A long
 * line (a summary sentence) names its credential only by a known name; its
 * first word is usually not the credential, and matching on it raised false
 * BLOCKs, so a long line without a known name gives no key.
 */
function credentialKey(line: string): string | undefined {
  const name = line.replace(/^[-•*]\s*/, "");
  const words = name.match(/\S+/g) ?? [];
  if (words.length > 8) {
    const named = name.match(NAMED_CREDENTIAL_RE);
    return named ? named[0] : undefined;
  }
  return (name.match(/[A-Za-z0-9]+/g) ?? []).find((w) => w.length >= 3 && !GENERIC_CRED_WORDS.has(w.toLowerCase()));
}

const CLAIM_RE = /\b(?:certified|certification|licensed|license|licence)\b/i;
const COURSE_RE = /\b(?:class|classes|course|courses|training|program|coursework)\b/i;
const HOLD_RE = /\b(?:certified|certification|certificate|licensed|license|licence|passed|card|registry)\b/i;

/**
 * A credential written up as a certification or license when the person's
 * words only describe a class or training for it: BLOCK. Deterministic and
 * narrow: the person's sentences naming it must carry a course word and no
 * word that says they hold it.
 */
export function checkCredentialUpgrade(out: string, src: string): MintFinding[] {
  const srcUnits = src.split(/[\n.;]+/).map((u) => u.trim()).filter(Boolean);
  const f: MintFinding[] = [];
  for (const l of credentialLinesOf(out)) {
    if (!CLAIM_RE.test(l)) continue;
    const key = credentialKey(l);
    if (!key) continue;
    const said = srcUnits.filter((u) => u.toLowerCase().includes(key.toLowerCase()));
    if (!said.length) continue;
    if (said.some((u) => HOLD_RE.test(u))) continue;
    if (!said.some((u) => COURSE_RE.test(u))) continue;
    f.push({
      rule: "STD-T03",
      severity: "BLOCK",
      line: l,
      why: "Your words describe a class or training for this, not a certification or license. A class is listed as training.",
      kind: "credential_upgrade",
    });
  }
  return f;
}

export function checkCredentialStatus(out: string, src: string): MintFinding[] {
  const srcUnits = src.split(/[\n.;]+/).map((u) => u.trim()).filter(Boolean);
  const f: MintFinding[] = [];
  for (const l of credentialLinesOf(out)) {
    if (new RegExp(YEAR_RE.source).test(l) || STATUS_WORD_RE.test(l)) continue;
    const isLong = (l.match(/\S+/g) ?? []).length > 8;
    const key = credentialKey(l);
    // A long sentence with no known credential name is not a credential line.
    if (isLong && !key) continue;
    const said = key
      ? srcUnits.filter((u) => u.toLowerCase().includes(key.toLowerCase()))
      : [];
    if (said.some((u) => new RegExp(YEAR_RE.source).test(u) || STATUS_WORD_RE.test(u))) continue;
    f.push({
      rule: "STD-T03",
      severity: "FIX",
      line: l,
      why: "We don't know this credential's type or status yet: license, certification or training, and current, expired or in progress.",
      kind: "credential_status",
    });
  }
  return f;
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
    checkDatedPage(out, findings);
    checkExperienceDates(out, findings);
    checkGrid(out, src, findings);
    checkSoleActor(out, src, findings);
  }
  checkDashes(out, findings);
  const blockCount = findings.filter((x) => x.severity === "BLOCK").length;
  return {
    findings,
    blockCount,
    fixCount: findings.length - blockCount,
    passesDeterministic: blockCount === 0,
    rulesVersion: RESUME_RULES_VERSION,
  };
}
