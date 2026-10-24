"use client";
/**
 * The Refinery entrance tour, in two acts, auto-playing at reading pace.
 *
 * Act one plays on its own fixed stage: a camera frames a spotlight box in a
 * composed scene (the /walkthrough model: 1100ms ease, zoom capped, gold
 * spotlight, lower-third caption). Phones get scenes composed for a tall
 * screen (TourPortrait.tsx), never the landscape canvas shrunk. Act two shrinks
 * the stage into a corner caption and points at the real navigation through a
 * fixed cutout. The page is never transformed or zoomed and no real control is
 * clicked. Act two's stops are resolved once, when it starts, from what this
 * build's navigation actually has.
 *
 * Pause, step, chapter jump and a motion switch are always available. Reduced
 * motion turns the camera into cuts, removes particles and the cursor glide,
 * and waits for Next.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { ChevronLeft, ChevronRight, Pause, Play, X } from 'lucide-react';
import { TroyLivingIcon } from '@crucible/consumer-ui';
import { CompletionConfetti } from '@/components/CompletionConfetti';
import { OrientationQuiz, type OrientationDraft } from './OrientationQuiz';
import { BoardScene, ChartScene, LockScene, MeterScene, TitleScene, ASK_POINT, CLICK_AT } from './TourScenes';
import { PortraitBoard, PortraitChart, PortraitLock, PortraitMeter, PortraitTitle } from './TourPortrait';
import { BOARD_STATIONS, TOUR_BEATS, TOUR_CHAPTERS, TOUR_COPY, TOUR_ENDING, TOUR_REWARD_COPY, type RoomBeat, type StageBeat } from '@/lib/tour/beats';
import { ACT_CHANGE_MS, CAMERA_EASE, CAMERA_MS, holdMs } from '@/lib/tour/timing';
import { P_CHART_FIRST, PORTRAIT_MIN_SCALE, SCENE_SIZE, portraitSceneSize, portraitSpot, spotBox } from '@/lib/tour/layout';
import { captionPlacement, frameCamera, onStage, particlePath, spotlightRect, unionBox, type Box, type Camera } from '@/lib/tour/geometry';
import { gapStart, serviceRows } from '@/lib/tour/services';
import { rewardCelebrates, rewardMessage, type TourReward } from '@/lib/tour/reward';
import './entrance-tour.css';

export const ENDING_INDEX = TOUR_BEATS.length;
const FIRST_ROOM = TOUR_BEATS.findIndex(b => b.kind === 'room');
const NAV_BREAK = 768;
const NARROW = 640;
/** Act two: how long to wait for the menu (and the phone drawer) before deciding what is there. */
const RESOLVE_MS = 1500;
/** A stop whose element vanishes for this long is skipped. */
const LOST_MS = 1200;
const DEV = process.env.NODE_ENV !== 'production';
const ROWS = serviceRows();
const GAP = gapStart(ROWS);
const CHAPTER_START = TOUR_CHAPTERS.map(c => TOUR_BEATS.findIndex(b => b.chapter === c.id));
const MOTION_KEY = 'tour-motion-off:';

export interface TourPlayerProps {
  start: number;
  accountId: string;
  forgeComplete?: boolean;
  rewardClaimedAt?: string | null;
  nextStep?: { action: string; href: string };
  quizDraft: OrientationDraft;
  onQuizDraft: (d: OrientationDraft) => void;
  onBeat: (index: number) => void;
  onLeave: () => void;
  /** Saves completion; resolves with the server's reward or throws a message. */
  onFinish: () => Promise<TourReward>;
  onDone: (destination?: string) => void;
  onNavigationReveal?: (open: boolean) => void;
  saveError?: string;
  onRetrySave?: () => void;
}

function osReduced() {
  try { return matchMedia('(prefers-reduced-motion: reduce)').matches || document.documentElement.classList.contains('reduce-motion'); } catch { return false; }
}
function readQuiet(account: string) {
  try { return sessionStorage.getItem(MOTION_KEY + account) === '1'; } catch { return false; }
}

/** The visible element for one of these ids, never one inside a closed drawer or hidden copy. */
export function findNavElement(ids: readonly string[]): HTMLElement | null {
  for (const id of ids) {
    const found = Array.from(document.querySelectorAll<HTMLElement>(`[id="${id}"], [data-tour="${id}"]`))
      .find(el => el.getClientRects().length > 0 && !el.closest('[aria-hidden="true"], [hidden]') && el.getBoundingClientRect().width > 0);
    if (found) return found;
  }
  return null;
}
function findStop(beat: RoomBeat): HTMLElement[] {
  return beat.targets.map(findNavElement).filter((el): el is HTMLElement => !!el);
}

