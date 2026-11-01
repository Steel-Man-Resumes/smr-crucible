"use client";

/**
 * Guided tour player for /walkthrough.
 *
 * A virtual camera frames the point of each beat (zoom and pan over a real
 * screen, or over a live component), a spotlight dims the rest, a cursor
 * clicks what matters, and the caption stays up long enough to read.
 * It plays on its own and the viewer can pause, step, or jump to a chapter
 * at any time (click the stage, Space, arrows, or the chapter bar).
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Pause, Play, RotateCcw } from "lucide-react";
import type { RecordChoice } from "@/lib/record-choice";
import { RecordDemo } from "./record-demo";
import { CHAPTERS, SCENES, STEPS, TOOLS, holdMs, toolKey, type Box, type Step } from "./tour";

const EASE = "cubic-bezier(.65,0,.3,1)";
const CAM_MS = 1100;
/** The caption arrives this long after the beat starts: the camera move plus a breath. */
const CAPTION_DELAY = CAM_MS + 300;
const SITE = "https://www.steelmanresumes.com";

type Cam = { s: number; tx: number; ty: number; ms: number; ease: string };
type Pt = [number, number];

/** The record choice the scene should show when a beat starts, from the beats before it. */
function choiceBefore(i: number): RecordChoice {
  let c: RecordChoice = "off";
  for (let k = 0; k < i; k++) {
    const a = STEPS[k].action;
    if (STEPS[k].scene === "record" && a && a !== "why") c = a;
  }
  return c;
}

function frame(
  stage: { w: number; h: number },
  content: { w: number; h: number },
  step: Step,
  spot: Box | null,
  overlayCaption: boolean,
  zoomOverride?: number,
  /** Below 1, the spotlight is framed smaller so the caption card has a clear place to sit (see placeCaption). */
  fitScale = 1,
): Omit<Cam, "ms" | "ease"> {
  const base = Math.min(stage.w / content.w, stage.h / content.h);
  // Leave room for the caption card at the bottom of a wide stage.
  const usableH = overlayCaption ? stage.h * 0.74 : stage.h;
  const centreY = overlayCaption ? stage.h * 0.4 : stage.h / 2;
  let z = 1;
  let cx = content.w / 2;
  let cy = content.h / 2;
  if (zoomOverride ?? step.zoom) {
    z = (zoomOverride ?? step.zoom) as number;
    if (step.focus) {
      cx = step.focus[0] * content.w;
      cy = step.focus[1] * content.h;
    }
  } else if (spot) {
    const [x, y, w, h] = spot;
    z = Math.min((0.74 * stage.w) / (w * content.w * base), (0.72 * usableH) / (h * content.h * base)) * fitScale;
    z = Math.max(fitScale < 1 ? fitScale : 1, Math.min(z, 2.6));
    cx = (x + w / 2) * content.w;
    cy = (y + h / 2) * content.h;
  }
  const s = base * z;
  // Content smaller than the stage used to be centred, which put a tall spotlight in the caption's
  // band; now it slides up so the spotlight sits at centreY, within the stage (2026-11-01).
  const fit = (size: number, view: number, centre: number, c: number, slide: boolean) => {
    const scaled = size * s;
    if (scaled <= view) return slide ? Math.max(0, Math.min(view - scaled, centre - c * s)) : (view - scaled) / 2;
    return Math.min(0, Math.max(view - scaled, centre - c * s));
  };
  return { s, tx: fit(content.w, stage.w, stage.w / 2, cx, false), ty: fit(content.h, stage.h, centreY, cy, overlayCaption && !!spot) };
}

/* ── Live scenes ──────────────────────────────────────────────────────── */

function TitleScene() {
  return (
    <div className="flex h-full flex-col justify-center px-24">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/brand/steel-man-mark-light.svg" alt="" className="wt-rise h-14 w-auto self-start" style={{ animationDelay: "100ms" }} />
      <p className="wt-rise mt-10 font-mono text-lg uppercase tracking-[0.18em] text-[#dbc173]" style={{ animationDelay: "300ms" }}>
        Steel Man Resumes · guided tour
      </p>
      <p className="wt-rise mt-5 max-w-[1000px] text-[84px] font-bold leading-[1.02] text-[#f4efe2]" style={{ animationDelay: "500ms" }}>
        A resume is one move in the hiring game.
      </p>
      <p className="wt-rise mt-8 max-w-[880px] text-[28px] leading-snug text-[#b9b2a0]" style={{ animationDelay: "1100ms" }}>
        The Forge builds the resume. The Refinery puts it to work.
      </p>
    </div>
  );
}

