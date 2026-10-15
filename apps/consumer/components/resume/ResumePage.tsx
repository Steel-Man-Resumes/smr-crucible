"use client";

/**
 * The on-screen resume page: the same layout, fonts and CSS as the PDF and the
 * HTML download. The server lays the pages out (it holds the font files and the
 * layout model) and this component draws what comes back, scaled to the width
 * of its container, so phone and desktop both show the whole page.
 *
 * Props: text (the resume as the Forge writes it), draft (true puts the same
 * small DRAFT line on every page that the downloads carry).
 *
 * It shows words the layout did not change: what you see is what downloads.
 */

import { useEffect, useRef, useState } from "react";

const PAGE_PX = 816; // 8.5 in at 96 dpi

interface Screen {
  css: string;
  pagesHtml: string;
  /** The request this layout was drawn for. A layout is only shown for its own text. */
  forKey: string;
}

export function ResumePage({
  text,
  draft = false,
  kind = "resume",
  headerText,
}: {
  text: string;
  draft?: boolean;
  kind?: "resume" | "cover_letter";
  /** Cover letters only: the resume text, for the name and contact line on top. */
  headerText?: string;
}) {
  const [screen, setScreen] = useState<Screen | null>(null);
  // The key of the request that last failed. The page shows the plain text whenever
  // the latest request for the CURRENT text failed, so what is on screen always
  // matches what downloads, never an older layout with older words.
  const [failedKey, setFailedKey] = useState<string | null>(null);
  const [scale, setScale] = useState(1);
  const [innerH, setInnerH] = useState(0);
  const outer = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const seq = useRef(0);

  const key = JSON.stringify([text, draft, kind, headerText ?? ""]);

  useEffect(() => {
    if (!text.trim()) {
      setScreen(null);
      return;
    }
    const mine = ++seq.current;
    const timer = setTimeout(async () => {
      try {
        const res = await fetch("/api/resume/layout", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text, kind, draft, headerText, screen: true }),
        });
        if (!res.ok) throw new Error("layout failed");
        const data = (await res.json()) as Partial<Screen>;
        if (mine !== seq.current) return;
        if (typeof data.css === "string" && typeof data.pagesHtml === "string") {
          setScreen({ css: data.css, pagesHtml: data.pagesHtml, forKey: key });
          setFailedKey(null);
        } else {
          setFailedKey(key);
        }
      } catch {
        if (mine === seq.current) setFailedKey(key);
      }
    }, 200);
    return () => clearTimeout(timer);
  }, [text, draft, kind, headerText, key]);

  // Scale the 8.5 in page to the container width (never wider than the page itself).
  useEffect(() => {
    const el = outer.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const apply = () => {
      const w = el.clientWidth;
      if (w > 0) setScale(Math.min(1, w / PAGE_PX));
    };
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const el = inner.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const apply = () => setInnerH(el.scrollHeight);
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    return () => ro.disconnect();
  }, [screen]);

  if (!text.trim()) return null;

  if (failedKey === key) {
    // The layout for this exact text is unavailable: show the words plainly, with one
    // line saying so. Never leave an older page on screen.
    return (
      <div data-testid="resume-page-fallback">
        <p className="mb-2 text-sm text-t-white/80">Couldn&apos;t redraw the page. This is your current text.</p>
        <div className="border border-t-steel/30 bg-t-panel p-4 text-sm text-t-white whitespace-pre-wrap">{text}</div>
      </div>
    );
  }

  const stale = screen !== null && screen.forKey !== key;

  return (
    <div ref={outer} className="w-full" data-testid="resume-page" aria-busy={stale} style={{ opacity: stale ? 0.55 : 1, transition: "opacity 120ms" }}>
      {screen ? (
        <div style={{ height: innerH ? innerH * scale : undefined, overflow: "hidden" }}>
          <style>{screen.css}</style>
          <div
            ref={inner}
            className="rr"
            style={{ width: PAGE_PX, transform: `scale(${scale})`, transformOrigin: "top left" }}
            dangerouslySetInnerHTML={{ __html: screen.pagesHtml }}
          />
        </div>
      ) : (
        <p className="text-sm text-t-white/70">Laying out your page...</p>
      )}
    </div>
  );
}
