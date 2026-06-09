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
    <div className="min-h-screen pt-16 pb-12">
      <div className="max-w-5xl mx-auto px-4">
        <button
          onClick={onBack}
          className="text-sm text-muted hover:text-foreground transition-colors mb-4 inline-flex items-center gap-1 min-h-touch"
        >
          &larr; Start over
        </button>
        <h1 className="text-2xl font-bold text-foreground mb-2">
          Here&apos;s your resume. Let&apos;s make it strong.
        </h1>
        <p className="text-body text-muted mb-6 max-w-2xl">
          We organized what you gave us. Check every section and fix anything --
          it&apos;s all yours to edit. This becomes your base resume: the one we
          aim at specific jobs later.
        </p>

        {assessment.show && (
          <div className="mb-5 bg-warm-50 border border-warm-200 rounded-xl p-4">
            <p className="text-sm font-medium text-earth-700 mb-0.5">
              A few lines could be stronger.
            </p>
            <p className="text-xs text-earth-600 leading-relaxed">
              The best resumes show what you did, with real numbers. Tap{" "}
              <span className="font-medium">Strengthen with help</span> under any
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
                className="px-5 py-3 bg-sage-600 text-white rounded-xl font-medium hover:bg-sage-700 transition-colors min-h-touch"
              >
                Looks good -- continue
              </button>
              <button
                onClick={downloadDocx}
                disabled={downloading}
                className="px-4 py-3 bg-white border-2 border-sage-600 text-sage-600 rounded-xl font-medium hover:bg-sage-50 transition-colors min-h-touch text-sm disabled:opacity-50"
              >
                {downloading ? "Preparing..." : "Download .docx"}
              </button>
              <button
                onClick={() => printResumePdf(doc)}
                className="px-4 py-3 bg-white border-2 border-sky-500 text-sky-600 rounded-xl font-medium hover:bg-sky-50 transition-colors min-h-touch text-sm"
              >
                Save as PDF
              </button>
              <button
                onClick={downloadTxt}
                title="Plain text -- the safest format for online application boxes"
                className="px-4 py-3 bg-white border-2 border-border text-muted rounded-xl font-medium hover:bg-gray-50 transition-colors min-h-touch text-sm"
              >
                Download .txt
              </button>
            </>
          }
          actionsHint=".docx opens in Word. PDF keeps the formatting. Continue when it looks right -- we carry this through the rest of your Forge."
        />

        {/* User Readiness -- a coaching checklist, never a score (doctrine). */}
        <div className="mt-8 bg-white border border-border rounded-2xl p-5 max-w-2xl">
          <h2 className="font-semibold text-foreground mb-1">
            Before you go: are you ready to use this?
          </h2>
          <p className="text-xs text-muted mb-3">
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
                  className="mt-0.5 accent-sage-600 w-4 h-4 flex-shrink-0"
                />
                <span className="text-sm text-foreground">{item}</span>
              </label>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export default ResumeBuilder;
