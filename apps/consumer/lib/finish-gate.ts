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
  answerMentions,
  answerStands,
  credentialMemoryPrompt,
  distanceFromSource,
  getResumeStatus,
  introducedWords,
  questionForFinding,
  credentialPromptWhy,
  scopeWhy,
  Q_SCOPE,
  type DefendAnswer,
  type OpenItem,
  type ResumeStatus,
} from "@crucible/core/src/resumeStatus";
import { hasCredentialStatus, linesOf, numbersIn, runMintCheck } from "@crucible/core/src/resumeMintCheckShared";
import { normalizeDigits, numberTokens } from "@crucible/core/src/numberRead";
import { stemOf } from "@crucible/core/src/wordStem";
import { scopeNotTheirs } from "@crucible/core/src/scopeWords";
import { isStrictCredentialWhen } from "@crucible/core/src/credentialStatus";
import {
  credentialHomes,
  credentialKeyOf,
  credentialMentionsOf,
  credentialsToAsk,
  removeCredentialPart,
  sameCredential,
} from "@crucible/core/src/credentialMentions";
import { normalizeForMatch, flagOutcome } from "./grounding-accounting";
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
  /**
   * The writer's documents exactly as they came back, never edited. A word
   * or number anywhere in them is never the person's, whichever line they
   * type it into. Missing on runs saved before it existed: then no rewrite
   * adds to the person's words (closed by default).
   */
  written?: WrittenDocs;
}

/** The writer's resume and letter, as delivered. */
export interface WrittenDocs {
  resume: string;
  letter: string;
}

export interface StoredFinish {
  v: number;
  /** Ties the stored copy to the Forge run it came from (see finishKey). */
  key: string;
  docs: FinishDocs;
  defendAnswers: DefendAnswer[];
  /** Skills the person added from a job posting in the keyword check. Each is asked about. */
  addedTerms?: string[];
  /** Skills terms the person kept on the "added for you" card (decision D3). */
  keptTerms?: string[];
  /** Credentials the person confirmed with their own type and year or status (decision D4). */
  confirmedCredentials?: CredentialConfirm[];
}

/** A credential the writer put on the page that the person confirmed holding, in their own words. */
export interface CredentialConfirm {
  /** The name as it was on the page (the memory prompt). */
  name: string;
  /** What kind it is, as the person picked it. */
  type: CredentialType;
  /** The year or status in the person's own words. */
  when: string;
  /** The line as rewritten to match what they typed ("Forklift card, 2021"). */
  text: string;
  /** The credential's key, so every mention of it on both pages answers to this one confirmation. */
  key?: string;
  /** What was left of a longer sentence after the credential moved out of it (held until the person rewords or cuts it). */
  remnants?: string[];
  /** A sentence about the credential was taken out of the cover letter. */
  letterSentenceDropped?: boolean;
}

export const CREDENTIAL_TYPES = ["license", "certification", "card", "training course"] as const;
export type CredentialType = (typeof CREDENTIAL_TYPES)[number];

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
      written:
        d.written && typeof d.written.resume === "string"
          ? { resume: d.written.resume, letter: typeof d.written.letter === "string" ? d.written.letter : "" }
          : undefined,
    },
    defendAnswers: Array.isArray(s.defendAnswers)
      ? s.defendAnswers
          .filter((a): a is DefendAnswer => !!a && typeof a.line === "string" && typeof a.answer === "string")
          .map((a) =>
            // A stored rewrite is trusted only when it is consistent with
            // itself: it names a real line it replaced (one the writer
            // wrote, when the written documents are stored), and its text is
            // its line.
            a.kind === "rewrite" &&
            typeof a.replaced === "string" &&
            a.replaced.trim() !== "" &&
            (!d.written || writtenHasLine(d.written as WrittenDocs, a.replaced)) &&
            squash(stripBullet(a.answer)) === squash(stripBullet(a.line))
              ? { line: a.line, answer: a.answer, verdict: a.verdict, kind: "rewrite" as const, replaced: a.replaced }
              : { line: a.line, answer: a.answer, verdict: a.verdict }
          )
      : [],
    addedTerms: Array.isArray(s.addedTerms) ? s.addedTerms.filter((t): t is string => typeof t === "string" && !!t.trim()) : [],
    // A kept term is kept only while it is still a term on the page.
    keptTerms: Array.isArray(s.keptTerms)
      ? s.keptTerms.filter((t): t is string => typeof t === "string" && !!t.trim() && termOnPage(d.resumeText as string, t))
      : [],
    // A confirmation is trusted only when its name is a credential the writer
    // put on the page, its year or status is a real answer, and its text is
    // rebuilt from those, never taken as stored.
    confirmedCredentials: Array.isArray(s.confirmedCredentials)
      ? s.confirmedCredentials
          .filter(
            (c): c is CredentialConfirm =>
              !!c &&
              typeof c.name === "string" &&
              typeof c.when === "string" &&
              (CREDENTIAL_TYPES as readonly string[]).includes(c.type as string) &&
              isCredentialWhen(c.when) &&
              !!d.written &&
              writtenNamesCredential(d.written as WrittenDocs, c.name)
          )
          .map((c) => ({
            name: c.name,
            type: c.type,
            when: c.when.trim(),
            text: confirmedCredentialText(c.name, c.type, c.when),
            key: credentialKeyOf(c.name),
            remnants: Array.isArray(c.remnants) ? c.remnants.filter((r): r is string => typeof r === "string") : [],
            letterSentenceDropped: c.letterSentenceDropped === true,
          }))
      : [],
  };
}

function writtenNamesCredential(w: WrittenDocs, name: string): boolean {
  const k = squash(name);
  return credentialMentionsOf(`${w.resume || ""}\n\n${w.letter || ""}`).some((m) => squash(m.name) === k);
}

