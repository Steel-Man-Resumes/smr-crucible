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
import { scopeNotTheirs, scopeHitsNotTheirs, scopeYesText, isScopeWhoAnswer, helpedForm, typedCoversHit, isScopeCopy, sameTitle, employerWordsOf, withoutGoalText, ownJobFramed } from "./scopeWords";
import { isCredentialTerm } from "./credentialWords";
import { normalizeDigits, numberTokens } from "./numberRead";
import { credentialMentionsOf, credentialsToAsk, credentialKey, titleIsTheirs, type CredentialRow } from "./credentialMentions";
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
  /** For a credential finding on an education line (GED, diploma, degree): confirmed as earned or in progress. */
  education?: boolean;
  /** Round 11: for a scope claim, its family ("train"), so the card can ask "Who did you train?". */
  scopeFamily?: string;
  /** Round 11: for a scope claim, the line's shared form ("Helped train new hires"), when there is one. */
  helped?: string;
  /** Round 12: every scope family on the line still open (one card asks about all of them). */
  scopeFamilies?: string[];
  /** Round 13 (SF-4): a role used as a job title in the summary or letter ("shift supervisor"), asked on a title card. */
  roleTitle?: string;
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
  kind?: "rewrite" | "scope_yes" | "title_yes";
  /** Round 13 (SF-4): a rewrite made by "Use my title" on a role in the summary or letter: the title they typed. */
  ownTitle?: string;
  /** Round 11: for "scope_yes", the scope family the typed words answer ("train"). */
  family?: string;
  /** Round 11: a rewrite made by "I helped with it": the line is their shared form; never joins their words. */
  scopeHelp?: boolean;
  /** Round 12: the claim "I helped with it" was made for, and the sentence it changed (it settles only that one). */
  scopeHelpFamily?: string;
  scopeHelpText?: string;
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
  /**
   * What the person typed in the Forge's licenses-and-training answer. A
   * credential line on the page exactly as they typed it there is theirs and
   * is not asked about. Every other credential is a memory prompt.
   */
  credentialsAnswer?: string;
  /** Keys of credentials the person confirmed (D4): never asked again, and a title's credential word is theirs. */
  confirmedKeys?: string[];
  /** The person's structured credentials from the Forge's training step (round 7): the one typed exception. */
  credentialRows?: ReadonlyArray<CredentialRow>;
  /** The person's own uploaded resume (record lines held back as they chose): whole lines of it may cover a credential. */
  ownResumeText?: string;
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

// A title's credential word ("CERTIFIED", "LICENSED", "JOURNEYMAN"): once the person confirms that credential, it is theirs.
const TITLE_CREDENTIAL_WORDS_RE = /\b(?:certified|licensed|registered|journeyman|master|bonded|accredited|credentialed|apprentice)\b/gi;

/**
 * The experience entry headers whose title is not one of the person's own
 * job titles (round 6: the whole title, as in one of their own job headers
 * or "X at Y" in their words; never scattered or denied words). A title
 * credential the person confirmed (`confirmedKeys`) is theirs: only the rest
 * of the title is checked.
 */
function titlesNotTheirs(resumeText: string, sourceText: string, confirmedKeys: Set<string> = new Set(), answers: DefendAnswer[] = []): string[] {
  const out: string[] = [];
  let inExperience = false;
  for (const l of linesOf(resumeText)) {
    if (isSectionEnd(l)) { inExperience = EXPERIENCE_HEADING_RE.test(l.replace(/:$/, "")); continue; }
    if (!inExperience || !isEntryHeader(l)) continue;
    const full = titleOf(l);
    if (!full) continue;
    // Round 7: the person's own whole title is theirs, and so is a title whose credential they
    // confirmed ("CNA | Meadowbrook" for a person who holds the CNA).
    if (headerTitleIsTheirs(l, full, sourceText)) continue;
    // Only a title that names a credential ("CNA", "CERTIFIED NURSING ASSISTANT") is sourced by confirming it.
    const credentialTitle = isCredentialTerm(full) || new RegExp(TITLE_CREDENTIAL_WORDS_RE.source, "i").test(full);
    if (credentialTitle && confirmedKeys.has(credentialKey(full))) continue;
    // A title the person typed themselves (their own rewrite of the header) is theirs.
    if (rewriteOf(answers, l)) continue;
    // Round 12 (SF-2): "Yes, that was my title", typed by them and matching the title on the line.
    // Round 13 (SF-9): their short form counts ("Customer Service Rep" for "CUSTOMER SERVICE REPRESENTATIVE").
    if (answers.some((a) => a.kind === "title_yes" && squash(a.line) === squash(l) && (squash(a.answer) === squash(full) || sameTitle(a.answer, full)))) continue;
    const rest = full.replace(TITLE_CREDENTIAL_WORDS_RE, " ").replace(/\s{2,}/g, " ").trim();
    if (confirmedKeys.size && rest && rest !== full && headerTitleIsTheirs(l, rest, sourceText)) continue;
    out.push(l);
  }
  return out;
}

