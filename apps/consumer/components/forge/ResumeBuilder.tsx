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

export function ResumeBuilder({ initialDoc, onComplete, onBack }: ResumeBuilderProps) {
  const [doc, setDoc] = useState<ResumeDocument>(initialDoc);
  const [generating, setGenerating] = useState(false);
  const [aiSuggestion, setAiSuggestion] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);

  // --- AI summary assist (optional -- the editor works fully without it) ---
  async function requestSummarySuggestion() {
    setGenerating(true);
    try {
      const existingBullets = doc.experience
        .flatMap((e) => e.bullets)
        .filter((b) => b.trim());
      const res = await fetch("/api/resume-generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targetJob: doc.meta.targetJob,
          targetCompany: doc.meta.targetCompany,
          existingBullets,
          skills: doc.skills.slice(0, 10),
          action: "suggest_summary",
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
            </>
          }
          actionsHint=".docx opens in Word. PDF keeps the formatting. Continue when it looks right -- we carry this through the rest of your Forge."
        />
      </div>
    </div>
  );
}

export default ResumeBuilder;
