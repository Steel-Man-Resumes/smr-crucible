"use client";
/**
 * The CRM staff tour's player: one act on the real staff screens, auto-playing
 * at the entrance tour's reading pace (lib/tour/timing.ts), led by t.ROY.
 *
 * It is the entrance tour's act-two engine (components/tour/TourPlayer.tsx)
 * applied to beats that live on several pages: a fixed cutout points at the
 * real element, re-measured every frame, the page is never transformed or
 * zoomed, and no real control is pressed. When a beat lives on another page the
 * player asks the controller to go there (onNavigate) and waits for the beat's
 * elements; a beat whose elements never show is passed over, never shown dark.
 *
 * Pause, step, Leave and a motion switch are always on the card. Reduced motion
 * (system or the switch) stops auto-play and the cutout tween, and waits for Next.
 * Nothing here fetches: the beats only point, and a shared item is never opened.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { ChevronLeft, ChevronRight, Pause, Play, X } from 'lucide-react';
import { TroyLivingIcon } from '@crucible/consumer-ui';
import { findNavElement } from '@/lib/tour/find-target';
import { TOUR_COPY } from '@/lib/tour/beats';
import { CRM_EXAMPLE_LABEL, CRM_TOUR_COPY, CRM_TOUR_ENDING, beatCopy, beatHold, beatHref, onBeatPage, type CrmBeat } from '@/lib/tour/crm-beats';
import { captionPlacement, spotlightRect, unionBox, type Box } from '@/lib/tour/geometry';
import './entrance-tour.css';
import './staff-tour.css';

const NARROW = 640;
const NAV_BREAK = 768;
/** How long a page may take to draw a beat's elements after the route lands (data loads first). */
const WAIT_MS = 6000;
/** How long a route push may take to land before the card offers Leave and Try again. */
const NAV_WAIT_MS = 8000;
/** A stop whose element vanishes for this long is passed over. */
const LOST_MS = 1200;
const MOTION_KEY = 'tour-motion-off:';
const DEV = process.env.NODE_ENV !== 'production';

