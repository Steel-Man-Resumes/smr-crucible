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
import { stemOf, acronymsOf } from "./wordStem";
import { scopeNotTheirs, answerTalksScope } from "./scopeWords";
import { answerGivesStatusFor } from "./credentialStatus";
import { normalizeDigits, numberTokens } from "./numberRead";
import {
  answerGivesCredentialType,
  checkCredentials,
  credentialAlreadyKnown,
  credentialHomes,
  credentialMentionsOf,
  saidAbout,
  type CredentialMention,
} from "./credentialMentions";
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
  /** For a credential finding: the credential's full name as found on the page (never clipped). */
  subject?: string;
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
  /**
   * True when the page has explainable lines and every one of them is in the
   * person's own words, so no line was picked just to fill the minimum.
   */
  allLinesInOwnWords: boolean;
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

// Words that fill a sentence without saying anything about the line.
const FILLER = new Set([
  "job", "jobs", "work", "worked", "working", "day", "days", "every", "time", "times", "part", "duties", "duty",
  "place", "old", "back", "stuff", "thing", "things", "many", "year", "years", "happened", "last", "week",
  "weeks", "regular", "always", "lot", "lots", "one", "over", "here", "there", "then", "now", "much", "some",
  "did", "able", "make", "made", "sure", "know", "knew", "think", "say", "said", "tell", "told",
]);
const TIME_RE = /\b(?:morning|mornings|night|nights|evening|afternoon|overnight|shift|shifts|weekend|weekends|weekday|weekdays|monday|tuesday|wednesday|thursday|friday|saturday|sunday|january|february|march|april|may|june|july|august|september|october|november|december|summer|winter|spring|fall|season|holiday|holidays|hour|hours|minute|minutes|month|months|daily|weekly|monthly)\b/i;
// A place or a tool named after a preposition ("at the diner", "with a scanner", "using the POS").
const PLACE_TOOL_RE = /\b(?:at|in|on|from|with|using|through|inside|behind)\s+(?:the|a|an|my|our|their|his|her)\s+[a-z]{3,}/i;

/** True when an answer names something concrete: a number, a proper name, a time, or a place or tool. */
function hasConcreteDetail(answer: string): boolean {
  if (/\d/.test(answer) || TIME_RE.test(answer) || PLACE_TOOL_RE.test(answer)) return true;
  // A capitalized word that does not start a sentence: a place, a company, a tool name.
  return /(?<![.!?]\s|^)\b[A-Z][a-z]{2,}/.test(answer.trim().replace(/^\s*I\b/, "i"));
}

/**
 * True when a typed answer explains something:
 * - at least three content words that are not filler ("job", "work", "every day"),
 * - not a bare yes,
 * - at least one content word that is not already in the line (an answer that
 *   only pastes the line back says nothing new),
 * - and it says something about the line: one of its words shares a stem with
 *   the line's own words, or it names a concrete detail (a place, a tool, a time).
 * "That was part of my job duties." is a yes in a longer form, and does not count.
 */
