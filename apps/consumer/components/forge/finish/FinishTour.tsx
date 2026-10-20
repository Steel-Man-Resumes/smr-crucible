"use client";

/**
 * A short t.ROY tour of the finish page: what each part is and what to do
 * with it. Opens by itself once (the first time the resume is on screen), can
 * be skipped or stepped back at any point, remembers it was seen, and can be
 * replayed from the status line.
 *
 * Troy 2026-10-20: it takes the person to each part, dims the rest, and zooms
 * a bright frame onto the part it is talking about. The card sits beside the
 * part (never on it) and can be dragged out of the way.
 */

import { TroyMark } from "@crucible/consumer-ui";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

export interface TourStep {
  /** Element id on the page. Steps whose element is missing are skipped. */
  target: string;
  text: string;
  /** A short heading for the step. */
  title?: string;
}

interface Box {
  top: number;
  left: number;
  width: number;
  height: number;
}

const PAD = 8;
const CARD_W = 340;

function boxOf(el: HTMLElement): Box {
  const r = el.getBoundingClientRect();
  return { top: r.top - PAD, left: r.left - PAD, width: r.width + PAD * 2, height: r.height + PAD * 2 };
}

/** Where the card sits so it never covers the framed part: beside it, above it, or below it. */
export function cardPosition(box: Box, vw: number, vh: number, cardH = 190): { top: number; left: number } {
  const margin = 12;
  const w = Math.min(CARD_W, vw - margin * 2);
  const clampLeft = (x: number) => Math.max(margin, Math.min(x, vw - w - margin));
  const clampTop = (y: number) => Math.max(margin, Math.min(y, vh - cardH - margin));
  const spaceBelow = vh - (box.top + box.height);
  const spaceAbove = box.top;
  const spaceRight = vw - (box.left + box.width);
  const spaceLeft = box.left;
  // A narrow part with room beside it: put the card next to it.
  if (spaceRight >= w + margin * 2) return { left: box.left + box.width + margin, top: clampTop(Math.max(box.top, margin)) };
  if (spaceLeft >= w + margin * 2) return { left: box.left - w - margin, top: clampTop(Math.max(box.top, margin)) };
  if (spaceBelow >= cardH + margin * 2) return { left: clampLeft(box.left), top: box.top + box.height + margin };
  if (spaceAbove >= cardH + margin * 2) return { left: clampLeft(box.left), top: box.top - cardH - margin };
  // The part fills the screen: the card goes in the bottom corner, and can be dragged.
  return { left: vw - w - margin, top: vh - cardH - margin };
}

