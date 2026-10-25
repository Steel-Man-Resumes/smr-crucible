"use client";
/**
 * The Settings tour's controller (SETTINGS-TOUR.md). The Settings page mounts
 * it for signed-in clients who are not organization staff; it renders the chip
 * at the top of Settings ("New here?" or "Pick up where you left off") and,
 * while the tour plays, the player in a portal over the page.
 *
 * It owns the run the same way the entrance tour's controller does
 * (components/GuidedTour.tsx): one UUID run, a rising sequence, compare-and-set
 * saves through one queue, the page inert and focus trapped while open, Escape
 * leaves and keeps the place. Its slot is preferences.tours.settings
 * (lib/tour/registry.ts), so the entrance tour's place is never touched.
 *
 * Branches are resolved once before the first card from the reads the page
 * already makes (/api/sharing, /api/coach/settings). The saved stop is the
 * beat's absolute index, never its place in the shortened path.
 *
 * Never under view-as or assist: the chip does not show, ?tour=settings does
 * nothing, and the route refuses the writes (lib/settings-guard.ts rule).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useUserTier } from '@/lib/useUserTier';
import { useEffectiveRole } from '@/components/RoleProvider';
import { TOUR_COPY } from '@/lib/tour/beats';
import { TOURS, type TourSlot } from '@/lib/tour/registry';
import { readTourReward, type TourReward } from '@/lib/tour/reward';
import { PROGRESSION_CHANGED_EVENT } from '@/lib/progression-ui';
import { lockPageForTour, leaveAction } from '@/lib/tour/page-lock';
import { SETTINGS_NUDGES, SETTINGS_TOUR_COPY, type SettingsBeat, type SettingsNudge } from '@/lib/tour/settings-beats';
import { SETTINGS_ENDING_STOP, SETTINGS_TOUR_OPEN_EVENT, applicableBeats, pickNudge, readBranches, resumeIndex, settingsTourAllowed, settingsTourRequested, stopOfBeat } from '@/lib/tour/settings-tour';
import { findNavElement } from './TourPlayer';
import { SettingsTourPlayer, scrollToTarget } from './SettingsTourPlayer';
import './entrance-tour.css';

type Write = { tourId: 'settings'; action: 'start' | 'progress' | 'complete'; version: number; runId: string; sequence: number; stop: number; previousRunId?: string | null };
type Saved = { ok: true; runId: string; sequence: number; reward?: unknown };
type Slot = TourSlot & { accountId: string; impersonating?: boolean; previousRunId?: string | null };
const FOCUSABLE = 'button:not(:disabled),a[href],input:not(:disabled),summary,[tabindex="0"]';
const PAUSE_KEY = 'settings-tour-paused:';
const DEF = TOURS.settings;
/** The chip sits in the page flow at the top of Settings, not in the fixed corner the notices use. */
const CHIP = { position: 'static', marginBottom: 16, maxWidth: 'none' } as const;

/** The page header's quiet control asks the controller to open the tour (resume if one is open, else from the start). */
export function openSettingsTour() {
  window.dispatchEvent(new Event(SETTINGS_TOUR_OPEN_EVENT));
}

