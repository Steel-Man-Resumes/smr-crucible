"use client";

/**
 * One plain line about page length, read from the real PDF layout:
 *   "Fits on 1 page", "2 full pages", or "Runs 3 lines onto page 2: cut or tighten".
 *
 * The layout runs on the server (it needs the font files), so this asks
 * /api/resume/layout. The words are the same ones the PDF is built from, never
 * a percentage and never an estimate of a different file. It does not edit the
 * resume: the person decides what to cut.
 */

import { useEffect, useRef, useState } from "react";

const cache = new Map<string, { words: string; pages: number | null }>();

export function PageFitLine({
  text,
  kind = "resume",
  className = "",
  onPages,
}: {
  text: string;
  kind?: "resume" | "cover_letter";
  className?: string;
  /** The measured page count (null until known, or when it could not be measured). */
  onPages?: (pages: number | null) => void;
}) {
  const [words, setWords] = useState<string>("");
  const [failed, setFailed] = useState(false);
  const seq = useRef(0);

  useEffect(() => {
    const body = text.trim();
    if (!body) {
      setWords("");
      setFailed(false);
      onPages?.(null);
      return;
    }
    const key = `${kind}\u0000${body}`;
    const hit = cache.get(key);
    if (hit) {
      setWords(hit.words);
      setFailed(false);
      onPages?.(hit.pages);
      return;
    }
    onPages?.(null);
    const mine = ++seq.current;
    const timer = setTimeout(async () => {
      try {
        const res = await fetch("/api/resume/layout", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text, kind }),
        });
        if (!res.ok) throw new Error("layout failed");
        const data = (await res.json()) as { words?: string; pages?: number };
        if (mine !== seq.current) return;
        if (typeof data.words === "string") {
          const pages = typeof data.pages === "number" ? data.pages : null;
          cache.set(key, { words: data.words, pages });
          setWords(data.words);
          setFailed(false);
          onPages?.(pages);
        }
      } catch {
        if (mine === seq.current) setFailed(true);
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [text, kind]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!text.trim()) return null;
  return (
    <p
      aria-live="polite"
      className={`text-sm font-medium text-t-white ${className}`}
      data-testid="page-fit-line"
    >
      {failed ? "We could not count the pages just now." : words || "Counting pages..."}
    </p>
  );
}
