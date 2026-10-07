"use client";

/**
 * A short t.ROY tour of the finish page: what each part is, in one line each.
 * Opens by itself once (the first time the resume is on screen), can be
 * skipped at any step, remembers it was seen, and can be replayed from the
 * status line. It never covers the page: a small card at the bottom, and the
 * part it talks about gets an outline.
 */

import { useCallback, useEffect, useRef, useState } from "react";

export interface TourStep {
  /** Element id on the page. Steps whose element is missing are skipped. */
  target: string;
  text: string;
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
  const lit = useRef<HTMLElement | null>(null);
  // Where focus was before the tour took it, so closing gives it back.
  const returnTo = useRef<HTMLElement | null>(null);
  const nextRef = useRef<HTMLButtonElement>(null);

  const unlight = useCallback(() => {
    if (lit.current) {
      lit.current.style.outline = "";
      lit.current.style.outlineOffset = "";
      lit.current = null;
    }
  }, []);

  useEffect(() => {
    if (open) {
      setI(0);
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

  // Escape closes the tour from anywhere on the page.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        close();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, close]);

  useEffect(() => {
    if (!open) {
      unlight();
      return;
    }
    const step = live[i];
    if (!step) return;
    const el = document.getElementById(step.target);
    unlight();
    if (el) {
      el.style.outline = "2px solid var(--t-amber)";
      el.style.outlineOffset = "4px";
      lit.current = el;
      const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
      el.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
    }
    nextRef.current?.focus({ preventScroll: true });
    // live is derived from steps; i and open drive the step.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, i]);

  useEffect(() => unlight, [unlight]);

  if (!open || live.length === 0) return null;
  const step = live[Math.min(i, live.length - 1)];
  const last = i >= live.length - 1;

  return (
    <div
      role="dialog"
      aria-modal="false"
      aria-label="Tour of this page"
      data-testid="finish-tour"
      className="fixed inset-x-4 bottom-4 z-[60] border border-t-amber bg-t-panel-2 p-4 shadow-[0_8px_24px_rgba(0,0,0,0.35)] sm:left-auto sm:right-6 sm:w-[360px]"
    >
      <div className="flex items-start gap-3">
        <img src="/images/t-roy-icon-badge.webp" alt="" aria-hidden="true" className="mt-0.5 h-7 w-7 shrink-0 rounded-full" />
        <div className="min-w-0">
          <p className="text-[11px] font-bold uppercase tracking-wide text-t-phos-dim">
            t.ROY &middot; {i + 1} of {live.length}
          </p>
          <p className="mt-1 text-sm leading-relaxed text-t-white" aria-live="polite">
            {step.text}
          </p>
        </div>
      </div>
      <div className="mt-3 flex items-center justify-between gap-2">
        <button onClick={close} className="t-focus min-h-touch px-2 text-xs text-t-phos-dim underline underline-offset-2 hover:text-t-white">
          Skip the tour
        </button>
        <button
          ref={nextRef}
          onClick={() => (last ? close() : setI((n) => n + 1))}
          className="t-focus min-h-touch bg-t-amber px-4 py-2 text-sm font-bold text-white hover:bg-t-amber-bright"
        >
          {last ? "Got it" : "Next"}
        </button>
      </div>
    </div>
  );
}
