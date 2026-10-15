/**
 * The server's own answer to "is this resume finished?" (Phase 5 lane R1).
 *
 * Every saved revision, every download, print, quick-apply attachment and
 * the automatic email asks THIS, never a page's flag. It runs:
 *   1. the same finish gate the page runs (buildFinishView, which calls the
 *      engine's getResumeStatus), with ALL the evidence the page has: the
 *      person's own words, the writer's documents as delivered, the second
 *      check's grounding, the defend answers (title and scope answers
 *      included), skill terms they kept (D3), credentials they confirmed in
 *      their own words (D4), the licenses answer and rows, what a cut left,
 *      AND the cover letter (D5: the letter is as strict as the resume);
 *   2. the renderer's real layout measurement (lib/resume-render, the same
 *      layout the PDF is built from) against the length rule for the kind
 *      (lib/length-rule.ts, D8 and C1).
 * Finished only when the gate holds no BLOCK and the page count fits.
 *
 * Evidence is cleaned through readStoredFinish, the same filter the finish
 * page uses when it restores a run: a confirmation counts only when the
 * writer named that credential, a kept term only while it is on the page, a
 * rewrite only when it is consistent with itself. What the person typed as
 * their own words is theirs by definition; what decides "finished" is the
 * gate run here, on that evidence.
 */

import { isRecordChoice, recordChoiceFrom, type RecordChoice } from "./record-choice";
import { readStoryDraft, type StoryDraft } from "./story-verification";
import {
  buildFinishView,
  openItemsInPlainWords,
  readStoredFinish,
  FINISH_STATE_VERSION,
  type CredentialConfirm,
  type DefendAnswer,
  type FinishView,
  type WrittenDocs,
} from "./finish-gate";
import { completeCredentialRows, readCredentialRows } from "./credential-rows";
import { isLengthChoice, lengthOpenItem, lengthOk, pageLimitFor, type LengthChoice, type RevisionDocKind } from "./length-rule";
import { MAX_RENDER_CHARS, fitFor } from "./resume-render";
import type { ArtifactRevision, NewRevision, RevisionSource } from "@crucible/core/src/artifactRevision";
import { readReceipt, receiptAccepted, sourceHash, verifyWriterReceipt, type ReceiptContext, type WriterSource } from "./writer-receipt";
import { stableJson } from "@crucible/core/src/artifactRevision";
import { createHash } from "node:crypto";
import { jobOfLine } from "@crucible/core/src/resumeStatus";
import { matchOwnJob, readJobHeader } from "@crucible/core/src/jobResolver";

/** Integration r2 (M1): two headers the shared job resolver reads as the same job (title, employer, and dates when it must choose). */
export function sameJobHeader(oldHeader: string, newHeader: string): boolean {
  return matchOwnJob(readJobHeader(newHeader), [readJobHeader(oldHeader)]).kind === "one";
}
import { lineKey } from "./revision-patch";

/** Bump when the gate or the page rule changes in a way that can change a status. */
// v4 requires completed truth checks and keeps factual letter clauses in scope.
export const CHECKER_VERSION = "finish-gate-4+pages-1+receipt-1";

const MAX_WORDS = 120_000;
const MAX_GROUNDING_JSON = 300_000;
const DOC_KINDS: readonly RevisionDocKind[] = ["resume", "cv_academic", "cv_clinical", "cv_international", "artist_resume", "performer_resume"];

/** Everything the gate reads, cleaned. */
export interface RevisionInput {
  docKind: RevisionDocKind;
  lengthChoice: LengthChoice;
  resumeText: string;
  letterText: string;
  defendAnswers: DefendAnswer[];
  keptTerms: string[];
  confirmedCredentials: CredentialConfirm[];
  evidence: RevisionEvidence;
}

