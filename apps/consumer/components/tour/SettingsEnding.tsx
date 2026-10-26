"use client";
/**
 * The Settings tour's ending (v2): the five-objective strip, the quiz intro,
 * the five questions with kind feedback, and the result. Kept apart from the
 * player (no stylesheet imports) so a test can render it on the server; the
 * player loads its styles. The bonus is never promised twice: with
 * `bonusClaimedAt` the intro and the skip words say the questions are practice.
 */
import { useEffect, useRef, useState } from 'react';
import { ChevronLeft } from 'lucide-react';
import { TroyLivingIcon } from '@crucible/consumer-ui';
import { CompletionConfetti } from '@/components/CompletionConfetti';
import { OBJECTIVES, SETTINGS_ENDING, SETTINGS_REWARD_COPY, SETTINGS_TOUR_COPY, type ObjectiveId } from '@/lib/tour/settings-beats';
import { SETTINGS_QUESTIONS, SETTINGS_QUIZ_VERSION, type SettingsQuizResult } from '@/lib/tour/settings-quiz';
import { formatDay, settingsRewardMessage } from '@/lib/tour/settings-tour';
import { rewardCelebrates, type TourReward } from '@/lib/tour/reward';
import { Check } from './SettingsScenes';
import type { SettingsTourPlayerProps } from './SettingsTourPlayer';

/** The five objectives on the card: each ticks the moment its chapter finishes. `confirmed` fills them gold after a passed quiz. */
export function Strip({ done, confirmed }: { done: ReadonlySet<ObjectiveId>; confirmed?: boolean }) {
  return <div className="st-strip" data-confirmed={!!confirmed} role="list" aria-label={SETTINGS_TOUR_COPY.objectivesLabel}>
    {OBJECTIVES.map(o => {
      const on = confirmed || done.has(o.id);
      return <span key={o.id} role="listitem" className="st-strip__item" data-done={on}>
        <Check size={18} done={on} pop={on} /><span>{o.short}</span><span className="et-sr">{on ? ', learned' : ', not yet'}</span>
      </span>;
    })}
  </div>;
}

type Phase = 'intro' | 'quiz' | 'result';