function ToolsScene() {
  return (
    <div className="grid h-full grid-cols-3 content-center gap-5 px-14">
      {TOOLS.map((t) => (
        <article key={t.name} data-tour={toolKey(t.name)} className="flex h-[220px] overflow-hidden rounded-lg border border-white/10 bg-[#1a1815]">
          {t.art && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={t.art} alt="" className="h-full w-[150px] shrink-0 object-cover" />
          )}
          <div className="p-6">
            <p className="font-mono text-[13px] uppercase tracking-[0.12em] text-[#8f897a]">{t.group}</p>
            <p className="mt-1 text-[24px] font-bold text-[#f4efe2]">{t.name}</p>
            <p className="mt-2 line-clamp-4 text-[15px] leading-relaxed text-[#b9b2a0]">{t.body}</p>
          </div>
        </article>
      ))}
    </div>
  );
}

function CloseScene() {
  return (
    <div className="flex h-full flex-col items-center justify-center px-20 text-center">
      <p className="wt-rise text-[80px] font-bold text-[#dbc173]">And then what?</p>
      <p className="wt-rise mt-2 text-[56px] font-semibold text-[#f4efe2]" style={{ animationDelay: "400ms" }}>
        Here&apos;s the whole road.
      </p>
      <p className="wt-rise mx-auto mt-8 max-w-[900px] text-[26px] leading-snug text-[#b9b2a0]" style={{ animationDelay: "800ms" }}>
        The resume, the plan for the record, the practice, the employers who hire, the local help, the next step.
      </p>
      <div className="wt-rise mt-12 flex gap-5" style={{ animationDelay: "1200ms" }}>
        <a href="/" className="rounded-[6px] bg-[#dbc173] px-9 py-5 text-[24px] font-semibold text-[#121110] hover:bg-[#f0dda0]">
          Start free in the Forge
        </a>
        <a href={`${SITE}/organizations`} className="rounded-[6px] border-2 border-white/30 px-9 py-5 text-[24px] font-semibold text-[#f4efe2] hover:bg-white hover:text-black">
          For organizations
        </a>
      </div>
    </div>
  );
}

/* ── Player ───────────────────────────────────────────────────────────── */