/** The evidence stored with a revision (everything besides texts and confirmations). */
export interface RevisionEvidence {
  storyDraft?: StoryDraft;
  ownWords: string;
  written: WrittenDocs | null;
  grounding: unknown;
  withheldLines: string[];
  keepInsideLines: boolean;
  recordChoice?: RecordChoice;
  addedTerms: string[];
  credentialCutRemnants: string[];
  credentialsAnswer: string;
  credentialRows: unknown[];
  ownResumeText: string;
  /** The writer's receipt over written + grounding (lib/writer-receipt.ts), as delivered. */
  writerReceipt: string;
  /** The run this version was finished in (the Forge session's startedAt), as the page named it. */
  runId?: string;
  /**
   * Set by the SERVER only: written and grounding are the writer's own (the
   * receipt matched when this was saved). False: they count for nothing and
   * the version cannot be finished.
   */
  writerVerified: boolean;
  /**
   * Phase 6 (S1 round 2). Set by the SERVER only, on a page the person saved
   * exactly as they gave it (the lanes-first first save: their upload or
   * their "Build with me" section): givenTextMark of that text. Never read
   * from a request. A rebuild counts the page as their own words only while
   * the stored text still matches it (lib/rebuild-source.ts).
   */
  givenAsIs?: string;
  /**
   * Phase 6 integration (H1). Set by the SERVER only, on an artifact check
   * ("Check and finish") of a version the writer made: the checked version
   * keeps that origin, so the lane home keeps offering "Check and finish",
   * never a rebuild that throws the person's answers away. Kept only on
   * stored rows; never read from a request.
   */
  writerOrigin?: boolean;
}

/** The mark a page saved as given carries (sha256 over its exact text). Server only. */
export function givenTextMark(text: string): string {
  return createHash("sha256").update(`given-as-is\u0000${text}`).digest("hex");
}

/** How to read what was sent. */
export interface CleanOptions {
  /**
   * A row this server stored (a saved revision): its evidence was checked
   * when it was saved, so it is taken as stored (a rotated secret never turns
   * a saved version into a draft). Never set for anything a page sent.
   */
  trusted?: boolean;
  /**
   * The kind, decided by the SERVER (review M1). A page's docKind is never
   * read. Default "resume": every Forge, import and Refinery revision is one.
   */
  docKind?: RevisionDocKind;
  /**
   * Who is asking and what the server knows about the receipt's run (reviews
   * M-B, H2). Default: signed out, the run the page names.
   */
  receipt?: ReceiptContext;
  /**
   * Signed in: the person's own words as the SERVER holds them (their stored
   * upload and typed answers). Used whenever the request's own words are not
   * attested by a receipt. Signed out there is none: own words are empty.
   */
  serverSource?: WriterSource | null;
  /**
   * Signed in: the evidence of the person's newest verified revision, with
   * the nonce its receipt carried. A request whose written documents and
   * grounding match it exactly is trusted as that verified version (a
   * rotated key never forces a regeneration; L-A), unless a newer generation
   * of the run was recorded since.
   */
  known?: Pick<RevisionEvidence, "written" | "grounding" | "ownWords" | "ownResumeText" | "credentialsAnswer" | "credentialRows" | "writerReceipt"> | null;
  /**
   * The newest nonce recorded for the KNOWN revision's own receipt run (review
   * r3 L-1): a newer generation since then means the known version no longer
   * stands in, receipt or not.
   */
  knownNewestNonce?: string | null;
  /** The clock, for the previous key's grace period (tests). */
  now?: number;
}

/** The open item for a version whose writer's documents and check have no matching receipt. */
export { RECEIPT_OPEN_ITEM, RECHECK_LINE, needsRecheck } from "./recheck-copy";
import { RECEIPT_OPEN_ITEM } from "./recheck-copy";

export type CleanResult = { ok: true; input: RevisionInput } | { ok: false; reason: string };

const str = (v: unknown, max: number): string => (typeof v === "string" ? v.slice(0, max) : "");

/**
 * Clean what a page sent (the finish page's state, or the import's stored
 * finish). Never trusts a status or a "finished" flag: there is no field for one.
 *
 * OWN WORDS ARE THE SERVER'S (review H2). The request's ownWords,
 * ownResumeText, licenses answer and rows count only when they hash to the
 * source block the writer's receipt attests (worked out by the server in
 * generate-docs from the writer's own inputs). Otherwise the server's own
 * copy is used (signed in: the stored upload and answers; signed out:
 * nothing). A request can therefore never ADD own words; claiming the whole
 * page as "own words" leaves every card open.
 */
