"use client";
/**
 * The Settings tour's player: one act on the real Settings page, auto-playing
 * at the entrance tour's reading pace (lib/tour/timing.ts), led by t.ROY.
 *
 * It is the entrance tour's act-two engine (components/tour/TourPlayer.tsx)
 * on one long page: a fixed cutout points at the real element, re-measured
 * every frame; the page is never transformed or zoomed; no real control is
 * pressed and no setting is saved. The tour scrolls each target into place
 * itself, at block start under the top bar and the sticky section map (the
 * page lock keeps the person's own scroll off while it plays). A stop whose
 * element is missing at its turn is passed over, never shown dark.
 *
 * Pause, Previous, Next, Leave and Stop motion are on the card. Space pauses,
 * arrows step; Escape is the controller's (it leaves and keeps the place).
 * Reduced motion (system or the switch) stops auto-play, the scroll animation
 * and the cutout tween, and waits for Next. The ending card holds the one
 * nudge picked for this person and the reward, at the person's own pace.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { ChevronLeft, ChevronRight, Pause, Play, X } from 'lucide-react';
import { TroyLivingIcon } from '@crucible/consumer-ui';
import { CompletionConfetti } from '@/components/CompletionConfetti';
import { findNavElement } from './TourPlayer';
import { TOUR_COPY } from '@/lib/tour/beats';
import { SETTINGS_ENDING, SETTINGS_REWARD_COPY, SETTINGS_TOUR_COPY, type SettingsBeat, type SettingsNudge } from '@/lib/tour/settings-beats';
import { clipHeight, scrollTopFor, settingsRewardMessage } from '@/lib/tour/settings-tour';
import { holdMs } from '@/lib/tour/timing';
import { captionPlacement, spotlightRect, type Box } from '@/lib/tour/geometry';
import { rewardCelebrates, type TourReward } from '@/lib/tour/reward';
import './entrance-tour.css';

const NARROW = 640;
/** A stop whose element is missing for this long is passed over. */
const LOST_MS = 1200;
const MOTION_KEY = 'tour-motion-off:';
const DEV = process.env.NODE_ENV !== 'production';

