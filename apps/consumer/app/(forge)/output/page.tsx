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
 */

import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useRouter } from "next/navigation";
import { CREDENTIALS_KEY } from "@/lib/forge-path";
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
  isCredentialWhen,
  cutCredential,
} from "@/lib/finish-gate";
import { SAMPLE_POSTING_LABEL, pickSamplePostings } from "@/lib/sample-postings";
import { DefendPanel, type CardActions } from "@/components/forge/finish/DefendPanel";
import { DownloadBox } from "@/components/forge/finish/DownloadBox";
import { EmailPackageBox } from "@/components/forge/finish/EmailPackageBox";
import { CheckSection } from "@/components/forge/finish/CheckSection";
import { FinishTour, type TourStep } from "@/components/forge/finish/FinishTour";
import { GroundingNote, groundingOpenCount, readGrounding } from "@/components/forge/finish/GroundingNote";
import { NextStep, ReviewAsk } from "@/components/forge/finish/NextStep";
import { StorySection, type ForgeOutput } from "@/components/forge/finish/StorySection";

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
  const router = useRouter();
  const { session, updateSession } = useForgeSession();
  const isDemo = session.isDemo === true;
  const audience = session.audience || "client";
  const output = (session.forgeOutput as ForgeOutput) || {};

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
  const [resumeText, setResumeText] = useState<string>("");
  // Lines about time inside that the writer held back (never silently), and
  // whether the person chose to put them back as written.
  const [withheldLines, setWithheldLines] = useState<string[]>([]);
  const [keepInsideLines, setKeepInsideLines] = useState(false);
  const [coverLetterText, setCoverLetterText] = useState<string>("");
  const [grounding, setGrounding] = useState<unknown>(null);
  // The writer's documents exactly as delivered; never edited (see finish-gate WrittenDocs).
  const [written, setWritten] = useState<WrittenDocs | null>(null);
  const [defendAnswers, setDefendAnswers] = useState<DefendAnswer[]>([]);
  // Skill terms the person added from a job posting; each is asked about.
  const [addedTerms, setAddedTerms] = useState<string[]>([]);
  // Skills kept on the "added for you" card (D3), credentials confirmed in the person's own words (D4).
  const [keptTerms, setKeptTerms] = useState<string[]>([]);
  const [confirmedCredentials, setConfirmedCredentials] = useState<CredentialConfirm[]>([]);
  const [docError, setDocError] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [downloadError, setDownloadError] = useState("");
  const [copied, setCopied] = useState("");

  // Back on this page in the same run: show the same documents and answers
  // instead of writing new ones (a new AI call, and the answers would no
  // longer match the lines).
  useEffect(() => {
    if (hydrated.current || !session.forgeOutput) return;
    hydrated.current = true;
    const raw = session.forgeFinish as { docs?: { keepInsideLines?: boolean } } | undefined;
    const keep = raw?.docs?.keepInsideLines === true;
    const stored = readStoredFinish(raw, finishKey(session, keep));
    if (!stored) return;
    hasStarted.current = true;
    setResumeText(stored.docs.resumeText);
    setCoverLetterText(stored.docs.coverLetterText);
    setWithheldLines(stored.docs.withheldLines);
    setKeepInsideLines(stored.docs.keepInsideLines);
    setGrounding(stored.docs.grounding);
    setWritten(stored.docs.written ?? null);
    setDefendAnswers(stored.defendAnswers);
    setAddedTerms(stored.addedTerms ?? []);
    setKeptTerms(stored.keptTerms ?? []);
    setConfirmedCredentials(stored.confirmedCredentials ?? []);
    setDocState("done");
  }, [session]);

  // Keep the documents and answers with the run (browser only).
  useEffect(() => {
    if (docState !== "done" || !resumeText) return;
    updateSession({
      forgeFinish: {
        v: FINISH_STATE_VERSION,
        key: finishKey(session, keepInsideLines),
        docs: { resumeText, coverLetterText, withheldLines, keepInsideLines, grounding, written: written ?? undefined },
        defendAnswers,
        addedTerms,
        keptTerms,
        confirmedCredentials,
      },
    });
    // session is read for its key fields only; writing must not loop on it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docState, resumeText, coverLetterText, withheldLines, keepInsideLines, grounding, written, defendAnswers, addedTerms, keptTerms, confirmedCredentials, updateSession]);

  const generateDocs = useCallback(async () => {
    if (hasStarted.current) return;
    if (docState === "generating" || docState === "done") return;
    hasStarted.current = true;
    setDocState("generating");
    setDocError("");
    setGrounding(null);

    try {
      const response = await fetch("/api/forge/generate-docs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          narrative: output.narrative,
          strengths: output.strengths,
          skills: output.skills,
          career_paths: output.career_paths,
          barriers: output.barriers,
          resumeText: session.resumeText,
          goals: session.goals,
          goalNarrative: session.goalNarrative,
          credentialsNote: session.challengeNarratives?.[CREDENTIALS_KEY],
          preferences: session.preferences,
          readinessStage: session.readinessStage,
          resumeConfidence: session.resumeConfidence,
          resumeWorries: session.resumeWorries,
          keepInsideLines,
        }),
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || "Document generation failed");
      }

      const data = await response.json();
      setResumeText(data.resume || "");
      setCoverLetterText(data.coverLetter || "");
      setWithheldLines(Array.isArray(data.withheldLines) ? data.withheldLines.filter((l: unknown) => typeof l === "string") : []);
      setGrounding(data.grounding ?? null);
      setWritten({ resume: data.resume || "", letter: data.coverLetter || "" });
      // New documents: earlier answers belonged to other lines.
      setDefendAnswers([]);
      setAddedTerms([]);
      setKeptTerms([]);
      setConfirmedCredentials([]);
      setDocState("done");
    } catch (err: unknown) {
      console.error("Doc generation error:", err);
      setDocError("Something went wrong writing your documents.");
      setDocState("error");
      hasStarted.current = false;
    }
  }, [docState, output, session.resumeText, session.goals, session.goalNarrative, session.preferences, session.readinessStage, session.resumeConfidence, session.resumeWorries, keepInsideLines]);

  // Write the documents when the page loads, unless this run already has them.
  useEffect(() => {
    if (!session.forgeOutput || docState !== "idle") return;
    // Let the stored-copy check run first.
    const t = setTimeout(() => {
      if (!hasStarted.current) generateDocs();
    }, 0);
    return () => clearTimeout(t);
  }, [session.forgeOutput, docState, generateDocs]);

  // ---- the gate ----------------------------------------------------------------
  const ownWords = useMemo(() => ownWordsFor(session, keepInsideLines), [session, keepInsideLines]);
  const view = useMemo(
    () => buildFinishView({ resumeText, ownWords, defendAnswers, coverLetterText, addedTerms, keptTerms, confirmedCredentials, grounding, written }),
    [resumeText, ownWords, defendAnswers, coverLetterText, addedTerms, keptTerms, confirmedCredentials, grounding, written]
  );
  const ready = docState === "done" && !!resumeText;
  const finished = ready && view.state === "finished";

  const groundingNote = useMemo(() => readGrounding(grounding), [grounding]);
  const g = grounding as { verifierRan?: boolean; verifierRanByDoc?: { resume?: boolean; cover_letter?: boolean } } | null;
  // Absent means an older response shape, treated as "ran". An explicit false matters.
  const verifierRan = g?.verifierRan !== false;
  const byDoc = g?.verifierRanByDoc;
  const uncheckedDoc = byDoc && byDoc.resume !== byDoc.cover_letter ? (byDoc.resume === false ? "resume" : "cover letter") : null;

  // Celebrate once, only when the engine says finished.
  const [celebrated, setCelebrated] = useState(false);
  useEffect(() => {
    if (shouldCelebrate({ state: view.state, isDemo, docsReady: ready, alreadyCelebrated: celebrated })) setCelebrated(true);
  }, [view.state, isDemo, ready, celebrated]);

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
    if (!ready) return;
    try {
      if (localStorage.getItem(TOUR_SEEN_KEY) === "1") return;
      localStorage.setItem(TOUR_SEEN_KEY, "1");
    } catch {
      return;
    }
    const t = setTimeout(() => setTourOpen(true), 900);
    return () => clearTimeout(t);
  }, [ready]);

  const tourSteps: TourStep[] = [
    view.state === "finished"
      ? { target: "finish-resume", text: "This is your new resume. It comes first because it's what you came for." }
      : { target: "finish-resume", text: "This is your new resume. It's a draft until you've settled the lines t.ROY asks about. It comes first because it's what you came for." },
    view.state === "finished"
      ? { target: "fix-list", text: "Every line we asked about is checked. You can still change an answer." }
      : { target: "fix-list", text: "These are the lines only you can answer. For each one: say it's true, change it, or cut it. When they're done, your resume is finished." },
    view.state === "finished"
      ? { target: "finish-download", text: "Download your resume and cover letter here, or email them to yourself." }
      : { target: "finish-download", text: "Download here. Until it's finished, every file is marked DRAFT so nobody mistakes it for the final one." },
    { target: "finish-checks", text: "These checks read your page the way a screener would. Open one if you want the details." },
    { target: "finish-story", text: "Your story: your strengths, skills and jobs that fit, from what you told us." },
    { target: "finish-next", text: "When you're ready, the Refinery aims your resume at real jobs." },
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
  const onCut = (group: LineGroup) => {
    if (group.target === "skill") {
      setResumeText((t) => cutTerm(t, group.line));
      setAddedTerms((terms) => terms.filter((x) => x.toLowerCase() !== group.line.toLowerCase()));
      return;
    }
    if (group.target === "letter") setCoverLetterText((t) => cutLine(t, group.line));
    else setResumeText((t) => cutLine(t, group.line));
    setDefendAnswers((a) => recordAnswer(a, group.line, "", "cut"));
  };

  const cardActions: CardActions = {
    onKeepTerm: (term) => setKeptTerms((t) => (t.some((x) => x.toLowerCase() === term.toLowerCase()) ? t : [...t, term])),
    onCutTerm: (term) => {
      setResumeText((t) => cutTerm(t, term));
      setAddedTerms((terms) => terms.filter((x) => x.toLowerCase() !== term.toLowerCase()));
    },
    onConfirmCredential: (group, type, when) => {
      if (!isCredentialWhen(when)) return "when";
      const r = applyConfirmation({ resume: resumeText, letter: coverLetterText }, group.credentialName ?? group.line, type, when);
      if (!r) return "unchanged";
      setResumeText(r.resume);
      setCoverLetterText(r.letter);
      setConfirmedCredentials((c) => [...c.filter((x) => (x.key ?? x.name.toLowerCase()) !== (r.confirm.key ?? r.confirm.name.toLowerCase())), r.confirm]);
      return "ok";
    },
    onCutCredential: (group) => {
      const isLetter = group.target === "letter";
      const next = cutCredential(isLetter ? coverLetterText : resumeText, group.line, group.target === "skill", group.credentialName ?? group.line);
      if (isLetter) setCoverLetterText(next);
      else setResumeText(next);
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

  const draftItems = () => (view.state === "finished" ? undefined : openItemsInPlainWords(view));

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
      downloadPackage({ resumeText, coverLetterText: coverLetterText || undefined, ...downloadMode(view.state), openItems: draftItems() })
    );
  const handleFormat = (format: DownloadFormat) =>
    runDownload(() => downloadResume({ format, kind: "resume", text: resumeText, ...downloadMode(view.state), openItems: draftItems() }));
  const handleLetter = () =>
    runDownload(() =>
      downloadResume({ format: "docx", kind: "cover_letter", text: coverLetterText, resumeText, ...downloadMode(view.state), openItems: draftItems() })
    );
  const handleCopy = (text: string, label: string) => {
    navigator.clipboard?.writeText(text).catch(() => undefined);
    setCopied(label);
    setTimeout(() => setCopied(""), 2000);
  };

  // ---- check summaries -------------------------------------------------------------
  const mintBlocks = view.openItems.filter((i) => i.target === "resume" && !i.trace && i.rule !== "STD-C04" && i.severity === "BLOCK").length;
  const traceBlocks = view.openItems.filter((i) => i.trace && i.severity === "BLOCK").length;
  const discrepancies = useMemo(
    () => (resumeText.trim() ? findDiscrepancies(resumeText, { sourceText: session.resumeText }) : []),
    [resumeText, session.resumeText]
  );
  const samples = useMemo(() => pickSamplePostings(careerPaths.map((c) => c.title || ""), 4), [careerPaths]);

  // If no output, redirect back
  if (!session.forgeOutput) {
    return (
      <div className="flow-center min-h-screen flex flex-col items-center justify-center text-center bg-t-bg">
        <h1 className="text-2xl font-bold mb-4 text-t-white">
          Let&apos;s build your story first
        </h1>
        <p className="text-base text-t-phos-dim mb-6">
          It looks like we haven&apos;t analyzed your information yet.
        </p>
        <button
          onClick={() => router.push("/welcome")}
          className="t-focus px-8 py-4 bg-t-amber text-white text-lg font-bold shadow-[0_3px_8px_rgba(22,26,21,0.15)] hover:bg-t-amber-bright transition-colors min-h-touch"
        >
          Start The Forge
        </button>
      </div>
    );
  }

  const headline =
    docState === "generating" || docState === "idle"
      ? "t.ROY is writing your resume and cover letter."
      : docState === "error"
        ? "Your resume didn't come through."
        : statusLine(view);
  const subline =
    docState === "generating" || docState === "idle"
      ? "This usually takes 30 to 60 seconds."
      : docState === "error"
        ? "Nothing you entered was lost. Try again below."
        : view.state === "finished"
          ? "Download it below, or email it to yourself."
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
            onClick={() => router.push("/welcome")}
            className="mt-2 text-sm text-t-amber-bright underline underline-offset-2 hover:text-t-amber"
          >
            Start your own Forge session
          </button>
        </div>
      )}

      {/* 1. t.ROY's status line and the tour button */}
      <div className="flex flex-wrap items-start gap-3 border border-t-line border-l-[3px] border-l-t-amber bg-t-panel px-4 py-3" data-testid="finish-status">
        <img src="/images/t-roy-icon-badge.webp" alt="" aria-hidden="true" className="mt-0.5 h-8 w-8 shrink-0 rounded-full" />
        <div className="min-w-0 flex-1">
          <h1 className="text-lg font-bold leading-snug text-t-white" data-testid="status-line">{headline}</h1>
          <p className="text-xs text-t-phos-dim">{subline}</p>
          {ready && !verifierRan && (
            <p className="mt-1 text-xs text-t-amber-bright">
              Our second check didn&apos;t run this time. Read every line before you send it.
            </p>
          )}
        </div>
        {ready && (
          <button
            onClick={() => setTourOpen(true)}
            className="t-focus min-h-touch w-full shrink-0 border border-t-line px-3 py-2 text-xs font-medium text-t-phos hover:border-t-phos-dim hover:text-t-white sm:w-auto"
            data-testid="tour-button"
          >
            Show me around
          </button>
        )}
      </div>

      {(docState === "generating" || docState === "idle") && (
        <div className="mt-6 border border-t-line bg-t-panel p-8 text-center">
          <div className="relative mx-auto mb-4 h-10 w-10">
            <div className="absolute inset-0 border-[3px] border-t-line" />
            <div className="absolute inset-0 animate-spin border-[3px] border-t-amber border-t-transparent" />
          </div>
          <p className="text-sm font-medium text-t-amber-bright">Writing your resume and cover letter...</p>
        </div>
      )}

      {docState === "error" && (
        <div className="mt-6 border border-t-red bg-t-panel p-6 text-center">
          <p className="mb-3 text-sm text-t-phos">{docError}</p>
          <button
            onClick={() => {
              hasStarted.current = false;
              setDocState("idle");
            }}
            className="t-focus min-h-touch bg-t-amber px-6 py-3 text-sm font-bold text-white shadow-[0_3px_8px_rgba(22,26,21,0.15)] transition-colors hover:bg-t-amber-bright"
          >
            Try Again
          </button>
        </div>
      )}

      {docState === "done" && (
        <>
          {/* 2. The resume, with the fix questions beside it (under it on a phone) */}
          <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_400px] lg:items-start">
            <div className="min-w-0">
              <div id="finish-resume" className="scroll-mt-20 border border-t-line bg-t-bg p-3 sm:p-4" data-testid="finish-resume">
                {resumeText ? (
                  <ResumePage text={resumeText} draft={view.state !== "finished"} />
                ) : (
                  <p className="text-sm text-t-phos">The resume came back empty. Try again below.</p>
                )}
              </div>

              {withheldLines.length > 0 && !keepInsideLines && (
                <div className="mt-3 border border-t-line bg-t-panel px-4 py-3">
                  <p className="mb-1 text-xs font-bold uppercase text-t-amber-bright">What we left off your resume, and why</p>
                  <p className="text-xs leading-relaxed text-t-phos">
                    These lines mention a record or time inside, so we kept them off your resume and letter. That is the usual Steel Man move: you talk about it in person, at the right time. But if a line is real work you want on the page, it is your call.
                  </p>
                  <ul className="mt-1.5 space-y-1">
                    {withheldLines.map((line, i) => (
                      <li key={i} className="text-[11px] leading-relaxed text-t-phos">&ldquo;{line}&rdquo;</li>
                    ))}
                  </ul>
                  <button
                    onClick={() => {
                      setKeepInsideLines(true);
                      hasStarted.current = false;
                      setDocState("idle");
                    }}
                    className="t-focus mt-2 border border-t-line bg-t-panel px-3 py-1.5 text-xs font-medium text-t-phos transition-colors hover:border-t-phos-dim"
                  >
                    Put them back and rebuild
                  </button>
                </div>
              )}
              {keepInsideLines && (
                <div className="mt-3 border border-t-line bg-t-panel px-4 py-3">
                  <p className="text-xs leading-relaxed text-t-phos">
                    Your resume keeps your own lines about work, training or credentials from inside, the way you wrote them. Nothing about a record was added. Your cover letter talks about the work and leaves the record for you to bring up in person.
                  </p>
                </div>
              )}
            </div>

            <aside className="lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)] lg:overflow-y-auto lg:pr-1">
              <DefendPanel view={view} onAnswer={onAnswer} onChange={onChange} onCut={onCut} actions={cardActions} />
            </aside>
          </div>

          {/* 3. One main action, with the email box and the explainer beside it */}
          <div className="mt-8 grid gap-4 lg:grid-cols-2 lg:items-start">
            <DownloadBox
              view={view}
              busy={busy}
              error={downloadError}
              onDownloadPackage={handlePackage}
              onDownloadFormat={handleFormat}
              onFix={goFix}
              onCopy={() => handleCopy(resumeText, "resume")}
              copied={copied === "resume"}
            />
            {canEmailPackage({ state: view.state, isDemo }) ? (
              <EmailPackageBox
                resumeText={resumeText}
                coverLetterText={coverLetterText}
                narrativeHeadline={narrative.headline || ""}
                narrativeSummary={narrative.summary || ""}
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
              after a finished download only, once per visit, never a popup. */}
          {reviewVisible && (
            <div className="mt-4">
              <ReviewAsk onDismiss={() => setReviewDismissed(true)} />
            </div>
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
                <DiscrepancyPanel resumeText={resumeText} sourceText={session.resumeText} readinessStage={readiness} onApply={setResumeText} />
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
                  sourceText={session.resumeText}
                  onApply={setResumeText}
                  samplePostings={samples}
                  samplePostingLabel={SAMPLE_POSTING_LABEL}
                  onConfirmTerm={(term) => setAddedTerms((t) => (t.some((x) => x.toLowerCase() === term.toLowerCase()) ? t : [...t, term]))}
                />
              </CheckSection>

              <div className="flex min-h-touch flex-wrap items-center justify-between gap-2 border border-t-line bg-t-panel px-4 py-3" data-testid="check-pagefit">
                <span className="text-sm font-semibold text-t-white">Page length</span>
                <PageFitLine text={resumeText} />
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

      {/* 6. Your story (the narrative keeper) */}
      <div className="mt-12">
        <StorySection
          output={output}
          strengthsHeading={rc.strengthsHeading}
          careersHeading={rc.careersHeading}
          reportChecks={reportChecks}
        />
      </div>

      {/* 7. Next step */}
      <div className="mt-12">
        <NextStep
          isDemo={isDemo}
          audience={audience}
          refineryCta={rc.refineryCta}
          refinerySubtext={rc.refinerySubtext}
        />
      </div>
    </div>
  );
}
