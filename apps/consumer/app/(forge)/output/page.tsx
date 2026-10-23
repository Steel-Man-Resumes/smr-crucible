"use client";

/**
 * The Forge finish page.
 *
 * The new resume comes first, with t.ROY's one status line and a short tour.
 * Beside it (under it on a phone) are the lines only the person can answer:
 * true as written, change it, or cut it. The engine (getResumeStatus, via
 * lib/finish-gate) decides draft or finished; this page never does.
 *
 * Finished: confetti, the finished download, the email box, and after a
 * finished download the review ask. Draft: the main button says what's left,
 * and a draft can always be downloaded, marked DRAFT with its open items.
 *
 * Below: one main action, the checks (collapsed, one line each), the cover
 * letter, the person's story (the narrative reconstruction) and the next step.
 *
 * ONE VERSION, EVERYWHERE (Phase 5 lane R1). Signed in, every change saves a
 * revision on the server (/api/revisions), and the server's status for that
 * revision is the page's status: the gate with all the evidence plus the
 * page count (D8). "Saved to your account" shows only after the save answers,
 * with Try again when it fails. Every download, the print and the email use
 * that revision's id. Signed out, the work stays in this browser and each
 * download sends the whole state, and the server decides from it.
 *
 * LANES FIRST (Phase 5 lane R2). A run that started from "What do you need
 * today?" gets one next action chosen by its route, PDF as the main
 * download (the other formats under "More formats"), and the cover letter
 * only on the job route (offered, never forced, on the others). The cards
 * and every finish-gate rule are the same.
 *
 * CHECK AND FINISH (?check=<artifactId>, R2). A resume that was never
 * finished in the Forge (a Tailor result, an older saved resume) opens here
 * with the same cards. The person's own words come from the server, never
 * from this page (lib/revision-check.ts), and the save is a revision of that
 * same resume. Phase 6 (plan Q1): the main action is "Rewrite it with t.ROY"
 * (the writer, with this resume as its source); "Check it as it is" opens
 * the cards.
 *
 * ONE TAP PER JOB (Phase 6, plan Q3). Where the writer's second check ran,
 * a reworded line whose facts trace back raises no card (rewording A); each
 * job asks "Looks right" or "Fix this"; numbers are an optional "add a
 * number?" that never stops the finish (lib/finish-gate.ts).
 */

