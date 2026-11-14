"use client";

/**
 * "Check page fit" affordance.
 *
 * Posts the same plain-text `content` the download buttons send to
 * /api/resume/layout, which lays the page out with the real font metrics, the
 * same layout the PDF is built from. The result is plain words, never a
 * percentage: "Fits on 1 page", "2 full pages", or "Runs 3 lines onto page 2:
 * cut or tighten".
 *
 * DOCTRINE: it never edits the resume. If lines run over, the person decides
 * what to cut or tighten. Nothing is removed for them, and nothing is invented
 * to fill space.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { useServerText } from "@/components/ServerTextProvider";

interface LayoutResponse {
  pages: number;
  words: string;
  spillLines: number;
  lastPageFill: number;
}

export function PageFitCheck({
  getContent,
  autoCheck = false,
}: {
  /** Run the check on mount instead of waiting for a click. */
  autoCheck?: boolean;
  getContent: () => string;
}) {
  const t = useTranslations("refineryResume.resume.pageFit");
  const ts = useServerText();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<LayoutResponse | null>(null);

  const check = useCallback(async () => {
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/resume/layout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: getContent(), kind: "resume" }),
      });
      if (!res.ok) {
        setResult(null);
        setError(t("error"));
        return;
      }
      setResult((await res.json()) as LayoutResponse);
    } catch {
      setResult(null);
      setError(t("error"));
    } finally {
      setPending(false);
    }
  }, [getContent, t]);

  // Auto-check once, when there is content to check. The page-length rule is a
  // property of the document they are about to send, not advice to go looking for.
  const auto = useRef(false);
  useEffect(() => {
    if (!autoCheck || auto.current) return;
    if (!getContent().trim()) return;
    auto.current = true;
    void check();
  }, [autoCheck, check, getContent]);

  const runsOver = result !== null && result.pages > 1 && result.spillLines <= 8;

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={check}
        disabled={pending}
        className="t-focus px-4 py-3 bg-transparent border border-t-steel text-t-steel font-bold hover:bg-t-steel/10 transition-colors min-h-touch text-sm disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {pending ? t("checking") : t("check")}
      </button>

      <div aria-live="polite" className="empty:hidden">
        {error && <p className="text-sm text-t-red font-medium mt-1">{error}</p>}

        {result && !error && (
          <div className="mt-1 border border-t-steel/30 bg-t-steel/5 p-3 text-sm text-t-white">
            <p className="font-bold" data-testid="page-fit-words">
              {ts(result.words)}
            </p>
            {runsOver && (
              <p className="mt-1">
                {t("decide")}
              </p>
            )}
            <p className="mt-2 text-xs text-t-white/60">
              {t("counted")}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
