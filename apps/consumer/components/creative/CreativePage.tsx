"use client";

/**
 * The on-screen artist resume or bio card: the same layout, fonts and CSS as
 * the PDF, laid out on the server from the model the screen holds, scaled to
 * the container. Reports the page count (for the page cap check).
 */

import { useEffect, useRef, useState } from "react";

const PAGE_PX = 816;

export function CreativePage({
  request,
  onPages,
  fallbackText,
}: {
  /** The render request body (doc + model or card + draft + openItems). */
  request: Record<string, unknown>;
  onPages?: (n: number) => void;
  /** Shown plainly if the layout is unavailable, so nothing is hidden. */
  fallbackText: string;
}) {
  const [screen, setScreen] = useState<{ css: string; pagesHtml: string } | null>(null);
  const [failed, setFailed] = useState(false);
  const [scale, setScale] = useState(1);
  const [innerH, setInnerH] = useState(0);
  const outer = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const seq = useRef(0);
  const key = JSON.stringify(request);

  useEffect(() => {
    const mine = ++seq.current;
    const t = setTimeout(async () => {
      try {
        const res = await fetch("/api/creative/layout", { method: "POST", headers: { "Content-Type": "application/json" }, body: key });
        if (!res.ok) throw new Error("layout");
        const d = await res.json();
        if (mine !== seq.current) return;
        if (typeof d.css === "string" && typeof d.pagesHtml === "string") {
          setScreen({ css: d.css, pagesHtml: d.pagesHtml });
          setFailed(false);
          if (typeof d.pages === "number") onPages?.(d.pages);
        }
      } catch {
        if (mine === seq.current) setFailed(true);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [key, onPages]);

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

  if (failed && !screen) {
    return (
      <pre className="border border-t-line bg-t-panel p-4 text-sm text-t-white whitespace-pre-wrap font-sans" data-testid="creative-page-fallback">
        {fallbackText}
      </pre>
    );
  }
  return (
    <div ref={outer} className="w-full" data-testid="creative-page">
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
        <p className="text-sm text-t-phos-dim">Laying out your page...</p>
      )}
    </div>
  );
}
