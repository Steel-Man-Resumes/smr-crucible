"use client";

/**
 * The person's current page with t.ROY walking it: a brass pointer moves from
 * one flagged line to the next, the line lights up, and t.ROY's note for it
 * appears beside the page like a text message.
 *
 * Every flag comes from the mint check run in this browser (see
 * lib/showstopper-tour.ts). Reduced motion: nothing moves or plays on its
 * own; every flagged line is marked and every note is listed. The notes are
 * an ordered list in reading order inside a polite live region, and the
 * person can pause, play or skip the walk.
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Pause, Play, SkipForward } from "lucide-react";
import type { ResumeTour } from "@/lib/showstopper-tour";

const STEP_MS = 6000;
const FIRST_NOTE_MS = 1400;

const useIsoLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

export function OldPageTour({ tour, reduced: motionPref }: { tour: ResumeTour; reduced: boolean | null }) {
  // Until the motion preference is known, nothing plays and no pointer shows.
  const known = motionPref !== null;
  const reduced = motionPref !== false;
  const { lines, steps } = tour;
  const [revealed, setRevealed] = useState(0);
  const [current, setCurrent] = useState(-1);
  const [playing, setPlaying] = useState(true);
  const [arrowTop, setArrowTop] = useState<number | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const lineRefs = useRef<(HTMLDivElement | null)[]>([]);

  const finished = revealed >= steps.length;
  const showAll = reduced || !playing;

  // Reduced motion: everything at once, nothing plays.
  useEffect(() => {
    if (motionPref !== true) return;
    setRevealed(steps.length);
    setPlaying(false);
  }, [motionPref, steps.length]);

  // The walk: first note after t.ROY arrives, then one every few seconds.
  useEffect(() => {
    if (!known || reduced || !playing || finished) return;
    const t = setTimeout(
      () => {
        setRevealed((r) => r + 1);
        setCurrent(revealed);
      },
      revealed === 0 ? FIRST_NOTE_MS : STEP_MS
    );
    return () => clearTimeout(t);
  }, [known, reduced, playing, finished, revealed]);

  useEffect(() => {
    if (finished) setPlaying(false);
  }, [finished]);

  const lineIndexOf = (i: number) => (i >= 0 && i < steps.length ? steps[i].lineIndex : -1);

  // Point at the current line and bring it into view inside the page box
  // (never scrolls the window).
  const place = useCallback(() => {
    const li = lineIndexOf(current);
    const el = li >= 0 ? lineRefs.current[li] : null;
    if (!el) return setArrowTop(null);
    setArrowTop(el.offsetTop + el.offsetHeight / 2);
    const box = scrollRef.current;
    if (box) {
      const top = Math.max(0, el.offsetTop - box.clientHeight / 3);
      if (typeof box.scrollTo === "function") box.scrollTo({ top, behavior: reduced ? "auto" : "smooth" });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current, reduced, steps]);

  useIsoLayoutEffect(() => {
    place();
  }, [place]);

  useEffect(() => {
    const box = scrollRef.current;
    if (!box || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => place());
    ro.observe(box);
    return () => ro.disconnect();
  }, [place]);

  // Which note (by number) marks a line, once that note is showing.
  const noteForLine = new Map<number, number>();
  steps.forEach((s, i) => {
    if (i < revealed) noteForLine.set(s.lineIndex, i);
  });
  const currentLine = lineIndexOf(current);
  const nameLine = lines.findIndex((l) => l.trim());

  const skip = () => {
    setRevealed(steps.length);
    setPlaying(false);
  };

  return (
    <>
      {/* The page as it reads now */}
      <section aria-label="Your page now" className="min-w-0 lg:col-start-1 lg:row-span-2 lg:row-start-1">
        <div className="mb-2 flex items-baseline justify-between gap-3">
          <h2 className="font-term text-xs uppercase tracking-wider text-t-amber-bright">Your page now</h2>
          <p className="text-xs text-t-bone-dim">Checked right here in your browser.</p>
        </div>
        <div
          ref={scrollRef}
          className="relative max-h-[46vh] overflow-y-auto border border-ws-bg/40 bg-ws-bone shadow-[6px_6px_0_#000] lg:max-h-[68vh]"
          tabIndex={0}
          aria-label="Your page, line by line"
        >
          <div className="relative py-5 pl-12 pr-4 sm:pr-6">
            {/* The pointer. Hidden when motion is reduced: lines are marked instead. */}
            {!reduced && arrowTop !== null && (
              <svg
                aria-hidden="true"
                viewBox="0 0 28 20"
                className="pointer-events-none absolute left-0.5 top-0 h-4 w-[22px] text-ws-amber transition-transform duration-700 ease-[cubic-bezier(.22,.8,.3,1)]"
                style={{ transform: `translateY(${arrowTop - 8}px)` }}
              >
                <path d="M1 10h17M12 3l8 7-8 7" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="square" />
              </svg>
            )}
            {lines.map((line, i) => {
              const n = noteForLine.get(i);
              const flagged = n !== undefined;
              const on = i === currentLine || (flagged && (reduced || showAll) && currentLine < 0);
              const isName = i === nameLine;
              const heading = !isName && /^[A-Z][A-Z &/:,-]{3,}$/.test(line.trim());
              return (
                <div
                  key={i}
                  ref={(el) => {
                    lineRefs.current[i] = el;
                  }}
                  className={`relative whitespace-pre-wrap break-words px-1.5 font-body text-[13px] leading-[1.55] text-ws-bg transition-colors duration-300 ${
                    isName ? "text-[17px] font-semibold" : heading ? "mt-1 font-semibold tracking-wide" : ""
                  } ${on ? "bg-ws-amber-bright/55 outline outline-2 outline-ws-amber" : flagged ? "bg-ws-amber-bright/25" : ""}`}
                >
                  {flagged && (
                    <span
                      aria-hidden="true"
                      className="absolute -left-[22px] top-[2px] inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-ws-bg px-1 font-term text-[10px] font-bold text-ws-amber-bright"
                    >
                      {n + 1}
                    </span>
                  )}
                  {line || " "}
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* t.ROY's notes, in reading order */}
      <section aria-label="What t.ROY sees" className="min-w-0 lg:col-start-2 lg:row-start-2">
        {tour.cleanNote ? (
          <p className="border-l-4 border-ws-amber bg-t-panel-2 px-4 py-3 text-base text-t-white" role="status">
            {tour.cleanNote}
          </p>
        ) : (
          <>
            <ol className="space-y-2" aria-live="polite" aria-label="t.ROY's notes on your page">
              {steps.slice(0, revealed).map((s, i) => {
                const isCurrent = i === current;
                return (
                  <li key={s.id} className="animate-fadeIn">
                    <button
                      type="button"
                      onClick={() => {
                        setCurrent(i);
                        setPlaying(false);
                      }}
                      aria-current={isCurrent ? "true" : undefined}
                      className={`t-focus flex w-full items-start gap-3 border px-3 py-2.5 text-left transition-colors ${
                        isCurrent
                          ? "border-ws-amber bg-t-panel-2 text-t-white"
                          : "border-t-line bg-t-panel text-t-bone-dim hover:border-ws-amber/60"
                      }`}
                    >
                      <span
                        aria-hidden="true"
                        className={`mt-0.5 inline-flex h-5 min-w-[20px] items-center justify-center rounded-full font-term text-[11px] font-bold ${
                          isCurrent ? "bg-ws-amber text-ws-bg" : "bg-t-panel-3 text-ws-amber-bright"
                        }`}
                      >
                        {i + 1}
                      </span>
                      <span className={`text-[15px] leading-snug ${isCurrent || showAll ? "" : "line-clamp-1 sm:line-clamp-none"}`}>
                        <span className="sr-only">Note {i + 1}: </span>
                        {s.note}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ol>
            {finished && (
              <p className="mt-3 text-sm text-t-bone-dim">
                That&apos;s what I see on this page. Tap a note to find its line.
              </p>
            )}
            {!finished && revealed === 0 && !reduced && (
              <p className="text-sm text-t-bone-dim">Reading your page...</p>
            )}
            {!reduced && !finished && (
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setPlaying((p) => !p)}
                  className="t-focus inline-flex min-h-touch items-center gap-2 border border-t-line px-3 font-term text-xs text-t-white hover:border-ws-amber"
                >
                  {playing ? <Pause size={14} aria-hidden="true" /> : <Play size={14} aria-hidden="true" />}
                  {playing ? "Pause" : "Play"}
                </button>
                <button
                  type="button"
                  onClick={skip}
                  className="t-focus inline-flex min-h-touch items-center gap-2 border border-t-line px-3 font-term text-xs text-t-white hover:border-ws-amber"
                >
                  <SkipForward size={14} aria-hidden="true" />
                  Show all notes
                </button>
              </div>
            )}
          </>
        )}
      </section>
    </>
  );
}