function writtenHasLine(w: WrittenDocs, line: string): boolean {
  const k = squash(stripBullet(line));
  return [...linesOf(w.resume || ""), ...linesOf(w.letter || "")].some((l) => squash(stripBullet(l)) === k);
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
 * from each only the words and numbers that are in neither the replaced line
 * nor anywhere in the writer's documents (`written`). Without the written
 * documents nothing is added: a rewrite cannot launder the writer's words
 * when we cannot tell them apart.
 */
export function rewritesOf(answers: DefendAnswer[], pages: string | string[], written?: WrittenDocs | null): string {
  if (!written) return "";
  const onPage = pageLineSet(...(Array.isArray(pages) ? pages : [pages]));
  const writerText = `${written.resume}\n${written.letter}`;
  return answers
    .filter(
      (a) =>
        a.kind === "rewrite" &&
        a.verdict === "stands" &&
        typeof a.replaced === "string" &&
        a.replaced.trim() !== "" &&
        squash(stripBullet(a.answer)) === squash(stripBullet(a.line)) &&
        onPage.has(squash(stripBullet(a.line)))
    )
    .map((a) => introducedWords(stripBullet(a.answer), stripBullet(a.replaced as string), writerText))
    .filter(Boolean)
    .join("\n");
}

/**
 * Kept terms and confirmed credentials as text, for display only. Round 3:
 * the gate never adds these to the person's words. A kept term settles only
 * its own skills item, and a confirmation settles only its own credential.
 */
export function confirmedWords(keptTerms: string[] = [], confirms: CredentialConfirm[] = []): string {
  const kept = keptTerms.map((t) => {
    let out = "";
    let at = 0;
    const text = normalizeDigits(t);
    for (const tok of numberTokens(text)) {
      out += text.slice(at, tok.index);
      at = tok.index + tok.length;
    }
    return (out + text.slice(at)).trim();
  });
  const creds = confirms.filter((c) => hasCredentialStatus(c.when)).map((c) => c.text);
  return [...kept, ...creds].filter(Boolean).join("\n");
}

/** The one source the gate and every panel check against: own words plus what rewrites introduced. */
export function gateSource(ownWords: string, answers: DefendAnswer[], pages: string | string[], written?: WrittenDocs | null): string {
  const added = rewritesOf(answers, pages, written);
  return added ? `${ownWords}\n\n${added}` : ownWords;
}

/**
 * The starting text for "Change it". A number whose value the person never
 * gave (in any form: "42" for their "forty-two" is theirs) becomes "[your
 * number]", so the box never hands them the written figure to keep. A bracket
 * left in blocks the finish (STD-F05).
 */
export function prefillRewrite(line: string, ownWords: string): string {
  const theirs = numbersIn(ownWords);
  const text = normalizeDigits(stripBullet(line));
  let out = "";
  let at = 0;
  for (const t of numberTokens(text)) {
    out += text.slice(at, t.index) + (theirs.has(t.value) ? text.slice(t.index, t.index + t.length) : "[your number]");
    at = t.index + t.length;
  }
  return out + text.slice(at);
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
  // A real stem match ("bathed" for "bathing"), never just a shared four-letter start.
  const stems = (t: string) => (t.toLowerCase().match(/[a-z]{3,}/g) ?? []).map(stemOf);
  const want = new Set(stems(term));
  return stems(a?.answer ?? "").some((h) => want.has(h));
}

/** True when the term is still listed in the skills section (a job header with the same words does not count). */
export function termOnPage(text: string, term: string): boolean {
  if (!term.trim()) return false;
  const re = termRe(term);
  const lines = text.split("\n");
  const skills = skillsLineIndexes(lines);
  return lines.some((l, i) => skills.has(i) && re.test(l));
}

const SKILLS_HEADING_RE = /^(?:core competencies|skills|key skills|competencies|core skills|technical skills):?$/i;
const ANY_HEADING_RE = /^[A-Z][A-Z &/]{3,}:?$/;

/** The indexes of the lines in the skills section (a term is cut only there, never from a job header). */
function skillsLineIndexes(lines: string[]): Set<number> {
  return new Set(listLineKinds(lines).keys());
}

/** Each list line's index and its list: a skills list, or a credentials list (round 4: terms live in both). */
function listLineKinds(lines: string[]): Map<number, "skills" | "credentials"> {
  const out = new Map<number, "skills" | "credentials">();
  let list: "skills" | "credentials" | null = null;
  lines.forEach((l, i) => {
    const t = l.trim();
    if (SKILLS_HEADING_RE.test(t)) { list = "skills"; return; }
    if (CERT_HEADING_RE.test(t)) { list = "credentials"; return; }
    if (ANY_HEADING_RE.test(t) && !t.includes("|")) { list = null; return; }
    if (list && t) out.set(i, list);
  });
  return out;
}

/** Take one skill term off its skills line. Returns the text unchanged when it is not a listed item there. */
export function cutTerm(text: string, term: string): string {
  const t = term.trim().toLowerCase();
  if (!t) return text;
  const re = termRe(term);
  const lines = text.split("\n");
  const kinds = listLineKinds(lines);
  return lines
    .map((l, i) => {
      if (!kinds.has(i) || !re.test(l)) return l;
      // A credentials line is split the one way the checker reads it, and a
      // part's year or status goes with it.
      if (kinds.get(i) === "credentials") {
        const bullet = l.match(/^\s*(?:[-•*]\s*)?/)?.[0] ?? "";
        const rest = removeCredentialPart(l, term);
        if (rest === l) return l;
        return rest ? bullet + rest : "";
      }
      const m = l.match(/^(\s*(?:[-•*]\s*)?(?:[A-Za-z &/]+:\s*)?)(.*)$/);
      const prefix = m?.[1] ?? "";
      const parts = (m?.[2] ?? l).split(/\s*(?:[,;|•·]|\s[-–]\s|\s\/\s|\/(?=[A-Za-z])|\band\b)\s*/i);
      const norm = (p: string) => p.replace(/^\(|\)$/g, "").trim().toLowerCase();
      const kept = parts.filter((p) => p.trim() && norm(p) !== t);
      if (kept.length === parts.filter((p) => p.trim()).length) return l;
      return kept.length ? prefix + kept.join(", ") : "";
    })
    .join("\n")
    .replace(/\n{3,}/g, "\n\n");
}

// ---- credentials the person confirmed (D4) ---------------------------------------

// The writer's type and status words never survive a confirmation: the line
// is rebuilt from the name the person said yes to, the kind they picked, and
// their own year or status. A class letter they confirmed stays ("CDL Class A").
const CLAIM_WORDS_RE =
  /\b(?:certified|certification|certifications|certificate|cert|licensed|license|licence|card|cards|training|course|program|endorsement|permit|registry|registered|holder|class(?![\s-]*[a-d0-9]\b))\b/gi;
const NAME_STATUS_RE =
  /\b(?:current|currently|active|valid|expired|expires|expiring|inactive|lapsed|in progress|enrolled|completed|finished|passed|renewed|suspended|revoked|in good standing|up to date|good for|through|until|since)\b|\b(?:19|20)\d{2}\b/gi;

/** The credential's name without the writer's type or status words ("Forklift Certified" is "Forklift"). */
function bareName(name: string): string {
  return (
    name
      .replace(CLAIM_WORDS_RE, " ")
      .replace(NAME_STATUS_RE, " ")
      .replace(/[()]/g, " ")
      .replace(/\s{2,}/g, " ")
      .replace(/^[,\s-]+|[,\s-]+$/g, "")
      .trim() || name.trim()
  );
}

/** The line as the person confirmed it: the name, the kind they picked, and their own year or status. */
export function confirmedCredentialText(name: string, type: CredentialType, when: string): string {
  return `${bareName(name)} ${type}, ${when.trim().replace(/[.\s]+$/, "")}`;
}

/**
 * True when the year-or-status box holds exactly one real status, maybe with
 * a year that is not in the future: current/active, expired/lapsed, in
 * progress, or completed (core isStrictCredentialWhen).
 */
export function isCredentialWhen(when: string): boolean {
  return isStrictCredentialWhen(when);
}

// Words next to a credential's name that go with it when it moves: who holds
// it and how it is held ("I hold a current ... certification (OSHA)").
const MOVE_LEFT_RE = /(?:\b(?:i|hold|holds|holding|have|has|a|an|the|my|our|current|currently|valid|active|fully|certified|licensed|am|is|also|with|earned|obtained|passed|completed|got|and)\s+)+$/i;
const MOVE_RIGHT_RE =
  /^(?:\s+(?:certification|certificate|card|license|licence|certified|licensed|endorsement|permit|registry|status|holder))*(?:\s*\([^)]{1,15}\))?(?:,?\s*(?:(?:that\s+is|which\s+is|is|and\s+is)\s+)?(?:(?:current|valid|active|expired|lapsed|renewed)(?:\s+(?:through|until|since|in)\s+(?:19|20)\d{2})?|in good standing|up to date|(?:since|from|in|through|until|valid through|current through|expires?|exp\.?)\s+(?:19|20)\d{2}))*/i;
