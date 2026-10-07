/**
 * The Forge finish page gate: draft vs finished, the defend answers, and what
 * the page may show in each state.
 *
 * Pure (no React, no I/O) so every rule here is unit tested. The page wires
 * these to the screen; it never decides "finished" on its own.
 *
 * The contract comes from the engine (getResumeStatus):
 * - "finished" only when no BLOCK is open. Then, and only then: confetti, the
 *   finished download, the email box and the review ask.
 * - "draft": the person can always download, but the file carries the DRAFT
 *   mark and the open items in plain words. No confetti, no review ask.
 * - Open items come from the checker. This file never invents one and never
 *   hides one: every BLOCK and FIX the engine returns lands in a group.
 * - Defend answers are stored per line, never pooled into the source.
 */

import { CREDENTIALS_KEY } from "./forge-path";
import {
  answerStands,
  getResumeStatus,
  introducedWords,
  questionForFinding,
  type DefendAnswer,
  type OpenItem,
  type ResumeStatus,
} from "@crucible/core/src/resumeStatus";
import { linesOf, numbersIn, runMintCheck } from "@crucible/core/src/resumeMintCheckShared";
import type { SecondCheckFinding } from "@crucible/core/src/secondCheckShared";
import { withholdRecordLines } from "./record-lines";

export type { DefendAnswer, OpenItem, ResumeStatus };

// ---- stored state ------------------------------------------------------------

/** Bump when StoredFinish changes shape. A stored copy on another version is ignored, never half-read. */
export const FINISH_STATE_VERSION = 1;

/** The documents the writer made, kept so a reload never spends another AI call or loses answers. */
export interface FinishDocs {
  resumeText: string;
  coverLetterText: string;
  withheldLines: string[];
  keepInsideLines: boolean;
  /** The grounding block from /api/forge/generate-docs, as returned. */
  grounding: unknown;
}

export interface StoredFinish {
  v: number;
  /** Ties the stored copy to the Forge run it came from (see finishKey). */
  key: string;
  docs: FinishDocs;
  defendAnswers: DefendAnswer[];
  /** Skills the person added from a job posting in the keyword check. Each is asked about. */
  addedTerms?: string[];
}

/** Small stable string hash (FNV-1a), enough to tell one run from another. */
function hash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

/**
 * Which Forge run a stored finish belongs to. A new analysis, a new resume
 * upload or the "put them back" choice makes a new key, so stale documents
 * and answers are never shown against a different run.
 */
export function finishKey(session: {
  forgeOutput?: unknown;
  resumeText?: string;
}, keepInsideLines: boolean): string {
  return hash(`${JSON.stringify(session.forgeOutput ?? null)}\u0000${session.resumeText ?? ""}\u0000${keepInsideLines ? 1 : 0}`);
}

/** The stored finish for this run, or null when it is missing, on another version or from another run. */
export function readStoredFinish(stored: unknown, key: string): StoredFinish | null {
  if (!stored || typeof stored !== "object") return null;
  const s = stored as Partial<StoredFinish>;
  if (s.v !== FINISH_STATE_VERSION || s.key !== key) return null;
  const d = s.docs as Partial<FinishDocs> | undefined;
  if (!d || typeof d.resumeText !== "string") return null;
  return {
    v: FINISH_STATE_VERSION,
    key,
    docs: {
      resumeText: d.resumeText,
      coverLetterText: typeof d.coverLetterText === "string" ? d.coverLetterText : "",
      withheldLines: Array.isArray(d.withheldLines) ? d.withheldLines.filter((l): l is string => typeof l === "string") : [],
      keepInsideLines: d.keepInsideLines === true,
      grounding: d.grounding ?? null,
    },
    defendAnswers: Array.isArray(s.defendAnswers)
      ? s.defendAnswers
          .filter((a): a is DefendAnswer => !!a && typeof a.line === "string" && typeof a.answer === "string")
          .map((a) =>
            // A stored rewrite is trusted only when it is consistent with
            // itself: it names the line it replaced, and its text is its line.
            a.kind === "rewrite" &&
            typeof a.replaced === "string" &&
            squash(stripBullet(a.answer)) === squash(stripBullet(a.line))
              ? { line: a.line, answer: a.answer, verdict: a.verdict, kind: "rewrite" as const, replaced: a.replaced }
              : { line: a.line, answer: a.answer, verdict: a.verdict }
          )
      : [],
    addedTerms: Array.isArray(s.addedTerms) ? s.addedTerms.filter((t): t is string => typeof t === "string" && !!t.trim()) : [],
  };
}

