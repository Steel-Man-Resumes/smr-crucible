"use client";
/**
 * The Refinery entrance tour, in two acts, auto-playing at reading pace.
 *
 * Act one plays on its own fixed stage: a camera frames a spotlight box in a
 * composed scene (the /walkthrough model: 1100ms ease, zoom capped, gold
 * spotlight, lower-third caption). Act two shrinks the stage into a corner
 * caption and points at the real navigation through a fixed cutout. The page
 * is never transformed or zoomed and no real control is clicked.
 *
 * Pause, step and chapter jump are always available. Reduced motion turns the
 * camera into cuts, removes particles and the cursor glide, and waits for Next.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { ChevronLeft, ChevronRight, Pause, Play, RotateCcw, X } from 'lucide-react';
import { TroyLivingIcon } from '@crucible/consumer-ui';
import { CompletionConfetti } from '@/components/CompletionConfetti';
import { OrientationQuiz, type OrientationDraft } from './OrientationQuiz';
import { BoardScene, ChartScene, LockScene, MeterScene, TitleScene, ASK_POINT, CLICK_AT } from './TourScenes';
import { TOUR_BEATS, TOUR_CHAPTERS, TOUR_COPY, TOUR_ENDING, TOUR_REWARD_COPY, type RoomBeat, type StageBeat } from '@/lib/tour/beats';
import { ACT_CHANGE_MS, CAMERA_EASE, CAMERA_MS, holdMs } from '@/lib/tour/timing';
import { CHART_NARROW, SCENE_SIZE, chartSceneSize, spotBox } from '@/lib/tour/layout';
import { captionPlacement, frameCamera, onStage, particlePath, spotlightRect, type Box, type Camera } from '@/lib/tour/geometry';
import { gapStart, serviceRows } from '@/lib/tour/services';
import { rewardCelebrates, type TourReward } from '@/lib/tour/reward';
import './entrance-tour.css';

export const ENDING_INDEX = TOUR_BEATS.length;
const FIRST_ROOM = TOUR_BEATS.findIndex(b => b.kind === 'room');
const ROOM_TOTAL = TOUR_BEATS.length - FIRST_ROOM;
const NAV_BREAK = 768;
const NARROW = 640;
const FIND_MS = 1800;
const REACQUIRE = { attempts: 3, deadlineMs: 12000 };
const DEV = process.env.NODE_ENV !== 'production';
const ROWS = serviceRows();
const GAP = gapStart(ROWS);
const CHAPTER_START = TOUR_CHAPTERS.map(c => TOUR_BEATS.findIndex(b => b.chapter === c.id));

export interface TourPlayerProps {
  start: number;
  accountId: string;
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

function readReduced() {
  try { return matchMedia('(prefers-reduced-motion: reduce)').matches || document.documentElement.classList.contains('reduce-motion'); } catch { return false; }
}

/** The real element for a nav contract id: the visible one, never one inside a closed drawer. */
export function findNavTarget(ids: readonly string[]): { el: HTMLElement; id: string } | null {
  for (const id of ids) {
    const found = Array.from(document.querySelectorAll<HTMLElement>(`[id="${id}"], [data-tour="${id}"]`))
      .find(el => el.getClientRects().length > 0 && !el.closest('[aria-hidden="true"], [hidden]') && el.getBoundingClientRect().width > 0);
    if (found) return { el: found, id };
  }
  return null;
}

