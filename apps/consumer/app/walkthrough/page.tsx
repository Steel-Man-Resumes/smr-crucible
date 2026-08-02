"use client";

/**
 * Walkthrough -- "/walkthrough"
 *
 * A self-running interactive slideshow with a virtual camera that zooms and
 * pans across crisp DOM screens (see screens.tsx) to guide the viewer's
 * attention through Forge + Refinery. Built for partner shares (Mary Ann /
 * Expo Wisconsin); shareable as a plain link, no login, works on laptop or phone.
 *
 * Controls: Space = pause/resume, Left/Right = navigate, R = restart,
 *           click middle = pause, click edges = prev/next, dots = jump.
 *
 * Fully static (Jordan demo data) -- no API, no auth, no DB.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  BEATS,
  FULL,
  regionTransform,
  STAGE_W,
  STAGE_H,
  type ScreenId,
} from "./storyboard";
import { SCREENS } from "./screens";
import { ArrowLeft, RotateCcw } from "lucide-react";

const SCREEN_IDS = Object.keys(SCREENS) as ScreenId[];

export default function WalkthroughPage() {
  const [beatIndex, setBeatIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [progress, setProgress] = useState(0);
  const [reduced, setReduced] = useState(false);
  const [fit, setFit] = useState(1);

  const elapsedRef = useRef(0);
  const lastRef = useRef(0);
  const pausedRef = useRef(false);
  const rafRef = useRef<number | null>(null);

  const beat = BEATS[beatIndex];
  const isLast = beatIndex === BEATS.length - 1;

  useEffect(() => {
    pausedRef.current = paused;
  }, [paused]);

  // Honor reduced-motion: no camera moves, just calm cross-fades.
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => setReduced(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  // Fit the 1280x800 stage to any viewport (letterboxed).
  useEffect(() => {
    const onResize = () =>
      setFit(
        Math.min(window.innerWidth / STAGE_W, window.innerHeight / STAGE_H)
      );
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // Reset the dwell timer whenever the beat changes.
  useEffect(() => {
    elapsedRef.current = 0;
    setProgress(0);
  }, [beatIndex]);

  const goTo = useCallback((i: number) => {
    const next = Math.max(0, Math.min(BEATS.length - 1, i));
    elapsedRef.current = 0;
    setProgress(0);
    setBeatIndex(next);
  }, []);

  // Drive the auto-advance. pausedRef keeps this loop stable across pauses.
  useEffect(() => {
    lastRef.current = performance.now();
    function tick(now: number) {
      const dt = now - lastRef.current;
      lastRef.current = now;
      if (!pausedRef.current) {
        elapsedRef.current += dt;
        const p = Math.min(elapsedRef.current / beat.duration, 1);
        setProgress(p);
        if (p >= 1 && !isLast) {
          setBeatIndex((prev) => prev + 1);
        }
      }
      rafRef.current = requestAnimationFrame(tick);
    }
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [beat.duration, isLast]);

  // Keyboard controls.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === " " || e.key === "Spacebar") {
        e.preventDefault();
        setPaused((p) => !p);
      } else if (e.key === "ArrowRight" || e.key === "ArrowDown") {
        e.preventDefault();
        setPaused(false);
        goTo(beatIndex + 1);
      } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
        e.preventDefault();
        setPaused(false);
        goTo(beatIndex - 1);
      } else if (e.key === "r" || e.key === "R") {
        setPaused(false);
        goTo(0);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [beatIndex, goTo]);

  // Click: edges navigate, middle pauses.
  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      const x = e.clientX / window.innerWidth;
      if (x < 0.18) {
        setPaused(false);
        goTo(beatIndex - 1);
      } else if (x > 0.82) {
        setPaused(false);
        goTo(beatIndex + 1);
      } else {
        setPaused((p) => !p);
      }
    },
    [beatIndex, goTo]
  );

  const focus = reduced ? FULL : beat.focus;
  const transform = regionTransform(focus);
  const activeScreen = beat.screen;
  const ended = isLast && progress >= 1;

  return (
    <div
      onClick={handleClick}
      className="fixed inset-0 bg-black overflow-hidden select-none cursor-pointer"
    >
      {/* Frame: the 1280x800 stage, scaled to fit the viewport */}
      <div
        className="absolute left-1/2 top-1/2"
        style={{
          width: STAGE_W,
          height: STAGE_H,
          transform: `translate(-50%, -50%) scale(${fit})`,
          transformOrigin: "center",
        }}
      >
        <div
          className="absolute inset-0 overflow-hidden rounded-[7px]"
          style={{ boxShadow: "0 30px 90px rgba(0,0,0,0.5)" }}
        >
          {/* Stage: the camera transform lives here */}
          <div
            className="absolute inset-0"
            style={{
              width: STAGE_W,
              height: STAGE_H,
              transform,
              transformOrigin: "0 0",
              transition: reduced
                ? "none"
                : "transform 1200ms cubic-bezier(0.4, 0, 0.2, 1)",
              willChange: "transform",
            }}
          >
            {SCREEN_IDS.map((id) => {
              const ScreenComponent = SCREENS[id];
              return (
                <div
                  key={id}
                  className="absolute inset-0"
                  style={{
                    opacity: id === activeScreen ? 1 : 0,
                    transition: "opacity 600ms ease",
                    pointerEvents: "none",
                  }}
                >
                  <ScreenComponent />
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Top progress bar */}
      <div className="absolute top-0 left-0 right-0 h-1 bg-white/10 z-20">
        <div
          className="h-full bg-emerald-400"
          style={{ width: `${progress * 100}%`, transition: "width 120ms linear" }}
        />
      </div>

      {/* Caption */}
      {beat.caption && (
        <div className="absolute bottom-0 left-0 right-0 z-10 border-t border-white/15 bg-black/90 px-8 pb-14 pt-6 pointer-events-none">
          <div key={beatIndex} className="max-w-3xl mx-auto text-center wt-fade">
            {beat.caption.title && (
              <p className="text-emerald-300 text-xs sm:text-sm font-semibold uppercase mb-2">
                {beat.caption.title}
              </p>
            )}
            <p className="text-white text-xl sm:text-2xl md:text-3xl font-medium leading-snug">
              {beat.caption.body}
            </p>
          </div>
        </div>
      )}

      {/* Beat dots */}
      <div
        className="absolute bottom-4 left-1/2 -translate-x-1/2 flex gap-1.5 z-30"
        onClick={(e) => e.stopPropagation()}
      >
        {BEATS.map((b, i) => (
          <button
            key={b.id}
            onClick={() => {
              setPaused(false);
              goTo(i);
            }}
            aria-label={`Go to step ${i + 1}`}
            className="rounded-full transition-all duration-300"
            style={{
              width: i === beatIndex ? 22 : 8,
              height: 8,
              background:
                i === beatIndex
                  ? "#34d399"
                  : i < beatIndex
                    ? "rgba(52,211,153,0.45)"
                    : "rgba(255,255,255,0.3)",
            }}
          />
        ))}
      </div>

      {/* Pause / replay pill */}
      {paused && !ended && (
        <div className="absolute right-5 top-5 z-30 rounded-[5px] border border-white/20 bg-black/80 px-3 py-1.5 text-xs text-white backdrop-blur">
          Paused
        </div>
      )}
      {ended && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            setPaused(false);
            goTo(0);
          }}
          className="absolute right-5 top-5 z-30 inline-flex items-center gap-2 rounded-[5px] bg-[#4f6b57] px-4 py-2 text-sm font-medium text-white shadow-lg transition-colors hover:bg-[#3d5745]"
        >
          <RotateCcw size={15} aria-hidden="true" /> Replay
        </button>
      )}

      <a
        href="https://www.steelmanresumes.com/how-it-works"
        onClick={(event) => event.stopPropagation()}
        className="absolute left-4 top-5 z-30 inline-flex items-center gap-2 rounded-[5px] border border-white/20 bg-black/80 px-3 py-2 text-xs font-medium text-white backdrop-blur transition-colors hover:bg-white hover:text-black"
      >
        <ArrowLeft size={14} aria-hidden="true" /> Back to Steel Man
      </a>

      <style jsx global>{`
        @keyframes wtFade {
          from {
            opacity: 0;
            transform: translateY(10px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
        .wt-fade {
          animation: wtFade 600ms ease forwards;
        }
      `}</style>
    </div>
  );
}
