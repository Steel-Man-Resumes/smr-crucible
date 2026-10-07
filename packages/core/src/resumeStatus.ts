/**
 * Draft vs finished: the one status contract for a resume.
 *
 * A resume is "finished" only when no BLOCK is open. Anything else is a
 * clearly marked "draft" with its open items. Every open item carries a plain
 * question for the person, built from the finding alone, that adds no fact:
 * the person's answer is the only thing that can add one.
 *
 * Inputs
 * - resumeText:    the resume exactly as the person would receive it.
 * - sourceText:    only the person's own words (their resume text, answers,
 *                  notes). Never an AI-written summary.
 * - defendAnswers: what the person said in the defend step. An answer that
 *                  stands counts as the person's own words for the check.
 *
 * The defend step (pickDefendLines) asks about at least two lines plus every
 * number and every credential. Until each of those has an answer that stands,
 * it is an open BLOCK (STD-C04: the person can explain every line).
 *
 * Pure: no I/O, safe in the browser and on the server.
 */

import { RESUME_RULES_VERSION } from "./resumeRules";
import {
  runMintCheck,
  checkCredentialStatus,
  credentialLinesOf,
  linesOf,
  numbersIn,
  isSectionEnd,
  isEntryHeader,
  isDateLine,
  CONTACT_LINE_RE,
  type MintFinding,
  type MintSeverity,
} from "./resumeMintCheckShared";

export type ResumeState = "finished" | "draft";

export interface OpenItem {
  /** Standard rule id (STD-*), or STD-C04 for a defend line not yet answered. */
  rule: string;
  severity: MintSeverity;
  /** The resume line the item is about, as it appears on the page. */
  line: string;
  /** A plain question for the person. Never suggests a fact. */
  question: string;
  /** Why it is open, in plain words. */
  why: string;
}

export interface DefendAnswer {
  /** The resume line the person was asked about, as shown to them. */
  line: string;
  /** The person's own words. */
  answer: string;
  /**
   * "stands": they explained it and it stays. "cut": they want it off.
   * "unsure": they could not explain it yet. Omitted means "stands" when
   * the answer has words in it.
   */
  verdict?: "stands" | "cut" | "unsure";
}

export type DefendReason = "number" | "credential" | "far_from_your_words";

export interface DefendLine {
  line: string;
  reasons: DefendReason[];
  question: string;
}

export interface ResumeStatusInput {
  resumeText: string;
  sourceText: string;
  defendAnswers?: DefendAnswer[];
  /** Default true False only for surfaces with no defend step yet. */
  requireDefend?: boolean;
}

export interface ResumeStatus {
  state: ResumeState;
  /** BLOCK items first, then FIX items, in page order within each. */
  openItems: OpenItem[];
  blockCount: number;
  fixCount: number;
  /** The lines the defend step asks about. */
  defendLines: DefendLine[];
  rulesVersion: string;
}

// ---- helpers ---------------------------------------------------------------

const squash = (s: string) => s.toLowerCase().replace(/[\s\-‐-―]+/g, "");
const stripBullet = (l: string) => l.replace(/^[-•*]\s*/, "").trim();
const quoted = (why: string) => why.match(/"([^"]+)"/)?.[1];
const clip = (s: string, n = 60) => (s.length > n ? `${s.slice(0, n).trim()}...` : s);

const DISTANCE_STOP = new Set([
  "with", "that", "this", "from", "into", "over", "under", "each", "they", "their", "them",
  "were", "have", "been", "also", "while", "where", "when", "which", "work", "worked",
]);
const SKILLS_HEADING_RE = /^(?:core competencies|skills|key skills|competencies|core skills)$/i;

/** True when a defend answer has words and the person did not cut or doubt the line. */
function answerStands(a: DefendAnswer | undefined): boolean {
  if (!a) return false;
  if (a.verdict === "cut" || a.verdict === "unsure") return false;
  return /[a-z0-9]/i.test(a.answer || "");
}