// ---- the person's own words ------------------------------------------------------

/**
 * Only the person's own words: their resume text (with record lines held back
 * unless they chose to keep them, matching what the writer was given) and the
 * answers they typed in the Forge. Never the AI-written analysis.
 */
export function ownWordsFor(
  session: {
    resumeText?: string;
    goalNarrative?: string;
    hookNarrative?: string;
    challengeNarratives?: Record<string, string>;
  },
  keepInsideLines: boolean
): string {
  return [
    withholdRecordLines(session.resumeText, keepInsideLines).kept,
    session.goalNarrative,
    session.hookNarrative,
    // Training, certificates and licenses they told us about (not record answers).
    session.challengeNarratives?.[CREDENTIALS_KEY],
  ]
    .map((s) => (typeof s === "string" ? s.trim() : ""))
    .filter(Boolean)
    .join("\n\n");
}

// ---- answers and edits -----------------------------------------------------------

const squash = (s: string) => s.toLowerCase().replace(/[\s\-‐-―]+/g, "");
const stripBullet = (l: string) => l.replace(/^\s*[-•*]\s*/, "").trim();

export type DefendChoice = "stands" | "cut";

/**
 * Record one answer for one line. Replaces that line's earlier answer; never
 * touches another line's. A rewrite record on the same line is kept (it says
 * what the person introduced), and the new answer goes last so it is the one
 * the checker reads for the line.
 */
export function recordAnswer(
  answers: DefendAnswer[],
  line: string,
  answer: string,
  verdict: DefendChoice
): DefendAnswer[] {
  const k = squash(line);
  const next: DefendAnswer = { line, answer: answer.trim(), verdict };
  return [...answers.filter((a) => squash(a.line) !== k || a.kind === "rewrite"), next];
}

/** The lines on a page, without bullets, squashed, for "is this line still here". */
function pageLineSet(...texts: string[]): Set<string> {
  return new Set(texts.flatMap((t) => linesOf(t || "")).map((l) => squash(stripBullet(l))));
}

/**
 * What the person introduced through "Change it", for the source the checker
 * reads. Only rewrites that are consistent (their text is their line, they
 * name the line they replaced) and whose line is still on the page count, and
 * from each only the words and numbers that were not in the replaced line. A
 * written number typed back, a period or a status word that was already there
 * adds nothing.
 */
export function rewritesOf(answers: DefendAnswer[], ...pageTexts: string[]): string {
  const onPage = pageLineSet(...pageTexts);
  return answers
    .filter(
      (a) =>
        a.kind === "rewrite" &&
        a.verdict === "stands" &&
        typeof a.replaced === "string" &&
        squash(stripBullet(a.answer)) === squash(stripBullet(a.line)) &&
        onPage.has(squash(stripBullet(a.line)))
    )
    .map((a) => introducedWords(stripBullet(a.answer), stripBullet(a.replaced as string)))
    .filter(Boolean)
    .join("\n");
}

/** The one source the gate and every panel check against: own words plus what rewrites introduced. */
export function gateSource(ownWords: string, answers: DefendAnswer[], ...pageTexts: string[]): string {
  const added = rewritesOf(answers, ...pageTexts);
  return added ? `${ownWords}\n\n${added}` : ownWords;
}

const NUMBER_TOKEN_RE = /\$?\d[\d,]*(?:\.\d+)?%?|\b[A-Za-z]+\b/g;

/**
 * The starting text for "Change it". A number the person never gave (digits
 * or a number word) becomes "[your number]", so the box never hands them the
 * written figure to keep. A bracket left in blocks the finish (STD-F05).
 */
export function prefillRewrite(line: string, ownWords: string): string {
  const theirs = numbersIn(ownWords);
  return stripBullet(line).replace(NUMBER_TOKEN_RE, (tok) => {
    const ns = Array.from(numbersIn(tok));
    if (!ns.length) return tok;
    return ns.every((n) => theirs.has(n)) ? tok : "[your number]";
  });
}

/** The answer on file for a line (the latest one that is not a rewrite record), if any. */
export function answerFor(answers: DefendAnswer[], line: string): DefendAnswer | undefined {
  const k = squash(line);
  const mine = answers.filter((a) => squash(a.line) === k);
  return [...mine].reverse().find((a) => a.kind !== "rewrite") ?? mine[mine.length - 1];
}

