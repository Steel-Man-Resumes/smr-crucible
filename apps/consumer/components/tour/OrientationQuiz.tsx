"use client";
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { useTranslations } from 'next-intl';
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
  const t = useTranslations('refineryHome.quiz');
  const tr = (key: string, fallback: string) => (t.has(key) ? t(key) : fallback);
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
    catch { setError(t('accessSavedLessonFailed')); }
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
      if (!response.ok) throw new Error(body?.error || t('resultNotConfirmed'));
      if (!body?.data || typeof body.data.passed !== 'boolean' || (body.data.passed && !body.data.receipt?.id)) throw new Error(t('upgradeNotConfirmed'));
      if (generation.current !== epoch) return;
      setResult(body.data);
      if (!body.data.passed && body.data.review?.length) {
        setQuestion(Math.max(0, ORIENTATION_QUESTIONS.findIndex(q => q.id === body.data.review[0].id)));
        requestAnimationFrame(() => questionRef.current?.focus());
      }
      if (body.data.passed) { onPassed?.(); setEarned(true); window.dispatchEvent(new Event(PROGRESSION_CHANGED_EVENT)); }
    } catch (e) {
      if (generation.current === epoch) setError(e instanceof Error && e.name !== 'AbortError' ? e.message : t('timedOut'));
    } finally { clearTimeout(timeout); submitting.current = false; if (generation.current === epoch) setBusy(false); }
  }
  if (result?.passed) return <div ref={outcomeRef} tabIndex={-1} className="orientation-earned" data-quiet={quiet} data-paused={hidden}>
    <div className="orientation-earned__art" aria-hidden="true"><TroyLivingIcon size={90} />{Array.from({ length: 24 }, (_, i) => <i key={i} style={{ '--angle': `${i * 15}deg`, '--delay': `${i % 5 * 60}ms` } as CSSProperties} />)}</div>
    <p className="orientation-earned__eyebrow">{t('earnedEyebrow')}</p>
    <h3>{result.receipt?.previouslyAvailable || result.receipt?.alreadyEarned ? t('knowWay') : t('toolsOpen')}</h3>
    <p>{result.receipt?.previouslyAvailable || result.receipt?.alreadyEarned ? t('passConfirmed') : t('passedAll')}</p>
    <div className="orientation-earned__doors"><a href="/dashboard/application-tailor" aria-disabled={busy} onClick={event => void continueTo(event, "/dashboard/application-tailor")}>{t('tailorReal')} <span aria-hidden="true">↗</span></a><a href="/dashboard/applications" aria-disabled={busy} onClick={event => void continueTo(event, "/dashboard/applications")}>{t('prepareApp')} <span aria-hidden="true">↗</span></a></div>
    {error && <p role="alert">{error}</p>}
    <p className="orientation-small">{t('limitsUnchanged')}</p>
    <button type="button" aria-pressed={quiet} onClick={() => { setQuiet(v => !v); try { localStorage.setItem('progress-celebrations-quiet', quiet ? '0' : '1'); } catch {} }}>{quiet ? t('allowMotion') : t('keepStill')}</button>
  </div>;
  const q = ORIENTATION_QUESTIONS[question];
  const review = result?.review.find(item => item.id === q.id);
  return <section className="orientation-quiz" aria-label={t('checkAria')}>
    <p className="orientation-kicker">{t('questionOf', { number: question + 1, total: ORIENTATION_QUESTIONS.length })}</p>
    <h3 ref={questionRef} tabIndex={-1}>{tr(`questions.${q.id}.prompt`, q.prompt)}</h3>
    {question === 0 && <p>{earned ? t('upgradeSaved') : t('sixQuestions')}</p>}
    {statusUnknown && <p role="status" className="orientation-small">{t('earlierUnknown')}</p>}
    <form onSubmit={e => {
      e.preventDefault();
      if (question < ORIENTATION_QUESTIONS.length - 1) setQuestion(i => i + 1);
      else void submit();
    }}>
      <fieldset key={q.id} disabled={busy}>
        <legend className="sr-only">{tr(`questions.${q.id}.prompt`, q.prompt)}</legend>
        {q.choices.map((choice, value) => <label key={value}>
          <input type="radio" required name={`orientation-${q.id}`} value={value} checked={answers[q.id] === value}
            onChange={() => setAnswers(a => ({ ...a, [q.id]: value }))} /><span>{tr(`questions.${q.id}.choices.${value}`, choice)}</span>
        </label>)}
      </fieldset>
      {review && <p className="orientation-review">{review.explanation} <span>{t('reviewLesson', { lesson: tr(`lessonNames.${q.id}`, q.lesson) })}</span></p>}
      {result && <p className="orientation-review" role="status">{t('scoreResult', { correct: result.correct, total: result.total })}</p>}
      {error && <p className="orientation-review" role="alert">{error}</p>}
      {busy && <TroyWork topic="plan" label={t('checkingAnswers')} />}
      <div className="orientation-question-actions">
        <button type="button" className="orientation-back" disabled={question === 0 || busy} onClick={() => setQuestion(i => i - 1)}>{t('back')}</button>
        <button className="orientation-primary" type="submit" disabled={busy || answers[q.id] === undefined}>
          {busy ? t('confirming') : question < ORIENTATION_QUESTIONS.length - 1 ? t('nextQuestion') : error ? t('retryRecover') : result ? t('checkRevised') : t('checkUnlock')}
        </button>
      </div>
    </form>
    <p className="orientation-small">{onDraftChange ? t('pauseResume') : t('leavingClears')} {t('earnedStays')}</p>
  </section>;
}
