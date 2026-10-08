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
import { namedCredentialRe, credentialInitialsRe } from "@crucible/core/src/credentialWords";
import { scopeNotTheirs, straightQuotes } from "@crucible/core/src/scopeWords";
import { isStrictCredentialWhen } from "@crucible/core/src/credentialStatus";
import {
  credentialHomes,
  credentialKeyOf,
  credentialMentionsOf,
  credentialsToAsk,
  removeCredentialPart,
  sameCredential,
  mentionsOfName,
  titleOfHeader,
  credentialLineText,
  educationLineRewrite,
  educationAttendedLine,
  isAttendedYears,
  attendedYears,
  isConfirmedAttendedLine,
  withoutEducationPart,
  isConfirmedEducationLine,
  isLiveCredential,
  liveCredentialCovers,
  type CredentialMention,
  type CredentialRow,
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
  /** What "No, take it off" left of longer sentences (round 6), held like a confirmed move's leftover. */
  credentialCutRemnants?: string[];
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
  /** Round 9: an education line keeps its school: the whole line as rewritten ("GED, in progress | Toledo Adult Education"). */
  line?: string;
  /** Round 10 (SF-7): a line already on the page that shows this confirmation ("- AWS D1.1 certification, 2019" for "AWS, certification, 2019"). */
  coveredBy?: string;
}

export const CREDENTIAL_TYPES = ["license", "certification", "card", "training course", "permit"] as const;
/**
 * Round 8: an education line (GED, diploma, degree) is confirmed as earned or
 * in progress. Round 10 (SF-1): or "did not finish": the school stays with
 * only the years the person typed, and no completion word.
 */
export const EDUCATION_KINDS = ["earned", "in progress", "did not finish"] as const;
export type CredentialType = (typeof CREDENTIAL_TYPES)[number] | (typeof EDUCATION_KINDS)[number];
const ALL_KINDS: readonly string[] = [...CREDENTIAL_TYPES, ...EDUCATION_KINDS];
const isEducationKind = (t: string) => (EDUCATION_KINDS as readonly string[]).includes(t);

/**
 * True when the year-or-status box is a real answer for this kind (round 9,
 * r9-N5): "earned" needs a real year ("2015"), never "current"; "in
 * progress" needs nothing more; a credential takes a year or a status.
 */
