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
import { useTranslations } from "next-intl";
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

/** Coaching self-check (never scored -- doctrine). Owning the story is half the job.
 *  The words live in the catalog (forgeResume.builder.readiness.<key>). */
const READINESS_KEYS = ["explain", "story", "fit", "next"] as const;

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
  const t = useTranslations("forgeResume.builder");
  const tc = useTranslations("common");
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
  // Not a checked, finished version (Phase 5 R1, review L3): marked DRAFT,
  // the same mark the server puts on raw text.
  function downloadTxt() {
    const blob = new Blob([`DRAFT\n\n${formatResumeDownload(doc)}`], { type: "text/plain;charset=utf-8" });
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
          &larr; {tc("actions.startOver")}
        </button>
        <h1 className="text-2xl font-bold text-t-white mb-2">
          {t("title")}
        </h1>
        <p className="text-base text-t-phos-dim mb-6 max-w-2xl">
          {t("intro")}
        </p>

        {assessment.show && (
          <div className="mb-5 bg-t-panel border border-t-line p-4">
            <p className="text-sm font-medium text-t-amber-bright mb-0.5">
              {t("weakTitle")}
            </p>
            <p className="text-xs text-t-phos-dim leading-relaxed">
              {t.rich("weakBody", { b: (chunks) => <span className="font-medium text-t-phos">{chunks}</span> })}
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
                {t("continue")}
              </button>
              {/* Downloading here is premature: the Forge makes this resume
                  stronger in the next steps. It stays available, as a small
                  text link under the main button, for people who need a copy
                  today. */}
              <div className="w-full">
                <button
                  type="button"
                  onClick={() => setShowDownloads(!showDownloads)}
                  aria-expanded={showDownloads}
                  className="t-focus min-h-touch text-sm text-t-phos-dim underline decoration-dotted underline-offset-4 transition-colors hover:text-t-white"
                >
                  {showDownloads ? t("hideDownload") : t("showDownload")}
                </button>
                <p className="text-xs text-t-phos-dim">
                  {t("fullLater")}
                </p>
              </div>
              {showDownloads && (
                <div className="w-full bg-t-panel-2 border border-t-line p-3 mt-1">
                  <p className="text-xs text-t-phos-dim leading-relaxed mb-2">
                    {t.rich("beforeNote", { b: (chunks) => <strong className="text-t-phos">{chunks}</strong> })}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <button
                      onClick={downloadDocx}
                      disabled={downloading}
                      className="t-focus px-3 py-2 bg-transparent border border-t-amber text-t-amber-bright font-bold hover:bg-t-amber/10 transition-colors text-xs disabled:opacity-50"
                    >
                      {downloading ? t("preparing") : t("docx")}
                    </button>
                    <button
                      onClick={() => printResumePdf(doc)}
                      className="t-focus px-3 py-2 bg-transparent border border-t-steel text-t-steel font-bold hover:bg-t-steel/10 transition-colors text-xs"
                    >
                      {t("pdf")}
                    </button>
                    <button
                      onClick={downloadTxt}
                      title={t("txtTitle")}
                      className="t-focus px-3 py-2 bg-transparent border border-t-line text-t-phos-dim font-bold hover:text-t-white hover:border-t-phos-dim transition-colors text-xs"
                    >
                      {t("txt")}
                    </button>
                  </div>
                </div>
              )}
            </>
          }
          actionsHint={t("actionsHint")}
        />

        {/* Parser preview -- "what a machine reads", the honest ATS view. */}
        <ParserPreview doc={doc} />

        {/* User Readiness -- a coaching checklist, never a score (doctrine). */}
        <div className="mt-8 bg-t-panel border border-t-line p-5 max-w-2xl">
          <h2 className="font-semibold text-t-white mb-1">
            {t("readinessTitle")}
          </h2>
          <p className="text-xs text-t-phos-dim mb-3">
            {t("readinessNote")}
          </p>
          <div className="space-y-2">
            {READINESS_KEYS.map((key, i) => (
              <label key={i} className="flex items-start gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={ready[i] || false}
                  onChange={() => setReady((r) => ({ ...r, [i]: !r[i] }))}
                  className="mt-0.5 accent-t-amber w-4 h-4 flex-shrink-0"
                />
                <span className="text-sm text-t-phos">{t(`readiness.${key}`)}</span>
              </label>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export default ResumeBuilder;
