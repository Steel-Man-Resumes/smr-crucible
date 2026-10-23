"use client";
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { TroyWork, TroyLivingIcon } from '@crucible/consumer-ui';
import { ORIENTATION_QUESTIONS, ORIENTATION_VERSION, type OrientationResult } from '@/lib/orientation';
import { PROGRESSION_CHANGED_EVENT } from '@/lib/progression-ui';
import './orientation.css';

/** Server-confirmed reward only. A lost response can be recovered by retry or GET. */
export function OrientationQuiz({ accountId }: { accountId: string }) {
  return <AccountOrientationQuiz key={accountId} accountId={accountId} />;
}
function AccountOrientationQuiz({ accountId }: { accountId: string }) {
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [result, setResult] = useState<OrientationResult | null>(null);
  const [earned, setEarned] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [quiet, setQuiet] = useState(true);
  const [hidden, setHidden] = useState(false);
  const generation = useRef(0);
  const submitting = useRef(false);
  const outcomeRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const epoch = ++generation.current;
    const controller = new AbortController();
    try { setQuiet(localStorage.getItem('progress-celebrations-quiet') === '1'); } catch { setQuiet(true); }
    const visibility = () => setHidden(document.hidden);
    visibility(); document.addEventListener('visibilitychange', visibility);
    const timeout = setTimeout(() => controller.abort(), 12000);
    void fetch('/api/onboarding/quiz', { cache: 'no-store', signal: controller.signal }).then(async r => {
      if (!r.ok) return;
      const body = await r.json();
      if (generation.current === epoch && body?.data?.accountId === accountId) setEarned(body?.data?.earned === true);
    }).catch(() => {}).finally(() => clearTimeout(timeout));
    return () => { generation.current++; controller.abort(); document.removeEventListener('visibilitychange', visibility); };
  }, [accountId]);
  useEffect(() => { if (result) outcomeRef.current?.focus(); }, [result]);

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
      if (body.data.passed) { setEarned(true); window.dispatchEvent(new Event(PROGRESSION_CHANGED_EVENT)); }
    } catch (e) {
      if (generation.current === epoch) setError(e instanceof Error && e.name !== 'AbortError' ? e.message : 'The request timed out. Your answers are still here. Retry to check and recover the upgrade.');
    } finally { clearTimeout(timeout); submitting.current = false; if (generation.current === epoch) setBusy(false); }
  }
  if (result?.passed) return <div ref={outcomeRef} tabIndex={-1} className="orientation-earned" data-quiet={quiet} data-paused={hidden}>
    <div className="orientation-earned__art" aria-hidden="true"><TroyLivingIcon size={90} />{Array.from({ length: 24 }, (_, i) => <i key={i} style={{ '--angle': `${i * 15}deg`, '--delay': `${i % 5 * 60}ms` } as CSSProperties} />)}</div>
    <p className="orientation-earned__eyebrow">Understanding earned. Ready to use.</p>
    <h3>{result.receipt?.previouslyAvailable || result.receipt?.alreadyEarned ? 'You know your way forward.' : 'Your tools are open.'}</h3>
    <p>{result.receipt?.previouslyAvailable || result.receipt?.alreadyEarned ? 'Your orientation pass is confirmed. Any access you already had stays in place.' : 'You passed every question. Guided tailoring and application tools are open on your account. Any access you already had stays in place.'}</p>
    <div className="orientation-earned__doors"><a href="/dashboard/application-tailor">Tailor for a real job <span aria-hidden="true">↗</span></a><a href="/dashboard/applications">Prepare my application <span aria-hidden="true">↗</span></a></div>
    <p className="orientation-small">Your usage limits and sponsored features are unchanged. Your actual career milestones still come from the work you do.</p>
    <button type="button" aria-pressed={quiet} onClick={() => { setQuiet(v => !v); try { localStorage.setItem('progress-celebrations-quiet', quiet ? '0' : '1'); } catch {} }}>{quiet ? 'Allow celebration motion' : 'Keep celebration still'}</button>
  </div>;
  return <section className="orientation-quiz" aria-label="Optional orientation check">
    <h3>{earned ? 'Your upgrade is saved. Practice again if you like.' : 'Earn your immediate access upgrade'}</h3>
    <p>Six practical questions. Get all six right to open guided tailoring and application tools. Review explanations and retry as often as you need. No timer, no AI charge.</p>
    {earned && <p className="orientation-small">Retaking the check does not add another upgrade or remove your existing access.</p>}
    <form onSubmit={e => { e.preventDefault(); void submit(); }}>
      {ORIENTATION_QUESTIONS.map((q, index) => <fieldset key={q.id} disabled={busy}>
        <legend>{index + 1}. {q.prompt}</legend>
        {q.choices.map((choice, value) => <label key={value}><input type="radio" required name={`orientation-${q.id}`} value={value} checked={answers[q.id] === value} onChange={() => setAnswers(a => ({ ...a, [q.id]: value }))} /><span>{choice}</span></label>)}
        {result?.review.find(r => r.id === q.id) && <p className="orientation-review">{result.review.find(r => r.id === q.id)!.explanation} <span>Review: {q.lesson}.</span></p>}
      </fieldset>)}
      {result && <div ref={outcomeRef} tabIndex={-1} className="orientation-review" role="status">{result.correct} of {result.total} correct. Read the explanations, change your answers, and try again. Your existing access is unchanged.</div>}
      {error && <p className="orientation-review" role="alert">{error}</p>}
      {busy ? <TroyWork topic="plan" label="Checking your answers and confirming access" /> : null}
      <button className="orientation-primary" type="submit" disabled={busy || Object.keys(answers).length !== ORIENTATION_QUESTIONS.length}>{busy ? 'Confirming…' : error ? 'Retry and recover my result' : result ? 'Check my revised answers' : 'Check answers and unlock'}</button>
    </form>
  </section>;
}