export interface StaffTourPlayerProps {
  /** The beats this run can show, in order (lib/tour/crm-beats.ts applicableBeats). */
  beats: readonly CrmBeat[];
  /** Index into `beats` to start at; beats.length is the ending card. */
  start: number;
  accountId: string;
  personId: string | null;
  demo: boolean;
  /** The router's current pathname plus search, so the player knows when a page has landed. */
  location: string;
  onNavigate: (href: string) => void;
  /** The current beat (index into `beats`), for saving the place. */
  onBeat: (index: number) => void;
  onLeave: () => void;
  /** Saves completion; resolves when the server confirmed it or throws a message. */
  onFinish: () => Promise<void>;
  onDone: () => void;
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
function findStop(beat: CrmBeat, portrait: boolean): HTMLElement[] {
  const els = beat.targets.map(findNavElement).filter((el): el is HTMLElement => !!el);
  // On a phone a tall target would sit under the card: light the row the caption is about instead.
  if (portrait && beat.portraitWithin && els[0]) {
    const within = els[0].querySelector<HTMLElement>(beat.portraitWithin);
    if (within && within.getClientRects().length > 0) return [within];
  }
  return els;
}

export function StaffTourPlayer(props: StaffTourPlayerProps) {
  const { beats, start, accountId, personId, demo, location, onNavigate, onBeat, onLeave, onNavigationReveal } = props;
  const ENDING = beats.length;
  const [i, setI] = useState(() => Math.max(0, Math.min(ENDING, start)));
  const [systemReduced, setSystemReduced] = useState(osReduced);
  const [quiet, setQuiet] = useState(() => readQuiet(accountId));
  const reduced = systemReduced || quiet;
  const [playing, setPlaying] = useState(() => !(osReduced() || readQuiet(accountId)));
  const [hidden, setHidden] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [view, setView] = useState({ w: typeof window === 'undefined' ? 1280 : innerWidth, h: typeof window === 'undefined' ? 800 : innerHeight });
  const [cut, setCut] = useState<Box | null>(null);
  const [cardH, setCardH] = useState(() => (typeof window !== 'undefined' && innerWidth < NARROW ? 300 : 220));
  const [announce, setAnnounce] = useState('');
  /** The route push has not landed within NAV_WAIT_MS: offer Leave and Try again instead of waiting for good. */
  const [stuck, setStuck] = useState(false);
  const [retry, setRetry] = useState(0);
  const [cardEl, setCardEl] = useState<HTMLDivElement | null>(null);
  const dir = useRef(1);
  const clock = useRef(0);
  const asked = useRef('');
  const lastBeat = useRef(-1);

  const beat = i < ENDING ? beats[i] : null;
  const ending = i >= ENDING;
  const copy = beat ? beatCopy(beat, demo) : null;
  const hold = beat ? beatHold(beat, demo) : 0;
  const portrait = view.w < NARROW;
  const mobileNav = view.w < NAV_BREAK;
  const href = beat ? beatHref(beat, personId) : '';
  const landed = !!beat && onBeatPage(location, href);
  const ready = !beat || (landed && !!cut);

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

  const toggleMotion = useCallback(() => {
    setQuiet(q => {
      const next = !q;
      try { if (next) sessionStorage.setItem(MOTION_KEY + accountId, '1'); else sessionStorage.removeItem(MOTION_KEY + accountId); } catch {}
      if (next) setPlaying(false);
      return next;
    });
  }, [accountId]);

  const go = useCallback((n: number) => {
    setI(cur => { dir.current = n >= cur ? 1 : -1; return Math.max(0, Math.min(ENDING, n)); });
    clock.current = 0; setElapsed(0);
  }, [ENDING]);
  useEffect(() => { onBeat(i); }, [i, onBeat]);

  /* Each beat: go to its page once, then keep the cutout on its elements. */
  useEffect(() => {
    // A new beat starts from no cutout, so the wait rule (not the lost rule) applies to it.
    if (lastBeat.current !== i) { lastBeat.current = i; setCut(null); }
    if (!beat) { onNavigationReveal?.(false); return; }
    if (!landed) {
      if (asked.current !== `${i}:${href}:${retry}`) { asked.current = `${i}:${href}:${retry}`; setStuck(false); onNavigate(href); }
      const timer = setTimeout(() => setStuck(true), NAV_WAIT_MS);
      return () => clearTimeout(timer);
    }
    setStuck(false);
    const reveal = !!beat.drawer && mobileNav;
    onNavigationReveal?.(reveal);
    let raf = 0;
    let alive = true;
    const began = performance.now();
    let lostSince = 0;
    let lit = false;
    const measure = () => {
      if (!alive) return;
      const els = findStop(beat, portrait);
      if (els.length < beat.minFound) {
        // The shell closes its drawer on every route change, after this effect ran: keep asking until the stop is drawn.
        if (reveal && !lit) onNavigationReveal?.(true);
        // Not drawn yet (data loading), or gone. Wait, then pass over.
        if (!lit) { if (performance.now() - began > WAIT_MS) { if (DEV) console.warn(`[staff tour] left out ${beat.id}: ${beat.targets.map(t => t[0]).join(', ')} not on this page`); go(i + dir.current); return; } }
        else { lostSince ||= performance.now(); if (performance.now() - lostSince > LOST_MS) { if (DEV) console.warn(`[staff tour] ${beat.id} went away`); go(i + dir.current); return; } }
        raf = requestAnimationFrame(measure); return;
      }
      lostSince = 0;
      if (!lit) {
        lit = true;
        const r = els[0].getBoundingClientRect();
        // Under the 72 px top bar and above the card: centre it when it is off that band.
        if (r.top < 84 || r.bottom > innerHeight - (portrait ? 320 : 60)) els[0].scrollIntoView({ block: 'center', behavior: 'auto' });
      }
      const box = unionBox(els.map(el => { const r = el.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; }));
      const next = box && spotlightRect({ left: box.x, top: box.y, width: box.w, height: box.h }, innerWidth, innerHeight, 6);
      setCut(prev => !next ? prev : prev && Math.abs(prev.x - next.x) < 0.5 && Math.abs(prev.y - next.y) < 0.5 && Math.abs(prev.w - next.w) < 0.5 && Math.abs(prev.h - next.h) < 0.5 ? prev : next);
      raf = requestAnimationFrame(measure);
    };
    measure();
    return () => { alive = false; cancelAnimationFrame(raf); };
  }, [i, landed, href, retry]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => onNavigationReveal?.(false), []); // eslint-disable-line react-hooks/exhaustive-deps

  /* Clock: runs while playing, visible and the stop is lit. */
  const running = playing && !hidden && ready && !ending;
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
  useEffect(() => { if (running && elapsed >= hold) go(i + 1); }, [elapsed, hold, running, go, i]);

  /* Screen reader: one announcement per lit stop. */
  useEffect(() => {
    if (ending) { setAnnounce(`${CRM_TOUR_ENDING.title} ${CRM_TOUR_ENDING.body}`); return; }
    if (!cut || !copy) return;
    const head = /[.!?]$/.test(copy.title) ? copy.title : `${copy.title}.`;
    const example = copy.example.length ? ` ${CRM_EXAMPLE_LABEL}: ${copy.example.join('. ')}.` : '';
    setAnnounce(`${CRM_TOUR_COPY.stepOf(i + 1, ENDING)}. ${head} ${copy.body}${example}`);
  }, [i, !!cut, ending]); // eslint-disable-line react-hooks/exhaustive-deps

  // The card mounts once a stop is lit. Measure it before paint and hand it focus.
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

  const progress = hold ? Math.min(1, elapsed / hold) : 0;
  const cardBox = captionPlacement(cut, view.w, view.h, { w: 360, h: cardH });
  const bottomAnchored = cardBox.y + cardBox.h >= view.h - 17;
  const cardStyle: CSSProperties = bottomAnchored
    ? { left: cardBox.x, bottom: view.h - cardBox.y - cardBox.h, width: cardBox.w, maxHeight: view.h - 32, overflowY: 'auto' }
    : { left: cardBox.x, top: cardBox.y, width: cardBox.w, maxHeight: view.h - 32, overflowY: 'auto' };

  const motionButton = <button type="button" className="et-motion" onClick={toggleMotion} disabled={systemReduced} aria-label={reduced ? TOUR_COPY.motionToggleOn : TOUR_COPY.motionToggleOff}>
    {reduced ? TOUR_COPY.motionToggleOn : TOUR_COPY.motionToggleOff}
  </button>;

  return <div className="et-root" role="dialog" aria-modal="true" aria-label={CRM_TOUR_COPY.dialogLabel} aria-describedby="st-keys" data-playing={running} data-act={ending ? 'end' : 'room'} data-beat={beat?.id ?? 'ending'} data-tour-id="crm">
    <p id="st-keys" className="et-sr">{TOUR_COPY.keys}</p>
    <p className="et-sr" aria-live="polite">{announce}</p>

    {beat && <>
      <div className="et-dim" style={{ background: cut ? 'transparent' : undefined }} aria-hidden="true" />
      {cut && <div className="et-cutout" data-still={reduced} aria-hidden="true" style={{ left: cut.x, top: cut.y, width: cut.w, height: cut.h }} />}
      {!cut && <div className="et-notice" role="status" style={{ pointerEvents: 'auto', top: 16, bottom: 'auto' }}>
        <p>{stuck ? CRM_TOUR_COPY.stuck : CRM_TOUR_COPY.finding}</p>
        {stuck && <button type="button" className="et-primary" onClick={() => setRetry(n => n + 1)}>{CRM_TOUR_COPY.retryPage}</button>}
        <button type="button" onClick={onLeave} aria-label={`${TOUR_COPY.leave}. Escape`}>{TOUR_COPY.leave}</button>
      </div>}
      {cut && copy && <div ref={setCardEl} key="staff-card" className="et-card" data-still={reduced} style={cardStyle}>
        <div className="et-card__head">
          <span><TroyLivingIcon size={40} attention={false} /></span>
          <p className="et-cap__k">{CRM_TOUR_COPY.stepOf(i + 1, ENDING)} · {CRM_TOUR_COPY.guide}</p>
        </div>
        <div key={`beat-${i}`} className="et-card__text" style={{ animation: reduced ? 'none' : 'etCap 420ms cubic-bezier(.16,1,.3,1) both' }}>
          <p className="et-cap__t">{copy.title}</p>
          <p className="et-cap__b">{copy.body}</p>
          {copy.example.length > 0 && <div className="st-example" role="note" aria-label={`${CRM_EXAMPLE_LABEL}, made-up people`}>
            <p className="st-example__k">{CRM_EXAMPLE_LABEL}</p>
            <ul>{copy.example.map((line) => <li key={line}>{line}</li>)}</ul>
          </div>}
        </div>
        <div className="et-mini" aria-hidden="true"><i style={{ width: `${progress * 100}%` }} /></div>
        <div className="et-bar__row">
          <button type="button" onClick={() => go(i - 1)} disabled={i === 0} aria-label={TOUR_COPY.previous}><ChevronLeft size={18} aria-hidden="true" /></button>
          <button type="button" className="et-primary" onClick={toggle} aria-label={playing ? TOUR_COPY.pause : TOUR_COPY.play}>
            {playing ? <Pause size={16} aria-hidden="true" /> : <Play size={16} aria-hidden="true" />}
          </button>
          <button type="button" onClick={() => go(i + 1)} aria-label={TOUR_COPY.next}><ChevronRight size={18} aria-hidden="true" /></button>
          <span className="et-bar__grow" />
          <button type="button" onClick={onLeave} aria-label={`${TOUR_COPY.leave}. Escape`}><X size={16} aria-hidden="true" /></button>
        </div>
        <div className="et-bar__row">{motionButton}</div>
        {reduced && <p className="et-note">{TOUR_COPY.motionOff}</p>}
      </div>}
    </>}

    {ending && <Ending onFinish={props.onFinish} onDone={props.onDone} onBack={() => go(ENDING - 1)} />}

    {props.saveError && !ending && cut && <div className="et-notice" style={{ pointerEvents: 'auto', top: 16, bottom: 'auto' }} role="status">
      <p>{props.saveError}</p>{props.onRetrySave && <button type="button" onClick={props.onRetrySave}>{CRM_TOUR_COPY.retrySave}</button>}
    </div>}
  </div>;
}

/** The ending card: finish (saves completion) or step back. No reward, no quiz: staff tours grant nothing. */
function Ending({ onFinish, onDone, onBack }: { onFinish: () => Promise<void>; onDone: () => void; onBack: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus({ preventScroll: true }); }, []);
  async function finish() {
    if (busy) return;
    setBusy(true); setError('');
    try { await onFinish(); onDone(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Your finish could not be saved. Try again.'); }
    finally { setBusy(false); }
  }
  return <div className="et-end">
    <div className="et-end__card" role="group" aria-labelledby="st-end-title">
      <p className="et-end__k">{CRM_TOUR_ENDING.eyebrow}</p>
      <h2 id="st-end-title" ref={heading} tabIndex={-1}>{CRM_TOUR_ENDING.title}</h2>
      <p>{CRM_TOUR_ENDING.body}</p>
      {error && <p className="et-end__err" role="alert">{error}</p>}
      <div className="et-end__actions">
        <button type="button" className="et-primary" disabled={busy} onClick={() => void finish()}>{busy ? CRM_TOUR_ENDING.finishing : CRM_TOUR_ENDING.finish}</button>
        <button type="button" onClick={onBack}><ChevronLeft size={16} aria-hidden="true" />{CRM_TOUR_ENDING.previous}</button>
      </div>
    </div>
  </div>;
}