// A leftover may not start or end on a joining word.
const ORPHAN_START_RE = /^(?:and|or|but|so|who|which|that|as|with|while|plus)\b[\s,]*/i;
const ORPHAN_END_RE = /[\s,]*\b(?:and|or|but|so|who|which|that|as|with|while|plus)$/i;

/** Take a credential's words out of a longer sentence. Returns the rest of the sentence, tidied. */
function removeFromSentence(sentence: string, raw: string): string {
  const pattern = new RegExp(escapeRe(raw.trim()).replace(/\s+/g, "\\s+"), "i");
  const m = sentence.match(pattern);
  if (!m || m.index === undefined) return sentence;
  let start = m.index;
  let end = m.index + m[0].length;
  const left = sentence.slice(0, start).match(MOVE_LEFT_RE);
  if (left) start -= left[0].length;
  const right = sentence.slice(end).match(MOVE_RIGHT_RE);
  if (right) end += right[0].length;
  return (sentence.slice(0, start) + " " + sentence.slice(end))
    .replace(/\(\s*\)/g, "")
    .replace(/([.!?])\s*[,;:]\s*/g, "$1 ")
    .replace(/\s+([,.;:])/g, "$1")
    .replace(/([,;:])\s*([,;:.])/g, "$2")
    .replace(/^\s*[,;:]\s*/, "")
    .replace(/\s{2,}/g, " ")
    .replace(/\.{2,}/g, ".")
    .trim()
    .replace(ORPHAN_START_RE, "")
    .replace(ORPHAN_END_RE, "")
    .replace(/[\s,;:]+([.!?]?)$/, "$1")
    .trim()
    .replace(/^[a-z]/, (c) => c.toUpperCase());
}

// A sentence that only carries the dropped sentence's status ("It is current and in good standing.").
const STATUS_FOLLOW_RE = /^(?:it|this|that|which|both|they|these|each|all|mine|my card|the card)\b/i;
const STATUS_ANY_RE = /\b(?:current|currently|valid|active|expired|expires|renewed|renew|lapsed|in good standing|up to date|good for|good through|through|until)\b/i;

/**
 * Drop every sentence of a letter paragraph that names the credential, and a
 * sentence right after one that only carries its status. Returns the
 * paragraph without them.
 */
function dropSentences(paragraph: string, raw: string): string {
  const pattern = new RegExp(escapeRe(raw.trim()).replace(/\s+/g, "\\s+"), "i");
  const kept: string[] = [];
  let dropped = false;
  for (const sent of paragraph.split(/(?<=[.!?])\s+/)) {
    if (pattern.test(sent) || (dropped && STATUS_FOLLOW_RE.test(sent.trim()) && STATUS_ANY_RE.test(sent))) {
      dropped = true;
      continue;
    }
    dropped = false;
    kept.push(sent);
  }
  return kept.join(" ").replace(/\.{2,}/g, ".").trim();
}

const CERT_HEADING_RE = /^(?:certifications?|licenses?|licences?|credentials?|certifications? (?:and|&) licen[cs]es?|licen[cs]es? (?:and|&) certifications?):?$/i;

/** Put the confirmed text on its own line under CERTIFICATIONS, adding the section when it is missing. */
function ensureCertificationLine(text: string, confirmed: string): string {
  const lines = text.split("\n");
  if (lines.some((l) => squash(stripBullet(l)) === squash(confirmed))) return text;
  const head = lines.findIndex((l) => CERT_HEADING_RE.test(l.trim()));
  if (head === -1) return `${text.replace(/\s+$/, "")}\n\nCERTIFICATIONS\n- ${confirmed}`;
  let at = head + 1;
  while (at < lines.length && lines[at].trim() && !/^[A-Z][A-Z &/]{3,}:?$/.test(lines[at].trim())) at++;
  lines.splice(at, 0, `- ${confirmed}`);
  return lines.join("\n");
}