/** The ending: the questions (or skip), then the result. Kind feedback: every answer gets its reason, never a scolding. */
export function Ending({ nudge, onFinish, onDone, quizOnly, bonusClaimedAt, reduced, done, onBack }: SettingsTourPlayerProps & { reduced: boolean; done: ReadonlySet<ObjectiveId>; onBack: () => void }) {
  const claimed = !!bonusClaimedAt;
  const [phase, setPhase] = useState<Phase>(quizOnly ? 'quiz' : 'intro');
  const [q, setQ] = useState(0);
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [result, setResult] = useState<SettingsQuizResult | null>(null);
  const [reward, setReward] = useState<TourReward | null>(null);
  const [skipped, setSkipped] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus({ preventScroll: true }); }, [phase, q]);

  async function send(withAnswers: boolean) {
    if (busy) return;
    setBusy(true); setError('');
    try {
      const out = await onFinish(withAnswers ? { version: SETTINGS_QUIZ_VERSION, answers } : null);
      if (!withAnswers) { setSkipped(true); setReward(out.reward); setPhase('result'); return; }
      if (!out.quiz) throw new Error('Your answers could not be checked. Try again.');
      setResult(out.quiz);
      if (out.quiz.passed) { setReward(out.reward); setPhase('result'); return; }
      const miss = SETTINGS_QUESTIONS.findIndex(x => out.quiz!.review.find(r => r.id === x.id)?.right === false);
      setQ(Math.max(0, miss));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Your answers could not be checked. Try again.');
    } finally { setBusy(false); }
  }

  if (phase === 'result') {
    const passed = !!result?.passed && !skipped;
    const celebrate = !!reward && rewardCelebrates(reward);
    const [title, body] = settingsRewardMessage(skipped ? null : reward ?? { status: 'unavailable', calls: 0 }, claimed);
    return <div className="et-end" data-reward={skipped ? 'skipped' : reward?.status ?? 'none'}>
      {celebrate && !reduced && <CompletionConfetti />}
      <div className="et-end__card et-reward" role="group" aria-labelledby="st-end-title">
        <div className="et-reward__icon"><TroyLivingIcon size={84} attention={celebrate} /></div>
        <h2 id="st-end-title" ref={heading} tabIndex={-1}>{title}</h2>
        <p className="et-reward__big" role="status">{body}</p>
        {passed && <><Strip done={done} confirmed /><p className="et-end__small">{SETTINGS_ENDING.confirmed}</p></>}
        {error && <p className="et-end__err" role="alert">{error}</p>}
        <div className="et-end__actions">
          {passed && reward?.status === 'unavailable' && <button type="button" className="et-primary" disabled={busy} onClick={() => void send(true)}>{busy ? SETTINGS_ENDING.finishing : SETTINGS_REWARD_COPY.retry}</button>}
          <button type="button" className={reward?.status === 'unavailable' && passed ? '' : 'et-primary'} onClick={() => onDone(nudge.targets)}>{nudge.button}</button>
          <button type="button" onClick={() => onDone()}>{SETTINGS_REWARD_COPY.close}</button>
        </div>
      </div>
    </div>;
  }

  if (phase === 'intro') return <div className="et-end">
    <div className="et-end__card" role="group" aria-labelledby="st-end-title">
      <p className="et-end__k">{SETTINGS_ENDING.eyebrow}</p>
      <h2 id="st-end-title" ref={heading} tabIndex={-1}>{SETTINGS_ENDING.quizTitle}</h2>
      <p>{claimed ? SETTINGS_ENDING.quizBodyClaimed(formatDay(bonusClaimedAt)) : SETTINGS_ENDING.quizBody}</p>
      <Strip done={done} />
      {error && <p className="et-end__err" role="alert">{error}</p>}
      <div className="et-end__actions">
        <button type="button" className="et-primary" onClick={() => setPhase('quiz')}>{SETTINGS_ENDING.take}</button>
        <button type="button" disabled={busy} onClick={() => void send(false)}>{busy ? SETTINGS_ENDING.finishing : SETTINGS_ENDING.skip}</button>
        <button type="button" onClick={onBack}><ChevronLeft size={16} aria-hidden="true" />{SETTINGS_ENDING.previous}</button>
      </div>
    </div>
  </div>;

  const question = SETTINGS_QUESTIONS[q];
  const review = result?.review.find(r => r.id === question.id);
  const last = q === SETTINGS_QUESTIONS.length - 1;
  return <div className="et-end">
    <div className="et-end__card st-quiz" role="group" aria-labelledby="st-end-title">
      <section className="orientation-quiz" aria-label={SETTINGS_ENDING.quizTitle}>
        <p className="orientation-kicker">{SETTINGS_ENDING.questionOf(q + 1, SETTINGS_QUESTIONS.length)}</p>
        <h3 id="st-end-title" ref={heading} tabIndex={-1}>{question.prompt}</h3>
        <form onSubmit={e => { e.preventDefault(); if (!last) setQ(n => n + 1); else void send(true); }}>
          <fieldset key={question.id} disabled={busy}>
            <legend className="et-sr">{question.prompt}</legend>
            {question.choices.map((choice, value) => <label key={value}>
              <input type="radio" required name={`settings-${question.id}`} value={value} checked={answers[question.id] === value}
                onChange={() => setAnswers(a => ({ ...a, [question.id]: value }))} /><span>{choice}</span>
            </label>)}
          </fieldset>
          {review && <p className="orientation-review" data-right={review.right}><b>{review.right ? SETTINGS_ENDING.right : SETTINGS_ENDING.notQuite}</b> {review.explanation}</p>}
          {result && !result.passed && <p className="orientation-review" role="status">{SETTINGS_ENDING.missed(result.correct, result.total)}</p>}
          {error && <p className="orientation-review" role="alert">{error}</p>}
          <div className="orientation-question-actions">
            <button type="button" className="orientation-back" disabled={busy || (q === 0 && !!quizOnly)} onClick={() => (q === 0 ? setPhase('intro') : setQ(n => n - 1))}>{SETTINGS_ENDING.back}</button>
            <button className="orientation-primary" type="submit" disabled={busy || answers[question.id] === undefined}>
              {busy ? SETTINGS_ENDING.checking : !last ? SETTINGS_ENDING.nextQuestion : result ? SETTINGS_ENDING.checkAgain : SETTINGS_ENDING.check}
            </button>
          </div>
        </form>
      </section>
    </div>
  </div>;
}