export interface SettingsTourPlayerProps {
  /** The stops this run shows, in order (lib/tour/settings-tour.ts applicableBeats). */
  beats: readonly SettingsBeat[];
  /** Index into `beats` to start at; beats.length is the ending card. */
  start: number;
  accountId: string;
  nudge: SettingsNudge;
  /** The current stop (index into `beats`, or beats.length for the ending), for saving the place. */
  onBeat: (index: number) => void;
  onLeave: () => void;
  /** Saves completion; resolves with the server's reward or throws a message. */
  onFinish: () => Promise<TourReward>;
  /** Closes the tour; with targets, scrolls the page to the first that exists. */
  onDone: (targets?: readonly string[]) => void;
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

/** Scroll the page so the target sits under the sticky chrome. The section map itself goes to the top. */
export function scrollToTarget(el: HTMLElement) {
  if (el.id === 'refinery-tool-settings-map') { window.scrollTo({ top: 0, behavior: 'auto' }); return; }
  window.scrollTo({ top: scrollTopFor(el.getBoundingClientRect().top, window.scrollY, mapHeight()), behavior: 'auto' });
}

export function SettingsTourPlayer(props: SettingsTourPlayerProps) {
  const { beats, start, accountId, nudge, onBeat, onLeave } = props;
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
  const [cardEl, setCardEl] = useState<HTMLDivElement | null>(null);
  const dir = useRef(1);
  const clock = useRef(0);

  const beat = beats[i];
  const ending = i >= ENDING;
  const hold = beat ? holdMs(beat) : 0;
  const portrait = view.w < NARROW;
  const ready = ending || !!cut;

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

  /* Navigation between stops. */
  const go = useCallback((n: number) => {
    setI(cur => { dir.current = n >= cur ? 1 : -1; return Math.max(0, Math.min(ENDING, n)); });
    clock.current = 0; setElapsed(0);
  }, [ENDING]);
  useEffect(() => { onBeat(i); }, [i, onBeat]);

  /* Clock: runs while playing, visible, lit and not on the ending. */
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

  /* Each stop: scroll the target into place once, then keep the cutout on it every frame. */
  useEffect(() => {
    if (!beat) { setCut(null); return; }
    let raf = 0;
    let alive = true;
    let lostSince = 0;
    let first = true;
    const measure = () => {
      if (!alive) return;
      const el = findNavElement(beat.targets);
      if (!el) {
        lostSince ||= performance.now();
        if (performance.now() - lostSince > LOST_MS) {
          if (DEV) console.warn(`[settings tour] passed over ${beat.id}: ${beat.targets.join(', ')} not on this page`);
          go(i + dir.current); return;
        }
        raf = requestAnimationFrame(measure); return;
      }
      lostSince = 0;
      if (first) { first = false; scrollToTarget(el); }
      const r = el.getBoundingClientRect();
      const next = spotlightRect({ left: r.left, top: r.top, width: r.width, height: clipHeight(r.height, innerHeight, beat.clip) }, innerWidth, innerHeight, 6);
      setCut(prev => !next ? prev : prev && Math.abs(prev.x - next.x) < 0.5 && Math.abs(prev.y - next.y) < 0.5 && Math.abs(prev.w - next.w) < 0.5 && Math.abs(prev.h - next.h) < 0.5 ? prev : next);
      raf = requestAnimationFrame(measure);
    };
    measure();
    return () => { alive = false; cancelAnimationFrame(raf); };
  }, [i, beat?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  /* Screen reader: one announcement per stop. */
  useEffect(() => {
    if (ending) { setAnnounce(`${nudge.title}. ${nudge.body}`); return; }
    if (!beat) return;
    const head = /[.!?]$/.test(beat.title) ? beat.title : `${beat.title}.`;
    setAnnounce(`${SETTINGS_TOUR_COPY.stopOf(i + 1, ENDING)}. ${head} ${beat.body}${beat.glyph ? ` ${SETTINGS_TOUR_COPY.doorsSr}` : ''}`);
  }, [i]); // eslint-disable-line react-hooks/exhaustive-deps

  // The card mounts once (when the first stop is lit) and stays. Measure it
  // before paint so its placement uses its real height, and hand it focus.
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
  // A card against the bottom edge is anchored by its bottom, so a taller
  // caption grows upward and never slides off screen while it moves.
  const bottomAnchored = cardBox.y + cardBox.h >= view.h - 17;
  const cardStyle: CSSProperties = bottomAnchored
    ? { left: cardBox.x, bottom: view.h - cardBox.y - cardBox.h, width: cardBox.w, maxHeight: view.h - 32, overflowY: 'auto' }
    : { left: cardBox.x, top: cardBox.y, width: cardBox.w, maxHeight: view.h - 32, overflowY: 'auto' };

  return <div className="et-root" role="dialog" aria-modal="true" aria-label={SETTINGS_TOUR_COPY.dialogLabel} aria-describedby="st-keys" data-playing={running} data-act={ending ? 'end' : 'room'} data-beat={beat?.id ?? 'ending'}>
    <p id="st-keys" className="et-sr">{TOUR_COPY.keys}</p>
    <p className="et-sr" aria-live="polite">{announce}</p>

    {beat && <>
      <div className="et-dim" style={{ background: cut ? 'transparent' : undefined }} aria-hidden="true" />
      {cut && <div className="et-cutout" data-still={reduced} aria-hidden="true" style={{ left: cut.x, top: cut.y, width: cut.w, height: cut.h }} />}
      {cut && <div ref={setCardEl} key="settings-card" className="et-card" data-still={reduced} style={cardStyle}>
        <div className="et-card__head">
          <span><TroyLivingIcon size={40} /></span>
          <p className="et-cap__k">{SETTINGS_TOUR_COPY.stopOf(i + 1, ENDING)} · {SETTINGS_TOUR_COPY.guide}</p>
        </div>
        <div key={`stop-${i}`} className="et-card__text" style={{ animation: reduced ? 'none' : 'etCap 420ms cubic-bezier(.16,1,.3,1) both' }}>
          <p className="et-cap__t" style={beat.glyph ? { display: 'flex', alignItems: 'center', gap: 10 } : undefined}>
            {beat.glyph === 'doors' && <Doors />}
            <span>{beat.title}</span>
          </p>
          <p className="et-cap__b">{beat.body}</p>
        </div>
        {!portrait && <div className="et-segs" role="presentation">
          {beats.map((b, n) => <span key={b.id} className="et-seg"><span><i style={{ width: n < i ? '100%' : n > i ? '0%' : `${progress * 100}%` }} /></span></span>)}
        </div>}
        {portrait && <div className="et-mini" aria-hidden="true"><i style={{ width: `${progress * 100}%` }} /></div>}
        <div className="et-bar__row">
          <button type="button" onClick={() => go(i - 1)} disabled={i === 0} aria-label={TOUR_COPY.previous}><ChevronLeft size={18} aria-hidden="true" /></button>
          <button type="button" className="et-primary" onClick={toggle} aria-label={playing ? TOUR_COPY.pause : TOUR_COPY.play}>
            {playing ? <Pause size={16} aria-hidden="true" /> : <Play size={16} aria-hidden="true" />}
          </button>
          <button type="button" onClick={() => go(i + 1)} aria-label={TOUR_COPY.next}><ChevronRight size={18} aria-hidden="true" /></button>
          <span className="et-bar__grow" />
          <button type="button" onClick={onLeave} aria-label={`${TOUR_COPY.leave}. Escape`}><X size={16} aria-hidden="true" /></button>
        </div>
        <div className="et-bar__row">
          <button type="button" className="et-motion" onClick={toggleMotion} disabled={systemReduced} aria-label={reduced ? TOUR_COPY.motionToggleOn : TOUR_COPY.motionToggleOff}>
            {reduced ? TOUR_COPY.motionToggleOn : TOUR_COPY.motionToggleOff}
          </button>
          {reduced && <p className="et-note">{TOUR_COPY.motionOff}</p>}
        </div>
      </div>}
    </>}

    {ending && <Ending {...props} reduced={reduced} onBack={() => go(ENDING - 1)} />}

    {props.saveError && !ending && <div className="et-notice" style={{ pointerEvents: 'auto', top: 16 }} role="status">
      <p>{props.saveError}</p>{props.onRetrySave && <button type="button" onClick={props.onRetrySave}>{TOUR_COPY.retrySave}</button>}
    </div>}
  </div>;
}

/** The teaching moment's glyph: two doors, one open and one shut. The only art in this tour. */
function Doors() {
  return <svg width="34" height="24" viewBox="0 0 34 24" aria-hidden="true" style={{ flex: '0 0 auto' }}>
    <rect x="1" y="1" width="12" height="22" rx="1.5" fill="none" stroke="#dbc173" strokeWidth="1.6" />
    <circle cx="10" cy="12.5" r="1.1" fill="#dbc173" />
    <rect x="19" y="1" width="14" height="22" rx="1.5" fill="none" stroke="#8f897a" strokeWidth="1.6" />
    <path d="M22 2.2 L30 5 L30 22.2 L22 21.6 Z" fill="#dbc17333" stroke="#dbc173" strokeWidth="1.6" strokeLinejoin="round" />
  </svg>;
}

function Ending({ nudge, onFinish, onDone, reduced, onBack }: SettingsTourPlayerProps & { reduced: boolean; onBack: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [reward, setReward] = useState<TourReward | null>(null);
  const [chose, setChose] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus({ preventScroll: true }); }, [reward]);

  async function finish(withNudge: boolean) {
    if (busy) return;
    setBusy(true); setError('');
    try {
      const r = await onFinish();
      setChose(withNudge); setReward(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Your finish could not be saved. Try again.');
    } finally { setBusy(false); }
  }

  if (reward) {
    const celebrate = rewardCelebrates(reward);
    const [title, body] = settingsRewardMessage(reward);
    return <div className="et-end" data-reward={reward.status}>
      {celebrate && !reduced && <CompletionConfetti />}
      <div className="et-end__card et-reward" role="group" aria-labelledby="st-end-title">
        <div className="et-reward__icon"><TroyLivingIcon size={84} attention={celebrate} /></div>
        <h2 id="st-end-title" ref={heading} tabIndex={-1}>{title}</h2>
        <p className="et-reward__big" role="status">{body}</p>
        {error && <p className="et-end__err" role="alert">{error}</p>}
        <div className="et-end__actions">
          {reward.status === 'unavailable' && <button type="button" className="et-primary" disabled={busy} onClick={() => void finish(chose)}>{busy ? SETTINGS_ENDING.finishing : SETTINGS_REWARD_COPY.retry}</button>}
          {chose && <button type="button" className={reward.status === 'unavailable' ? '' : 'et-primary'} onClick={() => onDone(nudge.targets)}>{nudge.button}</button>}
          <button type="button" className={!chose && reward.status !== 'unavailable' ? 'et-primary' : ''} onClick={() => onDone()}>{SETTINGS_REWARD_COPY.close}</button>
        </div>
      </div>
    </div>;
  }

  return <div className="et-end">
    <div className="et-end__card" role="group" aria-labelledby="st-end-title">
      <p className="et-end__k">{SETTINGS_ENDING.eyebrow}</p>
      <h2 id="st-end-title" ref={heading} tabIndex={-1}>{nudge.title}</h2>
      <p>{nudge.body}</p>
      {error && <p className="et-end__err" role="alert">{error}</p>}
      <div className="et-end__actions">
        <button type="button" className="et-primary" disabled={busy} onClick={() => void finish(true)}>{busy ? SETTINGS_ENDING.finishing : nudge.button}</button>
        <button type="button" disabled={busy} onClick={() => void finish(false)}>{SETTINGS_ENDING.notNow}</button>
        <button type="button" onClick={onBack}><ChevronLeft size={16} aria-hidden="true" />{SETTINGS_ENDING.previous}</button>
      </div>
      <p className="et-end__small">{SETTINGS_ENDING.rewardNote}</p>
    </div>
  </div>;
}
