// L5-STUB: replaced at merge
"use client";

/**
 * Thin stand-in for the renderer lane's <PageFitLine>: one plain line from the
 * existing page-fit estimate, page count only, no percentage. The real
 * component (page count from the real file) replaces this file at merge.
 */

import { useEffect, useState } from "react";

export function PageFitLine({ text }: { text: string }) {
  const [line, setLine] = useState<string>("");

  useEffect(() => {
    if (!text.trim()) return;
    let live = true;
    const t = setTimeout(async () => {
      try {
        const res = await fetch("/api/resume/fit-check", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content: text, type: "resume" }),
        });
        if (!res.ok) throw new Error();
        const data = (await res.json()) as { pageCount?: number; band?: string };
        if (!live) return;
        const n = data.pageCount ?? 0;
        setLine(
          data.band === "over"
            ? `Runs past two pages. Cut or tighten before you send it.`
            : n === 1
              ? "Fits on 1 page."
              : `About ${n} pages.`
        );
      } catch {
        if (live) setLine("Page count is not available right now.");
      }
    }, 400);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [text]);

  if (!line) return null;
  return <p className="text-xs text-t-phos">{line}</p>;
}