interface MovedResult {
  text: string;
  remnants: string[];
}

/**
 * Apply one confirmation to one document: every mention of the credential
 * (by its key) gives way to exactly what the person typed. A short line
 * becomes the confirmed text; a skills term leaves the skills list; inside a
 * longer sentence the credential's words come out and the rest of the
 * sentence stays to be checked like any line. On the resume the confirmed
 * text then sits on its own line under CERTIFICATIONS. The letter never keeps
 * its own version: the credential comes out of the letter's sentences.
 */
function applyToDocument(text: string, key: string | undefined, name: string, confirmed: string, isLetter: boolean): MovedResult & { droppedSentence: boolean } {
  const remnants: string[] = [];
  let droppedSentence = false;
  // A letter sentence wrapped across lines is one sentence: join it first, so it goes whole.
  if (isLetter) text = joinWrappedLines(text);
  const mentions = credentialMentionsOf(text).filter((m) => (key ? sameCredential(m.key, key) : squash(m.name) === squash(name)));
  const header = headerBlockLines(text);
  let next = text;
  let placed = false;
  for (const m of mentions) {
    if (m.term) {
      next = cutTerm(next, m.line);
      continue;
    }
    const current = linesOf(next).find((l) => l === m.line);
    if (!current) continue;
    if (isLetter) {
      // The letter never splices inside a sentence: the whole sentence goes.
      const rest = dropSentences(current, m.raw || m.name);
      droppedSentence = true;
      next = rest ? changeLine(next, m.line, rest) : cutLine(next, m.line);
      continue;
    }
    const words = stripBullet(m.line).split(/\s+/).length;
    // A credentials line, or a short line that is the credential, becomes the confirmed text.
    // A headline is never replaced whole: the credential moves out of it.
    if (!header.has(m.line) && (m.where === "credentials" || words <= 8)) {
      next = placed ? cutLine(next, m.line) : changeLine(next, m.line, confirmed);
      placed = true;
      continue;
    }
    const rest = removeFromSentence(stripBullet(current), m.raw || m.name);
    if (!rest || rest.split(/\s+/).length < 2) next = cutLine(next, m.line);
    else {
      next = changeLine(next, m.line, rest);
      remnants.push(linesOf(next).find((l) => stripBullet(l) === rest) ?? rest);
    }
  }
  if (!isLetter) next = ensureCertificationLine(next, confirmed);
  return { text: next, remnants, droppedSentence };
}

/** Join a paragraph's hard-wrapped lines: a line that does not end a sentence, followed by one that starts in lower case. */
function joinWrappedLines(text: string): string {
  const out: string[] = [];
  for (const l of text.split("\n")) {
    const prev = out[out.length - 1];
    if (prev !== undefined && prev.trim() && !/[.!?:,;]\s*$/.test(prev) && /^\s*[a-z]/.test(l)) out[out.length - 1] = `${prev.trimEnd()} ${l.trim()}`;
    else out.push(l);
  }
  return out.join("\n");
}

/** The lines above the first section heading, after the name line. */
function headerBlockLines(text: string): Set<string> {
  const out = new Set<string>();
  const ls = linesOf(text);
  for (let i = 1; i < ls.length; i++) {
    if (ANY_HEADING_RE.test(ls[i]) && !ls[i].includes("|")) break;
    if (CERT_HEADING_RE.test(ls[i]) || SKILLS_HEADING_RE.test(ls[i])) break;
    out.add(ls[i]);
  }
  return out;
}

/**
 * "Yes, I hold it" (decision D4), on both documents. Only with a kind picked
 * and a year or status that is a real answer. Returns null when the details
 * are not enough, or when nothing on either page changed (the card stays open
 * and says so).
 */
export function applyConfirmation(
  docs: { resume: string; letter: string },
  name: string,
  type: CredentialType,
  when: string
): { resume: string; letter: string; confirm: CredentialConfirm } | null {
  if (!(CREDENTIAL_TYPES as readonly string[]).includes(type) || !isCredentialWhen(when)) return null;
  const confirmed = confirmedCredentialText(name, type, when);
  const key = credentialKeyOf(name);
  // Nothing to confirm when neither page names this credential.
  const named = (t: string) => credentialMentionsOf(t).some((m) => (key ? sameCredential(m.key, key) : squash(m.name) === squash(name)));
  if (!named(docs.resume) && !named(docs.letter)) return null;
  const r = applyToDocument(docs.resume, key, name, confirmed, false);
  const l = applyToDocument(docs.letter, key, name, confirmed, true);
  // The line may already read exactly as confirmed: the confirmation still counts.
  if (r.text === docs.resume && l.text === docs.letter && !pageLineSet(docs.resume).has(squash(confirmed))) return null;
  return {
    resume: r.text,
    letter: l.text,
    confirm: { name, type, when: when.trim(), text: confirmed, key, remnants: [...r.remnants, ...l.remnants], letterSentenceDropped: l.droppedSentence },
  };
}

/**
 * The same, on one document (kept for callers that hold one page). On the
 * letter the credential comes out of its sentence; the confirmed line belongs
 * on the resume (applyConfirmation puts it there).
 */
export function confirmCredential(
  text: string,
  line: string,
  isTerm: boolean,
  name: string,
  type: CredentialType,
  when: string
): { text: string; confirm: CredentialConfirm } | null {
  if (!(CREDENTIAL_TYPES as readonly string[]).includes(type) || !isCredentialWhen(when)) return null;
  const confirmed = confirmedCredentialText(name, type, when);
  const key = credentialKeyOf(name);
  // A document with no CERTIFICATIONS heading and no resume header is read as a letter.
  const isLetter = /^\s*dear\b/im.test(text) && !CERT_HEADING_RE.test(text);
  const r = applyToDocument(text, key, name, confirmed, isLetter);
  if (r.text === text) return null;
  void line;
  void isTerm;
  return { text: r.text, confirm: { name, type, when: when.trim(), text: confirmed, key, remnants: r.remnants, letterSentenceDropped: r.droppedSentence } };
}

