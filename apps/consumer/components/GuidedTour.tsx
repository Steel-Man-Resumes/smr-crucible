"use client";

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useUserTier } from '@/lib/useUserTier';
import { useEffectiveRole } from '@/components/RoleProvider';
import { TOUR_VERSION, NEXT_STEP_CHANGED_EVENT, type TourState } from '@/lib/guidedTour';
import { TOUR_BEATS, TOUR_COPY } from '@/lib/tour/beats';
import { readTourReward, type TourReward } from '@/lib/tour/reward';
import { PROGRESSION_CHANGED_EVENT } from '@/lib/progression-ui';
import { TourPlayer, ENDING_INDEX } from './tour/TourPlayer';
import type { OrientationDraft } from './tour/OrientationQuiz';
import { lockPageForTour, leaveAction, safeTourDestination } from '@/lib/tour/page-lock';
import { isRetiredRun, retiredRun, runReplacedError, saveFailureAction, tourSaveFailure } from '@/lib/tour/run-conflict';
import { RunConflictNotice } from './tour/RunConflictNotice';
import './tour/entrance-tour.css';

type Write = { action: 'start' | 'progress' | 'complete'; version: number; runId: string; sequence: number; stop: number; previousRunId?: string | null };
type Saved = { ok: true; runId: string; sequence: number; reward?: unknown };
const FOCUSABLE = 'button:not(:disabled),a[href],input:not(:disabled),summary,[tabindex="0"]';
const PAUSE_KEY = 'guided-learning-paused:';

/** The shell mounts this. The tour belongs to signed-in clients only. */
export function GuidedTour(props: { held?: boolean; onNavigationReveal?: (open: boolean) => void }) {
  const tier = useUserTier();
  // Never under view-as or assist (T2): the route refuses the writes too.
  const impersonating = !!useEffectiveRole()?.impersonating;
  return <GuidedTourController tier={tier} {...props} held={!!props.held || impersonating} />;
}

/**
 * Loads the account's tour state, owns the run (UUID, sequence, compare-and-set
 * saves through one queue), traps focus and makes the shell inert while the
 * tour is open. It survives route changes; an unexpected route change pauses.
 */
