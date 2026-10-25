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
 * on purpose (Today, one person, Insights): the player asks, the controller
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
import { CRM_ENDING_INDEX, CRM_TOUR_COPY, applicableBeats, resumeStop, splitHref, stopForBeat, type CrmBeat } from '@/lib/tour/crm-beats';
import { STAFF_TOUR_HOME, STAFF_TOUR_OPEN_EVENT, firstPersonFromCohort, isDemoOrg, personIdFromRow, staffTourAllowed, staffTourRequested } from '@/lib/tour/staff-tour';
import { lockPageForTour, leaveAction } from '@/lib/tour/page-lock';
import './entrance-tour.css';

const DEF = TOURS.crm;
type Write = { tourId: 'crm'; action: 'start' | 'progress' | 'complete'; version: number; runId: string; sequence: number; stop: number; previousRunId?: string | null };
type Saved = { ok: true; runId: string; sequence: number };
interface Slot { accountId: string; impersonating?: boolean; version?: number; inProgress?: boolean; stop?: number; runId?: string; previousRunId?: string | null; sequence?: number }
const FOCUSABLE = 'button:not(:disabled),a[href],input:not(:disabled),summary,[tabindex="0"]';
const PAUSE_KEY = 'staff-tour-paused:';
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

  /** The saved stop for a resolved beat index: the beat's place in the full list, or the ending. */
  const canonical = (index: number) => index >= beatsRef.current.length ? CRM_ENDING_INDEX : stopForBeat(beatsRef.current[index].id);

  const persist = useCallback((action: Write['action'], stop: number): Promise<Saved> => {
    const current = run.current;
    if (!current.account || !current.id) return Promise.reject(new Error('Your saved place is unavailable. Reload to reconnect.'));
    const body: Write = { tourId: 'crm', action, version: DEF.version, runId: current.id, sequence: action === 'start' ? 0 : ++current.sequence, stop, ...(action === 'start' ? { previousRunId: slotRef.current?.previousRunId ?? slotRef.current?.runId ?? null } : {}) };
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
      if (pendingStart.current?.runId === body.runId && body.action !== 'start') { await send(pendingStart.current); pendingStart.current = null; }
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
    void persist(action, stop).catch(e => { if (alive.current && run.current === identity) setSaveError(e instanceof Error && e.name !== 'AbortError' ? e.message : CRM_TOUR_COPY.saveFailed); });
  }, [persist]);

  const enter = useCallback(async (slot: Slot, resume: boolean, signal: AbortSignal) => {
    if (dirty.current) { setUnsavedWarning(true); return; }
    // The person and the path are decided once, before the first card.
    let person: string | null = await personFromToday(signal);
    if (!person && !signal.aborted) {
      try {
        const res = await fetch('/api/partner/org', { cache: 'no-store', signal });
        if (res.ok) person = firstPersonFromCohort(await res.json());
      } catch { person = null; }
    }
    if (signal.aborted || !alive.current) return;
    const list = applicableBeats({ personId: person, capabilities });
    beatsRef.current = list; setBeats(list); setPersonId(person);
    // Saved progress from an older version never resumes into this one. The
    // place is a beat id (through its index in the full list), never a position in the path.
    const at = resume && slot.version === DEF.version && slot.inProgress ? resumeStop(slot.stop, list) : 0;
    pendingStart.current = null;
    run.current = { id: resume && slot.runId ? slot.runId : crypto.randomUUID(), sequence: resume ? slot.sequence ?? 0 : 0, account: slot.accountId };
    completed.current = false;
    beatRef.current = at; savedGroup.current = groupOf(list, at); setStart(at); setAccountId(slot.accountId); setError(''); setNotice(''); setActive(true);
    oldFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    try { sessionStorage.removeItem(PAUSE_KEY + slot.accountId); } catch {}
    if (!(resume && slot.runId)) save('start', canonical(at));
  }, [capabilities, save]);

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
      let paused = false; try { paused = sessionStorage.getItem(PAUSE_KEY + slot.accountId) === '1'; } catch {}
      if (mode === 'replay' || mode === 'resume') await enter(slot, mode === 'resume' && !!slot.inProgress, controller.signal);
      else if (slot.inProgress && !paused && location.pathname === STAFF_TOUR_HOME) setNotice(CRM_TOUR_COPY.paused);
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
    const open = () => { if (!active) void load('replay'); };
    window.addEventListener(STAFF_TOUR_OPEN_EVENT, open);
    return () => window.removeEventListener(STAFF_TOUR_OPEN_EVENT, open);
  }, [active, load]);

  const pause = useCallback(() => {
    if (leaveAction(completed.current) === 'close') { setActive(false); onNavigationReveal?.(false); setNotice(''); setSaveError(''); return; }
    requestController.current?.abort(); setLoading(false);
    expectedRoute.current = null; setActive(false); onNavigationReveal?.(false);
    if (run.current.account) { try { sessionStorage.setItem(PAUSE_KEY + run.current.account, '1'); } catch {} }
    setNotice(CRM_TOUR_COPY.paused);
    save('progress', canonical(beatRef.current));
  }, [save, onNavigationReveal]);

  /* Routes: the tour moves between pages on purpose; any other route change pauses it. */
  const navigate = useCallback((href: string) => {
    const { pathname: p } = splitHref(href);
    if (p !== location.pathname) expectedRoute.current = p;
    router.push(href);
  }, [router]);
  useEffect(() => {
    if (previousRoute.current === pathname) return;
    previousRoute.current = pathname;
    if (!active) return;
    if (expectedRoute.current === pathname) { expectedRoute.current = null; return; }
    pause();
  }, [pathname, active, pause]);

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
      if (alive.current && run.current === identity) setSaveError(e instanceof Error ? e.message : 'Your finish could not be confirmed. Retry safely.');
      throw e instanceof Error ? e : new Error('Your finish could not be confirmed. Retry safely.');
    }
  }, [persist]);

  const done = useCallback(() => {
    setActive(false); onNavigationReveal?.(false); setNotice(''); setSaveError('');
    if (location.pathname !== STAFF_TOUR_HOME) { expectedRoute.current = STAFF_TOUR_HOME; router.push(STAFF_TOUR_HOME); }
  }, [router, onNavigationReveal]);

  const retrySave = useCallback(() => {
    const w = lastWrite.current;
    if (!w || w.action === 'complete') return;
    save(w.action === 'start' ? 'start' : 'progress', canonical(beatRef.current));
  }, [save]);

  if (!mounted) return null;
  if (!active) return <>
    {unsavedWarning && <div className="et-notice" role="status"><p>{CRM_TOUR_COPY.unsaved}</p><button onClick={() => { dirty.current = false; setUnsavedWarning(false); void load('replay'); }}>{CRM_TOUR_COPY.unsavedConfirm}</button><button onClick={() => setUnsavedWarning(false)}>{CRM_TOUR_COPY.unsavedStay}</button></div>}
    {(notice || error || saveError) && <div className="et-notice" role="status"><p>{saveError || error || notice}</p>
      <button disabled={loading} onClick={() => void load(slotRef.current?.inProgress || notice ? 'resume' : 'replay')}>{loading ? CRM_TOUR_COPY.loading : CRM_TOUR_COPY.resume}</button>
      {notice && <button disabled={loading} onClick={() => void load('replay')}>{CRM_TOUR_COPY.startOver}</button>}
      <button onClick={() => { setNotice(''); setError(''); setSaveError(''); }}>{CRM_TOUR_COPY.dismiss}</button></div>}
  </>;
  return createPortal(<div ref={root}>
    <StaffTourPlayer key={run.current.id} beats={beats} start={start} accountId={accountId} personId={personId} demo={demo}
      location={`${pathname}${search?.toString() ? `?${search.toString()}` : ''}`} onNavigate={navigate}
      onBeat={onBeat} onLeave={pause} onFinish={finish} onDone={done} onNavigationReveal={onNavigationReveal}
      saveError={saveError} onRetrySave={lastWrite.current?.action === 'complete' ? undefined : retrySave} />
  </div>, document.body);
}

function groupOf(beats: readonly CrmBeat[], index: number): string {
  return beats[index]?.group ?? 'end';
}