/** "No, take it off": the term, the short line, or the credential's words inside a longer sentence. */
export function cutCredential(text: string, line: string, isTerm: boolean, name: string): string {
  if (isTerm) return cutTerm(text, line);
  if (stripBullet(line).split(/\s+/).length <= 8) return cutLine(text, line);
  const m = credentialMentionsOf(text).find((x) => x.line === line && (squash(x.name) === squash(name) || squash(x.raw) === squash(name)));
  const at = linesOf(text).find((l) => l === line);
  if (!at) return text;
  const rest = removeFromSentence(stripBullet(at), m?.raw || name);
  return rest && rest !== stripBullet(at) ? changeLine(text, line, rest) : text;
}


// ---- the view ------------------------------------------------------------------

export type GroupTarget = "resume" | "letter" | "skill" | "skillset";

/** The one keep-or-cut card for skills the person never said (D3). */
export const SKILLS_CARD_KEY = "Skills added for you";
export const SKILLS_CARD_TEXT = "These skills were added for you. Keep the ones that are true.";

/** The credential name a memory-prompt item is about: its full name from the check, never a clipped one. */
function unsaidName(i: OpenItem): string {
  return i.subject ?? i.why.match(/"([^"]+)"/)?.[1] ?? stripBullet(i.line);
}

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
  /** On the skills card: every term to keep or cut. */
  terms?: string[];
  /** On a memory prompt (a credential the person never mentioned): its name. */
  credentialName?: string;
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
  /** Every explainable line on the resume is in the person's own words, so none was asked to fill a minimum. */
  allLinesInOwnWords: boolean;
}

/** Items an answer in the person's own words can settle. A second-check item is settled only by a change or a fresh check. */
const ANSWERABLE = (i: OpenItem) =>
  i.from !== "second_check" && i.kind !== "credential_remnant" && i.kind !== "scope_unsaid" && (i.rule === "STD-C04" || i.rule === "STD-C03");

// Words that start a fragment, not a sentence: a joining word or a relative pronoun.
const FRAGMENT_START_RE = /^(?:and|or|but|so|nor|yet|plus|who|whom|whose|which|that|where|while|as|with|because|since|although|though|than)\b/i;
const IRREGULAR_VERB_RE =
  /\b(?:ran|run|runs|led|lead|leads|made|make|makes|kept|keep|keeps|built|build|builds|drove|drive|drives|took|take|takes|did|do|does|got|get|gets|went|go|goes|set|sets|held|hold|holds|fed|feed|met|meet|sold|sell|taught|teach|put|cut|cuts|brought|bring|bought|buy|caught|dug|fixed|fix|fixes|ate|wrote|write|writes|read|reads|spoke|speak|swept|sweep|stood|stand|told|tell|found|find|gave|give|gives|left|lift|lifts|load|loads|cook|cooks|clean|cleans|open|opens|close|closes|serve|serves|stock|stocks|pack|packs|help|helps|work|works|is|was|are|were|am|has|have|had)\b/i;

/** True when a leftover reads as a fragment: it starts lower case, starts on a joining word, or has no verb. */
export function readsAsFragment(text: string): boolean {
  const t = text.trim();
  if (!t) return true;
  if (/^[a-z]/.test(t)) return true;
  if (FRAGMENT_START_RE.test(t)) return true;
  const hasVerb = /\b[a-z]{2,}(?:ed|ing)\b/i.test(t) || IRREGULAR_VERB_RE.test(t);
  return !hasVerb;
}

type GroundingOutcome = { claim?: unknown; doc?: unknown; status?: unknown };

/** The page line holding a claim, matched the way the claim trace matches it (number words, punctuation). */
function lineWithClaim(text: string, claim: string): string | undefined {
  const n = normalizeForMatch(claim);
  if (!n) return undefined;
  return linesOf(text).find((l) => ` ${normalizeForMatch(l)} `.includes(` ${n} `));
}

/**
 * The claim trace from generate-docs, as open items: a claim it flagged that
 * is still on the page or survives reworded, and a line that may say more
 * about a credential than the person did. An edit settles one only when the
 * claim is gone (flagOutcome "removed"); reordering its words does not. A
 * claim still on the page but across lines is held in the general list.
 */
function groundingItems(grounding: unknown, resumeText: string, letterText: string, written?: WrittenDocs | null): GateItem[] {
  const outcomes = (grounding as { outcomes?: unknown })?.outcomes;
  if (!Array.isArray(outcomes)) return [];
  const items: GateItem[] = [];
  for (const o of outcomes as GroundingOutcome[]) {
    if (typeof o?.claim !== "string" || !o.claim.trim()) continue;
    if (o.status !== "still_there" && o.status !== "credential" && o.status !== "changed") continue;
    const target: GroupTarget = o.doc === "cover_letter" ? "letter" : "resume";
    const text = target === "letter" ? letterText : resumeText;
    const original = written ? (target === "letter" ? written.letter : written.resume) : text;
    const now = flagOutcome({ claim: o.claim, why: "" }, original || text, text);
    if (now === "removed") continue;
    if (now === "unmatched" && !lineWithClaim(text, o.claim)) continue;
    const line = lineWithClaim(text, o.claim) ?? "";
    const credential = o.status === "credential";
    items.push({
      rule: credential ? "STD-T03" : "STD-C04",
      severity: "BLOCK",
      // Not on one line (across lines, or reworded): held in the general list.
      line: line || "",
      target,
      trace: true,
      why: credential
        ? "Our second check says this may say more about a card, license or certification than you told us."
        : "Our second check couldn't match this to anything you told us.",
      question: credential
        ? "Change it to what you actually hold, the way your card or papers say it, or cut it."
        : line
          ? "Tell me in one sentence how you'd describe this, in your own words. If it isn't true, change it or cut it."
          : `Our second check flagged "${o.claim.trim().slice(0, 80)}". Find it on the page and change it or cut it.`,
    });
  }
  return items;
}

// ---- the cover letter ---------------------------------------------------------------

