"use client";

/**
 * <ResumeBuilder> -- the Forge "Build" stage (Phase 7.2).
 *
 * The structured base-resume surface a user lands on after ingest. Wraps the
 * shared <ResumeEditor> (ONE editor across the Forge builder + the Refinery
 * Application Tailor) with a Forge-appropriate action bar: continue through the
 * rest of the Forge, download .docx, save as PDF, plus the optional AI summary
 * assist.
 *
 * Pre-auth by design: every endpoint it calls (/api/resume-generate,
 * /api/forge/download) works logged-out. Persistence and routing belong to the
 * caller -- ResumeBuilder hands the finished ResumeDocument back via onComplete.
 */

import { useState } from "react";
import {
  type ResumeDocument,
  formatResumeDownload,
} from "@/components/resume/resumeModel";
import { ResumeEditor } from "@/components/resume/ResumeEditor";
import { printResumePdf } from "@/components/resume/resumePrint";
import { ParserPreview } from "@/components/resume/ParserPreview";

interface ResumeBuilderProps {
  initialDoc: ResumeDocument;
  /** Called with the finished resume when the user continues. Caller persists + routes. */
  onComplete: (doc: ResumeDocument) => void;
  /** Return to the ingest path selection (e.g. "this isn't what I uploaded"). */
  onBack: () => void;
}

/** Coaching self-check (never scored -- doctrine). Owning the story is half the job. */
const READINESS_ITEMS = [
  "I can explain every bullet on this resume out loud.",
  "I have a real story behind my strongest experience.",
  "I know why this resume fits the jobs I'm going for.",
  "I know my next step (apply, gather proof, or pick a better-fit role).",
];

/** Heuristic triage: flag thin jobs + weak/unquantified bullets so we can nudge
 *  the workshop where it's most needed -- "most attention to those who need it
 *  most" without a second AI call. */
function assessResume(doc: ResumeDocument): { weak: number; thin: number; show: boolean } {
  let weak = 0;
  let thin = 0;
  for (const e of doc.experience) {
    const filled = e.bullets.filter((b) => b.trim());
    if (e.title.trim() && filled.length < 2) thin++;
    for (const b of filled) {
      if (b.trim().length < 40 && !/\d/.test(b)) weak++;
    }
  }
  return { weak, thin, show: weak + thin > 0 };
}