/** Take one line off the page. Returns the text unchanged when the line is not there. */
export function cutLine(resumeText: string, line: string): string {
  const target = stripBullet(line);
  if (!target) return resumeText;
  const out = resumeText.split("\n");
  const hit = out.findIndex((l) => stripBullet(l) === target);
  if (hit === -1) return resumeText;
  out.splice(hit, 1);
  return out.join("\n").replace(/\n{3,}/g, "\n\n");
}

/**
 * Replace one line with the person's own rewrite, keeping its bullet. Returns
 * the text unchanged when the line is gone or the rewrite is empty.
 */
export function changeLine(resumeText: string, line: string, rewrite: string): string {
  const target = stripBullet(line);
  const next = stripBullet(rewrite.replace(/\s*\n\s*/g, " "));
  if (!target || !next) return resumeText;
  const out = resumeText.split("\n");
  const hit = out.findIndex((l) => stripBullet(l) === target);
  if (hit === -1) return resumeText;
  const prefix = out[hit].match(/^\s*(?:[-*•]\s*)?/)?.[0] ?? "";
  out[hit] = prefix + next;
  return out.join("\n");
}

export interface RewriteResult {
  text: string;
  answers: DefendAnswer[];
  /** False when nothing changed (same line, empty rewrite, or the line is gone). */
  changed: boolean;
}

/**
 * "Change it": put the person's rewrite on the page and record it, with the
 * line it replaced. A rewrite of a rewrite keeps the original written line as
 * `replaced`, so words the person introduced earlier stay theirs and the
 * writer's words never become theirs by being carried along.
 */
export function applyRewrite(text: string, answers: DefendAnswer[], line: string, rewrite: string): RewriteResult {
  const next = changeLine(text, line, rewrite);
  if (next === text) return { text, answers, changed: false };
  const typed = stripBullet(rewrite.replace(/\s*\n\s*/g, " "));
  const newLine = linesOf(next).find((l) => stripBullet(l) === typed) ?? typed;
  const prior = answers.find((a) => a.kind === "rewrite" && typeof a.replaced === "string" && squash(a.line) === squash(line));
  const replaced = prior?.replaced ?? line;
  const k = squash(newLine);
  return {
    text: next,
    answers: [
      ...answers.filter((a) => squash(a.line) !== k),
      { line: newLine, answer: typed, verdict: "stands", kind: "rewrite", replaced },
    ],
    changed: true,
  };
}

/** The line as the person should see it in an edit box: no bullet glyph. */
export function editableLine(line: string): string {
  return stripBullet(line);
}

// ---- skills added from a posting --------------------------------------------------

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const termRe = (term: string) => new RegExp(`(?<![\\w])${escapeRe(term.trim())}(?![\\w])`, "i");

/**
 * An answer about one skills term stands only when it stands like any answer
 * and talks about that term (a word starting the same way: "bathed" for
 * "bathing"). A general "I did that" for a list of posting words is not one
 * time they did each of them.
 */
export function skillAnswerStands(a: DefendAnswer | undefined, term: string, source: string): boolean {
  if (!answerStands(a, term, source)) return false;
  const heads = (t: string) => (t.toLowerCase().match(/[a-z]{3,}/g) ?? []).map((w) => w.slice(0, 4));
  const want = new Set(heads(term));
  return heads(a?.answer ?? "").some((h) => want.has(h));
}

/** True when the term is still on the page. */
export function termOnPage(text: string, term: string): boolean {
  return !!term.trim() && termRe(term).test(text);
}

/** Take one added skill term off its skills line. Returns the text unchanged when it is not a listed item. */
export function cutTerm(text: string, term: string): string {
  const t = term.trim().toLowerCase();
  if (!t) return text;
  const re = termRe(term);
  return text
    .split("\n")
    .map((l) => {
      if (!re.test(l)) return l;
      const m = l.match(/^(\s*(?:[-•*]\s*)?(?:[A-Za-z &/]+:\s*)?)(.*)$/);
      const prefix = m?.[1] ?? "";
      const parts = (m?.[2] ?? l).split(/\s*[,;|•]\s*/);
      const kept = parts.filter((p) => p.trim().toLowerCase() !== t);
      if (kept.length === parts.length) return l;
      return kept.length ? prefix + kept.join(", ") : "";
    })
    .join("\n")
    .replace(/\n{3,}/g, "\n\n");
}

// ---- the view ------------------------------------------------------------------

export type GroupTarget = "resume" | "letter" | "skill";