export function TourPlayer() {
  const rootRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<HTMLDivElement>(null);
  const [stage, setStage] = useState({ w: 0, h: 0 });
  /* The phone layout (square stage, caption below) follows the WINDOW, not the stage: on a laptop at 125% scaling the
     height cap makes the stage narrow and the old rule turned it square, taller than the screen (Troy, 2026-11-01). */
  const [vw, setVw] = useState(0);
  const [i, setI] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [userPaused, setUserPaused] = useState(false);
  const [reduced, setReduced] = useState(false);
  const [choice, setChoice] = useState<RecordChoice>("off");
  const [domSpot, setDomSpot] = useState<Box | null>(null);
  const [cam, setCam] = useState<Cam>({ s: 1, tx: 0, ty: 0, ms: 0, ease: EASE });
  const [cursor, setCursor] = useState<{ p: Pt; on: boolean; down: boolean; ms: number }>({ p: [0.86, 0.9], on: false, down: false, ms: 0 });
  const [ripple, setRipple] = useState<{ p: Pt; k: number } | null>(null);
  const prevScene = useRef<string>("");

  const step = STEPS[i];
  const scene = SCENES[step.scene];
  // The screen settles first, then the caption arrives (Troy, 2026-11-01: "the screen is one focal
  // point, the text box another"); the hold grows by the same delay so reading time is unchanged.
  const hold = holdMs(step) + CAPTION_DELAY;
  const last = i === STEPS.length - 1;
  const narrow = vw > 0 && vw < 640;
  /* The caption never sits on the stage: beside it on a wide window, under it on a narrow one. */
  const overlayCaption = false;
  const sideCaption = !narrow;
  const chapterIndex = CHAPTERS.findIndex((c) => c.id === step.chapter);

  /* Stage size */
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setStage({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const read = () => setVw(window.innerWidth);
    read();
    window.addEventListener("resize", read);
    return () => window.removeEventListener("resize", read);
  }, []);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => setReduced(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  /* Warm every image so a cut never waits on the network. */
  useEffect(() => {
    Object.values(SCENES).forEach((s) => {
      if (s.kind === "img") {
        const im = new Image();
        im.src = s.src;
      }
    });
  }, []);

  /* Play when the player is on screen, unless the viewer paused it. */
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => {
      if (!e.isIntersecting) setPlaying(false);
      else if (!userPaused && !last) setPlaying(true);
    }, { threshold: 0.45 });
    io.observe(el);
    return () => io.disconnect();
  }, [userPaused, last]);

  /* Clock */
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let prev = performance.now();
    const tick = (now: number) => {
      const dt = now - prev;
      prev = now;
      setElapsed((e) => e + dt);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing]);

  useEffect(() => {
    if (elapsed < hold) return;
    if (last) {
      setPlaying(false);
      return;
    }
    // Reset the clock in the same update, or a shorter next beat is skipped.
    setElapsed(0);
    setI((n) => n + 1);
  }, [elapsed, hold, last]);

  /* New beat: reset the clock and put the live record scene in the right state. */
  useEffect(() => {
    setElapsed(0);
    if (step.scene === "record") setChoice(choiceBefore(i));
  }, [i, step.scene]);

  /* Measure a spotlight in a live scene, in 0..1 of the scene. */
  useLayoutEffect(() => {
    if (scene.kind !== "dom" || typeof step.spot !== "string") {
      setDomSpot(null);
      return;
    }
    const root = sceneRef.current;
    const el = root?.querySelector<HTMLElement>(`[data-tour="${step.spot}"]`);
    if (!root || !el) {
      setDomSpot(null);
      return;
    }
    const r = root.getBoundingClientRect();
    const b = el.getBoundingClientRect();
    const pad = 10 / (r.width / scene.w);
    const sx = r.width / scene.w;
    setDomSpot([
      ((b.left - r.left) / sx - pad) / scene.w,
      ((b.top - r.top) / sx - pad) / scene.h,
      (b.width / sx + pad * 2) / scene.w,
      (b.height / sx + pad * 2) / scene.h,
    ]);
  }, [i, choice, stage.w, stage.h, scene, step.spot]);

  const spot: Box | null = Array.isArray(step.spot) ? (step.spot as Box) : domSpot;

  /* Camera */
  useEffect(() => {
    if (!stage.w) return;
    const sceneChanged = prevScene.current !== step.scene;
    prevScene.current = step.scene;
    const target = frame(stage, scene, step, spot, overlayCaption);
    const ms = reduced || sceneChanged ? 0 : CAM_MS;
    setCam({ ...target, ms, ease: EASE });
    if (step.drift && !reduced) {
      const t = setTimeout(() => {
        const d = frame(stage, scene, step, spot, overlayCaption, step.drift);
        setCam({ ...d, ms: hold, ease: "cubic-bezier(.4,0,.6,1)" });
      }, 60);
      return () => clearTimeout(t);
    }
  }, [i, stage, spot?.[0], spot?.[1], spot?.[2], spot?.[3]]); // eslint-disable-line react-hooks/exhaustive-deps

  /* Cursor: settle the camera, glide to the target, click. */
  useEffect(() => {
    if (!step.click) {
      setCursor((c) => ({ ...c, on: false }));
      return;
    }
    let target: Pt | null = null;
    let el: HTMLElement | null = null;
    if (typeof step.click === "string") {
      el = sceneRef.current?.querySelector<HTMLElement>(step.click) ?? null;
      const root = sceneRef.current;
      if (el && root) {
        const r = root.getBoundingClientRect();
        const b = el.getBoundingClientRect();
        target = [(b.left - r.left + b.width / 2) / r.width, (b.top - r.top + b.height / 2) / r.height];
      }
    } else if (Array.isArray(step.click)) target = step.click as Pt;
    else if (spot) target = [spot[0] + spot[2] / 2, spot[1] + spot[3] / 2];
    if (!target) return;
    const t: ReturnType<typeof setTimeout>[] = [];
    const settle = reduced ? 0 : 900;
    setCursor((c) => ({ ...c, on: true, ms: 0 }));
    t.push(setTimeout(() => setCursor((c) => ({ ...c, p: target!, ms: reduced ? 0 : 750 })), settle));
    t.push(setTimeout(() => {
      setCursor((c) => ({ ...c, down: true }));
      setRipple({ p: target!, k: Date.now() });
      el?.click();
    }, settle + 900));
    t.push(setTimeout(() => setCursor((c) => ({ ...c, down: false })), settle + 1080));
    return () => t.forEach(clearTimeout);
  }, [i]); // eslint-disable-line react-hooks/exhaustive-deps

  /* Controls */
  const go = useCallback((n: number) => {
    setI(Math.max(0, Math.min(STEPS.length - 1, n)));
    setElapsed(0);
  }, []);
  const toggle = useCallback(() => {
    if (last && !playing) {
      go(0);
      setUserPaused(false);
      setPlaying(true);
      return;
    }
    setPlaying((p) => {
      setUserPaused(p);
      return !p;
    });
  }, [last, playing, go]);

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === " " || e.key === "k") {
      e.preventDefault();
      toggle();
    } else if (e.key === "ArrowRight") go(i + 1);
    else if (e.key === "ArrowLeft") go(i - 1);
  };

  const chapterStart = useMemo(() => CHAPTERS.map((c) => STEPS.findIndex((s) => s.chapter === c.id)), []);
  const ring = 3 / (cam.s || 1);
  const isImg = scene.kind === "img";
  const sceneNote = scene.note;

  return (
    <div
      ref={rootRef}
      data-step={i}
      tabIndex={0}
      onKeyDown={onKey}
      aria-label="Guided tour of Steel Man Resumes. Space to pause, arrows to step."
      className="rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-[#dbc173]"
    >
      {/* Stage, with the caption beside it on a wide window */}
      <div className={sideCaption ? "flex items-center gap-5" : ""}>
      <div
        ref={stageRef}
        onClick={(e) => {
          // The tour clicks live components itself; only a viewer's click pauses.
          if (e.isTrusted && step.scene !== "close") toggle();
        }}
        className={`relative w-full min-w-0 overflow-hidden rounded-xl border border-white/10 bg-[#0d0c0b] ${narrow ? "aspect-square" : "flex-1 aspect-[16/10]"} ${step.scene === "close" ? "" : "cursor-pointer"}`}
      >
        <div
          className="absolute left-0 top-0 origin-top-left will-change-transform"
          style={{
            width: scene.w,
            height: scene.h,
            transform: `translate3d(${cam.tx}px, ${cam.ty}px, 0) scale(${cam.s})`,
            transition: cam.ms ? `transform ${cam.ms}ms ${cam.ease}` : "none",
          }}
        >
          <div key={step.scene} ref={sceneRef} className="wt-cut relative h-full w-full" style={{ pointerEvents: step.scene === "close" ? "auto" : "none" }}>
            {isImg ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={(scene as { src: string }).src} alt={`${step.title}. ${step.body}`} className="block h-full w-full select-none" draggable={false} />
            ) : step.scene === "title" ? (
              <TitleScene />
            ) : step.scene === "tools" ? (
              <ToolsScene />
            ) : step.scene === "close" ? (
              <CloseScene />
            ) : (
              <div className="flex h-full items-center px-16">
                <div className="w-full">
                  <RecordDemo fixed choice={choice} onChoose={setChoice} />
                </div>
              </div>
            )}
          </div>

          {/* Spotlight */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute"
            style={{
              left: (spot ? spot[0] : 0) * scene.w,
              top: (spot ? spot[1] : 0) * scene.h,
              width: (spot ? spot[2] : 1) * scene.w,
              height: (spot ? spot[3] : 1) * scene.h,
              borderRadius: 8 / cam.s,
              boxShadow: spot
                ? `0 0 0 ${ring}px #dbc173, 0 0 ${24 / cam.s}px ${4 / cam.s}px rgba(219,193,115,.35), 0 0 0 99999px rgba(8,7,6,.62)`
                : "0 0 0 0 rgba(219,193,115,0), 0 0 0 0 rgba(0,0,0,0), 0 0 0 99999px rgba(8,7,6,0)",
              transition: reduced ? "none" : `left ${CAM_MS}ms ${EASE}, top ${CAM_MS}ms ${EASE}, width ${CAM_MS}ms ${EASE}, height ${CAM_MS}ms ${EASE}, box-shadow 500ms ease`,
            }}
          />

          {/* Cursor */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute"
            style={{
              left: cursor.p[0] * scene.w,
              top: cursor.p[1] * scene.h,
              opacity: cursor.on ? 1 : 0,
              transform: `translate(-6px,-4px) scale(${(cursor.down ? 0.86 : 1) / cam.s})`,
              transformOrigin: "0 0",
              transition: `left ${cursor.ms}ms ${EASE}, top ${cursor.ms}ms ${EASE}, opacity 250ms ease, transform 120ms ease`,
            }}
          >
            <svg width="30" height="34" viewBox="0 0 30 34">
              <path d="M3 2 L3 27 L10 20 L15 31 L20 29 L15 18 L25 18 Z" fill="#fff" stroke="#121110" strokeWidth="2" strokeLinejoin="round" />
            </svg>
          </div>
          {ripple && (
            <span
              key={ripple.k}
              aria-hidden="true"
              className="wt-ripple pointer-events-none absolute rounded-full border-[3px] border-[#dbc173]"
              style={{ left: ripple.p[0] * scene.w, top: ripple.p[1] * scene.h, width: 44 / cam.s, height: 44 / cam.s, marginLeft: -22 / cam.s, marginTop: -22 / cam.s, borderWidth: 3 / cam.s }}
            />
          )}
        </div>

        {sceneNote && (
          <p className={`pointer-events-none absolute rounded bg-black/70 px-2 py-1 font-mono uppercase tracking-[0.08em] text-[#b0aa98] ${narrow ? "bottom-2 right-2 text-[8px]" : "right-3 top-3 text-[10px]"}`}>
            {sceneNote}
          </p>
        )}
        {!playing && step.scene !== "close" && (
          <div key={`pz-${i}-${elapsed > 0 ? 1 : 0}`} className={`pointer-events-none absolute inset-0 flex items-center justify-center ${i === 0 && elapsed === 0 ? "" : last ? "" : "wt-flash"}`}>
            <span className="rounded-full bg-black/55 p-5 text-white shadow-2xl">
              {last ? <RotateCcw size={34} aria-hidden="true" /> : <Play size={34} aria-hidden="true" />}
            </span>
          </div>
        )}
      </div>

      {/* Caption beside a wide stage: glass on the dark page, in after the spotlight settles. Always
          present so the stage does not jump on the title and close beats. */}
      {sideCaption && (
        <div className="w-[300px] shrink-0 self-center lg:w-[340px]" aria-live="polite">
          {step.scene !== "title" && step.scene !== "close" && (
            <div key={`caps-${i}`} className="wt-cap rounded-lg border border-white/10 border-l-[3px] border-l-[#dbc173] bg-[#121110]/60 px-5 py-4 shadow-2xl backdrop-blur" style={{ animationDelay: `${CAPTION_DELAY}ms` }}>
              <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-[#dbc173]">{CHAPTERS[chapterIndex].label}</p>
              <p className="mt-1 text-2xl font-bold leading-snug text-[#f4efe2]">{step.title}</p>
              <p className="mt-2 text-[17px] leading-relaxed text-[#cfc8b6]">{step.body}</p>
            </div>
          )}
        </div>
      )}
      </div>

      {/* Caption under a narrow stage */}
      {!sideCaption && step.scene !== "title" && step.scene !== "close" && (
        <div key={`capn-${i}`} className="wt-cap mt-3 min-h-[6.5rem] border-l-[3px] border-l-[#dbc173] pl-4" style={{ animationDelay: `${CAPTION_DELAY}ms` }}>
          <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-[#dbc173]">{CHAPTERS[chapterIndex].label}</p>
          <p className="mt-1 text-lg font-bold leading-snug text-[#f4efe2]">{step.title}</p>
          <p className="mt-1 text-[15px] leading-relaxed text-[#cfc8b6]">{step.body}</p>
        </div>
      )}

      {/* Controls */}
      <div className="mt-3 flex items-center gap-2">
        <button type="button" onClick={() => go(i - 1)} disabled={i === 0} aria-label="Previous" className="rounded-[5px] border border-white/20 p-2 text-[#e6e0d0] hover:bg-white/10 disabled:opacity-30">
          <ChevronLeft size={18} aria-hidden="true" />
        </button>
        <button type="button" onClick={toggle} aria-label={last && !playing ? "Replay" : playing ? "Pause" : "Play"} className="inline-flex items-center gap-2 rounded-[5px] bg-[#dbc173] px-3 py-2 text-sm font-semibold text-[#121110] hover:bg-[#f0dda0]">
          {last && !playing ? <RotateCcw size={16} aria-hidden="true" /> : playing ? <Pause size={16} aria-hidden="true" /> : <Play size={16} aria-hidden="true" />}
          <span className="hidden sm:inline">{last && !playing ? "Replay" : playing ? "Pause" : "Play"}</span>
        </button>
        <button type="button" onClick={() => go(i + 1)} disabled={last} aria-label="Next" className="rounded-[5px] border border-white/20 p-2 text-[#e6e0d0] hover:bg-white/10 disabled:opacity-30">
          <ChevronRight size={18} aria-hidden="true" />
        </button>
        {/* Progress: one segment per beat, gaps between chapters */}
        <div className="ml-2 flex min-w-0 flex-1 items-center gap-[2px]" role="presentation">
          {STEPS.map((s, n) => (
            <button
              key={n}
              type="button"
              onClick={() => go(n)}
              aria-label={`Go to: ${s.title}`}
              className={`group relative h-5 min-w-0 flex-1 ${n > 0 && STEPS[n - 1].chapter !== s.chapter ? "ml-1.5" : ""}`}
            >
              <span className="absolute inset-x-0 top-1/2 h-[4px] -translate-y-1/2 overflow-hidden rounded-full bg-white/15 group-hover:bg-white/30">
                <span
                  className="block h-full bg-[#dbc173]"
                  style={{ width: n < i ? "100%" : n > i ? "0%" : `${Math.min(100, (elapsed / hold) * 100)}%` }}
                />
              </span>
            </button>
          ))}
        </div>
      </div>
      <div className="wt-noscroll mt-2 flex gap-1 overflow-x-auto">
        {CHAPTERS.map((c, n) => (
          <button
            key={c.id}
            type="button"
            onClick={() => go(chapterStart[n])}
            aria-current={n === chapterIndex ? "true" : undefined}
            className={`shrink-0 rounded-[5px] px-2.5 py-1.5 font-mono text-[11px] uppercase tracking-[0.08em] transition-colors ${
              n === chapterIndex ? "bg-white/10 text-[#f4efe2]" : "text-[#8f897a] hover:text-white"
            }`}
          >
            {String(n).padStart(2, "0")} {c.label}
          </button>
        ))}
      </div>

      <style jsx global>{`
        .wt-cut { animation: wtCut 320ms ease both; }
        @keyframes wtCut { from { opacity: 0; } to { opacity: 1; } }
        .wt-cap { animation: wtCap 420ms cubic-bezier(.16,1,.3,1) both; }
        @keyframes wtCap { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
        .wt-rise { opacity: 0; animation: wtRise 700ms cubic-bezier(.16,1,.3,1) forwards; }
        @keyframes wtRise { from { opacity: 0; transform: translateY(18px); } to { opacity: 1; transform: none; } }
        .wt-ripple { animation: wtRipple 650ms ease-out forwards; }
        .wt-flash { animation: wtFlash 900ms ease forwards; }
        @keyframes wtFlash { 0%,40% { opacity: 1; } 100% { opacity: 0; } }
        @keyframes wtRipple { from { opacity: 1; transform: scale(.4); } to { opacity: 0; transform: scale(1.9); } }
        @media (prefers-reduced-motion: reduce) {
          .wt-cut, .wt-cap, .wt-rise, .wt-ripple { animation: none; opacity: 1; }
        }
      `}</style>
    </div>
  );
}