/** Round 13 (SF-4): why a role used as a title is open, and its question. */
export function roleTitleWhy(title: string): string {
  return `"${clip(title, 50)}" isn't a title in anything you told us. A title that doesn't match your paperwork comes up at the background check.`;
}
export function roleTitleQuestion(title: string): string {
  return `Was "${clip(title, 50)}" your job title?`;
}

// ---- Round 15 (R15-B3): a header title is theirs only from their own title for that same job ------------------

type OwnJob = { title: string; employer: string[]; from?: number; to?: number };
const THIS_YEAR = new Date().getFullYear();
const employerWords = (t: string) =>
  (t || "").toLowerCase().replace(/\([^)]*\)/g, " ").replace(/[^a-z0-9& ]+/g, " ").split(/\s+/).filter((w) => w && !/^(?:inc|llc|co|corp|corporation|company|the|of|and|&|services?|ltd|group)$/.test(w));
function yearSpan(t: string): { from?: number; to?: number } {
  const ys = (t.match(/\b(?:19|20)\d{2}\b/g) ?? []).map(Number);
  const open = /\b(?:present|now|current|currently|today)\b/i.test(t);
  if (!ys.length) return {};
  return { from: Math.min(...ys), to: open ? THIS_YEAR : Math.max(...ys) };
}
const PLACE_PART = /^[A-Z][a-zA-Z.]+(?:\s[A-Z][a-zA-Z.]+)*,\s*[A-Z]{2}$|^(?:remote)$/i;
const YEARS_ONLY = /^[\s\d\-\u2013\u2014to/,.]*(?:(?:19|20)\d{2})[\s\d\-\u2013\u2014to/,.]*(?:present|now|current)?\s*$/i;
/** The employer on a job header: the part that is not the title, a place or the years. */
function headerEmployer(parts: string[], titleIndex: number): string[] {
  for (let i = 0; i < parts.length; i++) {
    if (i === titleIndex) continue;
    const p = parts[i].trim();
    if (!p || PLACE_PART.test(p) || YEARS_ONLY.test(p) || /^(?:19|20)\d{2}/.test(p)) continue;
    return employerWords(p);
  }
  return [];
}
// Round 16 (R16-B1): a line that is only a year range ("2019 - 2023", "June 2019 - Present", "03/2016 - 06/2019").
const MONTH_RE = String.raw`(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?`;
const DATE_RE = String.raw`(?:${MONTH_RE}\s+)?(?:\d{1,2}\/)?(?:19|20)\d{2}`;
const YEAR_LINE = new RegExp(String.raw`^\(?${DATE_RE}(?:\s*(?:-|\u2013|\u2014|to|through|thru)\s*(?:${DATE_RE}|present|now|current|today))?\)?$`, "i");
const TITLE_YEARS_LINE = new RegExp(String.raw`^([A-Z][A-Za-z'&/. -]{1,40}?)\s*,\s*(${DATE_RE}(?:\s*(?:-|\u2013|\u2014|to|through|thru)\s*(?:${DATE_RE}|present|now|current|today))?)$`, "i");
const CONTACT_RE = /@|\(?\d{3}\)?[\s.-]?\d{3}[\s.-]\d{4}/;
const HEADING_WORDS = /\b(?:work|experience|employment|history|jobs?|background|references?|education|skills|summary|objective|contact|training|certifications?|licenses?)\b/i;
/** A sentence, never a title ("I was a shift lead at Kroger" is read as a sentence, below). */
const NOT_A_TITLE = /^(?:I|I'm|[Ww]e|[Mm]y|[Hh]e|[Ss]he|[Tt]hey|[Yy]ou|[Oo]ur|[Tt]heir|[Hh]is|[Hh]er|[Ii]t|[Tt]his|[Tt]hat)\b|\b(?:[Ww]as|[Ww]ere|[Aa]m|[Ii]s|[Aa]re|[Bb]een|[Ww]orked|[Ww]ants?|[Hh]ope|[Hh]oping|[Pp]lan|[Pp]lanning|[Ss]aid)\b/;
const hasYear = (t: string) => /\b(?:19|20)\d{2}\b/.test(t);
/** Round 17 (F2): a job line about the future or an offer; never a job they held. */
const FUTURE_IN_HEADER = /\b(?:(?:starting|starts)\s+(?:in\s+|on\s+|this\s+|next\s+)?(?:(?:19|20)\d{2}|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|mon|tue|wed|thu|fri|sat|sun|soon|week|month|year)|start\s+date|upcoming|hopefully|pending|offered|offer\s+letter|will\s+(?:be|start))\b/i;
/** A line that can be a job title on its own line ("Cashier"): short, capitalized, no years, no sentence. */
const titleLineOk = (t: string) =>
  /^[A-Z][A-Za-z'&/. -]{1,40}$/.test(t) && !NOT_A_TITLE.test(t) && t.split(/\s+/).length <= 5 && !/[.]$/.test(t) && !/\s(?:at|for)\s/i.test(t) && !HEADING_WORDS.test(t);
/** A line that can name an employer ("Kroger", "Kroger, Toledo, OH"): capitalized, short, no years, not a duty or a bullet. */
const employerLineOk = (raw: string) => {
  const t = raw.trim();
  return !!t && !/^[-•*]/.test(t) && /^[A-Z0-9]/.test(t) && !hasYear(t) && !/[.]$/.test(t) && !CONTACT_RE.test(t) && !t.includes("|") && t.split(/\s+/).length <= 8 && !HEADING_WORDS.test(t);
};
/**
 * The person's own jobs, read from their work history (never the goal box):
 * - job headers: "Cashier | Kroger | 2016 - 2019", employer first "Kroger | Cashier | 2016 - 2019", tabs, hyphens,
 *   en or em dashes ("Cashier - Kroger - 2016 - 2019"), "Cashier, Kroger, 2016 - 2019";
 * - "Cashier at Kroger", with its years on the same line or the next ("Shift Lead at Kroger" / "2019 - 2023");
 * - "Cashier" / "Kroger, Toledo, OH" / "2016 - 2019" over two or three lines; "Kroger" then "Cashier, 2016 - 2019";
 * - their sentences: "I was a cashier at Kroger", "I worked as ...", "My job at Kroger was ...", "hired on at ... as ...".
 * A header with no years takes them from the next line when that line is only a year range. A sentence under a
 * future, plan or condition frame is never their job (round 16).
 */
function ownJobs(sourceText: string): OwnJob[] {
  const out: OwnJob[] = [];
  const lines = withoutGoalText(sourceText).split("\n");
  const nextLine = (i: number): string => {
    for (let k = i + 1; k < lines.length; k++) if (lines[k].trim()) return lines[k].trim();
    return "";
  };
  const prevLine = (i: number): string => {
    for (let k = i - 1; k >= 0; k--) if (lines[k].trim()) return lines[k];
    return "";
  };
  /** The years on a header line, or on the next line when the header has none and that line is only years. */
  const spanOf = (l: string, i: number) => (hasYear(l) ? yearSpan(l) : YEAR_LINE.test(nextLine(i)) ? yearSpan(nextLine(i)) : {});
  /** Both readings of a separated header: title first (the usual) and employer first ("Kroger | Cashier | 2016 - 2019"). */
  const pushParts = (parts: string[], l: string, i: number, needYears: boolean) => {
    const span = spanOf(l, i);
    if (needYears && span.from === undefined) return;
    const at = parts[0].split(/\s+(?:at|@)\s+/i);
    if (at.length > 1) { out.push({ title: at[0], employer: employerWords(at[1]), ...span }); return; }
    out.push({ title: parts[0], employer: headerEmployer(parts, 0), ...span });
    const p1 = (parts[1] ?? "").trim();
    if (p1 && /[A-Za-z]/.test(p1) && !PLACE_PART.test(p1) && !YEARS_ONLY.test(p1) && !hasYear(p1) && p1.split(/\s+/).length <= 5) {
      out.push({ title: p1, employer: employerWords(parts[0]), ...span });
    }
  };
  let blockEmployer: string[] = [];
  // Round 17 (F1): a references section or a "Supervisor:" block names someone else's job, never theirs.
  let refs = false;
  let otherPerson = false;
  let otherLines = 0;
  let seenOther = false;
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const l = raw.trim().replace(/^\s*[-•*]\s*/, "");
    if (!l) { otherPerson = false; continue; }
    if (CONTACT_RE.test(l)) continue;
    // A section heading ("EDUCATION", "Certifications") ends an employer's block.
    if (!hasYear(l) && l.split(/\s+/).length <= 4 && HEADING_WORDS.test(l)) {
      blockEmployer = [];
      if (/\b(?:references?|contacts?)\b/i.test(l)) refs = true;
      else if (/\b(?:work|experience|employment|history|jobs?|background|career)\b/i.test(l)) refs = false;
      continue;
    }
    if (/^(?:my\s+)?(?:supervisor|manager|boss|reference|contact)s?\s*:/i.test(l)) { otherPerson = true; otherLines = 0; seenOther = /:\s*\S/.test(l); continue; }
    // A "Supervisor:" block ends at a blank line, or (for compact pastes with no blank lines) at the next dated job
    // header once the supervisor's own details have been seen: the name on the label line, or one line after it.
    if (otherPerson && seenOther && hasYear(l) && /\||\t|\s[-\u2013\u2014]\s/.test(l) && /[A-Za-z]/.test(l.replace(/\b(?:present|now|current)\b/gi, ""))) otherPerson = false;
    else if (otherPerson) { seenOther = true; if (++otherLines > 6) otherPerson = false; }
    if (refs || otherPerson) continue;
    // Round 17 (F2): a header with a future or offer frame ("Shift Lead - Kroger - starting 2024") is not a job they held.
    if (FUTURE_IN_HEADER.test(l)) continue;
    // Tab-separated only between parts: a duty indented with a tab is still read as a sentence.
    if (l.includes("|") || l.includes("\t")) {
      pushParts(l.split(l.includes("|") ? "|" : /\t+/).map((x) => x.trim()).filter(Boolean), l, i, false);
      continue;
    }
    const comma = l.split(/\s*,\s*/);
    if (comma.length >= 3 && /(?:19|20)\d{2}/.test(comma[comma.length - 1]) && comma[0].split(/\s+/).length <= 5) {
      out.push({ title: comma[0], employer: employerWords(comma[1]), ...yearSpan(l) });
      continue;
    }
    // "Kroger" (or "Kroger, Toledo, OH") then "Cashier, 2016 - 2019": the employer is the line above, or the one
    // that opened this employer's block when the line above is a duty.
    const ty = l.match(TITLE_YEARS_LINE);
    if (ty && !/\s(?:at|for)\s/i.test(ty[1]) && !NOT_A_TITLE.test(ty[1])) {
      const prev = prevLine(i);
      if (employerLineOk(prev)) blockEmployer = employerWords(prev.split(",")[0]);
      if (blockEmployer.length) out.push({ title: ty[1].trim(), employer: blockEmployer, ...yearSpan(ty[2]) });
      continue;
    }
    // "Cashier - Kroger - 2016 - 2019", "Cashier — Kroger — 2016–2019": dated only.
    const dashed = l.split(/\s+[-\u2013\u2014]\s+|\s*\u2014\s*/).map((x) => x.trim()).filter(Boolean);
    if (dashed.length >= 2 && /[A-Za-z]/.test(dashed[0]) && dashed[0].split(/\s+/).length <= 5 && !/[.]/.test(dashed[0]) && !NOT_A_TITLE.test(dashed[0])) {
      pushParts(dashed, l, i, true);
    }
    // "Cashier" / "Kroger, Toledo, OH" / "2016 - 2019", or "Cashier" / "Kroger, Toledo, OH 2016 - 2019".
    if (titleLineOk(l)) {
      let k = i + 1;
      while (k < lines.length && !lines[k].trim()) k++;
      const e = (lines[k] ?? "").trim();
      if (e && /^[A-Z0-9]/.test(e) && !CONTACT_RE.test(e) && !/[.]$/.test(e) && !YEAR_LINE.test(e) && !TITLE_YEARS_LINE.test(e)) {
        const ep = e.split(/\s*[,|]\s*|\t+/).map((x) => x.trim()).filter(Boolean);
        const employer = headerEmployer(ep.map((x) => x.replace(/\s*\(?(?:19|20)\d{2}.*$/, "")).filter(Boolean), -1);
        const span = hasYear(e) ? yearSpan(e) : YEAR_LINE.test(nextLine(k)) ? yearSpan(nextLine(k)) : {};
        if (employer.length && employer.length <= 6 && span.from !== undefined) out.push({ title: l, employer, ...span });
      }
    }
    const at = l.match(/^([A-Za-z][A-Za-z'&/ -]{1,40}?)\s+(?:at|for)\s+([A-Z0-9][^,.;]*?)(?:[,(]?\s*((?:19|20)\d{2}[^.;]*))?(?:[.;]|$)/);
    if (at && at[1].split(/\s+/).length <= 5 && !NOT_A_TITLE.test(at[1]) && !ownJobFramed(l, 0, at[1].length, true, nextLine(i))) {
      // Round 16 (R16-B1): "Shift Lead at Kroger" with its years on the next line.
      out.push({ title: at[1], employer: employerWords(at[2]), ...(at[3] ? yearSpan(at[3]) : spanOf(at[2], i)) });
    }
    const titleEnd = (m: RegExpMatchArray, t: string) => (m.index as number) + m[0].indexOf(t) + t.length;
    const framed = (m: RegExpMatchArray, end: number, present: boolean) => ownJobFramed(l, m.index as number, end, present, nextLine(i));
    for (const m of l.matchAll(/\b(?:worked|was|served|hired\s+on|started)\s+as\s+(?:an?\s+|the\s+)?([A-Za-z][A-Za-z'&/ -]{1,40}?)\s+(?:at|for)\s+([A-Z0-9][^,.;]*?)(?=[,.;]|\s+(?:from|in|until|since)\b|$)/g)) {
      if (framed(m, titleEnd(m, m[1]), false)) continue;
      out.push({ title: m[1], employer: employerWords(m[2]), ...(/(?:19|20)\d{2}\s*(?:-|\u2013|\u2014|to)\s*(?:(?:19|20)\d{2}|present|now)/i.test(l) ? yearSpan(l) : {}) });
    }
    // "I was a CNA at Meadowbrook from 2019 to 2023", "I worked at Midwest Distribution from 2019 to 2023 as a warehouse associate".
    const range = /(?:19|20)\d{2}\s*(?:-|\u2013|\u2014|to|through|thru)\s*(?:(?:19|20)\d{2}|present|now)/i.test(l) ? yearSpan(l) : {};
    for (const m of l.matchAll(/\bI\s+(was|am|'m)\s+(?:an?|the)\s+([A-Za-z][A-Za-z'&/ -]{1,40}?)\s+(?:at|for|with)\s+([A-Z0-9][^,.;]*?)(?=[,.;]|\s+(?:from|in|until|since|and|but)\b|$)/g)) {
      if (framed(m, titleEnd(m, m[2]), m[1].toLowerCase() !== "was")) continue;
      out.push({ title: m[2], employer: employerWords(m[3]), ...range });
    }
    for (const m of l.matchAll(/\b(?:worked|was|started|employed)\s+at\s+([A-Z0-9][^,.;]*?)\s+(?:from\s+[^,.;]*?\s+)?as\s+(?:an?\s+|the\s+)?([A-Za-z][A-Za-z'&/ -]{1,40}?)(?=[,.;]|\s+(?:from|in|until|since|and|but)\b|$)/g)) {
      if (framed(m, (m.index as number) + m[0].length, false)) continue;
      out.push({ title: m[2], employer: employerWords(m[1]), ...range });
    }
    // "I was hired on at Midwest Distribution in 2019 as a picker", "My job at Midwest Distribution was warehouse associate".
    // A sentence gives a start year at most, not a span, so its years are left open.
    for (const m of l.matchAll(/\bhired\s+on\s+at\s+([A-Z0-9][^,.;]*?)\s+as\s+(?:an?\s+|the\s+)?([A-Za-z][A-Za-z'&/ -]{1,40}?)(?=[,.;]|\s+(?:from|in|until|since|and)\b|$)/g)) {
      if (framed(m, (m.index as number) + m[0].length, false)) continue;
      out.push({ title: m[2], employer: employerWords(m[1].replace(/\s+in\s+(?:19|20)\d{2}$/, "")) });
    }
    for (const m of l.matchAll(/\bmy\s+(?:job|title|position|role)\s+at\s+([A-Z0-9][^,.;]*?)\s+(was|is)\s+(?:an?\s+|the\s+)?([A-Za-z][A-Za-z'&/ -]{1,40}?)(?=[,.;]|$)/gi)) {
      if (framed(m, (m.index as number) + m[0].length, m[2].toLowerCase() === "is")) continue;
      out.push({ title: m[3], employer: employerWords(m[1]) });
    }
  }
  return out.filter((j) => j.title && /[A-Za-z]/.test(j.title));
}
const sameEmployer = (a: string[], b: string[]) => a.length > 0 && b.length > 0 && (a.every((w) => b.includes(w)) || b.every((w) => a.includes(w)));
const overlaps = (a: { from?: number; to?: number }, b: { from?: number; to?: number }) =>
  a.from === undefined || b.from === undefined || (a.from <= (b.to as number) && b.from <= (a.to as number));
const covers = (own: { from?: number; to?: number }, page: { from?: number; to?: number }) =>
  page.from === undefined || (own.from !== undefined && (own.from as number) <= (page.from as number) && (own.to as number) >= (page.to as number));
const titleMatches = (a: string, b: string) => squash(a) === squash(b) || sameTitle(a, b);
/**
 * Round 16 (R16-B1): whether one of their own jobs settles a page header's years. A dated job settles the years it
 * covers. A job read without years ("Shift lead at Kroger.", "I was a shift lead at Kroger") settles a header only
 * when it is their only job at that employer: with another title of theirs there (a promotion), only a dated job can
 * say which years were which, so the header asks.
 */
function settles(job: OwnJob, span: { from?: number; to?: number }, jobs: OwnJob[]): boolean {
  if (job.from !== undefined) return covers(job, span);
  return !jobs.some((o) => o !== job && sameEmployer(o.employer, job.employer) && !titleMatches(o.title, job.title));
}

/**
 * Round 15 (R15-B3): a page job header's title is theirs only when one of their own jobs at the same employer, with
 * years that cover the page's years, carries that title word for word (short forms aside). A promotion at the same
 * employer never moves the higher title onto the earlier years or a merged span; no job of theirs, no clear.
 */
function headerTitleIsTheirs(pageHeader: string, title: string, sourceText: string): boolean {
  const body = pageHeader.replace(/^\s*[-•*]\s*/, "");
  const parts = body.split("|").map((x) => x.trim());
  const at = parts[0].split(/\s+(?:at|@)\s+/i);
  const employer = at.length > 1 ? employerWords(at[1]) : headerEmployer(parts, parts.findIndex((p) => squash(p) === squash(title)) >= 0 ? parts.findIndex((p) => squash(p) === squash(title)) : 0);
  const span = yearSpan(body);
  const jobs = ownJobs(sourceText);
  const same = jobs.filter((j) => sameEmployer(j.employer, employer) && overlaps(j, span));
  return same.some((j) => titleMatches(j.title, title) && settles(j, span, jobs));
}

/** The person's rewrite of this line, when they typed it themselves. */
function rewriteOf(answers: DefendAnswer[], line: string): DefendAnswer | undefined {
  return answers.find((a) => a.kind === "rewrite" && typeof a.replaced === "string" && a.replaced.trim() !== "" && squash(a.line) === squash(line));
}

const stripBulletText = (l: string) => l.replace(/^\s*[-•*]\s*/, "");

/** True when the person typed this scope word themselves: the line is their rewrite and the word was not in the line it replaced. */
function personIntroduced(answers: DefendAnswer[], line: string, word: string): boolean {
  const rw = rewriteOf(answers, line);
  if (!rw) return false;
  const head = (word.match(/[A-Za-z]+/) ?? [""])[0].toLowerCase();
  return !!head && !new RegExp(`\\b${head}\\b`, "i").test(rw.replaced as string);
}

/**
 * Round 11: the first scope claim on a line that is not theirs, reading their
 * "Yes, I did this" answers for this line only (each as "I trained <their
 * words>"), and a shared page claim on a line they turned into its shared
 * form ("I helped with it"). Nothing typed here joins their words elsewhere.
 */
export function scopeNotTheirsAnswered(line: string, sourceText: string, answers: DefendAnswer[]): ReturnType<typeof scopeNotTheirs> {
  return scopeAllNotTheirsAnswered(line, sourceText, answers)[0];
}

/** Every scope claim on a line still not theirs after their answers on that line (round 12: one card per line). */
export function scopeAllNotTheirsAnswered(line: string, sourceText: string, answers: DefendAnswer[]): NonNullable<ReturnType<typeof scopeNotTheirs>>[] {
  const own = answers.filter(
    (a) => a.kind === "scope_yes" && squash(a.line) === squash(line) && typeof a.family === "string" && isScopeWhoAnswer(a.answer) && !isScopeCopy(a.answer, line)
  );
  const extra = own.map((a) => scopeYesText(a.family as string, a.answer)).join("\n");
  const help = rewriteOf(answers, line);
  const k = (h: { family: string; word: string }) => `${h.family}\u0000${h.word.toLowerCase()}`;
  const withYes = new Set(scopeHitsNotTheirs(line, extra ? `${sourceText}\n${extra}` : sourceText).map(k));
  const titleYes = answers.filter((a) => a.kind === "title_yes" && squash(a.line) === squash(line));
  const employers = employerWordsOf(sourceText);
  return scopeHitsNotTheirs(line, sourceText).filter((h) => {
    // Round 13 (SF-4): a title in the summary or letter is settled only by its title card ("Yes, that was my
    // title", "Use my title") or their own words, never by a "Yes, I did this" on the line.
    if (h.role) {
      if (h.title && titleYes.some((a) => sameTitle(a.answer, h.title as string))) return false;
      if (h.title && help?.ownTitle && sameTitle(help.ownTitle, h.title)) return false;
      return true;
    }
    // Round 12 (SF-4): typed words that name people, a count or names cover an uncounted group. Round 13 (SF-7):
    // typed words that name a different group are refused, and the sentence reading does not get a second go.
    const verdicts = own.filter((a) => a.family === h.family).map((a) => typedCoversHit(h, a.answer, line, employers));
    if (verdicts.some((v) => v === true)) return false;
    if (verdicts.length && verdicts.every((v) => v === false)) return true;
    if (!withYes.has(k(h))) return false;
    // Their "I helped with it": only the claim it was made for, in its own sentence.
    if (help?.scopeHelp && h.shared && (!help.scopeHelpFamily || help.scopeHelpFamily === h.family)) {
      if (!help.scopeHelpText || squash(line).includes(squash(help.scopeHelpText))) return false;
    }
    return true;
  });
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
  "If an interviewer called to check this job, would they find this title on your paperwork? Change it to the title your paperwork shows.";

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

/**
 * New (round 8): an education line the person has not given us. Kept only
 * when they say earned (with the year) or in progress. Round 9: it names the
 * credential ("Do you have a GED?"); a school or program with no credential
 * named is "Did you finish ...?".
 */
export function educationMemoryPrompt(name: string): string {
  const n = clip(name, 50);
  const grad = n.match(/^(.*?)\s+graduate$/i);
  if (grad) return `Did you finish ${grad[1].toLowerCase()}? Say the year you finished, or if you are still working on it.`;
  if (/\b(?:GED|G\.E\.D|HSED|HSE|HiSET|TASC|equivalency|diploma|degree|certificate|associate|bachelor|master|doctorate|A\.A\.S?|B\.S|B\.A|M\.S|M\.?B\.?A)\b/i.test(n)) {
    return `Do you have ${/^(?:[aeiou]|HSED|HSE\b|HiSET)/i.test(n) ? "an" : "a"} ${n}? Say if you earned it, and the year, or if you are still working on it.`;
  }
  return `Did you finish ${n}? Say the year you finished, or if you are still working on it.`;
}

/** Why a credential is asked about (round 5: every credential, until the person confirms it). */
export function credentialPromptWhy(name: string): string {
  return `"${clip(name, 50)}" stays on the page only when you tell us you hold it, what kind it is, and when.`;
}

/** New (round 5): a scope claim the person never made. Only their own rewrite or a cut settles it. */
export const Q_SCOPE = "Is this true? An interviewer will ask you about it.";

/** Why a scope claim is held. */
export function scopeWhy(word: string): string {
  return `"${clip(word, 40)}" says you ran, led or answered for other people, and that isn't in anything you told us.`;
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
  // Round 5: a credential is never a defend line. It is a memory prompt
  // (getResumeStatus), confirmed with its kind and year or status.
  const picked = new Map<string, Set<DefendReason>>();
  const add = (l: string, r: DefendReason) => {
    if (!picked.has(l)) picked.set(l, new Set());
    picked.get(l)!.add(r);
  };

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
      return { line, reasons: rs, question: questionForDefend(line, rs, sourceText || "") };
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
  // Each answer belongs to its own line only; answers are never pooled into
  // the source. The page is always checked against the person's own words.
  // Round 11: a "Yes, I did this" answer settles only its own scope claim, never the line's other questions.
  const byLine = new Map(answers.filter((a) => a.kind !== "scope_yes" && a.kind !== "title_yes").map((a) => [squash(a.line), a]));
  const standingFor = (line: string) => {
    const a = byLine.get(squash(line));
    if (!answerStands(a, line, sourceText)) return undefined;
    // A headline is answered only by talking about what it says.
    if (picks.header.has(line) && a!.kind !== "rewrite" && !answerMentions(a!.answer, line)) return undefined;
    return a;
  };

  if (resumeText.trim() && sourceText.trim()) {
    const mint = runMintCheck({ output: resumeText, source: sourceText, kind: "resume" });
    // Round 5: every credential on the page is a memory prompt (decision
    // D4), never settled by reading the person's free text. The one
    // exception is a line exactly as they typed it in their
    // licenses-and-training answer. The prompt is settled only by a
    // confirmation (the line is rewritten from it) or a cut.
    const credentialFindings: MintFinding[] = [];
    // Round 10 (SF-2): each credential finding carries its own name and kind, never its line's.
    const credentialOf = new Map<MintFinding, { name: string; education: boolean }>();
    const confirmedKeys = new Set(input.confirmedKeys ?? []);
    // Round 7: the whole-line exception reads only the person's uploaded resume (never the free-text
    // licenses answer); their structured credential rows are the other exception.
    const typedLines = new Set((input.credentialsAnswer ?? "").split("\n").map((l) => l.trim()).filter(Boolean));
    const personText = input.ownResumeText ?? sourceText.split("\n").filter((l) => !typedLines.has(l.trim())).join("\n");
    const backstopText = `${sourceText}\n\n${input.credentialsAnswer ?? ""}`;
    for (const m of credentialsToAsk(resumeText, personText, confirmedKeys, input.credentialRows, backstopText)) {
      const finding: MintFinding = {
        rule: "STD-T03",
        severity: "BLOCK",
        line: m.line,
        why: credentialPromptWhy(m.name),
        kind: "credential_unsaid",
      };
      credentialOf.set(finding, { name: m.name, education: !!m.education });
      credentialFindings.push(finding);
    }
    // A scope claim (ran, led, supervised, trained people...) the person
    // never made is settled only by their own rewrite or a cut, never by an
    // answer.
    const scopeFindings: MintFinding[] = [];
    const scopeOf = new Map<MintFinding, { family: string; families?: string[]; helped?: string }>();
    const roleTitleOf = new Map<MintFinding, string>();
    // A credentials line is a credential, asked by its prompt; its name may hold a scope word ("ServSafe Manager").
    const credentialSectionLines = new Set(credentialMentionsOf(resumeText).filter((m) => m.where === "credentials").map((m) => m.context));
    for (const { line, inSkills } of bodyLines(resumeText, sourceText)) {
      if (inSkills || credentialSectionLines.has(line)) continue;
      // Round 12: ONE card per line, for every claim on it the person has not made.
      const all = scopeAllNotTheirsAnswered(line, sourceText, answers).filter((h) => !personIntroduced(answers, line, h.word));
      // Round 13 (SF-4): a role used as a title ("Shift supervisor with ...") gets its own title card.
      const role = all.find((h) => h.role && h.title);
      if (role) {
        const finding: MintFinding = { rule: "STD-C04", severity: "BLOCK", line, why: roleTitleWhy(role.title as string), kind: "title_unsaid" };
        roleTitleOf.set(finding, role.title as string);
        scopeFindings.push(finding);
      }
      const hits = all.filter((h) => !(h.role && h.title));
      const hit = hits[0];
      if (!hit) continue;
      const finding: MintFinding = { rule: "STD-C04", severity: "BLOCK", line, why: scopeWhy(hit.word), kind: "scope_unsaid" };
      const families = Array.from(new Set(hits.map((h) => h.family)));
      // Round 13 (SF-3): never "I helped with it" for a title.
      scopeOf.set(finding, { family: hit.family, families, helped: hits.length === 1 && !hit.role ? helpedForm(line, hit.word) : undefined });
      scopeFindings.push(finding);
    }
    // A job title the person never used that claims scope ("SHIFT SUPERVISOR"): the same, on its job header.
    for (const line of titlesNotTheirs(resumeText, sourceText, confirmedKeys, answers)) {
      const hit = scopeNotTheirs(titleOf(line), sourceText);
      // Round 12 (SF-2): a job title is settled on its own title card, never by "Yes, I did this".
      if (hit) scopeFindings.push({ rule: "STD-C04", severity: "BLOCK", line, why: scopeWhy(hit.word), kind: "scope_unsaid" });
    }
    // A job title on the page that the person never used (round 6: settled
    // only by their own rewrite or a cut, never by an answer).
    // Asked like a defend line, so only where there is a defend step.
    const titleFindings: MintFinding[] = (requireDefend ? titlesNotTheirs(resumeText, sourceText, confirmedKeys, answers) : [])
      .map((l) => ({
        rule: "STD-C03",
        severity: "BLOCK" as const,
        line: l,
        why: `"${clip(titleOf(l), 50)}" isn't a title in anything you told us. A title that doesn't match your paperwork comes up at the background check.`,
        kind: "title_unsaid",
      }));
    const findings = [...mint.findings, ...credentialFindings, ...scopeFindings, ...titleFindings];
    for (const f of findings) {
      const cred = credentialOf.get(f);
      const subject = cred?.name;
      push(
        f.rule,
        f.severity,
        f.line,
        f.why,
        f.kind === "credential_unsaid"
          ? cred?.education
            ? educationMemoryPrompt(subject ?? credentialNameOf(f))
            : credentialMemoryPrompt(subject ?? credentialNameOf(f))
          : f.kind === "scope_unsaid"
            ? Q_SCOPE
            : questionForFinding(f)
      );
      if (f.kind) items[items.length - 1].kind = f.kind;
      if (subject) items[items.length - 1].subject = subject;
      if (f.kind === "credential_unsaid" && cred?.education) items[items.length - 1].education = true;
      const roleTitle = roleTitleOf.get(f);
      if (roleTitle) {
        items[items.length - 1].roleTitle = roleTitle;
        items[items.length - 1].question = roleTitleQuestion(roleTitle);
      }
      const sc = scopeOf.get(f);
      if (sc) {
        items[items.length - 1].scopeFamily = sc.family;
        if (sc.families && sc.families.length > 1) items[items.length - 1].scopeFamilies = sc.families;
        if (sc.helped) items[items.length - 1].helped = sc.helped;
      }
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
