"use client";
/**
 * The Settings tour's player, version 2 (SETTINGS-TOUR-V2-STORYBOARD.md and its
 * "v2 teaching plan"): a lesson in three acts, auto-playing at the entrance
 * tour's reading pace, led by t.ROY.
 *
 * Act one is the stage: the goal card, then the map of the eight sections
 * (wide, then a pan tile by tile), which shrinks into the corner card. Act two
 * is the real Settings page: a page camera (one requestAnimationFrame loop
 * driven by the beat clock, so Pause freezes it mid-move) scrolls the window
 * and, on wide screens only, scales the page frame (#refinery-page-settings)
 * up to 1.3 around the target. Slow beats light one thing; sweeps hop chip to
 * chip while the page pans under the spotlight. Act three grows the stage back
 * out of the card for the recap, then the ending: five short questions, graded
 * on the server, and the one-time bonus. No real control is pressed and no
 * setting is saved; the one thing the tour opens is the Advanced settings
 * disclosure for the creativity slider, put back when the tour closes.
 *
 * Five objectives tick on the card's strip as their chapters finish (no server
 * call); the recap lists them; a passed quiz fills them in gold.
 *
 * Pause, Previous, Next, Leave and Stop motion are on the card. Space pauses,
 * arrows step; Escape is the controller's (it leaves and keeps the place).
 * Reduced motion (system or the switch) never auto-plays: Next steps through
 * each chip of a sweep, and the camera cuts with no zoom.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { ChevronLeft, ChevronRight, Pause, Play, X } from 'lucide-react';
import { TroyLivingIcon } from '@crucible/consumer-ui';
import { CompletionConfetti } from '@/components/CompletionConfetti';
import { TOUR_COPY } from '@/lib/tour/beats';
import { findNavElement } from '@/lib/tour/find-target';
import { OBJECTIVES, SETTINGS_ENDING, SETTINGS_REWARD_COPY, SETTINGS_TOUR_COPY, type ObjectiveId, type SettingsBeat, type SettingsNudge } from '@/lib/tour/settings-beats';
import { SETTINGS_QUESTIONS, SETTINGS_QUIZ_VERSION, type SettingsQuizAnswers, type SettingsQuizResult } from '@/lib/tour/settings-quiz';
import { clipHeight, objectivesDone, portraitCutHeight, scrollTopFor, settingsRewardMessage } from '@/lib/tour/settings-tour';
import { ACT_CHANGE_MS, CAMERA_EASE, ORIENT_MS } from '@/lib/tour/timing';
import { captionPlacement, onStage, particlePath, spotlightRect, unionBox, type Box, type Camera } from '@/lib/tour/geometry';
import { PORTRAIT_MIN_SCALE } from '@/lib/tour/layout';
import { rewardCelebrates, type TourReward } from '@/lib/tour/reward';
import {
  HOP_MS, MAP_SCENE, NARROW, P_MAP, TILE_PAN_MS, TILE_ZOOM, TOP_BAR_PX, ZOOM_AT_MS, ZOOM_MS,
  beatMs, chipAt, chipStarts, focusScroll, followTimes, lerp, lerpBox, mapTileBox, mapWideScale, pageShot, portraitMapHeight, stageCamera, tween,
} from '@/lib/tour/settings-camera';
import { Check, GOAL_SCENE, GoalScene, MapScene, P_GOAL_SCENE, P_RECAP_SCENE, PortraitGoal, PortraitMap, RECAP_SCENE, RecapScene } from './SettingsScenes';
import { SETTINGS_TOUR_REVEAL_EVENT } from '@/lib/tour/settings-reveal';
import './entrance-tour.css';
import './orientation.css';
import './settings-tour.css';

/** A stop whose element is missing for this long is passed over. */
const LOST_MS = 1200;
const MOTION_KEY = 'tour-motion-off:';
const FRAME_ID = 'refinery-page-settings';
const DEV = process.env.NODE_ENV !== 'production';

export interface SettingsFinish { reward: TourReward | null; quiz: SettingsQuizResult | null }

export interface SettingsTourPlayerProps {
  /** The stops this run shows, in order (lib/tour/settings-tour.ts applicableBeats). */
  beats: readonly SettingsBeat[];
  /** Index into `beats` to start at; beats.length is the ending. */
  start: number;
  accountId: string;
  nudge: SettingsNudge;
  /** The current stop (index into `beats`, or beats.length for the ending), for saving the place. */
  onBeat: (index: number) => void;
  onLeave: () => void;
  /** Saves completion with the answers (or none, skipped); resolves with the server's result or throws a message. */
  onFinish: (quiz: SettingsQuizAnswers | null) => Promise<SettingsFinish>;
  /** Closes the tour; with targets, scrolls the page to the first that exists. */
  onDone: (targets?: readonly string[]) => void;
  /** The chip's "Take the questions": open straight on the questions of a finished run. */
  quizOnly?: boolean;
  saveError?: string;
  onRetrySave?: () => void;
}

function osReduced() {
  try { return matchMedia('(prefers-reduced-motion: reduce)').matches || document.documentElement.classList.contains('reduce-motion'); } catch { return false; }
}
function readQuiet(account: string) {
  try { return sessionStorage.getItem(MOTION_KEY + account) === '1'; } catch { return false; }
}
function mapHeight() {
  return document.getElementById('refinery-tool-settings-map')?.getBoundingClientRect().height ?? 0;
}
function pageFrame() {
  return document.getElementById(FRAME_ID);
}

/** Scroll the page so the target sits under the sticky chrome (the nudge's landing). The section map itself goes to the top. */
export function scrollToTarget(el: HTMLElement) {
  if (el.id === 'refinery-tool-settings-map') { window.scrollTo({ top: 0, behavior: 'auto' }); return; }
  window.scrollTo({ top: scrollTopFor(el.getBoundingClientRect().top, window.scrollY, mapHeight()), behavior: 'auto' });
}

/* ---------- Page camera: one place writes scroll and scale, one takes them off ---------- */

