"use client";
import { useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { SETTINGS_LESSONS } from '@/lib/orientation-lessons';
import './orientation.css';

/** The guide stays beside real controls and never changes preferences for the reader. */
export function SettingsLesson() {
  const t = useTranslations('refineryAccount.lesson');
  const search = useSearchParams();
  const [step, setStep] = useState(0);
  const heading = useRef<HTMLHeadingElement>(null);
  const lesson = SETTINGS_LESSONS[step];
  function go(index: number) { setStep(index); requestAnimationFrame(() => heading.current?.focus()); }
  return <details className="settings-lesson" id="settings-lesson" open={search.get('lesson') === '1' || undefined}>
    <summary>{t('summary')}</summary>
    <p>{t('intro')}</p>
    <nav aria-label={t('navAria')}>{SETTINGS_LESSONS.map((item, index) => <button type="button" key={item.id} aria-current={index === step ? 'step' : undefined} onClick={() => go(index)}>{index + 1}. {t.has(`tabs.${item.id}`) ? t(`tabs.${item.id}`) : item.id === 'accessibility' ? 'Reading & motion' : item.id[0].toUpperCase() + item.id.slice(1)}</button>)}</nav>
    <h3 ref={heading} tabIndex={-1}>{t.has(`lessons.${lesson.id}.title`) ? t(`lessons.${lesson.id}.title`) : lesson.title}</h3>
    <p><strong>{t.has(`lessons.${lesson.id}.why`) ? t(`lessons.${lesson.id}.why`) : lesson.why}</strong></p><p>{t.has(`lessons.${lesson.id}.body`) ? t(`lessons.${lesson.id}.body`) : lesson.body}</p><p>{t.has(`lessons.${lesson.id}.try`) ? t(`lessons.${lesson.id}.try`) : lesson.try}</p>
    <a href={`#${lesson.id}`}>{t('showControls')}</a>
    <div className="settings-lesson-controls"><button type="button" disabled={step === 0} onClick={() => go(step - 1)}>{t('previous')}</button>{step < SETTINGS_LESSONS.length - 1 ? <button type="button" onClick={() => go(step + 1)}>{t('next')}</button> : <a href="/dashboard/orientation">{t('orientationCheck')}</a>}</div>
    <p className="orientation-small"><a href="/dashboard?tour=1">{t('mainTour')}</a> · {t('revisit')}</p>
  </details>;
}
