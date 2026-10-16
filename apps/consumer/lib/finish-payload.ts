/**
 * The finish page's whole state, as the server's gate reads it (Phase 5 lane
 * R1). ONE builder, used by the finish page (its saves and its signed-out
 * downloads) and by the import on sign-in (lib/forge-import.ts), so the same
 * run always produces the same payload and the same saved version.
 *
 * Pure and client-safe. It carries evidence, never a status: the server
 * decides draft or finished (lib/revision-status.ts).
 */

import { readStoryDraft, type StoryDraft } from "./story-verification";
import { keepSourceRecordLines, recordChoiceFrom, type RecordChoice } from "./record-choice";
import { CREDENTIALS_KEY } from "./forge-path";
import { finishKey, ownWordsFor, readStoredFinish, FINISH_STATE_VERSION, type StoredFinish } from "./finish-gate";
import { completeCredentialRows, readCredentialRows } from "./credential-rows";
import { withholdRecordLines } from "./record-lines";
import { isLengthChoice, type LengthChoice } from "./length-rule";

export interface FinishPayload {
  laneId?: string | null;
  storyDraft?: StoryDraft;
  resumeText: string;
  coverLetterText: string;
  defendAnswers: unknown[];
  addedTerms: string[];
  keptTerms: string[];
  confirmedCredentials: unknown[];
  credentialCutRemnants: string[];
  written: unknown;
  grounding: unknown;
  withheldLines: string[];
  keepInsideLines: boolean;
  recordChoice?: RecordChoice;
  ownWords: string;
  credentialsAnswer: string;
  credentialRows: unknown[];
  ownResumeText: string;
  lengthChoice: LengthChoice;
  /** The server's receipt over written + grounding, as generate-docs gave it. */
  writerReceipt: string;
  /** The run (the Forge session's startedAt): what a signed-out receipt is bound to. */
  runId: string;
}

/** The run fields the evidence comes from. */
export interface RunForPayload {
  forgeLaneId?: string | null;
  resumeText?: string;
  originalResumeText?: string;
  goalNarrative?: string;
  hookNarrative?: string;
  challengeNarratives?: Record<string, string>;
  credentialRows?: unknown;
  forgeOutput?: unknown;
  startedAt?: string;
}

/**
 * The person's own words and the other run-side evidence, exactly as a saved
 * revision holds them. A finish page restored from the account uses these
 * instead of rebuilding them from the run it loaded, so the restored page is
 * the same version (same payload, same saved revision).
 */
export interface RunEvidence {
  ownWords: string;
  credentialsAnswer: string;
  credentialRows: unknown[];
  ownResumeText: string;
}

export function readRunEvidence(raw: unknown): RunEvidence | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.ownWords !== "string") return null;
  return {
    ownWords: r.ownWords,
    credentialsAnswer: typeof r.credentialsAnswer === "string" ? r.credentialsAnswer : "",
    credentialRows: Array.isArray(r.credentialRows) ? r.credentialRows : [],
    ownResumeText: typeof r.ownResumeText === "string" ? r.ownResumeText : "",
  };
}

/** Build the payload from the finish page's current state and its run. */
export function finishPayload(
  run: RunForPayload,
  state: {
    resumeText: string;
    coverLetterText: string;
    defendAnswers: unknown[];
    addedTerms?: string[];
    keptTerms?: string[];
    confirmedCredentials?: unknown[];
    credentialCutRemnants?: string[];
    written?: unknown;
    grounding?: unknown;
    withheldLines?: string[];
    keepInsideLines: boolean;
    recordChoice?: RecordChoice;
    lengthChoice?: LengthChoice;
    receipt?: string;
  },
  evidence?: RunEvidence | null
): FinishPayload {
  const choice = recordChoiceFrom(state.recordChoice, state.keepInsideLines);
  const keep = choice === "facility";
  const fromRun = {
    ownWords: ownWordsFor(run, keep, choice),
    credentialsAnswer: run.challengeNarratives?.[CREDENTIALS_KEY] ?? "",
    credentialRows: completeCredentialRows(readCredentialRows(run.credentialRows)) as unknown[],
    // The resume text the writer received (review r3 L-2), as generate-docs derives it.
    ownResumeText: withholdRecordLines(run.resumeText, keepSourceRecordLines(choice)).kept,
  };
  const ev = evidence ?? fromRun;
  return {
    ...(run.forgeLaneId !== undefined ? { laneId: run.forgeLaneId } : {}),
    ...(readStoryDraft(run.forgeOutput) ? { storyDraft: readStoryDraft(run.forgeOutput) } : {}),
    resumeText: state.resumeText,
    coverLetterText: state.coverLetterText,
    defendAnswers: state.defendAnswers,
    addedTerms: state.addedTerms ?? [],
    keptTerms: state.keptTerms ?? [],
    confirmedCredentials: state.confirmedCredentials ?? [],
    credentialCutRemnants: state.credentialCutRemnants ?? [],
    written: state.written ?? null,
    grounding: state.grounding ?? null,
    withheldLines: state.withheldLines ?? [],
    keepInsideLines: keep,
    recordChoice: choice,
    ownWords: ev.ownWords,
    credentialsAnswer: ev.credentialsAnswer,
    credentialRows: ev.credentialRows,
    ownResumeText: ev.ownResumeText,
    lengthChoice: state.lengthChoice && isLengthChoice(state.lengthChoice) ? state.lengthChoice : "auto",
    writerReceipt: typeof state.receipt === "string" ? state.receipt : "",
    runId: typeof run.startedAt === "string" ? run.startedAt : "",
  };
}

