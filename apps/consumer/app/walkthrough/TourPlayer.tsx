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
/** Space between the stage and the caption column (the row's gap, in px). */
const SIDE_GAP = 20;
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

/** All reveals use the player's elapsed time, so pause really stops the story. */
const progress = (time: number, start: number, duration = 650) => Math.max(0, Math.min(1, (time - start) / duration));
const reveal = (time: number, start: number) => {
  const p = progress(time, start);
  return { opacity: p, transform: `translateY(${(1 - p) * 24}px)` };
};

function TitleScene({ time }: { time: number }) {
  return (
    <div className="relative flex h-full flex-col justify-center overflow-hidden px-20">
      <div aria-hidden="true" className="absolute bottom-0 right-0 h-[560px] w-[560px] rounded-full border border-[#dbc173]/10" style={{ transform: `translate(25%,25%) scale(${.8 + progress(time, 0, 1800) * .2})` }} />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/brand/steel-man-mark-light.svg" alt="" className="mb-14 h-16 w-auto self-start" style={reveal(time, 0)} />
      <p className="font-mono text-[19px] uppercase tracking-[.2em] text-[#b9b2a0]" style={reveal(time, 150)}>The hiring game</p>
      <p className="mt-5 text-[94px] font-bold leading-[1.03] tracking-[-.035em] text-[#f4efe2]">
        <span className="block" style={reveal(time, 300)}>A resume is</span>
        <span className="block" style={reveal(time, 950)}>one <span className="text-[#dbc173]">move.</span></span>
      </p>
      <div aria-hidden="true" className="my-8 h-[3px] w-36 origin-left bg-[#dbc173]" style={{ transform: `scaleX(${progress(time, 1700)})` }} />
      <p className="max-w-[900px] text-[30px] leading-snug text-[#b9b2a0]" style={reveal(time, 2300)}>The Forge builds the resume.<br />The Refinery puts it to work.</p>
    </div>
  );
}