/** One line (or added skill) and everything open about it. */
export interface LineGroup {
  line: string;
  /** Which document the line is in. "skill": a term added from a posting. */
  target: GroupTarget;
  items: OpenItem[];
  /** True when at least one BLOCK is open on this line. */
  blocking: boolean;
  /**
   * True when an answer in the person's own words can settle every open item
   * on this line (a defend question or a credential's status). Anything else
   * the checker found (a number or year the person never gave, a placeholder)
   * only goes away when the line changes or comes off, so "true as written"
   * is not offered for it.
   */
  answerable: boolean;
  /** A defend line the person already explained; nothing open on it. */
  checked: boolean;
  answer?: DefendAnswer;
}

/** An open item with the document it is in. */
export type GateItem = OpenItem & { target: GroupTarget; /** Raised by the generate-docs claim trace. */ trace?: boolean };

export interface FinishView {
  status: ResumeStatus;
  state: "finished" | "draft";
  /** Every open item the gate holds: resume, cover letter, added skills, second check. */
  openItems: GateItem[];
  /** Lines with something open, BLOCK lines first, in page order. */
  groups: LineGroup[];
  /** Defend lines already explained, in page order (shown as checked). */
  checkedLines: LineGroup[];
  /** Open items not tied to one line on the page (no resume, none of the person's words, a line we could not find). */
  general: GateItem[];
  /** Things that block "finished": blocking lines plus general BLOCKs. */
  fixCount: number;
  /** Verifiable progress on the defend step. */
  defendDone: number;
  defendTotal: number;
  /** The one source every panel checks against. */
  source: string;
}

const ANSWERABLE = (i: OpenItem) => i.rule === "STD-C04" || (i.rule === "STD-T03" && i.severity === "FIX");

type GroundingOutcome = { claim?: unknown; doc?: unknown; status?: unknown };

/**
 * The claim trace from generate-docs, as open items: a claim it flagged that
 * is still on the page, and a line that may say more about a credential than
 * the person did. Anything the Checks section shows as a blocker is held here.
 */
function groundingItems(grounding: unknown, resumeText: string, letterText: string): GateItem[] {
  const outcomes = (grounding as { outcomes?: unknown })?.outcomes;
  if (!Array.isArray(outcomes)) return [];
  const items: GateItem[] = [];
  for (const o of outcomes as GroundingOutcome[]) {
    if (typeof o?.claim !== "string" || !o.claim.trim()) continue;
    if (o.status !== "still_there" && o.status !== "credential") continue;
    const target: GroupTarget = o.doc === "cover_letter" ? "letter" : "resume";
    const text = target === "letter" ? letterText : resumeText;
    const needle = o.claim.trim().toLowerCase();
    const line = linesOf(text).find((l) => l.toLowerCase().includes(needle));
    if (!line) continue; // changed or cut since: settled
    items.push(
      o.status === "credential"
        ? {
            rule: "STD-T03",
            severity: "BLOCK",
            line,
            target,
            trace: true,
            why: "Our second check says this may say more about a card, license or certification than you told us.",
            question: "Change it to what you actually hold, the way your card or papers say it, or cut it.",
          }
        : {
            rule: "STD-C04",
            severity: "BLOCK",
            line,
            target,
            trace: true,
            why: "Our second check couldn't match this to anything you told us.",
            question: "Tell me in one sentence how you'd describe this, in your own words. If it isn't true, change it or cut it.",
          }
    );
  }
  return items;
}