export function isConfirmWhen(type: string, when: string): boolean {
  if (type === "in progress") return true;
  if (type === "did not finish") return isAttendedYears(when);
  if (!isCredentialWhen(when)) return false;
  if (type === "earned") return /\b(?:19|20)\d{2}\b/.test(when) && !/[a-z]/i.test(when.replace(/\b(?:in|earned|got|finished|graduated|completed)\b/gi, ""));
  return true;
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
    credentialCutRemnants: Array.isArray(s.credentialCutRemnants) ? s.credentialCutRemnants.filter((r): r is string => typeof r === "string" && !!r.trim()) : [],
    confirmedCredentials: Array.isArray(s.confirmedCredentials)
      ? s.confirmedCredentials
          .filter(
            (c): c is CredentialConfirm =>
              !!c &&
              typeof c.name === "string" &&
              typeof c.when === "string" &&
              ALL_KINDS.includes(c.type as string) &&
              isConfirmWhen(c.type as string, c.when) &&
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
            // An education line and a covering line are re-checked against the page and the person's words in buildFinishView.
            ...(typeof c.line === "string" && isEducationKind(c.type) ? { line: c.line } : {}),
            ...(typeof c.coveredBy === "string" && !isEducationKind(c.type) ? { coveredBy: c.coveredBy } : {}),
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
  // Round 10 (SF-5): phones type curly apostrophes ("I’ve trained"); the person's words are read with straight ones.
  const own = straightQuotes(ownWords);
  const added = rewritesOf(answers, pages, written);
  return added ? `${own}\n\n${straightQuotes(added)}` : own;
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

/** The line itself, exactly, before any other line with the same words (round 9: "- Certified Nursing Assistant" is the list line, not the headline above it). */
function lineIndexOf(lines: string[], line: string, target: string): number {
  const exact = lines.findIndex((l) => l.trim() === line.trim());
  return exact !== -1 ? exact : lines.findIndex((l) => stripBullet(l) === target);
}

/** Take one line off the page. Returns the text unchanged when the line is not there. */
export function cutLine(resumeText: string, line: string): string {
  const target = stripBullet(line);
  if (!target) return resumeText;
  const out = resumeText.split("\n");
  const hit = lineIndexOf(out, line, target);
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
  const hit = lineIndexOf(out, line, target);
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

/** The line as the person confirmed it: the name, the kind they picked, and their own year or status (core credentialLineText). */
export function confirmedCredentialText(name: string, type: CredentialType, when: string): string {
  // An education line keeps its own name: "GED, 2019", "High School Diploma, in progress".
  if (type === "did not finish") {
    const y = attendedYears(when);
    return `${name.trim()}, attended${y ? ` ${y}` : ""}`;
  }
  if (isEducationKind(type)) return type === "in progress" ? `${name.trim()}, in progress` : `${name.trim()}, ${when.trim().replace(/[.\s]+$/, "")}`;
  return credentialLineText(name, type, when);
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

/** A credential's words as a pattern that also matches them joined by a hyphen ("forklift-certified"). */
function wordsPattern(raw: string): RegExp {
  return new RegExp(escapeRe(raw.trim()).replace(/(?:\\s|\s|-|\\-)+/g, "[\\s\\u2010-\\u2015-]+"), "i");
}

/** Take a credential's words out of a longer sentence. Returns the rest of the sentence, tidied. */
function removeFromSentence(sentence: string, raw: string): string {
  const pattern = wordsPattern(raw);
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

// A period after one of these is not a sentence end ("Main St.", "Acme Inc.", "U.S.", "Dr. Lee", "J. Smith").
const ABBREV_END_RE = /(?:\b(?:St|Ave|Rd|Blvd|Hwy|Ln|Ct|Pl|Ste|Inc|Co|Corp|Ltd|LLC|Bros|Mfg|Assn|Intl|Twp|Dr|Mr|Mrs|Ms|Jr|Sr|No|Mt|Ft|Dept|Univ|vs|etc|approx|a\.m|p\.m|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\.|\b[A-Z]\.|(?:\b[A-Za-z]\.){2,})$/;

/** The sentences of a paragraph, never broken at an abbreviation or an initial. */
export function splitSentences(paragraph: string): string[] {
  const pieces = paragraph.split(/(?<=[.!?])\s+/);
  const out: string[] = [];
  for (const p of pieces) {
    const prev = out[out.length - 1];
    // Join when the last piece ends on an abbreviation, or this one does not start a sentence.
    // Join when the last piece ends on an abbreviation, or this one does not start a sentence (lower case, a digit).
    if (prev !== undefined && (ABBREV_END_RE.test(prev) || !/^["'(\[]?[A-Z]/.test(p))) out[out.length - 1] = `${prev} ${p}`;
    else out.push(p);
  }
  return out;
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
  const pattern = wordsPattern(raw);
  const kept: string[] = [];
  let dropped = false;
  for (const sent of splitSentences(paragraph)) {
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

/**
 * Round 10 (SF-7): a credentials line already on the page that shows this
 * confirmation: its name holds every word of the confirmed name ("AWS D1.1"
 * for "AWS", "OSHA 10" for "OSHA 10 trained"), and it shows the same kind
 * and the same year or status.
 */
export function coveringCertificationLine(text: string, name: string, type: string, when: string): string | undefined {
  const want = (credentialKeyOf(name) ?? "").split(" ").filter(Boolean);
  if (!want.length) return undefined;
  const kindWord = type === "certification" ? "certif" : type === "training course" ? "course" : type;
  const words = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const whenWords = words(when).split(" ").filter(Boolean);
  for (const m of credentialMentionsOf(text)) {
    if (m.where !== "credentials" || m.education) continue;
    const have = (credentialKeyOf(m.name) ?? "").split(" ");
    const shown = words(m.unit);
    if (want.every((w) => have.includes(w)) && shown.includes(kindWord) && whenWords.every((w) => shown.split(" ").includes(w))) return m.line;
  }
  return undefined;
}

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
function applyToDocument(
  text: string,
  key: string | undefined,
  name: string,
  confirmed: string,
  isLetter: boolean,
  opts: { education?: boolean; held?: { name: string; kind: string; when: string }; personText?: string; covered?: string } = {}
): MovedResult & { droppedSentence: boolean; educationLine?: string } {
  const education = !!opts.education;
  const remnants: string[] = [];
  let droppedSentence = false;
  let educationLine: string | undefined;
  // A letter sentence wrapped across lines is one sentence: join it first, so it goes whole.
  if (isLetter) text = joinWrappedLines(text);
  const found = credentialMentionsOf(text).filter((m) => (key ? sameCredential(m.key, key) : squash(m.name) === squash(name)));
  // A credential the backstop found ("QMA") is found again by its name.
  const mentions = [...found, ...mentionsOfName(text, name).filter((b) => !found.some((f) => f.line === b.line))];
  const header = headerBlockLines(text);
  let next = text;
  let placed = false;
  for (const m of mentions) {
    // A credential in a job title stays in the title: the confirmation makes that word theirs, the rest of the title is still checked.
    if (m.title) continue;
    if (m.term) {
      next = cutTerm(next, m.line);
      continue;
    }
    const current = linesOf(next).find((l) => l === m.line);
    if (!current) continue;
    // Round 9 (r9-S2): a credential they hold now stays where a sentence names it plainly
    // ("Certified nursing assistant with eight years", "as a certified nursing assistant at Meadowbrook").
    if (opts.held && liveCredentialCovers(m, opts.held)) continue;
    // Round 9 (r9-N4): an education line changes only in the part the prompt named; the school stays.
    if (!isLetter && education && m.education && m.where === "credentials") {
      if (placed) {
        next = cutLine(next, m.line);
        continue;
      }
      const rewritten = educationLineRewrite(m.line, m.raw || m.name, confirmed, opts.personText);
      next = changeLine(next, m.line, rewritten.line);
      // Round 10 (SF-3): what the writer added beside it (honors, a program, a training) stays on its own line, checked like any line.
      if (rewritten.rest) next = insertLineAfter(next, rewritten.line, rewritten.rest);
      educationLine = stripBullet(rewritten.line);
      placed = true;
      continue;
    }
    // Round 10 (SF-2): a credential on an education line moves out of it; the schooling stays.
    if (!isLetter && !education && m.onEducationLine) {
      const rest = withoutEducationPart(current, m.raw || m.name);
      next = rest ? changeLine(next, m.line, rest) : cutLine(next, m.line);
      continue;
    }
    if (isLetter) {
      // The letter never splices inside a sentence: the whole sentence goes.
      const rest = dropSentences(current, m.raw || m.name);
      droppedSentence = true;
      next = rest ? changeLine(next, m.line, rest) : cutLine(next, m.line);
      // Whatever stays of that paragraph is read again: a fragment, or a status with no credential, is held.
      if (rest && splitSentences(rest).some((sent) => readsAsFragment(sent) || (STATUS_ANY_RE.test(sent) && !credentialMentionsOf(`x\n${sent}`).length))) {
        remnants.push(linesOf(next).find((l) => l === rest) ?? rest);
      }
      continue;
    }
    const words = stripBullet(m.line).split(/\s+/).length;
    // A credentials line, or a short line that is the credential, becomes the confirmed text.
    // A headline is never replaced whole: the credential moves out of it.
    if (!header.has(m.line) && (m.where === "credentials" || words <= 8)) {
      // Round 10 (SF-7): when another credentials line already shows it, this one is never rewritten into a second copy.
      if (opts.covered && stripBullet(m.line) !== stripBullet(opts.covered)) {
        if (m.where === "credentials") {
          next = cutLine(next, m.line);
          continue;
        }
      } else {
        next = placed ? cutLine(next, m.line) : changeLine(next, m.line, confirmed);
        placed = true;
        continue;
      }
    }
    const rest = removeFromSentence(stripBullet(current), m.raw || m.name);
    if (!rest || rest.split(/\s+/).length < 2) next = cutLine(next, m.line);
    else {
      next = changeLine(next, m.line, rest);
      remnants.push(linesOf(next).find((l) => stripBullet(l) === rest) ?? rest);
    }
  }
  // An education line is rewritten where it stands (or added under EDUCATION when only a sentence named it);
  // a credential goes under CERTIFICATIONS.
  if (!isLetter && !education && !opts.covered) next = ensureCertificationLine(next, confirmed);
  if (!isLetter && education && !placed) next = ensureSectionLine(next, confirmed, "EDUCATION", EDUCATION_HEADING_RE);
  return { text: next, remnants, droppedSentence, ...(educationLine && educationLine !== confirmed ? { educationLine } : {}) };
}

const EDUCATION_HEADING_RE = /^(?:education|schooling|academic background)\b.*$|^(?:training|certifications?)\s*(?:and|&)\s*education:?$/i;

/** Put a new line right under one line (found by its words). */
function insertLineAfter(text: string, after: string, line: string): string {
  const lines = text.split("\n");
  const at = lines.findIndex((l) => stripBullet(l) === stripBullet(after));
  if (at === -1) return text;
  lines.splice(at + 1, 0, line);
  return lines.join("\n");
}

/** Put a line under a heading, adding the section at the end when the page has none. */
function ensureSectionLine(text: string, line: string, heading: string, headingRe: RegExp): string {
  const lines = text.split("\n");
  if (lines.some((l) => squash(stripBullet(l)) === squash(line))) return text;
  const head = lines.findIndex((l) => headingRe.test(l.trim()));
  if (head === -1) return `${text.replace(/\s+$/, "")}\n\n${heading}\n${line}`;
  let at = head + 1;
  while (at < lines.length && lines[at].trim() && !/^[A-Z][A-Z &/]{3,}:?$/.test(lines[at].trim())) at++;
  lines.splice(at, 0, line);
  return lines.join("\n");
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
  when: string,
  /** Round 10 (SF-3): the person's own words, so a school they named themselves may ride on an education line. */
  opts: { personText?: string } = {}
): { resume: string; letter: string; confirm: CredentialConfirm } | null {
  if (!ALL_KINDS.includes(type) || !isConfirmWhen(type, when)) return null;
  const confirmed = confirmedCredentialText(name, type, when);
  const key = credentialKeyOf(name);
  // Nothing to confirm when neither page names this credential.
  const mentionsIn = (t: string) => credentialMentionsOf(t).filter((m) => (key ? sameCredential(m.key, key) : squash(m.name) === squash(name)));
  const named = (t: string) => mentionsIn(t).length > 0 || mentionsOfName(t, name).length > 0;
  if (!named(docs.resume) && !named(docs.letter)) return null;
  // Round 9: an education line is confirmed as earned or in progress, a credential as a license, a card...; never crossed.
  // Round 10 (SF-2): the mention of this kind is the one confirmed, whatever else shares its line.
  const all = [...mentionsIn(docs.resume), ...mentionsIn(docs.letter)];
  if (all.length && !all.some((m) => !!m.education === isEducationKind(type))) return null;
  if (type === "did not finish") return applyDidNotFinish(docs, name, when, opts.personText);
  const held = isLiveCredential(type, when) ? { name, kind: type, when } : undefined;
  // Round 10 (SF-7): a credentials line already showing it ("AWS D1.1 certification, 2019") is not written twice.
  const covered = isEducationKind(type) ? undefined : coveringCertificationLine(docs.resume, name, type, when);
  const r = applyToDocument(docs.resume, key, name, confirmed, false, { education: isEducationKind(type), held, personText: opts.personText, covered });
  const l = applyToDocument(docs.letter, key, name, confirmed, true, { held });
  // The line may already read exactly as confirmed: the confirmation still counts.
  if (r.text === docs.resume && l.text === docs.letter && !pageLineSet(docs.resume).has(squash(confirmed))) return null;
  return {
    resume: r.text,
    letter: l.text,
    confirm: {
      name,
      type,
      when: when.trim(),
      text: confirmed,
      key,
      remnants: [...r.remnants, ...l.remnants],
      letterSentenceDropped: l.droppedSentence,
      ...(r.educationLine ? { line: r.educationLine } : {}),
      ...(covered && !pageLineSet(r.text).has(squash(confirmed)) ? { coveredBy: stripBullet(covered) } : {}),
    },
  };
}

/**
 * Round 10 (SF-1): "I went there but didn't finish." The education line
 * becomes the school and the years the person typed ("Scott High School,
 * attended 2011 - 2014"), or comes off when there is no school to keep; every
 * other mention of the credential comes off both pages.
 */
function applyDidNotFinish(docs: { resume: string; letter: string }, name: string, when: string, personText?: string): { resume: string; letter: string; confirm: CredentialConfirm } | null {
  const key = credentialKeyOf(name);
  const edu = credentialMentionsOf(docs.resume).find((m) => m.education && m.where === "credentials" && (key ? sameCredential(m.key, key) : squash(m.name) === squash(name)));
  let resume = docs.resume;
  let line: string | undefined;
  if (edu) {
    const attended = educationAttendedLine(edu.line, edu.raw || edu.name, name, when, personText);
    resume = attended ? changeLine(resume, edu.line, attended) : cutLine(resume, edu.line);
    line = attended ? stripBullet(attended) : undefined;
  }
  const rest = cutCredentialEverywhere({ resume, letter: docs.letter }, name, { keepLines: new Set(line ? [line] : []) });
  if (rest.resume === docs.resume && rest.letter === docs.letter) return null;
  return {
    resume: rest.resume,
    letter: rest.letter,
    confirm: {
      name,
      type: "did not finish",
      when: when.trim(),
      text: confirmedCredentialText(name, "did not finish", when),
      key,
      remnants: rest.remnants,
      letterSentenceDropped: rest.changes.some((c) => c.target === "letter"),
      ...(line ? { line } : {}),
    },
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
  if (!ALL_KINDS.includes(type) || !isConfirmWhen(type, when)) return null;
  const confirmed = confirmedCredentialText(name, type, when);
  const key = credentialKeyOf(name);
  // A document with no CERTIFICATIONS heading and no resume header is read as a letter.
  const isLetter = /^\s*dear\b/im.test(text) && !CERT_HEADING_RE.test(text);
  const held = isLiveCredential(type, when) ? { name, kind: type, when } : undefined;
  if (type === "did not finish") return null;
  const r = applyToDocument(text, key, name, confirmed, isLetter, { education: isEducationKind(type), held });
  if (r.text === text) return null;
  void line;
  void isTerm;
  return {
    text: r.text,
    confirm: { name, type, when: when.trim(), text: confirmed, key, remnants: r.remnants, letterSentenceDropped: r.droppedSentence, ...(r.educationLine ? { line: r.educationLine } : {}) },
  };
}

/** "No, take it off", for callers with no place to keep a leftover: the term, the short line, or the whole line a credential sits inside. */
export function cutCredential(text: string, line: string, isTerm: boolean, name: string): string {
  // With nowhere to keep a leftover, a credential inside a longer sentence takes the whole line with it (round 6).
  const r = cutCredentialWithRemnant(text, line, isTerm, name);
  return r.remnant ? cutLine(text, line) : r.text;
}

// The words in a job title that claim a credential; "No, take it off" on a title takes off only these.
const TITLE_CLAIM_WORDS_RE = /\b(?:certified|licensed|registered|journeyman|master|bonded|accredited|credentialed)\b\s*/gi;

/**
 * "No, take it off", and what is left. In a job title only the credential
 * words come off ("CERTIFIED NURSING ASSISTANT" becomes "NURSING
 * ASSISTANT"). Inside a longer sentence the credential's words come out and
 * the rest is returned as `remnant`, so the gate holds it like a confirmed
 * move's leftover (round 6): a fragment, or words that are not the person's,
 * are settled only by their rewrite or a cut.
 */
const CLAIM_WORD_RE = /\b(?:certified|certification|certificate|licensed|license|licence|card|endorsement|permit|registry|registered|trained|authori[sz]ed|qualified|hold|holds|held)\b/i;

export function cutCredentialWithRemnant(text: string, line: string, isTerm: boolean, name: string): { text: string; remnant?: string } {
  if (isTerm) return { text: cutTerm(text, line) };
  const at = linesOf(text).find((l) => l === line);
  if (!at) return { text };
  if (line.includes("|") && /\b(?:19|20)\d{2}\b|\bpresent\b/i.test(line)) {
    const title = titleOfHeader(line);
    // Round 8: the claim words and the credential's own name come off the title ("CDL-A DRIVER" is "DRIVER").
    // The credential inside the title, by its own name ("CDL-A" in "CDL-A DRIVER"), never the whole title.
    const flat = title.replace(/(?<=[A-Za-z])-(?=[A-Za-z])/g, " ");
    const inside = [...Array.from(flat.matchAll(namedCredentialRe())), ...Array.from(flat.matchAll(credentialInitialsRe()))].map((x) => x[0]);
    void name;
    const bare = inside
      .reduce((t, n) => t.replace(wordsPattern(n), " "), title.replace(TITLE_CLAIM_WORDS_RE, ""))
      .replace(/\s{2,}/g, " ")
      .replace(/^[\s,/-]+|[\s,/-]+$/g, "")
      .trim();
    if (bare === title) return { text };
    // A title that was only the credential ("CNA") asks for their own title: a placeholder the gate holds until they change it.
    return { text: changeLine(text, line, line.replace(title, bare || "[Your job title]")) };
  }
  const m = credentialMentionsOf(text).find((x) => x.line === line && (squash(x.name) === squash(name) || squash(x.raw) === squash(name)));
  // Round 8: a duty line that only mentions the credential ("Followed ServSafe rules") keeps its line;
  // only the credential's word comes off. A line that claims it ("Forklift certified") goes.
  const claims = !!m && (m.where === "credentials" || CLAIM_WORD_RE.test(m.raw) || CLAIM_WORD_RE.test(stripBullet(at)));
  if (claims && stripBullet(line).split(/\s+/).length <= 8) return { text: cutLine(text, line) };
  const rest = removeFromSentence(stripBullet(at), m?.raw || name);
  if (rest === stripBullet(at)) return { text };
  if (!rest || rest.split(/\s+/).length < 2) return { text: cutLine(text, line) };
  const next = changeLine(text, line, rest);
  return { text: next, remnant: linesOf(next).find((l) => stripBullet(l) === rest) ?? rest };
}

/**
 * "No, take it off", everywhere (round 7): every mention of that credential
 * on the resume and in the letter comes off, so the same credential is never
 * asked again on the next line. A list item goes alone, never its whole
 * line; a short line goes; inside a longer resume sentence the rest is kept
 * as a leftover the gate holds; in the letter the whole sentence goes, and
 * what stays of its paragraph is read again.
 */
export function cutCredentialEverywhere(
  docs: { resume: string; letter: string },
  name: string,
  /** Lines never touched (round 10: a confirmed "attended" line, another confirmed line with the same key). */
  opts: { keepLines?: Set<string> } = {}
): { resume: string; letter: string; remnants: string[]; changes: Array<{ target: "resume" | "letter"; before: string; after: string | null }> } {
  const key = credentialKeyOf(name);
  const remnants: string[] = [];
  const changes: Array<{ target: "resume" | "letter"; before: string; after: string | null }> = [];
  // Only the mentions the finder itself reports: never someone else's ("the CDL drivers").
  const keep = new Set(Array.from(opts.keepLines ?? []).map((l) => squash(stripBullet(l))));
  const mentionsIn = (t: string) => {
    const found = credentialMentionsOf(t).filter((m) => (key ? sameCredential(m.key, key) : squash(m.name) === squash(name)));
    return [...found, ...mentionsOfName(t, name).filter((b) => !found.some((f) => f.line === b.line))].filter((m) => !keep.has(squash(stripBullet(m.line))));
  };
  const record = (target: "resume" | "letter", beforeText: string, afterText: string) => {
    const was = linesOf(beforeText);
    const now = linesOf(afterText);
    const gone = was.filter((l) => !now.includes(l));
    const added = now.filter((l) => !was.includes(l));
    gone.forEach((g, i) => changes.push({ target, before: g, after: added[i] ?? null }));
  };
  let resume = docs.resume;
  for (let guard = 0; guard < 20; guard++) {
    const m = mentionsIn(resume)[0];
    if (!m) break;
    // Round 10 (SF-1): "No" on an education line takes the line off whole (never "[Your job title]"), unless a
    // credential on the same line is asked on its own: then only the schooling part comes off.
    if ((m.education && m.where === "credentials") || m.onEducationLine) {
      const others = credentialMentionsOf(resume).filter((x) => x.line === m.line && x.key !== m.key && (x.education || x.onEducationLine));
      const rest = others.length ? withoutEducationPart(m.line, m.raw || m.name) : "";
      const next = rest && rest !== m.line ? changeLine(resume, m.line, rest) : cutLine(resume, m.line);
      if (next === resume) break;
      record("resume", resume, next);
      resume = next;
      continue;
    }
    const r = cutCredentialWithRemnant(resume, m.line, m.term, m.raw || name);
    if (r.text === resume) break;
    record("resume", resume, r.text);
    resume = r.text;
    if (r.remnant) remnants.push(r.remnant);
  }
  let letter = joinWrappedLines(docs.letter);
  for (let guard = 0; guard < 20; guard++) {
    const m = mentionsIn(letter).find((x) => !x.term);
    if (!m) break;
    const current = linesOf(letter).find((l) => l === m.line);
    if (!current) break;
    // Drop only the sentences where the finder itself reads the credential.
    const sentenceHasIt = (sent: string) =>
      credentialMentionsOf(`x\n${sent}`).some((x) => (key ? sameCredential(x.key, key) : squash(x.name) === squash(name))) || mentionsOfName(`x\n${sent}`, name).length > 0;
    // A sentence that claims it goes whole; a duty sentence ("I followed ServSafe rules") keeps itself without the credential's word.
    const kept = splitSentences(current)
      .map((sent) => (!sentenceHasIt(sent) ? sent : CLAIM_WORD_RE.test(sent) ? "" : removeFromSentence(sent, m.raw || m.name)))
      .filter((sent) => sent.trim());
    const rest = kept.join(" ").trim();
    const next = rest ? changeLine(letter, m.line, rest) : cutLine(letter, m.line);
    if (next === letter) break;
    record("letter", letter, next);
    letter = next;
    if (rest && splitSentences(rest).some((sent) => readsAsFragment(sent) || (STATUS_ANY_RE.test(sent) && !credentialMentionsOf(`x\n${sent}`).length))) {
      remnants.push(linesOf(letter).find((l) => l === rest) ?? rest);
    }
  }
  return { resume, letter, remnants, changes };
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
  /** On a memory prompt for an education line: confirmed as earned or in progress. */
  education?: boolean;
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
  i.from !== "second_check" && i.kind !== "credential_remnant" && i.kind !== "scope_unsaid" && i.rule === "STD-C04";

// Words that start a fragment, not a sentence: a joining word or a relative pronoun.
const FRAGMENT_START_RE = /^(?:and|or|but|so|nor|yet|plus|who|whom|whose|which|that|where|while|as|with|because|since|although|though|than)\b/i;
const IRREGULAR_VERB_RE =
  /\b(?:ran|run|runs|led|lead|leads|made|make|makes|kept|keep|keeps|built|build|builds|drove|drive|drives|took|take|takes|did|do|does|got|get|gets|went|go|goes|set|sets|held|hold|holds|fed|feed|met|meet|sold|sell|taught|teach|put|cut|cuts|brought|bring|bought|buy|caught|dug|fixed|fix|fixes|ate|wrote|write|writes|read|reads|spoke|speak|swept|sweep|stood|stand|told|tell|found|find|gave|give|gives|left|lift|lifts|load|loads|cook|cooks|clean|cleans|open|opens|close|closes|serve|serves|stock|stocks|pack|packs|help|helps|work|works|is|was|are|were|am|has|have|had|would|could|will|can|should|may|might|be|been|want|wants|say|says|said|love|like|know|knew|see|saw|show|showed|start|started|bring|brings)\b/i;

/**
 * True when a leftover must be reworded or cut: a sentence of it reads as a
 * fragment or keeps a status word with no credential, or it is not the
 * person's own words.
 */
function remnantNeedsCard(line: string, source: string): boolean {
  const body = stripBullet(line);
  if (splitSentences(body).some((sent) => readsAsFragment(sent) || (STATUS_ANY_RE.test(sent) && !credentialMentionsOf(`x\n${sent}`).length))) return true;
  return distanceFromSource(body, source) > 0;
}

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
  [/\bservsafe\s+food\s+protection\s+manager\b/gi, "servsafe manager"],
  [/\b(?:certified\s+)?forklift\s+operator\b/gi, "forklift"],
];
function sameNameWords(name: string): string {
  const t = SAME_NAME.reduce((acc, [re, to]) => acc.replace(re, to), name).toLowerCase();
  // One family, one key (round 7): every OSHA card of one number, every CDL of one class, every CPR card.
  // Round 8: a word that makes it a different credential stays in the key (OSHA 10 is not OSHA 10 Trainer).
  const role = (t.match(/\b(?:trainer|instructor|inspector|outreach|endorsement|hazmat|tanker|doubles|passenger|school\s+bus|master|journeyman|manager)\b/g) ?? []).sort().join(" ");
  const osha = t.match(/\bosha\s*-?\s*(\d+)/);
  if (osha) return `osha ${osha[1]} ${role}`.trim();
  if (/\bcdl\b/.test(t)) {
    const cls = t.match(/\bclass[\s-]*([a-d])\b|\bcdl[\s-]*\(?([a-d])\)?(?![\w'])/);
    return `cdl ${cls ? `class_${cls[1] ?? cls[2]}` : ""} ${role}`.replace(/\s+/g, " ").trim();
  }
  if (/\bcpr\b/.test(t)) return `cpr ${role}`.trim();
  return t;
}

/** New (round 5): two confirmations that may be one credential, told two ways. */
export function confirmedConflictQuestion(a: string, b: string): string {
  return `You told us "${a}" and "${b}". If they are the same one, cut the one that is wrong.`;
}
/** New (round 6): a line "No, take it off" changed. Only the person's own rewrite or a cut clears it. */
export const Q_REMNANT_CUT = "This line changed when the credential came off. Read it again: reword it in your own words, or cut it.";
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
    for (const sentence of splitSentences(line)) {
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
  personText: { text: string; rows?: ReadonlyArray<CredentialRow>; backstop: string },
  askedOnResume: Set<string>
): GateItem[] {
  const items: GateItem[] = [];
  const against = `${source}\n${resumeText}`;
  for (const { line, sentence } of letterSentences(letter)) {
    // A scope claim the person never made: only their own rewrite or a cut settles it.
    const hit = scopeNotTheirs(sentence, source);
    // A scope word the person typed into the line themselves (their rewrite) is their claim.
    const rw = answers.find((a) => a.kind === "rewrite" && typeof a.replaced === "string" && squash(a.line) === squash(line));
    const theirWord = !!hit && !!rw && !new RegExp(`\\b${(hit.word.match(/[A-Za-z]+/) ?? [""])[0]}\\b`, "i").test(rw.replaced as string);
    if (hit && !theirWord && !items.some((i) => i.line === line && i.kind === "scope_unsaid")) {
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
  for (const m of credentialsToAsk(letter, personText.text, askedOnResume, personText.rows, personText.backstop)) {
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
  /** What the person typed in the Forge's licenses-and-training answer (with their own words: the whole-line exception). */
  credentialsAnswer?: string;
  /** What "No, take it off" left of longer sentences (held like a confirmed move's leftover). */
  credentialCutRemnants?: string[];
  /** The person's structured credentials from the Forge's training step (round 7): the one typed exception. */
  credentialRows?: ReadonlyArray<CredentialRow>;
  /** The person's own uploaded resume (record lines held back as they chose). Whole lines of it may cover a credential. */
  ownResumeText?: string;
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
    .filter((c) => ALL_KINDS.includes(c.type) && isConfirmWhen(c.type, c.when))
    .map((c) => {
      const text = confirmedCredentialText(c.name, c.type, c.when);
      // Round 9: an education line that kept its school counts only while it is the confirmed text plus parts with no year or status.
      // Round 10: only school names the person used ride on it (SF-3); "did not finish" keeps the school and their years only (SF-1).
      const line =
        typeof c.line === "string" &&
        (c.type === "did not finish" ? isConfirmedAttendedLine(c.line, c.name, c.when, source) : isEducationKind(c.type) && isConfirmedEducationLine(c.line, text, source))
          ? c.line
          : undefined;
      // Round 10 (SF-7): a credentials line already on the page that shows exactly this confirmation.
      const coveredBy =
        typeof c.coveredBy === "string" && !isEducationKind(c.type) && coveringCertificationLine(input.resumeText, c.name, c.type, c.when) !== undefined &&
        squash(stripBullet(coveringCertificationLine(input.resumeText, c.name, c.type, c.when) as string)) === squash(c.coveredBy)
          ? c.coveredBy
          : undefined;
      return { ...c, text, line, coveredBy, key: c.key ?? credentialKeyOf(c.name) };
    });
  // One credential, one confirmation: the last one for a key is the one that counts.
  const lastByKey = new Map<string, (typeof validConfirms)[number]>();
  for (const c of validConfirms) lastByKey.set(c.key ?? squash(c.name), c);
  const pageSet = pageLineSet(input.resumeText);
  const confirms = Array.from(lastByKey.values()).filter(
    (c) => pageSet.has(squash(c.text)) || (!!c.line && pageSet.has(squash(c.line))) || (!!c.coveredBy && pageSet.has(squash(c.coveredBy)))
  );
  // "Did not finish" settles its own line; it never makes the credential theirs.
  const heldConfirms = confirms.filter((c) => c.type !== "did not finish");
  const confirmedLines = new Set(confirms.flatMap((c) => [squash(c.text), ...(c.line && pageSet.has(squash(c.line)) ? [squash(c.line)] : [])]));
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
    confirmedKeys: heldConfirms.map((c) => c.key).filter((k): k is string => !!k),
    credentialRows: input.credentialRows,
    ownResumeText: input.ownResumeText,
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
    // The same exception the resume uses: their uploaded resume (never the free-text licenses answer) and their rows.
    const typedLines = new Set((input.credentialsAnswer ?? "").split("\n").map((l) => l.trim()).filter(Boolean));
    const personText = input.ownResumeText ?? source.split("\n").filter((l) => !typedLines.has(l.trim())).join("\n");
    const backstopText = `${source}\n\n${input.credentialsAnswer ?? ""}`;
    const confirmedSet = new Set(heldConfirms.map((c) => c.key).filter((k): k is string => !!k));
    const askedOnResume = new Set([...credentialsToAsk(resumeForChecks, personText, confirmedSet, input.credentialRows, backstopText).map((m) => m.key), ...confirmedSet]);
    items.push(...letterItems(letter, input.resumeText, source, answers, { text: personText, rows: input.credentialRows, backstop: backstopText }, askedOnResume));
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
  const keyed = heldConfirms.filter((c) => c.key);
  const mismatchLines = new Set<string>();
  for (const [doc, target] of [[resumeForChecks, "resume"], [letter, "letter"]] as const) {
    for (const m of credentialMentionsOf(doc)) {
      if (m.title) continue; // a title keeps its words; the title check reads it
      const c = keyed.find((x) => sameCredential(x.key as string, m.key));
      if (!c) continue;
      // Round 9 (r9-S2): a credential they hold now may stay in a sentence that names it plainly.
      if (liveCredentialCovers(m, { name: c.name, kind: c.type, when: c.when })) continue;
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
  // Two confirmations that are one credential spelled two ways ("OSHA 10"
  // and "10-hour OSHA", "CNA" and "Certified Nursing Assistant") must not
  // tell two stories. Round 6: only when the two names normalise to the same
  // key and the kind or the year or status differ; two different credentials
  // ("Welding" and "Welding Inspector") stand side by side.
  const sameKeyOf = (c: (typeof heldConfirms)[number]) =>
    (credentialKeyOf(sameNameWords(c.name)) ?? "")
      .split(/\s+/)
      .map((w) => w.replace(/'s$|s$/, ""))
      .filter((w) => w.length > 0 && w !== "s")
      .sort()
      .join(" ");
  for (let a = 0; a < heldConfirms.length; a++) {
    for (let b = a + 1; b < heldConfirms.length; b++) {
      const [x, y] = [heldConfirms[a], heldConfirms[b]];
      if (x.type === y.type && x.when.trim().toLowerCase() === y.when.trim().toLowerCase()) continue;
      if (!sameKeyOf(x) || sameKeyOf(x) !== sameKeyOf(y)) continue;
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
        if (!remnantNeedsCard(line, source)) continue;
        items.push({ rule: "STD-C04", severity: "BLOCK", line, target, kind: "credential_remnant", why: "This line changed when the credential moved.", question: Q_REMNANT });
      }
    }
    if (c.letterSentenceDropped && letter.trim()) {
      items.push({ rule: "STD-C04", severity: "FIX", line: "", target: "letter", kind: "credential_letter_note", why: `We took out a sentence about ${c.name} from your cover letter.`, question: letterNote(c.name) });
    }
  }
  // The same for what "No, take it off" left of a longer sentence (round 6).
  for (const rem of input.credentialCutRemnants ?? []) {
    for (const [doc, target] of [[input.resumeText, "resume"], [letter, "letter"]] as const) {
      const line = linesOf(doc).find((l) => squash(stripBullet(l)) === squash(stripBullet(rem)));
      if (!line || !remnantNeedsCard(line, source)) continue;
      if (items.some((i) => i.kind === "credential_remnant" && i.line === line && i.target === target)) continue;
      items.push({ rule: "STD-C04", severity: "BLOCK", line, target, kind: "credential_remnant", why: "This line changed when the credential came off.", question: Q_REMNANT_CUT });
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

  // A skills term asked as a credential is not also on the keep-or-cut skills card.
  const askedTerms = new Set(items.filter((i) => i.kind === "credential_unsaid" && i.target === "skill").map((i) => i.line.trim().toLowerCase()));
  for (let k = items.length - 1; k >= 0; k--) if (items[k].kind === "grid_term" && askedTerms.has(items[k].line.trim().toLowerCase())) items.splice(k, 1);

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
    // Round 10 (SF-2): each credential on a line is its own card; the line's other items ride with its first one.
    let k = item.target === "skillset" ? "skillset" : `${item.target}\u0000${item.line}`;
    if (item.kind === "credential_unsaid" && item.subject) {
      const first = lined.find((x) => x.kind === "credential_unsaid" && x.target === item.target && x.line === item.line);
      if (first && first !== item && first.subject !== item.subject) k = `${k}\u0000${item.subject}`;
    }
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
      ...(unsaid ? { credentialName: unsaidName(unsaid), ...(unsaid.education ? { education: true } : {}) } : {}),
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