export function GuidedTourController({ tier, held = false, onNavigationReveal }: { tier: string | null | undefined; held?: boolean; onNavigationReveal?: (open: boolean) => void }) {
  const allowed = useRef(false);
  allowed.current = tier === 'client' && !held;
  const pathname = usePathname();
  const search = useSearchParams();
  const router = useRouter();
  const requested = search?.get('tour') === '1';
  const [mounted, setMounted] = useState(false);
  const [state, setState] = useState<TourState | null>(null);
  const [active, setActive] = useState(false);
  const [start, setStart] = useState(0);
  const [error, setError] = useState('');
  const [saveError, setSaveError] = useState('');
  const [loading, setLoading] = useState(false);
  const [quizDraft, setQuizDraft] = useState<OrientationDraft>({ question: 0, answers: {} });
  const [notice, setNotice] = useState('');
  const [unsavedWarning, setUnsavedWarning] = useState(false);
  /** The run is open in another tab or window: the tour stopped and says so (lib/tour/run-conflict.ts). */
  const [conflict, setConflict] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const stateRef = useRef<TourState | null>(null);
  const beatRef = useRef(0);
  const savedChapter = useRef('');
  const alive = useRef(true);
  const requestController = useRef<AbortController | null>(null);
  const run = useRef({ id: '', sequence: 0, account: '' });
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const lastWrite = useRef<Write | null>(null);
  const pendingStart = useRef<Write | null>(null);
  const previousRequest = useRef('');
  const expectedRoute = useRef<string | null>(null);
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
    const body: Write = { action, version: TOUR_VERSION, runId: current.id, sequence: action === 'start' ? 0 : ++current.sequence, stop, ...(action === 'start' ? { previousRunId: stateRef.current?.previousRunId ?? stateRef.current?.runId ?? null } : {}) };
    lastWrite.current = body;
    if (action === 'start') pendingStart.current = body;
    const operation = queue.current.catch(() => {}).then(async () => {
      if (!alive.current || run.current.id !== body.runId || run.current.account !== current.account) throw runReplacedError();
      const send = async (write: Write): Promise<Saved> => {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10000);
        try {
          const response = await fetch('/api/onboarding/tour', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Orientation-Account': current.account }, body: JSON.stringify(write), signal: controller.signal, keepalive: true });
          const result = await response.json().catch(() => null);
          if (!response.ok || result?.ok !== true || result.runId !== write.runId || result.sequence !== write.sequence) throw tourSaveFailure(result?.error || 'Your place could not be saved.', response.ok ? null : response.status);
          return result as Saved;
        } finally { clearTimeout(timeout); }
      };
      if (pendingStart.current?.runId === body.runId && body.action !== 'start') {
        await send(pendingStart.current); pendingStart.current = null;
      }
      const result = await send(body);
      if (body.action === 'start' && pendingStart.current?.runId === body.runId) pendingStart.current = null;
      if (alive.current && run.current.id === body.runId) { setSaveError(''); if (action === 'complete') window.dispatchEvent(new Event(NEXT_STEP_CHANGED_EVENT)); }
      return result;
    });
    queue.current = operation;
    return operation;
  }, []);

  /**
   * The run was replaced (another tab or window, or the account changed): close the player,
   * which releases the page lock through the lock effect's cleanup (inert, scroll, focus), the
   * same path pause takes, but write nothing. The retired identity fails every queued write for
   * the old run before it is sent.
   */
  const stopForConflict = useCallback(() => {
    run.current = retiredRun(); pendingStart.current = null; lastWrite.current = null;
    requestController.current?.abort(); setLoading(false);
    expectedRoute.current = null; setActive(false); onNavigationReveal?.(false);
    setNotice(''); setError(''); setSaveError(''); setConflict(true);
  }, [onNavigationReveal]);

  const save = useCallback((action: Write['action'], stop: number) => {
    const identity = run.current;
    void persist(action, stop).catch(e => {
      const next = saveFailureAction(e, alive.current && run.current === identity && !isRetiredRun(identity));
      if (next === 'stop') stopForConflict();
      else if (next === 'warn') setSaveError(e instanceof Error && e.name !== 'AbortError' ? e.message : TOUR_COPY.saveFailed);
    });
  }, [persist, stopForConflict]);

  const enter = useCallback((data: TourState, resume: boolean) => {
    if (!allowed.current) return;
    if (dirty.current) { setUnsavedWarning(true); return; }
    // Saved progress from an older tour version never resumes into this one.
    const stop = resume && data.version === TOUR_VERSION && data.inProgress ? data.stop ?? 0 : 0;
    pendingStart.current = null;
    run.current = { id: resume && data.runId ? data.runId : crypto.randomUUID(), sequence: resume ? data.sequence ?? 0 : 0, account: data.accountId || '' };
    completed.current = false;
    beatRef.current = stop; savedChapter.current = chapterOf(stop); setStart(stop); setError(''); setNotice(''); setConflict(false); setActive(true);
    oldFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (data.accountId) { try { sessionStorage.removeItem(PAUSE_KEY + data.accountId); } catch {} }
    if (!(resume && data.runId)) save('start', stop);
  }, [save]);

  const load = useCallback(async (mode: 'auto' | 'replay' | 'resume') => {
    requestController.current?.abort(); const controller = new AbortController(); requestController.current = controller;
    setLoading(true); setError('');
    const timeout = setTimeout(() => controller.abort(), 10000);
    try {
      if (mode !== 'auto') await queue.current.catch(() => {});
      if (controller.signal.aborted) return;
      const response = await fetch('/api/onboarding/tour', { cache: 'no-store', signal: controller.signal });
      if (!response.ok) throw new Error('Your tour could not be loaded. Try again.');
      const body = await response.json();
      const data = body?.data as TourState;
      if (!data?.accountId) throw new Error('Sign in again to open your tour.');
      if (!alive.current || requestController.current !== controller) return;
      setState(data); stateRef.current = data;
      let paused = false; try { paused = sessionStorage.getItem(PAUSE_KEY + data.accountId) === '1'; } catch {}
      if (mode === 'replay' || mode === 'resume' || (!data.tourComplete && !paused && location.pathname === '/dashboard')) enter(data, mode !== 'replay' && !!data.inProgress);
      else if (data.inProgress) setNotice(TOUR_COPY.paused);
    } catch (e) {
      if (alive.current && requestController.current === controller) setError(e instanceof Error && e.name !== 'AbortError' ? e.message : 'The tour is taking too long to load. Try again.');
    } finally { clearTimeout(timeout); if (alive.current && requestController.current === controller) setLoading(false); }
  }, [enter]);

  useEffect(() => {
    if (tier !== 'client' || held) return;
    const key = requested ? `${pathname}?tour=1` : 'initial';
    if (previousRequest.current === key || (active && !requested)) return;
    if (!requested && previousRequest.current) return;
    previousRequest.current = key;
    void load(requested ? 'replay' : 'auto');
  }, [tier, held, requested, pathname, active, load]);

  const pause = useCallback(() => {
    // After a confirmed finish, leaving is closing: nothing is paused and nothing restarts.
    if (leaveAction(completed.current) === 'close') { setActive(false); onNavigationReveal?.(false); setNotice(''); setSaveError(''); return; }
    requestController.current?.abort(); setLoading(false);
    expectedRoute.current = null; setActive(false); onNavigationReveal?.(false);
    if (run.current.account) { try { sessionStorage.setItem(PAUSE_KEY + run.current.account, '1'); } catch {} }
    setNotice(TOUR_COPY.paused);
    save('progress', Math.min(beatRef.current, ENDING_INDEX));
  }, [save, onNavigationReveal]);

  useEffect(() => {
    if (previousRoute.current === pathname) return;
    previousRoute.current = pathname;
    if (!active) return;
    if (expectedRoute.current === pathname) { expectedRoute.current = null; return; }
    // Browser Back or an unrelated route change never silently advances the tour.
    pause();
  }, [pathname, active, pause]);
  useEffect(() => { if ((held || tier !== 'client') && active) pause(); }, [held, tier, active, pause]);

  /* While open: the shell is inert, focus stays in the tour, Escape leaves and keeps the place. */
  useEffect(() => {
    if (!active || held || tier !== 'client') return;
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
  }, [active, held, tier, pause]);

  /* Progress is saved by beat index at each chapter boundary, and on pause. */
  const onBeat = useCallback((index: number) => {
    beatRef.current = index;
    const chapter = chapterOf(index);
    if (chapter === savedChapter.current) return;
    savedChapter.current = chapter;
    if (index < ENDING_INDEX) save('progress', index);
    else save('progress', ENDING_INDEX);
  }, [save]);

  const finish = useCallback(async (): Promise<TourReward> => {
    const identity = run.current;
    try {
      const result = await persist('complete', ENDING_INDEX);
      completed.current = true;
      if (stateRef.current) { stateRef.current = { ...stateRef.current, tourComplete: true, inProgress: false }; setState(stateRef.current); }
      const reward = readTourReward(result.reward);
      if (reward.status === 'granted') window.dispatchEvent(new Event(PROGRESSION_CHANGED_EVENT));
      return reward;
    } catch (e) {
      const next = saveFailureAction(e, alive.current && run.current === identity && !isRetiredRun(identity));
      if (next === 'stop') stopForConflict();
      else if (next === 'warn') setSaveError(e instanceof Error ? e.message : 'Your finish could not be confirmed. Retry safely.');
      throw e instanceof Error ? e : new Error('Your finish could not be confirmed. Retry safely.');
    }
  }, [persist, stopForConflict]);

  const done = useCallback((destination?: string) => {
    setActive(false); onNavigationReveal?.(false); setNotice(''); setSaveError('');
    const href = safeTourDestination(destination);
    if (href && href !== location.pathname) { expectedRoute.current = href.split(/[?#]/)[0]; router.push(href); }
  }, [router, onNavigationReveal]);

  const retrySave = useCallback(() => {
    const w = lastWrite.current;
    if (!w || w.action === 'complete') return;
    save(w.action === 'start' ? 'start' : 'progress', beatRef.current);
  }, [save]);

  if (!mounted || tier !== 'client' || held) return null;
  if (!active) return <>
    {conflict && <RunConflictNotice onDismiss={() => setConflict(false)} />}
    {unsavedWarning && <div className="et-notice" role="status"><p>{TOUR_COPY.unsaved}</p><button onClick={() => { dirty.current = false; setUnsavedWarning(false); void load('replay'); }}>{TOUR_COPY.unsavedConfirm}</button><button onClick={() => setUnsavedWarning(false)}>{TOUR_COPY.unsavedStay}</button></div>}
    {!conflict && (notice || error || saveError) && <div className="et-notice" role="status"><p>{saveError || error || notice}</p><button disabled={loading} onClick={() => void load(state?.inProgress || notice ? 'resume' : 'replay')}>{loading ? TOUR_COPY.loading : TOUR_COPY.resume}</button><button onClick={() => { setNotice(''); setError(''); setSaveError(''); }}>{TOUR_COPY.dismiss}</button></div>}
  </>;
  return createPortal(<div ref={root}>
    <TourPlayer key={run.current.id} start={start} accountId={state?.accountId ?? ''} forgeComplete={state?.forgeComplete} rewardClaimedAt={state?.rewardClaimedAt} nextStep={state?.nextStep}
      quizDraft={quizDraft} onQuizDraft={setQuizDraft} onBeat={onBeat} onLeave={pause} onFinish={finish} onDone={done}
      onNavigationReveal={onNavigationReveal} saveError={saveError} onRetrySave={lastWrite.current?.action === 'complete' ? undefined : retrySave} />
  </div>, document.body);
}

function chapterOf(index: number): string {
  return TOUR_BEATS[index]?.chapter ?? 'end';
}