export function buildFinishView(input: {
  resumeText: string;
  ownWords: string;
  defendAnswers: DefendAnswer[];
  coverLetterText?: string;
  /** Skill terms the person added from a posting (keyword check). */
  addedTerms?: string[];
  /** The grounding block from generate-docs, when there is one. */
  grounding?: unknown;
  /** The second check's findings, only when it ran. */
  secondCheckFindings?: ReadonlyArray<SecondCheckFinding>;
}): FinishView {
  const letter = input.coverLetterText ?? "";
  const answers = input.defendAnswers;
  const source = gateSource(input.ownWords, answers, input.resumeText, letter);
  const status = getResumeStatus({
    resumeText: input.resumeText,
    sourceText: source,
    defendAnswers: answers,
    secondCheckFindings: input.secondCheckFindings,
  });

  const items: GateItem[] = [];
  for (const i of status.openItems) {
    // A skills term the person never said is asked about like any other
    // claim, one term at a time, and blocks until they explain it or it goes.
    if (i.kind === "grid_term") {
      if (skillAnswerStands(answerFor(answers, i.line), i.line, source)) continue;
      items.push({ ...i, severity: "BLOCK", target: "skill" });
      continue;
    }
    items.push({ ...i, target: "resume" });
  }

  // The cover letter ships in the same package, so it is checked too.
  if (letter.trim() && input.resumeText.trim() && source.trim()) {
    for (const f of runMintCheck({ output: letter, source, kind: "cover_letter" }).findings) {
      items.push({ rule: f.rule, severity: f.severity, line: f.line, why: f.why, question: questionForFinding(f), target: "letter" });
    }
  }

  // Skills added from a posting: each one is explained in the person's words.
  for (const term of Array.from(new Set((input.addedTerms ?? []).map((t) => t.trim()).filter(Boolean)))) {
    if (!termOnPage(input.resumeText, term)) continue;
    if (items.some((i) => i.target === "skill" && i.line.toLowerCase() === term.toLowerCase())) continue;
    if (skillAnswerStands(answerFor(answers, term), term, source)) continue;
    items.push({
      rule: "STD-C04",
      severity: "BLOCK",
      line: term,
      target: "skill",
      why: "You added this from a job posting.",
      question: `Tell me one time you did "${term}" at work, in your own words. If you can't, it comes off.`,
    });
  }

  // The claim trace, settled by a standing answer when it asks for one.
  for (const g of groundingItems(input.grounding, input.resumeText, letter)) {
    if (g.rule === "STD-C04" && answerStands(answerFor(answers, g.line), g.line, source)) continue;
    if (items.some((i) => i.target === g.target && i.line === g.line && i.rule === g.rule)) continue;
    items.push(g);
  }

  // An item whose line is not on its page cannot be changed or cut there.
  const resumeLines = pageLineSet(input.resumeText);
  const letterLines = pageLineSet(letter);
  const onItsPage = (i: GateItem) =>
    i.target === "skill" ? true : (i.target === "letter" ? letterLines : resumeLines).has(squash(stripBullet(i.line)));
  const general = items.filter((i) => !i.line || !onItsPage(i));
  const lined = items.filter((i) => i.line && onItsPage(i));

  const byLine = new Map<string, GateItem[]>();
  for (const item of lined) {
    const k = `${item.target}\u0000${item.line}`;
    const list = byLine.get(k) ?? [];
    list.push(item);
    byLine.set(k, list);
  }

  const order = linesOf(input.resumeText);
  const targetRank: Record<GroupTarget, number> = { resume: 0, skill: 1, letter: 2 };
  const groups: LineGroup[] = Array.from(byLine.values()).map((its) => ({
    line: its[0].line,
    target: its[0].target,
    items: its,
    blocking: its.some((i) => i.severity === "BLOCK"),
    answerable: its[0].target === "skill" || (its[0].target !== "letter" && its.every(ANSWERABLE)),
    checked: false,
    answer: answerFor(answers, its[0].line),
  }));
  groups.sort(
    (a, b) =>
      Number(b.blocking) - Number(a.blocking) ||
      targetRank[a.target] - targetRank[b.target] ||
      order.indexOf(a.line) - order.indexOf(b.line)
  );

  const openDefend = new Set(status.openItems.filter((i) => i.rule === "STD-C04").map((i) => squash(i.line)));
  const groupedResume = new Set(groups.filter((g) => g.target === "resume").map((g) => g.line));
  const checkedLines: LineGroup[] = status.defendLines
    .filter((d) => !openDefend.has(squash(d.line)))
    .filter((d) => !groupedResume.has(d.line))
    .map((d) => ({
      line: d.line,
      target: "resume" as const,
      items: [],
      blocking: false,
      answerable: true,
      checked: true,
      answer: answerFor(answers, d.line),
    }));

  const defendTotal = status.defendLines.length;
  const defendDone = status.defendLines.filter((d) => !openDefend.has(squash(d.line))).length;
  const blocks = items.filter((i) => i.severity === "BLOCK").length;

  return {
    status,
    state: blocks > 0 ? "draft" : "finished",
    openItems: [...items.filter((i) => i.severity === "BLOCK"), ...items.filter((i) => i.severity === "FIX")],
    groups,
    checkedLines,
    general,
    fixCount: groups.filter((g) => g.blocking).length + general.filter((i) => i.severity === "BLOCK").length,
    defendDone,
    defendTotal,
    source,
  };
}

/**
 * The open items in plain words, for the DRAFT file's to-do page. Every BLOCK
 * and every FIX the gate holds (resume, letter, added skills), nothing added.
 */
