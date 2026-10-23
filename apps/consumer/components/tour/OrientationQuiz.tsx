"use client";
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { TroyWork, TroyLivingIcon } from '@crucible/consumer-ui';
import { ORIENTATION_QUESTIONS, ORIENTATION_VERSION, type OrientationResult } from '@/lib/orientation';
import { PROGRESSION_CHANGED_EVENT } from '@/lib/progression-ui';
import './orientation.css';

/** Server-confirmed reward only. A lost response can be recovered by retry or GET. */
export interface OrientationDraft { question: number; answers: Record<string, number> }
interface QuizProps { accountId: string; draft?: OrientationDraft; onDraftChange?: (draft: OrientationDraft) => void; onContinue?: (href: string) => Promise<void>; onPassed?: () => void }
export function OrientationQuiz(props: QuizProps) {
  return <AccountOrientationQuiz key={props.accountId} {...props} />;
}
function AccountOrientationQuiz({ accountId, draft, onDraftChange, onContinue, onPassed }: QuizProps) {
  const [question, setQuestion] = useState(draft?.question ?? 0);
  const questionRef = useRef<HTMLHeadingElement>(null);
  const [statusUnknown, setStatusUnknown] = useState(false);
  const [answers, setAnswers] = useState<Record<string, number>>(draft?.answers ?? {});
  const [result, setResult] = useState<OrientationResult | null>(null);
  const [earned, setEarned] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [quiet, setQuiet] = useState(true);
  const [hidden, setHidden] = useState(false);
  const generation = useRef(0);
  const submitting = useRef(false);
  const outcomeRef = useRef<HTMLDivElement>(null);
  useEffect(() => { onDraftChange?.({ question, answers }); }, [question, answers, onDraftChange]);
  async function continueTo(event: React.MouseEvent<HTMLAnchorElement>, href: string) {
    if (!onContinue) return;
    event.preventDefault(); if (busy) return; setBusy(true); setError('');
    try { await onContinue(href); }
    catch { setError('Your access is saved, but the lesson could not be completed. Try again.'); }
    finally { setBusy(false); }
  }
  useEffect(() => {
    const epoch = ++generation.current;
    const controller = new AbortController();
    try { setQuiet(localStorage.getItem('progress-celebrations-quiet') === '1'); } catch { setQuiet(true); }
    const visibility = () => setHidden(document.hidden);
    visibility(); document.addEventListener('visibilitychange', visibility);
    const timeout = setTimeout(() => controller.abort(), 12000);
    void fetch('/api/onboarding/quiz', { cache: 'no-store', signal: controller.signal }).then(async r => {
      if (!r.ok) throw new Error('Result unavailable');
      const body = await r.json();
      if (generation.current === epoch && body?.data?.accountId === accountId) setEarned(body?.data?.earned === true);
    }).catch(() => { if (generation.current === epoch) setStatusUnknown(true); }).finally(() => clearTimeout(timeout));
    return () => { generation.current++; controller.abort(); document.removeEventListener('visibilitychange', visibility); };
  }, [accountId]);
  useEffect(() => { questionRef.current?.focus(); }, [question]);
  useEffect(() => { if (result?.passed) outcomeRef.current?.focus(); }, [result]);

  async function submit() {
    if (submitting.current) return;
    submitting.current = true; setBusy(true); setError('');
    const epoch = generation.current;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch('/api/onboarding/quiz', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Orientation-Account': accountId }, signal: controller.signal,
        body: JSON.stringify({ version: ORIENTATION_VERSION, answers }) });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.error || 'The result could not be confirmed. Your answers are still here. Try again.');
      if (!body?.data || typeof body.data.passed !== 'boolean' || (body.data.passed && !body.data.receipt?.id)) throw new Error('The upgrade could not be confirmed. Retry safely.');
      if (generation.current !== epoch) return;
      setResult(body.data);
      if (!body.data.passed && body.data.review?.length) {
        setQuestion(Math.max(0, ORIENTATION_QUESTIONS.findIndex(q => q.id === body.data.review[0].id)));
        requestAnimationFrame(() => questionRef.current?.focus());
      }
      if (body.data.passed) { onPassed?.(); setEarned(true); window.dispatchEvent(new Event(PROGRESSION_CHANGED_EVENT)); }
    } catch (e) {
      if (generation.current === epoch) setError(e instanceof Error && e.name !== 'AbortError' ? e.message : 'The request timed out. Your answers are still here. Retry to check and recover the upgrade.');
    } finally { clearTimeout(timeout); submitting.current = false; if (generation.current === epoch) setBusy(false); }
  }
  if (result?.passed) return <div ref={outcomeRef} tabIndex={-1} className="orientation-earned" data-quiet={quiet} data-paused={hidden}>
    <div className="orientation-earned__art" aria-hidden="true"><TroyLivingIcon size={90} />{Array.from({ length: 24 }, (_, i) => <i key={i} style={{ '--angle': `${i * 15}deg`, '--delay': `${i % 5 * 60}ms` } as CSSProperties} />)}</div>
    <p className="orientation-earned__eyebrow">Understanding earned. Ready to use.</p>
    <h3>{result.receipt?.previouslyAvailable || result.receipt?.alreadyEarned ? 'You know your way forward.' : 'Your tools are open.'}</h3>
    <p>{result.receipt?.previouslyAvailable || result.receipt?.alreadyEarned ? 'Your orientation pass is confirmed. Any access you already had stays in place.' : 'You passed every question. Guided tailoring and application tools are open on your account. Any access you already had stays in place.'}</p>
    <div className="orientation-earned__doors"><a href="/dashboard/application-tailor" aria-disabled={busy} onClick={event => void continueTo(event, "/dashboard/application-tailor")}>Tailor for a real job <span aria-hidden="true">↗</span></a><a href="/dashboard/applications" aria-disabled={busy} onClick={event => void continueTo(event, "/dashboard/applications")}>Prepare my application <span aria-hidden="true">↗</span></a></div>
    {error && <p role="alert">{error}</p>}
    <p className="orientation-small">Your usage limits and sponsored features are unchanged. Your actual career milestones still come from the work you do.</p>
    <button type="button" aria-pressed={quiet} onClick={() => { setQuiet(v => !v); try { localStorage.setItem('progress-celebrations-quiet', quiet ? '0' : '1'); } catch {} }}>{quiet ? 'Allow celebration motion' : 'Keep celebration still'}</button>
  </div>;
  const q = ORIENTATION_QUESTIONS[question];
  const review = result?.review.find(item => item.id === q.id);
  return <section className="orientation-quiz" aria-label="Optional orientation check">
    <p className="orientation-kicker">Question {question + 1} of {ORIENTATION_QUESTIONS.length}</p>
    <h3 ref={questionRef} tabIndex={-1}>{q.prompt}</h3>
    {question === 0 && <p>{earned ? 'Your upgrade is saved. Practice again if you like.' : 'Six short questions. All six correct opens guided tools. No timer. Retry as often as you like.'}</p>}
    {statusUnknown && <p role="status" className="orientation-small">Your earlier result could not be checked. Answering again safely confirms the same upgrade.</p>}
    <form onSubmit={e => {
      e.preventDefault();
      if (question < ORIENTATION_QUESTIONS.length - 1) setQuestion(i => i + 1);
      else void submit();
    }}>
      <fieldset key={q.id} disabled={busy}>
        <legend className="sr-only">{q.prompt}</legend>
        {q.choices.map((choice, value) => <label key={value}>
          <input type="radio" required name={`orientation-${q.id}`} value={value} checked={answers[q.id] === value}
            onChange={() => setAnswers(a => ({ ...a, [q.id]: value }))} /><span>{choice}</span>
        </label>)}
      </fieldset>
      {review && <p className="orientation-review">{review.explanation} <span>Review: {q.lesson}.</span></p>}
      {result && <p className="orientation-review" role="status">{result.correct} of {result.total} correct. Review the explanations and try again. Existing access stays in place.</p>}
      {error && <p className="orientation-review" role="alert">{error}</p>}
      {busy && <TroyWork topic="plan" label="Checking your answers and confirming access" />}
      <div className="orientation-question-actions">
        <button type="button" className="orientation-back" disabled={question === 0 || busy} onClick={() => setQuestion(i => i - 1)}>Back</button>
        <button className="orientation-primary" type="submit" disabled={busy || answers[q.id] === undefined}>
          {busy ? 'Confirming…' : question < ORIENTATION_QUESTIONS.length - 1 ? 'Next question' : error ? 'Retry and recover my result' : result ? 'Check my revised answers' : 'Check answers and unlock'}
        </button>
      </div>
    </form>
    <p className="orientation-small">{onDraftChange ? 'You can pause and resume in this tab. Reloading clears unfinished answers.' : 'Leaving this check clears unfinished answers.'} Earned access stays on your account.</p>
  </section>;
}