export function cleanRevisionInput(raw: unknown, opts: CleanOptions = {}): CleanResult {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, reason: "no finish state" };
  const r = raw as Record<string, unknown>;
  const resumeText = typeof r.resumeText === "string" ? r.resumeText : "";
  if (!resumeText.trim()) return { ok: false, reason: "no resume" };
  if (resumeText.length > MAX_RENDER_CHARS) return { ok: false, reason: "too long" };
  const letterText = typeof r.coverLetterText === "string" ? r.coverLetterText : typeof r.letterText === "string" ? r.letterText : "";
  if (letterText.length > MAX_RENDER_CHARS) return { ok: false, reason: "too long" };
  let groundingJson = "null";
  try {
    groundingJson = JSON.stringify(r.grounding ?? null) ?? "null";
  } catch {
    return { ok: false, reason: "bad grounding" };
  }
  // Too big to keep: refused, never dropped (dropping it could hide a block).
  if (groundingJson.length > MAX_GROUNDING_JSON) return { ok: false, reason: "too long" };

  // The same filter the finish page uses when it restores a run.
  const stored = readStoredFinish(
    {
      v: FINISH_STATE_VERSION,
      key: "revision",
      docs: {
        resumeText,
        coverLetterText: letterText,
        withheldLines: r.withheldLines,
        keepInsideLines: r.keepInsideLines === true,
        ...(isRecordChoice(r.recordChoice) ? { recordChoice: r.recordChoice } : {}),
        grounding: JSON.parse(groundingJson),
        written: r.written,
      },
      defendAnswers: Array.isArray(r.defendAnswers) ? r.defendAnswers.slice(0, 400) : [],
      addedTerms: Array.isArray(r.addedTerms) ? r.addedTerms.slice(0, 200) : [],
      keptTerms: Array.isArray(r.keptTerms) ? r.keptTerms.slice(0, 200) : [],
      confirmedCredentials: Array.isArray(r.confirmedCredentials) ? r.confirmedCredentials.slice(0, 100) : [],
      credentialCutRemnants: Array.isArray(r.credentialCutRemnants) ? r.credentialCutRemnants.slice(0, 200) : [],
    },
    "revision"
  );
  if (!stored) return { ok: false, reason: "bad finish state" };
  // The kind is the server's: a stored row keeps its own; anything a page sent is a resume.
  const docKind: RevisionDocKind = opts.trusted
    ? (DOC_KINDS as readonly string[]).includes(r.docKind as string)
      ? (r.docKind as RevisionDocKind)
      : "resume"
    : opts.docKind ?? "resume";
  // written, grounding and the own-words source count only with the writer's
  // receipt, made for this account (or run), this run's newest generation,
  // and exactly this source (reviews M1, M-B, H2).
  const receipt = typeof r.writerReceipt === "string" ? r.writerReceipt.slice(0, 2000) : "";
  const writtenIn = stored.docs.written ?? null;
  const groundingIn = stored.docs.grounding ?? null;
  const requested: WriterSource = {
    ownWords: str(r.ownWords, MAX_WORDS),
    ownResumeText: str(r.ownResumeText, MAX_WORDS),
    credentialsAnswer: str(r.credentialsAnswer, 20_000),
    credentialRows: completeCredentialRows(readCredentialRows(r.credentialRows)) as unknown[],
  };
  let verified: boolean;
  let source: WriterSource;
  let receiptKept = "";
  let writtenOut: WrittenDocs | null = writtenIn;
  let groundingOut: unknown = groundingIn;
  if (opts.trusted) {
    // A stored row: as stored.
    verified = r.writerVerified === true;
    source = requested;
    receiptKept = verified ? receipt : "";
  } else {
    const ctx: ReceiptContext = opts.receipt ?? { userId: null, runId: typeof r.runId === "string" ? r.runId : "" };
    const meta = verifyWriterReceipt(receipt, writtenIn, groundingIn, opts.now);
    const accepted = !!meta && receiptAccepted(meta, ctx);
    // Signed in, a check signs the SERVER-held source (review N2): a receipt
    // over that source stands, with those own words, whatever the page sent.
    const serverAttested = accepted && !!opts.serverSource && sourceHash(opts.serverSource) === meta!.src;
    const attested = accepted && (sourceHash(requested) === meta!.src || serverAttested);
    const known = opts.known;
    const knownNonce = known ? readReceipt(known.writerReceipt)?.n : undefined;
    const matchesKnown =
      !!known &&
      !!known.written &&
      stableJson(known.written) === stableJson(writtenIn) &&
      stableJson(known.grounding ?? null) === stableJson(groundingIn ?? null) &&
      (!opts.knownNewestNonce || opts.knownNewestNonce === knownNonce) &&
      (!ctx.newestNonce || ctx.newestNonce === knownNonce);
    if (attested) {
      verified = true;
      source = sourceHash(requested) === meta!.src ? requested : opts.serverSource!;
      receiptKept = receipt;
    } else if (matchesKnown) {
      // The person's own verified version: its own words, as the server stored them.
      verified = true;
      source = { ownWords: known!.ownWords, ownResumeText: known!.ownResumeText, credentialsAnswer: known!.credentialsAnswer, credentialRows: known!.credentialRows };
      receiptKept = known!.writerReceipt;
      writtenOut = known!.written;
      groundingOut = known!.grounding;
    } else {
      // Not attested: the writer's documents and check count for nothing, and
      // own words are only what the server itself holds.
      verified = false;
      source = opts.serverSource ?? { ownWords: "", ownResumeText: "", credentialsAnswer: "", credentialRows: [] };
    }
  }
  const rows = completeCredentialRows(readCredentialRows(source.credentialRows));
  return {
    ok: true,
    input: {
      docKind,
      lengthChoice: isLengthChoice(r.lengthChoice) ? r.lengthChoice : "auto",
      resumeText,
      letterText,
      defendAnswers: stored.defendAnswers.map((a) => ({ ...a, line: a.line.slice(0, 2000), answer: a.answer.slice(0, 4000) })),
      keptTerms: (stored.keptTerms ?? []).map((t) => t.slice(0, 200)),
      confirmedCredentials: stored.confirmedCredentials ?? [],
      evidence: {
        ...(readStoryDraft(r.storyDraft) ? { storyDraft: readStoryDraft(r.storyDraft) } : {}),
        ownWords: str(source.ownWords, MAX_WORDS),
        // Without a matching receipt the writer's documents and check are not
        // known: written counts for nothing (closed by default) and the version
        // carries the receipt open item (gateRevision).
        written: verified ? writtenOut : null,
        grounding: verified ? groundingOut : null,
        withheldLines: stored.docs.withheldLines.slice(0, 100).map((l) => l.slice(0, 1000)),
        keepInsideLines: stored.docs.keepInsideLines,
        recordChoice: recordChoiceFrom(stored.docs.recordChoice, stored.docs.keepInsideLines),
        addedTerms: (stored.addedTerms ?? []).map((t) => t.slice(0, 200)),
        credentialCutRemnants: (stored.credentialCutRemnants ?? []).map((t) => t.slice(0, 2000)),
        credentialsAnswer: str(source.credentialsAnswer, 20_000),
        credentialRows: rows as unknown[],
        ownResumeText: str(source.ownResumeText, MAX_WORDS),
        writerReceipt: verified ? receiptKept : "",
        writerVerified: verified,
        runId: typeof r.runId === "string" ? r.runId.slice(0, 100) : "",
        // Only a stored row keeps the server's given-as-is mark; a request never sets it.
        ...(opts.trusted && typeof r.givenAsIs === "string" && /^[0-9a-f]{64}$/.test(r.givenAsIs) ? { givenAsIs: r.givenAsIs } : {}),
        ...(opts.trusted && r.writerOrigin === true ? { writerOrigin: true } : {}),
      },
    },
  };
}