export function openItemsInPlainWords(view: { openItems: Array<OpenItem & { target?: GroupTarget }> }): string[] {
  return view.openItems.map((i) => {
    const what = i.severity === "BLOCK" ? "Fix before you send" : "Worth checking";
    const where = i.target === "letter" ? " (cover letter)" : i.target === "skill" ? " (skills)" : "";
    return i.line ? `${what}${where}: "${stripBullet(i.line)}". ${i.question}` : `${what}${where}: ${i.question}`;
  });
}

// ---- what the page may show ------------------------------------------------------

/** Celebrate only a finished page, never in the demo, once per page load. */
export function shouldCelebrate(args: { state: "finished" | "draft"; isDemo: boolean; docsReady: boolean; alreadyCelebrated: boolean }): boolean {
  return args.docsReady && !args.isDemo && args.state === "finished" && !args.alreadyCelebrated;
}

/** What a download carries: finished only when the engine says so. */
export function downloadMode(state: "finished" | "draft"): { draft: boolean } {
  return { draft: state !== "finished" };
}

/** The email box sends an unmarked package, so it opens only on a finished page. */
export function canEmailPackage(args: { state: "finished" | "draft"; isDemo: boolean }): boolean {
  return args.state === "finished" && !args.isDemo;
}

/** sessionStorage key: the review ask has been shown in this visit. */
export const REVIEW_ASK_SHOWN_KEY = "forge_review_ask_shown";

/**
 * The Google review ask: after a finished download only, never in the demo,
 * never before the resume is finished, never twice in one visit.
 */
export function shouldShowReviewAsk(args: {
  state: "finished" | "draft";
  isDemo: boolean;
  /** A finished (not draft) download happened on this page load. */
  finishedDownloadDone: boolean;
  /** The ask was already shown earlier in this visit (sessionStorage). */
  shownEarlierThisVisit: boolean;
  dismissed: boolean;
}): boolean {
  if (args.isDemo || args.dismissed || args.shownEarlierThisVisit) return false;
  return args.state === "finished" && args.finishedDownloadDone;
}

/** localStorage key: the finish-page tour was seen (finished or skipped). */
export const TOUR_SEEN_KEY = "forge_finish_tour_seen";

/** The newsletter box starts unchecked. A yes has to be the person's own click. */
export const NEWSLETTER_DEFAULT_CHECKED = false;

// ---- copy -------------------------------------------------------------------------

export const GOOGLE_REVIEW_URL = "https://g.page/r/CXwCW8901YTuEAE/review";

const NUMBER_WORDS = ["Zero", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten"];
export const countWord = (n: number) => NUMBER_WORDS[n] ?? String(n);

/** t.ROY's one status line at the top of the page. */
export function statusLine(view: Pick<FinishView, "state" | "fixCount">): string {
  if (view.state === "finished") return "Your resume is ready.";
  const n = view.fixCount;
  if (n <= 0) return "A few things to check before it's ready.";
  return `${countWord(n)} ${n === 1 ? "thing" : "things"} to fix before it's ready.`;
}

/** The main button's words. In a draft it says what's left. */
export function mainActionLabel(view: Pick<FinishView, "state" | "fixCount">): string {
  if (view.state === "finished") return "Download your resume package";
  const n = view.fixCount;
  if (n <= 0) return "Check what's left with t.ROY";
  return `Fix ${n === 1 ? "1 thing" : `${n} things`} with t.ROY`;
}

/** Verifiable progress only: "2 of 3 lines checked". Never a percentage. */
export function progressLine(view: Pick<FinishView, "defendDone" | "defendTotal">): string {
  if (view.defendTotal === 0) return "";
  return `${view.defendDone} of ${view.defendTotal} ${view.defendTotal === 1 ? "line" : "lines"} checked`;
}

export const NEWSLETTER_LINE =
  "Also send me Troy's letter. It comes out Sunday and Wednesday, it's short and practical, and you can unsubscribe any time.";

export const REVIEW_ASK_LINE = "Did this help? A Google review helps the next person find us.";

export const PDF_WORD_EXPLAINER: { heading: string; lines: string[] } = {
  heading: "PDF or Word: which one do I send?",
  lines: [
    "Both files have the same words. Only the file type is different.",
    "Send the PDF for most online applications and any time you email your resume. It looks the same on every screen, and nobody can change it by accident.",
    "Send the Word file (.docx) when a job site or a person asks for .docx, or when you want to make changes yourself in Word or Google Docs.",
    "Not sure? Send the PDF.",
  ],
};