import { TroyMark } from "@crucible/consumer-ui";
import { RecordChoiceCard } from "@/components/forge/finish/RecordChoiceCard";
import { ConfidenceMeter } from "@/components/forge/finish/ConfidenceMeter";
import { sourceConfidence, confidenceLines } from "@/lib/finish-gate";
import { keepSourceRecordLines, recordChoiceFrom, type RecordChoice, type RecordEntry } from "@/lib/record-choice";
import React, { Suspense, useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { CREDENTIALS_KEY, isLanesFirst } from "@/lib/forge-path";
import { LaneDownloadBox, LaneNextAction } from "@/components/forge/finish/LaneFinish";
import { CARDS_PARAM, CHECK_AS_IS_LABEL, REWRITE_WITH_TROY_LABEL, nextActionFor, rebuildActive, rebuildHref } from "@/lib/lane-task";
import { useForgeSession } from "@/lib/forge-context";
import { CompletionConfetti } from "@/components/CompletionConfetti";
import { DiscrepancyPanel } from "@/components/resume/DiscrepancyPanel";
import { MintCheckPanel } from "@/components/resume/MintCheckPanel";
import { AtsScorePanel } from "@/components/resume/AtsScorePanel";
import { ResumePage } from "@/components/resume/ResumePage";
import { PageFitLine } from "@/components/resume/PageFitLine";
import { downloadPackage, downloadResume, type DownloadFormat } from "@/lib/resume-download";
import { findDiscrepancies } from "@/lib/resume-discrepancies";
import {
  buildFinishView,
  canEmailPackage,
  applyRewrite,
  applyAssistedRewrite,
  applyScopeHelped,
  titleYesResult,
  isRejectedSchool,
  isFacilitySchool,
  ownTitleProblem,
  recordTitleYes,
  applyOwnTitle,
  recordScopeYes,
  scopeYesResult,
  cutScopeSentences,
  countWord,
  cutLine,
  cutTerm,
  downloadMode,
  finishKey,
  FINISH_STATE_VERSION,
  openItemsInPlainWords,
  ownWordsFor,
  readStoredFinish,
  recordAnswer,
  REVIEW_ASK_SHOWN_KEY,
  shouldCelebrate,
  shouldShowReviewAsk,
  statusLine,
  TOUR_SEEN_KEY,
  type DefendAnswer,
  type LineGroup,
  type WrittenDocs,
  type CredentialConfirm,
  applyConfirmation,
  isConfirmWhen,
  cutCredentialEverywhere,
  optionalNumberPrompts,
  recordJobOk,
} from "@/lib/finish-gate";
import { SAMPLE_POSTING_LABEL, pickSamplePostings } from "@/lib/sample-postings";
import { finishPayload, payloadMark, readRunEvidence, type RunEvidence } from "@/lib/finish-payload";
import { isLengthChoice, lengthOk, pageLimitFor, type LengthChoice } from "@/lib/length-rule";
import { LengthCard, cuttableLines } from "@/components/forge/finish/LengthCard";
import { printFromServer } from "@/components/resume/resumePrint";
import type { SavedRevisionSummary } from "@/lib/revision-save";
import { RECHECK_LINE, needsRecheck } from "@/lib/recheck-copy";
import { withholdRecordLines } from "@/lib/record-lines";
import { completeCredentialRows, readCredentialRows } from "@/lib/credential-rows";
import { storyIsChecked } from "@/lib/story-verification";
import { DefendPanel, fetchSuggestion, type BulkPick, type CardActions } from "@/components/forge/finish/DefendPanel";
import { settleFinishPage, type SettleNote } from "@/lib/auto-settle";
import { DownloadBox } from "@/components/forge/finish/DownloadBox";
import { EmailPackageBox } from "@/components/forge/finish/EmailPackageBox";
import { FinishedEmailLine } from "@/components/forge/finish/FinishedEmailLine";
import { useSession } from "next-auth/react";
import { sessionPending } from "@/lib/session-policy";
import { CheckSection } from "@/components/forge/finish/CheckSection";
import { FinishTour, type TourStep } from "@/components/forge/finish/FinishTour";
import { GroundingNote, groundingOpenCount, readGrounding } from "@/components/forge/finish/GroundingNote";
import { NextStep, ReviewAsk } from "@/components/forge/finish/NextStep";
import { StorySection, type ForgeOutput } from "@/components/forge/finish/StorySection";
import { pageLines } from "@/lib/showstopper-tour";
import { readChanges, type MarkupChange } from "@/lib/markup-changes";
import { changesStillOnPage } from "@/lib/changes-gate";
import { useReducedMotion } from "@/components/forge/showstopper/useReducedMotion";
import { WorkFocus } from "@/components/forge/WorkFocus";
import { FocusDialog } from "@/components/forge/FocusDialog";
import { verifierCheckedDocument } from "@/lib/finish-gate";
import { readDocumentResponse } from "@/lib/document-response";
import { ReviewSteps } from "@/components/forge/markup/ReviewSteps";
import { LiveFix } from "@/components/forge/markup/LiveFix";
import { ChangesList } from "@/components/forge/markup/ChangesList";

type DocGenState = "idle" | "generating" | "done" | "error";

/** Readiness-aware messaging for the output page */
const READINESS_CONFIG: Record<string, {
  refineryCta: string;
  refinerySubtext: string;
  careersHeading: string;
  strengthsHeading: string;
}> = {
  precontemplation: {
    refineryCta: "Save My Results",
    refinerySubtext: "Free. No credit card. Come back anytime.",
    careersHeading: "Paths Worth Knowing About",
    strengthsHeading: "What You Bring",
  },
  contemplation: {
    refineryCta: "Save & Explore The Refinery",
    refinerySubtext: "Free. No credit card. No catch.",
    careersHeading: "Career Paths to Consider",
    strengthsHeading: "Your Strengths",
  },
  preparation: {
    refineryCta: "Continue to The Refinery",
    refinerySubtext: "Free. No credit card. Your story carries over.",
    careersHeading: "Career Paths That Fit",
    strengthsHeading: "Your Strengths",
  },
  action: {
    refineryCta: "Start Using The Refinery",
    refinerySubtext: "Free. No credit card. Built for exactly where you are right now.",
    careersHeading: "Career Paths That Fit",
    strengthsHeading: "Your Competitive Advantages",
  },
};

const thingWord = (n: number) => `${countWord(n).toLowerCase()} ${n === 1 ? "thing" : "things"}`;

export default function OutputPage() {
  return (
    <Suspense>
      <OutputPageInner />
    </Suspense>
  );
}

function OutputPageInner() {
  const router = useRouter();
  const { session, updateSession, runIsMine } = useForgeSession();
  // Check and finish (R2): a saved resume opened here by id.
  const searchParams = useSearchParams();
  const checkId = searchParams.get("check");
  const checkMode = !!checkId;
  const checkModeRef = useRef(checkMode);
  checkModeRef.current = checkMode;
  // Lanes first (R2): the route decides the next action and the letter.
  const lanes = !checkMode && isLanesFirst(session);
  const offerLetterOnly = lanes && session.laneTask !== "job";
  const offerLetterOnlyRef = useRef(offerLetterOnly);
  offerLetterOnlyRef.current = offerLetterOnly;
  const [parkedLetter, setParkedLetter] = useState<string>(session.laneParkedLetter ?? "");
  const [checkTitle, setCheckTitle] = useState("");
  // Phase 6 (Q1): in check mode the person picks the writer (main) or the cards as it is.
  // A draft the writer already made opens straight on its cards (lane home, CARDS_PARAM).
  const [checkAsIs, setCheckAsIs] = useState(() => searchParams.get(CARDS_PARAM) === "1");
  const checkChoosing = checkMode && !checkAsIs;
  const [openError, setOpenError] = useState("");
  // Signed in (fully): a finished package is emailed to the account's own
  // proven address by itself (lib/email-package-auto.ts). Signed out (the
  // Forge before the wall): the person types an address, as before.
  const { data: authData, status: authStatus } = useSession();
  const signedIn = authStatus === "authenticated" && !!authData?.user && !sessionPending(authData.user as any);
  const isDemo = session.isDemo === true;
  const audience = session.audience || "client";
  const output = (session.forgeOutput as ForgeOutput) || {};
  const [storyRetrying, setStoryRetrying] = useState(false);
  const [storyRetryError, setStoryRetryError] = useState("");
  async function retryStory() {
    if (!runIsMine()) return;
    setStoryRetrying(true);
    setStoryRetryError("");
    try {
      const response = await fetch("/api/forge/story-check", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ story: output, resumeText: session.resumeText, userText: [session.goalNarrative, session.hookNarrative, session.criminalRecord?.context, ...Object.values(session.challengeNarratives || {})] }) });
      if (!response.ok) throw new Error("Story check could not complete. Try again.");
      const next = await response.json();
      if (!runIsMine()) return;
      updateSession({ forgeOutput: next, ...(session.forgeFinish ? { forgeFinish: { ...session.forgeFinish, key: finishKey({ ...session, forgeOutput: next }, keepInsideLines, recordChoice) } } : {}) });
    } catch { setStoryRetryError("Story check could not complete. Your saved work is still here."); }
    finally { setStoryRetrying(false); }
  }

  const readiness = output.readiness_stage || session.readinessStage || "preparation";
  const rc = READINESS_CONFIG[readiness] || READINESS_CONFIG.preparation;
  const narrative = output.narrative || {};
  const careerPaths = output.career_paths || [];
  // Report sentences that may say more about a credential than the person did.
  const reportChecks: string[] = Array.isArray((output as { credential_checks?: unknown })?.credential_checks)
    ? ((output as { credential_checks: unknown[] }).credential_checks.filter((c) => typeof c === "string") as string[])
    : [];

  // Prevent double-submission on mount
  const hasStarted = useRef(false);
  const hydrated = useRef(false);

  const [docState, setDocState] = useState<DocGenState>("idle");
  // The story check retries by itself, twice, before any note is shown.
  const storyAuto = useRef(0);
  const [storyAutoTick, setStoryAutoTick] = useState(0);
  const storyUnchecked = !storyIsChecked(output);
  useEffect(() => {
    if (!storyUnchecked || storyAuto.current >= 2 || storyRetrying || !signedIn || checkMode || isDemo || docState !== "done") return;
    const t = setTimeout(() => {
      storyAuto.current += 1;
      void retryStory().finally(() => setStoryAutoTick((n) => n + 1));
    }, 1500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storyUnchecked, storyAutoTick, storyRetrying, signedIn, docState]);

  const [resumeText, setResumeText] = useState<string>("");
  // Phase 6 live markup (S3): the writer's verified changes to the person's
  // own lines, and whether they are playing on screen right now.
  const [changes, setChanges] = useState<MarkupChange[]>([]);
  const [revealing, setRevealing] = useState(false);
  // Troy 2026-10-20: a record choice rewrites quietly. No replay of the animation, just a short status.
  const [quiet, setQuiet] = useState(false);
  const quietRef = useRef(false);
  quietRef.current = quiet;
  const reduced = useReducedMotion();
  const reducedRef = useRef(reduced);
  reducedRef.current = reduced;
  // The page the writer was given (the changes' old lines come from it).
  // A page typed in the builder is not a "before", so it gets no walk.
  // Phase 6 integration (M2): in a rebuild that is the saved page the writer
  // started from (the same page the processing tour walked), never the run's
  // older resume text. It is a starting page, not the person's own words.
  const rebuilding = !!rebuildActive(session);
  const startingPage = rebuilding ? session.originalResumeText ?? "" : session.resumeText ?? "";
  const liveFixLines = useMemo(() => pageLines(startingPage), [startingPage]);
  // Lines about time inside that the writer held back (never silently), and
  // whether the person chose to put them back as written.
  const [withheldLines, setWithheldLines] = useState<string[]>([]);
  // DEC-51: how inside work shows on the page (lib/record-choice.ts). "facility" is the old keepInsideLines.
  const [recordChoice, setRecordChoice] = useState<RecordChoice>("off");
  const keepInsideLines = recordChoice === "facility";
  const [recordEntries, setRecordEntries] = useState<RecordEntry[]>([]);
  // Numbers t.ROY asked about that the person skipped (confidence meter).
  const [skippedNumbers, setSkippedNumbers] = useState<string[]>([]);
  const [coverLetterText, setCoverLetterText] = useState<string>("");
  const [grounding, setGrounding] = useState<unknown>(null);
  // The writer's documents exactly as delivered; never edited (see finish-gate WrittenDocs).
  const [written, setWritten] = useState<WrittenDocs | null>(null);
  // The server's receipt over the writer's documents and their check (review M1).
  const [receipt, setReceipt] = useState<string>("");
  const [defendAnswers, setDefendAnswers] = useState<DefendAnswer[]>([]);
  // Skill terms the person added from a job posting; each is asked about.
  const [addedTerms, setAddedTerms] = useState<string[]>([]);
  // Skills kept on the "added for you" card (D3), credentials confirmed in the person's own words (D4).
  const [keptTerms, setKeptTerms] = useState<string[]>([]);
  const [confirmedCredentials, setConfirmedCredentials] = useState<CredentialConfirm[]>([]);
  // What "No, take it off" left of longer sentences: held until reworded or cut.
  const [credentialCutRemnants, setCredentialCutRemnants] = useState<string[]>([]);
  const [docError, setDocError] = useState<string>("");
  const [writerLimitReached, setWriterLimitReached] = useState(false);
  const [busy, setBusy] = useState(false);
  const [downloadError, setDownloadError] = useState("");
  const [copied, setCopied] = useState("");
  // D8: the person may choose one page. Measured pages come from the renderer.
  const [lengthChoice, setLengthChoice] = useState<LengthChoice>("auto");
  const [pages, setPages] = useState<number | null>(null);
  // Restored from the account: the saved revision's own evidence (its own words).
  const [runEvidence, setRunEvidence] = useState<RunEvidence | null>(null);
  // The server's saved revision for the current state, and the save's state.
  const [saved, setSaved] = useState<(SavedRevisionSummary & { mark: string }) | null>(null);
  // The state whose save last failed (its mark), so a failure is shown only for the state on screen.
  const [failedMark, setFailedMark] = useState<string | null>(null);
  // A save the server refused for size (review L8): said plainly, never retried.
  const [tooLarge, setTooLarge] = useState<{ mark: string; message: string } | null>(null);

  // Back on this page in the same run: show the same documents and answers
  // instead of writing new ones (a new AI call, and the answers would no
  // longer match the lines).
  useEffect(() => {
    if (checkModeRef.current) return;
    if (hydrated.current || !session.forgeOutput) return;
    hydrated.current = true;
    const raw = session.forgeFinish as { docs?: { keepInsideLines?: boolean; recordChoice?: unknown }; lengthChoice?: unknown; evidence?: unknown } | undefined;
    const keep = raw?.docs?.keepInsideLines === true;
    const stored = readStoredFinish(raw, finishKey(session, keep, recordChoiceFrom(raw?.docs?.recordChoice, keep)));
    if (!stored) return;
    hasStarted.current = true;
    if (isLengthChoice(raw?.lengthChoice)) setLengthChoice(raw!.lengthChoice as LengthChoice);
    setRunEvidence(readRunEvidence(raw?.evidence));
    setResumeText(stored.docs.resumeText);
    setCoverLetterText(stored.docs.coverLetterText);
    setWithheldLines(stored.docs.withheldLines);
    setRecordChoice(recordChoiceFrom(stored.docs.recordChoice, stored.docs.keepInsideLines));
    setGrounding(stored.docs.grounding);
    setWritten(stored.docs.written ?? null);
    setReceipt(stored.docs.receipt ?? "");
    setDefendAnswers(stored.defendAnswers);
    setAddedTerms(stored.addedTerms ?? []);
    setKeptTerms(stored.keptTerms ?? []);
    setConfirmedCredentials(stored.confirmedCredentials ?? []);
    setCredentialCutRemnants(stored.credentialCutRemnants ?? []);
    setDocState("done");
  }, [session]);

  // Keep the documents and answers with the run (browser only). Not in
  // check mode: that resume lives in the account, not in this run.
  useEffect(() => {
    if (checkModeRef.current) return;
    if (docState !== "done" || !resumeText) return;
    updateSession({
      forgeFinish: {
        v: FINISH_STATE_VERSION,
        key: finishKey(session, keepInsideLines, recordChoice),
        docs: { resumeText, coverLetterText, withheldLines, keepInsideLines, recordChoice, grounding, written: written ?? undefined, ...(receipt ? { receipt } : {}) },
        defendAnswers,
        addedTerms,
        keptTerms,
        confirmedCredentials,
        credentialCutRemnants,
        lengthChoice,
        ...(runEvidence ? { evidence: runEvidence } : {}),
      },
    });
    // session is read for its key fields only; writing must not loop on it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docState, resumeText, coverLetterText, withheldLines, keepInsideLines, recordChoice, grounding, written, receipt, defendAnswers, addedTerms, keptTerms, confirmedCredentials, credentialCutRemnants, lengthChoice, runEvidence, updateSession]);

  const runIsMineRef = useRef(runIsMine);
  runIsMineRef.current = runIsMine;
  const [writeProgress, setWriteProgress] = useState("");
  const generateDocs = useCallback(async () => {
    if (hasStarted.current || checkModeRef.current) return;
    // Every caller, not only the effect below: never another person's run.
    // Through a ref, so this memoized callback asks with the current sign-in.
    if (!runIsMineRef.current()) return;
    if (docState === "generating" || docState === "done") return;
    hasStarted.current = true;
    setDocState("generating");
    setDocError("");
    setWriterLimitReached(false);
    setGrounding(null);
    setChanges([]);
    setRevealing(false);

    let limited = false;
    try {
      const response = await fetch("/api/forge/generate-docs", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/x-ndjson" },
        body: JSON.stringify({
          narrative: output.narrative,
          strengths: output.strengths,
          skills: output.skills,
          career_paths: output.career_paths,
          barriers: output.barriers,
          resumeText: session.resumeText,
          // Phase 6 (S1 round 2): a build from a saved resume. The server reads
          // it and decides the own words itself; only the id is sent.
          rebuildFrom: rebuildActive(session) ?? undefined,
          goals: session.goals,
          goalNarrative: session.goalNarrative,
          credentialsNote: session.challengeNarratives?.[CREDENTIALS_KEY],
          // For the writer's receipt only (review H2): the server works out the
          // person's own words from these, as this page does, and signs them.
          hookNarrative: session.hookNarrative,
          credentialRows: session.credentialRows,
          runId: session.startedAt,
          preferences: session.preferences,
          readinessStage: session.readinessStage,
          resumeConfidence: session.resumeConfidence,
          resumeWorries: session.resumeWorries,
          keepInsideLines,
          recordChoice,
        }),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        if (response.status === 429) {
          limited = true;
          setWriterLimitReached(true);
          throw new Error(typeof data.error === "string" ? data.error : "Today's writing limit has been reached. Your work is still here. Try again after the daily limit resets.");
        }
        throw new Error(data.error || "Document generation failed");
      }

      let progressed = false;
      const data = await readDocumentResponse(response, (event) => {
        if (typeof event.message === "string") setWriteProgress(event.message);
        if (event.type !== "resume" || typeof event.resume !== "string") return;
        const checked = readChanges(event.changes, rebuildActive(session) ? session.originalResumeText ?? "" : session.resumeText ?? "", event.resume);
        setChanges(checked);
        setRevealing(checked.length > 0 && !quietRef.current);
        progressed = checked.length > 0;
      });
      setResumeText(data.resume || "");
      // Only changes whose old line is the person's and whose new line is in
      // this finished resume. None (older server, nothing changed) = no reveal.
      // M2: checked against the page the writer started from (the server checked the same).
      const verified = readChanges(data.changes, rebuildActive(session) ? session.originalResumeText ?? "" : session.resumeText ?? "", data.resume || "");
      setChanges(verified);
      if (!progressed) setRevealing(verified.length > 0 && reducedRef.current === false && !quietRef.current);
      // Lanes first (R2): the letter is the job route's. On the other routes it
      // waits behind "Add a cover letter" (written once, never forced on).
      if (offerLetterOnlyRef.current) {
        setParkedLetter(data.coverLetter || "");
        updateSession({ laneParkedLetter: data.coverLetter || "" });
        setCoverLetterText("");
      } else {
        setCoverLetterText(data.coverLetter || "");
      }
      setWithheldLines(Array.isArray(data.withheldLines) ? data.withheldLines.filter((l: unknown) => typeof l === "string") : []);
      setRecordEntries(Array.isArray(data.recordEntries) ? (data.recordEntries as RecordEntry[]).filter((e) => e && typeof e.header === "string").slice(0, 20) : []);
      setGrounding(data.grounding ?? null);
      setWritten({ resume: data.resume || "", letter: data.coverLetter || "" });
      setReceipt(typeof data.receipt === "string" ? data.receipt : "");
      // New documents: earlier answers belonged to other lines.
      setDefendAnswers([]);
      setAddedTerms([]);
      setKeptTerms([]);
      setConfirmedCredentials([]);
      setCredentialCutRemnants([]);
      // New documents are written from this run: its own words, not a restored copy's.
      // A rebuild: exactly the own words the server bound the receipt to.
      setRunEvidence(readRunEvidence(data.evidence));
      setDocState("done");
      setQuiet(false);
    } catch (err: unknown) {
      console.error("Doc generation error:", err);
      setQuiet(false);
      setDocError(limited
        ? err instanceof Error ? err.message : "Today's writing limit has been reached."
        : "The writer stopped before it made your resume. Your uploaded page is still here in this browser.");
      setDocState("error");
      hasStarted.current = false;
    }
  }, [docState, output, session.resumeText, session.rebuild, session.originalResumeText, session.goals, session.goalNarrative, session.preferences, session.readinessStage, session.resumeConfidence, session.resumeWorries, keepInsideLines, recordChoice]);

  // Write the documents when the page loads, unless this run already has them.
  useEffect(() => {
    if (checkModeRef.current) return;
    if (!session.forgeOutput || docState !== "idle") return;
    // Let the stored-copy check run first. And never send a run that is not
    // this account's (security review 3a r2, L1: readOwnForgeSession).
    const t = setTimeout(() => {
      if (!hasStarted.current && runIsMine()) generateDocs();
    }, 0);
    return () => clearTimeout(t);
  }, [session.forgeOutput, docState, generateDocs]);

  // Check and finish (R2): load that resume and the person's own words from
  // the server. The words never come from this page.
  // Once per resume id (a ref, not a cancel flag, so a second effect run in
  // development never drops the answer).
  const checkLoaded = useRef<string | null>(null);
  useEffect(() => {
    // Review r1 M4: nothing is checked or saved until the person picks "Check it as it is".
    if (!checkId || !signedIn || !checkAsIs || checkLoaded.current === checkId) return;
    checkLoaded.current = checkId;
    hasStarted.current = true;
    hydrated.current = true;
    // Read the checked version; with none current, ask R1's one re-check path
    // to check the stored resume for real (it saves that version), then read it.
    const read = () =>
      fetch(`/api/revisions/check?artifactId=${encodeURIComponent(checkId)}`, { cache: "no-store" }).then(async (r) => ({ ok: r.ok, j: await r.json().catch(() => null) }));
    (async () => {
      try {
        let got = await read();
        if (!got.ok && got.j?.reason === "needs_check") {
          const rc = await fetch("/api/forge/recheck", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ kind: "artifact", artifactId: checkId }),
          });
          if (!rc.ok) {
            const e = await rc.json().catch(() => null);
            setOpenError(typeof e?.error === "string" ? e.error : "We couldn't check that resume just now. Try again.");
            setDocState("error");
            return;
          }
          got = await read();
        }
        const src = got.j?.source;
        if (!got.ok || !src || typeof src.resumeText !== "string") {
          setOpenError(typeof got.j?.error === "string" ? got.j.error : "We couldn't open that resume.");
          setDocState("error");
          return;
        }
        setCheckTitle(String(src.title || ""));
        setResumeText(src.resumeText);
        setCoverLetterText(src.letterText || "");
        // The documents R1 checked and its second check, for the same cards the server gates on.
        setWritten(src.written && typeof src.written.resume === "string" ? src.written : { resume: src.resumeText, letter: src.letterText || "" });
        setGrounding(src.grounding ?? null);
        setWithheldLines([]);
        setDefendAnswers(Array.isArray(src.defendAnswers) ? src.defendAnswers : []);
        setKeptTerms(Array.isArray(src.keptTerms) ? src.keptTerms : []);
        setConfirmedCredentials(Array.isArray(src.confirmedCredentials) ? src.confirmedCredentials : []);
        setAddedTerms([]);
        setCredentialCutRemnants([]);
        if (isLengthChoice(src.lengthChoice)) setLengthChoice(src.lengthChoice);
        setRunEvidence(readRunEvidence(src.evidence) ?? { ownWords: "", credentialsAnswer: "", credentialRows: [], ownResumeText: "" });
        setDocState("done");
      } catch {
        setOpenError("We couldn't open that resume. Try again.");
        setDocState("error");
      }
    })();
  }, [checkId, signedIn, checkAsIs]);

  // Review r1 M4: the choice screen shows the saved page from a read-only
  // route; opening it saves nothing.
  const [choicePage, setChoicePage] = useState<{ text: string } | { error: string } | null>(null);
  useEffect(() => {
    if (!checkId || !signedIn || checkAsIs) return;
    let live = true;
    fetch(`/api/revisions/rebuild?artifactId=${encodeURIComponent(checkId)}`, { cache: "no-store" })
      .then(async (r) => ({ ok: r.ok, j: (await r.json().catch(() => null)) as { pageText?: unknown; error?: unknown } | null }))
      .then(({ ok, j }) => {
        if (!live) return;
        setChoicePage(ok && typeof j?.pageText === "string" ? { text: j.pageText } : { error: typeof j?.error === "string" ? j.error : "We couldn't open that resume." });
      })
      .catch(() => live && setChoicePage({ error: "We couldn't open that resume. Try again." }));
    return () => {
      live = false;
    };
  }, [checkId, signedIn, checkAsIs]);

  // ---- the gate ----------------------------------------------------------------
  // Restored from the account: the saved revision's own words (runEvidence), so
  // the page is that exact version. Otherwise this run's words, as before.
  const ownWords = useMemo(() => runEvidence?.ownWords ?? ownWordsFor(session, keepInsideLines, recordChoice), [runEvidence, session, keepInsideLines, recordChoice]);
  // The licenses-and-training answer: a credential line exactly as typed there is not asked about.
  const credentialsAnswer = runEvidence ? runEvidence.credentialsAnswer || undefined : session.challengeNarratives?.[CREDENTIALS_KEY];
  // Round 7: the structured rows are the typed exception; whole lines of their own resume are the other.
  const credentialRows = useMemo(
    () => completeCredentialRows(readCredentialRows(runEvidence ? runEvidence.credentialRows : session.credentialRows)),
    [runEvidence, session.credentialRows]
  );
  const ownResumeText = useMemo(
    // The resume text the writer received (review r3 L-2): the same block the server attests.
    () => (runEvidence ? runEvidence.ownResumeText : withholdRecordLines(session.resumeText, keepSourceRecordLines(recordChoice)).kept),
    [runEvidence, session.resumeText, recordChoice]
  );
  const gateView = useMemo(
    () =>
      buildFinishView({
        resumeText,
        ownWords,
        defendAnswers,
        coverLetterText,
        addedTerms,
        keptTerms,
        confirmedCredentials,
        grounding,
        written,
        credentialsAnswer,
        credentialCutRemnants,
        credentialRows,
        ownResumeText,
      }),
    [resumeText, ownWords, defendAnswers, coverLetterText, addedTerms, keptTerms, confirmedCredentials, grounding, written, credentialsAnswer, credentialCutRemnants, credentialRows, ownResumeText]
  );
  const ready = docState === "done" && !!resumeText;

  // ---- one saved version (Phase 5 R1) ------------------------------------------------
  // The whole state the server's gate reads. Same builder as the import.
  const payload = useMemo(
    () =>
      ready
        ? finishPayload(
            session,
            { resumeText, coverLetterText, defendAnswers, addedTerms, keptTerms, confirmedCredentials, credentialCutRemnants, written, grounding, withheldLines, keepInsideLines, recordChoice, lengthChoice, receipt },
            runEvidence
          )
        : null,
    // session is read for its run fields only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ready, resumeText, coverLetterText, defendAnswers, addedTerms, keptTerms, confirmedCredentials, credentialCutRemnants, written, grounding, withheldLines, keepInsideLines, recordChoice, lengthChoice, receipt, runEvidence, session.resumeText, session.originalResumeText, session.goalNarrative, session.hookNarrative, session.challengeNarratives, session.credentialRows]
  );
  const mark = useMemo(() => payloadMark(payload), [payload]);
  const mayAccount = signedIn && !isDemo;
  const saveSeq = useRef(0);
  const saveRevision = useCallback(async () => {
    // Check mode saves a resume from the account, not this browser's run.
    if (!mayAccount || !payload || (!checkModeRef.current && !runIsMineRef.current())) return;
    const mine = ++saveSeq.current;
    const forMark = mark;
    setFailedMark(null);
    try {
      const res = checkId
        ? await fetch("/api/revisions/check", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ artifactId: checkId, finish: payload }),
          })
        : await fetch("/api/revisions", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ kind: "finish", finish: payload, laneTarget: session.laneTarget || careerPaths[0]?.title || "" }),
          });
      const data = (await res.json().catch(() => null)) as { revision?: SavedRevisionSummary; error?: string } | null;
      if (mine !== saveSeq.current) return;
      if (res.status === 413) {
        setTooLarge({ mark: forMark, message: data?.error || "This version is too big to save to your account." });
        return;
      }
      // Check and finish on a locked baseline (R2 review L4): said plainly, no retry loop.
      if (checkId && res.status === 409) {
        setTooLarge({ mark: forMark, message: data?.error || "This resume is locked as a baseline, so it can't change here." });
        return;
      }
      if (!res.ok || !data?.revision?.id) throw new Error(String(res.status));
      setSaved({ ...data.revision, mark: forMark });
      if (!checkModeRef.current && data.revision.laneId !== undefined) updateSession({ forgeLaneId: data.revision.laneId });
      window.dispatchEvent(new Event("lane-focus-changed"));
    } catch {
      if (mine === saveSeq.current) setFailedMark(forMark);
    }
    // careerPaths only names the first lane.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mayAccount, payload, mark, checkId]);
  // Every change saves a new version (the server keeps one per distinct version).
  useEffect(() => {
    if (!mayAccount || !payload || (saved && saved.mark === mark)) return;
    const t = setTimeout(() => void saveRevision(), 700);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mark, mayAccount]);
  // The saved revision for exactly this state, or null while it saves.
  const current = saved && saved.mark === mark ? saved : null;
  // What the account line says: saved only for THIS state's revision.
  const saveShown: "saved" | "failed" | "saving" | "too_large" = current ? "saved" : tooLarge?.mark === mark ? "too_large" : failedMark === mark ? "failed" : "saving";

  // D8: pages are part of status. The server's count for the saved version;
  // the renderer's count from the layout route while it saves (or signed out).
  const pageLimit = pageLimitFor("resume", lengthChoice);
  const lengthOver = current
    ? current.pageLimit !== null && current.pageCount > current.pageLimit
    : pages !== null && !lengthOk(pages, pageLimit);
  const shownPages = current ? current.pageCount : pages;
  // Review r3 M-1: a version without a writer's receipt (from before receipts,
  // or one the server no longer accepts) cannot finish until it is checked
  // again. The page says so and offers the check, instead of a silent DRAFT.
  // Check and finish (R2): R1's artifact check already ran on the server and the
  // server holds its receipt, so the page never runs a run-bound check of its own.
  const checkUnavailable = ready && (!verifierCheckedDocument(grounding, "resume") || (!!coverLetterText.trim() && !verifierCheckedDocument(grounding, "cover_letter")));
  const needsCheck = ready && (checkUnavailable || (!checkMode && (!receipt || (!!current && needsRecheck(current.openItems)))));
  const localState: "finished" | "draft" = gateView.state === "finished" && !lengthOver && !needsCheck ? "finished" : "draft";
  // Signed in: the server's status for the saved version wins.
  const state: "finished" | "draft" = mayAccount && current ? current.status : localState;
  const view = useMemo(
    () => ({ ...gateView, state, fixCount: gateView.fixCount + (lengthOver ? 1 : 0) + (needsCheck ? 1 : 0) }),
    [gateView, state, lengthOver, needsCheck]
  );
  const finished = ready && view.state === "finished";

  // Troy 2026-10-20: the Forge finishes its own page. Bad one in, good one out, no draft mark.
  // t.ROY makes every fix it can in the person's words and takes off what it cannot stand behind
  // (lib/auto-settle.ts), then fits the page length and runs the second check, and says what it did.
  // Check mode (a saved resume reopened from the Refinery) and the demo keep the cards.
  const [checking, setChecking] = useState(false);
  const [checkError, setCheckError] = useState("");
  const autoFinish = !checkMode && !isDemo;
  const [settle, setSettle] = useState<{ status: "idle" | "running" | "done"; notes: SettleNote[]; trimmed: string[] }>({ status: "idle", notes: [], trimmed: [] });
  const settledFor = useRef("");
  useEffect(() => {
    if (!autoFinish || !ready || !written) return;
    if (settledFor.current === written.resume) return;
    settledFor.current = written.resume;
    setSettle({ status: "running", notes: [], trimmed: [] });
    void (async () => {
      try {
        const r = await settleFinishPage(
          { ownWords, written, grounding, credentialsAnswer, credentialRows, ownResumeText },
          { resume: resumeText, letter: coverLetterText, answers: defendAnswers, addedTerms, keptTerms, confirmed: confirmedCredentials, remnants: credentialCutRemnants },
          (group, source, page) => fetchSuggestion(source, page, group)
        );
        setResumeText(r.state.resume);
        setCoverLetterText(r.state.letter);
        setDefendAnswers(r.state.answers);
        setAddedTerms(r.state.addedTerms);
        setKeptTerms(r.state.keptTerms);
        setConfirmedCredentials(r.state.confirmed);
        setCredentialCutRemnants(r.state.remnants);
        setSettle({ status: "done", notes: r.notes, trimmed: [] });
      } catch {
        setSettle({ status: "done", notes: [], trimmed: [] });
      }
    })();
    // The settle runs once per written document.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoFinish, ready, written]);
  // Length changes are a person's choice. Never silently discard their work to fit.
  // A changed page needs its second check again; the person is not asked.
  const autoRechecks = useRef(0);
  useEffect(() => {
    if (!autoFinish || settle.status !== "done" || !needsCheck || checking || !current || autoRechecks.current >= 3) return;
    autoRechecks.current += 1;
    void checkAgain();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoFinish, settle.status, needsCheck, checking, current]);
  const settling = autoFinish && ready && settle.status !== "done";
  // Where every file comes from: the saved revision when there is one for
  // this exact state; otherwise the whole state, and the server decides.
  const fileSource = (): { revisionId?: string; finish?: unknown } => (mayAccount && current ? { revisionId: current.id } : { finish: payload });

  const groundingNote = useMemo(() => readGrounding(grounding), [grounding]);
  const forgeRepairs = useMemo(() => {
    const raw = (grounding as { forgeRepairs?: unknown } | null)?.forgeRepairs;
    if (!Array.isArray(raw)) return [];
    return raw.filter((r): r is { kind: "job" | "skill" | "claim" | "order" | "headline"; before: string; after: string } =>
      !!r && ["job", "skill", "claim", "order", "headline"].includes(r.kind) && typeof r.before === "string" && typeof r.after === "string"
    );
  }, [grounding]);
  const g = grounding as { verifierRan?: boolean; verifierRanByDoc?: { resume?: boolean; cover_letter?: boolean } } | null;
  // Absent means an older response shape, treated as "ran". An explicit false matters.
  const verifierRan = g?.verifierRan !== false;
  const byDoc = g?.verifierRanByDoc;
  const uncheckedDoc = byDoc && byDoc.resume !== byDoc.cover_letter ? (byDoc.resume === false ? "resume" : "cover letter") : null;

  // Celebrate once, only when the engine says finished.
  const [celebrated, setCelebrated] = useState(false);
  useEffect(() => {
    if (mayAccount && !current) return; // wait for the server's answer
    // Not while the live fix is still playing: the finished page comes first.
    if (shouldCelebrate({ state: view.state, isDemo, docsReady: ready && !revealing, alreadyCelebrated: celebrated })) setCelebrated(true);
  }, [view.state, isDemo, ready, revealing, celebrated, mayAccount, current]);

  // Review ask: after a finished download, once per visit.
  const [finishedDownloadDone, setFinishedDownloadDone] = useState(false);
  const [reviewDismissed, setReviewDismissed] = useState(false);
  const shownEarlier = useRef<boolean | null>(null);
  if (shownEarlier.current === null && typeof window !== "undefined") {
    try {
      shownEarlier.current = sessionStorage.getItem(REVIEW_ASK_SHOWN_KEY) === "1";
    } catch {
      shownEarlier.current = false;
    }
  }
  const reviewVisible = shouldShowReviewAsk({
    state: ready ? view.state : "draft",
    isDemo,
    finishedDownloadDone,
    shownEarlierThisVisit: shownEarlier.current === true,
    dismissed: reviewDismissed,
  });
  useEffect(() => {
    if (!reviewVisible) return;
    try {
      sessionStorage.setItem(REVIEW_ASK_SHOWN_KEY, "1");
    } catch {
      // storage unavailable: the ask still shows only after this download
    }
  }, [reviewVisible]);

  // The tour: once by itself, then from the button.
  const [tourOpen, setTourOpen] = useState(false);
  useEffect(() => {
    if (!ready || revealing || settling) return;
    try {
      if (localStorage.getItem(TOUR_SEEN_KEY) === "1") return;
      localStorage.setItem(TOUR_SEEN_KEY, "1");
    } catch {
      return;
    }
    const t = setTimeout(() => setTourOpen(true), 900);
    return () => clearTimeout(t);
  }, [ready, revealing, settling]);

  const tourSteps: TourStep[] = [
    ...(!checkMode ? [{ target: "finish-story", title: "Your story", text: "t.ROY read the work you gave us and wrote this. It is a starting account in his words. If the headline misses you, say so and he redoes it." }] : []),
    { target: "finish-resume", title: "Your resume", text: "This is your first stronger draft, built from your experience. Read it, make it yours, then use the Refinery to tailor it to a real job and practice your story." },
    ...(autoFinish
      ? [{ target: "auto-finish-notes", title: "What t.ROY did", text: "Every fix he made and anything he left out because it needed a fact only you could give. Open it to see each one. Nothing here is a mistake you have to fix." }]
      : [
          view.state === "finished"
            ? { target: "fix-list", title: "Your lines are checked", text: "Every line we asked about is settled. You can still change an answer." }
            : { target: "fix-list", title: "Lines only you can answer", text: "For each one: say it's true, change it, or cut it. When they're done, your resume is finished." },
        ]),
    { target: "finish-download", title: "Download it", text: view.state === "finished" ? "Download your resume and cover letter here, or email them to yourself. A copy was also saved to your account." : "Download here. Until it is finished, every file is marked DRAFT so nobody mistakes it for the final one." },
    { target: "finish-checks", title: "How it reads", text: "These checks read your page the way a screener does. Open one for the detail. They are for your information. You don't have to act on them." },
    { target: "finish-next", title: "Next: the Refinery", text: "Your resume carries over. The Refinery tailors it to real jobs, writes cover letters, and prepares you for interviews." },
  ];

  // ---- actions -------------------------------------------------------------------
  const onAnswer = (group: LineGroup, answer: string) =>
    setDefendAnswers((a) => recordAnswer(a, group.line, answer, "stands"));
  /** Returns false when nothing changed, so the panel can say so. */
  const onChange = (group: LineGroup, rewrite: string): boolean => {
    if (group.target === "skill") return false;
    const text = group.target === "letter" ? coverLetterText : resumeText;
    const r = applyRewrite(text, defendAnswers, group.line, rewrite);
    if (!r.changed) return false;
    if (group.target === "letter") setCoverLetterText(r.text);
    else setResumeText(r.text);
    setDefendAnswers(r.answers);
    return true;
  };
  const onAssist = (group: LineGroup, suggestion: string): boolean => {
    if (group.target !== "resume" && group.target !== "letter") return false;
    const text = group.target === "letter" ? coverLetterText : resumeText;
    const r = applyAssistedRewrite(text, defendAnswers, group.line, suggestion, view.source);
    if (!r.changed) return false;
    if (group.target === "letter") setCoverLetterText(r.text);
    else setResumeText(r.text);
    setDefendAnswers(r.answers);
    return true;
  };
  /** Troy 2026-10-20: t.ROY settles what it can in one pass. Each pick goes through the same gate as a tap. */
  const onBulk = (picks: BulkPick[]): number => {
    let resume = resumeText;
    let letter = coverLetterText;
    let answers = defendAnswers;
    let landed = 0;
    for (const p of picks) {
      if (p.kind === "job_ok") {
        answers = recordJobOk(answers, p.group.line);
        landed += 1;
        continue;
      }
      const isLetter = p.group.target === "letter";
      const text = isLetter ? letter : resume;
      const r = p.kind === "assist" ? applyAssistedRewrite(text, answers, p.group.line, p.text, view.source) : applyRewrite(text, answers, p.group.line, p.text);
      if (!r.changed) continue;
      if (isLetter) letter = r.text;
      else resume = r.text;
      answers = r.answers;
      landed += 1;
    }
    setResumeText(resume);
    setCoverLetterText(letter);
    setDefendAnswers(answers);
    return landed;
  };
  const onCut = (group: LineGroup) => {
    if (group.target === "skill") {
      setResumeText((t) => cutTerm(t, group.line));
      setAddedTerms((terms) => terms.filter((x) => x.toLowerCase() !== group.line.toLowerCase()));
      return;
    }
    // Round 11: "Take it off" on a scope claim in the letter takes out the sentences that make it, whole.
    if (group.target === "letter" && group.scope) setCoverLetterText((t) => cutScopeSentences(t, group.line, view.source, defendAnswers));
    else if (group.target === "letter") setCoverLetterText((t) => cutLine(t, group.line));
    else setResumeText((t) => cutLine(t, group.line));
    setDefendAnswers((a) => recordAnswer(a, group.line, "", "cut"));
  };

  const confirmedLineSet = new Set(confirmedCredentials.flatMap((c) => [c.text, ...(c.line ? [c.line] : [])]));
  const cardActions: CardActions = {
    onScopeYes: (group, typed) => {
      if (!group.scope) return "empty";
      const doc = group.target === "letter" ? { target: "letter" as const, text: coverLetterText } : { target: "resume" as const, text: resumeText };
      const job = group.scope.overPeople?.job;
      const r = scopeYesResult(doc, group.line, group.scope.families, typed, view.source, defendAnswers, job);
      if (r === "ok") setDefendAnswers((a) => recordScopeYes(a, group.line, group.scope!.families, typed, job));
      return r;
    },
    onTitleYes: (group) => {
      const shownTitle = group.title?.current ?? "";
      if (titleYesResult(group.line, shownTitle, group.title?.role ? shownTitle : undefined) === "ok") {
        setDefendAnswers((a) => recordTitleYes(a, group.line, shownTitle));
      }
    },
    onOwnTitle: (group, typed) => {
      // Round 13 (SF-5): "idk", "no", "I don't remember" are not a title; the same title is a Yes.
      const current = group.title?.current ?? "";
      const problem = ownTitleProblem(typed, current);
      if (problem === "empty" || problem === "not_a_title") return problem;
      if (problem === "same") {
        setDefendAnswers((a) => recordTitleYes(a, group.line, current));
        return "ok";
      }
      const letter = group.target === "letter";
      const r = applyOwnTitle(letter ? coverLetterText : resumeText, defendAnswers, group.line, typed, group.title?.role ? current : undefined);
      if (!r.changed) return "not_a_title";
      if (letter) setCoverLetterText(r.text);
      else setResumeText(r.text);
      setDefendAnswers(r.answers);
      return "ok";
    },
    onScopeNo: (group) => {
      const noLine = group.scope?.overPeople?.noLine;
      if (!noLine) return;
      const text = group.target === "letter" ? coverLetterText : resumeText;
      const r = applyRewrite(text, defendAnswers, group.line, noLine);
      if (!r.changed) return;
      if (group.target === "letter") setCoverLetterText(r.text);
      else setResumeText(r.text);
      setDefendAnswers(r.answers);
    },
    onScopeHelped: (group) => {
      if (!group.scope?.helped) return;
      const text = group.target === "letter" ? coverLetterText : resumeText;
      const r = applyScopeHelped(text, defendAnswers, group.line, group.scope.helped, group.scope.family);
      if (!r.changed) return;
      if (group.target === "letter") setCoverLetterText(r.text);
      else setResumeText(r.text);
      setDefendAnswers(r.answers);
    },
    // Phase 6 (Q3): one tap per job.
    onJobOk: (group) => setDefendAnswers((a) => recordJobOk(a, group.line)),
    onKeepTerm: (term) => setKeptTerms((t) => (t.some((x) => x.toLowerCase() === term.toLowerCase()) ? t : [...t, term])),
    onCutTerm: (term) => {
      setResumeText((t) => cutTerm(t, term));
      setAddedTerms((terms) => terms.filter((x) => x.toLowerCase() !== term.toLowerCase()));
    },
    onConfirmCredential: (group, type, when, school, keepFacility) => {
      // Round 12: something typed in "What school?" that is not a school's name gets its own message.
      if (type === "did not finish" && school?.trim() && isRejectedSchool(school)) return "school";
      // Round 13 (SF-6): a school inside a jail or prison is printed only when the person chooses to keep it.
      if (type === "did not finish" && school?.trim() && !keepFacility && isFacilitySchool(school)) return "facility";
      if (!isConfirmWhen(type, when)) return "when";
      // Round 10: the person's own words, so a school they named themselves stays on an education line.
      const r = applyConfirmation({ resume: resumeText, letter: coverLetterText }, group.credentialName ?? group.line, type, when, { personText: view.source, school });
      if (!r) return "unchanged";
      setResumeText(r.resume);
      setCoverLetterText(r.letter);
      setConfirmedCredentials((c) => [...c.filter((x) => (x.key ?? x.name.toLowerCase()) !== (r.confirm.key ?? r.confirm.name.toLowerCase())), r.confirm]);
      return "ok";
    },
    onPreviewCut: (group) => cutCredentialEverywhere({ resume: resumeText, letter: coverLetterText }, group.credentialName ?? group.line, { keepLines: confirmedLineSet }).changes,
    onCutCredential: (group) => {
      // Round 7: every mention of that credential comes off, on both pages, so it is never asked again.
      // Round 10: a line the person already confirmed (an "attended" line) stays.
      const r = cutCredentialEverywhere({ resume: resumeText, letter: coverLetterText }, group.credentialName ?? group.line, { keepLines: confirmedLineSet });
      setResumeText(r.resume);
      setCoverLetterText(r.letter);
      if (r.remnants.length) setCredentialCutRemnants((rs) => [...rs, ...r.remnants.filter((x) => !rs.includes(x))]);
    },
  };

  const goFix = () => {
    const first =
      document.querySelector<HTMLElement>('[data-testid="fix-item"][data-blocking="true"]') ||
      document.getElementById("fix-item-0") ||
      document.getElementById("fix-list");
    if (!first) return;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    first.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "center" });
    first.querySelector<HTMLButtonElement>("button")?.focus({ preventScroll: true });
  };

  const confidence = useMemo(() => sourceConfidence(defendAnswers, skippedNumbers), [defendAnswers, skippedNumbers]);
  // The DRAFT file's to-do page carries the meter too (Troy 2026-10-15).
  const draftItems = () => (view.state === "finished" ? undefined : [...(current?.openItems.length ? current.openItems : openItemsInPlainWords(view)), ...confidenceLines(confidence)]);

  async function runDownload(fn: () => Promise<void>) {
    setBusy(true);
    setDownloadError("");
    try {
      await fn();
      if (view.state === "finished") setFinishedDownloadDone(true);
    } catch (err) {
      console.error("Download error:", err);
      setDownloadError(err instanceof Error && /popups/.test(err.message) ? err.message : "The download didn't work. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  const handlePackage = () =>
    runDownload(() =>
      downloadPackage({ resumeText, coverLetterText: coverLetterText || undefined, ...downloadMode(view.state), openItems: draftItems(), ...fileSource() })
    );
  const handleFormat = (format: DownloadFormat) =>
    runDownload(() => downloadResume({ format, kind: "resume", text: resumeText, ...downloadMode(view.state), openItems: draftItems(), ...fileSource() }));
  const handleLetter = () =>
    runDownload(() =>
      downloadResume({ format: "docx", kind: "cover_letter", text: coverLetterText, resumeText, ...downloadMode(view.state), openItems: draftItems(), ...fileSource() })
    );
  const handlePrint = () => printFromServer({ ...fileSource(), content: resumeText });
  // "Check it again" (review r3 M-1): the second check runs again on the page
  // as it is, and the server signs a fresh receipt. Nothing is rewritten; the
  // answers stay. Anything newly flagged comes back as a card.
  const checkAgain = async () => {
    if (checking) return;
    setChecking(true);
    setCheckError("");
    try {
      if (checkId) {
        const saved = await fetch("/api/revisions/check", { method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ artifactId: checkId, finish: payload }) });
        if (!saved.ok) throw new Error("Save this version before checking it again. Try saving once more.");
      }
      const res = await fetch("/api/forge/recheck", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(checkId ? { kind: "artifact", artifactId: checkId } : { kind: "finish" }),
          documents: { resume: resumeText, letter: coverLetterText },
          source: {
            resumeText: session.resumeText,
            goals: session.goals,
            goalNarrative: session.goalNarrative,
            hookNarrative: session.hookNarrative,
            credentialsNote: session.challengeNarratives?.[CREDENTIALS_KEY],
            credentialRows: session.credentialRows,
            keepInsideLines,
            recordChoice,
          },
          answers: [
            ...defendAnswers.map((a) => a.answer),
            ...confirmedCredentials.map((c) => c.text),
            ...keptTerms,
          ],
          runId: session.startedAt,
        }),
      });
      const data = (await res.json().catch(() => null)) as { grounding?: unknown; receipt?: string; written?: WrittenDocs; evidence?: unknown; error?: string } | null;
      if (!res.ok || !data?.receipt) throw new Error(data?.error || "failed");
      // The receipt covers the documents that were checked: they are now "as delivered".
      if (data.written) setWritten(data.written);
      setGrounding(data.grounding ?? null);
      setReceipt(data.receipt);
      // A restored copy's evidence is replaced by this run's own words (signed in:
      // the server-held words the new receipt is bound to).
      if (!checkId) setRunEvidence(readRunEvidence(data.evidence));
    } catch (err) {
      setCheckError(err instanceof Error && err.message !== "failed" ? err.message : "We couldn't check it just now. Try again in a moment.");
    } finally {
      setChecking(false);
    }
  };
  // R2's "Check and finish" and the Refinery link here with ?check=1: run it once.
  const autoChecked = useRef(false);
  useEffect(() => {
    if (!needsCheck || autoChecked.current) return;
    try {
      if (new URLSearchParams(window.location.search).get("check") !== "1") return;
    } catch {
      return;
    }
    autoChecked.current = true;
    void checkAgain();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needsCheck]);

  // Over the limit: the person picks a line; it is cut and recorded as their cut.
  const onLengthCut = (line: string) => {
    setResumeText((t) => cutLine(t, line));
    setDefendAnswers((a) => recordAnswer(a, line, "", "cut"));
  };
  const handleCopy = (text: string, label: string) => {
    navigator.clipboard?.writeText(text).catch(() => undefined);
    setCopied(label);
    setTimeout(() => setCopied(""), 2000);
  };

  // ---- check summaries -------------------------------------------------------------
  const mintBlocks = view.openItems.filter((i) => i.target === "resume" && !i.trace && i.rule !== "STD-C04" && i.severity === "BLOCK").length;
  const traceBlocks = view.openItems.filter((i) => i.trace && i.severity === "BLOCK").length;
  // Phase 6 integration (L6): the older panels read the server's own words when
  // the page has them (a rebuild, or a version restored from the account),
  // never a rebuild's starting page or an older run's text.
  const panelSource = runEvidence ? runEvidence.ownResumeText : session.resumeText;
  // L2: the recap shows only changes whose new line is still on the resume as it reads now.
  const recapChanges = useMemo(() => changesStillOnPage(changes, resumeText), [changes, resumeText]);
  const discrepancies = useMemo(
    () => (resumeText.trim() ? findDiscrepancies(resumeText, { sourceText: panelSource }) : []),
    [resumeText, panelSource]
  );
  const samples = useMemo(() => pickSamplePostings(careerPaths.map((c) => c.title || ""), 4), [careerPaths]);
  // D2 (Phase 6): optional "add a number?" prompts, never an open item.
  const numberPrompts = useMemo(() => (ready ? optionalNumberPrompts(resumeText, view.groups.map((g) => g.line)) : []), [ready, resumeText, view.groups]);

  // Check mode needs the account the resume is saved in.
  if (checkMode && authStatus !== "loading" && !signedIn) {
    return (
      <div className="flow-center min-h-screen flex flex-col items-center justify-center text-center bg-t-bg px-4">
        <h1 className="text-2xl font-bold mb-4 text-t-white">Sign in to check this resume</h1>
        <a
          href={`/login?callbackUrl=${encodeURIComponent(`/output?check=${checkId}`)}`}
          className="t-focus px-8 py-4 bg-t-amber text-white text-lg font-bold hover:bg-t-amber-bright min-h-touch"
        >
          Sign in
        </a>
      </div>
    );
  }

  // Check mode (Phase 6 Q1, review r1 M4): the writer first; the cards only
  // when the person picks them. Nothing is checked or saved before the pick.
  if (checkChoosing && checkId) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6 sm:py-10 lg:max-w-6xl" data-testid="finish-page">
        <div className="flex flex-wrap items-start gap-3 border border-t-line border-l-[3px] border-l-t-amber bg-t-panel px-4 py-3" data-testid="finish-status">
          <TroyMark size={32} className="mt-0.5" />
          <div className="min-w-0 flex-1">
            <h1 className="text-lg font-bold leading-snug text-t-white" data-testid="status-line">
              {choicePage && "error" in choicePage ? choicePage.error : "Here's your resume. t.ROY can make it stronger."}
            </h1>
            <p className="text-xs text-t-phos-dim">t.ROY rewrites it from this page, or you check it as it is.</p>
          </div>
        </div>
        <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_400px] lg:items-start">
          <div className="min-w-0 border border-t-line bg-t-bg p-3 sm:p-4" data-testid="finish-resume">
            {choicePage && "text" in choicePage ? <ResumePage text={choicePage.text} draft /> : <p className="text-sm text-t-phos">{choicePage ? "" : "Opening your resume."}</p>}
          </div>
          <aside>
            <div className="border border-t-amber bg-t-panel p-4" data-testid="check-choice">
              <p className="text-sm font-bold text-t-white">How do you want to finish this one?</p>
              <p className="mt-1 text-xs leading-relaxed text-t-phos">
                t.ROY writes a new version from this page, in strong plain words, and you check what it wrote. Checking it as it is keeps every line as it stands, and t.ROY asks about the lines it can&apos;t match to your words.
              </p>
              <div className="mt-3 flex flex-col gap-2">
                <button
                  type="button"
                  onClick={() => router.push(rebuildHref(checkId))}
                  className="t-focus min-h-touch bg-t-amber px-4 py-2.5 text-sm font-bold text-white hover:bg-t-amber-bright"
                  data-testid="check-rewrite"
                >
                  {REWRITE_WITH_TROY_LABEL}
                </button>
                <button
                  type="button"
                  onClick={() => setCheckAsIs(true)}
                  className="t-focus min-h-touch border border-t-line px-4 py-2.5 text-sm font-medium text-t-white hover:border-t-phos-dim"
                  data-testid="check-as-is"
                >
                  {CHECK_AS_IS_LABEL}
                </button>
              </div>
            </div>
            <a href="/dashboard/vault" className="t-focus mt-4 inline-flex min-h-touch items-center text-sm text-t-phos underline underline-offset-2">
              Back to My resumes
            </a>
          </aside>
        </div>
      </div>
    );
  }

  // If no output, redirect back
  if (!session.forgeOutput && !checkMode) {
    return (
      <div className="flow-center min-h-screen flex flex-col items-center justify-center text-center bg-t-bg">
        <h1 className="text-2xl font-bold mb-4 text-t-white">
          Let&apos;s build your story first
        </h1>
        <p className="text-base text-t-phos-dim mb-6">
          It looks like we haven&apos;t analyzed your information yet.
        </p>
        <button
          onClick={() => router.push("/start")}
          className="t-focus px-8 py-4 bg-t-amber text-white text-lg font-bold shadow-[0_3px_8px_rgba(22,26,21,0.15)] hover:bg-t-amber-bright transition-colors min-h-touch"
        >
          Start The Forge
        </button>
      </div>
    );
  }

  // Phase 6 live markup (S3): the writer's real changes play on the person's
  // own page once the finished documents are back.
  const liveFixOn = (docState === "done" || docState === "generating") && revealing && !checkMode && changes.length > 0;

  const headline =
    checkMode && (docState === "generating" || docState === "idle")
      ? "Opening your resume."
      : checkMode && docState === "error"
        ? openError || "We couldn't open that resume."
        : docState === "generating" || docState === "idle"
      ? writeProgress || "t.ROY is writing your resume and cover letter."
      : docState === "error"
        ? writerLimitReached ? "Writing paused for today." : "We couldn't finish writing your resume."
        : liveFixOn
          ? "Your new page is written. Here's what t.ROY changed."
          : statusLine(view);
  const subline =
    checkMode && docState !== "done"
      ? ""
      : checkMode && view.state !== "finished"
        ? `Checking: ${checkTitle || "your resume"}. Answer each card, and it saves as a new version.`
        : docState === "generating" || docState === "idle"
      ? "This usually takes 30 to 60 seconds."
      : docState === "error"
        ? writerLimitReached ? "Your uploaded resume and answers are still here. The writer cannot make another version until the daily allowance resets." : "Your uploaded resume and answers are still here. You can retry from this page."
        : liveFixOn
          ? "Each old line, the new one, and why. Skip any time."
          : view.state === "finished"
          ? checkMode ? "Download it below, or email it to yourself." : "This is your first stronger draft. Download it below, then improve and tailor it in the Refinery."
          : "Answer them with t.ROY. You can download a draft any time.";

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6 sm:py-10 lg:max-w-6xl" data-testid="finish-page">
      {celebrated && <CompletionConfetti />}
      <FinishTour
        open={tourOpen}
        steps={tourSteps}
        onClose={() => {
          setTourOpen(false);
          try {
            localStorage.setItem(TOUR_SEEN_KEY, "1");
          } catch {
            // fine
          }
        }}
      />

      {isDemo && (
        <div className="mb-6 border border-t-amber bg-t-panel-2 px-5 py-4 text-center">
          <p className="text-sm font-medium text-t-amber-bright">This is a sample output. Try it with your own data.</p>
          <button
            onClick={() => router.push("/start")}
            className="mt-2 text-sm text-t-amber-bright underline underline-offset-2 hover:text-t-amber"
          >
            Start your own Forge session
          </button>
        </div>
      )}

      {/* 1. t.ROY's status line and the tour button */}
      <div className="flex flex-wrap items-start gap-3 border border-t-line border-l-[3px] border-l-t-amber bg-t-panel px-4 py-3" data-testid="finish-status">
        <TroyMark size={32} className="mt-0.5" />
        <div className="min-w-0 flex-1">
          <h1 className="text-lg font-bold leading-snug text-t-white" data-testid="status-line">{headline}</h1>
          <p className="text-xs text-t-phos-dim">{subline}</p>
          {ready && !verifierRan && (
            <p className="mt-1 text-xs text-t-amber-bright">
              Our second check didn&apos;t run this time. Read every line before you send it.
            </p>
          )}
          {ready && mayAccount && (
            <p role="status" className="mt-1 text-xs text-t-phos" data-testid="account-save" data-state={saveShown}>
              {current ? (
                <>
                  Saved to your account (version {current.number}).
                  {current.accountCopy === "kept_refinery" && (
                    <span className="block" data-testid="account-copy-note">
                      Your resume in the Refinery has changes you made there, so we kept it as it is. This finished version is saved beside it.
                    </span>
                  )}
                  {current.accountCopy === "kept_earlier" && (
                    <span className="block" data-testid="account-copy-note">
                      Your account&apos;s earlier copy is kept{current.accountCopyRevision ? ` as version ${current.accountCopyRevision}` : ""}. Your resume in the Refinery now shows this finished version.
                    </span>
                  )}
                </>
              ) : saveShown === "too_large" ? (
                <>{tooLarge?.message}</>
              ) : saveShown === "failed" ? (
                <>
                  Not saved to your account yet. Your work is still on this page.{" "}
                  <button
                    type="button"
                    onClick={() => void saveRevision()}
                    className="t-focus min-h-touch font-medium text-t-white underline underline-offset-2"
                    data-testid="account-save-retry"
                  >
                    Try again
                  </button>
                </>
              ) : (
                "Saving to your account..."
              )}
            </p>
          )}
        </div>
        {ready && !liveFixOn && (
          <button
            onClick={() => setTourOpen(true)}
            className="t-focus min-h-touch w-full shrink-0 border border-t-line px-3 py-2 text-xs font-medium text-t-phos hover:border-t-phos-dim hover:text-t-white sm:w-auto"
            data-testid="tour-button"
          >
            Show me around
          </button>
        )}
      </div>

      <WorkFocus active={!checkMode && !quiet && (docState === "generating" || docState === "idle" || liveFixOn)} title="Building your first stronger draft">
      {!checkMode && !quiet && (docState === "generating" || docState === "idle" || liveFixOn) && <ReviewSteps step={liveFixOn ? 2 : 1} />}

      {(docState === "generating" || docState === "idle") && !checkMode && !liveFixOn && (
        quiet ? (
          <div role="status" aria-live="polite" className="mt-6 border border-t-line bg-t-panel p-6 text-center" data-testid="quiet-rebuild">
            <div className="relative mx-auto mb-3 h-8 w-8">
              <div className="absolute inset-0 border-[3px] border-t-line" />
              <div className="absolute inset-0 animate-spin border-[3px] border-t-amber border-t-transparent" />
            </div>
            <p className="text-sm font-medium text-t-amber-bright">Updating your resume with your choice...</p>
            <p className="mt-1 text-xs text-t-phos-dim">About a minute. Nothing else to do.</p>
          </div>
        ) : changes.length > 0 ? (
          <div className="mt-6"><p role="status">Changes checked. Checking the rest of your documents...</p><ChangesList changes={changes} open /></div>
        ) : (
          <div className="mt-6 border border-t-line bg-t-panel p-8 text-center">
            <div className="relative mx-auto mb-4 h-10 w-10">
              <div className="absolute inset-0 border-[3px] border-t-line" />
              <div className="absolute inset-0 animate-spin border-[3px] border-t-amber border-t-transparent" />
            </div>
            <p role="status" aria-live="polite" className="text-sm font-medium text-t-amber-bright">{writeProgress || "Writing from your work history..."}</p>
            <p className="mt-3 text-sm text-t-phos">The reading is complete. Next you will see changes checked against your original page.</p>
          </div>
        )
      )}

      {liveFixOn && (
        <LiveFix lines={liveFixLines} changes={changes} reduced={reduced} pending={docState === "generating" || settling} onDone={() => setRevealing(false)} />
      )}
      </WorkFocus>

      {docState === "error" && !checkMode && (
        <div className="mt-6 border border-t-red bg-t-panel p-6" role="alert">
          <p className="mb-3 text-sm text-t-phos">{docError}</p>
          <p className="mb-4 text-sm text-t-phos-dim">No new resume was made. Your original page is preserved in this browser.</p>
          {!writerLimitReached && (
            <button
              onClick={() => {
                hasStarted.current = false;
                setDocState("idle");
              }}
              className="t-focus min-h-touch bg-t-amber px-6 py-3 text-sm font-bold text-white shadow-[0_3px_8px_rgba(22,26,21,0.15)] transition-colors hover:bg-t-amber-bright"
            >
              Try writing again
            </button>
          )}
          {session.resumeText && (
            <details className="mt-5 border-t border-t-line pt-4">
              <summary className="t-focus cursor-pointer text-sm font-medium text-t-white">See the resume you gave us</summary>
              <pre className="mt-3 max-h-72 overflow-auto whitespace-pre-wrap text-xs text-t-phos">{session.resumeText}</pre>
            </details>
          )}
        </div>
      )}

      {docState === "done" && !liveFixOn && (
        <>
          {!checkMode && (
            <div className="mt-6">
              {storyRetryError && <p role="alert" className="text-t-red">{storyRetryError}</p>}
              <StorySection onRetry={() => void retryStory()} retrying={storyRetrying} quiet={storyAuto.current < 2 || storyRetrying} output={output} strengthsHeading={rc.strengthsHeading} careersHeading={rc.careersHeading} reportChecks={reportChecks} spotlight onRevisit={() => {
                updateSession({ forgeOutput: undefined, forgeFinish: undefined, laneParkedLetter: undefined });
                router.push("/goals");
              }} />
            </div>
          )}
          {/* 2. The resume, with the fix questions beside it (under it on a phone) */}
          <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_400px] lg:items-start">
            <div className="min-w-0">
              {!checkMode && <ChangesList changes={recapChanges} open={reduced !== false} />}
              <div id="finish-resume" className="scroll-mt-20 border border-t-line bg-t-bg p-3 sm:p-4" data-testid="finish-resume">
                {resumeText ? (
                  <ResumePage text={resumeText} draft={view.state !== "finished" && !settling} />
                ) : (
                  <p className="text-sm text-t-phos">The resume came back empty. Try again below.</p>
                )}
              </div>
              {forgeRepairs.length > 0 && (
                <details className="mt-3 border border-t-line bg-t-panel px-4 py-3" data-testid="forge-repairs">
                  <summary className="cursor-pointer text-sm font-semibold text-t-white">
                    What we corrected in your documents ({forgeRepairs.length})
                  </summary>
                  <ul className="mt-2 space-y-2 text-xs leading-relaxed text-t-phos">
                    {forgeRepairs.map((repair, i) => (
                      <li key={`${repair.kind}-${i}`}>
                        {repair.kind === "job" ? (
                          <>We changed &ldquo;{repair.before}&rdquo; to &ldquo;{repair.after}&rdquo; to match your page.</>
                        ) : repair.kind === "skill" ? (
                          <>We left &ldquo;{repair.before}&rdquo; off the skills list because it wasn&apos;t in what you gave us. You can add it later in the Refinery if you have used it.</>
                        ) : repair.kind === "claim" ? (
                          <>We left out &ldquo;{repair.before}&rdquo; because that sentence needed a fact you haven&apos;t given us. The rest of the document stays in place.</>
                        ) : repair.kind === "headline" ? (
                          <>We used your listed title &ldquo;{repair.after}&rdquo; in place of &ldquo;{repair.before}&rdquo;.</>
                        ) : (
                          <>We put your most recent listed work first: &ldquo;{repair.after}&rdquo;.</>
                        )}
                      </li>
                    ))}
                  </ul>
                </details>
              )}

            </div>

            <aside className="lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)] lg:overflow-y-auto lg:pr-1">
              {autoFinish && settling && (
                <div role="status" aria-live="polite" className="mb-4 border border-t-amber bg-t-panel p-4" data-testid="auto-finish-running">
                  <p className="text-sm font-bold text-t-white">t.ROY is finishing your resume.</p>
                  <p className="mt-1 text-xs leading-relaxed text-t-phos">He is checking every line against what you gave him and fixing what he can. You don&apos;t need to do anything.</p>
                </div>
              )}
              {autoFinish && !settling && settle.status === "done" && (settle.notes.length > 0 || settle.trimmed.length > 0) && (
                <details id="auto-finish-notes" className="mb-4 border border-t-line bg-t-panel px-4 py-3" data-testid="auto-finish-notes">
                  <summary className="cursor-pointer text-sm font-semibold text-t-white">
                    What t.ROY did on the last pass ({settle.notes.filter((n) => n.kind !== "confirmed").length + settle.trimmed.length})
                  </summary>
                  <ul className="mt-2 space-y-2 text-xs leading-relaxed text-t-phos">
                    {settle.notes.filter((n) => n.kind === "rewritten").map((n, i) => (
                      <li key={`w${i}`}>Reworded &ldquo;{n.kind === "rewritten" ? n.before : ""}&rdquo; to &ldquo;{n.kind === "rewritten" ? n.after : ""}&rdquo;, using only your words.</li>
                    ))}
                    {settle.notes.filter((n) => n.kind === "removed").map((n, i) => (
                      <li key={`r${i}`}>Left out &ldquo;{n.kind === "removed" ? n.line : ""}&rdquo;. {n.kind === "removed" ? n.why : ""}</li>
                    ))}
                    {settle.trimmed.map((line, i) => (
                      <li key={`t${i}`}>Trimmed &ldquo;{line.replace(/^[-•*]\s+/, "")}&rdquo; to keep your resume to two pages.</li>
                    ))}
                    <li className="text-t-phos-dim">Anything left out can be added back in the Refinery when it is true and you can back it up.</li>
                  </ul>
                </details>
              )}
              {needsCheck && !autoFinish && (
                <div className="mb-4 border border-t-amber bg-t-panel p-4" data-testid="recheck-card" data-blocking="true">
                  <p className="text-sm font-bold text-t-white">{RECHECK_LINE}</p>
                  <p className="mt-1 text-xs leading-relaxed text-t-phos">
                    This checks your page again, as it is now. Nothing on it is rewritten, and your answers stay.
                  </p>
                  <button
                    type="button"
                    onClick={() => void checkAgain()}
                    disabled={checking}
                    className="t-focus mt-3 min-h-touch bg-t-amber px-4 py-2 text-sm font-bold text-white hover:bg-t-amber-bright disabled:opacity-60"
                    data-testid="recheck-button"
                  >
                    {checking ? "Checking..." : "Check it again"}
                  </button>
                  {checkError && <p role="status" className="mt-2 text-xs text-t-amber-bright">{checkError}</p>}
                </div>
              )}
              {lengthOver && shownPages !== null && (
                <LengthCard
                  pages={shownPages}
                  limit={current?.pageLimit ?? pageLimit ?? 2}
                  choice={lengthChoice}
                  lines={cuttableLines(resumeText)}
                  onCut={onLengthCut}
                  onChoice={setLengthChoice}
                />
              )}
              {!autoFinish && <ConfidenceMeter level={confidence.level} notes={confidence.notes} />}
              <RecordChoiceCard
                choice={recordChoice}
                entries={recordEntries}
                sourceWithheld={withheldLines}
                busy={docState !== "done"}
                onChoose={(next) => {
                  setQuiet(true);
                  setRecordChoice(next);
                  hasStarted.current = false;
                  setDocState("idle");
                }}
              />
              {(!autoFinish || (!settling && settle.status === "done" && view.state !== "finished" && (!mayAccount || saveShown !== "saving"))) && <DefendPanel view={view} pageText={resumeText} onAnswer={onAnswer} onChange={onChange} onAssist={onAssist} onBulk={onBulk} onCut={onCut} actions={cardActions} numberPrompts={autoFinish ? [] : numberPrompts} onSkipNumber={(line) => setSkippedNumbers((s) => (s.includes(line) ? s : [...s, line]))} />}
            </aside>
          </div>

          {/* 3. One main action, with the email box and the explainer beside it */}
          <div className="mt-8 grid gap-4 lg:grid-cols-2 lg:items-start">
            {lanes || checkMode ? (
              <LaneDownloadBox
                view={view}
                busy={busy}
                error={downloadError}
                onDownloadPackage={handlePackage}
                onDownloadFormat={handleFormat}
                onPrint={handlePrint}
                onFix={goFix}
                onCopy={() => handleCopy(resumeText, "resume")}
                copied={copied === "resume"}
                hasLetter={!!coverLetterText}
              />
            ) : (
              <DownloadBox
                view={view}
                busy={busy}
                error={downloadError}
                onDownloadPackage={handlePackage}
                onDownloadFormat={handleFormat}
                onPrint={handlePrint}
                onFix={goFix}
                onCopy={() => handleCopy(resumeText, "resume")}
                copied={copied === "resume"}
              />
            )}
            {canEmailPackage({ state: view.state, isDemo }) && authStatus === "loading" ? null : canEmailPackage({ state: view.state, isDemo }) && signedIn ? (
              <FinishedEmailLine
                revisionId={current && current.status === "finished" ? current.id : null}
                savedAt={current?.createdAt ?? null}
                narrativeHeadline={narrative.headline || ""}
                narrativeSummary={narrative.summary || ""}
                mayUse={runIsMine}
              />
            ) : canEmailPackage({ state: view.state, isDemo }) ? (
              <EmailPackageBox
                resumeText={resumeText}
                coverLetterText={coverLetterText}
                narrativeHeadline={narrative.headline || ""}
                narrativeSummary={narrative.summary || ""}
                finish={payload}
              />
            ) : !isDemo ? (
              <div className="border border-t-line bg-t-panel p-4" data-testid="email-locked">
                <p className="mb-1 text-sm font-semibold text-t-white">Email me my package</p>
                <p className="text-xs text-t-phos-dim">
                  This opens when your resume is finished, so the copy in your inbox is the final one.
                </p>
              </div>
            ) : null}
          </div>

          {/* The review ask sits where the person just downloaded: one line,
              after a finished download only, once per visit, with an optional focus dialog. */}
          {reviewVisible && (
            <FocusDialog open={!tourOpen && !settling && !liveFixOn} title="How did the Forge work for you?" onClose={() => setReviewDismissed(true)}>
              <ReviewAsk onDismiss={() => setReviewDismissed(true)} />
            </FocusDialog>
          )}

          {/* 4. Checks, collapsed, one plain line each */}
          <section id="finish-checks" aria-labelledby="finish-checks-heading" className="mt-10 scroll-mt-20">
            <h2 id="finish-checks-heading" className="mb-3 text-xl font-bold text-t-white">Checks</h2>
            <div className="space-y-2">
              <CheckSection
                title="Hard rules"
                summary={
                  mintBlocks > 0
                    ? `Not finished yet: ${thingWord(mintBlocks)} to fix before you send it. They're in your list at the top.`
                    : "Nothing on this page broke a hard rule when we checked it against your words."
                }
                attention={mintBlocks > 0}
                testId="check-mint"
              >
                <MintCheckPanel resumeText={resumeText} sourceText={view.source} />
              </CheckSection>

              <CheckSection
                title="Dates, credentials and wording"
                summary={
                  discrepancies.length > 0
                    ? `${countWord(discrepancies.length)} ${discrepancies.length === 1 ? "question" : "questions"} worth a look before you send it.`
                    : "Nothing flagged. Still read it once yourself."
                }
                testId="check-discrepancy"
              >
                <DiscrepancyPanel resumeText={resumeText} sourceText={panelSource} readinessStage={readiness} onApply={setResumeText} />
              </CheckSection>

              {(groundingNote || !verifierRan) && (
                <CheckSection
                  title="The second check"
                  summary={
                    !verifierRan
                      ? "It didn't run this time. Read every line yourself before you send it."
                      : traceBlocks > 0
                        ? `Not finished yet: ${thingWord(traceBlocks)} to fix before you send it. They're in your list at the top.`
                        : groundingNote && groundingOpenCount(groundingNote) > 0
                          ? `${countWord(groundingOpenCount(groundingNote))} ${groundingOpenCount(groundingNote) === 1 ? "thing" : "things"} worth a look. None of them stops you from finishing.`
                          : "It traced every line back to what you told us and fixed what it could."
                  }
                  attention={!verifierRan || traceBlocks > 0}
                  testId="check-grounding"
                >
                  {!verifierRan && (
                    <p className="mb-2 text-xs leading-relaxed text-t-phos">
                      {uncheckedDoc
                        ? `The second check that traces every line back to what you told us did not run on your ${uncheckedDoc}, and nothing in it was changed. Read it over before you send it. Look hard at anything specific, like a number, a date or a certification.`
                        : "Your documents are here and nothing was changed. The second check that traces every line back to what you told us could not run this time, so read these over before you send them. Look hard at anything specific, like a number, a date or a certification."}
                    </p>
                  )}
                  {groundingNote && <GroundingNote groundingNote={groundingNote} />}
                </CheckSection>
              )}

              <CheckSection
                title="ATS and keywords"
                summary="How screening software reads your page. Try it against a job posting, or one of our samples."
                testId="check-ats"
              >
                <AtsScorePanel
                  resumeText={resumeText}
                  sourceText={panelSource}
                  onApply={setResumeText}
                  samplePostings={samples}
                  samplePostingLabel={SAMPLE_POSTING_LABEL}
                  onConfirmTerm={(term) => setAddedTerms((t) => (t.some((x) => x.toLowerCase() === term.toLowerCase()) ? t : [...t, term]))}
                />
              </CheckSection>

              <div className="flex min-h-touch flex-wrap items-center justify-between gap-2 border border-t-line bg-t-panel px-4 py-3" data-testid="check-pagefit">
                <span className="text-sm font-semibold text-t-white">Page length</span>
                <PageFitLine text={resumeText} onPages={setPages} />
                <label className="flex min-h-touch w-full items-center gap-2 text-xs text-t-phos">
                  <input
                    type="checkbox"
                    checked={lengthChoice === "one_page"}
                    onChange={(e) => setLengthChoice(e.target.checked ? "one_page" : "auto")}
                    data-testid="length-one-page"
                  />
                  I want it on one page
                </label>
              </div>
            </div>
          </section>

          {/* 5. Cover letter */}
          {coverLetterText && (
            <section id="finish-cover" aria-labelledby="finish-cover-heading" className="mt-10 scroll-mt-20">
              <h2 id="finish-cover-heading" className="mb-1 text-xl font-bold text-t-white">Cover letter</h2>
              {/\[[^\]]+\]/.test(coverLetterText) && (
                <p className="mb-3 text-xs text-t-phos-dim">Put in the real company and hiring manager names where you see the brackets before you send it.</p>
              )}
              <div className="border border-t-line bg-t-panel">
                <div className="max-h-96 overflow-y-auto p-5">
                  <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed text-t-phos">{coverLetterText}</pre>
                </div>
                <div className="flex flex-wrap gap-2 border-t border-t-line px-5 py-3">
                  <button
                    onClick={handleLetter}
                    disabled={busy}
                    className="t-focus min-h-touch border border-t-line bg-t-panel px-3 py-2 text-xs font-medium text-t-phos transition-colors hover:border-t-phos-dim disabled:opacity-60"
                  >
                    Download the letter (.docx)
                  </button>
                  {finished && (
                    <button
                      onClick={() => handleCopy(coverLetterText, "cover")}
                      className="t-focus min-h-touch border border-t-line bg-t-panel px-3 py-2 text-xs font-medium text-t-phos transition-colors hover:border-t-phos-dim"
                    >
                      {copied === "cover" ? "Copied" : "Copy the letter"}
                    </button>
                  )}
                </div>
              </div>
            </section>
          )}
        </>
      )}

      {checkMode ? (
        <div className="mt-12 border-t border-t-line pt-8" data-testid="check-next">
          <a href="/dashboard/vault" className="t-focus inline-flex min-h-touch items-center text-sm font-medium text-t-amber-bright underline underline-offset-2">
            Back to My resumes
          </a>
        </div>
      ) : lanes ? (
        /* Lanes first (R2): one next action by route; the rest behind "Something else". */
        <div className="mt-12">
          <LaneNextAction action={nextActionFor(session.laneTask, { signedIn, finished })}>
            {parkedLetter && !coverLetterText && docState === "done" && (
              <div data-testid="letter-offer">
                <p className="mb-2 text-sm text-t-phos">Applying somewhere that wants a cover letter? t.ROY wrote one from your story. t.ROY checks it line by line with you, like the resume.</p>
                <button
                  type="button"
                  onClick={() => setCoverLetterText(parkedLetter)}
                  className="t-focus min-h-touch border border-t-line bg-t-panel px-4 py-2 text-sm font-medium text-t-white hover:border-t-phos-dim"
                  data-testid="add-letter"
                >
                  Add a cover letter
                </button>
              </div>
            )}
            <NextStep isDemo={isDemo} audience={audience} refineryCta={rc.refineryCta} refinerySubtext={rc.refinerySubtext} />
          </LaneNextAction>
        </div>
      ) : (
        <>
          {/* 7. Next step */}
          <div className="mt-12">
            <NextStep
              isDemo={isDemo}
              audience={audience}
              refineryCta={rc.refineryCta}
              refinerySubtext={rc.refinerySubtext}
            />
          </div>
        </>
      )}
    </div>
  );
}
