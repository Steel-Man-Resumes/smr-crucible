"use client";

import { useEffect, useState, type CSSProperties } from 'react';
import { TROY_MARK_SRC } from './TroyMark';

export type TroyWorkTopic = 'resume' | 'jobs' | 'interview' | 'support' | 'plan' | 'coach';
/** A visual metaphor for the named task, never a simulation of hidden reasoning. */
export function TroyWork({ topic = 'coach', label = 't.ROY is working on your request', compact = false, decorative = false }: {
  topic?: TroyWorkTopic; label?: string; compact?: boolean; decorative?: boolean;
}) {
  const [paused, setPaused] = useState(false);
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    const sync = () => setHidden(document.hidden);
    sync(); document.addEventListener('visibilitychange', sync);
    return () => document.removeEventListener('visibilitychange', sync);
  }, []);
  return <span className={`troy-work ${compact ? 'troy-work--compact' : ''}`} data-topic={topic} data-paused={paused || hidden} aria-hidden={decorative || undefined}>
    <span className="troy-work__scene" aria-hidden="true">
      <span className="troy-work__aura" />
      <img src={TROY_MARK_SRC} alt="" draggable={false} className="troy-work__figure" />
      <svg className="troy-work__canvas" viewBox="0 0 160 100" fill="none">
        {topic === 'resume' ? <g><rect x="88" y="14" width="54" height="72" rx="5" /><path className="troy-work__draw" d="M98 30h23 M98 42h34 M98 54h28 M98 66h32" /><path className="troy-work__scan" d="M94 38h42" /></g>
          : topic === 'jobs' ? <g><rect x="88" y="26" width="54" height="46" rx="5" /><path d="M103 26v-8h23v8 M88 44h54 M112 41v8" /><circle className="troy-work__scan" cx="128" cy="57" r="12" /><path d="m137 66 10 10" /></g>
          : topic === 'interview' ? <g><path className="troy-work__draw" d="M85 22h53v33h-28l-12 10V55H85Z M111 68h34v16h-9l-7 7v-7h-18Z" /><path className="troy-work__wave" d="M95 40v-5m7 10V30m7 17V28m7 16V32m7 8v-4" /></g>
          : topic === 'support' || topic === 'plan' ? <g><path className="troy-work__draw" d="M88 76h18V55h17V33h19" /><circle cx="88" cy="76" r="5" /><circle cx="123" cy="55" r="5" /><path className="troy-work__scan" d="m135 22 7 11-7 11" /></g>
          : <g><path className="troy-work__draw" d="M89 31h51v33h-24l-13 12V64H89Z" /><path className="troy-work__wave" d="M98 48h6m5 0h6m5 0h10" /></g>}
      </svg>
      {Array.from({ length: 12 }, (_, i) => <i key={i} className="troy-work__particle" style={{ '--i': i, '--px': `${24 + (i * 17) % 58}%`, '--py': `${18 + (i * 23) % 65}%` } as CSSProperties} />)}
    </span>
    {!decorative && <span className="troy-work__copy"><span role="status">{label}</span>{!compact && <button type="button" onClick={() => setPaused(v => !v)} aria-pressed={paused}>{paused ? 'Resume animation' : 'Pause animation'}</button>}</span>}
    <style>{CSS}</style>
  </span>;
}

const CSS = `
.troy-work{display:inline-flex;align-items:center;gap:12px;max-width:100%;vertical-align:middle;color:inherit}
.troy-work__scene{position:relative;display:block;width:160px;height:100px;flex:0 0 160px;isolation:isolate;overflow:hidden;border-radius:12px;background:radial-gradient(ellipse at 38% 55%,#7c3aed24,transparent 68%)}
.troy-work__figure{position:absolute;left:9px;top:14px;width:68px;height:74px;object-fit:contain;filter:drop-shadow(0 0 8px #9b73ed99);animation:smr-concentrate 3.8s ease-in-out infinite}
.troy-work__aura{position:absolute;left:16px;top:24px;width:60px;height:60px;border:1px solid #b59af3;box-shadow:0 0 22px #8b5cf64d;border-radius:42% 58% 69% 31%;animation:smr-morph 4.6s ease-in-out infinite}
.troy-work__canvas{position:absolute;inset:0;width:100%;height:100%;stroke:#b49be4;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
.troy-work__draw{stroke-dasharray:220;animation:smr-inscribe 4.8s ease-in-out infinite}
.troy-work__scan{stroke:#d9b879;animation:smr-consider 3s ease-in-out infinite}
.troy-work__wave{transform-origin:110px 40px;animation:smr-answer 1.9s ease-in-out infinite}
.troy-work__particle{position:absolute;left:var(--px);top:var(--py);width:3px;height:3px;border-radius:1px;background:#bca0ff;box-shadow:0 0 5px #8b5cf6;animation:smr-gather 2.8s ease-in-out infinite;animation-delay:calc(var(--i)*-.23s)}
.troy-work__copy{display:flex;flex-direction:column;gap:5px;font-size:13px;line-height:1.5;min-width:0}
.troy-work__copy button{align-self:flex-start;min-height:32px;padding:3px 0;background:none;border:0;color:inherit;font:inherit;font-size:11px;text-decoration:underline;cursor:pointer}
.troy-work__copy button:focus-visible{outline:2px solid currentColor;outline-offset:3px}
.troy-work--compact{gap:6px}.troy-work--compact .troy-work__scene{width:32px;height:32px;flex-basis:32px;overflow:visible;background:none}.troy-work--compact .troy-work__figure{inset:0;width:32px;height:32px}.troy-work--compact .troy-work__canvas{display:none}.troy-work--compact .troy-work__aura{left:3px;top:4px;width:24px;height:24px}.troy-work--compact .troy-work__particle{width:2px;height:2px}
.troy-work[data-paused=true] *{animation-play-state:paused!important}
@keyframes smr-concentrate{0%,100%{transform:translateY(0)}50%{transform:translateY(-3px)}}
@keyframes smr-morph{0%,100%{border-radius:42% 58% 69% 31%;transform:scale(.9)}50%{border-radius:67% 33% 39% 61%;transform:scale(1.1)}}
@keyframes smr-inscribe{0%{stroke-dashoffset:220;opacity:.45}65%,100%{stroke-dashoffset:0;opacity:1}}
@keyframes smr-consider{0%,100%{transform:translateY(-3px);opacity:.5}50%{transform:translateY(3px);opacity:1}}
@keyframes smr-answer{0%,100%{transform:scaleY(.65)}50%{transform:scaleY(1)}}
@keyframes smr-gather{0%,100%{transform:translate(-9px,5px) scale(.6);opacity:.2}50%{transform:translate(8px,-5px) scale(1.2);opacity:.9}}
@media(prefers-reduced-motion:reduce){.troy-work *{animation:none!important}.troy-work__particle{display:none}}
html.reduce-motion .troy-work *{animation:none!important}html.reduce-motion .troy-work__particle{display:none}
@media(max-width:420px){.troy-work:not(.troy-work--compact){flex-wrap:wrap}}
`;
