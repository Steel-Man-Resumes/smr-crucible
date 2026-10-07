"use client";

/**
 * The one main action. Finished: download the package. Draft: "Fix N things
 * with t.ROY", with a plain way to download the marked draft anyway (nobody
 * leaves empty-handed). Single formats and the PDF-or-Word explainer sit
 * under it, collapsed.
 */

import { useState } from "react";
import { PDF_WORD_EXPLAINER, mainActionLabel, type FinishView } from "@/lib/finish-gate";
import type { DownloadFormat } from "@/lib/resume-download";

export function DownloadBox({
  view,
  busy,
  error,
  onDownloadPackage,
  onDownloadFormat,
  onFix,
  onCopy,
  copied,
}: {
  view: Pick<FinishView, "state" | "fixCount">;
  busy: boolean;
  error: string;
  onDownloadPackage: () => void;
  onDownloadFormat: (format: DownloadFormat) => void;
  onFix: () => void;
  /** Copy the resume as plain text, for job sites with a paste box. */
  onCopy: () => void;
  copied: boolean;
}) {
  const finished = view.state === "finished";
  const [showDraftOptions, setShowDraftOptions] = useState(false);

  return (
    <div id="finish-download" className="scroll-mt-20 border border-t-line bg-t-panel p-4" data-testid="finish-download">
      {finished ? (
        <>
          <button
            onClick={onDownloadPackage}
            disabled={busy}
            className="t-focus min-h-touch w-full bg-t-amber px-5 py-3 text-base font-bold text-white transition-colors hover:bg-t-amber-bright disabled:opacity-60"
            data-testid="main-action"
          >
            {busy ? "Getting your files ready..." : mainActionLabel(view)}
          </button>
          <p className="mt-2 text-center text-xs text-t-phos-dim">Your resume and cover letter, ready to send.</p>
        </>
      ) : (
        <>
          <button
            onClick={onFix}
            className="t-focus min-h-touch w-full bg-t-amber px-5 py-3 text-base font-bold text-white transition-colors hover:bg-t-amber-bright"
            data-testid="main-action"
          >
            {mainActionLabel(view)}
          </button>
          <p className="mt-2 text-center text-xs text-t-phos-dim">
            Need it now?{" "}
            <button
              onClick={() => {
                setShowDraftOptions(true);
                onDownloadPackage();
              }}
              disabled={busy}
              className="t-focus underline underline-offset-2 hover:text-t-white disabled:opacity-60"
              data-testid="draft-download"
            >
              {busy ? "Getting your files ready..." : "Download the draft"}
            </button>
            . It&apos;s marked DRAFT and lists what&apos;s left to fix.
          </p>
        </>
      )}

      {error && <p className="mt-2 text-center text-xs text-t-amber-bright">{error}</p>}

      <details className="mt-3 border-t border-t-line pt-3" open={showDraftOptions || undefined}>
        <summary className="t-focus cursor-pointer text-xs text-t-phos underline decoration-dotted underline-offset-2">
          Just the resume, in one format
        </summary>
        <div className="mt-2 flex flex-wrap gap-2">
          {(
            [
              ["pdf", "PDF"],
              ["docx", "Word (.docx)"],
              ["html", "Web page (.html)"],
            ] as [DownloadFormat, string][]
          ).map(([f, label]) => (
            <button
              key={f}
              onClick={() => onDownloadFormat(f)}
              disabled={busy}
              className="t-focus min-h-touch border border-t-line bg-t-panel px-3 py-2 text-xs font-medium text-t-phos transition-colors hover:border-t-phos-dim hover:text-t-white disabled:opacity-60"
            >
              {label}
            </button>
          ))}
          {finished && (
          <button
            onClick={onCopy}
            className="t-focus min-h-touch border border-t-line bg-t-panel px-3 py-2 text-xs font-medium text-t-phos transition-colors hover:border-t-phos-dim hover:text-t-white"
          >
            {copied ? "Copied" : "Copy as plain text"}
          </button>
          )}
        </div>
        {!finished && (
          <p className="mt-2 text-[11px] text-t-phos-dim">Until it&apos;s finished, every file is marked DRAFT.</p>
        )}
      </details>

      <details className="mt-3 border-t border-t-line pt-3" data-testid="pdf-word-explainer">
        <summary className="t-focus cursor-pointer text-xs text-t-phos underline decoration-dotted underline-offset-2">
          {PDF_WORD_EXPLAINER.heading}
        </summary>
        <div className="mt-2 space-y-1.5">
          {PDF_WORD_EXPLAINER.lines.map((l) => (
            <p key={l} className="text-xs leading-relaxed text-t-phos">
              {l}
            </p>
          ))}
        </div>
      </details>
    </div>
  );
}
