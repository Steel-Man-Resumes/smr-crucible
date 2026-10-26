"use client";
/**
 * The Settings tour v2 playable slice (SETTINGS-TOUR-V2-STORYBOARD.md section 9),
 * for judging the pace and the camera before the full rebuild: M1 the map on
 * the stage, C1 a zoom on the coach choices, X1 six chips swept down
 * Accessibility. About 30 s.
 *
 * The Settings page mounts SettingsTourGate in place of SettingsTour. Only
 * ?tour=settings&slice=1 plays the slice; anything else renders the v1 tour
 * component itself, untouched. The slice saves nothing: no store, no run, no
 * reward, and this file sends no request of any kind.
 *
 * It reuses the entrance engine's pieces (the stage camera, the cutout, the
 * card, the particles, the et-* styles, reading pace, the page lock) and adds
 * one thing: a page camera, a requestAnimationFrame tween that scrolls the
 * window and scales the page frame (#refinery-page-settings) together, driven
 * by the beat clock, so Pause freezes it mid-move. Wide screens only zoom, at
 * most 1.3; phones and motion-off never do. Every way out (Leave, Escape, the
 * ending, a route change, unmount) takes the transform off the page.
 *
 * Pause, Previous, Next, Leave and Stop motion are on the card. Space pauses,
 * arrows step, Escape leaves. Reduced motion (the system or the switch) never
 * auto-plays: Next steps through each chip, and the camera cuts.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { ChevronLeft, ChevronRight, Pause, Play, X } from 'lucide-react';
import { TroyLivingIcon } from '@crucible/consumer-ui';
import { useUserTier } from '@/lib/useUserTier';
import { useEffectiveRole } from '@/components/RoleProvider';
import { TOUR_COPY } from '@/lib/tour/beats';
import { ACT_CHANGE_MS, CAMERA_EASE, ORIENT_MS } from '@/lib/tour/timing';
import { captionPlacement, onStage, particlePath, spotlightRect, unionBox, type Box, type Camera } from '@/lib/tour/geometry';
import { PORTRAIT_MIN_SCALE } from '@/lib/tour/layout';
import { lockPageForTour } from '@/lib/tour/page-lock';
import { SETTINGS_PATH, settingsTourAllowed } from '@/lib/tour/settings-tour';
import {
  HOP_MS, MAP_SCENE, MAP_TILES, NARROW, P_MAP, SCROLL_MS, SLICE_BEATS, SLICE_COPY, TILE_PAN_MS, TILE_ZOOM, ZOOM_AT_MS, ZOOM_MS,
  beatMs, chipAt, chipStarts, focusScroll, followTimes, lerp, lerpBox, mapTileBox, mapWideScale, pageShot, portraitMapHeight, portraitMapRows,
  settingsSliceRequested, stageCamera, tween, type SliceBeat,
} from '@/lib/tour/settings-slice';
import { SettingsTour } from './SettingsTour';
import './entrance-tour.css';
import './settings-slice.css';

const FOCUSABLE = 'button:not(:disabled),a[href],input:not(:disabled),summary,[tabindex="0"]';
const MOTION_KEY = 'tour-motion-off:';
const FRAME_ID = 'refinery-page-settings';
const ENDING = SLICE_BEATS.length;

/** The page mounts this where it mounted SettingsTour. slice=1 plays the slice; everything else is the v1 tour, unchanged. */
export function SettingsTourGate() {
  const pathname = usePathname();
  const search = useSearchParams();
  return settingsSliceRequested(pathname, search) ? <SettingsSlice /> : <SettingsTour />;
}

function osReduced() {
  try { return matchMedia('(prefers-reduced-motion: reduce)').matches || document.documentElement.classList.contains('reduce-motion'); } catch { return false; }
}
function readQuiet(account: string) {
  try { return sessionStorage.getItem(MOTION_KEY + account) === '1'; } catch { return false; }
}
function pageFrame() {
  return document.getElementById(FRAME_ID);
}

