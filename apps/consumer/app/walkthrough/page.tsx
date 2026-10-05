"use client";

/**
 * Walkthrough -- "/walkthrough" (also "/demo", via next.config redirect)
 *
 * A self-running guided tour on real screenshots of the live product, from
 * the Mini Forge inside a facility to the staff workspace a program uses.
 * Every person on screen is a fictional demo persona. A virtual camera zooms
 * toward the part of each screen the caption is about.
 *
 * Controls: Space = pause/resume, Left/Right = navigate, R = restart,
 *           dots = jump. Plays on its own; pauses on any manual step.
 *
 * Fully static -- no API, no auth, no DB. Frames live in /public/walkthrough.
 */

import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, ChevronLeft, ChevronRight, Pause, Play, RotateCcw } from "lucide-react";

type Step = {
  img: string | null;
  act: string;
  title: string;
  body: string;
  /** Camera focus as a percentage of the frame, and zoom. */
  x: number;
  y: number;
  zoom: number;
};

const STEPS: Step[] = [
  { img: "t01", act: "Inside", title: "It starts inside", body: "The Mini Forge runs on a facility tablet. Seven questions, a PIN, no name and no chat. The person leaves with a career plan and a six-letter code.", x: 50, y: 45, zoom: 1.12 },
  { img: "t02", act: "The Forge", title: "t.ROY says hello", body: "Home now, they type in the code or start fresh. t.ROY, the coach, asks one thing first: who are you?", x: 50, y: 42, zoom: 1.5 },
  { img: "t03", act: "The Forge", title: "Five minutes of honest answers", body: "Experience, goals, the story in their own words, and what makes a job workable. Upload an old resume, snap a photo, or start from nothing.", x: 50, y: 50, zoom: 1.05 },
  { img: "t04", act: "The Forge", title: "Four analyses at once", body: "Skills, the narrative, career matches with real pay ranges, and every barrier mapped to a resource.", x: 50, y: 50, zoom: 1.05 },
  { img: "t05", act: "The Forge", title: "A story, not a score", body: "A headline they can stand behind, and strengths taken from their own history.", x: 0, y: 0, zoom: 1.4 },
  { img: "t05", act: "The Forge", title: "Hurdles, and what helps", body: "The record is handled in the open: the state's hiring law, the lookback windows, and where to get help.", x: 100, y: 55, zoom: 1.35 },
  { img: "t06", act: "The Refinery", title: "The resume becomes a job search", body: "A free account. The dashboard shows how far along they are and the one next step.", x: 55, y: 30, zoom: 1.3 },
  { img: "t07", act: "The Refinery", title: "Employers who hire people with records, first", body: "Live job listings, with employers we checked marked and moved to the top.", x: 32, y: 52, zoom: 1.45 },
  { img: "t08", act: "The Refinery", title: "A plan for the record", body: "What to say, when, and how much. They pick the hurdle, and t.ROY helps them find the words.", x: 40, y: 70, zoom: 1.4 },
  { img: "t09", act: "The Refinery", title: "Practice for the real job", body: "Interview questions built from the actual posting and their actual resume, in writing and out loud by voice.", x: 45, y: 62, zoom: 1.35 },
  { img: "t10", act: "The Refinery", title: "Track every application", body: "Saved to offered, with t.ROY drafting the application email for each one.", x: 45, y: 68, zoom: 1.35 },
  { img: "t11", act: "Employers", title: "Every state, checked", body: "All 50 states and DC. Each employer mark rests on dated public evidence, and it expires unless someone checks it again.", x: 50, y: 50, zoom: 1 },
  { img: "t12", act: "Employers", title: "One state, up close", body: "The law in plain words with a link to the statute, local help, and verified employers. Every page shows when it was last checked.", x: 35, y: 42, zoom: 1.2 },
  { img: "t13", act: "For programs", title: "Staff see today's work", body: "Interviews coming up, people gone quiet, people who never started. Sorted by why, so a case manager knows where to start.", x: 50, y: 55, zoom: 1.3 },
  { img: "t14", act: "For programs", title: "Consent first", body: "Staff see only what each person chose to share, one item at a time. Disclosure plans and interview answers stay private.", x: 60, y: 62, zoom: 1.2 },
  { img: "t15", act: "For programs", title: "Record the outcome", body: "A placement goes on file with the date and the employer, and the person can see it too.", x: 60, y: 62, zoom: 1.35 },
  { img: "t16", act: "For programs", title: "Proof for funders", body: "Counts and dates, ready to download for a funder. Never anyone's records.", x: 40, y: 60, zoom: 1.3 },
  { img: null, act: "And then what?", title: "Here's the whole road.", body: "The resume, the plan for the record, the practice, the employers who hire, the local help, the next step. Free to the person, always.", x: 50, y: 50, zoom: 1 },
];