/** New (round 3): a letter credential the resume card already asks about. */
export const Q_LETTER_SHARED = "Answer this one on your resume card. Then the letter changes to match, or you can cut it here.";
/** New (round 3): a letter credential with a status or year the person never gave. */
export const Q_LETTER_STATUS = "If an interviewer read this, would the status be true? It isn't one you gave us. Change it or cut it.";
/** New (round 3): a mention that disagrees with what the person confirmed. */
export function confirmedMismatchQuestion(text: string): string {
  return `An interviewer will hold you to what you told us: "${text}". Change this to match it, or cut it.`;
}
/** New (round 3): writer's status words left in a sentence after the credential moved out. */
export const Q_STATUS_LEFT = "This line still has a status word that went with the credential you confirmed. If an interviewer asked, it would point at nothing. Change the line or cut it.";
// Long names and their short forms, only to notice two confirmations that may
// be one credential. Never used to decide a credential is said or held.
const SAME_NAME: Array<[RegExp, string]> = [
  [/\bcommercial driver'?s?\b(?:\s+licen[cs]e)?/gi, "cdl"],
  [/\b(?:certified\s+)?nursing\s+assistant\b/gi, "cna"],
  [/\bemergency\s+medical\s+technician\b/gi, "emt"],
  [/\bbasic\s+life\s+support\b/gi, "bls"],
  [/\bcardiopulmonary\s+resuscitation\b/gi, "cpr"],
  [/\b(\d+)[\s-]*hour\b/gi, "$1"],
];
function sameNameWords(name: string): string {
  return SAME_NAME.reduce((t, [re, to]) => t.replace(re, to), name);
}

/** New (round 5): two confirmations that may be one credential, told two ways. */
export function confirmedConflictQuestion(a: string, b: string): string {
  return `You told us "${a}" and "${b}". If they are the same one, cut the one that is wrong.`;
}
/** New (round 4): a line the move changed. Only the person's own rewrite or a cut clears it. */
export const Q_REMNANT = "This line changed when the credential moved. Read it again: reword it in your own words, or cut it.";
/** New (round 4): a sentence about a credential was taken out of the letter. */
export function letterNote(name: string): string {
  return `We took out a sentence about ${name}. Add one in your own words if you want.`;
}
const STATUS_LEFT_RE = /\b(current|currently|valid|active|expired|renewed|lapsed|in good standing|up to date|through|until)\b/i;

// A courtesy sentence ("I would welcome the chance to talk") makes no claim.
const COURTESY_RE = /\b(?:would|welcome|glad|talk|thank|thanks|look forward|appreciate|happy to|eager|excited|hear from|reach me|contact me|consideration|sincerely|regards|dear)\b/i;
const SCOPE_RE = /\b(supervis\w*|manag\w*|led|lead\w*|oversaw|oversee\w*|direct\w*|train(?:ed|ing)?|mentor\w*|coordinat\w*)\b/gi;
const LETTER_FAR = 0.5;

/** The claim sentences of a letter, each with the letter line it is on. */
function letterSentences(letter: string): Array<{ line: string; sentence: string }> {
  const out: Array<{ line: string; sentence: string }> = [];
  for (const line of linesOf(letter)) {
    for (const sentence of line.split(/(?<=[.!?])\s+/)) {
      const t = sentence.trim();
      if (!t || t.split(/\s+/).length < 4 || COURTESY_RE.test(t)) continue;
      out.push({ line, sentence: t });
    }
  }
  return out;
}

/**
 * The letter's own checks beyond the mint check: a sentence far from the
 * person's words (above half its words new, against their words and the
 * resume as it stands now), and a scope word ("supervised", "managed", "led",
 * "trained") the person never used. Each is a BLOCK an answer settles, like a
 * defend line. Credentials in the letter are checked by name, once, skipping
 * any the resume already asks about.
 */
function letterItems(
  letter: string,
  resumeText: string,
  source: string,
  answers: DefendAnswer[],
  credentialsAnswer: string | undefined,
  askedOnResume: Set<string>
): GateItem[] {
  const items: GateItem[] = [];
  const against = `${source}\n${resumeText}`;
  for (const { line, sentence } of letterSentences(letter)) {
    // A scope claim the person never made: only their own rewrite or a cut settles it.
    const hit = scopeNotTheirs(sentence, source);
    if (hit && !items.some((i) => i.line === line && i.kind === "scope_unsaid")) {
      items.push({ rule: "STD-C04", severity: "BLOCK", line, target: "letter", kind: "scope_unsaid", why: scopeWhy(hit.word), question: Q_SCOPE });
    }
    // A sentence far from the person's words: settled by an answer, like a defend line.
    if (distanceFromSource(sentence, against) <= LETTER_FAR) continue;
    if (answerStands(answerFor(answers, line), line, source)) continue;
    if (items.some((i) => i.line === line && i.rule === "STD-C04" && i.kind !== "scope_unsaid")) continue;
    items.push({
      rule: "STD-C04",
      severity: "BLOCK",
      line,
      target: "letter",
      why: "Most of this sentence isn't in anything you told us.",
      question: "Tell me in one sentence how you'd describe this line.",
    });
  }
  // Every letter credential is a memory prompt (round 5), unless it is
  // exactly a line the person typed. One the resume also names is asked
  // once, on the resume; the letter item points there and the letter
  // follows the confirmation.
  // The resume's card is the one place a shared credential is asked. While it
  // is open the page is a draft; confirming it takes the letter's sentence
  // out, and cutting it leaves the letter's mention to be asked here.
  for (const m of credentialsToAsk(letter, credentialsAnswer, askedOnResume)) {
    items.push({
      rule: "STD-T03",
      severity: "BLOCK",
      line: m.line,
      target: "letter",
      kind: "credential_unsaid",
      subject: m.name,
      why: credentialPromptWhy(m.name),
      question: credentialMemoryPrompt(m.name),
    });
  }
  return items;
}

export function buildFinishView(input: {
  resumeText: string;
  ownWords: string;
  defendAnswers: DefendAnswer[];
  coverLetterText?: string;
  /** The writer's documents as delivered. Without them, rewrites add nothing to the person's words. */
  written?: WrittenDocs | null;
  /** Skill terms the person added from a posting (keyword check). */
  addedTerms?: string[];
  /** Skills terms kept on the "added for you" card (D3). */
  keptTerms?: string[];
  /** Credentials confirmed with the person's own type and year or status (D4). */
  confirmedCredentials?: CredentialConfirm[];
  /** The grounding block from generate-docs, when there is one. */
  grounding?: unknown;
  /** The second check's findings, only when it ran. */
  secondCheckFindings?: ReadonlyArray<SecondCheckFinding>;
  /** What the person typed in the Forge's licenses-and-training answer (the one exact-match exception). */
  credentialsAnswer?: string;
}): FinishView {
  const letter = input.coverLetterText ?? "";
  const answers = input.defendAnswers;
  // Round 3: what the person settles on a card settles only that card's item.
  // Kept terms and confirmed credentials never join the person's words.
  const source = gateSource(input.ownWords, answers, [input.resumeText, letter], input.written);
  const kept = new Set((input.keptTerms ?? []).map((t) => t.trim().toLowerCase()));
  // A confirmation counts only when it is valid and its line is on the page
  // exactly as the person typed it. That one line is theirs and is not checked
  // again; every other line is checked as before.
  const validConfirms = (input.confirmedCredentials ?? [])
    .filter((c) => (CREDENTIAL_TYPES as readonly string[]).includes(c.type) && isCredentialWhen(c.when))
    .map((c) => ({ ...c, text: confirmedCredentialText(c.name, c.type, c.when), key: c.key ?? credentialKeyOf(c.name) }));
  // One credential, one confirmation: the last one for a key is the one that counts.
  const lastByKey = new Map<string, (typeof validConfirms)[number]>();
  for (const c of validConfirms) lastByKey.set(c.key ?? squash(c.name), c);
  const confirms = Array.from(lastByKey.values()).filter((c) => pageLineSet(input.resumeText).has(squash(c.text)));
  const confirmedLines = new Set(confirms.map((c) => squash(c.text)));
  const resumeForChecks = input.resumeText
    .split("\n")
    .filter((l) => !confirmedLines.has(squash(stripBullet(l))))
    .join("\n");
  const status = getResumeStatus({
    resumeText: resumeForChecks,
    sourceText: source,
    defendAnswers: answers,
    secondCheckFindings: input.secondCheckFindings,
    credentialsAnswer: input.credentialsAnswer,
  });

  const resumeLines = pageLineSet(input.resumeText);
  const letterLines = pageLineSet(letter);
  const items: GateItem[] = [];
  for (const i of status.openItems) {
    // Skills terms the person never said go on ONE keep-or-cut card (D3).
    if (i.kind === "grid_term") {
      if (kept.has(i.line.trim().toLowerCase())) continue;
      items.push({ ...i, severity: "BLOCK", target: "skillset" });
      continue;
    }
    // A skills term with a scope word is a claim: its own card, settled
    // only by cutting it (round 5: an answer never settles a scope claim).
    if (i.kind === "grid_scope_term") {
      items.push({ ...i, severity: "BLOCK", target: "skill" });
      continue;
    }
    // A credential that is one term of a skills line is asked about as that term.
    if (i.line && !resumeLines.has(squash(stripBullet(i.line))) && termOnPage(input.resumeText, i.line)) {
      items.push({ ...i, target: "skill" });
      continue;
    }
    items.push({ ...i, target: "resume" });
  }

  // The cover letter ships in the same package, so it is checked too.
  if (letter.trim() && input.resumeText.trim() && source.trim()) {
    for (const f of runMintCheck({ output: letter, source, kind: "cover_letter" }).findings) {
      items.push({ rule: f.rule, severity: f.severity, line: f.line, why: f.why, question: questionForFinding(f), target: "letter" });
    }
    const askedOnResume = new Set(credentialsToAsk(resumeForChecks, input.credentialsAnswer).map((m) => m.key));
    items.push(...letterItems(letter, input.resumeText, source, answers, input.credentialsAnswer, askedOnResume));
  }

  // Skills added from a posting go on the same keep-or-cut card.
  for (const term of Array.from(new Set((input.addedTerms ?? []).map((t) => t.trim()).filter(Boolean)))) {
    if (!termOnPage(input.resumeText, term)) continue;
    if (kept.has(term.toLowerCase())) continue;
    if (items.some((i) => (i.target === "skill" || i.target === "skillset") && i.line.toLowerCase() === term.toLowerCase())) continue;
    items.push({
      rule: "STD-T01",
      severity: "BLOCK",
      line: term,
      target: "skillset",
      kind: "grid_term",
      why: "You added this from a job posting.",
      question: SKILLS_CARD_TEXT,
    });
  }

  // Every other mention of a confirmed credential must say what the person
  // confirmed. A leftover writer's status after a move is flagged.
  const keyed = confirms.filter((c) => c.key);
  const mismatchLines = new Set<string>();
  for (const [doc, target] of [[resumeForChecks, "resume"], [letter, "letter"]] as const) {
    for (const m of credentialMentionsOf(doc)) {
      const c = keyed.find((x) => sameCredential(x.key as string, m.key));
      if (!c) continue;
      const t: GroupTarget = m.term ? "skill" : target;
      mismatchLines.add(`${t}\u0000${m.line}`);
      items.push({
        rule: "STD-T03",
        severity: "BLOCK",
        line: m.line,
        target: t,
        kind: "credential_confirmed_mismatch",
        subject: m.name,
        why: `You told us "${c.text}". This says it differently.`,
        question: confirmedMismatchQuestion(c.text),
      });
    }
  }
  if (mismatchLines.size) {
    for (let k = items.length - 1; k >= 0; k--) {
      const it = items[k];
      if (it.kind === "credential_confirmed_mismatch") continue;
      const credentialItem = it.rule === "STD-T03" || /a license, a certification, or a training course/.test(it.question);
      if (credentialItem && mismatchLines.has(`${it.target}\u0000${it.line}`)) items.splice(k, 1);
    }
  }
  // Two confirmations that may be one credential spelled two ways ("OSHA 10"
  // and "10-hour OSHA") must not tell two stories. When one name's words are
  // all in the other's and the kind or the year or status differ, the later
  // line is held until the person cuts the one that is wrong.
  const tokensOf = (c: (typeof confirms)[number]) =>
    new Set(
      (credentialKeyOf(sameNameWords(c.name)) ?? "")
        .split(/\s+/)
        .map((w) => w.replace(/'s$|s$/, ""))
        .filter((w) => w.length > 0 && w !== "class")
    );
  for (let a = 0; a < confirms.length; a++) {
    for (let b = a + 1; b < confirms.length; b++) {
      const [x, y] = [confirms[a], confirms[b]];
      if (x.type === y.type && x.when.trim().toLowerCase() === y.when.trim().toLowerCase()) continue;
      const tx = tokensOf(x);
      const ty = tokensOf(y);
      const within = (p: Set<string>, q: Set<string>) => p.size > 0 && Array.from(p).every((w) => q.has(w));
      if (!within(tx, ty) && !within(ty, tx)) continue;
      const line = linesOf(input.resumeText).find((l) => squash(stripBullet(l)) === squash(y.text));
      if (!line) continue;
      items.push({
        rule: "STD-T03",
        severity: "BLOCK",
        line,
        target: "resume",
        kind: "credential_confirmed_conflict",
        subject: y.name,
        why: `You told us "${x.text}" and "${y.text}".`,
        question: confirmedConflictQuestion(x.text, y.text),
      });
    }
  }
  // What is left of a sentence the credential moved out of is held until the
  // person rewords it in their own words or cuts it, when it reads as a
  // fragment or is not their own words. A clean leftover in their own words
  // is not held: every other check still reads it.
  for (const c of validConfirms) {
    for (const rem of c.remnants ?? []) {
      for (const [doc, target] of [[input.resumeText, "resume"], [letter, "letter"]] as const) {
        const line = linesOf(doc).find((l) => squash(stripBullet(l)) === squash(stripBullet(rem)));
        if (!line) continue;
        if (!readsAsFragment(stripBullet(line)) && distanceFromSource(stripBullet(line), source) === 0) continue;
        items.push({ rule: "STD-C04", severity: "BLOCK", line, target, kind: "credential_remnant", why: "This line changed when the credential moved.", question: Q_REMNANT });
      }
    }
    if (c.letterSentenceDropped && letter.trim()) {
      items.push({ rule: "STD-C04", severity: "FIX", line: "", target: "letter", kind: "credential_letter_note", why: `We took out a sentence about ${c.name} from your cover letter.`, question: letterNote(c.name) });
    }
  }

  // The claim trace, settled by a standing answer when it asks for one.
  for (const g of groundingItems(input.grounding, input.resumeText, letter, input.written)) {
    if (g.line && g.rule === "STD-C04" && answerStands(answerFor(answers, g.line), g.line, source)) continue;
    // Already held on that line under the same rule: mark it as the claim trace's too.
    const same = g.line ? items.find((i) => i.target === g.target && i.line === g.line && i.rule === g.rule) : undefined;
    if (same) {
      same.trace = true;
      continue;
    }
    items.push(g);
  }

  // An item whose line is not on its page cannot be changed or cut there.
  const onItsPage = (i: GateItem) =>
    i.target === "skill" || i.target === "skillset" ? true : (i.target === "letter" ? letterLines : resumeLines).has(squash(stripBullet(i.line)));
  // A non-blocking item must point at a line on the page; one about the person's own words loses its line.
  for (const i of items) if (i.severity === "FIX" && i.line && !onItsPage(i)) i.line = "";
  const general = items.filter((i) => !i.line || !onItsPage(i));
  const lined = items.filter((i) => i.line && onItsPage(i));

  const byLine = new Map<string, GateItem[]>();
  for (const item of lined) {
    // Every added skill is one card, not one card per term.
    const k = item.target === "skillset" ? "skillset" : `${item.target}\u0000${item.line}`;
    const list = byLine.get(k) ?? [];
    list.push(item);
    byLine.set(k, list);
  }

  const order = linesOf(input.resumeText);
  const targetRank: Record<GroupTarget, number> = { resume: 0, skill: 1, skillset: 2, letter: 3 };
  const groups: LineGroup[] = Array.from(byLine.values()).map((its) => {
    const unsaid = its.find((i) => i.kind === "credential_unsaid");
    return {
      line: its[0].target === "skillset" ? SKILLS_CARD_KEY : its[0].line,
      target: its[0].target,
      items: its,
      blocking: its.some((i) => i.severity === "BLOCK"),
      answerable: its[0].target !== "skillset" && !unsaid && its.every((i) => ANSWERABLE(i)),
      checked: false,
      answer: its[0].target === "skillset" ? undefined : answerFor(answers, its[0].line),
      ...(its[0].target === "skillset"
        ? { terms: its.map((i) => i.line).filter((t, k, all) => all.findIndex((x) => x.toLowerCase() === t.toLowerCase()) === k) }
        : {}),
      ...(unsaid ? { credentialName: unsaidName(unsaid) } : {}),
    };
  });
  groups.sort(
    (a, b) =>
      Number(b.blocking) - Number(a.blocking) ||
      targetRank[a.target] - targetRank[b.target] ||
      order.indexOf(a.line) - order.indexOf(b.line)
  );

  const openDefend = new Set(status.openItems.filter((i) => i.rule === "STD-C04").map((i) => squash(i.line)));
  const grouped = new Set(groups.map((g) => g.line));
  const checkedLines: LineGroup[] = status.defendLines
    .filter((d) => !openDefend.has(squash(d.line)))
    .filter((d) => !grouped.has(d.line))
    .map((d) => ({
      line: d.line,
      target: resumeLines.has(squash(stripBullet(d.line))) ? ("resume" as const) : ("skill" as const),
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
    allLinesInOwnWords: status.allLinesInOwnWords,
  };
}

/**
 * The open items in plain words, for the DRAFT file's to-do page. Every BLOCK
 * and every FIX the gate holds (resume, letter, added skills), nothing added.
 */
export function openItemsInPlainWords(view: { openItems: Array<OpenItem & { target?: GroupTarget }> }): string[] {
  return view.openItems.map((i) => {
    const what = i.severity === "BLOCK" ? "Fix before you send" : "Worth checking";
    const where = i.target === "letter" ? " (cover letter)" : i.target === "skill" || i.target === "skillset" ? " (skills)" : "";
    return i.line ? `${what}${where}: "${stripBullet(i.line)}" ${i.question}` : `${what}${where}: ${i.question}`;
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
