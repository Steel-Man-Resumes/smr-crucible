"use client";
/**
 * The CRM staff tour's controller (CRM-TOUR.md). Mounted by the shell for
 * organization staff in a workspace organization (lib/tour/staff-tour.ts
 * staffTourAllowed); it renders nothing for anyone else.
 *
 * Like the entrance tour's controller (components/GuidedTour.tsx): it loads the
 * account's saved place for tour 'crm' (one slot, lib/tour/registry.ts), owns
 * the run (UUID, rising sequence, compare-and-set saves through one queue),
 * traps focus and makes the shell inert while the tour is open, and pauses on
 * a route change it did not ask for. Unlike it, the tour moves between pages
 * on purpose (Today, one person, Referrals, People, Insights, Team): the player asks, the controller
 * pushes the route and expects it.
 *
 * The person for the participant stops is a real one from the staff member's
 * own list: the first person row Today drew, or the first row of the caseload
 * read the People page makes. Nothing here reads or opens a shared item.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffectiveRole } from '@/components/RoleProvider';
import { StaffTourPlayer } from './StaffTourPlayer';
import { TOURS } from '@/lib/tour/registry';
import { CRM_ENDING_INDEX, CRM_TOUR_COPY, applicableBeats, onBeatPage, resumeStop, stopForBeat, type CrmBeat } from '@/lib/tour/crm-beats';
import { STAFF_TOUR_HOME, STAFF_TOUR_OPEN_EVENT, firstPersonFromCohort, isDemoOrg, personIdFromRow, staffTourAllowed, staffTourRequested } from '@/lib/tour/staff-tour';
import { lockPageForTour, leaveAction } from '@/lib/tour/page-lock';
import { isRetiredRun, retiredRun, runReplacedError, saveFailureAction, tourSaveFailure } from '@/lib/tour/run-conflict';
import { RunConflictNotice } from './RunConflictNotice';
import { useOrgModules } from '@/lib/use-org-modules';
import './entrance-tour.css';

const DEF = TOURS.crm;
type Write = { tourId: 'crm'; action: 'start' | 'progress' | 'complete'; version: number; runId: string; sequence: number; stop: number; previousRunId?: string | null };
type Saved = { ok: true; runId: string; sequence: number };
interface Slot { accountId: string; impersonating?: boolean; version?: number; inProgress?: boolean; stop?: number; runId?: string; previousRunId?: string | null; sequence?: number }
const FOCUSABLE = 'button:not(:disabled),a[href],input:not(:disabled),summary,[tabindex="0"]';
/** How long to wait for Today to draw its first person row before reading the caseload instead. */
const ROW_WAIT_MS = 2500;

export function StaffTour({ onNavigationReveal }: { onNavigationReveal?: (open: boolean) => void }) {
  const role = useEffectiveRole();
  const allowed = staffTourAllowed(role);
  if (!allowed || !role) return null;
  return <StaffTourController key={role.accountId} capabilities={role.capabilities ?? []} demo={isDemoOrg(role.orgName)} onNavigationReveal={onNavigationReveal} />;
}

/** Today's first person row, if the page has drawn one (no request). */
async function personFromToday(signal: AbortSignal): Promise<string | null> {
  if (location.pathname !== STAFF_TOUR_HOME) return null;
  const began = performance.now();
  while (!signal.aborted && performance.now() - began < ROW_WAIT_MS) {
    const row = document.querySelector<HTMLElement>('[data-tour="crm-today-first-row"]');
    if (row) return personIdFromRow(row.dataset.clientId);
    if (!document.querySelector('[aria-busy="true"]')) return null;
    await new Promise(r => setTimeout(r, 120));
  }
  return null;
}