/** A stored revision back into the gate's input, for re-checking it or editing on top of it. */
export function inputFromRevision(rev: Pick<ArtifactRevision, "doc_kind" | "length_choice" | "resume_text" | "letter_text" | "defend_answers" | "kept_terms" | "confirmed_credentials" | "evidence">): RevisionInput | null {
  const ev = (rev.evidence ?? {}) as Partial<RevisionEvidence>;
  const c = cleanRevisionInput({
    ...ev,
    docKind: rev.doc_kind,
    lengthChoice: rev.length_choice,
    resumeText: rev.resume_text,
    coverLetterText: rev.letter_text,
    defendAnswers: rev.defend_answers,
    keptTerms: rev.kept_terms,
    confirmedCredentials: rev.confirmed_credentials,
  }, { trusted: true });
  return c.ok ? c.input : null;
}

export interface RevisionVerdict {
  status: "draft" | "finished";
  pageCount: number;
  pageLimit: number | null;
  /** Plain words for the DRAFT to-do page. Empty when finished. */
  openItems: string[];
  /** The over-the-limit line, when there is one (also first in openItems). */
  lengthItem: string | null;
  view: FinishView;
}

/** The gate plus the page rule, given a page count. Pure. */
export function gateRevision(input: RevisionInput, pageCount: number): RevisionVerdict {
  const e = input.evidence;
  const view = buildFinishView({
    resumeText: input.resumeText,
    ownWords: e.ownWords,
    defendAnswers: input.defendAnswers,
    coverLetterText: input.letterText,
    written: e.written,
    addedTerms: e.addedTerms,
    keptTerms: input.keptTerms,
    confirmedCredentials: input.confirmedCredentials,
    grounding: e.grounding,
    credentialsAnswer: e.credentialsAnswer || undefined,
    credentialCutRemnants: e.credentialCutRemnants,
    credentialRows: completeCredentialRows(readCredentialRows(e.credentialRows)),
    ownResumeText: e.ownResumeText || undefined,
  });
  const pageLimit = pageLimitFor(input.docKind, input.lengthChoice);
  const fits = lengthOk(pageCount, pageLimit);
  const lengthItem = lengthOpenItem(pageCount, pageLimit, input.lengthChoice);
  const g = e.grounding as { verifierRan?: unknown; verifierRanByDoc?: Record<string, unknown> } | null;
  const checked = (kind: string) => g?.verifierRanByDoc ? g.verifierRanByDoc[kind] === true : g?.verifierRan === true;
  const checksOk = checked("resume") && (!input.letterText.trim() || checked("cover_letter"));
  const receiptOk = e.writerVerified === true && checksOk;
  const status = view.state === "finished" && fits && receiptOk ? "finished" : "draft";
  const openItems =
    status === "finished"
      ? []
      : [...(lengthItem ? [lengthItem] : []), ...(e.writerVerified ? [] : [RECEIPT_OPEN_ITEM]), ...(checksOk ? [] : ["Fix before you send: run the truth check again. Part of this document has not been checked."]), ...openItemsInPlainWords(view)].slice(0, 30).map((s) => s.slice(0, 300));
  // A draft with nothing listed still says why (the to-do page is never empty).
  if (status === "draft" && openItems.length === 0) openItems.push(pageCount < 1 ? "Fix before you send: the page came out empty." : "Fix before you send: answer the open questions on your finish page.");
  return { status, pageCount, pageLimit, openItems, lengthItem, view };
}