/** The finish page's stored copy in a run, only when it belongs to that run (finishKey). */
export function storedFinishOf(run: RunForPayload & { forgeFinish?: unknown }): (Omit<StoredFinish, "lengthChoice" | "evidence"> & { lengthChoice?: LengthChoice; evidence?: RunEvidence }) | null {
  const raw = run.forgeFinish as { docs?: { keepInsideLines?: boolean; recordChoice?: unknown }; lengthChoice?: unknown; evidence?: unknown } | undefined;
  if (!raw) return null;
  const keep = raw.docs?.keepInsideLines === true;
  const stored = readStoredFinish(raw, finishKey(run as { forgeOutput?: unknown; resumeText?: string }, keep, recordChoiceFrom(raw.docs?.recordChoice, keep)));
  if (!stored) return null;
  const evidence = readRunEvidence(raw.evidence);
  const { lengthChoice: _l, evidence: _e, ...rest } = stored;
  void _l;
  void _e;
  return { ...rest, ...(isLengthChoice(raw.lengthChoice) ? { lengthChoice: raw.lengthChoice } : {}), ...(evidence ? { evidence } : {}) };
}

/**
 * A saved revision (from the account) as the finish page's stored copy for
 * this run: the same text, letter, answers and confirmations, and the
 * revision's own evidence, so the restored page is that exact version.
 */
export function storedFinishFromRevision(
  rev: { id: string; resumeText: string; letterText: string; defendAnswers: unknown; keptTerms: unknown; confirmedCredentials: unknown; evidence: unknown; lengthChoice?: unknown },
  run: RunForPayload
): Record<string, unknown> {
  const ev = (rev.evidence && typeof rev.evidence === "object" ? rev.evidence : {}) as Record<string, unknown>;
  const choice = recordChoiceFrom(ev.recordChoice, ev.keepInsideLines);
  const keep = choice === "facility";
  return {
    v: FINISH_STATE_VERSION,
    key: finishKey(run as { forgeOutput?: unknown; resumeText?: string }, keep, choice),
    docs: {
      resumeText: rev.resumeText,
      coverLetterText: rev.letterText,
      withheldLines: Array.isArray(ev.withheldLines) ? ev.withheldLines : [],
      keepInsideLines: keep,
      recordChoice: choice,
      grounding: ev.grounding ?? null,
      ...(ev.written ? { written: ev.written } : {}),
      ...(typeof ev.writerReceipt === "string" && ev.writerReceipt ? { receipt: ev.writerReceipt } : {}),
    },
    defendAnswers: Array.isArray(rev.defendAnswers) ? rev.defendAnswers : [],
    addedTerms: Array.isArray(ev.addedTerms) ? ev.addedTerms : [],
    keptTerms: Array.isArray(rev.keptTerms) ? rev.keptTerms : [],
    confirmedCredentials: Array.isArray(rev.confirmedCredentials) ? rev.confirmedCredentials : [],
    credentialCutRemnants: Array.isArray(ev.credentialCutRemnants) ? ev.credentialCutRemnants : [],
    ...(isLengthChoice(rev.lengthChoice) ? { lengthChoice: rev.lengthChoice } : {}),
    evidence: {
      ownWords: typeof ev.ownWords === "string" ? ev.ownWords : "",
      credentialsAnswer: typeof ev.credentialsAnswer === "string" ? ev.credentialsAnswer : "",
      credentialRows: Array.isArray(ev.credentialRows) ? ev.credentialRows : [],
      ownResumeText: typeof ev.ownResumeText === "string" ? ev.ownResumeText : "",
    },
    revisionId: rev.id,
  };
}

/** The payload for a run's stored finish, or null when there is none for this run. */
export function finishPayloadFromRun(run: RunForPayload & { forgeFinish?: unknown }): FinishPayload | null {
  const s = storedFinishOf(run);
  if (!s || !s.docs.resumeText.trim()) return null;
  return finishPayload(run, {
    resumeText: s.docs.resumeText,
    coverLetterText: s.docs.coverLetterText,
    defendAnswers: s.defendAnswers,
    addedTerms: s.addedTerms,
    keptTerms: s.keptTerms,
    confirmedCredentials: s.confirmedCredentials,
    credentialCutRemnants: s.credentialCutRemnants,
    written: s.docs.written,
    grounding: s.docs.grounding,
    withheldLines: s.docs.withheldLines,
    keepInsideLines: s.docs.keepInsideLines,
    recordChoice: recordChoiceFrom(s.docs.recordChoice, s.docs.keepInsideLines),
    lengthChoice: s.lengthChoice,
    receipt: s.docs.receipt,
  }, s.evidence ?? null);
}

/** Small stable fingerprint of a payload (FNV-1a), to tell one saved finish from the next. */
export function payloadMark(p: FinishPayload | null): string {
  if (!p) return "";
  const s = JSON.stringify(p);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36) + ":" + s.length.toString(36);
}