export function StaffTourController({ capabilities, demo, onNavigationReveal }: { capabilities: readonly string[]; demo: boolean; onNavigationReveal?: (open: boolean) => void }) {
  const pathname = usePathname();
  const search = useSearchParams();
  const router = useRouter();
  const requested = staffTourRequested(pathname, search);
  // A switched-off module drops its stop (referrals), the way it leaves the nav.
  const modules = useOrgModules(true);
  const [mounted, setMounted] = useState(false);
  const [active, setActive] = useState(false);
  const [beats, setBeats] = useState<CrmBeat[]>([]);
  const [personId, setPersonId] = useState<string | null>(null);
  const [start, setStart] = useState(0);
  const [accountId, setAccountId] = useState('');
  const [error, setError] = useState('');
  const [saveError, setSaveError] = useState('');
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState('');
  const [unsavedWarning, setUnsavedWarning] = useState(false);
  /** The run is open in another tab or window: the tour stopped and says so (lib/tour/run-conflict.ts). */
  const [conflict, setConflict] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const slotRef = useRef<Slot | null>(null);
  const beatsRef = useRef<CrmBeat[]>([]);
  const beatRef = useRef(0);
  const savedGroup = useRef('');
  const alive = useRef(true);
  const requestController = useRef<AbortController | null>(null);
  const run = useRef({ id: '', sequence: 0, account: '' });
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const lastWrite = useRef<Write | null>(null);
  const pendingStart = useRef<Write | null>(null);
  const previousRequest = useRef('');
  /** The href the tour itself asked for; any other change of pathname or search pauses the tour. */
  const expectedHref = useRef<string | null>(null);
  const previousLocation = useRef('');
  const dirty = useRef(false);
  const oldFocus = useRef<HTMLElement | null>(null);
  const completed = useRef(false);
  /** The person and path chosen for the current run in this mount, so a resume keeps them (review SF-8). */
  const chosen = useRef<{ runId: string; person: string | null; list: typeof beatsRef.current } | null>(null);

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

  /** The saved stop for a resolved beat index: the beat's place in the full list, or the ending. */
  const canonical = (index: number) => index >= beatsRef.current.length ? CRM_ENDING_INDEX : stopForBeat(beatsRef.current[index].id);

  const persist = useCallback((action: Write['action'], stop: number): Promise<Saved> => {
    const current = run.current;
    if (!current.account || !current.id) return Promise.reject(new Error('Your saved place is unavailable. Reload to reconnect.'));
    const body: Write = { tourId: 'crm', action, version: DEF.version, runId: current.id, sequence: action === 'start' ? 0 : ++current.sequence, stop, ...(action === 'start' ? { previousRunId: slotRef.current?.previousRunId ?? slotRef.current?.runId ?? null } : {}) };
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
      if (pendingStart.current?.runId === body.runId && body.action !== 'start') { await send(pendingStart.current); pendingStart.current = null; }
      const result = await send(body);
      if (body.action === 'start' && pendingStart.current?.runId === body.runId) pendingStart.current = null;
      if (alive.current && run.current.id === body.runId) setSaveError('');
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
    expectedHref.current = null; setActive(false); onNavigationReveal?.(false);
    setNotice(''); setError(''); setSaveError(''); setConflict(true);
  }, [onNavigationReveal]);

  const save = useCallback((action: Write['action'], stop: number) => {
    const identity = run.current;
    void persist(action, stop).catch(e => {
      const next = saveFailureAction(e, alive.current && run.current === identity && !isRetiredRun(identity));
      if (next === 'stop') stopForConflict();
      else if (next === 'warn') setSaveError(e instanceof Error && e.name !== 'AbortError' ? e.message : CRM_TOUR_COPY.saveFailed);
    });
  }, [persist, stopForConflict]);

  const enter = useCallback(async (slot: Slot, resume: boolean, signal: AbortSignal) => {
    if (dirty.current) { setUnsavedWarning(true); return; }
    // The person and the path are decided once per run, before the first card. Resuming the
    // same run in this mount keeps them, so "pick it back up" never lands on someone else (review SF-8).
    const same = resume && !!slot.runId && chosen.current?.runId === slot.runId ? chosen.current : null;
    let person: string | null = same ? same.person : await personFromToday(signal);
    const todayRow = !!person;
    if (!same && !person && !signal.aborted) {
      try {
        const res = await fetch('/api/partner/org', { cache: 'no-store', signal });
        if (res.ok) person = firstPersonFromCohort(await res.json());
      } catch { person = null; }
    }
    if (signal.aborted || !alive.current) return;
    const list = same ? same.list : applicableBeats({ personId: person, todayRow, capabilities, modules });
    beatsRef.current = list; setBeats(list); setPersonId(person);
    // Saved progress from an older version never resumes into this one. The
    // place is a beat id (through its index in the full list), never a position in the path.
    const at = resume && slot.version === DEF.version && slot.inProgress ? resumeStop(slot.stop, list) : 0;
    pendingStart.current = null;
    run.current = { id: resume && slot.runId ? slot.runId : crypto.randomUUID(), sequence: resume ? slot.sequence ?? 0 : 0, account: slot.accountId };
    chosen.current = { runId: run.current.id, person, list };
    completed.current = false;
    beatRef.current = at; savedGroup.current = groupOf(list, at); setStart(at); setAccountId(slot.accountId); setError(''); setNotice(''); setConflict(false); setActive(true);
    oldFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!(resume && slot.runId)) save('start', canonical(at));
  }, [capabilities, modules, save]);

  const load = useCallback(async (mode: 'auto' | 'replay' | 'resume') => {
    requestController.current?.abort(); const controller = new AbortController(); requestController.current = controller;
    setLoading(true); setError('');
    const timeout = setTimeout(() => controller.abort(), 10000);
    try {
      if (mode !== 'auto') await queue.current.catch(() => {});
      if (controller.signal.aborted) return;
      const response = await fetch('/api/onboarding/tour?tourId=crm', { cache: 'no-store', signal: controller.signal });
      if (!response.ok) throw new Error('Your tour could not be loaded. Try again.');
      const body = await response.json();
      const slot = body?.data as Slot;
      if (!slot?.accountId) throw new Error('Sign in again to open your tour.');
      if (!alive.current || requestController.current !== controller) return;
      if (slot.impersonating) { setError(CRM_TOUR_COPY.impersonating); return; }
      slotRef.current = slot;
      if (mode === 'replay' || mode === 'resume') await enter(slot, mode === 'resume' && !!slot.inProgress, controller.signal);
      // An open run is offered whenever Today loads (the entrance tour's rule: no session flag hides it).
      else if (slot.inProgress && location.pathname === STAFF_TOUR_HOME) setNotice(CRM_TOUR_COPY.paused);
    } catch (e) {
      if (alive.current && requestController.current === controller) setError(e instanceof Error && e.name !== 'AbortError' ? e.message : 'The tour is taking too long to load. Try again.');
    } finally { clearTimeout(timeout); if (alive.current && requestController.current === controller) setLoading(false); }
  }, [enter]);

  /* Entry: ?tour=crm on Today, the "Show me around" control, and a quiet offer to pick up an open run. */
  useEffect(() => {
    const key = requested ? `${pathname}?tour=crm` : 'initial';
    if (previousRequest.current === key || (active && !requested)) return;
    if (!requested && previousRequest.current) return;
    previousRequest.current = key;
    void load(requested ? 'replay' : 'auto');
  }, [requested, pathname, active, load]);
  useEffect(() => {
    // Show me around picks an open run back up at its saved beat; a finished or absent run starts fresh.
    const open = () => { if (!active) void load('resume'); };
    window.addEventListener(STAFF_TOUR_OPEN_EVENT, open);
    return () => window.removeEventListener(STAFF_TOUR_OPEN_EVENT, open);
  }, [active, load]);

  const pause = useCallback(() => {
    if (leaveAction(completed.current) === 'close') { setActive(false); onNavigationReveal?.(false); setNotice(''); setSaveError(''); return; }
    requestController.current?.abort(); setLoading(false);
    expectedHref.current = null; setActive(false); onNavigationReveal?.(false);
    setNotice(CRM_TOUR_COPY.paused);
    save('progress', canonical(beatRef.current));
  }, [save, onNavigationReveal]);

  /* Routes: the tour moves between pages on purpose; any other change of pathname or search (Browser Back inside the person page) pauses it. */
  const locationNow = `${pathname}${search?.toString() ? `?${search.toString()}` : ''}`;
  const navigate = useCallback((href: string) => {
    expectedHref.current = href;
    router.push(href);
  }, [router]);
  useEffect(() => {
    if (previousLocation.current === locationNow) return;
    const first = previousLocation.current === '';
    previousLocation.current = locationNow;
    if (!active || first) return;
    if (expectedHref.current && onBeatPage(locationNow, expectedHref.current)) { expectedHref.current = null; return; }
    pause();
  }, [locationNow, active, pause]);

  /* While open: the shell is inert, focus stays in the tour, Escape leaves and keeps the place. */
  useEffect(() => {
    if (!active) return;
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
  }, [active, pause]);

  /* The place is saved by beat at each group boundary (Today, one person, Insights, privacy), and on pause. */
  const onBeat = useCallback((index: number) => {
    beatRef.current = index;
    const group = groupOf(beatsRef.current, index);
    if (group === savedGroup.current) return;
    savedGroup.current = group;
    save('progress', canonical(index));
  }, [save]);

  const finish = useCallback(async (): Promise<void> => {
    const identity = run.current;
    try {
      await persist('complete', CRM_ENDING_INDEX);
      completed.current = true;
      if (slotRef.current) slotRef.current = { ...slotRef.current, inProgress: false };
    } catch (e) {
      const next = saveFailureAction(e, alive.current && run.current === identity && !isRetiredRun(identity));
      if (next === 'stop') stopForConflict();
      else if (next === 'warn') setSaveError(e instanceof Error ? e.message : 'Your finish could not be confirmed. Retry safely.');
      throw e instanceof Error ? e : new Error('Your finish could not be confirmed. Retry safely.');
    }
  }, [persist, stopForConflict]);

  const done = useCallback(() => {
    setActive(false); onNavigationReveal?.(false); setNotice(''); setSaveError('');
    if (location.pathname !== STAFF_TOUR_HOME) { expectedHref.current = STAFF_TOUR_HOME; router.push(STAFF_TOUR_HOME); }
  }, [router, onNavigationReveal]);

  const retrySave = useCallback(() => {
    const w = lastWrite.current;
    if (!w || w.action === 'complete') return;
    save(w.action === 'start' ? 'start' : 'progress', canonical(beatRef.current));
  }, [save]);

  if (!mounted) return null;
  if (!active) return <>
    {conflict && <RunConflictNotice onDismiss={() => setConflict(false)} />}
    {unsavedWarning && <div className="et-notice" role="status"><p>{CRM_TOUR_COPY.unsaved}</p><button onClick={() => { dirty.current = false; setUnsavedWarning(false); void load('replay'); }}>{CRM_TOUR_COPY.unsavedConfirm}</button><button onClick={() => setUnsavedWarning(false)}>{CRM_TOUR_COPY.unsavedStay}</button></div>}
    {!conflict && (notice || error || saveError) && <div className="et-notice" role="status"><p>{saveError || error || notice}</p>
      <button disabled={loading} onClick={() => void load(slotRef.current?.inProgress || notice ? 'resume' : 'replay')}>{loading ? CRM_TOUR_COPY.loading : CRM_TOUR_COPY.resume}</button>
      {notice && <button disabled={loading} onClick={() => void load('replay')}>{CRM_TOUR_COPY.startOver}</button>}
      <button onClick={() => { setNotice(''); setError(''); setSaveError(''); }}>{CRM_TOUR_COPY.dismiss}</button></div>}
  </>;
  return createPortal(<div ref={root}>
    <StaffTourPlayer key={run.current.id} beats={beats} start={start} accountId={accountId} personId={personId} demo={demo}
      location={locationNow} onNavigate={navigate}
      onBeat={onBeat} onLeave={pause} onFinish={finish} onDone={done} onNavigationReveal={onNavigationReveal}
      saveError={saveError} onRetrySave={lastWrite.current?.action === 'complete' ? undefined : retrySave} />
  </div>, document.body);
}

function groupOf(beats: readonly CrmBeat[], index: number): string {
  return beats[index]?.group ?? 'end';
}