/** Measure the pages with the renderer's real layout (the PDF's own), then gate. */
export function computeRevision(input: RevisionInput): RevisionVerdict {
  let pages = 0;
  try {
    pages = fitFor({ text: input.resumeText, kind: "resume" }).pages;
  } catch {
    pages = 0; // could not measure: never finished
  }
  return gateRevision(input, pages);
}

/** Reassess old finished rows without changing history or promoting a draft. */
export function currentRevisionStatus<T extends Pick<ArtifactRevision,
  "status" | "open_items" | "doc_kind" | "length_choice" | "resume_text" | "letter_text" |
  "defend_answers" | "kept_terms" | "confirmed_credentials" | "evidence">>(rev: T): T {
  if (rev.status !== "finished") return rev;
  const input = inputFromRevision(rev);
  const verdict = input ? computeRevision(input) : null;
  if (verdict?.status === "finished") return rev;
  return { ...rev, status: "draft", open_items: verdict?.openItems ?? ["Fix before you send: run the truth check again."] };
}

/** The row to store: the cleaned input plus the server's verdict. */
export function revisionRecord(artifactId: string, source: RevisionSource, input: RevisionInput, v: RevisionVerdict): NewRevision {
  return {
    artifactId,
    source,
    docKind: input.docKind,
    resumeText: input.resumeText,
    letterText: input.letterText,
    keptTerms: input.keptTerms,
    confirmedCredentials: input.confirmedCredentials,
    defendAnswers: input.defendAnswers,
    evidence: input.evidence as unknown as Record<string, unknown>,
    checkerVersion: CHECKER_VERSION,
    status: v.status,
    pageCount: v.pageCount,
    pageLimit: v.pageLimit,
    lengthChoice: input.lengthChoice,
    openItems: v.openItems,
  };
}