const DWELL_MS = 7000;

export default function WalkthroughPage() {
  const [i, setI] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [reduced, setReduced] = useState(false);
  const [zoomed, setZoomed] = useState(false);
  const step = STEPS[i];
  const last = i === STEPS.length - 1;

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => setReduced(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  // Warm the cache so each frame is ready before the camera gets there.
  useEffect(() => {
    STEPS.forEach((s) => {
      if (s.img) {
        const im = new Image();
        im.src = `/walkthrough/${s.img}.webp`;
      }
    });
  }, []);

  // Ease into the zoom shortly after each step lands.
  useEffect(() => {
    setZoomed(false);
    const t = setTimeout(() => setZoomed(true), 250);
    return () => clearTimeout(t);
  }, [i]);

  useEffect(() => {
    if (!playing || last) return;
    const t = setTimeout(() => setI((n) => Math.min(n + 1, STEPS.length - 1)), DWELL_MS);
    return () => clearTimeout(t);
  }, [i, playing, last]);

  const go = useCallback((n: number) => {
    setPlaying(false);
    setI(Math.max(0, Math.min(STEPS.length - 1, n)));
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") go(i + 1);
      else if (e.key === "ArrowLeft") go(i - 1);
      else if (e.key === " ") {
        e.preventDefault();
        setPlaying((p) => !p);
      } else if (e.key === "r" || e.key === "R") {
        setI(0);
        setPlaying(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [i, go]);

  const scale = reduced || !zoomed ? 1 : step.zoom;

  return (
    <div className="fixed inset-0 flex flex-col bg-[#121110] text-[#ece7d9]">
      {/* Progress */}
      <div className="h-1 w-full bg-white/10">
        <div
          className="h-full bg-[#dbc173] transition-[width] duration-500"
          style={{ width: `${((i + 1) / STEPS.length) * 100}%` }}
        />
      </div>

      {/* Top bar */}
      <div className="flex items-center gap-3 px-4 py-3 sm:px-6">
        <a
          href="https://www.steelmanresumes.com/how-it-works"
          className="inline-flex items-center gap-2 rounded-[5px] border border-white/20 px-3 py-1.5 text-xs font-medium transition-colors hover:bg-white hover:text-black"
        >
          <ArrowLeft size={14} aria-hidden="true" /> Back to Steel Man
        </a>
        <span className="ml-auto font-mono text-[11px] uppercase tracking-[0.12em] text-[#b0aa98]">
          {step.act} · {String(i + 1).padStart(2, "0")} / {STEPS.length}
        </span>
      </div>

      {/* Stage */}
      <div className="relative min-h-0 flex-1 px-3 sm:px-6">
        <div className="relative h-full w-full overflow-hidden rounded-lg border border-white/10 bg-[#1a1815]">
          {step.img ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={`${step.img}-${i}`}
              src={`/walkthrough/${step.img}.webp`}
              alt={`${step.title}. ${step.body}`}
              className="wt-fade absolute inset-0 h-full w-full object-contain"
              style={{
                transformOrigin: `${step.x}% ${step.y}%`,
                transform: `scale(${scale})`,
                transition: reduced ? "none" : "transform 1400ms cubic-bezier(.3,.1,.2,1)",
              }}
            />
          ) : (
            <div className="wt-fade flex h-full flex-col items-center justify-center gap-6 px-6 text-center">
              <p className="text-3xl font-bold text-[#dbc173] sm:text-5xl">And then what?</p>
              <p className="text-2xl font-semibold sm:text-4xl">Here&apos;s the whole road.</p>
              <div className="mt-2 flex flex-wrap justify-center gap-3">
                <a
                  href="/"
                  className="rounded-[5px] bg-[#dbc173] px-5 py-2.5 text-sm font-semibold text-[#121110] hover:bg-[#f0dda0]"
                >
                  Start free in the Forge
                </a>
                <a
                  href="https://www.steelmanresumes.com/organizations"
                  className="rounded-[5px] border border-white/30 px-5 py-2.5 text-sm font-semibold hover:bg-white hover:text-black"
                >
                  For organizations
                </a>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Caption + controls */}
      <div className="px-4 pb-4 pt-4 sm:px-6">
        <div key={i} className="wt-fade mx-auto min-h-[5.5rem] max-w-3xl text-center">
          <p className="text-lg font-semibold sm:text-2xl">{step.title}</p>
          <p className="mt-1 text-sm leading-relaxed text-[#b0aa98] sm:text-base">{step.body}</p>
        </div>
        <div className="mx-auto mt-3 flex max-w-3xl flex-wrap items-center justify-center gap-3">
          <button
            onClick={() => go(i - 1)}
            disabled={i === 0}
            aria-label="Previous step"
            className="rounded-[5px] border border-white/20 p-2 disabled:opacity-30 hover:bg-white/10"
          >
            <ChevronLeft size={18} aria-hidden="true" />
          </button>
          <button
            onClick={() => {
              if (last) {
                setI(0);
                setPlaying(true);
              } else setPlaying((p) => !p);
            }}
            aria-label={last ? "Replay" : playing ? "Pause" : "Play"}
            className="inline-flex items-center gap-2 rounded-[5px] bg-[#31586f] px-4 py-2 text-sm font-medium text-white hover:bg-[#3d6a85]"
          >
            {last ? <RotateCcw size={15} aria-hidden="true" /> : playing ? <Pause size={15} aria-hidden="true" /> : <Play size={15} aria-hidden="true" />}
            {last ? "Replay" : playing ? "Pause" : "Play"}
          </button>
          <button
            onClick={() => go(i + 1)}
            disabled={last}
            aria-label="Next step"
            className="rounded-[5px] border border-white/20 p-2 disabled:opacity-30 hover:bg-white/10"
          >
            <ChevronRight size={18} aria-hidden="true" />
          </button>
          <div className="flex w-full justify-center gap-1.5 sm:w-auto">
            {STEPS.map((s, n) => (
              <button
                key={n}
                onClick={() => go(n)}
                aria-label={`Go to step ${n + 1}: ${s.title}`}
                aria-current={n === i ? "step" : undefined}
                className="block shrink-0 rounded-full p-0 transition-all duration-300"
                style={{
                  height: 8,
                  minHeight: 0,
                  width: n === i ? 20 : 8,
                  background: n === i ? "#dbc173" : n < i ? "rgba(219,193,115,0.45)" : "rgba(255,255,255,0.25)",
                }}
              />
            ))}
          </div>
        </div>
        <p className="mt-3 text-center text-[11px] text-[#b0aa98]/80">
          Real screens from the live product. Every person shown is fictional.
        </p>
      </div>

      <style jsx global>{`
        @keyframes wtFade {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        .wt-fade { animation: wtFade 500ms ease both; }
      `}</style>
    </div>
  );
}
