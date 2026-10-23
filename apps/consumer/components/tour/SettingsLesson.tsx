"use client";
import { useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { SETTINGS_LESSONS } from '@/lib/orientation-lessons';
import './orientation.css';

/** The guide stays beside real controls and never changes preferences for the reader. */
export function SettingsLesson() {
  const search = useSearchParams();
  const [step, setStep] = useState(0);
  const heading = useRef<HTMLHeadingElement>(null);
  const lesson = SETTINGS_LESSONS[step];
  function go(index: number) { setStep(index); requestAnimationFrame(() => heading.current?.focus()); }
  return <details className="settings-lesson" id="settings-lesson" open={search.get('lesson') === '1' || undefined}>
    <summary>Learn your settings: eight practical lessons</summary>
    <p>Take this at your own pace. Read a lesson, visit the actual controls, then return here. Nothing changes until you use a setting yourself.</p>
    <nav aria-label="Settings lessons">{SETTINGS_LESSONS.map((item, index) => <button type="button" key={item.id} aria-current={index === step ? 'step' : undefined} onClick={() => go(index)}>{index + 1}. {item.id === 'accessibility' ? 'Reading & motion' : item.id[0].toUpperCase() + item.id.slice(1)}</button>)}</nav>
    <h3 ref={heading} tabIndex={-1}>{lesson.title}</h3>
    <p><strong>{lesson.why}</strong></p><p>{lesson.body}</p><p>{lesson.try}</p>
    <a href={`#${lesson.id}`}>Show these controls</a>
    <div className="settings-lesson-controls"><button type="button" disabled={step === 0} onClick={() => go(step - 1)}>Previous lesson</button>{step < SETTINGS_LESSONS.length - 1 ? <button type="button" onClick={() => go(step + 1)}>Next lesson</button> : <a href="/dashboard/orientation">Take the optional orientation check</a>}</div>
    <p className="orientation-small"><a href="/dashboard?tour=1">Return to the main tour</a> · You can revisit any chapter.</p>
  </details>;
}