/** Four windows onto the original capture, not a recreation of the product UI. */
function ConversationScene({ time }: { time: number }) {
  const rows = [{ y: 1080, h: 78, at: 0 }, { y: 1164, h: 78, at: 1700 }, { y: 1248, h: 78, at: 3700 }, { y: 1333, h: 112, at: 6200 }];
  return (
    <div className="h-full px-20 pt-20">
      <p className="font-mono text-[19px] uppercase tracking-[.18em] text-[#dbc173]">The Forge · see the work</p>
      <p className="mt-4 text-[58px] font-bold leading-tight text-[#f4efe2]">Watch one line get stronger.</p>
      <div className="relative mt-10 space-y-4" data-conversation="">
        {rows.map((row, n) => (
          <div key={row.y} data-reveal={n} className="relative overflow-hidden rounded-sm" style={{ height: row.h * 1.2, ...reveal(time, row.at), filter: n === 0 && time > 6200 ? "brightness(.55)" : undefined }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/walkthrough/forge-intro.webp" alt={["The old line: Did safety audits.", "t.ROY asks: What did you check?", "The person answers: I checked exit routes every shift.", "The stronger line: Checked exit routes each shift."][n]} draggable={false} className="absolute max-w-none" style={{ width: 1920, height: 1920, left: -432, top: -row.y * 1.2 }} />
          </div>
        ))}
      </div>
    </div>
  );
}

/** A chapter cue, drawn once before its evidence settles. */
function ChapterCue({ chapter, time }: { chapter: string; time: number }) {
  if (time >= 1500) return null;
  const paths: Record<string, string> = {
    forge: "M15 72H105L85 95H35ZM52 65L44 42L62 12L78 43L68 65",
    record: "M30 15H78L98 35V105H30ZM78 15V35H98M44 52H83M44 67H83M44 82H70",
    refinery: "M76 76L105 105M88 50A38 38 0 1 1 12 50A38 38 0 1 1 88 50",
    help: "M60 109C48 89 25 66 25 44A35 35 0 0 1 95 44C95 66 72 89 60 109ZM73 44A13 13 0 1 1 47 44A13 13 0 1 1 73 44",
    programs: "M20 20H100V104H20ZM38 20V104M20 44H100M20 66H100M20 86H100",
  };
  return <div aria-hidden="true" className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center bg-[#0b0a09]" style={{ opacity: 1 - progress(time, 900, 600) }}><svg width="110" height="110" viewBox="0 0 120 120" fill="none" stroke="#dbc173" strokeWidth="2"><path d={paths[chapter]} pathLength="1" strokeDasharray="1" strokeDashoffset={1 - progress(time, 0, 850)} /></svg></div>;
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

function CloseScene({ time }: { time: number }) {
  return (
    <div className="flex h-full flex-col justify-center px-20">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/brand/steel-man-mark-light.svg" alt="" className="mb-12 h-20 w-auto self-start" style={reveal(time, 0)} />
      <p className="text-[90px] font-bold leading-tight text-[#f4efe2]" style={reveal(time, 300)}>Your next <span className="text-[#dbc173]">move.</span></p>
      <p className="mt-7 text-[34px] text-[#b9b2a0]" style={reveal(time, 900)}>Start with the work you know.</p>
      <div className="mt-12 flex gap-5" style={reveal(time, 1600)}>
        <a href="/" className="rounded-[6px] bg-[#dbc173] px-9 py-5 text-[24px] font-semibold text-[#121110] hover:bg-[#f0dda0]" style={{ boxShadow: `0 0 0 ${Math.sin(progress(time, 2400, 1200) * Math.PI) * 12}px rgba(219,193,115,.12)` }}>Start free in the Forge</a>
        <a href={`${SITE}/organizations`} className="rounded-[6px] border border-white/30 px-9 py-5 text-[24px] text-[#f4efe2] hover:bg-white/10">For organizations</a>
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
  const [manual, setManual] = useState(false);
  const [choice, setChoice] = useState<RecordChoice>("off");
  const [domSpot, setDomSpot] = useState<Box | null>(null);
  const [cam, setCam] = useState<Cam>({ s: 1, tx: 0, ty: 0, ms: 0, ease: EASE });
  const [cursor, setCursor] = useState<{ p: Pt; on: boolean; down: boolean; ms: number }>({ p: [0.86, 0.9], on: false, down: false, ms: 0 });
  const prevScene = useRef<string>("");

  const step = STEPS[i];
  const scene = SCENES[step.scene];
  // The screen settles first, then the caption arrives (Troy, 2026-11-01: "the screen is one focal
  // point, the text box another"); the hold grows by the same delay so reading time is unchanged.
  const hold = step.duration ?? holdMs(step) + CAPTION_DELAY;
  const still = reduced || manual;
  const time = still ? hold : elapsed;
  const chapterOpening = i > 0 && STEPS[i - 1].chapter !== step.chapter;
  const captionDelay = step.scene === "forge-line" ? 7600 : CAPTION_DELAY;
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
    const apply = () => { setReduced(mq.matches); if (mq.matches) { setPlaying(false); setUserPaused(true); } };
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
      else if (!userPaused && !reduced && !manual && !last) setPlaying(true);
    }, { threshold: 0.45 });
    io.observe(el);
    return () => io.disconnect();
  }, [userPaused, last, reduced, manual]);

  /* Clock */
  useEffect(() => {
    if (!playing || reduced || manual) return;
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
  }, [playing, reduced, manual]);

  useEffect(() => {
    if (!playing || reduced || manual || elapsed < hold) return;
    if (last) {
      setPlaying(false);
      return;
    }
    // Reset the clock in the same update, or a shorter next beat is skipped.
    setElapsed(0);
    setI((n) => n + 1);
  }, [elapsed, hold, last, playing, reduced, manual]);

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
    const measure = () => {
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
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [i, choice, stage.w, stage.h, scene, step.spot]);

  const spot: Box | null = Array.isArray(step.spot) ? (step.spot as Box) : domSpot;

  /*
   * The caption card beside the stage follows the point it talks about (Troy, 2026-11-01: placement
   * should not repeat, and motion should draw the eye to the main point). Each beat: the spotlight's
   * box in stage pixels, the card's height, and from those the card's top, so the card lines up with
   * the spotlight and glides there; a leader line then draws from the card to the spotlight's edge.
   */
  const capRef = useRef<HTMLDivElement>(null);
  const [capH, setCapH] = useState(160);
  useLayoutEffect(() => {
    const el = capRef.current;
    if (!el) return;
    const h = el.getBoundingClientRect().height;
    if (h && Math.abs(h - capH) > 1) setCapH(h);
  }, [i, stage.w, step.title, step.body]); // eslint-disable-line react-hooks/exhaustive-deps
  const callout = useMemo(() => {
    if (!sideCaption || !stage.w) return null;
    const pad = 8;
    if (!spot) return { top: Math.max(pad, (stage.h - capH) / 2), line: null };
    const t = frame(stage, scene, step, spot, false);
    const sx = t.tx + spot[0] * scene.w * t.s;
    const sy = t.ty + spot[1] * scene.h * t.s;
    const sw = spot[2] * scene.w * t.s;
    const sh = spot[3] * scene.h * t.s;
    const cy = sy + sh / 2;
    const top = Math.round(Math.max(pad, Math.min(stage.h - capH - pad, cy - capH / 2)));
    // From the card's left edge, level with its middle, to the spotlight's right edge at its middle.
    const x1 = stage.w + SIDE_GAP;
    const y1 = top + capH / 2;
    const x2 = Math.min(stage.w - 2, sx + sw + 6);
    const y2 = Math.max(0, Math.min(stage.h, cy));
    const len = Math.hypot(x2 - x1, y2 - y1);
    return { top, line: { x1, y1, x2, y2, len } };
  }, [sideCaption, stage, spot, scene, step, capH]);

  /* Camera */
  useEffect(() => {
    if (!stage.w) return;
    const sceneChanged = prevScene.current !== step.scene;
    prevScene.current = step.scene;
    const target = frame(stage, scene, step, spot, overlayCaption);
    const ms = still || sceneChanged ? 0 : CAM_MS;
    setCam({ ...target, ms, ease: EASE });

  }, [i, stage, still, spot?.[0], spot?.[1], spot?.[2], spot?.[3]]); // eslint-disable-line react-hooks/exhaustive-deps

  /* Cursor and real record choices advance on the same clock as the reveal. */
  useEffect(() => {
    if (!step.click) { setCursor((c) => c.on ? { ...c, on: false } : c); return; }
    let target: Pt | null = null;
    let el: HTMLElement | null = null;
    if (typeof step.click === "string") {
      el = sceneRef.current?.querySelector<HTMLElement>(step.click) ?? null;
      const root = sceneRef.current;
      if (el && root) {
        const r = root.getBoundingClientRect(), b = el.getBoundingClientRect();
        target = [(b.left - r.left + b.width / 2) / r.width, (b.top - r.top + b.height / 2) / r.height];
      }
    } else if (Array.isArray(step.click)) target = step.click as Pt;
    else if (spot) target = [spot[0] + spot[2] / 2, spot[1] + spot[3] / 2];
    if (!target) return;
    const t = progress(time, 900, 700), eased = t * t * (3 - 2 * t);
    const clicked = time >= 2100;
    setCursor({ p: [.86 + (target[0] - .86) * eased, .9 + (target[1] - .9) * eased], on: !still, down: clicked && time < 2280, ms: 0 });
    if (clicked && step.action && step.action !== "why") setChoice(step.action);
    if (step.action === "why" && el?.getAttribute("aria-expanded") !== String(clicked)) el?.click();
  }, [i, time, still, step, spot?.[0], spot?.[1], spot?.[2], spot?.[3]]); // eslint-disable-line react-hooks/exhaustive-deps

  /* CSS transitions (camera and spotlight) pause alongside the narrative clock. */
  useEffect(() => {
    rootRef.current?.getAnimations({ subtree: true }).forEach((animation) => {
      if (typeof CSSTransition !== "undefined" && animation instanceof CSSTransition) {
        if (playing && !still) animation.play(); else animation.pause();
      }
    });
  }, [playing, still]);

  /* Controls */
  const go = useCallback((n: number) => {
    setI(Math.max(0, Math.min(STEPS.length - 1, n)));
    setElapsed(0);
    setManual(true);
    setPlaying(false);
    setUserPaused(true);
  }, []);
  const toggle = useCallback(() => {
    if (reduced) return;
    if (manual && !last) { setManual(false); setElapsed(0); setUserPaused(false); setPlaying(true); return; }
    if (last && !playing) {
      setI(0);
      setElapsed(0);
      setManual(false);
      setUserPaused(false);
      setPlaying(true);
      return;
    }
    setPlaying((p) => {
      setUserPaused(p);
      return !p;
    });
  }, [last, playing, reduced, manual]);

  const onKey = (e: React.KeyboardEvent) => {
    if ((e.target as HTMLElement).closest("a,button,input")) return;
    if (e.key === " " || e.key === "k") {
      e.preventDefault();
      toggle();
    } else if (e.key === "ArrowRight") { e.preventDefault(); go(i + 1); }
    else if (e.key === "ArrowLeft") { e.preventDefault(); go(i - 1); }
  };

  const chapterStart = useMemo(() => CHAPTERS.map((c) => STEPS.findIndex((s) => s.chapter === c.id)), []);
  const ring = 3 / (cam.s || 1);
  const ripple = step.click && !still && time >= 2100 && time < 2750 ? { p: cursor.p, k: i } : null;
  const isImg = scene.kind === "img";
  const sceneNote = scene.note;

  return (
    <div
      ref={rootRef}
      data-step={i}
      data-playing={playing}
      data-still={still}
      data-elapsed={Math.round(time)}
      tabIndex={0}
      onKeyDown={onKey}
      aria-label="Guided tour of Steel Man Resumes. Space to pause, arrows to step."
      className="wt-player rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-[#dbc173]"
    >
      {/* Stage, with the caption beside it on a wide window */}
      <div className={sideCaption ? "relative flex items-center gap-5" : ""}>
      <div
        ref={stageRef}
        data-tour-stage=""
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
              <img src={(scene as { src: string }).src} alt={`${step.title}. ${step.body}`} className="block h-full w-full select-none" draggable={false} style={step.scene === "art-tailor" ? { clipPath: `circle(${15 + progress(time, 0, 1300) * 90}% at 45% 45%)` } : undefined} />
            ) : step.scene === "title" ? (
              <TitleScene time={time} />
            ) : step.scene === "forge-line" ? (
              <ConversationScene time={time} />
            ) : step.scene === "tools" ? (
              <ToolsScene />
            ) : step.scene === "close" ? (
              <CloseScene time={time} />
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

        {chapterOpening && !still && <ChapterCue chapter={step.chapter} time={time} />}
        {sceneNote && (
          <p className={`pointer-events-none absolute z-30 rounded bg-black/70 px-2 py-1 font-mono uppercase tracking-[0.08em] text-[#b0aa98] ${narrow ? "bottom-2 right-2 text-[8px]" : "right-3 top-3 text-[10px]"}`}>
            {sceneNote}
          </p>
        )}
        {!playing && !still && step.scene !== "close" && (
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
        <div className="relative w-[300px] shrink-0 self-stretch lg:w-[340px]" aria-live="polite">
          {step.scene !== "title" && step.scene !== "close" && callout && (
            <div ref={capRef} className="absolute left-0 right-0" style={{ top: callout.top, transition: reduced ? "none" : "top 700ms cubic-bezier(.16,1,.3,1)" }}>
              <div key={`caps-${i}`} data-tour-caption="" className="wt-card relative rounded-lg border border-white/10 bg-[#121110]/60 px-5 py-4 shadow-2xl backdrop-blur" style={{ animationDelay: `${captionDelay}ms` }}>
                {/* The gold bar draws down the left edge as the card lands. */}
                <span aria-hidden="true" className="wt-bar absolute bottom-0 left-0 top-0 w-[3px] origin-top rounded-l-lg bg-[#dbc173]" style={{ animationDelay: `${captionDelay + 80}ms` }} />
                <p className="wt-text font-mono text-[11px] uppercase tracking-[0.14em] text-[#dbc173]" style={{ animationDelay: `${captionDelay + 120}ms` }}>{CHAPTERS[chapterIndex].label}</p>
                <p className="wt-text mt-1 text-2xl font-bold leading-snug text-[#f4efe2]" style={{ animationDelay: `${captionDelay + 240}ms` }}>
                  <span className="relative inline">
                    {step.title}
                    {/* The main point gets its line: a gold underline draws beneath the title. */}
                    <span aria-hidden="true" className="wt-underline absolute -bottom-0.5 left-0 h-[2px] w-full origin-left bg-[#dbc173]/80" style={{ animationDelay: `${captionDelay + 620}ms` }} />
                  </span>
                </p>
                <p className="wt-text mt-2 text-[17px] leading-relaxed text-[#cfc8b6]" style={{ animationDelay: `${captionDelay + 420}ms` }}>{step.body}</p>
              </div>
            </div>
          )}
        </div>
      )}
      {/* The leader line: from the card to the spotlight, drawn once the card is up. Over both, under nothing a viewer clicks. */}
      {sideCaption && step.scene !== "title" && step.scene !== "close" && callout?.line && !reduced && (
        <svg key={`lead-${i}`} aria-hidden="true" className="pointer-events-none absolute inset-0 z-10 overflow-visible" width="100%" height="100%">
          <line
            className="wt-lead"
            x1={callout.line.x1} y1={callout.line.y1} x2={callout.line.x2} y2={callout.line.y2}
            stroke="#dbc173" strokeWidth="1.5" strokeLinecap="round" strokeOpacity="0.85"
            style={{ strokeDasharray: callout.line.len, strokeDashoffset: callout.line.len, animationDelay: `${captionDelay + 300}ms` }}
          />
          <circle className="wt-dot" cx={callout.line.x2} cy={callout.line.y2} r="3.5" fill="#dbc173" style={{ animationDelay: `${captionDelay + 720}ms` }} />
        </svg>
      )}
      </div>

      {/* Caption under a narrow stage */}
      {!sideCaption && step.scene !== "title" && step.scene !== "close" && (
        <div key={`capn-${i}`} data-tour-caption="" className="wt-cap mt-3 min-h-[6.5rem] border-l-[3px] border-l-[#dbc173] pl-4" style={{ animationDelay: `${captionDelay}ms` }}>
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
        <button type="button" disabled={reduced} onClick={toggle} aria-label={last && !playing ? "Replay" : playing ? "Pause" : "Play"} className="inline-flex items-center gap-2 rounded-[5px] bg-[#dbc173] px-3 py-2 text-sm font-semibold text-[#121110] hover:bg-[#f0dda0]">
          {last && !playing ? <RotateCcw size={16} aria-hidden="true" /> : playing ? <Pause size={16} aria-hidden="true" /> : <Play size={16} aria-hidden="true" />}
          <span className="hidden sm:inline">{reduced ? "Still view" : last && !playing ? "Replay" : playing ? "Pause" : "Play"}</span>
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
        .wt-player[data-playing="false"] *, .wt-player[data-playing="false"] *::before { animation-play-state: paused !important; }
        .wt-player[data-still="true"] .wt-cut, .wt-player[data-still="true"] .wt-cap,
        .wt-player[data-still="true"] .wt-card, .wt-player[data-still="true"] .wt-text,
        .wt-player[data-still="true"] .wt-dot { animation: none !important; opacity: 1 !important; transform: none !important; }
        .wt-player[data-still="true"] .wt-bar, .wt-player[data-still="true"] .wt-underline { animation: none !important; transform: none !important; }
        .wt-player[data-still="true"] .wt-lead { animation: none !important; stroke-dashoffset: 0 !important; }
        .wt-player[data-still="true"] * { transition: none !important; }

        .wt-cut { animation: wtCut 320ms ease both; }
        @keyframes wtCut { from { opacity: 0; } to { opacity: 1; } }
        .wt-cap { animation: wtCap 420ms cubic-bezier(.16,1,.3,1) both; }
        @keyframes wtCap { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
        .wt-rise { opacity: 0; animation: wtRise 700ms cubic-bezier(.16,1,.3,1) forwards; }
        @keyframes wtRise { from { opacity: 0; transform: translateY(18px); } to { opacity: 1; transform: none; } }
        .wt-card { opacity: 0; animation: wtCard 520ms cubic-bezier(.16,1,.3,1) forwards; }
        @keyframes wtCard { from { opacity: 0; transform: translateX(14px) scale(.97); } to { opacity: 1; transform: none; } }
        .wt-bar { transform: scaleY(0); animation: wtBar 420ms cubic-bezier(.16,1,.3,1) forwards; }
        @keyframes wtBar { to { transform: scaleY(1); } }
        .wt-text { opacity: 0; animation: wtText 460ms cubic-bezier(.16,1,.3,1) forwards; }
        @keyframes wtText { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
        .wt-underline { transform: scaleX(0); animation: wtUnderline 480ms cubic-bezier(.16,1,.3,1) forwards; }
        @keyframes wtUnderline { to { transform: scaleX(1); } }
        .wt-lead { animation: wtLead 480ms cubic-bezier(.4,0,.2,1) forwards; }
        @keyframes wtLead { to { stroke-dashoffset: 0; } }
        .wt-dot { opacity: 0; transform-box: fill-box; transform-origin: center; animation: wtDot 320ms ease-out forwards; }
        @keyframes wtDot { from { opacity: 0; transform: scale(.4); } to { opacity: 1; transform: none; } }
        .wt-ripple { animation: wtRipple 650ms ease-out forwards; }
        .wt-flash { animation: wtFlash 900ms ease forwards; }
        @keyframes wtFlash { 0%,40% { opacity: 1; } 100% { opacity: 0; } }
        @keyframes wtRipple { from { opacity: 1; transform: scale(.4); } to { opacity: 0; transform: scale(1.9); } }
        @media (prefers-reduced-motion: reduce) {
          .wt-cut, .wt-cap, .wt-rise, .wt-ripple, .wt-card, .wt-text, .wt-dot { animation: none; opacity: 1; }
          .wt-bar, .wt-underline { animation: none; transform: none; }
        }
      `}</style>
    </div>
  );
}

