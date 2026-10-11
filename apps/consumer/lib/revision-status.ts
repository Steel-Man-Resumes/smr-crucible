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

/** Bump when the gate or the page rule changes in a way that can change a status. */
export const CHECKER_VERSION = "finish-gate-1+pages-1";

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
  ownWords: string;
  written: WrittenDocs | null;
  grounding: unknown;
  withheldLines: string[];
  keepInsideLines: boolean;
  addedTerms: string[];
  credentialCutRemnants: string[];
  credentialsAnswer: string;
  credentialRows: unknown[];
  ownResumeText: string;
}

export type CleanResult = { ok: true; input: RevisionInput } | { ok: false; reason: string };

const str = (v: unknown, max: number): string => (typeof v === "string" ? v.slice(0, max) : "");

/**
 * Clean what a page sent (the finish page's state, or the import's stored
 * finish). Never trusts a status or a "finished" flag: there is no field for one.
 */
export function cleanRevisionInput(raw: unknown): CleanResult {
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
  const docKind = (DOC_KINDS as readonly string[]).includes(r.docKind as string) ? (r.docKind as RevisionDocKind) : "resume";
  const rows = completeCredentialRows(readCredentialRows(r.credentialRows));
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
        ownWords: str(r.ownWords, MAX_WORDS),
        written: stored.docs.written ?? null,
        grounding: stored.docs.grounding ?? null,
        withheldLines: stored.docs.withheldLines.slice(0, 100).map((l) => l.slice(0, 1000)),
        keepInsideLines: stored.docs.keepInsideLines,
        addedTerms: (stored.addedTerms ?? []).map((t) => t.slice(0, 200)),
        credentialCutRemnants: (stored.credentialCutRemnants ?? []).map((t) => t.slice(0, 2000)),
        credentialsAnswer: str(r.credentialsAnswer, 20_000),
        credentialRows: rows as unknown[],
        ownResumeText: str(r.ownResumeText, MAX_WORDS),
      },
    },
  };
}

/** A stored revision back into the gate's input, for re-checking it or editing on top of it. */
export function inputFromRevision(rev: Pick<ArtifactRevision, "doc_kind" | "length_choice" | "resume_text" | "letter_text" | "defend_answers" | "kept_terms" | "confirmed_credentials" | "evidence">): RevisionInput | null {
  const ev = (rev.evidence ?? {}) as Partial<RevisionEvidence>;
  const c = cleanRevisionInput({
    docKind: rev.doc_kind,
    lengthChoice: rev.length_choice,
    resumeText: rev.resume_text,
    coverLetterText: rev.letter_text,
    defendAnswers: rev.defend_answers,
    keptTerms: rev.kept_terms,
    confirmedCredentials: rev.confirmed_credentials,
    ...ev,
  });
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
  const status = view.state === "finished" && fits ? "finished" : "draft";
  const openItems = status === "finished" ? [] : [...(lengthItem ? [lengthItem] : []), ...openItemsInPlainWords(view)].slice(0, 30).map((s) => s.slice(0, 300));
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
 * An edit on top of a saved revision (the Refinery workspace, a later change):
 * the new texts with the earlier evidence carried over by the SERVER. With no
 * earlier revision there is no evidence, so the gate finds none of the
 * person's words and the result is a draft. Raw text is never finished.
 */
export function editInput(base: RevisionInput | null, resumeText: string, letterText?: string): CleanResult {
  return cleanRevisionInput({
    docKind: base?.docKind ?? "resume",
    lengthChoice: base?.lengthChoice ?? "auto",
    resumeText,
    coverLetterText: letterText ?? base?.letterText ?? "",
    defendAnswers: base?.defendAnswers ?? [],
    keptTerms: base?.keptTerms ?? [],
    confirmedCredentials: base?.confirmedCredentials ?? [],
    ...(base?.evidence ?? {}),
  });
}