export function answerExplains(answer: string, line: string): boolean {
  const text = (answer || "").trim();
  if (!/[a-z0-9]/i.test(text) || NO_ANSWER_RE.test(text)) return false;
  const bare = text.toLowerCase().replace(/[^a-z' ]+/g, " ").replace(/\s+/g, " ").trim();
  if (BARE_YES_RE.test(bare)) return false;
  const words = contentWords(text).filter((w) => !FILLER.has(w));
  if (words.length < 3) return false;
  const lineStems = new Set(contentWords(stripBullet(line)).filter((w) => !FILLER.has(w)).map(stemOf));
  if (!words.some((w) => !lineStems.has(stemOf(w)))) return false;
  return words.some((w) => lineStems.has(stemOf(w))) || hasConcreteDetail(text);
}

/**
 * True when an answer talks about this text: one of its words (not filler)
 * shares a stem with one of the text's words. Used where a concrete detail
 * alone is not enough, because the question is about these exact words: a
 * headline, a job title, a scope word.
 */
export function answerMentions(answer: string, text: string): boolean {
  const want = new Set(contentWords(text).filter((w) => !FILLER.has(w)).map(stemOf));
  return contentWords(answer).filter((w) => !FILLER.has(w)).some((w) => want.has(stemOf(w)));
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
 * What a rewrite introduced: content words whose stem is not in the line it
 * replaced and not anywhere in the writer's own documents (`writerText`),
 * and numbers whose VALUE is in neither. A number or a word the writer put
 * anywhere on the page or in the letter is never the person's, whichever line
 * they type it into, even after the writer's line is cut. Punctuation, a
 * status word already there, or the written number typed back introduce
 * nothing. Returned in the order typed, one string.
 */
export function introducedWords(rewrite: string, replaced: string, writerText = ""): string {
  const old = `${replaced}\n${writerText}`;
  const oldStems = new Set((old.toLowerCase().match(/[a-z]+/g) ?? []).map(stemOf));
  const oldNums = numbersIn(old);
  const out: string[] = [];
  const numberSpans = numberTokens(rewrite);
  const inNumber = (i: number) => numberSpans.some((t) => i >= t.index && i < t.index + t.length);
  for (const t of numberSpans) if (!oldNums.has(t.value)) out.push({ i: t.index, s: normalizeDigits(rewrite).slice(t.index, t.index + t.length) } as never);
  const words: Array<{ i: number; s: string }> = out as never;
  for (const m of rewrite.matchAll(/[A-Za-z][A-Za-z'’]*/g)) {
    if (inNumber(m.index!)) continue;
    if (!oldStems.has(stemOf(m[0]))) words.push({ i: m.index!, s: m[0] });
  }
  return words.sort((a, b) => a.i - b.i).map((w) => w.s).join(" ");
}

/** The credential's own name for a credential finding (quoted in its why), else the line's. */
function credentialNameOf(f: Pick<MintFinding, "line" | "why">): string {
  return quoted(f.why) ?? credentialName(f.line);
}

function credentialName(line: string): string {
  return clip(stripBullet(line).split(/[,(|]/)[0].trim() || stripBullet(line), 50);
}

/**
 * Share of a line's content words the person never used (0 = all theirs,
 * 1 = none theirs). Words are compared by stem ("loaded" and "loading",
 * "carried" and "carry" are one word), and short all-caps words (RN, GM,
 * LPN) count, because they carry a claim.
 */
export function distanceFromSource(line: string, sourceText: string): number {
  const src = new Set((sourceText.toLowerCase().match(/[a-z]+/g) ?? []).map(stemOf));
  const body = stripBullet(line);
  const words = [
    ...(body.toLowerCase().match(/[a-z]+/g) ?? []).filter((w) => w.length > 3 && !DISTANCE_STOP.has(w)),
    ...acronymsOf(body).filter((a) => a.length <= 3).map((a) => a.toLowerCase()),
  ];
  if (!words.length) return 0;
  return words.filter((w) => !src.has(stemOf(w))).length / words.length;
}

const EXPERIENCE_HEADING_RE = /^(?:(?:professional |work |relevant )?experience|employment(?: history)?|work history)$/i;

/** The title part of an entry header ("LINE COOK | Diner | 2019 - 2023" gives "LINE COOK"). */
function titleOf(header: string): string {
  return header.split(/\s*\|\s*|\s+(?:at|@)\s+/i)[0].trim();
}

/**
 * The job titles on the page's own entry headers under an experience heading.
 * The name line is never a heading (an all-caps name looks like one), so a
 * pipe headline under it is never mistaken for a job header.
 */
function pageJobTitles(resumeText: string): Set<string> {
  const titles = new Set<string>();
  let inExperience = false;
  linesOf(resumeText).forEach((l, i) => {
    if (i === 0) return;
    if (isSectionEnd(l)) { inExperience = EXPERIENCE_HEADING_RE.test(l.replace(/:$/, "")); return; }
    if (!inExperience || !isEntryHeader(l)) return;
    const t = titleOf(l);
    if (t) titles.add(squash(t));
  });
  return titles;
}

/** True when every word of a title is in the person's words, in any order ("cook, line" is "Line Cook"). */
export function titleInOwnWords(title: string, sourceText: string): boolean {
  const src = new Set((sourceText.toLowerCase().match(/[a-z]+/g) ?? []).map(stemOf));
  const words = [
    ...(title.toLowerCase().match(/[a-z]+/g) ?? []).filter((w) => w.length >= 3 && !DISTANCE_STOP.has(w) && !/^(?:and|the|for|of)$/.test(w)),
    ...acronymsOf(title).filter((a) => a.length <= 2).map((a) => a.toLowerCase()),
  ];
  return words.every((w) => src.has(stemOf(w)));
}

/** The experience entry headers whose title is not in the person's words. */
function titlesNotTheirs(resumeText: string, sourceText: string): string[] {
  const out: string[] = [];
  let inExperience = false;
  for (const l of linesOf(resumeText)) {
    if (isSectionEnd(l)) { inExperience = EXPERIENCE_HEADING_RE.test(l.replace(/:$/, "")); continue; }
    if (!inExperience || !isEntryHeader(l)) continue;
    const t = titleOf(l);
    if (t && !titleInOwnWords(t, sourceText)) out.push(l);
  }
  return out;
}

/** The lines above the first section heading (after the name): the header block. */
function headerLinesOf(resumeText: string): Set<string> {
  const out = new Set<string>();
  const ls = linesOf(resumeText);
  for (let i = 1; i < ls.length; i++) {
    if (isSectionEnd(ls[i])) break;
    out.add(ls[i]);
  }
  return out;
}

/** A headline part claims nothing new when it names a job title on the page or uses only the person's words. */
function headlinePartIsTheirs(part: string, titles: Set<string>, sourceText: string): boolean {
  if (/\d/.test(part)) return false;
  if (titles.has(squash(part))) return true;
  return sourceText.trim() !== "" && distanceFromSource(part, sourceText) === 0 && numbersIn(part).size === 0;
}

/**
 * Lines a person could be asked to explain: not the name, contact, headings,
 * job headers or date lines. Everything above the first section heading is
 * the header block, so a line with pipes there is a headline, never a job
 * header. A headline is skipped only when it claims nothing new: no
 * credential in it, and every pipe part names a job title on the page or uses
 * only the person's own words.
 */
function bodyLines(resumeText: string, sourceText = ""): Array<{ line: string; inSkills: boolean }> {
  const ls = linesOf(resumeText);
  const out: Array<{ line: string; inSkills: boolean }> = [];
  const credLines = new Set(credentialMentionsOf(resumeText).filter((m) => !m.term).map((m) => m.line));
  const titles = pageJobTitles(resumeText);
  let inSkills = false;
  let seenHeading = false;
  ls.forEach((l, i) => {
    if (i === 0) return; // the name (never a heading, even in capitals)
    if (SKILLS_HEADING_RE.test(l.replace(/:$/, ""))) { inSkills = true; seenHeading = true; return; }
    if (isSectionEnd(l)) { inSkills = false; seenHeading = true; return; }
    if (CONTACT_LINE_RE.test(l) || isDateLine(l)) return;
    if (seenHeading && isEntryHeader(l)) return;
    if (!seenHeading) {
      // The header block's place line ("Dayton, OH") is contact, not a claim.
      if (PLACE_LINE_RE.test(l) || /\bhttps?:|www\.|linkedin\.com/i.test(l)) return;
      const parts = l.split(/\s*\|\s*/).filter(Boolean);
      const short = parts.every((p) => p.split(/\s+/).length <= 6) && !/[.;]$/.test(l);
      if (short && !credLines.has(l) && parts.every((p) => headlinePartIsTheirs(p, titles, sourceText))) return;
    }
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
      return f.kind === "dropped_number" ? Q_NUMBER_DROPPED : Q_NUMBER_UNSOURCED;
    case "STD-T05":
      return "This year isn't in what you told us. What years did you do this, as best you know?";
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
      if (f.kind === "grid_scope_term") return `"${clip(f.line, 40)}" says you ran or led something. Say what you did, in one sentence.`;
      return `Can you tell me one time you did "${clip(f.line, 40)}" at work? If not, it comes off.`;
    case "STD-T03":
      return credentialQuestion(credentialName(f.line));
    case "STD-C03":
      return Q_TITLE;
    default:
      return DESCRIBE;
  }
}

// ---- question voice (decision D6) ----------------------------------------
// Numbers, credentials and titles are asked the way an interviewer would ask
// them. Everything else is plain and short.

/** A number on the page the person never gave. */
export const Q_NUMBER_UNSOURCED =
  "If an interviewer asked where this number came from, could you say? It isn't one you gave us. Change it to a number you know. If you don't know a number, the line stays true without one.";
/** A number the person gave that did not make it onto the page. */
export const Q_NUMBER_DROPPED =
  "You gave us this number and it isn't on the page. An interviewer remembers a real number. Put it back the way you said it?";
/** One of the person's own numbers, asked once. */
export const Q_NUMBER_OWN = "If an interviewer asked how you know this number, what would you say? Tell me in one sentence.";
/** A job title the person never used. */
export const Q_TITLE =
  "If an interviewer called to check this job, would they find this title on your paperwork? Tell me the title your paperwork shows.";

/** A credential's type and status. */
export function credentialQuestion(name: string): string {
  return `If an interviewer asked about "${clip(name, 50)}", what would you say it is: a license, a certification, or a training course? Is it current, expired, or still in progress?`;
}

/**
 * A credential on the page the person never mentioned (decision D4): a
 * memory prompt, not a claim. It stays only when they say yes and type its
 * type and its year or status themselves.
 */
export function credentialMemoryPrompt(name: string): string {
  return `Do you hold ${clip(name, 50)}? Many people forget a card or class they earned.`;
}

const DESCRIBE_UNSOURCED = Q_NUMBER_UNSOURCED;

function questionForDefend(line: string, reasons: DefendReason[], sourceText: string, credName?: string): string {
  if (reasons.includes("credential")) {
    return credentialQuestion(credName || credentialName(line));
  }
  if (reasons.includes("number")) {
    // Never ask a person to defend a number they did not give: that plants it.
    const src = numbersIn(sourceText);
    const unsourced = Array.from(numbersIn(line)).some((n) => !src.has(n));
    if (unsourced) return DESCRIBE_UNSOURCED;
    return Q_NUMBER_OWN;
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
  return pickDefend(resumeText, sourceText, opts).lines;
}

function pickDefend(
  resumeText: string,
  sourceText: string,
  opts: { minFurthest?: number } = {}
): { lines: DefendLine[]; allOwn: boolean; header: Set<string> } {
  const minFurthest = opts.minFurthest ?? 2;
  const body = bodyLines(resumeText || "", sourceText || "");
  const mentions = credentialMentionsOf(resumeText || "");
  // A short credential line is asked about as a credential; a longer sentence
  // that also carries one is still read like any other line.
  const credLines = new Set([
    ...mentions
      .filter((m) => !m.term && (m.where === "credentials" || m.line.replace(/^[-•*]\s*/, "").split(/\s+/).length <= 8))
      .map((m) => m.line),
    // A credentials line that lists several credentials is read part by part, never as a line far from their words.
    ...mentions.filter((m) => m.term && m.where === "credentials").map((m) => m.context),
  ]);
  // Each credential is asked about once, by its own name, at its home line
  // (or its skills term). Not at all when the person's words already give its
  // type and a year or status.
  const credHome = new Map<string, CredentialMention>();
  for (const m of credentialHomes(mentions)) {
    if (credentialAlreadyKnown(m, sourceText || "")) continue;
    // Never mentioned: its BLOCK asks for a change or a cut; a type question would be noise.
    if (!saidAbout(m, sourceText || "").length) continue;
    if (!credHome.has(m.line)) credHome.set(m.line, m);
  }
  const picked = new Map<string, Set<DefendReason>>();
  const add = (l: string, r: DefendReason) => {
    if (!picked.has(l)) picked.set(l, new Set());
    picked.get(l)!.add(r);
  };

  for (const m of credHome.values()) add(m.line, "credential");
  for (const { line, inSkills } of body) {
    if (!inSkills && !credLines.has(line) && numbersIn(line).size > 0) add(line, "number");
  }

  // The minimum fills only with lines that differ from the person's words;
  // a line in their own words is never asked just to make up the count.
  const candidates = body
    .filter(({ line, inSkills }) => !inSkills && !credLines.has(line))
    .map(({ line }, i) => ({ line, i, d: distanceFromSource(line, sourceText || "") }));
  const rest = candidates
    .filter((c) => !picked.has(c.line) && c.d > 0)
    .sort((a, b) => b.d - a.d || a.i - b.i)
    .slice(0, minFurthest);
  for (const r of rest) add(r.line, "far_from_your_words");

  const order = [...mentions.map((m) => m.line), ...body.map((b) => b.line)];
  const pageOrder = linesOf(resumeText || "");
  const posOf = (l: string) => {
    const i = pageOrder.indexOf(l);
    return i >= 0 ? i : pageOrder.findIndex((x) => x.includes(l));
  };
  const lines = Array.from(picked.entries())
    .sort((a, b) => posOf(a[0]) - posOf(b[0]) || order.indexOf(a[0]) - order.indexOf(b[0]))
    .map(([line, reasons]) => {
      const rs = Array.from(reasons);
      return { line, reasons: rs, question: questionForDefend(line, rs, sourceText || "", credHome.get(line)?.name) };
    });
  return { lines, allOwn: candidates.length > 0 && candidates.every((c) => c.d === 0), header: headerLinesOf(resumeText || "") };
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

  const picks = resumeText.trim() ? pickDefend(resumeText, sourceText) : { lines: [] as DefendLine[], allOwn: false, header: new Set<string>() };
  const defendLines = picks.lines;
  const credentialLine = new Set(defendLines.filter((d) => d.reasons.includes("credential")).map((d) => squash(d.line)));
  // Each answer belongs to its own line only; answers are never pooled into
  // the source. The page is always checked against the person's own words.
  const byLine = new Map(answers.map((a) => [squash(a.line), a]));
  const standingFor = (line: string) => {
    const a = byLine.get(squash(line));
    if (!answerStands(a, line, sourceText)) return undefined;
    // A credential question is answered only by saying what kind it is.
    if (credentialLine.has(squash(line)) && a!.kind !== "rewrite" && !answerGivesCredentialType(a!.answer)) return undefined;
    // A headline is answered only by talking about what it says.
    if (picks.header.has(line) && a!.kind !== "rewrite" && !answerMentions(a!.answer, line)) return undefined;
    // A scope word the person never used ("supervised", "managed", "led") is
    // answered only by an answer about that scope.
    const scope = scopeNotTheirs(line, sourceText);
    if (scope && a!.kind !== "rewrite" && !answerTalksScope(a!.answer)) return undefined;
    return a;
  };

  if (resumeText.trim() && sourceText.trim()) {
    const mint = runMintCheck({ output: resumeText, source: sourceText, kind: "resume" });
    // A credential's missing status is settled only by that line's own
    // standing answer. A course written up as a certification is never
    // settled by an answer: the line changes, or the person's words do.
    // Credentials, one at a time by name: never mentioned by the person
    // (BLOCK, only a change or a cut), written up from a class (BLOCK), or
    // with no year or status from anyone (FIX, settled by an answer that
    // gives one).
    const credentialFindings: MintFinding[] = [];
    const credentialSubject = new Map<string, string>();
    for (const c of checkCredentials(resumeText, sourceText)) {
      const { mention: m } = c;
      credentialSubject.set(m.line, m.name);
      if (c.issue === "unsaid") {
        credentialFindings.push({
          rule: "STD-T03",
          severity: "BLOCK",
          line: m.line,
          why: `"${clip(m.name, 50)}" was added for you. It stays only if you hold it and tell us what kind it is and when.`,
          kind: "credential_unsaid",
        });
      } else if (c.issue === "upgrade") {
        credentialFindings.push({
          rule: "STD-T03",
          severity: "BLOCK",
          line: m.line,
          why: "Your words describe a class or training for this, not a certification or license. A class is listed as training.",
          kind: "credential_upgrade",
        });
      } else if (c.issue === "status_claimed") {
        // The page gives a status or year the person never gave: an answer with their own status settles it.
        const a = standingFor(m.line);
        if (a && answerGivesStatusFor(a.answer, m.context || m.line)) continue;
        credentialFindings.push({
          rule: "STD-T03",
          severity: "BLOCK",
          line: m.line,
          why: `The page gives "${clip(m.name, 50)}" a status or year you didn't give us.`,
          kind: "credential_status_claimed",
        });
      } else {
        const a = standingFor(m.line);
        if (a && answerGivesStatusFor(a.answer, "")) continue;
        credentialFindings.push({
          rule: "STD-T03",
          severity: "FIX",
          line: m.line,
          why: "We don't know this credential's type or status yet: license, certification or training, and current, expired or in progress.",
          kind: "credential_status",
        });
      }
    }
    // A job title on the page that the person never used.
    // Asked like a defend line, so only where there is a defend step.
    const titleFindings: MintFinding[] = (requireDefend ? titlesNotTheirs(resumeText, sourceText) : [])
      // Settled by an answer about the title itself ("my pay stubs say kitchen manager").
      .filter((l) => {
        const a = standingFor(l);
        return !(a && answerMentions(a.answer, titleOf(l)));
      })
      .map((l) => ({
        rule: "STD-C03",
        severity: "BLOCK" as const,
        line: l,
        why: `"${clip(titleOf(l), 50)}" isn't a title in anything you told us. A title that doesn't match your paperwork comes up at the background check.`,
        kind: "title_unsaid",
      }));
    const findings = [...mint.findings, ...credentialFindings, ...titleFindings];
    for (const f of findings) {
      const subject = f.kind?.startsWith("credential_") ? credentialSubject.get(f.line) : undefined;
      push(f.rule, f.severity, f.line, f.why, f.kind === "credential_unsaid" ? credentialMemoryPrompt(subject ?? credentialNameOf(f)) : questionForFinding(f));
      if (f.kind) items[items.length - 1].kind = f.kind;
      if (subject) items[items.length - 1].subject = subject;
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
    allLinesInOwnWords: picks.allOwn && !defendLines.some((d) => d.reasons.includes("far_from_your_words")),
    rulesVersion: RESUME_RULES_VERSION,
  };
}