export function FinishTour({
  open,
  steps,
  onClose,
}: {
  open: boolean;
  steps: TourStep[];
  onClose: () => void;
}) {
  const live = steps.filter((s) => typeof document !== "undefined" && document.getElementById(s.target));
  const [i, setI] = useState(0);
  const [box, setBox] = useState<Box | null>(null);
  const [drag, setDrag] = useState<{ top: number; left: number } | null>(null);
  const [reduced, setReduced] = useState(true);
  // Where focus was before the tour took it, so closing gives it back.
  const returnTo = useRef<HTMLElement | null>(null);
  const nextRef = useRef<HTMLButtonElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const dragStart = useRef<{ px: number; py: number; x: number; y: number } | null>(null);

  useEffect(() => {
    if (open) {
      setI(0);
      setDrag(null);
      setReduced(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? true);
      const active = document.activeElement;
      returnTo.current = active instanceof HTMLElement && active !== document.body ? active : null;
    }
  }, [open]);

  const close = useCallback(() => {
    onClose();
    const back = returnTo.current;
    returnTo.current = null;
    // After the card unmounts, put focus back where the person was.
    setTimeout(() => back?.focus({ preventScroll: true }), 0);
  }, [onClose]);

  // Escape closes; the arrow keys step.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        close();
      } else if (e.key === "ArrowRight") setI((n) => Math.min(n + 1, Math.max(0, live.length - 1)));
      else if (e.key === "ArrowLeft") setI((n) => Math.max(0, n - 1));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, close, live.length]);

  // Take the person to the part, then keep the frame on it as the page moves.
  useLayoutEffect(() => {
    if (!open) {
      setBox(null);
      return;
    }
    const step = live[i];
    const el = step ? document.getElementById(step.target) : null;
    if (!el) return;
    setDrag(null);
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    // A part taller than the screen is framed from its top; a short one is centred.
    const tall = el.getBoundingClientRect().height > window.innerHeight * 0.7;
    el.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: tall ? "start" : "center" });
    let raf = 0;
    const track = () => {
      setBox(boxOf(el));
      raf = requestAnimationFrame(track);
    };
    raf = requestAnimationFrame(track);
    // Stop polling shortly after the scroll settles; scroll and resize keep it in step after that.
    const stop = setTimeout(() => cancelAnimationFrame(raf), reduce ? 50 : 900);
    const update = () => setBox(boxOf(el));
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    nextRef.current?.focus({ preventScroll: true });
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(stop);
      window.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
    // live is derived from steps; i and open drive the step.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, i]);

  if (!open || live.length === 0) return null;
  const step = live[Math.min(i, live.length - 1)];
  const last = i >= live.length - 1;
  const vw = typeof window === "undefined" ? 1024 : window.innerWidth;
  const vh = typeof window === "undefined" ? 768 : window.innerHeight;
  const auto = box ? cardPosition(box, vw, vh, cardRef.current?.offsetHeight ?? 190) : { left: Math.max(12, vw - CARD_W - 12), top: Math.max(12, vh - 200) };
  const pos = drag ?? auto;
  const w = Math.min(CARD_W, vw - 24);

  return (
    <>
      {/* Dims the page except the framed part; the frame zooms in from a little larger. */}
      {box && (
        <div
          aria-hidden="true"
          data-testid="tour-spotlight"
          className="pointer-events-none fixed z-[58] border-2 border-t-amber"
          style={{
            top: box.top,
            left: box.left,
            width: box.width,
            height: box.height,
            boxShadow: "0 0 0 9999px rgba(8, 10, 8, 0.58)",
            transition: reduced ? "none" : "top 420ms ease, left 420ms ease, width 420ms ease, height 420ms ease",
          }}
        />
      )}
      <div
        ref={cardRef}
        role="dialog"
        aria-modal="false"
        aria-label="Tour of this page"
        data-testid="finish-tour"
        className="fixed z-[60] border border-t-amber bg-t-panel-2 shadow-[0_8px_24px_rgba(0,0,0,0.35)]"
        style={{ top: pos.top, left: pos.left, width: w, transition: reduced || drag ? "none" : "top 420ms ease, left 420ms ease" }}
      >
        {/* The card can be moved: drag the bar, or use the arrow buttons at the page's edge. */}
        <div
          className="flex cursor-grab touch-none items-center justify-between gap-2 border-b border-t-line px-3 py-1.5 active:cursor-grabbing"
          onPointerDown={(e) => {
            (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
            dragStart.current = { px: e.clientX, py: e.clientY, x: pos.left, y: pos.top };
          }}
          onPointerMove={(e) => {
            const s = dragStart.current;
            if (!s) return;
            setDrag({
              left: Math.max(4, Math.min(s.x + e.clientX - s.px, vw - w - 4)),
              top: Math.max(4, Math.min(s.y + e.clientY - s.py, vh - 80)),
            });
          }}
          onPointerUp={() => (dragStart.current = null)}
          data-testid="tour-drag"
        >
          <p className="text-[11px] font-bold uppercase tracking-wide text-t-phos-dim">
            t.ROY &middot; {i + 1} of {live.length} &middot; drag to move
          </p>
          <button onClick={close} aria-label="Close the tour" className="t-focus min-h-touch px-1 text-sm text-t-phos-dim hover:text-t-white">
            &times;
          </button>
        </div>
        <div className="flex items-start gap-3 p-4">
          <TroyMark size={28} className="mt-0.5 shrink-0" />
          <div className="min-w-0">
            {step.title && <p className="text-sm font-bold text-t-white">{step.title}</p>}
            <p className="mt-1 text-sm leading-relaxed text-t-phos" aria-live="polite">
              {step.text}
            </p>
          </div>
        </div>
        <div className="flex items-center justify-between gap-2 border-t border-t-line px-3 py-2">
          <button onClick={close} className="t-focus min-h-touch px-2 text-xs text-t-phos-dim underline underline-offset-2 hover:text-t-white">
            Skip
          </button>
          <div className="flex items-center gap-2">
            {i > 0 && (
              <button onClick={() => setI((n) => Math.max(0, n - 1))} className="t-focus min-h-touch border border-t-line px-3 py-2 text-sm text-t-phos hover:text-t-white">
                Back
              </button>
            )}
            <button
              ref={nextRef}
              onClick={() => (last ? close() : setI((n) => n + 1))}
              className="t-focus min-h-touch bg-t-amber px-4 py-2 text-sm font-bold text-white hover:bg-t-amber-bright"
            >
              {last ? "Got it" : "Next"}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