const camState = { scale: 1, origin: { x: 0, y: 0 } };
function setPageCamera(scroll: number, scale: number, origin: { x: number; y: number }) {
  const el = pageFrame();
  const flat = Math.abs(scale - 1) < 0.0005;
  if (el) {
    if (flat) { el.style.transform = ''; el.style.transformOrigin = ''; }
    else { el.style.transformOrigin = `${origin.x}px ${origin.y}px`; el.style.transform = `scale(${scale})`; }
  }
  camState.scale = flat ? 1 : scale; camState.origin = origin;
  if (Math.abs(window.scrollY - scroll) >= 0.5) window.scrollTo({ top: scroll, behavior: 'instant' as ScrollBehavior });
}
/** Leave, Escape, the ending, a route change and unmount all come here. Scroll stays where it is. */
export function resetPageCamera() {
  const el = pageFrame();
  if (el) { el.style.transform = ''; el.style.transformOrigin = ''; }
  camState.scale = 1; camState.origin = { x: 0, y: 0 };
}
function reveal(open: boolean) {
  window.dispatchEvent(new CustomEvent(SETTINGS_TOUR_REVEAL_EVENT, { detail: { part: 'coach-advanced', open } }));
}

/** Every visible element for these ids (element ids or data-tour ids), never one inside hidden copy. */
function findAll(ids: readonly string[]): HTMLElement[] {
  const out: HTMLElement[] = [];
  for (const id of ids) {
    for (const el of Array.from(document.querySelectorAll<HTMLElement>(`[id="${id}"], [data-tour="${id}"]`))) {
      if (el.getClientRects().length && !el.closest('[aria-hidden="true"], [hidden]') && el.getBoundingClientRect().width > 0) out.push(el);
    }
  }
  return out;
}
function liveBox(els: HTMLElement[]): Box | null {
  return unionBox(els.map(el => { const r = el.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; }));
}
/** Untransformed layout, read with the page's transform lifted for one synchronous read (no paint in between). */
function measureFlat<T>(read: () => T): T {
  const el = pageFrame();
  const y = window.scrollY;
  const before = el?.style.transform ?? '';
  if (el) el.style.transform = 'none';
  try { return read(); } finally {
    if (el) el.style.transform = before;
    if (Math.abs(window.scrollY - y) >= 0.5) window.scrollTo({ top: y, behavior: 'instant' as ScrollBehavior });
  }
}
const maxScroll = () => Math.max(0, document.documentElement.scrollHeight - innerHeight);
const same = (a: Box | null, b: Box | null) => (!a && !b) || (!!a && !!b && Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) < 0.5 && Math.abs(a.w - b.w) < 0.5 && Math.abs(a.h - b.h) < 0.5);

type Pill = { label: string; lit: boolean; x: number; y: number };