function credentialName(line: string): string {
  return clip(stripBullet(line).split(/[,(|]/)[0].trim() || stripBullet(line), 50);
}

/**
 * Share of a line's content words the person never used (0 = all theirs,
 * 1 = none theirs). Compared on a 5-letter start so "loaded" and "loading"
 * count as the same word.
 */
export function distanceFromSource(line: string, sourceText: string): number {
  const h = (w: string) => w.slice(0, 5);
  const src = new Set((sourceText.toLowerCase().match(/[a-z]+/g) ?? []).map(h));
  const words = (stripBullet(line).toLowerCase().match(/[a-z]+/g) ?? []).filter(
    (w) => w.length > 3 && !DISTANCE_STOP.has(w)
  );
  if (!words.length) return 0;
  return words.filter((w) => !src.has(h(w))).length / words.length;
}

/** Lines a person could be asked to explain: not the name, contact, headings, job headers or date lines. */
function bodyLines(resumeText: string): Array<{ line: string; inSkills: boolean }> {
  const ls = linesOf(resumeText);
  const out: Array<{ line: string; inSkills: boolean }> = [];
  let inSkills = false;
  ls.forEach((l, i) => {
    if (SKILLS_HEADING_RE.test(l.replace(/:$/, ""))) { inSkills = true; return; }
    if (isSectionEnd(l)) { inSkills = false; return; }
    if (i === 0 || CONTACT_LINE_RE.test(l) || isEntryHeader(l) || isDateLine(l)) return;
    out.push({ line: l, inSkills });
  });
  return out;
}

// ---- questions -------------------------------------------------------------

const DESCRIBE = "Tell me in one sentence how you'd describe this line.";

/** The question for one checker finding. Deterministic; adds no fact. */
export function questionForFinding(f: Pick<MintFinding, "rule" | "line" | "why" | "kind">): string {
  const word = quoted(f.why);
  switch (f.rule) {
    case "STD-T02":
      return f.kind === "dropped_number"
        ? "You gave us a number here and it is not on the page. Should it go back on, the way you said it?"
        : "This line has a number you didn't give us. In one sentence, how would you say this line? If you don't know a number, the line stays true without one.";
    case "STD-T05":
      return "This year is not in what you told us. What years did you do this, as best you know? If you're not sure, say so and we'll mark it to check.";
    case "STD-T07":
      return `Would you say "${word ?? "this"}" about yourself or this work? If not, it comes off.`;
    case "STD-C05":
      return "How would you describe this time in your own words? A background check may be read against this phrase.";
    case "STD-C07":
      return "Is this exactly what your papers say about your legal status? If you're not sure it's exactly true, it comes off.";
    case "STD-F05":
      return "What should go here? If you don't have it, we'll leave it off.";
    case "STD-F02":
      return f.kind === "missing_title"
        ? "What was your job title here, and who was the employer? Use the title on your paperwork if you know it."
        : "This section has nothing in it. OK to leave it off the page?";
    case "STD-F06":
      return "This line names the tool that made your page. OK to take it off?";
    case "STD-F01":
      return "What years did you work here, as best you know?";
    case "STD-A02":
      return "OK to swap the long dash for a comma or a period?";
    case "STD-T01":
      if (f.kind === "sole_actor") {
        return "Your words say you helped with this. Did you do it on your own, or with someone? Tell me in one sentence how you'd describe it.";
      }
      return `Can you tell me one time you did "${clip(f.line, 40)}" at work? If not, it comes off.`;
    case "STD-T03":
      return `Was "${credentialName(f.line)}" a license, a certification, or a training course? Is it current, expired, or still in progress?`;
    case "STD-C03":
      return "Was this your title on the paperwork?";
    default:
      return DESCRIBE;
  }
}

function questionForDefend(line: string, reasons: DefendReason[]): string {
  if (reasons.includes("credential")) {
    return `Was "${credentialName(line)}" a license, a certification, or a training course? Is it current, expired, or still in progress?`;
  }
  if (reasons.includes("number")) {
    return "If an interviewer asked how you know this number, what would you say? Tell me in one sentence.";
  }
  return DESCRIBE;
}

// ---- defend step -----------------------------------------------------------

/**
 * The lines the defend step asks about: every line with a number,
 * every credential, and the lines furthest from the person's own wording,
 * so that at least `minFurthest` (default two) non-number, non-credential
 * lines are asked when the page has them. Page order.
 *
 * Years in dates and contact digits are not "numbers" here; dates are
 * checked against the person's words by the mint check.
 */
export function pickDefendLines(
  resumeText: string,
  sourceText: string,
  opts: { minFurthest?: number } = {}
): DefendLine[] {
  const minFurthest = opts.minFurthest ?? 2;
  const body = bodyLines(resumeText || "");
  const creds = new Set(credentialLinesOf(resumeText || ""));
  const picked = new Map<string, Set<DefendReason>>();
  const add = (l: string, r: DefendReason) => {
    if (!picked.has(l)) picked.set(l, new Set());
    picked.get(l)!.add(r);
  };

  for (const { line, inSkills } of body) {
    if (creds.has(line)) add(line, "credential");
    else if (!inSkills && numbersIn(line).size > 0) add(line, "number");
  }

  const rest = body
    .filter(({ line, inSkills }) => !inSkills && !picked.has(line))
    .map(({ line }, i) => ({ line, i, d: distanceFromSource(line, sourceText || "") }))
    .sort((a, b) => b.d - a.d || a.i - b.i)
    .slice(0, minFurthest);
  for (const r of rest) add(r.line, "far_from_your_words");

  const order = body.map((b) => b.line);
  return Array.from(picked.entries())
    .sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0]))
    .map(([line, reasons]) => {
      const rs = Array.from(reasons);
      return { line, reasons: rs, question: questionForDefend(line, rs) };
    });
}