/* ---------- Page camera: one place that writes scroll and scale, and one that takes them off ---------- */

type Cam = { scale: number; origin: { x: number; y: number } };
const camState: Cam = { scale: 1, origin: { x: 0, y: 0 } };

function setPageCamera(scroll: number, scale: number, origin: { x: number; y: number }) {
  const el = pageFrame();
  if (el) {
    if (Math.abs(scale - 1) < 0.0005) { el.style.transform = ''; el.style.transformOrigin = ''; }
    else { el.style.transformOrigin = `${origin.x}px ${origin.y}px`; el.style.transform = `scale(${scale})`; }
  }
  camState.scale = Math.abs(scale - 1) < 0.0005 ? 1 : scale; camState.origin = origin;
  if (Math.abs(window.scrollY - scroll) >= 0.5) window.scrollTo({ top: scroll, behavior: 'instant' as ScrollBehavior });
}
/** Leave, Escape, the ending, a route change and unmount all come here. Scroll stays where it is. */
export function resetPageCamera() {
  const el = pageFrame();
  if (el) { el.style.transform = ''; el.style.transformOrigin = ''; }
  camState.scale = 1; camState.origin = { x: 0, y: 0 };
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

/* ---------- Controller: no store, no run, no writes ---------- */

function SettingsSlice() {
  const tier = useUserTier();
  const role = useEffectiveRole();
  const allowed = settingsTourAllowed({ tier, orgRole: role?.orgRole, impersonating: role?.impersonating });
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(true);
  const [take, setTake] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => { setMounted(true); return () => resetPageCamera(); }, []);

  const close = useCallback(() => {
    resetPageCamera(); setOpen(false);
    router.replace(SETTINGS_PATH);
  }, [router]);

  /* While open: the shell is inert, the page does not scroll for the person, focus stays in the tour, Escape leaves. */
  useEffect(() => {
    if (!mounted || !open || !allowed) return;
    const html = document.documentElement;
    const oldFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const unlock = lockPageForTour(html, document.body, document.querySelector<HTMLElement>('.refinery-app'));
    html.dataset.settingsSlice = 'true';
    window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); close(); return; }
      if (event.key !== 'Tab') return;
      const items = Array.from(root.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []).filter(item => item.getClientRects().length && !item.closest('[hidden],[aria-hidden="true"]'));
      const first = items[0], last = items.at(-1);
      if (!first || !last) { event.preventDefault(); return; }
      if (event.shiftKey && (document.activeElement === first || !root.current?.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || !root.current?.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      resetPageCamera(); unlock(); delete html.dataset.settingsSlice;
      document.removeEventListener('keydown', onKey);
      if (oldFocus?.isConnected) oldFocus.focus({ preventScroll: true });
    };
  }, [mounted, open, allowed, close]);

  if (!mounted || !allowed || !open) return null;
  return createPortal(<div ref={root}>
    <SlicePlayer key={take} accountId={role?.accountId ?? ''} onLeave={close} onAgain={() => { resetPageCamera(); window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior }); setTake(n => n + 1); }} />
  </div>, document.body);
}

/* ---------- Player ---------- */

type Pill = { label: string; lit: boolean; x: number; y: number; side: 'right' | 'top' };