export function SettingsTour() {
  const tier = useUserTier();
  const role = useEffectiveRole();
  const allowed = settingsTourAllowed({ tier, orgRole: role?.orgRole, impersonating: role?.impersonating });
  const allowedRef = useRef(false);
  allowedRef.current = allowed;
  const pathname = usePathname();
  const search = useSearchParams();
  const router = useRouter();
  const requested = settingsTourRequested(pathname, search);
  const [mounted, setMounted] = useState(false);
  const [slot, setSlot] = useState<Slot | null>(null);
  const [active, setActive] = useState(false);
  const [path, setPath] = useState<readonly SettingsBeat[]>([]);
  const [nudge, setNudge] = useState<SettingsNudge>(SETTINGS_NUDGES.plain);
  const [start, setStart] = useState(0);
  const [error, setError] = useState('');
  const [saveError, setSaveError] = useState('');
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState('');
  const [unsavedWarning, setUnsavedWarning] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const slotRef = useRef<Slot | null>(null);
  const pathRef = useRef<readonly SettingsBeat[]>([]);
  const stopRef = useRef(0);
  const savedStop = useRef(-1);
  const alive = useRef(true);
  const requestController = useRef<AbortController | null>(null);
  const run = useRef({ id: '', sequence: 0, account: '' });
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const lastWrite = useRef<Write | null>(null);
  const pendingStart = useRef<Write | null>(null);
  const previousRequest = useRef('');
  const previousRoute = useRef(pathname);
  const dirty = useRef(false);
  const oldFocus = useRef<HTMLElement | null>(null);
  const completed = useRef(false);

  useEffect(() => {
    alive.current = true; setMounted(true);
    const changed = (event: Event) => {
      if (!document.documentElement.dataset.guidedLearning && event.target instanceof HTMLElement && event.target.closest('input,textarea,select,[contenteditable="true"]')) dirty.current = true;
    };
    document.addEventListener('input', changed, true); document.addEventListener('change', changed, true);
    return () => {
      alive.current = false; requestController.current?.abort();
      document.removeEventListener('input', changed, true); document.removeEventListener('change', changed, true);
    };
  }, []);

  const persist = useCallback((action: Write['action'], stop: number): Promise<Saved> => {
    const current = run.current;
    if (!current.account || !current.id) return Promise.reject(new Error('Your saved place is unavailable. Reload to reconnect.'));
    const body: Write = { tourId: 'settings', action, version: DEF.version, runId: current.id, sequence: action === 'start' ? 0 : ++current.sequence, stop, ...(action === 'start' ? { previousRunId: slotRef.current?.previousRunId ?? slotRef.current?.runId ?? null } : {}) };
    lastWrite.current = body;
    if (action === 'start') pendingStart.current = body;
    const operation = queue.current.catch(() => {}).then(async () => {
      if (!alive.current || run.current.id !== body.runId || run.current.account !== current.account) throw new Error('This tour was replaced by a newer run.');
      const send = async (write: Write): Promise<Saved> => {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10000);
        try {
          const response = await fetch('/api/onboarding/tour', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Orientation-Account': current.account }, body: JSON.stringify(write), signal: controller.signal, keepalive: true });
          const result = await response.json().catch(() => null);
          if (!response.ok || result?.ok !== true || result.runId !== write.runId || result.sequence !== write.sequence) throw new Error(result?.error || 'Your place could not be saved.');
          return result as Saved;
        } finally { clearTimeout(timeout); }
      };
      if (pendingStart.current?.runId === body.runId && body.action !== 'start') {
        await send(pendingStart.current); pendingStart.current = null;
      }
      const result = await send(body);
      if (body.action === 'start' && pendingStart.current?.runId === body.runId) pendingStart.current = null;
      if (alive.current && run.current.id === body.runId) setSaveError('');
      return result;
    });
    queue.current = operation;
    return operation;
  }, []);

  const save = useCallback((action: Write['action'], stop: number) => {
    const identity = run.current;
    void persist(action, stop).catch(e => { if (alive.current && run.current === identity) setSaveError(e instanceof Error && e.name !== 'AbortError' ? e.message : TOUR_COPY.saveFailed); });
  }, [persist]);

  const enter = useCallback((data: Slot, beats: readonly SettingsBeat[], resume: boolean) => {
    if (!allowedRef.current) return;
    if (dirty.current) { setUnsavedWarning(true); return; }
    // Saved progress from an older tour version never resumes into this one.
    const resuming = resume && data.version === DEF.version && data.inProgress === true && !!data.runId;
    const index = resuming ? resumeIndex(data.stop, beats) : 0;
    pendingStart.current = null;
    run.current = { id: resuming ? data.runId! : crypto.randomUUID(), sequence: resuming ? data.sequence ?? 0 : 0, account: data.accountId };
    completed.current = false;
    const stop = index < beats.length ? stopOfBeat(beats[index]) : SETTINGS_ENDING_STOP;
    stopRef.current = stop; savedStop.current = stop;
    setPath(beats); pathRef.current = beats; setStart(index); setError(''); setNotice(''); setActive(true);
    oldFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    try { sessionStorage.removeItem(PAUSE_KEY + data.accountId); } catch {}
    if (!resuming) save('start', stop);
  }, [save]);

  /** The saved place, and (when opening) the branches, read once. */
  const load = useCallback(async (mode: 'chip' | 'open' | 'replay') => {
    requestController.current?.abort(); const controller = new AbortController(); requestController.current = controller;
    setLoading(true); setError('');
    const timeout = setTimeout(() => controller.abort(), 10000);
    try {
      if (mode !== 'chip') await queue.current.catch(() => {});
      if (controller.signal.aborted) return;
      const response = await fetch('/api/onboarding/tour?tourId=settings', { cache: 'no-store', signal: controller.signal });
      if (!response.ok) throw new Error('Your tour could not be loaded. Try again.');
      const data = (await response.json())?.data as Slot;
      if (!data?.accountId) throw new Error('Sign in again to open your tour.');
      if (!alive.current || requestController.current !== controller) return;
      setSlot(data); slotRef.current = data;
      if (mode === 'chip' || data.impersonating) return;
      // Branches, resolved once before the first card. A failed read is the plain path.
      const [sharing, coach] = await Promise.all([
        fetch('/api/sharing', { cache: 'no-store', signal: controller.signal }).then(r => r.ok ? r.json() : null).catch(() => null),
        fetch('/api/coach/settings', { cache: 'no-store', signal: controller.signal }).then(r => r.ok ? r.json() : null).catch(() => null),
      ]);
      if (!alive.current || requestController.current !== controller) return;
      const branches = readBranches(sharing, coach);
      setNudge(pickNudge(branches));
      enter(data, applicableBeats(branches), mode === 'open' && !!data.inProgress);
    } catch (e) {
      if (alive.current && requestController.current === controller) setError(e instanceof Error && e.name !== 'AbortError' ? e.message : 'The tour is taking too long to load. Try again.');
    } finally { clearTimeout(timeout); if (alive.current && requestController.current === controller) setLoading(false); }
  }, [enter]);

  /* The chip's state on arrival; ?tour=settings opens the tour (resume if one is open). */
  useEffect(() => {
    if (!allowed) return;
    const key = requested ? `${pathname}?tour=settings` : 'initial';
    if (previousRequest.current === key || (active && !requested)) return;
    if (!requested && previousRequest.current) return;
    previousRequest.current = key;
    void load(requested ? 'open' : 'chip');
  }, [allowed, requested, pathname, active, load]);

  /* The header's "Show me around" control. */
  useEffect(() => {
    if (!allowed) return;
    const open = () => { if (!active) void load('open'); };
    window.addEventListener(SETTINGS_TOUR_OPEN_EVENT, open);
    return () => window.removeEventListener(SETTINGS_TOUR_OPEN_EVENT, open);
  }, [allowed, active, load]);

  const pause = useCallback(() => {
    if (leaveAction(completed.current) === 'close') { setActive(false); setNotice(''); setSaveError(''); return; }
    requestController.current?.abort(); setLoading(false);
    setActive(false);
    if (run.current.account) { try { sessionStorage.setItem(PAUSE_KEY + run.current.account, '1'); } catch {} }
    setNotice(SETTINGS_TOUR_COPY.paused);
    if (slotRef.current) { slotRef.current = { ...slotRef.current, inProgress: true, version: DEF.version, runId: run.current.id, stop: stopRef.current }; setSlot(slotRef.current); }
    save('progress', stopRef.current);
  }, [save]);

  useEffect(() => {
    if (previousRoute.current === pathname) return;
    previousRoute.current = pathname;
    if (active) pause();
  }, [pathname, active, pause]);
  useEffect(() => { if (!allowed && active) pause(); }, [allowed, active, pause]);

  /* Closing the tab or leaving the page saves the exact stop (the write is keepalive). */
  useEffect(() => {
    if (!active) return;
    const hide = () => { if (savedStop.current !== stopRef.current) save('progress', stopRef.current); };
    window.addEventListener('pagehide', hide);
    return () => window.removeEventListener('pagehide', hide);
  }, [active, save]);

  /* While open: the shell is inert, focus stays in the tour, Escape leaves and keeps the place. */
  useEffect(() => {
    if (!active || !allowed) return;
    const unlock = lockPageForTour(document.documentElement, document.body, document.querySelector<HTMLElement>('.refinery-app'));
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); pause(); return; }
      if (event.key !== 'Tab') return;
      const items = Array.from(root.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []).filter(item => item.getClientRects().length && !item.closest('[hidden],[aria-hidden="true"]'));
      const first = items[0], last = items.at(-1);
      if (!first || !last) { event.preventDefault(); return; }
      if (event.shiftKey && (document.activeElement === first || !root.current?.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || !root.current?.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKey);
    return () => { unlock(); document.removeEventListener('keydown', onKey); if (oldFocus.current?.isConnected) oldFocus.current.focus({ preventScroll: true }); };
  }, [active, allowed, pause]);

  /* The place is saved as the beat's absolute index, at every stop the person reaches. */
  const onBeat = useCallback((index: number) => {
    const beats = pathRef.current;
    const stop = index < beats.length ? stopOfBeat(beats[index]) : SETTINGS_ENDING_STOP;
    stopRef.current = stop;
    if (stop === savedStop.current) return;
    savedStop.current = stop;
    save('progress', stop);
  }, [save]);

  const finish = useCallback(async (): Promise<TourReward> => {
    const identity = run.current;
    try {
      const result = await persist('complete', SETTINGS_ENDING_STOP);
      completed.current = true;
      if (slotRef.current) { slotRef.current = { ...slotRef.current, inProgress: false, completedAt: new Date().toISOString() }; setSlot(slotRef.current); }
      const reward = readTourReward(result.reward);
      if (reward.status === 'granted') window.dispatchEvent(new Event(PROGRESSION_CHANGED_EVENT));
      return reward;
    } catch (e) {
      if (alive.current && run.current === identity) setSaveError(e instanceof Error ? e.message : 'Your finish could not be confirmed. Retry safely.');
      throw e instanceof Error ? e : new Error('Your finish could not be confirmed. Retry safely.');
    }
  }, [persist]);

  /** Close; with targets, land the page on the control the nudge named. The tour never presses it. */
  const done = useCallback((targets?: readonly string[]) => {
    setActive(false); setNotice(''); setSaveError('');
    if (requested) router.replace(pathname ?? '/dashboard/settings');
    if (!targets) return;
    requestAnimationFrame(() => {
      const el = findNavElement(targets);
      if (!el) return;
      scrollToTarget(el);
      if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '-1');
      el.focus({ preventScroll: true });
    });
  }, [requested, router, pathname]);

  const retrySave = useCallback(() => {
    const w = lastWrite.current;
    if (!w || w.action === 'complete') return;
    save(w.action === 'start' ? 'start' : 'progress', stopRef.current);
  }, [save]);

  if (!mounted || !allowed) return null;
  if (!active) {
    const open = !!slot && slot.version === DEF.version && slot.inProgress === true;
    const fresh = !!slot && !slot.impersonating && !open && !slot.completedAt;
    return <>
      {open && !notice && !error && <div className="et-notice" style={CHIP} role="status" data-tour-chip="resume"><p>{SETTINGS_TOUR_COPY.chipResume}</p><button type="button" disabled={loading} onClick={() => void load('open')}>{loading ? TOUR_COPY.loading : SETTINGS_TOUR_COPY.pickUp}</button><button type="button" disabled={loading} onClick={() => void load('replay')}>{SETTINGS_TOUR_COPY.startOver}</button></div>}
      {fresh && !notice && !error && <div className="et-notice" style={CHIP} role="status" data-tour-chip="new"><p>{SETTINGS_TOUR_COPY.chipNew}</p><button type="button" disabled={loading} onClick={() => void load('replay')}>{loading ? TOUR_COPY.loading : SETTINGS_TOUR_COPY.showMe}</button></div>}
      {unsavedWarning && <div className="et-notice" role="status"><p>{TOUR_COPY.unsaved}</p><button type="button" onClick={() => { dirty.current = false; setUnsavedWarning(false); void load('open'); }}>{TOUR_COPY.unsavedConfirm}</button><button type="button" onClick={() => setUnsavedWarning(false)}>{TOUR_COPY.unsavedStay}</button></div>}
      {(notice || error || saveError) && <div className="et-notice" role="status"><p>{saveError || error || notice}</p><button type="button" disabled={loading} onClick={() => void load('open')}>{loading ? TOUR_COPY.loading : TOUR_COPY.resume}</button><button type="button" onClick={() => { setNotice(''); setError(''); setSaveError(''); }}>{TOUR_COPY.dismiss}</button></div>}
    </>;
  }
  return createPortal(<div ref={root}>
    <SettingsTourPlayer key={run.current.id} beats={path} start={start} accountId={slot?.accountId ?? ''} nudge={nudge}
      onBeat={onBeat} onLeave={pause} onFinish={finish} onDone={done} saveError={saveError} onRetrySave={lastWrite.current?.action === 'complete' ? undefined : retrySave} />
  </div>, document.body);
}
