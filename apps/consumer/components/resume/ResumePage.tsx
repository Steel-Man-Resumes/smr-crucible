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
  const [failed, setFailed] = useState(false);
  const [scale, setScale] = useState(1);
  const [innerH, setInnerH] = useState(0);
  const outer = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const seq = useRef(0);

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
          setScreen({ css: data.css, pagesHtml: data.pagesHtml });
          setFailed(false);
        }
      } catch {
        if (mine === seq.current) setFailed(true);
      }
    }, 200);
    return () => clearTimeout(timer);
  }, [text, draft, kind, headerText]);

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

  if (failed && !screen) {
    // The layout is unavailable: show the words plainly so nothing is hidden.
    return (
      <div className="border border-t-steel/30 bg-t-panel p-4 text-sm text-t-white whitespace-pre-wrap" data-testid="resume-page-fallback">
        {text}
      </div>
    );
  }

  return (
    <div ref={outer} className="w-full" data-testid="resume-page">
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