export function ResumeBuilder({ initialDoc, onComplete, onBack }: ResumeBuilderProps) {
  const [doc, setDoc] = useState<ResumeDocument>(initialDoc);
  const [generating, setGenerating] = useState(false);
  const [showDownloads, setShowDownloads] = useState(false);
  const [aiSuggestion, setAiSuggestion] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [ready, setReady] = useState<Record<number, boolean>>({});

  const assessment = assessResume(doc);

  // --- AI summary assist (optional -- the editor works fully without it) ---
  async function requestSummarySuggestion() {
    setGenerating(true);
    try {
      const existingBullets = doc.experience
        .flatMap((e) => e.bullets)
        .filter((b) => b.trim());
      // Pre-auth endpoint: the Forge builder works logged-out, so it cannot use
      // /api/resume-generate (auth-gated -> 401). /api/forge/* is unprotected.
      const res = await fetch("/api/forge/resume-assist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "suggest_summary",
          targetJob: doc.meta.targetJob,
          existingBullets,
          skills: doc.skills.slice(0, 10),
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setAiSuggestion(data.suggestion);
      }
    } catch {
      // fail quiet -- a summary suggestion is a nicety, never a blocker
    } finally {
      setGenerating(false);
    }
  }

  // --- Download .docx (reuses the Forge DOCX builder) ---
  async function downloadDocx() {
    setDownloading(true);
    try {
      const res = await fetch("/api/forge/download", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content: formatResumeDownload(doc),
          type: "resume",
          format: "docx",
        }),
      });
      if (!res.ok) throw new Error("Download failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const slug = (doc.contact.name || "resume").replace(/\s+/g, "_");
      a.download = `${slug}_Resume_SteelMan.docx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      // fail quiet -- they can still continue and download later
    } finally {
      setDownloading(false);
    }
  }

  // Plain-text export -- the most ATS-safe format (single column, no tables).
  function downloadTxt() {
    const blob = new Blob([formatResumeDownload(doc)], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const slug = (doc.contact.name || "resume").replace(/\s+/g, "_");
    a.download = `${slug}_Resume_SteelMan.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="min-h-screen pt-16 pb-12 bg-t-bg">
      <div className="max-w-5xl mx-auto px-4">
        <button
          onClick={onBack}
          className="t-focus text-sm text-t-phos-dim hover:text-t-amber-bright transition-colors mb-4 inline-flex items-center gap-1 min-h-touch"
        >
          &larr; Start over
        </button>
        <h1 className="text-2xl font-bold text-t-white mb-2">
          Here&apos;s your resume. Let&apos;s make it strong.
        </h1>
        <p className="text-base text-t-phos-dim mb-6 max-w-2xl">
          We organized what you gave us. Check every section and fix anything --
          it&apos;s all yours to edit. This becomes your base resume: the one we
          aim at specific jobs later.
        </p>

        {assessment.show && (
          <div className="mb-5 bg-t-panel border border-t-line p-4">
            <p className="text-sm font-medium text-t-amber-bright mb-0.5">
              A few lines could be stronger.
            </p>
            <p className="text-xs text-t-phos-dim leading-relaxed">
              The best resumes show what you did, with real numbers. Tap{" "}
              <span className="font-medium text-t-phos">Strengthen with help</span> under any
              bullet -- we ask a few questions and turn your answer into a strong
              line. We only ever use what you tell us.
            </p>
          </div>
        )}

        <ResumeEditor
          doc={doc}
          onChange={setDoc}
          onSummaryAssist={requestSummarySuggestion}
          summaryGenerating={generating}
          summarySuggestion={aiSuggestion}
          onUseSummarySuggestion={() => {
            setDoc((d) => ({ ...d, summary: aiSuggestion! }));
            setAiSuggestion(null);
          }}
          actions={
            <>
              <button
                onClick={() => onComplete(doc)}
                className="t-focus px-5 py-3 bg-t-amber text-white font-bold shadow-[0_3px_8px_rgba(22,26,21,0.15)] hover:bg-t-amber-bright transition-colors min-h-touch"
              >
                Looks good -- continue
              </button>
              {/* Downloading here is premature -- the Forge makes this resume
                  significantly better in the next steps. One small control,
                  explained, for people who truly need it now. */}
              <button
                onClick={() => setShowDownloads(!showDownloads)}
                className="t-focus px-3 py-3 text-sm text-t-phos-dim hover:text-t-white transition-colors min-h-touch"
              >
                {showDownloads ? "Hide downloads" : "Need to download it now?"}
              </button>
              {showDownloads && (
                <div className="w-full bg-t-panel-2 border border-t-line p-3 mt-1">
                  <p className="text-xs text-t-phos-dim leading-relaxed mb-2">
                    Heads up: this is the <strong className="text-t-phos">before</strong> version.
                    The next few steps turn it into a much stronger resume and
                    cover letter -- that&apos;s the whole point of the Forge. If
                    you need a copy right now (an appointment today, a program
                    requirement), grab one, then come back and finish.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <button
                      onClick={downloadDocx}
                      disabled={downloading}
                      className="t-focus px-3 py-2 bg-transparent border border-t-amber text-t-amber-bright font-bold hover:bg-t-amber/10 transition-colors text-xs disabled:opacity-50"
                    >
                      {downloading ? "Preparing..." : ".docx (opens in Word)"}
                    </button>
                    <button
                      onClick={() => printResumePdf(doc)}
                      className="t-focus px-3 py-2 bg-transparent border border-t-steel text-t-steel font-bold hover:bg-t-steel/10 transition-colors text-xs"
                    >
                      PDF (keeps formatting)
                    </button>
                    <button
                      onClick={downloadTxt}
                      title="Plain text -- the safest format for online application boxes"
                      className="t-focus px-3 py-2 bg-transparent border border-t-line text-t-phos-dim font-bold hover:text-t-white hover:border-t-phos-dim transition-colors text-xs"
                    >
                      .txt (for online forms)
                    </button>
                  </div>
                </div>
              )}
            </>
          }
          actionsHint="Continue when it looks right -- we carry this through the rest of your Forge and make it stronger."
        />

        {/* Parser preview -- "what a machine reads", the honest ATS view. */}
        <ParserPreview doc={doc} />

        {/* User Readiness -- a coaching checklist, never a score (doctrine). */}
        <div className="mt-8 bg-t-panel border border-t-line p-5 max-w-2xl">
          <h2 className="font-semibold text-t-white mb-1">
            Before you go: are you ready to use this?
          </h2>
          <p className="text-xs text-t-phos-dim mb-3">
            Not a grade -- a gut check. The resume is half of it; owning it is the
            other half.
          </p>
          <div className="space-y-2">
            {READINESS_ITEMS.map((item, i) => (
              <label key={i} className="flex items-start gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={ready[i] || false}
                  onChange={() => setReady((r) => ({ ...r, [i]: !r[i] }))}
                  className="mt-0.5 accent-t-amber w-4 h-4 flex-shrink-0"
                />
                <span className="text-sm text-t-phos">{item}</span>
              </label>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export default ResumeBuilder;