export function TourPlayer(props: TourPlayerProps) {
  const { start, onBeat, onLeave, onNavigationReveal } = props;
  const [i, setI] = useState(() => Math.max(0, Math.min(ENDING_INDEX, start)));
  const [reduced, setReduced] = useState(readReduced);
  const [playing, setPlaying] = useState(() => !readReduced());
  const [hidden, setHidden] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [view, setView] = useState({ w: typeof window === 'undefined' ? 1280 : innerWidth, h: typeof window === 'undefined' ? 800 : innerHeight });
  const [stage, setStage] = useState({ w: 0, h: 0 });
  const [cam, setCam] = useState<Camera & { ms: number }>({ s: 1, tx: 0, ty: 0, ms: 0 });
  const [shrink, setShrink] = useState<Box | null>(null);
  const [ready, setReady] = useState(true);
  const [cut, setCut] = useState<Box | null>(null);
  const [cardH, setCardH] = useState(190);
  const [particles, setParticles] = useState<{ key: number; d: string } | null>(null);
  const [announce, setAnnounce] = useState('');
  const stageRef = useRef<HTMLDivElement>(null);
  const markRef = useRef<HTMLSpanElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const playRef = useRef<HTMLButtonElement>(null);
  const prevScene = useRef('');
  const dir = useRef(1);
  const target = useRef<HTMLElement | null>(null);
  const clock = useRef(0);

  const beat = TOUR_BEATS[i];
  const ending = i >= ENDING_INDEX;
  const stageBeat = beat?.kind === 'stage' ? beat as StageBeat : null;
  const roomBeat = beat?.kind === 'room' ? beat as RoomBeat : null;
  const hold = beat ? holdMs(beat) : 0;
  const narrow = view.w < NARROW;
  const mobileNav = view.w < NAV_BREAK;
  const still = reduced;

  /* Environment */
  useEffect(() => {
    const media = matchMedia('(prefers-reduced-motion: reduce)');
    const sync = () => { const r = readReduced(); setReduced(r); if (r) setPlaying(false); };
    const mutation = new MutationObserver(sync);
    mutation.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    const vis = () => setHidden(document.hidden);
    const size = () => setView({ w: innerWidth, h: innerHeight });
    media.addEventListener('change', sync); document.addEventListener('visibilitychange', vis); addEventListener('resize', size);
    vis();
    return () => { mutation.disconnect(); media.removeEventListener('change', sync); document.removeEventListener('visibilitychange', vis); removeEventListener('resize', size); };
  }, []);
  useEffect(() => { playRef.current?.focus({ preventScroll: true }); }, []);

  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setStage({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, [stageBeat ? 'stage' : 'other']); // eslint-disable-line react-hooks/exhaustive-deps

  /* Navigation between beats */
  const go = useCallback((n: number) => {
    const next = Math.max(0, Math.min(ENDING_INDEX, n));
    setI(cur => { dir.current = next >= cur ? 1 : -1; return next; });
    clock.current = 0; setElapsed(0); setShrink(null);
  }, []);

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
  useEffect(() => {
    if (ending) { setAnnounce(`${TOUR_ENDING.title} ${TOUR_ENDING.quizLine}`); return; }
    const where = roomBeat ? TOUR_COPY.roomOf(i - FIRST_ROOM + 1, ROOM_TOTAL) : TOUR_COPY.stepOf(i + 1, FIRST_ROOM);
    const title = /[.!?]$/.test(beat.title) ? beat.title : `${beat.title}.`;
    setAnnounce(`${where}. ${title} ${beat.body}${stageBeat ? ` ${stageBeat.sr}` : ''}`);
  }, [i]); // eslint-disable-line react-hooks/exhaustive-deps

  /* Act one camera */
  // On a phone the services chart is one column: the camera takes the top rows, then pans down.
  const panAt = Math.round(hold * 0.42);
  const spotName = stageBeat && narrow && stageBeat.chart === 'rows' && !reduced && elapsed >= panAt && GAP > CHART_NARROW.firstShot ? 'chart-rest' : stageBeat?.spot;
  const spot = useMemo(() => stageBeat ? spotBox(stageBeat.scene, spotName, { rows: ROWS.length, gapStart: GAP, narrow }) : null, [stageBeat, spotName, narrow]);
  const sceneSize = stageBeat?.scene === 'chart' ? chartSceneSize(ROWS.length, narrow) : stageBeat ? SCENE_SIZE[stageBeat.scene] : SCENE_SIZE.title;
  const reserve = narrow || !stageBeat || stageBeat.scene === 'title' ? 0 : Math.min(230, stage.h * 0.3);
  useLayoutEffect(() => {
    if (!stageBeat || !stage.w) return;
    const changed = prevScene.current !== stageBeat.scene;
    prevScene.current = stageBeat.scene;
    const next = frameCamera(stage, sceneSize, spot, reserve);
    setCam({ ...next, ms: reduced || changed ? 0 : CAMERA_MS });
  }, [i, stage.w, stage.h, reserve, spotName, narrow]); // eslint-disable-line react-hooks/exhaustive-deps

  /* t.ROY's particles: from the caption mark to whatever the beat is about. */
  useEffect(() => {
    setParticles(null);
    if (reduced || ending || !stageBeat || !spot || stageBeat.scene === 'title') return;
    const t = setTimeout(() => {
      const mark = markRef.current?.getBoundingClientRect();
      const st = stageRef.current?.getBoundingClientRect();
      if (!mark || !st) return;
      const to = onStage(spot, frameCamera(stage, sceneSize, spot, reserve));
      setParticles({ key: Date.now(), d: particlePath({ x: mark.left + mark.width / 2, y: mark.top + mark.height / 2 }, { x: st.left + to.x + to.w / 2, y: st.top + to.y + Math.min(to.h / 2, 60) }) });
    }, 420);
    const clear = setTimeout(() => setParticles(null), 1500);
    return () => { clearTimeout(t); clearTimeout(clear); };
  }, [i]); // eslint-disable-line react-hooks/exhaustive-deps

  /* Act two: find the real target, keep the cutout on it. */
  useEffect(() => {
    if (!roomBeat) { target.current = null; setCut(null); setReady(true); return; }
    onNavigationReveal?.(mobileNav);
    setReady(false); setCut(null); target.current = null;
    let raf = 0;
    let alive = true;
    let attempts = 0;
    const began = performance.now();
    const ids = [roomBeat.target, ...roomBeat.legacy];
    const skip = (why: string) => {
      if (DEV) console.warn(`[tour] skipped ${roomBeat.id}: ${why}`);
      go(i + dir.current);
    };
    const measure = () => {
      if (!alive) return;
      const el = target.current;
      if (!el || !el.isConnected || el.getClientRects().length === 0) {
        // The page replaced the element. Reacquire within one bounded deadline.
        if (++attempts > REACQUIRE.attempts || performance.now() - began > REACQUIRE.deadlineMs) { skip('target went away'); return; }
        acquire(performance.now() + FIND_MS); return;
      }
      const r = el.getBoundingClientRect();
      const next = spotlightRect(r, innerWidth, innerHeight, 6);
      setCut(prev => !next ? prev : prev && Math.abs(prev.x - next.x) < 0.5 && Math.abs(prev.y - next.y) < 0.5 && Math.abs(prev.w - next.w) < 0.5 && Math.abs(prev.h - next.h) < 0.5 ? prev : next);
      raf = requestAnimationFrame(measure);
    };
    const acquire = (deadline: number) => {
      const poll = () => {
        if (!alive) return;
        const found = findNavTarget(ids);
        if (found) {
          if (DEV && found.id !== roomBeat.target) console.warn(`[tour] ${roomBeat.target} is not on this build; using ${found.id}`);
          target.current = found.el;
          const r = found.el.getBoundingClientRect();
          if (r.top < 60 || r.bottom > innerHeight - 20) found.el.scrollIntoView({ block: 'nearest', behavior: 'auto' });
          setReady(true);
          requestAnimationFrame(() => {
            const mark = markRef.current?.getBoundingClientRect();
            const box = found.el.getBoundingClientRect();
            if (mark && !readReduced()) setParticles({ key: Date.now(), d: particlePath({ x: mark.left + mark.width / 2, y: mark.top + mark.height / 2 }, { x: box.left + Math.min(box.width / 2, 60), y: box.top + box.height / 2 }) });
          });
          measure();
          return;
        }
        if (performance.now() > deadline) { skip(`none of ${ids.join(', ')} found`); return; }
        raf = requestAnimationFrame(poll);
      };
      poll();
    };
    acquire(performance.now() + FIND_MS);
    const clear = setTimeout(() => setParticles(null), 1600);
    return () => { alive = false; cancelAnimationFrame(raf); clearTimeout(clear); };
  }, [i]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (!roomBeat) onNavigationReveal?.(false); }, [roomBeat ? 'room' : 'other']); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => onNavigationReveal?.(false), []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const el = cardRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setCardH(Math.ceil(e.contentRect.height) + 30));
    ro.observe(el);
    return () => ro.disconnect();
  }, [roomBeat ? 'room' : 'other']); // eslint-disable-line react-hooks/exhaustive-deps

  /* Controls */
  const toggle = useCallback(() => {
    if (ending) return;
    setPlaying(p => !p);
  }, [ending]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (ending || e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
      const el = e.target as HTMLElement | null;
      const native = !!el?.closest('button, a, input, textarea, select, label, summary');
      if ((e.key === ' ' && !native) || e.key === 'k') { e.preventDefault(); toggle(); }
      else if (e.key === 'ArrowRight' && !el?.closest('input')) { e.preventDefault(); go(i + 1); }
      else if (e.key === 'ArrowLeft' && !el?.closest('input')) { e.preventDefault(); go(i - 1); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [ending, toggle, go, i]);

  const chapterIndex = ending ? TOUR_CHAPTERS.length : TOUR_CHAPTERS.findIndex(c => c.id === beat.chapter);
  const progress = hold ? Math.min(1, elapsed / hold) : 0;
  const t = elapsed;

  const controls = (compact: boolean) => <div className={compact ? 'et-bar__row' : 'et-bar'} data-compact={compact}>
    <div className="et-bar__row">
      <button type="button" onClick={() => go(i - 1)} disabled={i === 0} aria-label={TOUR_COPY.previous}><ChevronLeft size={18} aria-hidden="true" /></button>
      <button ref={playRef} type="button" className="et-primary" onClick={toggle} aria-label={playing ? TOUR_COPY.pause : TOUR_COPY.play} aria-pressed={!playing}>
        {playing ? <Pause size={16} aria-hidden="true" /> : <Play size={16} aria-hidden="true" />}{!compact && <span>{playing ? TOUR_COPY.pause : TOUR_COPY.play}</span>}
      </button>
      <button type="button" onClick={() => go(i + 1)} aria-label={TOUR_COPY.next}><ChevronRight size={18} aria-hidden="true" /></button>
      {!compact && <div className="et-bar__grow et-segs" role="presentation">
        {TOUR_BEATS.map((b, n) => <button key={b.id} type="button" className="et-seg" tabIndex={-1} aria-hidden="true" data-gap={n > 0 && TOUR_BEATS[n - 1].chapter !== b.chapter} onClick={() => go(n)}>
          <span><i style={{ width: n < i ? '100%' : n > i ? '0%' : `${progress * 100}%` }} /></span>
        </button>)}
      </div>}
      {compact && <span className="et-bar__grow" />}
      <button type="button" onClick={onLeave} aria-label={`${TOUR_COPY.leave}. Escape`}><X size={16} aria-hidden="true" />{!compact && !narrow && <span>{TOUR_COPY.leave}</span>}</button>
    </div>
    {!compact && <div className="et-chaps" role="group" aria-label="Chapters">
      {TOUR_CHAPTERS.map((c, n) => <button key={c.id} type="button" className="et-chap" aria-current={n === chapterIndex} onClick={() => go(CHAPTER_START[n])}>{String(n + 1).padStart(2, '0')} {c.label}</button>)}
      <button type="button" className="et-chap" aria-current={ending} onClick={() => go(ENDING_INDEX)}>{String(TOUR_CHAPTERS.length + 1).padStart(2, '0')} Finish</button>
    </div>}
    {!compact && reduced && <p className="et-note">{TOUR_COPY.motionOff}</p>}
  </div>;

  const caption = stageBeat && stageBeat.scene !== 'title' && <div key={`cap-${i}`} className={`et-cap${narrow ? ' et-cap--narrow' : ''}`}>
    <span ref={markRef} className="et-cap__mark"><TroyLivingIcon size={narrow ? 36 : 46} attention={!!particles} /></span>
    <div>
      <p className="et-cap__k">{TOUR_CHAPTERS[chapterIndex]?.label} · {TOUR_COPY.guide}</p>
      <p className="et-cap__t">{stageBeat.title}</p>
      <p className="et-cap__b">{stageBeat.body}</p>
    </div>
  </div>;

  const shrinkStyle: CSSProperties | undefined = shrink ? { transform: `translate(${shrink.x}px, ${shrink.y}px) scale(${shrink.w / view.w}, ${shrink.h / view.h})` } : undefined;
  const cardBox = captionPlacement(cut, view.w, view.h, { w: 360, h: cardH });

  return <div className="et-root" role="dialog" aria-modal="true" aria-label={TOUR_COPY.dialogLabel} aria-describedby="et-keys" data-playing={running} data-act={ending ? 'end' : roomBeat ? 'room' : 'stage'}>
    <p id="et-keys" className="et-sr">{TOUR_COPY.keys}</p>
    <p className="et-sr" aria-live="polite">{announce}</p>

    {stageBeat && <div className="et-wrap" data-shrink={!!shrink} style={shrinkStyle}>
      <div ref={stageRef} className="et-stage" aria-hidden="true" onClick={e => { if (e.isTrusted) toggle(); }}>
        {stage.w > 0 && <div className="et-cam" style={{ width: sceneSize.w, height: sceneSize.h, transform: `translate3d(${cam.tx}px, ${cam.ty}px, 0) scale(${cam.s})`, transition: cam.ms ? `transform ${cam.ms}ms ${CAMERA_EASE}` : 'none' }}>
          <div key={stageBeat.scene} className="et-scene">
            {stageBeat.scene === 'title' ? <TitleScene title={stageBeat.title} body={stageBeat.body} />
              : stageBeat.scene === 'board' ? <BoardScene station={stageBeat.station} start={stageBeat.spot === 'start'} t={t} still={still} />
              : stageBeat.scene === 'lock' ? <LockScene phase={stageBeat.lock ?? 'locked'} t={t} still={still} />
              : stageBeat.scene === 'chart' ? <ChartScene phase={stageBeat.chart ?? 'rows'} t={t} still={still} rows={ROWS} gap={GAP} narrow={narrow} panAt={panAt} />
              : <MeterScene t={t} still={still} />}
          </div>
          {spot && <div className="et-spot" style={{ left: spot.x, top: spot.y, width: spot.w, height: spot.h, borderRadius: 14 / cam.s,
            boxShadow: `0 0 0 ${3 / cam.s}px #dbc173, 0 0 ${26 / cam.s}px ${5 / cam.s}px rgba(219,193,115,.35), 0 0 0 99999px rgba(8,7,6,.6)`,
            transition: reduced ? 'none' : `left ${CAMERA_MS}ms ${CAMERA_EASE}, top ${CAMERA_MS}ms ${CAMERA_EASE}, width ${CAMERA_MS}ms ${CAMERA_EASE}, height ${CAMERA_MS}ms ${CAMERA_EASE}` }} />}
          {stageBeat.lock === 'opened' && <Cursor t={t} still={still} scale={cam.s} />}
        </div>}
        {!narrow && caption}
        {!playing && !reduced && <div className="et-paused" aria-hidden="true" style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
          <span style={{ borderRadius: 999, background: '#000a', padding: 20 }}><Play size={34} aria-hidden="true" /></span>
        </div>}
      </div>
      {narrow && <div style={{ padding: '10px 0 0', background: '#0b0a09' }}>{caption}</div>}
      {controls(false)}
    </div>}

    {roomBeat && <>
      <div className="et-dim" style={{ background: cut ? 'transparent' : undefined }} aria-hidden="true" />
      {cut && <div className="et-cutout" data-still={reduced} aria-hidden="true" style={{ left: cut.x, top: cut.y, width: cut.w, height: cut.h }} />}
      <div ref={cardRef} key="room-card" className="et-card" data-still={reduced} style={{ left: cardBox.x, top: cardBox.y, width: cardBox.w }}>
        <div className="et-card__head">
          <span ref={markRef}><TroyLivingIcon size={40} attention={!!particles} /></span>
          <p className="et-cap__k">{TOUR_COPY.roomOf(i - FIRST_ROOM + 1, ROOM_TOTAL)}</p>
        </div>
        <div key={`room-${i}`} className="et-card__text" style={{ animation: reduced ? 'none' : 'etCap 420ms cubic-bezier(.16,1,.3,1) both' }}>
          <p className="et-cap__t">{roomBeat.title}</p>
          <p className="et-cap__b">{roomBeat.body}</p>
        </div>
        <div className="et-mini" aria-hidden="true"><i style={{ width: `${progress * 100}%` }} /></div>
        {controls(true)}
      </div>
    </>}

    {ending && <Ending {...props} />}

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

function formatDay(iso?: string) {
  if (!iso) return 'an earlier day';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? 'an earlier day' : d.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' });
}

function Ending({ accountId, rewardClaimedAt, nextStep, quizDraft, onQuizDraft, onFinish, onDone }: TourPlayerProps) {
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
    const [title, body] = reward.status === 'granted' ? [TOUR_REWARD_COPY.grantedTitle, TOUR_REWARD_COPY.granted(reward.calls)]
      : reward.status === 'already' ? [TOUR_REWARD_COPY.alreadyTitle, TOUR_REWARD_COPY.already(formatDay(reward.grantedAt))]
      : reward.status === 'capped' ? [TOUR_REWARD_COPY.cappedTitle, TOUR_REWARD_COPY.capped]
      : [TOUR_REWARD_COPY.unavailableTitle, TOUR_REWARD_COPY.unavailable];
    const go = destination || nextStep?.href;
    return <div className="et-end">
      {celebrate && <CompletionConfetti />}
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
      </div>
      {rewardClaimedAt === null && <p className="et-end__small">{TOUR_ENDING.rewardNote}</p>}
    </div>
  </div>;
}