/**
 * An edit on top of a saved revision (the Refinery workspace, a Tailor copy,
 * a later change): the new texts with the earlier evidence carried over by the
 * SERVER (trusted: it came from a stored row). With no earlier revision there
 * is no evidence, so the gate finds none of the person's words and the result
 * is a draft. Raw text is never finished.
 *
 * Answers follow their line on a normalized key (review H1): a line whose
 * words are the same, only spacing, punctuation, separators or order moved,
 * keeps the answer the person already gave. A changed line is asked again,
 * and only that line.
 */
export function editInput(base: RevisionInput | null, resumeText: string, letterText?: string, opts: { fork?: boolean } = {}): CleanResult {
  const letter = letterText ?? base?.letterText ?? "";
  return cleanRevisionInput(
    {
      ...(base ? (opts.fork ? forkEvidence(base.evidence) : base.evidence) : {}),
      docKind: base?.docKind ?? "resume",
      lengthChoice: base?.lengthChoice ?? "auto",
      resumeText,
      coverLetterText: letter,
      defendAnswers: remapAnswers(base?.defendAnswers ?? [], [resumeText, letter]),
      keptTerms: base?.keptTerms ?? [],
      confirmedCredentials: base?.confirmedCredentials ?? [],
    },
    { trusted: true }
  );
}

/** A grounding stamped page_only (the same result as source-kind's withRewording(g, "page_only")). */
export function pageOnlyGrounding(grounding: unknown): unknown {
  if (!grounding || typeof grounding !== "object" || Array.isArray(grounding)) return grounding;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { rewordingA: _a, sourceKind: _k, startingPageOnly: _s, ...rest } = grounding as Record<string, unknown>;
  return { ...rest, sourceKind: "page_only" };
}

/**
 * Integration r2 (H1): the evidence a FORK (a Tailor result, or any version
 * built on a base from another artifact) carries. Writer eligibility belongs
 * to the artifact the writer made: the fork keeps the person's own words and
 * the trust it had, but never the parent's origin, given mark or receipt, and
 * its grounding is stamped page_only (the stricter rule).
 */
export function forkEvidence(ev: RevisionEvidence): RevisionEvidence {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { writerOrigin: _o, givenAsIs: _g, ...rest } = ev;
  return { ...rest, writerReceipt: "", grounding: pageOnlyGrounding(ev.grounding) };
}

/** Carried answers moved onto the new text's lines with the same words (lineKey). */
export function remapAnswers(answers: DefendAnswer[], pages: string[]): DefendAnswer[] {
  const lines = pages.flatMap((p) => p.split("\n").map((l) => l.trim()).filter(Boolean));
  const exact = new Set(lines);
  const byKey = new Map<string, string>();
  for (const l of lines) {
    const k = lineKey(l);
    if (k && !byKey.has(k)) byKey.set(k, l);
  }
  // Phase 6 integration (L1): an answer keyed to a job follows that job's header
  // when the header was edited (the header its line now sits under).
  // Integration r2 (M1): only to the SAME job (the same header with only its form
  // moved, or a header the shared resolver reads as the same job). Otherwise the
  // key is dropped and the card is asked again.
  const rejob = (a: DefendAnswer): DefendAnswer => {
    if (typeof a.job !== "string" || !a.job || exact.has(a.job.trim())) return a;
    const same = byKey.get(lineKey(a.job));
    if (same) return { ...a, job: same };
    const now = jobOfLine(pages[0] ?? "", a.line);
    if (now && sameJobHeader(a.job, now)) return { ...a, job: now };
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { job: _dropped, ...rest } = a;
    return rest;
  };
  return answers.map((a) => {
    if (exact.has(a.line.trim())) return rejob(a);
    const moved = byKey.get(lineKey(a.line));
    if (!moved) return a; // the line changed: it is asked again
    // A rewrite record is tied to its exact text; on a moved line it stands as the person's answer.
    if (a.kind === "rewrite") return { line: moved, answer: a.answer, verdict: a.verdict ?? "stands" };
    return rejob({ ...a, line: moved });
  });
}
