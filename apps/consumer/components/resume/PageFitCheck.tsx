"use client";

/**
 * Phase 2.5 -- "Check page fit" affordance.
 *
 * Posts the EXACT same plain-text `content` that the Download .docx button sends
 * to /api/forge/download (formatResumeDownload(doc)) to /api/resume/fit-check,
 * so the estimate models precisely what the user downloads. Shows a plain,
 * honest result card.
 *
 * DOCTRINE: this is an ESTIMATE of the Word/DOCX render, labeled as such. It
 * never edits the resume; the ledger is advice a human acts on.
 */

import { useState } from "react";

interface LedgerEntry {
  kind: "omit" | "tighten" | "add";
  message: string;
}

interface FitResponse {
  status: "fits" | "too_short" | "too_long";
  band: "under" | "ok" | "over" | "empty";
  pageCount: number;
  finalPageFullness: number;
  ledger: LedgerEntry[];
  cannotReachBandByLevers: boolean;
}

export function PageFitCheck({ getContent }: { getContent: () => string }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<FitResponse | null>(null);

  async function check() {
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/resume/fit-check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: getContent(), type: "resume" }),
      });
      if (!res.ok) {
        setResult(null);
        setError("Could not check page fit right now. Please try again.");
        return;
      }
      const data = (await res.json()) as FitResponse;
      setResult(data);
    } catch {
      setResult(null);
      setError("Could not check page fit right now. Please try again.");
    } finally {
      setPending(false);
    }
  }

  const pct = result ? Math.round(result.finalPageFullness * 100) : 0;

  let headline = "";
  if (result) {
    if (result.band === "empty") {
      headline = "This resume has no content yet.";
    } else if (result.band === "ok") {
      headline = `Looks good. This resume renders about ${result.pageCount} page${result.pageCount === 1 ? "" : "s"}. The last page is about ${pct}% full.`;
    } else if (result.band === "under") {
      headline = `This resume renders about ${result.pageCount} page${result.pageCount === 1 ? "" : "s"}. The last page is only about ${pct}% full.`;
    } else {
      headline = `This resume renders about ${result.pageCount} pages -- over two. The last page is about ${pct}% full.`;
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={check}
        disabled={pending}
        className="t-focus px-4 py-3 bg-transparent border border-t-steel text-t-steel font-bold hover:bg-t-steel/10 transition-colors min-h-touch text-sm disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {pending ? "Checking..." : "Check page fit"}
      </button>

      <div aria-live="polite" className="empty:hidden">
        {error && (
          <p className="text-sm text-t-red font-medium mt-1">{error}</p>
        )}

        {result && !error && (
          <div className="mt-1 border border-t-steel/30 bg-t-steel/5 p-3 text-sm text-t-white">
            <p className="font-bold">{headline}</p>

            {result.band === "under" && (
              <p className="mt-1">
                Add real achievements to your most recent role, or leave it -- a
                shorter resume is fine. Never invent content to fill space.
              </p>
            )}

            {result.band === "over" && result.ledger.length > 0 && (
              <div className="mt-2">
                <p className="font-medium">
                  To bring it into two pages, you decide what to cut. Nothing is
                  removed for you. Lower-priority items first:
                </p>
                <ul className="mt-1 list-disc pl-5 space-y-1">
                  {result.ledger
                    .filter((e) => e.kind !== "add")
                    .map((e, i) => (
                      <li key={i}>{e.message}</li>
                    ))}
                </ul>
              </div>
            )}

            <p className="mt-2 text-xs text-t-white/60">
              This is an estimate of the Word (.docx) render -- it models the exact
              download page size, margins, and fonts, but is not a pixel-perfect
              Word page count.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