/** The words a stage beat shows: the plain variant when the person has not finished the Forge. */
function stageCopy(beat: StageBeat, forgeComplete?: boolean) {
  return beat.noForge && forgeComplete === false ? beat.noForge : beat;
}

export function TourPlayer(props: TourPlayerProps) {
  const { start, onBeat, onLeave, onNavigationReveal, accountId, forgeComplete } = props;
  const [i, setI] = useState(() => Math.max(0, Math.min(ENDING_INDEX, start)));
  const [systemReduced, setSystemReduced] = useState(osReduced);
  const [quiet, setQuiet] = useState(() => readQuiet(accountId));
  const reduced = systemReduced || quiet;
  const [playing, setPlaying] = useState(() => !(osReduced() || readQuiet(accountId)));
  const [hidden, setHidden] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [view, setView] = useState({ w: typeof window === 'undefined' ? 1280 : innerWidth, h: typeof window === 'undefined' ? 800 : innerHeight });
  const [stage, setStage] = useState({ w: 0, h: 0 });
  const [cam, setCam] = useState<Camera & { ms: number }>({ s: 1, tx: 0, ty: 0, ms: 0 });
  const [shrink, setShrink] = useState<Box | null>(null);
  /** Which act-two beats this build can show, decided once when act two starts. */
  const [roomOk, setRoomOk] = useState<Record<number, boolean> | null>(null);
  const [cut, setCut] = useState<Box | null>(null);
  const [cardH, setCardH] = useState(() => (typeof window !== 'undefined' && innerWidth < NARROW ? 320 : 230));
  const [particles, setParticles] = useState<{ key: number; d: string } | null>(null);
  const [announce, setAnnounce] = useState('');
  const stageRef = useRef<HTMLDivElement>(null);
  const markRef = useRef<HTMLSpanElement>(null);
  const [cardEl, setCardEl] = useState<HTMLDivElement | null>(null);
  const playRef = useRef<HTMLButtonElement>(null);
  const prevScene = useRef('');
  const dir = useRef(1);
  const clock = useRef(0);

  const beat = TOUR_BEATS[i];
  const ending = i >= ENDING_INDEX;
  const stageBeat = beat?.kind === 'stage' ? beat as StageBeat : null;
  const roomBeat = beat?.kind === 'room' ? beat as RoomBeat : null;
  const copy = stageBeat ? stageCopy(stageBeat, forgeComplete) : beat;
  const hold = beat ? holdMs({ title: copy.title, body: copy.body, extra: stageBeat?.extra }) : 0;
  const portrait = view.w < NARROW;
  const mobileNav = view.w < NAV_BREAK;
  const still = reduced;
  const roomList = useMemo(() => roomOk ? TOUR_BEATS.map((_, n) => n).filter(n => roomOk[n]) : [], [roomOk]);
  const ready = !roomBeat || (!!roomOk && !!cut);

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
  }, [stageBeat ? 'stage' : 'other']); // eslint-disable-line react-hooks/exhaustive-deps

  /* Navigation between beats. Act-two stops this build cannot show are passed over. */
  const go = useCallback((n: number) => {
    setI(cur => {
      const d = n >= cur ? 1 : -1;
      dir.current = d;
      let next = Math.max(0, Math.min(ENDING_INDEX, n));
      while (roomOk && next < ENDING_INDEX && next >= FIRST_ROOM && !roomOk[next]) next += d;
      return Math.max(0, Math.min(ENDING_INDEX, next));
    });
    clock.current = 0; setElapsed(0); setShrink(null);
  }, [roomOk]);

  useEffect(() => { onBeat(i); }, [i, onBeat]);

  const advance = useCallback(() => {
    // Between the acts the stage shrinks into the corner caption, then the room opens.
    if (i === FIRST_ROOM - 1 && !reduced) setShrink(captionPlacement(null, view.w, view.h, { w: 360, h: cardH }));
    else go(i + 1);
  }, [i, reduced, view.w, view.h, cardH, go]);
  useEffect(() => {
    if (!shrink) return;
    const timer = setTimeout(() => go(FIRST_ROOM), ACT_CHANGE_MS);
    return () => clearTimeout(timer);
  }, [shrink, go]);

  /* Clock: runs while playing, visible, ready, and not between acts. */
  const running = playing && !hidden && ready && !ending && !shrink;
  useEffect(() => {
    if (!running) return;
    let raf = 0;
    let prev = performance.now();
    const tick = (now: number) => {
      clock.current += now - prev; prev = now;
      setElapsed(e => (clock.current - e >= 50 ? clock.current : e));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [running]);
  useEffect(() => { if (running && elapsed >= hold) advance(); }, [elapsed, hold, running, advance]);

  /* Screen reader: one announcement per beat. */
  const roomPos = roomBeat ? roomList.indexOf(i) + 1 : 0;
  const stationIndex = stageBeat?.station ? BOARD_STATIONS.findIndex(s => s.id === stageBeat.station) + 1 : 0;
  useEffect(() => {
    if (ending) { setAnnounce(`${TOUR_ENDING.title} ${TOUR_ENDING.quizLine}`); return; }
    if (roomBeat && !roomOk) return;
    const where = roomBeat ? TOUR_COPY.roomOf(roomPos, roomList.length) : TOUR_COPY.stepOf(i + 1, FIRST_ROOM);
    const head = stageBeat?.station ? `${TOUR_COPY.moveOf(stationIndex, BOARD_STATIONS.length)}, ${BOARD_STATIONS[stationIndex - 1].label}.` : /[.!?]$/.test(copy.title) ? copy.title : `${copy.title}.`;
    setAnnounce(`${where}. ${head} ${copy.body}${stageBeat ? ` ${'sr' in copy ? copy.sr : ''}` : ''}`);
  }, [i, roomOk]); // eslint-disable-line react-hooks/exhaustive-deps

  /* Act one camera. Phones use portrait scenes and a scale floor that keeps text at 13 px or more. */
  const panAt = Math.round(hold * 0.42);
  const spotName = stageBeat && portrait && stageBeat.chart === 'rows' && elapsed >= panAt && GAP > P_CHART_FIRST ? 'chart-rest' : stageBeat?.spot;
  const spot = useMemo(() => {
    if (!stageBeat) return null;
    const chart = { rows: ROWS.length, gapStart: GAP };
    return portrait ? portraitSpot(stageBeat.scene, spotName, chart) : spotBox(stageBeat.scene, spotName, chart);
  }, [stageBeat, spotName, portrait]);
  const sceneSize = !stageBeat ? SCENE_SIZE.title : portrait ? portraitSceneSize(stageBeat.scene, ROWS.length) : SCENE_SIZE[stageBeat.scene];
  const reserve = portrait || !stageBeat || stageBeat.scene === 'title' ? 0 : Math.min(230, stage.h * 0.3);
  const minScale = portrait ? PORTRAIT_MIN_SCALE : 0;
  useLayoutEffect(() => {
    if (!stageBeat || !stage.w) return;
    const key = `${stageBeat.scene}:${portrait}`;
    const changed = prevScene.current !== key;
    prevScene.current = key;
    const next = frameCamera(stage, sceneSize, spot, reserve, minScale);
    setCam({ ...next, ms: reduced || changed ? 0 : CAMERA_MS });
  }, [i, stage.w, stage.h, reserve, spotName, portrait]); // eslint-disable-line react-hooks/exhaustive-deps

  /* t.ROY's particles: from the caption mark to whatever the beat is about. */
  useEffect(() => {
    setParticles(null);
    if (reduced || ending || !stageBeat || !spot || stageBeat.scene === 'title') return;
    const t = setTimeout(() => {
      const mark = markRef.current?.getBoundingClientRect();
      const st = stageRef.current?.getBoundingClientRect();
      if (!mark || !st) return;
      const to = onStage(spot, frameCamera(stage, sceneSize, spot, reserve, minScale));
      setParticles({ key: Date.now(), d: particlePath({ x: mark.left + mark.width / 2, y: mark.top + mark.height / 2 }, { x: st.left + to.x + to.w / 2, y: st.top + to.y + Math.min(to.h / 2, 60) }) });
    }, 420);
    const clear = setTimeout(() => setParticles(null), 1500);
    return () => { clearTimeout(t); clearTimeout(clear); };
  }, [i]); // eslint-disable-line react-hooks/exhaustive-deps

  /* Act two, once: open the menu, wait for it, and decide which stops exist. */
  useEffect(() => {
    if (!roomBeat || roomOk) return;
    onNavigationReveal?.(mobileNav);
    let raf = 0;
    let alive = true;
    const began = performance.now();
    let lastCount = -1;
    let stable = 0;
    const poll = () => {
      if (!alive) return;
      const counts = TOUR_BEATS.map(b => b.kind === 'room' ? findStop(b).length : 0);
      const total = counts.reduce((a, b) => a + b, 0);
      stable = total > 0 && total === lastCount ? stable + 1 : 0;
      lastCount = total;
      // A few steady frames after the drawer opens, or the deadline.
      if (stable >= 6 || performance.now() - began > RESOLVE_MS) {
        const ok: Record<number, boolean> = {};
        TOUR_BEATS.forEach((b, n) => { if (b.kind === 'room') ok[n] = counts[n] >= b.minFound; });
        if (DEV) TOUR_BEATS.forEach((b, n) => { if (b.kind === 'room' && !ok[n]) console.warn(`[tour] left out ${b.id}: ${b.targets.map(t => t[0]).join(', ')} not on this build`); });
        setRoomOk(ok);
        const first = TOUR_BEATS.findIndex((b, n) => n >= i && ok[n]);
        const firstBack = dir.current < 0 ? [...TOUR_BEATS.keys()].reverse().find(n => n <= i && ok[n]) : undefined;
        const target = dir.current < 0 ? firstBack ?? FIRST_ROOM - 1 : first < 0 ? ENDING_INDEX : first;
        if (target !== i) { setI(target); clock.current = 0; setElapsed(0); }
        return;
      }
      raf = requestAnimationFrame(poll);
    };
    poll();
    return () => { alive = false; cancelAnimationFrame(raf); };
  }, [roomBeat ? 'room' : 'other', roomOk]); // eslint-disable-line react-hooks/exhaustive-deps

  /* Act two, each stop: keep the cutout on the real element(s). */
  useEffect(() => {
    if (!roomBeat || !roomOk || !roomOk[i]) { setCut(null); return; }
    onNavigationReveal?.(mobileNav);
    // The previous cutout stays until this stop is measured, so the card never unmounts between stops.
    let raf = 0;
    let alive = true;
    let lostSince = 0;
    let first = true;
    const measure = () => {
      if (!alive) return;
      const els = findStop(roomBeat);
      if (!els.length) {
        lostSince ||= performance.now();
        if (performance.now() - lostSince > LOST_MS) { if (DEV) console.warn(`[tour] ${roomBeat.id} went away`); go(i + dir.current); return; }
        raf = requestAnimationFrame(measure); return;
      }
      lostSince = 0;
      if (first) {
        first = false;
        const r = els[0].getBoundingClientRect();
        if (r.top < 60 || r.bottom > innerHeight - 20) els[0].scrollIntoView({ block: 'nearest', behavior: 'auto' });
      }
      const box = unionBox(els.map(el => { const r = el.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; }));
      const next = box && spotlightRect({ left: box.x, top: box.y, width: box.w, height: box.h }, innerWidth, innerHeight, 6);
      setCut(prev => !next ? prev : prev && Math.abs(prev.x - next.x) < 0.5 && Math.abs(prev.y - next.y) < 0.5 && Math.abs(prev.w - next.w) < 0.5 && Math.abs(prev.h - next.h) < 0.5 ? prev : next);
      raf = requestAnimationFrame(measure);
    };
    measure();
    return () => { alive = false; cancelAnimationFrame(raf); };
  }, [i, roomOk]); // eslint-disable-line react-hooks/exhaustive-deps

  /* Particles toward each act-two stop once it is lit. */
  const cutKey = cut ? `${i}` : '';
  useEffect(() => {
    if (!cut || reduced) return;
    const t = requestAnimationFrame(() => {
      const mark = markRef.current?.getBoundingClientRect();
      if (mark) setParticles({ key: Date.now(), d: particlePath({ x: mark.left + mark.width / 2, y: mark.top + mark.height / 2 }, { x: cut.x + Math.min(cut.w / 2, 60), y: cut.y + Math.min(cut.h / 2, 30) }) });
    });
    const clear = setTimeout(() => setParticles(null), 1600);
    return () => { cancelAnimationFrame(t); clearTimeout(clear); };
  }, [cutKey]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (!roomBeat) onNavigationReveal?.(false); }, [roomBeat ? 'room' : 'other']); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => onNavigationReveal?.(false), []); // eslint-disable-line react-hooks/exhaustive-deps
  // The act-two card mounts once (when the first stop is lit) and stays. Measure it
  // before paint so its placement uses its real height, and hand it focus: the
  // stage's Pause went away with act one.
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
  const toggle = useCallback(() => { if (!ending) setPlaying(p => !p); }, [ending]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (ending || e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
      const el = e.target as HTMLElement | null;
      const native = !!el?.closest('button, a, input, textarea, select, label, summary');
      if ((e.key === ' ' && !native) || e.key === 'k') { e.preventDefault(); toggle(); }
      else if (e.key === 'ArrowRight' && !el?.closest('input, select')) { e.preventDefault(); go(i + 1); }
      else if (e.key === 'ArrowLeft' && !el?.closest('input, select')) { e.preventDefault(); go(i - 1); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [ending, toggle, go, i]);

  const chapterIndex = ending ? TOUR_CHAPTERS.length : TOUR_CHAPTERS.findIndex(c => c.id === beat.chapter);
  const progress = hold ? Math.min(1, elapsed / hold) : 0;
  const t = elapsed;

  const motionButton = <button type="button" className="et-motion" onClick={toggleMotion} disabled={systemReduced} aria-label={reduced ? TOUR_COPY.motionToggleOn : TOUR_COPY.motionToggleOff}>
    {reduced ? TOUR_COPY.motionToggleOn : TOUR_COPY.motionToggleOff}
  </button>;

  const controls = (compact: boolean) => <div className={compact ? 'et-bar__row' : 'et-bar'} data-compact={compact}>
    <div className="et-bar__row">
      <button type="button" onClick={() => go(i - 1)} disabled={i === 0} aria-label={TOUR_COPY.previous}><ChevronLeft size={18} aria-hidden="true" /></button>
      <button ref={playRef} type="button" className="et-primary" onClick={toggle} aria-label={playing ? TOUR_COPY.pause : TOUR_COPY.play}>
        {playing ? <Pause size={16} aria-hidden="true" /> : <Play size={16} aria-hidden="true" />}{!compact && <span aria-hidden="true">{playing ? TOUR_COPY.pause : TOUR_COPY.play}</span>}
      </button>
      <button type="button" onClick={() => go(i + 1)} aria-label={TOUR_COPY.next}><ChevronRight size={18} aria-hidden="true" /></button>
      {!compact && portrait && <span className="et-bar__grow" />}
      {!compact && !portrait && <div className="et-bar__grow et-segs" role="presentation">
        {TOUR_BEATS.map((b, n) => (b.kind === 'room' && roomOk && !roomOk[n]) ? null : <button key={b.id} type="button" className="et-seg" tabIndex={-1} aria-hidden="true" data-gap={n > 0 && TOUR_BEATS[n - 1].chapter !== b.chapter} onClick={() => go(n)}>
          <span><i style={{ width: n < i ? '100%' : n > i ? '0%' : `${progress * 100}%` }} /></span>
        </button>)}
      </div>}
      {compact && <span className="et-bar__grow" />}
      {!compact && !portrait && motionButton}
      <button type="button" onClick={onLeave} aria-label={`${TOUR_COPY.leave}. Escape`}><X size={16} aria-hidden="true" />{!compact && !portrait && <span aria-hidden="true">{TOUR_COPY.leave}</span>}</button>
    </div>
    {!compact && (portrait
      ? <div className="et-bar__row">
          <select className="et-chapsel" aria-label={TOUR_COPY.chapter} value={chapterIndex} onChange={e => { const n = Number(e.target.value); go(n >= TOUR_CHAPTERS.length ? ENDING_INDEX : CHAPTER_START[n]); }}>
            {TOUR_CHAPTERS.map((c, n) => <option key={c.id} value={n}>{`${TOUR_COPY.chapter} ${n + 1} of ${TOUR_CHAPTERS.length + 1}: ${c.label}`}</option>)}
            <option value={TOUR_CHAPTERS.length}>{`${TOUR_COPY.chapter} ${TOUR_CHAPTERS.length + 1} of ${TOUR_CHAPTERS.length + 1}: Finish`}</option>
          </select>
          {motionButton}
        </div>
      : <div className="et-chaps" role="group" aria-label="Chapters">
          {TOUR_CHAPTERS.map((c, n) => <button key={c.id} type="button" className="et-chap" aria-current={n === chapterIndex} onClick={() => go(CHAPTER_START[n])}>{String(n + 1).padStart(2, '0')} {c.label}</button>)}
          <button type="button" className="et-chap" aria-current={ending} onClick={() => go(ENDING_INDEX)}>{String(TOUR_CHAPTERS.length + 1).padStart(2, '0')} Finish</button>
        </div>)}
    {!compact && reduced && <p className="et-note">{TOUR_COPY.motionOff}</p>}
  </div>;

  const kicker = stageBeat?.station ? `${TOUR_COPY.moveOf(stationIndex, BOARD_STATIONS.length)} · ${TOUR_COPY.guide}` : `${TOUR_CHAPTERS[chapterIndex]?.label} · ${TOUR_COPY.guide}`;
  const caption = stageBeat && stageBeat.scene !== 'title' && <div key={`cap-${i}`} className={`et-cap${portrait ? ' et-cap--narrow' : ''}`}>
    <span ref={markRef} className="et-cap__mark"><TroyLivingIcon size={portrait ? 36 : 46} attention={!!particles} /></span>
    <div>
      <p className="et-cap__k">{kicker}</p>
      {copy.title && <p className="et-cap__t">{copy.title}</p>}
      <p className="et-cap__b">{copy.body}</p>
    </div>
  </div>;

  const shrinkStyle: CSSProperties | undefined = shrink ? { transform: `translate(${shrink.x}px, ${shrink.y}px) scale(${shrink.w / view.w}, ${shrink.h / view.h})` } : undefined;
  const cardBox = captionPlacement(cut, view.w, view.h, { w: 360, h: cardH });
  // A card placed against the bottom edge is anchored by its bottom, so a taller
  // caption grows upward and never slides off screen while it moves.
  const bottomAnchored = cardBox.y + cardBox.h >= view.h - 17;
  const cardStyle: CSSProperties = bottomAnchored
    ? { left: cardBox.x, bottom: view.h - cardBox.y - cardBox.h, width: cardBox.w, maxHeight: view.h - 32, overflowY: 'auto' }
    : { left: cardBox.x, top: cardBox.y, width: cardBox.w, maxHeight: view.h - 32, overflowY: 'auto' };
  const scene = stageBeat && (portrait
    ? stageBeat.scene === 'title' ? <PortraitTitle title={copy.title} body={copy.body} />
      : stageBeat.scene === 'board' ? <PortraitBoard station={stageBeat.station} start={stageBeat.spot === 'start'} noForge={forgeComplete === false} t={t} still={still} />
      : stageBeat.scene === 'lock' ? <PortraitLock phase={stageBeat.lock ?? 'locked'} t={t} still={still} />
      : stageBeat.scene === 'chart' ? <PortraitChart phase={stageBeat.chart ?? 'rows'} t={t} still={still} rows={ROWS} gap={GAP} panAt={panAt} />
      : <PortraitMeter t={t} still={still} />
    : stageBeat.scene === 'title' ? <TitleScene title={copy.title} body={copy.body} />
      : stageBeat.scene === 'board' ? <BoardScene station={stageBeat.station} start={stageBeat.spot === 'start'} noForge={forgeComplete === false} t={t} still={still} />
      : stageBeat.scene === 'lock' ? <LockScene phase={stageBeat.lock ?? 'locked'} t={t} still={still} />
      : stageBeat.scene === 'chart' ? <ChartScene phase={stageBeat.chart ?? 'rows'} t={t} still={still} rows={ROWS} gap={GAP} />
      : <MeterScene t={t} still={still} />);

  return <div className="et-root" role="dialog" aria-modal="true" aria-label={TOUR_COPY.dialogLabel} aria-describedby="et-keys" data-playing={running} data-act={ending ? 'end' : roomBeat ? 'room' : 'stage'} data-beat={beat?.id ?? 'ending'}>
    <p id="et-keys" className="et-sr">{TOUR_COPY.keys}</p>
    <p className="et-sr" aria-live="polite">{announce}</p>

    {stageBeat && <div className="et-wrap" data-shrink={!!shrink} style={shrinkStyle}>
      <div ref={stageRef} className="et-stage" aria-hidden="true" onClick={e => { if (e.isTrusted) toggle(); }}>
        {stage.w > 0 && <div className="et-cam" style={{ width: sceneSize.w, height: sceneSize.h, transform: `translate3d(${cam.tx}px, ${cam.ty}px, 0) scale(${cam.s})`, transition: cam.ms ? `transform ${cam.ms}ms ${CAMERA_EASE}` : 'none' }}>
          <div key={`${stageBeat.scene}:${portrait}`} className="et-scene">{scene}</div>
          {spot && <div className="et-spot" style={{ left: spot.x, top: spot.y, width: spot.w, height: spot.h, borderRadius: 14 / cam.s,
            boxShadow: `0 0 0 ${3 / cam.s}px #dbc173, 0 0 ${26 / cam.s}px ${5 / cam.s}px rgba(219,193,115,.35), 0 0 0 99999px rgba(8,7,6,.8)`,
            transition: reduced ? 'none' : `left ${CAMERA_MS}ms ${CAMERA_EASE}, top ${CAMERA_MS}ms ${CAMERA_EASE}, width ${CAMERA_MS}ms ${CAMERA_EASE}, height ${CAMERA_MS}ms ${CAMERA_EASE}` }} />}
          {stageBeat.lock === 'opened' && !portrait && <Cursor t={t} still={still} scale={cam.s} />}
        </div>}
        {!portrait && caption}
        {!playing && !reduced && <div aria-hidden="true" style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
          <span style={{ borderRadius: 999, background: '#000a', padding: 20 }}><Play size={34} aria-hidden="true" /></span>
        </div>}
      </div>
      {portrait && <div style={{ padding: '10px 0 0', background: '#0b0a09' }}>{caption}</div>}
      {controls(false)}
    </div>}

    {roomBeat && <>
      <div className="et-dim" style={{ background: cut ? 'transparent' : undefined }} aria-hidden="true" />
      {cut && <div className="et-cutout" data-still={reduced} aria-hidden="true" style={{ left: cut.x, top: cut.y, width: cut.w, height: cut.h }} />}
      {roomOk && cut && <div ref={setCardEl} key="room-card" className="et-card" data-still={reduced} style={cardStyle}>
        <div className="et-card__head">
          <span ref={markRef}><TroyLivingIcon size={40} attention={!!particles} /></span>
          <p className="et-cap__k">{TOUR_COPY.roomOf(roomPos, roomList.length)}</p>
        </div>
        <div key={`room-${i}`} className="et-card__text" style={{ animation: reduced ? 'none' : 'etCap 420ms cubic-bezier(.16,1,.3,1) both' }}>
          <p className="et-cap__t">{roomBeat.title}</p>
          <p className="et-cap__b">{roomBeat.body}</p>
        </div>
        <div className="et-mini" aria-hidden="true"><i style={{ width: `${progress * 100}%` }} /></div>
        {controls(true)}
        <div className="et-bar__row">{motionButton}</div>
      </div>}
    </>}

    {ending && <Ending {...props} reduced={reduced} onBack={() => go(ENDING_INDEX - 1)} />}

    {particles && !reduced && <svg key={particles.key} className="et-particles" aria-hidden="true">
      <path d={particles.d} fill="none" stroke="#bc9aff" strokeWidth="1.2" opacity=".35" />
      {Array.from({ length: 10 }, (_, n) => <circle key={n} r={n % 3 ? 2.2 : 4} fill={n % 3 ? '#d5b8fa' : '#e8c46a'} style={{ offsetPath: `path('${particles.d}')`, animationDelay: `${n * 34}ms` } as CSSProperties} />)}
    </svg>}

    {props.saveError && !ending && <div className="et-notice" style={{ pointerEvents: 'auto', bottom: roomBeat ? undefined : 120, top: roomBeat ? 16 : undefined }} role="status">
      <p>{props.saveError}</p>{props.onRetrySave && <button type="button" onClick={props.onRetrySave}>{TOUR_COPY.retrySave}</button>}
    </div>}
  </div>;
}

/** The cursor glides to Ask t.ROY in the composed card and clicks it. Nothing real is clicked. */
function Cursor({ t, still, scale }: { t: number; still: boolean; scale: number }) {
  if (still) return null;
  const on = t > 200 && t < CLICK_AT + 900;
  const there = t >= 900;
  const down = t >= CLICK_AT - 100 && t < CLICK_AT + 80;
  const p = there ? ASK_POINT : { x: ASK_POINT.x + 320, y: ASK_POINT.y + 210 };
  return <>
    <div className="et-cursor" style={{ left: p.x, top: p.y, opacity: on ? 1 : 0, transform: `translate(-6px,-4px) scale(${(down ? 0.86 : 1) / scale})`,
      transition: `left 750ms ${CAMERA_EASE}, top 750ms ${CAMERA_EASE}, opacity 250ms ease, transform 120ms ease` }}>
      <svg width="30" height="34" viewBox="0 0 30 34" aria-hidden="true"><path d="M3 2 L3 27 L10 20 L15 31 L20 29 L15 18 L25 18 Z" fill="#fff" stroke="#121110" strokeWidth="2" strokeLinejoin="round" /></svg>
    </div>
    {t >= CLICK_AT && t < CLICK_AT + 700 && <span className="et-ripple" style={{ left: ASK_POINT.x, top: ASK_POINT.y, width: 46 / scale, height: 46 / scale, marginLeft: -23 / scale, marginTop: -23 / scale, borderWidth: 3 / scale }} />}
  </>;
}

function Ending({ accountId, rewardClaimedAt, nextStep, quizDraft, onQuizDraft, onFinish, onDone, reduced, onBack }: TourPlayerProps & { reduced: boolean; onBack: () => void }) {
  const [quiz, setQuiz] = useState(false);
  const [passed, setPassed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [reward, setReward] = useState<TourReward | null>(null);
  const [destination, setDestination] = useState<string | undefined>();
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus({ preventScroll: true }); }, [quiz, reward]);

  async function finish(dest?: string) {
    if (busy) return;
    setBusy(true); setError('');
    try {
      const r = await onFinish();
      setReward(r); setDestination(dest);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Your finish could not be saved. Try again.');
      if (dest) throw e;
    } finally { setBusy(false); }
  }

  if (reward) {
    const celebrate = rewardCelebrates(reward);
    const [title, body] = rewardMessage(reward);
    const go = destination || nextStep?.href;
    return <div className="et-end" data-reward={reward.status}>
      {celebrate && !reduced && <CompletionConfetti />}
      <div className="et-end__card et-reward" role="group" aria-labelledby="et-end-title">
        <div className="et-reward__icon"><TroyLivingIcon size={84} attention={celebrate} /></div>
        <h2 id="et-end-title" ref={heading} tabIndex={-1}>{title}</h2>
        <p className="et-reward__big" role="status">{body}</p>
        {error && <p className="et-end__err" role="alert">{error}</p>}
        <div className="et-end__actions">
          {reward.status === 'unavailable' && <button type="button" className="et-primary" disabled={busy} onClick={() => void finish(destination)}>{busy ? TOUR_ENDING.finishing : TOUR_REWARD_COPY.retry}</button>}
          {go && <button type="button" className={reward.status === 'unavailable' ? '' : 'et-primary'} onClick={() => onDone(go)}>{TOUR_REWARD_COPY.keepGoing}{!destination && nextStep?.action ? `: ${nextStep.action}` : ''}</button>}
          <button type="button" onClick={() => onDone()}>{TOUR_REWARD_COPY.close}</button>
        </div>
      </div>
    </div>;
  }

  return <div className="et-end">
    <div className="et-end__card" role="group" aria-labelledby="et-end-title">
      <p className="et-end__k">{TOUR_ENDING.eyebrow}</p>
      <h2 id="et-end-title" ref={heading} tabIndex={-1}>{TOUR_ENDING.title}</h2>
      {!quiz && <>
        <p>{TOUR_ENDING.quizLine}</p>
        <p className="et-end__small">{TOUR_ENDING.quizNote}</p>
      </>}
      {quiz && <OrientationQuiz accountId={accountId} draft={quizDraft} onDraftChange={onQuizDraft} onPassed={() => setPassed(true)} onContinue={href => finish(href)} />}
      {error && <p className="et-end__err" role="alert">{error}</p>}
      <div className="et-end__actions">
        {!quiz && <button type="button" className="et-primary" onClick={() => setQuiz(true)}>{TOUR_ENDING.quizButton}</button>}
        {quiz && !passed && <button type="button" onClick={() => setQuiz(false)}>{TOUR_ENDING.quizBack}</button>}
        <button type="button" className={quiz && passed ? 'et-primary' : ''} disabled={busy} onClick={() => void finish()}>{busy ? TOUR_ENDING.finishing : TOUR_ENDING.finish}</button>
        {!quiz && <button type="button" onClick={onBack}><ChevronLeft size={16} aria-hidden="true" />{TOUR_ENDING.previous}</button>}
      </div>
      {rewardClaimedAt === null && <p className="et-end__small">{TOUR_ENDING.rewardNote}</p>}
    </div>
  </div>;
}
