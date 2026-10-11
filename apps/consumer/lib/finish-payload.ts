/**
 * The finish page's whole state, as the server's gate reads it (Phase 5 lane
 * R1). ONE builder, used by the finish page (its saves and its signed-out
 * downloads) and by the import on sign-in (lib/forge-import.ts), so the same
 * run always produces the same payload and the same saved version.
 *
 * Pure and client-safe. It carries evidence, never a status: the server
 * decides draft or finished (lib/revision-status.ts).
 */

import { CREDENTIALS_KEY } from "./forge-path";
import { finishKey, ownWordsFor, readStoredFinish, type StoredFinish } from "./finish-gate";
import { completeCredentialRows, readCredentialRows } from "./credential-rows";
import { withholdRecordLines } from "./record-lines";
import { isLengthChoice, type LengthChoice } from "./length-rule";

export interface FinishPayload {
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
  ownWords: string;
  credentialsAnswer: string;
  credentialRows: unknown[];
  ownResumeText: string;
  lengthChoice: LengthChoice;
  docKind: "resume";
}

/** The run fields the evidence comes from. */
export interface RunForPayload {
  resumeText?: string;
  originalResumeText?: string;
  goalNarrative?: string;
  hookNarrative?: string;
  challengeNarratives?: Record<string, string>;
  credentialRows?: unknown;
  forgeOutput?: unknown;
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
    lengthChoice?: LengthChoice;
  }
): FinishPayload {
  const keep = state.keepInsideLines === true;
  return {
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
    ownWords: ownWordsFor(run, keep),
    credentialsAnswer: run.challengeNarratives?.[CREDENTIALS_KEY] ?? "",
    credentialRows: completeCredentialRows(readCredentialRows(run.credentialRows)) as unknown[],
    ownResumeText: withholdRecordLines(run.originalResumeText ?? run.resumeText, keep).kept,
    lengthChoice: state.lengthChoice && isLengthChoice(state.lengthChoice) ? state.lengthChoice : "auto",
    docKind: "resume",
  };
}

/** The finish page's stored copy in a run, only when it belongs to that run (finishKey). */
export function storedFinishOf(run: RunForPayload & { forgeFinish?: unknown }): (StoredFinish & { lengthChoice?: LengthChoice }) | null {
  const raw = run.forgeFinish as { docs?: { keepInsideLines?: boolean }; lengthChoice?: unknown } | undefined;
  if (!raw) return null;
  const keep = raw.docs?.keepInsideLines === true;
  const stored = readStoredFinish(raw, finishKey(run as { forgeOutput?: unknown; resumeText?: string }, keep));
  if (!stored) return null;
  return { ...stored, ...(isLengthChoice(raw.lengthChoice) ? { lengthChoice: raw.lengthChoice } : {}) };
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
    lengthChoice: s.lengthChoice,
  });
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
