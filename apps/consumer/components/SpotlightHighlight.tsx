/**
 * SpotlightHighlight -- t.ROY's pointing finger (10x wave, walk-with-me).
 *
 * HighlightHost listens on the highlight bus and rings the requested
 * data-tour element: amber ring, dimmed surroundings (box-shadow cutout),
 * caption card with t.ROY's note. Mounted once in RefineryShell.
 *
 * Renders at z-[60], above the assistant drawer (z-50), so the ring and
 * caption stay visible while t.ROY narrates. pointer-events: none except the
 * dismiss button -- the page stays fully usable. Dismisses on Got it, Escape,
 * route change, or 15s. Reduced-motion safe (no pulse, instant scroll).
 */

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import {
  HIGHLIGHT_EVENT,
  HIGHLIGHT_CLEAR_EVENT,
  findTourElement,
  type HighlightDetail,
} from "@/lib/highlight-bus";

const AUTO_DISMISS_MS = 15000;
const RING_PAD = 8;

interface Box {
  top: number;
  left: number;
  width: number;
  height: number;
}

export function HighlightHost() {
  const [active, setActive] = useState<HighlightDetail | null>(null);
  const [box, setBox] = useState<Box | null>(null);
  const pathname = usePathname();
  const rafRef = useRef<number | null>(null);
  const reducedMotion = useRef(false);

  useEffect(() => {
    reducedMotion.current =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }, []);

  const dismiss = useCallback(() => setActive(null), []);

  // Bus listeners
  useEffect(() => {
    const onHighlight = (e: Event) => {
      const detail = (e as CustomEvent<HighlightDetail>).detail;
      if (detail?.target) setActive(detail);
    };
    const onClear = () => setActive(null);
    window.addEventListener(HIGHLIGHT_EVENT, onHighlight);
    window.addEventListener(HIGHLIGHT_CLEAR_EVENT, onClear);
    return () => {
      window.removeEventListener(HIGHLIGHT_EVENT, onHighlight);
      window.removeEventListener(HIGHLIGHT_CLEAR_EVENT, onClear);
    };
  }, []);

  // Route change dismisses (the target belongs to the old page)
  useEffect(() => {
    setActive(null);
  }, [pathname]);

  // Escape dismisses; 15s auto-dismiss
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") dismiss();
    };
    document.addEventListener("keydown", onKey);
    const timer = setTimeout(dismiss, AUTO_DISMISS_MS);
    return () => {
      document.removeEventListener("keydown", onKey);
      clearTimeout(timer);
    };
  }, [active, dismiss]);

  // Track the element: scroll it into view, then follow it through
  // scroll/resize with a rAF loop (cheap: one getBoundingClientRect per frame)
  useEffect(() => {
    if (!active) {
      setBox(null);
      return;
    }
    const el = findTourElement(active.target);
    if (!el) {
      setActive(null);
      return;
    }
    el.scrollIntoView({
      block: "center",
      behavior: reducedMotion.current ? "auto" : "smooth",
    });

    const track = () => {
      const current = findTourElement(active.target);
      if (!current) {
        setActive(null);
        return;
      }
      const r = current.getBoundingClientRect();
      setBox((prev) => {
        if (
          prev &&
          Math.abs(prev.top - (r.top - RING_PAD)) < 0.5 &&
          Math.abs(prev.left - (r.left - RING_PAD)) < 0.5 &&
          Math.abs(prev.width - (r.width + RING_PAD * 2)) < 0.5 &&
          Math.abs(prev.height - (r.height + RING_PAD * 2)) < 0.5
        ) {
          return prev;
        }
        return {
          top: r.top - RING_PAD,
          left: r.left - RING_PAD,
          width: r.width + RING_PAD * 2,
          height: r.height + RING_PAD * 2,
        };
      });
      rafRef.current = requestAnimationFrame(track);
    };
    rafRef.current = requestAnimationFrame(track);
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [active]);

  if (!active || !box) return null;

  // Caption above or below the ring, whichever has room
  const captionBelow = box.top + box.height + 90 < window.innerHeight;
  const captionTop = captionBelow ? box.top + box.height + 10 : undefined;
  const captionBottom = captionBelow
    ? undefined
    : window.innerHeight - box.top + 10;
  const captionLeft = Math.max(12, Math.min(box.left, window.innerWidth - 292));

  return (
    <div
      className="pointer-events-none fixed inset-0 z-[60]"
      role="presentation"
      aria-hidden="false"
    >
      {/* Ring with dimmed-surroundings cutout */}
      <div
        className={`absolute rounded-[8px] border-2 border-amber-400 ${
          reducedMotion.current ? "" : "animate-pulse"
        }`}
        style={{
          top: box.top,
          left: box.left,
          width: box.width,
          height: box.height,
          boxShadow: "0 0 0 9999px rgba(18, 22, 18, 0.45)",
        }}
      />
      {/* Caption card */}
      <div
        className="pointer-events-auto absolute w-[280px] rounded-[7px] border border-amber-300 bg-[#fdf9ef] p-3 shadow-xl"
        style={{ top: captionTop, bottom: captionBottom, left: captionLeft }}
        role="note"
        aria-label="Assistant is pointing at an element"
      >
        <p className="text-sm leading-snug text-[#3a3a33]">{active.note}</p>
        <button
          type="button"
          onClick={dismiss}
          className="mt-2 rounded-[5px] border border-[#b9cdbd] bg-white px-3 py-1.5 text-xs font-medium text-[#344b38] transition-colors hover:bg-[#e3ede5]"
        >
          Got it
        </button>
      </div>
    </div>
  );
}
