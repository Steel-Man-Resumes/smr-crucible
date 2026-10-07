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

import {
  getResumeStatus,
  type DefendAnswer,
  type OpenItem,
  type ResumeStatus,
} from "@crucible/core/src/resumeStatus";
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
      ? s.defendAnswers.filter(
          (a): a is DefendAnswer => !!a && typeof a.line === "string" && typeof a.answer === "string"
        )
      : [],
  };
}

// ---- the person's own words ------------------------------------------------------

/**
 * Only the person's own words: their resume text (with record lines held back
 * unless they chose to keep them, matching what the writer was given) and the
 * answers they typed in the Forge. Never the AI-written analysis.
 */
export function ownWordsFor(
  session: { resumeText?: string; goalNarrative?: string; hookNarrative?: string },
  keepInsideLines: boolean
): string {
  return [
    withholdRecordLines(session.resumeText, keepInsideLines).kept,
    session.goalNarrative,
    session.hookNarrative,
  ]
    .map((s) => (typeof s === "string" ? s.trim() : ""))
    .filter(Boolean)
    .join("\n\n");
}

// ---- answers and edits -----------------------------------------------------------

const squash = (s: string) => s.toLowerCase().replace(/[\s\-‐-―]+/g, "");
const stripBullet = (l: string) => l.replace(/^\s*[-•*]\s*/, "").trim();

export type DefendChoice = "stands" | "cut";

/** Record one answer for one line. Replaces that line's earlier answer; never touches another line's. */
export function recordAnswer(
  answers: DefendAnswer[],
  line: string,
  answer: string,
  verdict: DefendChoice
): DefendAnswer[] {
  const k = squash(line);
  return [...answers.filter((a) => squash(a.line) !== k), { line, answer: answer.trim(), verdict }];
}

/** The answer on file for a line, if any. */
export function answerFor(answers: DefendAnswer[], line: string): DefendAnswer | undefined {
  const k = squash(line);
  return answers.find((a) => squash(a.line) === k);
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

/** The line as the person should see it in an edit box: no bullet glyph. */
export function editableLine(line: string): string {
  return stripBullet(line);
}

// ---- the view ------------------------------------------------------------------

/** One resume line and everything open about it. */
export interface LineGroup {
  line: string;
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

export interface FinishView {
  status: ResumeStatus;
  state: "finished" | "draft";
  /** Lines with something open, BLOCK lines first, in page order. */
  groups: LineGroup[];
  /** Defend lines already explained, in page order (shown as checked). */
  checkedLines: LineGroup[];
  /** Open items not tied to one line (no resume, none of the person's words). */
  general: OpenItem[];
  /** Things that block "finished": blocking lines plus general BLOCKs. */
  fixCount: number;
  /** Verifiable progress on the defend step. */
  defendDone: number;
  defendTotal: number;
}

const ANSWERABLE = (i: OpenItem) => i.rule === "STD-C04" || (i.rule === "STD-T03" && i.severity === "FIX");

export function buildFinishView(input: {
  resumeText: string;
  ownWords: string;
  defendAnswers: DefendAnswer[];
}): FinishView {
  const status = getResumeStatus({
    resumeText: input.resumeText,
    sourceText: input.ownWords,
    defendAnswers: input.defendAnswers,
  });

  const general = status.openItems.filter((i) => !i.line);
  const byLine = new Map<string, OpenItem[]>();
  for (const item of status.openItems) {
    if (!item.line) continue;
    const list = byLine.get(item.line) ?? [];
    list.push(item);
    byLine.set(item.line, list);
  }

  const groups: LineGroup[] = Array.from(byLine.entries()).map(([line, items]) => ({
    line,
    items,
    blocking: items.some((i) => i.severity === "BLOCK"),
    answerable: items.every(ANSWERABLE),
    checked: false,
    answer: answerFor(input.defendAnswers, line),
  }));
  // openItems is already BLOCKs first then FIXes, each in page order; a line
  // with a BLOCK sorts ahead of FIX-only lines.
  groups.sort((a, b) => Number(b.blocking) - Number(a.blocking));

  const openDefend = new Set(
    status.openItems.filter((i) => i.rule === "STD-C04").map((i) => squash(i.line))
  );
  const checkedLines: LineGroup[] = status.defendLines
    .filter((d) => !openDefend.has(squash(d.line)))
    .filter((d) => !byLine.has(d.line))
    .map((d) => ({
      line: d.line,
      items: [],
      blocking: false,
      answerable: true,
      checked: true,
      answer: answerFor(input.defendAnswers, d.line),
    }));

  const defendTotal = status.defendLines.length;
  const defendDone = status.defendLines.filter((d) => !openDefend.has(squash(d.line))).length;

  return {
    status,
    state: status.state,
    groups,
    checkedLines,
    general,
    fixCount: groups.filter((g) => g.blocking).length + general.filter((i) => i.severity === "BLOCK").length,
    defendDone,
    defendTotal,
  };
}

/**
 * The open items in plain words, for the DRAFT file's to-do page. Every BLOCK
 * and every FIX, nothing added.
 */
export function openItemsInPlainWords(status: ResumeStatus): string[] {
  return status.openItems.map((i) => {
    const what = i.severity === "BLOCK" ? "Fix before you send" : "Worth checking";
    return i.line ? `${what}: "${stripBullet(i.line)}". ${i.question}` : `${what}: ${i.question}`;
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