function SlicePlayer({ accountId, onLeave, onAgain }: { accountId: string; onLeave: () => void; onAgain: () => void }) {
  const [i, setI] = useState(0);
  /** Motion-off: the chip a sweep is on (Next steps through them). */
  const [step, setStep] = useState(0);
  const [systemReduced, setSystemReduced] = useState(osReduced);
  const [quiet, setQuiet] = useState(() => readQuiet(accountId));
  const reduced = systemReduced || quiet;
  const [playing, setPlaying] = useState(() => !(osReduced() || readQuiet(accountId)));
  const [hidden, setHidden] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [view, setView] = useState({ w: typeof window === 'undefined' ? 1280 : innerWidth, h: typeof window === 'undefined' ? 800 : innerHeight });
  const [stage, setStage] = useState({ w: 0, h: 0 });
  const [shrink, setShrink] = useState<Box | null>(null);
  const [cut, setCut] = useState<Box | null>(null);
  const [pills, setPills] = useState<Pill[]>([]);
  /** C1: the inner ring on the part of the target the words have reached. */
  const [ring, setRing] = useState<Box | null>(null);
  const [cardH, setCardH] = useState(() => (typeof window !== 'undefined' && innerWidth < NARROW ? 300 : 220));
  const [cardEl, setCardEl] = useState<HTMLDivElement | null>(null);
  const [particles, setParticles] = useState<{ key: number; d: string } | null>(null);
  const [announce, setAnnounce] = useState('');
  const stageRef = useRef<HTMLDivElement>(null);
  const markRef = useRef<HTMLSpanElement>(null);
  const playRef = useRef<HTMLButtonElement>(null);
  const clock = useRef(0);
  const sentParticles = useRef('');
  const endRef = useRef<HTMLHeadingElement>(null);

  const beat: SliceBeat | undefined = SLICE_BEATS[i];
  const ending = i >= ENDING;
  const portrait = view.w < NARROW;
  const hold = beat ? beatMs(beat, portrait) : 0;
  const onStageBeat = beat?.where === 'stage';
  const chips = beat?.chips ?? [];
  const sweep = beat?.kind === 'sweep';
  /** The moment the scene and camera are drawn at: the clock, or, with motion off, the chip Next stepped to. */
  const stepTime = (k: number) => (beat && sweep ? (onStageBeat ? (k === 0 ? ORIENT_MS : chipStarts(beat, portrait)[k]) : chipStarts(beat, portrait)[k]) + 1 : ORIENT_MS + ZOOM_AT_MS + ZOOM_MS);
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
  const go = useCallback((n: number, atStep = 0) => {
    setI(Math.max(0, Math.min(ENDING, n))); setStep(atStep);
    clock.current = 0; setElapsed(0); setShrink(null);
  }, []);
  const next = useCallback(() => {
    if (reduced && beat && sweep && step < chips.length - 1) { setStep(step + 1); return; }
    go(i + 1);
  }, [reduced, beat, sweep, step, chips.length, go, i]);
  const prev = useCallback(() => {
    if (reduced && beat && sweep && step > 0) { setStep(step - 1); return; }
    const back = SLICE_BEATS[i - 1];
    go(i - 1, reduced && back?.chips ? back.chips.length - 1 : 0);
  }, [reduced, beat, sweep, step, go, i]);

  const cardBox = captionPlacement(null, view.w, view.h, { w: 360, h: cardH });
  const advance = useCallback(() => {
    // Off the stage, the map shrinks into the card and the real page is underneath.
    if (onStageBeat && !reduced) setShrink(cardBox);
    else go(i + 1);
  }, [onStageBeat, reduced, cardBox, go, i]);
  useEffect(() => {
    if (!shrink) return;
    const timer = setTimeout(() => go(i + 1), ACT_CHANGE_MS);
    return () => clearTimeout(timer);
  }, [shrink, go, i]);

  /* Clock */
  const running = playing && !hidden && !ending && !shrink;
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

  /* The ending takes the zoom off at once. */
  useEffect(() => { if (ending) { resetPageCamera(); setCut(null); setPills([]); setRing(null); endRef.current?.focus({ preventScroll: true }); } }, [ending]);

  /* Screen reader: one announcement per beat, chips listed once. */
  useEffect(() => {
    if (ending) { setAnnounce(`${SLICE_COPY.endTitle}. ${SLICE_COPY.endBody}`); return; }
    if (!beat) return;
    const list = beat.chips && beat.where === 'page' ? ` ${SLICE_COPY.chipsSr(beat.chips.map(c => c.label))}` : '';
    setAnnounce(`${SLICE_COPY.stopOf(i + 1, ENDING)}. ${beat.title}. ${beat.body}${list}`);
  }, [i]); // eslint-disable-line react-hooks/exhaustive-deps

  /*
   * The page camera and the cutout, every frame, as a function of the beat clock.
   * Planned once per beat from untransformed layout; the from-state is wherever
   * the camera is when the beat starts, so stepping back and forth never jumps.
   */
  // The loop reads the clock itself (every frame), not the 50 ms render state.
  const timeRef = useRef({ stepped, at: t });
  timeRef.current = { stepped, at: t };
  const nowT = () => (timeRef.current.stepped ? timeRef.current.at : clock.current);
  useEffect(() => {
    if (!beat || ending) return;
    if (onStageBeat) {
      // Behind the stage: the real page waits at the top, unscaled.
      setPageCamera(0, 1, camState.origin); setCut(null); setPills([]); setRing(null);
      return;
    }
    let raf = 0;
    let alive = true;
    const instant = reduced;
    const card = cardEl?.getBoundingClientRect();
    const cardRect: Box = card && card.width ? { x: card.left, y: card.top, w: card.width, h: card.height } : cardBox;
    const from = { scroll: window.scrollY, scale: camState.scale, origin: { ...camState.origin } };
    const prevBeat = SLICE_BEATS[i - 1];
    const prevTargets = prevBeat?.where === 'page' ? (prevBeat.targets ?? prevBeat.chips?.at(-1)?.targets ?? []) : [];

    if (beat.kind === 'slow') {
      const plan = measureFlat(() => {
        const box = liveBox(findAll(beat.targets ?? []));
        const fr = pageFrame()?.getBoundingClientRect();
        return box && fr ? { target: { x: box.x, y: box.y + scrollY, w: box.w, h: box.h }, frame: { x: fr.left, y: fr.top + scrollY }, max: maxScroll() } : null;
      });
      if (!plan) { const skip = setTimeout(() => go(i + 1), 1200); return () => clearTimeout(skip); }
      const shot = pageShot({ target: plan.target, frame: plan.frame, view, card: cardRect, maxScale: portrait || reduced ? 1 : beat.zoom ?? 1, maxScroll: plan.max });
      const marks = followTimes(beat);
      const frame = () => {
        if (!alive) return;
        const now = nowT();
        const ps = instant ? 1 : tween(now, 0, SCROLL_MS);
        const pz = instant ? 1 : tween(now, ZOOM_AT_MS, ZOOM_MS);
        const scale = lerp(from.scale, shot.scale, pz);
        setPageCamera(lerp(from.scroll, shot.scrollTop, ps), scale, shot.scale !== 1 ? shot.origin : from.origin);
        const target = liveBox(findAll(beat.targets ?? []));
        const prevBox = prevTargets.length && !instant ? liveBox(findAll(prevTargets)) : null;
        const box = target && prevBox ? lerpBox(prevBox, target, ps) : target;
        const next = box && spotlightRect({ left: box.x, top: box.y, width: box.w, height: box.h }, innerWidth, innerHeight, 6);
        setCut(c => (same(c, next ?? null) ? c : next ?? null));
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
        }
        setRing(r => (same(r, ringBox) ? r : ringBox));
        raf = requestAnimationFrame(frame);
      };
      frame();
      return () => { alive = false; cancelAnimationFrame(raf); };
    }

    // A sweep on the page: the spotlight hops chip to chip and the page pans under it.
    const plan = measureFlat(() => ({
      rows: (beat.chips ?? []).map(c => { const b = liveBox(findAll(c.targets)); return b ? { ...b, y: b.y + scrollY } : null; }),
      max: maxScroll(),
    }));
    const present = plan.rows.map(r => !!r);
    if (!present.some(Boolean)) { const skip = setTimeout(() => go(i + 1), 1200); return () => clearTimeout(skip); }
    const xs = plan.rows.filter((r): r is Box => !!r);
    const colRight = Math.max(...xs.map(r => r.x + r.w));
    const colLeft = Math.min(...xs.map(r => r.x));
    const underCard = colRight > cardRect.x && colLeft < cardRect.x + cardRect.w;
    const bandBottom = underCard ? cardRect.y - 16 : view.h - 16;
    const scrolls = plan.rows.map(r => (r ? focusScroll(r.y, view, bandBottom, plan.max) : null));
    const starts = chipStarts(beat, portrait);
    // A missing chip keeps the camera where the last one put it.
    const scrollAt = (k: number): number => { for (let n = k; n >= 0; n--) if (scrolls[n] !== null) return scrolls[n]!; return from.scroll; };
    const frame = () => {
      if (!alive) return;
      const now = nowT();
      let k = chipAt(beat, portrait, now);
      while (k > 0 && !present[k]) k--;
      const p = instant ? 1 : k === 0 ? tween(now, 0, ORIENT_MS) : tween(now, starts[k], HOP_MS);
      if (k === 0) setPageCamera(lerp(from.scroll, scrollAt(0), p), lerp(from.scale, 1, p), from.origin);
      else setPageCamera(lerp(scrollAt(k - 1), scrollAt(k), p), 1, from.origin);
      const lit = liveBox(findAll(beat.chips![k].targets));
      let before: Box | null = null;
      if (!instant) {
        if (k > 0) { let n = k - 1; while (n > 0 && !present[n]) n--; before = present[n] ? liveBox(findAll(beat.chips![n].targets)) : null; }
        else if (prevTargets.length) before = liveBox(findAll(prevTargets));
      }
      const box = lit && before && p < 1 ? lerpBox(before, lit, p) : lit;
      const next = box && spotlightRect({ left: box.x, top: box.y, width: box.w, height: box.h }, innerWidth, innerHeight, 6);
      setCut(c => (same(c, next ?? null) ? c : next ?? null));
      setRing(r => (r ? null : r));
      // The chip labels: the lit one bright, the ones already shown stay as dim labels on their rows.
      const shown: Pill[] = [];
      beat.chips!.forEach((chip, n) => {
        // The lit label shows once the spotlight has landed on its row, never while it travels.
        if (n > k || !present[n] || (n === k && p < 0.85)) return;
        const r = n === k && next ? next : (() => { const b = liveBox(findAll(chip.targets)); return b && spotlightRect({ left: b.x, top: b.y, width: b.w, height: b.h }, innerWidth, innerHeight + 4000, 6); })();
        if (!r || r.y + r.h / 2 < 72 || r.y > innerHeight) return;
        const right = !portrait && r.x + r.w + 200 < innerWidth;
        shown.push({ label: chip.label, lit: n === k, side: right ? 'right' : 'top', x: right ? r.x + r.w + 14 : r.x + r.w - 10, y: right ? r.y + r.h / 2 : r.y });
      });
      setPills(old => (old.length === shown.length && old.every((o, n) => o.lit === shown[n].lit && Math.abs(o.x - shown[n].x) < 0.5 && Math.abs(o.y - shown[n].y) < 0.5) ? old : shown));
      raf = requestAnimationFrame(frame);
    };
    frame();
    return () => { alive = false; cancelAnimationFrame(raf); };
  }, [i, reduced, portrait, view.w, view.h, cardEl]); // eslint-disable-line react-hooks/exhaustive-deps

  /* t.ROY's particles, once per beat, when the camera lands on its first target. */
  const landAt = !beat ? 0 : beat.where === 'stage' ? ORIENT_MS : beat.kind === 'slow' ? ZOOM_AT_MS + ZOOM_MS : ORIENT_MS;
  const landed = !!beat && !reduced && t >= landAt;
  useEffect(() => {
    if (!landed || !beat || sentParticles.current === beat.id) return;
    sentParticles.current = beat.id;
    const mark = markRef.current?.getBoundingClientRect();
    if (!mark) return;
    let to: { x: number; y: number } | null = null;
    if (beat.where === 'stage') {
      const st = stageRef.current?.getBoundingClientRect();
      if (st && !portrait) { const b = onStage(mapTileBox(0), stageCam(0)); to = { x: st.left + b.x + b.w / 2, y: st.top + b.y + 40 }; }
      else if (st) { to = { x: st.left + 60, y: st.top + 30 }; }
    } else if (cut) to = { x: cut.x + Math.min(cut.w / 2, 60), y: cut.y + Math.min(cut.h / 2, 30) };
    if (!to) return;
    setParticles({ key: Date.now(), d: particlePath({ x: mark.left + mark.width / 2, y: mark.top + mark.height / 2 }, to) });
    const clear = setTimeout(() => setParticles(null), 1600);
    return () => clearTimeout(clear);
  }, [landed, beat?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  /* The card mounts once, when the first page beat starts, and stays. Measure it before paint and hand it focus. */
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

  /* Stage camera (M1): wide on all eight, then a pan across row one and down row two, 1.6 times the wide shot. */
  const reserve = portrait ? 0 : Math.min(200, stage.h * 0.26);
  const tile = onStageBeat ? (t < ORIENT_MS ? -1 : chipAt(beat!, portrait, t)) : -1;
  const pMapH = portraitMapHeight();
  function stageCam(k: number): Camera {
    if (portrait) {
      const s = Math.max(PORTRAIT_MIN_SCALE, Math.min(stage.w / P_MAP.w, stage.h / pMapH, 1.15));
      return stageCamera(stage, { w: P_MAP.w, h: pMapH }, s, null, 0);
    }
    const wide = mapWideScale(stage, reserve);
    if (k < 0) return stageCamera(stage, MAP_SCENE, wide, null, reserve);
    const b = mapTileBox(k);
    return stageCamera(stage, MAP_SCENE, wide * TILE_ZOOM, { x: b.x + b.w / 2, y: b.y + b.h / 2 }, reserve);
  }
  const cam = stage.w ? stageCam(tile) : { s: 1, tx: 0, ty: 0 };

  const progress = hold ? Math.min(1, (stepped ? (sweep ? (step + 1) / Math.max(1, chips.length) : 1) * hold : elapsed) / hold) : 0;
  const segs = <div className="et-segs" role="presentation" style={{ flex: '1 1 auto' }}>
    {SLICE_BEATS.map((b, n) => <span key={b.id} className="et-seg"><span><i style={{ width: n < i ? '100%' : n > i ? '0%' : `${progress * 100}%` }} /></span></span>)}
  </div>;
  const buttons = (compact: boolean) => <div className="et-bar__row">
    <button type="button" onClick={prev} disabled={i === 0 && (!reduced || step === 0)} aria-label={TOUR_COPY.previous}><ChevronLeft size={18} aria-hidden="true" /></button>
    <button ref={playRef} type="button" className="et-primary" onClick={toggle} aria-label={playing ? TOUR_COPY.pause : TOUR_COPY.play}>
      {playing ? <Pause size={16} aria-hidden="true" /> : <Play size={16} aria-hidden="true" />}{!compact && <span aria-hidden="true">{playing ? TOUR_COPY.pause : TOUR_COPY.play}</span>}
    </button>
    <button type="button" onClick={next} aria-label={TOUR_COPY.next}><ChevronRight size={18} aria-hidden="true" /></button>
    {!compact && !portrait ? segs : <span className="et-bar__grow" />}
    {!compact && !portrait && motionButton()}
    <button type="button" onClick={onLeave} aria-label={`${TOUR_COPY.leave}. Escape`}><X size={16} aria-hidden="true" />{!compact && !portrait && <span aria-hidden="true">{TOUR_COPY.leave}</span>}</button>
  </div>;
  function motionButton() {
    return <button type="button" className="et-motion" onClick={toggleMotion} disabled={systemReduced} aria-label={reduced ? TOUR_COPY.motionToggleOn : TOUR_COPY.motionToggleOff}>
      {reduced ? TOUR_COPY.motionToggleOn : TOUR_COPY.motionToggleOff}
    </button>;
  }

  const kicker = `${SLICE_COPY.stopOf(i + 1, ENDING)} · ${SLICE_COPY.guide}`;
  const caption = beat && onStageBeat && <div className={`et-cap${portrait ? ' et-cap--narrow' : ''}`}>
    <span ref={markRef} className="et-cap__mark"><TroyLivingIcon size={portrait ? 36 : 46} attention={!!particles} /></span>
    <div>
      <p className="et-cap__k">{kicker}</p>
      <p className="et-cap__t">{beat.title}</p>
      <p className="et-cap__b">{beat.body}</p>
    </div>
  </div>;

  const shrinkStyle: CSSProperties | undefined = shrink ? { transform: `translate(${shrink.x}px, ${shrink.y}px) scale(${shrink.w / view.w}, ${shrink.h / view.h})` } : undefined;
  const bottomAnchored = cardBox.y + cardBox.h >= view.h - 17;
  const cardStyle: CSSProperties = bottomAnchored
    ? { left: cardBox.x, bottom: view.h - cardBox.y - cardBox.h, width: cardBox.w, maxHeight: view.h - 32, overflowY: 'auto' }
    : { left: cardBox.x, top: cardBox.y, width: cardBox.w, maxHeight: view.h - 32, overflowY: 'auto' };

  return <div className="et-root ss-root" role="dialog" aria-modal="true" aria-label={SLICE_COPY.dialogLabel} aria-describedby="ss-keys" data-playing={running} data-act={ending ? 'end' : onStageBeat ? 'stage' : 'room'} data-beat={beat?.id ?? 'ending'} data-chip={sweep ? (onStageBeat ? tile : chipAt(beat!, portrait, t)) : undefined}>
    <p id="ss-keys" className="et-sr">{TOUR_COPY.keys}</p>
    <p className="et-sr" aria-live="polite">{announce}</p>

    {shrink && <div className="et-dim ss-dim-in" aria-hidden="true" />}
    {beat && onStageBeat && <div className="et-wrap" data-shrink={!!shrink} style={shrinkStyle}>
      <div ref={stageRef} className="et-stage" aria-hidden="true" onClick={e => { if (e.isTrusted) toggle(); }}>
        {stage.w > 0 && <div className="et-cam" style={{ width: portrait ? P_MAP.w : MAP_SCENE.w, height: portrait ? pMapH : MAP_SCENE.h, transform: `translate3d(${cam.tx}px, ${cam.ty}px, 0) scale(${cam.s})`, transition: reduced ? 'none' : `transform ${tile <= 0 ? 1100 : TILE_PAN_MS}ms ${CAMERA_EASE}` }}>
          {portrait ? <PortraitMap open={tile} /> : <MapScene active={tile} />}
        </div>}
        {!portrait && caption}
        {!playing && !reduced && <div aria-hidden="true" className="ss-paused"><span><Play size={34} aria-hidden="true" /></span></div>}
      </div>
      {portrait && <div style={{ padding: '10px 0 0', background: '#0b0a09' }}>{caption}</div>}
      <div className="et-bar">
        {buttons(false)}
        {portrait && <div className="et-bar__row">{segs}{motionButton()}</div>}
        {reduced && <p className="et-note">{TOUR_COPY.motionOff}</p>}
      </div>
    </div>}

    {beat && !onStageBeat && <>
      <div className="et-dim" style={{ background: cut ? 'transparent' : undefined }} aria-hidden="true" />
      {cut && <div className="et-cutout ss-cutout" aria-hidden="true" style={{ left: cut.x, top: cut.y, width: cut.w, height: cut.h }} />}
      {ring && <div className="ss-ring" aria-hidden="true" style={{ left: ring.x, top: ring.y, width: ring.w, height: ring.h }} />}
      {pills.map(p => <span key={p.label} className="ss-chip" data-lit={p.lit} data-side={p.side} aria-hidden="true" style={{ left: p.x, top: p.y }}>{p.label}</span>)}
      <div ref={setCardEl} key="slice-card" className="et-card" data-still={reduced} style={cardStyle}>
        <div className="et-card__head">
          <span ref={markRef}><TroyLivingIcon size={40} attention={!!particles} /></span>
          <p className="et-cap__k">{kicker}</p>
        </div>
        <div key={`stop-${i}`} className="et-card__text" style={{ animation: reduced ? 'none' : 'etCap 420ms cubic-bezier(.16,1,.3,1) both' }}>
          <p className="et-cap__t">{beat.title}</p>
          <p className="et-cap__b">{beat.body}</p>
        </div>
        {!portrait && <div className="et-bar__row">{segs}</div>}
        {portrait && <div className="et-mini" aria-hidden="true"><i style={{ width: `${progress * 100}%` }} /></div>}
        {buttons(true)}
        <div className="et-bar__row">
          {motionButton()}
          {reduced && <p className="et-note">{TOUR_COPY.motionOff}</p>}
        </div>
      </div>
    </>}

    {ending && <div className="et-end">
      <div className="et-end__card" role="group" aria-labelledby="ss-end-title">
        <p className="et-end__k">{SLICE_COPY.endEyebrow}</p>
        <h2 id="ss-end-title" tabIndex={-1} ref={endRef}>{SLICE_COPY.endTitle}</h2>
        <p>{SLICE_COPY.endBody}</p>
        <div className="et-end__actions">
          <button type="button" className="et-primary" onClick={onAgain}>{SLICE_COPY.again}</button>
          <button type="button" onClick={onLeave}>{SLICE_COPY.close}</button>
        </div>
      </div>
    </div>}

    {particles && !reduced && <svg key={particles.key} className="et-particles" aria-hidden="true">
      <path d={particles.d} fill="none" stroke="#bc9aff" strokeWidth="1.2" opacity=".35" />
      {Array.from({ length: 10 }, (_, n) => <circle key={n} r={n % 3 ? 2.2 : 4} fill={n % 3 ? '#d5b8fa' : '#e8c46a'} style={{ offsetPath: `path('${particles.d}')`, animationDelay: `${n * 34}ms` } as CSSProperties} />)}
    </svg>}
  </div>;
}

/* ---------- Stage scenes: a drawn map of the real sections and their real control names, not a screenshot ---------- */

function MapScene({ active }: { active: number }) {
  return <div className="sc" style={{ width: MAP_SCENE.w, height: MAP_SCENE.h }}>
    <div className="sc-grid" />
    <p className="ss-map__k" style={{ left: 70, top: 34 }}>{SLICE_COPY.mapKicker}</p>
    {MAP_TILES.map((tile, k) => {
      const b = mapTileBox(k);
      return <div key={tile.id} className="ss-tile" data-active={k === active} data-lit={active >= 0 && k <= active} style={{ left: b.x, top: b.y, width: b.w, height: b.h }}>
        <div className="ss-tile__head"><span className="sc-num">{k + 1}</span><p className="ss-tile__label">{tile.label}</p></div>
        <ul className="ss-tile__list">{tile.controls.map(c => <li key={c}>{c}</li>)}</ul>
      </div>;
    })}
  </div>;
}

function PortraitMap({ open }: { open: number }) {
  const rows = portraitMapRows(open);
  return <div className="sc ps" style={{ width: P_MAP.w, height: portraitMapHeight() }}>
    {MAP_TILES.map((tile, k) => <div key={tile.id} className="ss-prow" data-active={k === open} data-lit={open >= 0 && k <= open} style={{ top: rows[k].y, height: rows[k].h, width: P_MAP.w }}>
      <div className="ss-prow__head"><span className="ps-num">{k + 1}</span><span className="ps-row__label">{tile.label}</span></div>
      <ul className="ss-prow__list" aria-hidden={k !== open}>{tile.controls.map(c => <li key={c}>{c}</li>)}</ul>
    </div>)}
  </div>;
}
