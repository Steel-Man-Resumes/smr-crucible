"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { TroyMark, TroyWork } from '@crucible/consumer-ui';
import { useUserTier } from '@/lib/useUserTier';
import { GUIDED_ENDING, GUIDED_LESSONS, GUIDED_PART_LABELS } from '@/lib/guided-lessons';
import { TOUR_VERSION, NEXT_STEP_CHANGED_EVENT, type TourState } from '@/lib/guidedTour';
import { nextPaint, safeTourRoute, visibleGuidedRect, waitForGuidedTarget, type GuidedRect } from '@/lib/guided-attention';
import { OrientationQuiz, type OrientationDraft } from './tour/OrientationQuiz';
import { directGuidedCamera, guidedHold, GUIDED_CAMERA_MS } from '@/lib/guided-camera';
import './tour/guided-learning.css';

type Phase = 'explain' | 'revealing' | 'travel' | 'ready';
type Write = { action: 'start' | 'progress' | 'complete'; version: number; runId: string; sequence: number; stop: number; previousRunId?: string | null };
const FOCUSABLE = 'button:not(:disabled),a[href],input:not(:disabled),summary,[tabindex="0"]';
const PAUSE_KEY = 'guided-learning-paused:';

/** The controller survives route changes. Motion follows acknowledgement, never reading time. */
export function GuidedTour({ held = false, onNavigationReveal }: { held?: boolean; onNavigationReveal?: (open: boolean) => void }) {
  const tier = useUserTier();
  const allowed = useRef(false);
  allowed.current = tier === 'client' && !held;
  const pathname = usePathname();
  const search = useSearchParams();
  const router = useRouter();
  const requested = search?.get('tour') === '1';
  const [mounted, setMounted] = useState(false);
  const [state, setState] = useState<TourState | null>(null);
  const [active, setActive] = useState(false);
  const [step, setStep] = useState(0);
  const [phase, setPhase] = useState<Phase>('explain');
  const [targetIndex, setTargetIndex] = useState(0);
  const [rect, setRect] = useState<GuidedRect | null>(null);
  const [path, setPath] = useState('');
  const [error, setError] = useState('');
  const [saveError, setSaveError] = useState('');
  const [loading, setLoading] = useState(false);
  const [quiz, setQuiz] = useState(false);
  const [quizPassed, setQuizPassed] = useState(false);
  const [quizDraft, setQuizDraft] = useState<OrientationDraft>({ question: 0, answers: {} });
  const [reduced, setReduced] = useState(true);
  const [quiet, setQuiet] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [notice, setNotice] = useState('');
  const [unsavedWarning, setUnsavedWarning] = useState(false);
  const dock = useRef<HTMLElement>(null);
  const restoreCamera = useRef<(() => void) | null>(null);
  const resetCamera = useCallback(() => { restoreCamera.current?.(); restoreCamera.current = null; }, []);
  const heading = useRef<HTMLHeadingElement>(null);
  const roy = useRef<HTMLSpanElement>(null);
  const revealedTarget = useRef<HTMLElement | null>(null);
  const stateRef = useRef<TourState | null>(null);
  const stepRef = useRef(0);
  const alive = useRef(true);
  const transition = useRef<AbortController | null>(null);
  const requestController = useRef<AbortController | null>(null);
  const run = useRef({ id: '', sequence: 0, account: '' });
  const queue = useRef<Promise<void>>(Promise.resolve());
  const lastWrite = useRef<Write | null>(null);
  const pendingStart = useRef<Write | null>(null);
  const previousRequest = useRef('');
  const expectedRoute = useRef<string | null>(null);
  const navigationIntent = useRef(0);
  const previousRoute = useRef(pathname);
  const dirty = useRef(false);
  const oldFocus = useRef<HTMLElement | null>(null);
  const lesson = GUIDED_LESSONS[step];
  const ending = !lesson;
  const motionOff = reduced || quiet;
  const priorMotionOff = useRef(motionOff);
  useEffect(() => {
    const changed = motionOff && !priorMotionOff.current;
    priorMotionOff.current = motionOff;
    if (!changed || !active) return;
    transition.current?.abort(); resetCamera(); setRect(null); setPath(''); setPhase('explain');
  }, [motionOff, active, resetCamera]);

  useEffect(() => {
    alive.current = true; setMounted(true);
    const media = matchMedia('(prefers-reduced-motion: reduce)');
    const sync = () => setReduced(media.matches || document.documentElement.classList.contains('reduce-motion'));
    const visibility = () => setHidden(document.hidden);
    const mutation = new MutationObserver(sync);
    mutation.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    media.addEventListener('change', sync); document.addEventListener('visibilitychange', visibility); sync(); visibility();
    const changed = (event: Event) => {
      if (!document.documentElement.dataset.guidedLearning && event.target instanceof HTMLElement && event.target.closest('input,textarea,select,[contenteditable="true"]')) dirty.current = true;
    };
    document.addEventListener('input', changed, true); document.addEventListener('change', changed, true);
    return () => {
      resetCamera(); alive.current = false; requestController.current?.abort(); transition.current?.abort();
      mutation.disconnect(); media.removeEventListener('change', sync); document.removeEventListener('visibilitychange', visibility);
      document.removeEventListener('input', changed, true); document.removeEventListener('change', changed, true);
    };
  }, [resetCamera]);

  const persist = useCallback((action: Write['action'], stop: number): Promise<void> => {
    const current = run.current;
    if (!current.account || !current.id) return Promise.reject(new Error('Your saved place is unavailable. Reload to reconnect.'));
    const body: Write = { action, version: TOUR_VERSION, runId: current.id, sequence: action === 'start' ? 0 : ++current.sequence, stop, ...(action === 'start' ? { previousRunId: stateRef.current?.previousRunId ?? stateRef.current?.runId ?? null } : {}) };
    lastWrite.current = body;
    if (action === 'start') pendingStart.current = body;
    const operation = queue.current.catch(() => {}).then(async () => {
      if (!alive.current || run.current.id !== body.runId || run.current.account !== current.account) throw new Error('This lesson was replaced by a newer run.');
      const send = async (write: Write) => {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10000);
        try {
          const response = await fetch('/api/onboarding/tour', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Orientation-Account': current.account }, body: JSON.stringify(write), signal: controller.signal, keepalive: true });
          const result = await response.json().catch(() => null);
          if (!response.ok || result?.ok !== true || result.runId !== write.runId || result.sequence !== write.sequence) throw new Error(result?.error || 'Your place could not be saved.');
        } finally { clearTimeout(timeout); }
      };
      if (pendingStart.current?.runId === body.runId && body.action !== 'start') {
        await send(pendingStart.current); pendingStart.current = null;
      }
      await send(body);
      if (body.action === 'start' && pendingStart.current?.runId === body.runId) pendingStart.current = null;
      if (alive.current && run.current.id === body.runId) { setSaveError(''); if (action === 'complete') window.dispatchEvent(new Event(NEXT_STEP_CHANGED_EVENT)); }

    });
    queue.current = operation;
    return operation;
  }, []);

  const save = useCallback((action: Write['action'], stop: number) => {
    const identity = run.current;
    void persist(action, stop).catch(e => { if (alive.current && run.current === identity) setSaveError(e instanceof Error && e.name !== 'AbortError' ? e.message : 'Saving timed out. Your place is still here; retry to save it.'); });
  }, [persist]);

  const enter = useCallback((data: TourState, resume: boolean) => {
    if (!allowed.current) return;
    if (dirty.current) { setUnsavedWarning(true); return; }
    const stop = resume && data.version === TOUR_VERSION && data.inProgress ? data.stop ?? 0 : 0;
    pendingStart.current = null;
    run.current = { id: resume && data.runId ? data.runId : crypto.randomUUID(), sequence: resume ? data.sequence ?? 0 : 0, account: data.accountId || '' };
    stepRef.current = stop; setStep(stop); setTargetIndex(0); setPhase('explain'); setRect(null); setQuiz(false); setError(''); setNotice(''); setActive(true);
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
      else if (data.inProgress) setNotice('Your guided lesson is paused.');
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
    resetCamera(); navigationIntent.current++; setLoading(false);
    transition.current?.abort(); expectedRoute.current = null; setActive(false); setRect(null); setQuiz(false); onNavigationReveal?.(false);
    if (run.current.account) { try { sessionStorage.setItem(PAUSE_KEY + run.current.account, '1'); } catch {} }
    setNotice('Lesson paused. Resume here when you are ready.'); save('progress', stepRef.current);
  }, [save, onNavigationReveal, resetCamera]);

  useEffect(() => {
    if (previousRoute.current === pathname) return;
    previousRoute.current = pathname;
    if (!active) return;
    if (expectedRoute.current === pathname) { expectedRoute.current = null; return; }
    // Browser Back or an unrelated route change never silently advances a lesson.
    pause();
  }, [pathname, active, pause]);
  useEffect(() => { if ((held || tier !== 'client') && active) { requestController.current?.abort(); pause(); } }, [held, tier, active, pause]);

  useEffect(() => {
    if (!active || held || tier !== 'client') return;
    const html = document.documentElement;
    html.dataset.guidedLearning = 'true';
    const shell = document.querySelector<HTMLElement>('.refinery-app');
    const wasInert = shell?.inert ?? false;
    if (shell) shell.inert = true;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); pause(); return; }
      if (event.key !== 'Tab') return;
      const items = Array.from(dock.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []).filter(item => item.getClientRects().length && !item.closest('[hidden]'));
      const first = items[0], last = items.at(-1);
      if (!first || !last) { event.preventDefault(); return; }
      if (event.shiftKey && (document.activeElement === first || !dock.current?.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || !dock.current?.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKey);
    return () => { resetCamera(); delete html.dataset.guidedLearning; if (shell) shell.inert = wasInert; document.removeEventListener('keydown', onKey); if (oldFocus.current?.isConnected) oldFocus.current.focus({ preventScroll: true }); };
  }, [active, held, tier, pause, resetCamera]);

  useEffect(() => {
    if (!active) return;
    const reader = dock.current?.querySelector('.learning-reading');
    if (reader) reader.scrollTop = 0;
    heading.current?.focus({ preventScroll: true });
  }, [active, step, quiz]);
  useEffect(() => {
    if (!active || phase === 'explain') return;
    const reset = () => { resetCamera(); transition.current?.abort(); setRect(null); setPhase('explain'); setError('The layout changed. Choose Show me to point to this area again.'); };
    window.addEventListener('resize', reset);
    return () => window.removeEventListener('resize', reset);
  }, [active, phase, resetCamera]);

  useEffect(() => {
    const target = revealedTarget.current;
    if (!active || phase !== 'ready' || !target || lesson?.part === 'story') return;
    let frame = 0;
    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const screen = target.isConnected ? visibleGuidedRect(target.getBoundingClientRect(), window.innerWidth, window.innerHeight, window.innerHeight - (dock.current?.getBoundingClientRect().top ?? window.innerHeight) + 20) : null;
        if (!screen) { resetCamera(); setRect(null); setPhase('explain'); setError('The page changed. Choose Show me to find this area again.'); return; }
        setRect(screen);
      });
    };
    const page = target.closest<HTMLElement>('[data-tour-page]');
    const observer = new ResizeObserver(measure);
    observer.observe(target);
    if (page) observer.observe(page);
    if (dock.current) observer.observe(dock.current);
    // Async siblings can move a control without resizing it or scrolling.
    const mutations = new MutationObserver(measure);
    if (page) mutations.observe(page, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['class', 'style', 'hidden'] });
    window.addEventListener('scroll', measure, { capture: true, passive: true });
    return () => { cancelAnimationFrame(frame); observer.disconnect(); mutations.disconnect(); window.removeEventListener('scroll', measure, true); };
  }, [active, phase, lesson, resetCamera]);

  async function reveal(index = targetIndex) {
    if (!lesson || !safeTourRoute(lesson.route)) return;
    transition.current?.abort(); const controller = new AbortController(); transition.current = controller;
    resetCamera(); setError(''); setRect(null); setPhase('revealing'); setTargetIndex(index);
    try {
      if (lesson.part === 'story') {
        await nextPaint(controller.signal);
        if (!motionOff) {
          await guidedHold(GUIDED_CAMERA_MS, controller.signal);
          const subject = document.querySelector<HTMLElement>('.learning-stage .learning-process b, .learning-stage .learning-facts span, .learning-stage .learning-coach-hero');
          if (subject) setPath(attentionPath(roy.current, subject.getBoundingClientRect()));
          setPhase('travel'); await guidedHold(700, controller.signal);
        }
        setPhase('ready'); return;
      }
      const mobile = window.innerWidth < 768;
      onNavigationReveal?.(mobile && lesson.part === 'map');
      if (location.pathname !== lesson.route) { expectedRoute.current = lesson.route; router.push(lesson.route); }
      const target = await waitForGuidedTarget(lesson.targets[index], lesson.route, controller.signal);
      // Establish the real page, then frame the exact teaching target.
      const oldMargins = [target.style.scrollMarginTop, target.style.scrollMarginBottom];
      target.style.scrollMarginTop = '90px'; target.style.scrollMarginBottom = `${window.innerHeight - (dock.current?.getBoundingClientRect().top ?? window.innerHeight) + 32}px`;
      revealedTarget.current = target;
      target.scrollIntoView({ block: 'start', inline: 'nearest', behavior: 'instant' });
      [target.style.scrollMarginTop, target.style.scrollMarginBottom] = oldMargins;
      await nextPaint(controller.signal);
      const page = target.closest<HTMLElement>('[data-tour-page]');
      if (lesson.part === 'pages' && page) {
        const bottom = dock.current?.getBoundingClientRect().top ?? innerHeight - 260;
        // Keep the desktop navigation as a stable landmark beside the camera.
        const left = innerWidth >= 768 ? Math.max(16, page.getBoundingClientRect().left) : 16;
        restoreCamera.current = directGuidedCamera(page, target, { left, top: 82, width: innerWidth - left - 16, height: Math.max(100, bottom - 110) }, motionOff);
        if (!motionOff) await guidedHold(GUIDED_CAMERA_MS, controller.signal);
        await nextPaint(controller.signal);
      }
      const screen = visibleGuidedRect(target.getBoundingClientRect(), window.innerWidth, window.innerHeight, window.innerHeight - (dock.current?.getBoundingClientRect().top ?? window.innerHeight) + 20);
      if (!screen) throw new Error('This area does not fit above the guide. Continue the explanation, or pause to explore it.');
      setRect(screen);
      setPath(attentionPath(roy.current, screen));
      if (motionOff) { setPhase('ready'); return; }
      setPhase('travel');
      await guidedHold(700, controller.signal);
      if (!controller.signal.aborted) setPhase('ready');
    } catch (e) {
      if (controller.signal.aborted || !alive.current) return;
      resetCamera(); setPhase('explain'); setError(e instanceof Error ? e.message : 'The page could not be shown. Try again.');
    }
  }

  function move(next: number) {
    resetCamera(); transition.current?.abort(); onNavigationReveal?.(false); setRect(null); setPath(''); setPhase('explain'); setTargetIndex(0); setError(''); setQuiz(false);
    stepRef.current = next; setStep(next); save('progress', next);
  }
  async function finish(destination?: string) {
    const identity = run.current;
    const intent = navigationIntent.current;
    setLoading(true); setError('');
    try {
      await persist('complete', GUIDED_LESSONS.length);
      if (!alive.current || run.current !== identity || navigationIntent.current !== intent) return;
      resetCamera(); transition.current?.abort(); setActive(false); setNotice('Your tour is complete. You can ask t.ROY for help on any page.');
      if (stateRef.current) { stateRef.current = { ...stateRef.current, tourComplete: true, inProgress: false }; setState(stateRef.current); }
      const href = destination || stateRef.current?.nextStep?.href;
      if (href && /^\/dashboard(?:[/?#]|$)/.test(href) && !href.includes('tour=1')) router.push(href);
    } catch (e) { if (alive.current && run.current === identity && navigationIntent.current === intent) setSaveError(e instanceof Error ? e.message : 'Your completion could not be confirmed. Retry safely.'); if (destination) throw e; }
    finally { if (alive.current && run.current === identity) setLoading(false); }
  }
  if (!mounted || tier !== 'client' || held) return null;
  if (!active) return <>
    {unsavedWarning && <div className="learning-notice" role="status">Save your current work before starting the guided lesson. <button onClick={() => { dirty.current = false; setUnsavedWarning(false); void load('replay'); }}>I have saved my work</button><button onClick={() => setUnsavedWarning(false)}>Stay here</button></div>}
    {(notice || error || saveError) && <div className="learning-notice" role="status"><p>{saveError || error || notice}</p><button disabled={loading} onClick={() => void load(state?.inProgress || notice ? 'resume' : 'replay')}>{loading ? 'Opening lesson…' : 'Resume lesson'}</button><button onClick={() => { setNotice(''); setError(''); setSaveError(''); }}>Dismiss</button></div>}
  </>;
  const partLessons = lesson ? GUIDED_LESSONS.filter(item => item.part === lesson.part) : [];
  const partIndex = lesson ? partLessons.findIndex(item => item.id === lesson.id) + 1 : 0;
  const showing = phase === 'ready' || phase === 'travel' || phase === 'revealing';
  return createPortal(<div className="learning-root" data-phase={phase} data-part={lesson?.part || 'check'} data-quiz={quiz} data-still={motionOff} data-hidden={hidden}>
    <div className="learning-backdrop" aria-hidden="true" />
    <div className="learning-chapters" aria-hidden="true">{Object.entries(GUIDED_PART_LABELS).map(([key, label], i) => <span key={key} data-current={lesson?.part === key}><b>0{i + 1}</b> {label}</span>)}<span data-current={ending}><b>04</b> Your next move</span></div>
    {rect && phase === 'ready' && <div className="learning-focus" aria-hidden="true" style={rect} />}
    {path && phase === 'travel' && !motionOff && <svg className="learning-particles" aria-hidden="true"><path d={path} fill="none" stroke="#bc9aff" strokeWidth="1" opacity=".3" />{Array.from({ length: 9 }, (_, i) => <circle key={i} r={i % 3 ? 2 : 4} fill={i % 3 ? '#d5b8fa' : '#e8aa48'} style={{ offsetPath: `path('${path}')`, animationDelay: `${i * 20}ms` } as CSSProperties} />)}</svg>}
    {lesson?.part === 'story' && <div key={lesson.id} className="learning-stage" aria-hidden="true" data-revealed={showing}><Concept concept={lesson.concept} /></div>}
    <section ref={dock} className="learning-guide" role="dialog" aria-modal="true" aria-labelledby="learning-heading">
      <header className="learning-top"><span>{lesson ? `${GUIDED_PART_LABELS[lesson.part]} · ${partIndex} of ${partLessons.length}` : quiz ? 'Your optional check' : 'Your next move'}</span><button aria-label="Pause lesson and keep my place" onClick={pause}>Pause</button></header>
      <div className="learning-reading">
        <div className="learning-speaker"><span ref={roy}><TroyMark size={72} /></span><div><strong>t.ROY</strong><span>Your guide</span></div></div>
        <h2 id="learning-heading" ref={heading} tabIndex={-1}>{lesson?.title || GUIDED_ENDING.title}</h2>
        {!quiz && <p className="learning-message">{lesson?.message || GUIDED_ENDING.message}</p>}
        {lesson && <div className="learning-observation" role="status">{phase === 'ready' ? <><span>{targetObservation(lesson.targets[targetIndex], lesson.observation)}</span>{lesson.part !== 'story' && <small>Showing {targetLabel(lesson.targets[targetIndex], lesson.title)}.</small>}{lesson.part === 'map' && lesson.targets.length > 1 && <small>Area {targetIndex + 1} of {lesson.targets.length} in this group</small>}</> : phase === 'revealing' ? <TroyWork topic="plan" label={lesson.part === 'story' ? 'Connecting your work to the next steps' : 'Framing this part of your workspace'} /> : <span className="learning-read-cue">Read this first. Then I’ll show you where it fits.</span>}</div>}
        {lesson && phase === 'ready' && <details className="learning-recap"><summary>Read that again</summary><p>{lesson.message}</p></details>}
        {lesson?.part === 'story' && phase === 'ready' && <div className="learning-mobile-concept"><Concept concept={lesson.concept} /></div>}
        {!lesson && !quiz && <>{state?.nextStep?.action && <p className="learning-next-action">Your next move: {state.nextStep.action}</p>}<p className="learning-check-note">This is a check of the tools, not a test of your ability. Review explanations and retry. Passing does not change sponsored features or usage limits.</p><button className="learning-primary" onClick={() => { setQuizPassed(false); setQuiz(true); }}>{GUIDED_ENDING.action}</button></>}
        {!lesson && quiz && state?.accountId && <OrientationQuiz accountId={state.accountId} draft={quizDraft} onDraftChange={setQuizDraft} onContinue={finish} onPassed={() => setQuizPassed(true)} />}
        {error && <p className="learning-error" role="alert">{error}</p>}
        {saveError && <p className="learning-error" role="status">{saveError} <button onClick={() => lastWrite.current?.action === 'complete' ? void finish() : save(lastWrite.current?.action === 'start' ? 'start' : 'progress', stepRef.current)}>Retry saving</button></p>}
      </div>
      <footer className="learning-controls">
        {!quiz && <button disabled={step === 0 || loading} onClick={() => move(Math.max(0, step - 1))}>Back</button>}
        {lesson ? <button className="learning-primary" disabled={phase === 'revealing' || phase === 'travel'} onClick={() => {
          if (!showing) void reveal();
          else if (targetIndex < lesson.targets.length - 1) void reveal(targetIndex + 1);
          else move(step + 1);
        }}>{phase === 'revealing' ? 'Finding this area…' : phase === 'travel' ? 'Showing you…' : phase === 'ready' ? targetIndex < lesson.targets.length - 1 ? 'Show next area' : 'Next' : 'Show me'}</button> : quiz && !quizPassed ? <button onClick={() => setQuiz(false)}>Back to lesson</button> : <button disabled={loading} className={quizPassed ? 'learning-primary' : ''} onClick={() => void finish()}>{loading ? 'Saving…' : quizPassed ? state?.nextStep?.action || 'Finish lesson' : 'Finish without the check'}</button>}
        {error && lesson && <button onClick={() => move(step + 1)}>Continue the explanation</button>}
        <button className="learning-mobile-pause" onClick={pause}>Pause</button>
        <button className="learning-motion" aria-pressed={quiet || reduced} onClick={() => setQuiet(v => !v)} disabled={reduced}>{motionOff ? 'Motion off' : 'Turn motion off'}</button>
      </footer>
    </section>
  </div>, document.body);
}

function Concept({ concept }: { concept?: 'process' | 'facts' | 'coach' }) {
  return <><span className="learning-stage-kicker">THE FORGE → THE REFINERY</span>
    {concept === 'process' ? <><h3>The resume is the start.</h3><div className="learning-process">{['Find work', 'Prepare', 'Apply', 'Practice', 'Next steps'].map((label, i) => <span key={label} style={{ '--beat': i } as CSSProperties}><b>{String(i + 1).padStart(2, '0')}</b>{label}</span>)}</div><p>Return to any part. Keep moving with what you learn.</p></> : concept === 'facts' ? <><h3>One true history.<br />More than one direction.</h3><div className="learning-facts"><span>Your real work</span><span>A job version</span><span>Your own words</span></div><p>The emphasis can change. The facts stay yours.</p></> : <><div className="learning-coach-hero"><TroyMark size={120} /></div><h3>Help beside your work.</h3><p>Ask. Check. Choose.<br />You keep the final say.</p></>}
  </>;
}

function targetLabel(id: string, fallback: string): string {
  const labels: Record<string, string> = { 'refinery-nav-overview': 'Overview', 'refinery-nav-jobs': 'Find work', 'refinery-nav-resumes': 'My resumes', 'refinery-nav-applications': 'Applications', 'refinery-nav-interview': 'Interview prep', 'refinery-nav-support': 'Support & disclosure', 'refinery-nav-settings': 'Settings' };
  return labels[id] || fallback;
}

function targetObservation(id: string, fallback: string): string {
  const notes: Record<string, string> = {
    'refinery-nav-jobs': 'Start here to choose work worth preparing for.',
    'refinery-nav-resumes': 'Your documents live here. Build each job version from the same true history.',
    'refinery-nav-applications': 'Keep track of what actually happened with each job.',
    'refinery-nav-interview': 'Practice explaining the work behind your resume.',
    'refinery-nav-overview': 'Come back here when you need your next useful step.',
    'refinery-nav-support': 'Practical help and record conversations have their own place.',
    'refinery-nav-settings': 'Make the tool work for you: reading, coaching and sharing choices.',
  };
  return notes[id] || fallback;
}

function attentionPath(roy: HTMLElement | null, screen: GuidedRect): string {
  const origin = roy?.getBoundingClientRect();
  const sx = origin ? origin.left + origin.width / 2 : screen.left;
  const sy = origin ? origin.top + origin.height / 2 : screen.top;
  const ex = screen.left + Math.min(28, screen.width / 2), ey = screen.top + 8;
  return `M ${sx} ${sy} Q ${sx} ${Math.min(sy, ey) - 35} ${ex} ${ey}`;
}