export function SettingsTourPlayer(props: SettingsTourPlayerProps) {
  const { beats, start, accountId, nudge, onBeat, onLeave, quizOnly } = props;
  const ENDING = beats.length;
  const [i, setI] = useState(() => Math.max(0, Math.min(ENDING, start)));
  /** Motion-off: the chip a sweep is on (Next steps through them). */
  const [step, setStep] = useState(0);
  const [furthest, setFurthest] = useState(() => (quizOnly ? ENDING : Math.max(0, Math.min(ENDING, start))));
  const [systemReduced, setSystemReduced] = useState(osReduced);
  const [quiet, setQuiet] = useState(() => readQuiet(accountId));
  const reduced = systemReduced || quiet;
  const [playing, setPlaying] = useState(() => !(osReduced() || readQuiet(accountId)));
  const [hidden, setHidden] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [view, setView] = useState({ w: typeof window === 'undefined' ? 1280 : innerWidth, h: typeof window === 'undefined' ? 800 : innerHeight });
  const [stage, setStage] = useState({ w: 0, h: 0 });
  const [shrink, setShrink] = useState<Box | null>(null);
  /** The stage growing back out of the card for the recap: its start box, cleared on the next frame. */
  const [grow, setGrow] = useState<Box | null>(null);
  /** The page stays dimmed for the whole grow (the stage's 900 ms transition), not only its first frames. */
  const [veil, setVeil] = useState(false);
  const [cut, setCut] = useState<Box | null>(null);
  const [pills, setPills] = useState<Pill[]>([]);
  const [ring, setRing] = useState<Box | null>(null);
  // A first guess close to the real card (the strip and the why line make it about 400 px), so the first plan is right.
  const [cardH, setCardH] = useState(() => (typeof window !== 'undefined' && innerWidth < NARROW ? 420 : 400));
  const [cardEl, setCardEl] = useState<HTMLDivElement | null>(null);
  const [particles, setParticles] = useState<{ key: number; d: string } | null>(null);
  const [announce, setAnnounce] = useState('');
  /** A beat whose target never showed is passed over; the loop asks for it here. */
  const [lost, setLost] = useState(-1);
  const stageRef = useRef<HTMLDivElement>(null);
  const markRef = useRef<HTMLSpanElement>(null);
  const playRef = useRef<HTMLButtonElement>(null);
  const clock = useRef(0);
  const dir = useRef(1);
  const sentParticles = useRef('');
  const cardHRef = useRef(cardH);
  cardHRef.current = cardH;

  const beat: SettingsBeat | undefined = beats[i];
  const ending = i >= ENDING;
  const portrait = view.w < NARROW;
  const hold = beat ? beatMs(beat, portrait) : 0;
  const onStageBeat = beat?.where === 'stage';
  const chips = beat?.chips ?? [];
  const sweep = beat?.kind === 'sweep';
  const done = objectivesDone(beats, furthest);
  const stepTime = (k: number) => (beat && sweep ? (onStageBeat && k === 0 ? ORIENT_MS : chipStarts(beat, portrait)[k]) + 1 : 60000);
  /** Motion-off and paused: the chip Next stepped to. Otherwise the beat clock. */
  const stepped = reduced && !playing;
  const t = stepped ? stepTime(step) : elapsed;

  /* Environment */
  useEffect(() => {
    const media = matchMedia('(prefers-reduced-motion: reduce)');
    const sync = () => { const r = osReduced(); setSystemReduced(r); if (r) setPlaying(false); };
    const mutation = new MutationObserver(sync);
    mutation.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    const vis = () => setHidden(document.hidden);
    const size = () => setView({ w: innerWidth, h: innerHeight });
    media.addEventListener('change', sync); document.addEventListener('visibilitychange', vis); addEventListener('resize', size);
    vis();
    return () => { mutation.disconnect(); media.removeEventListener('change', sync); document.removeEventListener('visibilitychange', vis); removeEventListener('resize', size); };
  }, []);
  useEffect(() => { playRef.current?.focus({ preventScroll: true }); }, []);
  /* Every way out takes the zoom off and closes what the tour opened. */
  useEffect(() => () => { resetPageCamera(); reveal(false); }, []);

  const toggleMotion = useCallback(() => {
    setQuiet(q => {
      const next = !q;
      try { if (next) sessionStorage.setItem(MOTION_KEY + accountId, '1'); else sessionStorage.removeItem(MOTION_KEY + accountId); } catch {}
      if (next) setPlaying(false);
      return next;
    });
  }, [accountId]);

  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setStage({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, [onStageBeat ? 'stage' : 'other']); // eslint-disable-line react-hooks/exhaustive-deps

  /* Navigation */
  const cardBox = captionPlacement(null, view.w, view.h, { w: 360, h: cardH });
  const iRef = useRef(i);
  iRef.current = i;
  const go = useCallback((n: number, atStep = 0) => {
    const next = Math.max(0, Math.min(ENDING, n));
    const cur = iRef.current;
    dir.current = next >= cur ? 1 : -1;
    // Entering the recap from the page: the stage grows back out of the card.
    if (beats[next]?.where === 'stage' && beats[cur]?.where === 'page' && !reduced) setGrow(captionPlacement(null, innerWidth, innerHeight, { w: 360, h: cardHRef.current }));
    setI(next);
    setFurthest(f => Math.max(f, next));
    setStep(atStep);
    clock.current = 0; setElapsed(0); setShrink(null);
  }, [ENDING, beats, reduced]);
  useEffect(() => { onBeat(i); }, [i, onBeat]);
  useEffect(() => { if (lost === i) { setLost(-1); go(i + dir.current); } }, [lost, i, go]);
  const next = useCallback(() => {
    if (reduced && beat && sweep && step < chips.length - 1) { setStep(step + 1); return; }
    go(i + 1);
  }, [reduced, beat, sweep, step, chips.length, go, i]);
  const prev = useCallback(() => {
    if (reduced && beat && sweep && step > 0) { setStep(step - 1); return; }
    const back = beats[i - 1];
    go(i - 1, reduced && back?.chips ? back.chips.length - 1 : 0);
  }, [reduced, beat, sweep, step, go, i, beats]);

  const advance = useCallback(() => {
    // Off the stage onto the page, the map shrinks into the card and the real page is underneath.
    if (onStageBeat && beats[i + 1]?.where === 'page' && !reduced) setShrink(cardBox);
    else go(i + 1);
  }, [onStageBeat, beats, i, reduced, cardBox, go]);
  useEffect(() => {
    if (!shrink) return;
    const timer = setTimeout(() => go(i + 1), ACT_CHANGE_MS);
    return () => clearTimeout(timer);
  }, [shrink, go, i]);
  useLayoutEffect(() => {
    if (!grow) return;
    setVeil(true);
    const raf = requestAnimationFrame(() => requestAnimationFrame(() => setGrow(null)));
    return () => cancelAnimationFrame(raf);
  }, [grow]);
  useEffect(() => {
    if (!veil || grow) return;
    const timer = setTimeout(() => setVeil(false), ACT_CHANGE_MS);
    return () => clearTimeout(timer);
  }, [veil, grow]);

  /* Clock: runs while playing, visible, not between acts and not on the ending. */
  const running = playing && !hidden && !ending && !shrink && !grow;
  useEffect(() => {
    if (!running) return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      clock.current += now - last; last = now;
      setElapsed(e => (clock.current - e >= 50 ? clock.current : e));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [running]);
  useEffect(() => { if (running && elapsed >= hold) advance(); }, [elapsed, hold, running, advance]);

  /* The ending and the stage take the zoom off at once. */
  useEffect(() => { if (ending) { resetPageCamera(); setCut(null); setPills([]); setRing(null); } }, [ending]);

  /* Screen reader: one announcement per stop, chips listed once. */
  useEffect(() => {
    if (ending || !beat) return;
    const list = beat.chips && beat.where === 'page' ? ` ${SETTINGS_TOUR_COPY.chipsSr(beat.chips.map(c => c.label))}` : '';
    const head = /[.!?]$/.test(beat.title) ? beat.title : `${beat.title}.`;
    const ticked = beats[i - 1]?.ticks ? ` ${SETTINGS_TOUR_COPY.ticked(OBJECTIVES.find(o => o.id === beats[i - 1].ticks)!.short)}` : '';
    setAnnounce(`${SETTINGS_TOUR_COPY.stopOf(i + 1, ENDING)}. ${head} ${beat.body}${beat.why ? ` ${SETTINGS_TOUR_COPY.whyLabel} ${beat.why}` : ''}${list}${beat.glyph ? ` ${SETTINGS_TOUR_COPY.doorsSr}` : ''}${ticked}`);
  }, [i]); // eslint-disable-line react-hooks/exhaustive-deps

  /*
   * The page camera, the cutout, the chip labels and the reading ring, every frame,
   * as a function of the beat clock. Planned once per beat from untransformed
   * layout (as soon as the targets exist); the from-state is wherever the camera is
   * when the beat starts, so stepping back and forth never jumps.
   */
  const timeRef = useRef({ stepped, at: t });
  timeRef.current = { stepped, at: t };
  const nowT = () => (timeRef.current.stepped ? timeRef.current.at : clock.current);
  useEffect(() => {
    if (!beat || ending) return;
    if (onStageBeat) {
      // Behind the stage: before the page, it waits at the top; under the recap, it stays where it is (no jump while the stage grows over it). Never scaled.
      setPageCamera(beat.scene === 'recap' ? window.scrollY : 0, 1, camState.origin); setCut(null); setPills([]); setRing(null);
      return;
    }
    if (beat.reveal) reveal(true);
    let raf = 0;
    let alive = true;
    const instant = reduced;
    const began = performance.now();
    const from = { scroll: window.scrollY, scale: camState.scale, origin: { ...camState.origin } };
    const prevBeat = beats[i - 1];
    const prevTargets = prevBeat?.where === 'page' ? (prevBeat.targets ?? prevBeat.chips?.at(-1)?.targets ?? []) : [];
    // The card's resting place from its layout height: its entrance animation moves the live rect 10 px, which once let a zoom touch it.
    const cardRect = (): Box => { const h = Math.max(cardEl?.offsetHeight ?? 0, cardHRef.current); return { x: cardBox.x, y: innerHeight - 16 - h, w: cardBox.w, h }; };
    /** On a phone every cutout stops above the bottom card; one squeezed under it is hidden until it rises (SF-1 rule). */
    const fitCut = (box: Box | null, clip?: number): Box | null => {
      if (!box) return null;
      const h0 = clipHeight(box.h, innerHeight, clip);
      if (!portrait) return spotlightRect({ left: box.x, top: box.y, width: box.w, height: h0 }, innerWidth, innerHeight, 6);
      const cardTop = cardRect().y;
      if (box.y > cardTop - 56) return null;
      const h = portraitCutHeight(h0, Math.max(box.y, TOP_BAR_PX), innerHeight, innerHeight - cardTop, true);
      return spotlightRect({ left: box.x, top: box.y, width: box.w, height: Math.min(h0, h + Math.max(0, TOP_BAR_PX - box.y)) }, innerWidth, innerHeight, 6);
    };

    if (beat.kind === 'slow') {
      let shot: ReturnType<typeof pageShot> | null = null;
      const marks = followTimes(beat);
      const frame = () => {
        if (!alive) return;
        if (!shot) {
          const plan = measureFlat(() => {
            const box = liveBox(findAll(beat.targets ?? []));
            const fr = pageFrame()?.getBoundingClientRect();
            return box && fr ? { target: { x: box.x, y: box.y + scrollY, w: box.w, h: box.h }, frame: { x: fr.left, y: fr.top + scrollY }, max: maxScroll() } : null;
          });
          if (!plan) {
            if (performance.now() - began > LOST_MS) { if (DEV) console.warn(`[settings tour] passed over ${beat.id}`); setLost(i); return; }
            raf = requestAnimationFrame(frame); return;
          }
          shot = pageShot({ target: plan.target, frame: plan.frame, view, card: cardRect(), maxScale: portrait || reduced ? 1 : beat.zoom ?? 1, maxScroll: plan.max });
        }
        const now = nowT();
        const ps = instant ? 1 : tween(now, 0, 1000);
        const pz = instant ? 1 : tween(now, ZOOM_AT_MS, ZOOM_MS);
        setPageCamera(lerp(from.scroll, shot.scrollTop, ps), lerp(from.scale, shot.scale, pz), shot.scale !== 1 ? shot.origin : from.origin);
        const target = liveBox(findAll(beat.targets ?? []));
        const prevBox = prevTargets.length && !instant ? liveBox(findAll(prevTargets)) : null;
        const next = fitCut(target && prevBox ? lerpBox(prevBox, target, ps) : target, beat.clip);
        setCut(c => (same(c, next) ? c : next));
        setPills(p => (p.length ? [] : p));
        // The reading ring: on the part whose sentence the reader has reached, a short eased move between parts.
        let ringBox: Box | null = null;
        if (marks.length && now >= marks[0]) {
          const parts = findAll(beat.targets ?? []);
          let k = 0;
          for (let n = 0; n < marks.length; n++) if (now >= marks[n]) k = n;
          const boxOf = (n: number) => { const el = parts[Math.min(n, parts.length - 1)]; if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.left - 4, y: r.top - 4, w: r.width + 8, h: r.height + 8 }; };
          const here = boxOf(k);
          const pk = instant || k === 0 ? 1 : tween(now, marks[k], HOP_MS);
          const there = k > 0 && pk < 1 ? boxOf(k - 1) : null;
          ringBox = here && there ? lerpBox(there, here, pk) : here;
          if (ringBox && next && ringBox.y + ringBox.h > next.y + next.h + 2) ringBox = null;
        }
        setRing(r => (same(r, ringBox) ? r : ringBox));
        raf = requestAnimationFrame(frame);
      };
      frame();
      return () => { alive = false; cancelAnimationFrame(raf); };
    }

    // A sweep on the page: the spotlight hops chip to chip and the page pans under it.
    let plan: { rows: (Box | null)[]; present: boolean[]; scrolls: (number | null)[] } | null = null;
    const starts = chipStarts(beat, portrait);
    const frame = () => {
      if (!alive) return;
      if (!plan) {
        const flat = measureFlat(() => ({
          rows: (beat.chips ?? []).map(c => { const b = liveBox(findAll(c.targets)); return b ? { ...b, y: b.y + scrollY } : null; }),
          max: maxScroll(),
        }));
        if (!flat.rows.some(Boolean)) {
          if (performance.now() - began > LOST_MS) { if (DEV) console.warn(`[settings tour] passed over ${beat.id}`); setLost(i); return; }
          raf = requestAnimationFrame(frame); return;
        }
        const xs = flat.rows.filter((r): r is Box => !!r);
        const c = cardRect();
        const colRight = Math.max(...xs.map(r => r.x + r.w)), colLeft = Math.min(...xs.map(r => r.x));
        const underCard = colRight > c.x && colLeft < c.x + c.w;
        const bandBottom = underCard ? c.y - 16 : view.h - 16;
        plan = { rows: flat.rows, present: flat.rows.map(r => !!r), scrolls: flat.rows.map(r => (r ? focusScroll(r.y, view, bandBottom, flat.max) : null)) };
      }
      const { present, scrolls } = plan;
      const scrollAt = (k: number): number => { for (let n = k; n >= 0; n--) if (scrolls[n] !== null) return scrolls[n]!; return from.scroll; };
      const now = nowT();
      let k = chipAt(beat, portrait, now);
      while (k > 0 && !present[k]) k--;
      if (!present[k]) k = present.findIndex(Boolean);
      const p = instant ? 1 : k === present.findIndex(Boolean) ? tween(now, 0, ORIENT_MS) : tween(now, starts[k], HOP_MS);
      const first = k === present.findIndex(Boolean);
      if (first) setPageCamera(lerp(from.scroll, scrollAt(k), p), lerp(from.scale, 1, p), from.origin);
      else setPageCamera(lerp(scrollAt(k - 1), scrollAt(k), p), 1, from.origin);
      const lit = liveBox(findAll(beat.chips![k].targets));
      let before: Box | null = null;
      if (!instant) {
        if (!first) { let n = k - 1; while (n > 0 && !present[n]) n--; before = present[n] ? liveBox(findAll(beat.chips![n].targets)) : null; }
        else if (prevTargets.length) before = liveBox(findAll(prevTargets));
      }
      const next = fitCut(lit && before && p < 1 ? lerpBox(before, lit, p) : lit, beat.clip);
      setCut(cc => (same(cc, next) ? cc : next));
      setRing(r => (r ? null : r));
      // Wide screens: the chip labels sit in the gutter right of the column, the lit one bright, the
      // ones shown before as dim labels. Phones list them on the card instead, so nothing covers the page.
      const shown: Pill[] = [];
      if (!portrait) beat.chips!.forEach((chip, n) => {
        if (n > k || !present[n] || (n === k && p < 0.85)) return;
        const b = n === k && next ? next : (() => { const x = liveBox(findAll(chip.targets)); return x && spotlightRect({ left: x.x, top: x.y, width: x.w, height: clipHeight(x.h, innerHeight, beat.clip) }, innerWidth, innerHeight + 4000, 6); })();
        if (!b) return;
        const y = b.y + Math.min(b.h / 2, 28);
        if (y < TOP_BAR_PX + 14 || y > innerHeight - 14 || b.x + b.w + 200 > innerWidth) return;
        shown.push({ label: chip.label, lit: n === k, x: b.x + b.w + 14, y });
      });
      setPills(old => (old.length === shown.length && old.every((o, n) => o.lit === shown[n].lit && Math.abs(o.x - shown[n].x) < 0.5 && Math.abs(o.y - shown[n].y) < 0.5) ? old : shown));
      raf = requestAnimationFrame(frame);
    };
    frame();
    return () => { alive = false; cancelAnimationFrame(raf); };
  }, [i, reduced, portrait, view.w, view.h, cardEl]); // eslint-disable-line react-hooks/exhaustive-deps

  /* t.ROY's particles, once per beat, when the camera lands on its first target. */
  const landAt = !beat ? 0 : beat.where === 'stage' ? ORIENT_MS : beat.kind === 'slow' ? ZOOM_AT_MS + ZOOM_MS : ORIENT_MS;
  const landed = !!beat && !reduced && t >= landAt && (beat.scene === 'map' || beat.where === 'page');
  useEffect(() => {
    if (!landed || !beat || sentParticles.current === beat.id) return;
    sentParticles.current = beat.id;
    const mark = markRef.current?.getBoundingClientRect();
    if (!mark) return;
    let to: { x: number; y: number } | null = null;
    if (beat.where === 'stage') {
      const st = stageRef.current?.getBoundingClientRect();
      if (st && !portrait) { const b = onStage(mapTileBox(0), stageCam(0)); to = { x: st.left + b.x + b.w / 2, y: st.top + b.y + 40 }; }
      else if (st) to = { x: st.left + 60, y: st.top + 30 };
    } else if (cut) to = { x: cut.x + Math.min(cut.w / 2, 60), y: cut.y + Math.min(cut.h / 2, 30) };
    if (!to) return;
    setParticles({ key: Date.now(), d: particlePath({ x: mark.left + mark.width / 2, y: mark.top + mark.height / 2 }, to) });
    const clear = setTimeout(() => setParticles(null), 1600);
    return () => clearTimeout(clear);
  }, [landed, beat?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  /* The card mounts once, when the first page stop starts, and stays. Measure it before paint and hand it focus. */
  useLayoutEffect(() => {
    if (!cardEl) return;
    const measure = () => setCardH(Math.ceil(cardEl.getBoundingClientRect().height));
    measure();
    cardEl.querySelector<HTMLButtonElement>('button.et-primary')?.focus({ preventScroll: true });
    const ro = new ResizeObserver(measure);
    ro.observe(cardEl);
    return () => ro.disconnect();
  }, [cardEl]);

  /* Controls */
  const toggle = useCallback(() => {
    if (ending) return;
    if (reduced && beat && sweep) {
      // Motion-off playing is cuts at reading pace: start the clock at the chip shown, and stop on the chip reached.
      if (!playing) { clock.current = stepTime(step); setElapsed(clock.current); }
      else setStep(chipAt(beat, portrait, clock.current));
    }
    setPlaying(p => !p);
  }, [ending, reduced, beat, sweep, playing, step, portrait]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (ending || e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
      const el = e.target as HTMLElement | null;
      const native = !!el?.closest('button, a, input, textarea, select, label, summary');
      if ((e.key === ' ' && !native) || e.key === 'k') { e.preventDefault(); toggle(); }
      else if (e.key === 'ArrowRight' && !el?.closest('input, select')) { e.preventDefault(); next(); }
      else if (e.key === 'ArrowLeft' && !el?.closest('input, select')) { e.preventDefault(); prev(); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [ending, toggle, next, prev]);

  /* Stage camera: the goal and recap framed whole; the map wide on all eight, then a pan tile by tile at 1.6 times the wide shot. */
  const reserve = portrait || beat?.scene !== 'map' ? 0 : Math.min(200, stage.h * 0.26);
  const tile = beat?.scene === 'map' ? (t < ORIENT_MS ? -1 : chipAt(beat, portrait, t)) : -1;
  const sceneSize = beat?.scene === 'goal' ? (portrait ? P_GOAL_SCENE : GOAL_SCENE) : beat?.scene === 'recap' ? (portrait ? P_RECAP_SCENE : RECAP_SCENE) : portrait ? { w: P_MAP.w, h: portraitMapHeight() } : MAP_SCENE;
  function stageCam(k: number): Camera {
    if (portrait || beat?.scene !== 'map') {
      const s = Math.min(stage.w / sceneSize.w, stage.h / sceneSize.h) * (portrait ? 1 : 0.96);
      return stageCamera(stage, sceneSize, portrait ? Math.max(PORTRAIT_MIN_SCALE, Math.min(s, 1.15)) : s, null, 0);
    }
    const wide = mapWideScale(stage, reserve);
    if (k < 0) return stageCamera(stage, MAP_SCENE, wide, null, reserve);
    const b = mapTileBox(k);
    return stageCamera(stage, MAP_SCENE, wide * TILE_ZOOM, { x: b.x + b.w / 2, y: b.y + b.h / 2 }, reserve);
  }
  const cam = stage.w ? stageCam(tile) : { s: 1, tx: 0, ty: 0 };

  const progress = hold ? Math.min(1, (stepped ? (sweep ? (step + 1) / Math.max(1, chips.length) : 1) * hold : elapsed) / hold) : 0;
  const segs = <div className="et-segs" role="presentation" style={{ flex: '1 1 auto' }}>
    {beats.map((b, n) => <span key={b.id} className="et-seg"><span><i style={{ width: n < i ? '100%' : n > i ? '0%' : `${progress * 100}%` }} /></span></span>)}
  </div>;
  function motionButton() {
    return <button type="button" className="et-motion" onClick={toggleMotion} disabled={systemReduced} aria-label={reduced ? TOUR_COPY.motionToggleOn : TOUR_COPY.motionToggleOff}>
      {reduced ? TOUR_COPY.motionToggleOn : TOUR_COPY.motionToggleOff}
    </button>;
  }
  const buttons = (compact: boolean) => <div className="et-bar__row">
    <button type="button" onClick={prev} disabled={i === 0 && (!reduced || step === 0)} aria-label={TOUR_COPY.previous}><ChevronLeft size={18} aria-hidden="true" /></button>
    <button ref={playRef} type="button" className="et-primary" onClick={toggle} aria-label={playing ? TOUR_COPY.pause : TOUR_COPY.play}>
      {playing ? <Pause size={16} aria-hidden="true" /> : <Play size={16} aria-hidden="true" />}{!compact && <span aria-hidden="true">{playing ? TOUR_COPY.pause : TOUR_COPY.play}</span>}
    </button>
    <button type="button" onClick={next} aria-label={TOUR_COPY.next}><ChevronRight size={18} aria-hidden="true" /></button>
    {!compact && !portrait ? segs : <span className="et-bar__grow" />}
    {!compact && !portrait && motionButton()}
    {compact && portrait && motionButton()}
    <button type="button" onClick={onLeave} aria-label={`${TOUR_COPY.leave}. Escape`}><X size={16} aria-hidden="true" />{!compact && !portrait && <span aria-hidden="true">{TOUR_COPY.leave}</span>}</button>
  </div>;

  const kicker = `${SETTINGS_TOUR_COPY.stopOf(i + 1, ENDING)} · ${SETTINGS_TOUR_COPY.guide}`;
  const why = beat?.why && <p className="st-why"><b>{SETTINGS_TOUR_COPY.whyLabel}</b> {beat.why}</p>;
  const caption = beat && beat.scene === 'map' && <div className={`et-cap${portrait ? ' et-cap--narrow' : ''}`}>
    <span ref={markRef} className="et-cap__mark"><TroyLivingIcon size={portrait ? 36 : 46} attention={!!particles} /></span>
    <div>
      <p className="et-cap__k">{kicker}</p>
      <p className="et-cap__t">{beat.title}</p>
      <p className="et-cap__b">{beat.body}</p>
    </div>
  </div>;
  const scene = beat && onStageBeat && (beat.scene === 'goal'
    ? (portrait ? <PortraitGoal title={beat.title} body={beat.body} t={t} still={reduced} /> : <GoalScene title={beat.title} body={beat.body} t={t} still={reduced} />)
    : beat.scene === 'recap' ? <RecapScene title={beat.title} t={t} still={reduced} hold={hold} done={done} portrait={portrait} />
    : portrait ? <PortraitMap open={tile} /> : <MapScene active={tile} />);

  const wrapBox = shrink ?? grow;
  const shrinkStyle: CSSProperties | undefined = wrapBox ? { transform: `translate(${wrapBox.x}px, ${wrapBox.y}px) scale(${wrapBox.w / view.w}, ${wrapBox.h / view.h})` } : undefined;
  const bottomAnchored = cardBox.y + cardBox.h >= view.h - 17;
  const cardStyle: CSSProperties = bottomAnchored
    ? { left: cardBox.x, bottom: view.h - cardBox.y - cardBox.h, width: cardBox.w, maxHeight: view.h - 32, overflowY: 'auto' }
    : { left: cardBox.x, top: cardBox.y, width: cardBox.w, maxHeight: view.h - 32, overflowY: 'auto' };
  const litChip = sweep && !onStageBeat ? chipAt(beat!, portrait, t) : -1;

  return <div className="et-root st-root" role="dialog" aria-modal="true" aria-label={SETTINGS_TOUR_COPY.dialogLabel} aria-describedby="st-keys" data-playing={running} data-act={ending ? 'end' : onStageBeat ? 'stage' : 'room'} data-beat={beat?.id ?? 'ending'} data-chip={sweep ? (onStageBeat ? tile : litChip) : undefined} data-ticks={[...done].join(' ')}>
    <p id="st-keys" className="et-sr">{TOUR_COPY.keys}</p>
    <p className="et-sr" aria-live="polite">{announce}</p>

    {(shrink || grow || veil || (beat && !onStageBeat)) && <div className="et-dim st-dim" style={{ background: cut && !shrink && !grow && !veil ? 'transparent' : undefined }} aria-hidden="true" />}
    {beat && onStageBeat && <div className="et-wrap" data-shrink={!!wrapBox} style={shrinkStyle}>
      <div ref={stageRef} className="et-stage" aria-hidden="true" onClick={e => { if (e.isTrusted) toggle(); }}>
        {stage.w > 0 && <div className="et-cam" style={{ width: sceneSize.w, height: sceneSize.h, transform: `translate3d(${cam.tx}px, ${cam.ty}px, 0) scale(${cam.s})`, transition: reduced || beat.scene !== 'map' ? 'none' : `transform ${tile <= 0 ? 1100 : TILE_PAN_MS}ms ${CAMERA_EASE}` }}>
          <div key={`${beat.scene}:${portrait}`} className="et-scene">{scene}</div>
        </div>}
        {!portrait && caption}
        {!playing && !reduced && <div aria-hidden="true" className="st-paused"><span><Play size={34} aria-hidden="true" /></span></div>}
      </div>
      {portrait && caption && <div style={{ padding: '10px 0 0', background: '#0b0a09' }}>{caption}</div>}
      <div className="et-bar">
        {buttons(false)}
        {portrait && <div className="et-bar__row">{segs}{motionButton()}</div>}
        {reduced && <p className="et-note">{TOUR_COPY.motionOff}</p>}
      </div>
    </div>}

    {beat && !onStageBeat && <>
      {cut && <div className="et-cutout st-cutout" aria-hidden="true" style={{ left: cut.x, top: cut.y, width: cut.w, height: cut.h }} />}
      {ring && <div className="st-ring" aria-hidden="true" style={{ left: ring.x, top: ring.y, width: ring.w, height: ring.h }} />}
      {pills.map(p => <span key={p.label} className="st-chip" data-lit={p.lit} aria-hidden="true" style={{ left: p.x, top: p.y }}>{p.label}</span>)}
      <div ref={setCardEl} key="settings-card" className="et-card st-card" data-still={reduced} style={cardStyle}>
        <div className="et-card__head">
          <span ref={markRef}><TroyLivingIcon size={40} attention={!!particles} /></span>
          <p className="et-cap__k">{kicker}</p>
        </div>
        <div key={`stop-${i}`} className="et-card__text" style={{ animation: reduced ? 'none' : 'etCap 420ms cubic-bezier(.16,1,.3,1) both' }}>
          <p className="et-cap__t" style={beat.glyph ? { display: 'flex', alignItems: 'center', gap: 10 } : undefined}>
            {beat.glyph === 'doors' && <Doors />}
            <span>{beat.title}</span>
          </p>
          <p className="et-cap__b">{beat.body}</p>
          {why}
          {portrait && sweep && <p className="st-cardchips" aria-hidden="true">{chips.map((c, n) => n <= litChip && <span key={c.label} data-lit={n === litChip}>{c.label}</span>)}</p>}
        </div>
        <Strip done={done} />
        {!portrait && <div className="et-bar__row">{segs}</div>}
        {portrait && <div className="et-mini" aria-hidden="true"><i style={{ width: `${progress * 100}%` }} /></div>}
        {buttons(true)}
        {/* Phones keep the card short: the motion switch rides in the controls row. */}
        {(!portrait || reduced) && <div className="et-bar__row">
          {!portrait && motionButton()}
          {reduced && <p className="et-note">{TOUR_COPY.motionOff}</p>}
        </div>}
      </div>
    </>}

    {ending && <Ending {...props} reduced={reduced} done={done} onBack={() => go(ENDING - 1)} />}

    {particles && !reduced && <svg key={particles.key} className="et-particles" aria-hidden="true">
      <path d={particles.d} fill="none" stroke="#bc9aff" strokeWidth="1.2" opacity=".35" />
      {Array.from({ length: 10 }, (_, n) => <circle key={n} r={n % 3 ? 2.2 : 4} fill={n % 3 ? '#d5b8fa' : '#e8c46a'} style={{ offsetPath: `path('${particles.d}')`, animationDelay: `${n * 34}ms` } as CSSProperties} />)}
    </svg>}

    {props.saveError && !ending && <div className="et-notice" style={{ pointerEvents: 'auto', top: 16 }} role="status">
      <p>{props.saveError}</p>{props.onRetrySave && <button type="button" onClick={props.onRetrySave}>{TOUR_COPY.retrySave}</button>}
    </div>}
  </div>;
}

/** The five objectives on the card: each ticks the moment its chapter finishes. `confirmed` fills them gold after a passed quiz. */
function Strip({ done, confirmed }: { done: ReadonlySet<ObjectiveId>; confirmed?: boolean }) {
  return <div className="st-strip" data-confirmed={!!confirmed} role="list" aria-label={SETTINGS_TOUR_COPY.objectivesLabel}>
    {OBJECTIVES.map(o => {
      const on = confirmed || done.has(o.id);
      return <span key={o.id} role="listitem" className="st-strip__item" data-done={on}>
        <Check size={18} done={on} pop={on} /><span>{o.short}</span><span className="et-sr">{on ? ', learned' : ', not yet'}</span>
      </span>;
    })}
  </div>;
}

/** The sharing beat's glyph: two doors, one open and one shut. */
function Doors() {
  return <svg width="34" height="24" viewBox="0 0 34 24" aria-hidden="true" style={{ flex: '0 0 auto' }}>
    <rect x="1" y="1" width="12" height="22" rx="1.5" fill="none" stroke="#dbc173" strokeWidth="1.6" />
    <circle cx="10" cy="12.5" r="1.1" fill="#dbc173" />
    <rect x="19" y="1" width="14" height="22" rx="1.5" fill="none" stroke="#8f897a" strokeWidth="1.6" />
    <path d="M22 2.2 L30 5 L30 22.2 L22 21.6 Z" fill="#dbc17333" stroke="#dbc173" strokeWidth="1.6" strokeLinejoin="round" />
  </svg>;
}

type Phase = 'intro' | 'quiz' | 'result';

/** The ending: the questions (or skip), then the result. Kind feedback: every answer gets its reason, never a scolding. */
function Ending({ nudge, onFinish, onDone, quizOnly, reduced, done, onBack }: SettingsTourPlayerProps & { reduced: boolean; done: ReadonlySet<ObjectiveId>; onBack: () => void }) {
  const [phase, setPhase] = useState<Phase>(quizOnly ? 'quiz' : 'intro');
  const [q, setQ] = useState(0);
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [result, setResult] = useState<SettingsQuizResult | null>(null);
  const [reward, setReward] = useState<TourReward | null>(null);
  const [skipped, setSkipped] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus({ preventScroll: true }); }, [phase, q]);

  async function send(withAnswers: boolean) {
    if (busy) return;
    setBusy(true); setError('');
    try {
      const out = await onFinish(withAnswers ? { version: SETTINGS_QUIZ_VERSION, answers } : null);
      if (!withAnswers) { setSkipped(true); setReward(out.reward); setPhase('result'); return; }
      if (!out.quiz) throw new Error('Your answers could not be checked. Try again.');
      setResult(out.quiz);
      if (out.quiz.passed) { setReward(out.reward); setPhase('result'); return; }
      const miss = SETTINGS_QUESTIONS.findIndex(x => out.quiz!.review.find(r => r.id === x.id)?.right === false);
      setQ(Math.max(0, miss));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Your answers could not be checked. Try again.');
    } finally { setBusy(false); }
  }

  if (phase === 'result') {
    const passed = !!result?.passed && !skipped;
    const celebrate = !!reward && rewardCelebrates(reward);
    const [title, body] = settingsRewardMessage(skipped ? null : reward ?? { status: 'unavailable', calls: 0 });
    return <div className="et-end" data-reward={skipped ? 'skipped' : reward?.status ?? 'none'}>
      {celebrate && !reduced && <CompletionConfetti />}
      <div className="et-end__card et-reward" role="group" aria-labelledby="st-end-title">
        <div className="et-reward__icon"><TroyLivingIcon size={84} attention={celebrate} /></div>
        <h2 id="st-end-title" ref={heading} tabIndex={-1}>{title}</h2>
        <p className="et-reward__big" role="status">{body}</p>
        {passed && <><Strip done={done} confirmed /><p className="et-end__small">{SETTINGS_ENDING.confirmed}</p></>}
        {error && <p className="et-end__err" role="alert">{error}</p>}
        <div className="et-end__actions">
          {passed && reward?.status === 'unavailable' && <button type="button" className="et-primary" disabled={busy} onClick={() => void send(true)}>{busy ? SETTINGS_ENDING.finishing : SETTINGS_REWARD_COPY.retry}</button>}
          <button type="button" className={reward?.status === 'unavailable' && passed ? '' : 'et-primary'} onClick={() => onDone(nudge.targets)}>{nudge.button}</button>
          <button type="button" onClick={() => onDone()}>{SETTINGS_REWARD_COPY.close}</button>
        </div>
      </div>
    </div>;
  }

  if (phase === 'intro') return <div className="et-end">
    <div className="et-end__card" role="group" aria-labelledby="st-end-title">
      <p className="et-end__k">{SETTINGS_ENDING.eyebrow}</p>
      <h2 id="st-end-title" ref={heading} tabIndex={-1}>{SETTINGS_ENDING.quizTitle}</h2>
      <p>{SETTINGS_ENDING.quizBody}</p>
      <Strip done={done} />
      {error && <p className="et-end__err" role="alert">{error}</p>}
      <div className="et-end__actions">
        <button type="button" className="et-primary" onClick={() => setPhase('quiz')}>{SETTINGS_ENDING.take}</button>
        <button type="button" disabled={busy} onClick={() => void send(false)}>{busy ? SETTINGS_ENDING.finishing : SETTINGS_ENDING.skip}</button>
        <button type="button" onClick={onBack}><ChevronLeft size={16} aria-hidden="true" />{SETTINGS_ENDING.previous}</button>
      </div>
    </div>
  </div>;

  const question = SETTINGS_QUESTIONS[q];
  const review = result?.review.find(r => r.id === question.id);
  const last = q === SETTINGS_QUESTIONS.length - 1;
  return <div className="et-end">
    <div className="et-end__card st-quiz" role="group" aria-labelledby="st-end-title">
      <section className="orientation-quiz" aria-label={SETTINGS_ENDING.quizTitle}>
        <p className="orientation-kicker">{SETTINGS_ENDING.questionOf(q + 1, SETTINGS_QUESTIONS.length)}</p>
        <h3 id="st-end-title" ref={heading} tabIndex={-1}>{question.prompt}</h3>
        <form onSubmit={e => { e.preventDefault(); if (!last) setQ(n => n + 1); else void send(true); }}>
          <fieldset key={question.id} disabled={busy}>
            <legend className="et-sr">{question.prompt}</legend>
            {question.choices.map((choice, value) => <label key={value}>
              <input type="radio" required name={`settings-${question.id}`} value={value} checked={answers[question.id] === value}
                onChange={() => setAnswers(a => ({ ...a, [question.id]: value }))} /><span>{choice}</span>
            </label>)}
          </fieldset>
          {review && <p className="orientation-review" data-right={review.right}><b>{review.right ? SETTINGS_ENDING.right : SETTINGS_ENDING.notQuite}</b> {review.explanation}</p>}
          {result && !result.passed && <p className="orientation-review" role="status">{SETTINGS_ENDING.missed(result.correct, result.total)}</p>}
          {error && <p className="orientation-review" role="alert">{error}</p>}
          <div className="orientation-question-actions">
            <button type="button" className="orientation-back" disabled={busy || (q === 0 && !!quizOnly)} onClick={() => (q === 0 ? setPhase('intro') : setQ(n => n - 1))}>{SETTINGS_ENDING.back}</button>
            <button className="orientation-primary" type="submit" disabled={busy || answers[question.id] === undefined}>
              {busy ? SETTINGS_ENDING.checking : !last ? SETTINGS_ENDING.nextQuestion : result ? SETTINGS_ENDING.checkAgain : SETTINGS_ENDING.check}
            </button>
          </div>
        </form>
      </section>
    </div>
  </div>;
}

/** Re-exported for the controller's nudge landing. */
export { findNavElement };