// ---- the contract ------------------------------------------------------------

/**
 * Finished or draft, with every open item and its question.
 * An open BLOCK always means "draft".
 */
export function getResumeStatus(input: ResumeStatusInput): ResumeStatus {
  const resumeText = input.resumeText || "";
  const sourceText = input.sourceText || "";
  const answers = input.defendAnswers ?? [];
  const requireDefend = input.requireDefend !== false;

  const items: OpenItem[] = [];
  const push = (rule: string, severity: MintSeverity, line: string, why: string, question: string) =>
    items.push({ rule, severity, line, why, question });

  if (!resumeText.trim()) {
    push("STD-F02", "BLOCK", "", "There is no resume text yet.", "Ready to build your resume? Start with what you've done, in your own words.");
  }
  if (!sourceText.trim()) {
    push(
      "STD-T01",
      "BLOCK",
      "",
      "We have none of your own words to check this page against, so nothing on it is checked.",
      "Tell us about your work in your own words, so we can check each line against what you said."
    );
  }

  // Answers that stand are the person's own words.
  const standing = answers.filter(answerStands);
  const checkedSource = [sourceText, ...standing.map((a) => a.answer)].join("\n");

  const defendLines = resumeText.trim() ? pickDefendLines(resumeText, sourceText) : [];

  if (resumeText.trim() && sourceText.trim()) {
    const mint = runMintCheck({ output: resumeText, source: checkedSource, kind: "resume" });
    const findings = [...mint.findings, ...checkCredentialStatus(resumeText, checkedSource)];
    for (const f of findings) push(f.rule, f.severity, f.line, f.why, questionForFinding(f));

    if (requireDefend) {
      const byLine = new Map(answers.map((a) => [squash(a.line), a]));
      for (const d of defendLines) {
        const a = byLine.get(squash(d.line));
        if (answerStands(a)) continue;
        const why =
          a?.verdict === "cut"
            ? "You said this line should come off. It is still on the page."
            : a?.verdict === "unsure"
              ? "You weren't sure how to explain this line yet. Reword it with your own words, or take it off."
              : "You haven't explained this line in your own words yet. Every number, every credential and the lines furthest from your words get explained before the page is finished.";
        push("STD-C04", "BLOCK", d.line, why, a?.verdict === "cut" ? "OK to take this line off now?" : d.question);
      }
    }
  }

  const order = linesOf(resumeText);
  const pos = (l: string) => {
    const i = order.indexOf(l);
    return i < 0 ? order.length : i;
  };
  const byPage = (a: OpenItem, b: OpenItem) => pos(a.line) - pos(b.line);
  const openItems = [
    ...items.filter((x) => x.severity === "BLOCK").sort(byPage),
    ...items.filter((x) => x.severity === "FIX").sort(byPage),
  ];

  const blockCount = openItems.filter((x) => x.severity === "BLOCK").length;
  return {
    state: blockCount > 0 ? "draft" : "finished",
    openItems,
    blockCount,
    fixCount: openItems.length - blockCount,
    defendLines,
    rulesVersion: RESUME_RULES_VERSION,
  };
}
