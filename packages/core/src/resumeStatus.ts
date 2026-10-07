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
 * - secondCheckFindings (optional): what a model from a different family
 *                  flagged when it read the page against the person's words.
 *                  Validated again here (a finding must point at a line on
 *                  this page, and its shown text may not add a fact), then
 *                  merged as open items. Absent: the mint check alone, exactly
 *                  as before.
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
  checkCredentialUpgrade,
  credentialLinesOf,
  hasCredentialStatus,
  linesOf,
  numbersIn,
  isSectionEnd,
  isEntryHeader,
  isDateLine,
  CONTACT_LINE_RE,
  type MintFinding,
  type MintSeverity,
} from "./resumeMintCheckShared";
import {
  SECOND_CHECK_RULE,
  validateSecondCheckFindings,
  type SecondCheckFinding,
} from "./secondCheckShared";

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
  /** Set only on items raised by the second check. Mint and defend items leave it out. */
  from?: "second_check";
  /** The checker's finding kind, when it has one (for example "grid_term" for a skills term). */
  kind?: string;
}

export interface DefendAnswer {
  /** The resume line the person was asked about, as shown to them. */
  line: string;
  /** The person's own words. */
  answer: string;
  /**
   * "stands": they explained it and it stays. "cut": they want it off.
   * "unsure": they could not explain it yet. Only "stands" ever counts.
   */
  verdict?: "stands" | "cut" | "unsure";
  /**
   * "rewrite": the person typed the line itself (it replaced the written
   * one). The caller may add rewrites to the person's own words; an ordinary
   * answer is never added to the source (no anchoring path, DEC-45).
   */
  kind?: "rewrite";
  /**
   * For a rewrite: the line it replaced, as first written (the writer's line,
   * never an earlier rewrite). Only words and numbers the rewrite INTRODUCED
   * over this line may join the person's own words (see introducedWords).
   */
  replaced?: string;
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
  /**
   * Findings from the second check (a different model family), when it ran.
   * Leave out when it did not run: the status is then the mint check alone.
   */
  secondCheckFindings?: ReadonlyArray<SecondCheckFinding>;
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
const PLACE_LINE_RE = /^[A-Za-z .'-]+,\s*[A-Za-z]{2,}\.?(?:\s+\d{5}(?:-\d{4})?)?(?:\s*\|.*)?$/;
const SKILLS_HEADING_RE = /^(?:core competencies|skills|key skills|competencies|core skills)$/i;

// "I don't know" and friends: an answer that explains nothing.
const NO_ANSWER_RE = /\b(?:i\s+)?(?:do\s*n['’]?t|dont|do not)\s+(?:know|remember|recall)\b|\bnot sure\b|\bno idea\b|\bidk\b|\bunsure\b|\bcan['’]?t remember\b/i;
// Words that deny something, for the contradiction check.
const NEGATION_RE = /^(?:never|not|no|nope|without|didn['’]?t|didnt|don['’]?t|dont|wasn['’]?t|wasnt|weren['’]?t|isn['’]?t|haven['’]?t|havent|hasn['’]?t|hadn['’]?t|can['’]?t|cant|couldn['’]?t|won['’]?t|nor)$/i;
// Credential claims are checked by their stem, so "never got certified" hits "Certified".
const CLAIM_STEMS = ["certi", "licen", "licenc", "train", "super", "manag", "lead"];

/**
 * True when the answer denies the line: a negation word within four words of
 * one of the line's own key words ("never got certified" against "Forklift
 * Certified", "I didn't run the line" against "Ran the line").
 */
export function answerContradictsLine(answer: string, line: string): boolean {
  const h = (w: string) => w.slice(0, 5);
  const lineHeads = new Set(
    (stripBullet(line).toLowerCase().match(/[a-z]+/g) ?? []).filter((w) => w.length > 2 && !DISTANCE_STOP.has(w)).map(h)
  );
  const words = answer.toLowerCase().match(/[a-z'’]+/g) ?? [];
  return words.some((w, i) => {
    if (!NEGATION_RE.test(w)) return false;
    return words.slice(i + 1, i + 5).some((x) => {
      const hx = h(x.replace(/['’]s$/, ""));
      return lineHeads.has(hx) || (CLAIM_STEMS.some((st) => hx.startsWith(st)) && Array.from(lineHeads).some((lh) => lh.startsWith(hx.slice(0, 4))));
    });
  });
}

// Words that carry no meaning of their own in an answer.
const ANSWER_STOP = new Set([
  "the", "and", "that", "this", "these", "those", "was", "were", "are", "did", "does", "done", "doing",
  "has", "have", "had", "for", "with", "from", "but", "you", "your", "yes", "yeah", "yep", "yup", "okay",
  "true", "right", "correct", "sure", "its", "it's", "that's", "thats", "what", "all", "just", "very",
  "really", "can", "will", "would", "could", "should", "also", "there", "they", "them", "then", "than",
  "our", "who", "how", "why", "when", "where", "which", "line", "i'm", "i've", "ive", "him", "her",
  "she", "his", "hers", "not", "too", "yes,", "absolutely", "definitely", "course", "indeed", "exactly",
  "written", "is", "it", "me", "my", "we", "us",
]);
// A bare yes: an answer that agrees and explains nothing.
const BARE_YES_RE = /^(?:y|ye|yes|yeah|yep|yup|ya|ok|okay|k|sure|correct|true|right|exactly|indeed|absolutely|definitely|of course|i did|i did it|i did that|it's true|its true|it is true|that's true|thats true|that's right|thats right|that is right|that is true|all true|true as written|yes it is|yes i did|confirmed|confirm|agreed|agree)$/;

const stem5 = (w: string) => w.slice(0, 5);

/** The words that carry meaning in a piece of text: lowercase, three letters or more, no filler. */
export function contentWords(text: string): string[] {
  return (text.toLowerCase().match(/[a-z][a-z'’]*/g) ?? [])
    .map((w) => w.replace(/['’]s$/, "").replace(/’/g, "'"))
    .filter((w) => w.length >= 3 && !ANSWER_STOP.has(w));
}

/**
 * True when a typed answer explains something: at least three content
 * words, not a bare yes, and at least one content word that is not already
 * in the line (an answer that only pastes the line back says nothing new).
 */
export function answerExplains(answer: string, line: string): boolean {
  const text = (answer || "").trim();
  if (!/[a-z0-9]/i.test(text) || NO_ANSWER_RE.test(text)) return false;
  const bare = text.toLowerCase().replace(/[^a-z' ]+/g, " ").replace(/\s+/g, " ").trim();
  if (BARE_YES_RE.test(bare)) return false;
  const words = contentWords(text);
  if (words.length < 3) return false;
  const lineStems = new Set(contentWords(stripBullet(line)).map(stem5));
  return words.some((w) => !lineStems.has(stem5(w)));
}

/**
 * An answer stands only when the person marked it "stands", it explains
 * something (answerExplains), it is not an "I don't know", and it does not
 * deny its own line. A missing verdict is not an answer.
 *
 * A rewrite (the person typed the line itself) stands when it is the line on
 * the page and every content word of that line is now in the person's own
 * words (`sourceText`, which the caller extends with only what the rewrite
 * introduced). A rewrite that only adds a period to the written line leaves
 * the written words unsourced, so it does not stand.
 */
export function answerStands(a: DefendAnswer | undefined, line?: string, sourceText?: string): boolean {
  if (!a || a.verdict !== "stands") return false;
  const target = line ?? a.line;
  if (a.kind === "rewrite") {
    if (typeof a.replaced !== "string" || sourceText === undefined) return false;
    if (squash(stripBullet(a.answer)) !== squash(stripBullet(target))) return false;
    return distanceFromSource(target, sourceText) === 0;
  }
  if (!answerExplains(a.answer || "", target)) return false;
  return !answerContradictsLine(a.answer || "", target);
}

/**
 * What a rewrite introduced over the line it replaced: content words whose
 * five-letter start is not in the replaced line, and numbers (digits or
 * number words) that are not in it. Punctuation, a status word already there,
 * or the written number typed back introduce nothing. Returned in the order
 * typed, one string.
 */
export function introducedWords(rewrite: string, replaced: string): string {
  const oldStems = new Set((replaced.toLowerCase().match(/[a-z]+/g) ?? []).map(stem5));
  const oldNums = numbersIn(replaced);
  const out: string[] = [];
  for (const tok of rewrite.match(/\$?\d[\d,]*(?:\.\d+)?[%kKxX+]?|[A-Za-z][A-Za-z'’]*/g) ?? []) {
    if (/\d/.test(tok)) {
      const ns = Array.from(numbersIn(tok));
      if (ns.length && ns.some((n) => !oldNums.has(n))) out.push(tok);
      continue;
    }
    const w = tok.toLowerCase();
    const asNum = numbersIn(w);
    if (asNum.size) {
      if (Array.from(asNum).some((n) => !oldNums.has(n))) out.push(tok);
      continue;
    }
    if (!oldStems.has(stem5(w))) out.push(tok);
  }
  return out.join(" ");
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

/** The job titles on the page's own entry headers ("LINE COOK | Diner | 2019 - 2023" gives "line cook"). */
function pageJobTitles(resumeText: string): Set<string> {
  const titles = new Set<string>();
  for (const l of linesOf(resumeText)) {
    if (!isEntryHeader(l)) continue;
    const t = l.split(/\s[|,@]\s|\s+(?:at|-)\s+/i)[0].trim();
    if (t) titles.add(squash(t));
  }
  return titles;
}

/**
 * Lines a person could be asked to explain: not the name, contact, headings,
 * job headers or date lines. A short headline under the name is skipped only
 * when it claims nothing new: it is not a credential line, and it either
 * names a job title on the page ("Line Cook" over a Line Cook job) or every
 * content word is already in the person's own words.
 */
function bodyLines(resumeText: string, sourceText = ""): Array<{ line: string; inSkills: boolean }> {
  const ls = linesOf(resumeText);
  const out: Array<{ line: string; inSkills: boolean }> = [];
  const creds = new Set(credentialLinesOf(resumeText));
  const titles = pageJobTitles(resumeText);
  let inSkills = false;
  let seenHeading = false;
  ls.forEach((l, i) => {
    if (i === 0) return; // the name
    if (SKILLS_HEADING_RE.test(l.replace(/:$/, ""))) { inSkills = true; seenHeading = true; return; }
    if (isSectionEnd(l)) { inSkills = false; seenHeading = true; return; }
    if (i === 0 || CONTACT_LINE_RE.test(l) || isEntryHeader(l) || isDateLine(l)) return;
    // The header block's place line ("Dayton, OH") is contact, not a claim.
    if (!seenHeading && (PLACE_LINE_RE.test(l) || /\bhttps?:|www\.|linkedin\.com/i.test(l))) return;
    if (
      !seenHeading &&
      !/\d/.test(l) &&
      l.split(/\s+/).length <= 6 &&
      !/[.;]$/.test(l) &&
      !creds.has(l) &&
      (titles.has(squash(l)) || (sourceText.trim() !== "" && distanceFromSource(l, sourceText) === 0 && numbersIn(l).size === 0))
    ) return;
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

const DESCRIBE_UNSOURCED =
  "This line has a number you didn't give us. In one sentence, how would you say this line? If you don't know a number, the line stays true without one.";

function questionForDefend(line: string, reasons: DefendReason[], sourceText: string): string {
  if (reasons.includes("credential")) {
    return `Was "${credentialName(line)}" a license, a certification, or a training course? Is it current, expired, or still in progress?`;
  }
  if (reasons.includes("number")) {
    // Never ask a person to defend a number they did not give: that plants it.
    const src = numbersIn(sourceText);
    const unsourced = Array.from(numbersIn(line)).some((n) => !src.has(n));
    if (unsourced) return DESCRIBE_UNSOURCED;
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
  const body = bodyLines(resumeText || "", sourceText || "");
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
      return { line, reasons: rs, question: questionForDefend(line, rs, sourceText || "") };
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

  const defendLines = resumeText.trim() ? pickDefendLines(resumeText, sourceText) : [];
  // Each answer belongs to its own line only; answers are never pooled into
  // the source. The page is always checked against the person's own words.
  const byLine = new Map(answers.map((a) => [squash(a.line), a]));
  const standingFor = (line: string) => {
    const a = byLine.get(squash(line));
    return answerStands(a, line, sourceText) ? a : undefined;
  };

  if (resumeText.trim() && sourceText.trim()) {
    const mint = runMintCheck({ output: resumeText, source: sourceText, kind: "resume" });
    // A credential's missing status is settled only by that line's own
    // standing answer. A course written up as a certification is never
    // settled by an answer: the line changes, or the person's words do.
    const status = checkCredentialStatus(resumeText, sourceText).filter((f) => {
      const a = standingFor(f.line);
      return !(a && hasCredentialStatus(a.answer));
    });
    const findings = [...mint.findings, ...checkCredentialUpgrade(resumeText, sourceText), ...status];
    for (const f of findings) {
      push(f.rule, f.severity, f.line, f.why, questionForFinding(f));
      if (f.kind) items[items.length - 1].kind = f.kind;
    }

    if (requireDefend) {
      for (const d of defendLines) {
        const a = byLine.get(squash(d.line));
        if (standingFor(d.line)) continue;
        const why =
          a?.verdict === "cut"
            ? "You said this line should come off. It is still on the page."
            : a?.verdict === "unsure"
              ? "You weren't sure how to explain this line yet. Reword it with your own words, or take it off."
              : a?.verdict === "stands"
                ? "Your answer doesn't explain this line yet, or it says something different from the line. Reword the line in your own words, or take it off."
                : "You haven't explained this line in your own words yet. Every number, every credential and the lines furthest from your words get explained before the page is finished.";
        push("STD-C04", "BLOCK", d.line, why, a?.verdict === "cut" ? "OK to take this line off now?" : d.question);
      }
    }

    // The second check feeds the same open items. A line already held under
    // the same rule at the same or a higher severity is not asked twice; a
    // BLOCK from the second check still lands on a line the mint check only
    // marked FIX. Its findings are settled by changing the line (a finding on
    // a line no longer on the page is dropped) or by a fresh second check that
    // reads the person's answer.
    if (input.secondCheckFindings) {
      const { findings: second } = validateSecondCheckFindings(input.secondCheckFindings, resumeText);
      const held = new Map<string, MintSeverity>();
      for (const i of items) {
        const k = `${squash(i.line)}|${i.rule}`;
        if (held.get(k) !== "BLOCK") held.set(k, i.severity);
      }
      for (const f of second) {
        const rule = SECOND_CHECK_RULE[f.kind];
        const key = `${squash(f.line)}|${rule}`;
        const prior = held.get(key);
        if (prior === "BLOCK" || (prior === "FIX" && f.severity === "FIX")) continue;
        held.set(key, f.severity);
        items.push({ rule, severity: f.severity, line: f.line, why: f.reason, question: f.question, from: "second_check" });
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
