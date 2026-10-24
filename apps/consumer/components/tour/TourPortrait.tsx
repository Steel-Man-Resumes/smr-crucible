"use client";
/**
 * Act one composed for a phone held upright. These are not the landscape
 * scenes shrunk down: each is laid out on a 320 px wide canvas (lib/tour/
 * layout.ts, PW) so the camera lands near 1:1 on a 360 to 390 px screen, and
 * every text rule is 15 px or more (.ps-* in entrance-tour.css), which keeps
 * rendered text at 13 px or more under the camera's scale floor.
 * No inline font sizes in this file; a test checks.
 */
import type { CSSProperties } from 'react';
import { Flag, LockKeyhole, LockKeyholeOpen, Mic, Search } from 'lucide-react';
import { TroyLivingIcon } from '@crucible/consumer-ui';
import { BOARD_STATIONS, type ChartPhase, type LockPhase, type StationId } from '@/lib/tour/beats';
import { P_CARD, P_LIMITS, P_LOCK_CARD, P_METER, P_ORDER, P_ROW, PORTRAIT_SIZE, PW, chartRevealAt, portraitChartRows, portraitSceneSize } from '@/lib/tour/layout';
import { SERVICE_STATUS_LABEL, type ServiceRow } from '@/lib/tour/services';
import { STEP_COPY } from '@/lib/progression-policy';
import { CLICK_AT, meterPhase, METER_SAY } from './TourScenes';

const box = (b: { x: number; y: number; w: number; h: number }): CSSProperties => ({ left: b.x, top: b.y, width: b.w, height: b.h });
const after = (t: number, ms: number, still: boolean) => still || t >= ms;

export function PortraitTitle({ title, body }: { title: string; body: string }) {
  const { w, h } = PORTRAIT_SIZE.title;
  return <div className="sc ps" style={{ width: w, height: h }}>
    <div className="ps-title">
      <div className="sc-rise" style={{ animationDelay: '80ms' }}><TroyLivingIcon size={92} attention /></div>
      <p className="ps-k sc-rise" style={{ animationDelay: '260ms' }}>The Refinery, with t.ROY</p>
      <p className="ps-title__h sc-rise" style={{ animationDelay: '480ms' }}>{title}</p>
      <p className="ps-title__b sc-rise" style={{ animationDelay: '1100ms' }}>{body}</p>
    </div>
  </div>;
}

export function PortraitBoard({ station, start, noForge, t, still }: { station?: StationId; start?: boolean; noForge?: boolean; t: number; still: boolean }) {
  const { w, h } = PORTRAIT_SIZE.board;
  const litIndex = station ? BOARD_STATIONS.findIndex(s => s.id === station) : -1;
  const current = station ? BOARD_STATIONS[litIndex] : null;
  return <div className="sc ps" style={{ width: w, height: h }}>
    {P_ORDER.map((id, i) => {
      const n = BOARD_STATIONS.findIndex(s => s.id === id);
      const lit = id === 'start' || (n >= 0 && n <= litIndex) || (id === 'offer' && litIndex === BOARD_STATIONS.length - 1);
      const label = id === 'start' ? (noForge ? 'Your base resume' : 'From the Forge') : id === 'offer' ? 'The offer' : BOARD_STATIONS[n].label;
      return <div key={id} className="ps-row" data-lit={lit} data-active={id === station || (id === 'start' && !!start)}
        style={{ top: P_ROW.top + i * (P_ROW.h + P_ROW.gap), height: P_ROW.h, width: PW }}>
        <span className="ps-num">{id === 'start' ? '0' : id === 'offer' ? <Flag size={14} aria-hidden="true" /> : n + 1}</span>
        <span className="ps-row__label">{label}</span>
      </div>;
    })}
    <div className="ps-card" style={box(P_CARD)}>
      {current ? <>
        <p className="ps-card__t">{current.label}</p>
        <div className="ps-art">{art(current.id, t, still)}</div>
      </> : <>
        <p className="ps-k">{noForge ? 'Your base' : 'From the Forge'}</p>
        <p className="ps-card__t">Your base resume</p>
        <div className="ps-art"><Paper /></div>
      </>}
    </div>
  </div>;
}

function Paper({ gold = false }: { gold?: boolean }) {
  return <div className="ps-paper">
    <i className="h" /><i className={gold ? 'gold' : ''} style={{ width: '84%' }} /><i style={{ width: '70%' }} /><i className={gold ? 'gold' : ''} style={{ width: '78%' }} />
    <i style={{ width: '62%' }} /><i style={{ width: '80%' }} /><i style={{ width: '56%' }} />
  </div>;
}

function art(id: StationId, t: number, still: boolean) {
  switch (id) {
    case 'find': {
      const hit = after(t, 900, still);
      return <div className="ps-stack">
        <div className="ps-job"><b /><Search size={20} color="#dbc173" aria-hidden="true" /></div>
        <div className="ps-job" data-hit={hit}><b style={{ width: '50%' }} />{hit && <span className="ps-badge">Hires people with records</span>}</div>
        <div className="ps-job"><b style={{ width: '66%' }} /></div>
      </div>;
    }
    case 'tailor': {
      const done = after(t, 1000, still);
      return <div className="ps-split">
        <Paper gold={done} />
        <div className="ps-chips">{['This job', 'Same facts', 'A new copy'].map((c, i) => <span key={c} className="ps-chip" style={{ opacity: done || i === 0 ? 1 : 0 }}>{c}</span>)}</div>
      </div>;
    }
    case 'package': {
      const packed = after(t, 1200, still);
      return <div className="ps-env" data-packed={packed}>
        <span className="ps-slip" style={{ left: 50 }}><Paper /></span>
        <span className="ps-slip" style={{ left: 140 }}><Paper /></span>
        <div className="ps-pocket"><span>To: you</span></div>
      </div>;
    }
    case 'plan':
      return <div className="ps-stack">{['When it comes up', 'What I say', 'What I say next'].map((line, i) => <div key={line} className="ps-note" data-on={after(t, 500 + i * 650, still)}>{line}</div>)}</div>;
    case 'practice':
      return <div className="ps-stack">
        <div className="ps-bubble q">Tell me about a hard day at work.</div>
        <div className="ps-bubble a" style={{ opacity: after(t, 1300, still) ? 1 : 0 }}>Here is one real example.</div>
        <div className="ps-wave"><Mic size={20} color="#bc9aff" aria-hidden="true" />{Array.from({ length: 9 }, (_, i) => <i key={i} style={{ animationDelay: `${i * 90}ms` }} />)}</div>
      </div>;
    case 'track': {
      const reached = still ? 3 : Math.min(3, Math.floor(Math.max(0, t - 500) / 750));
      return <div className="ps-steps">{['Saved', 'Applied', 'Interview', 'Offer'].map((s, i) => <span key={s} data-on={i <= reached}>{s}</span>)}</div>;
    }
  }
}

export function PortraitLock({ phase, t, still }: { phase: LockPhase; t: number; still: boolean }) {
  const { w, h } = PORTRAIT_SIZE.lock;
  const step = STEP_COPY.tailor;
  const open = phase !== 'locked' && (phase === 'limits' || after(t, CLICK_AT, still));
  const lim = phase === 'limits';
  return <div className="sc ps" style={{ width: w, height: h }}>
    <div className="ps-lock" data-open={open} style={box(P_LOCK_CARD)}>
      <span className="ps-k ps-lock__state">{open ? <LockKeyholeOpen size={16} aria-hidden="true" /> : <LockKeyhole size={16} aria-hidden="true" />}{open ? 'Open early' : 'Locked for now'}</span>
      <p className="ps-card__t">{step.label}</p>
      {open ? <p className="ps-body ps-open">{step.label} is open. The recommended preparation is still there when you need it.</p> : <p className="ps-body">{step.reason}</p>}
      {open ? <span className="ps-done">{step.label} opened at your request.</span>
        : <span className="ps-ask" data-pressed={!still && t >= CLICK_AT - 100}><TroyLivingIcon size={26} />Ask t.ROY to open it early</span>}
    </div>
    <div className="ps-limits" style={{ ...box(P_LIMITS), opacity: lim ? 1 : 0 }}>
      <p className="ps-k">AI actions per day</p>
      <div className="ps-stairs">{['To start', 'After you tailor', 'After you apply'].map((label, i) => <div key={label}>
        <b style={{ height: `${36 + i * 30}%`, transform: lim && !after(t, 300 + i * 450, still) ? 'scaleY(0)' : 'none' }} /><span>{label}</span>
      </div>)}</div>
      <p className="ps-k">Need more?</p>
      <div className="ps-flow">
        <div data-on={true}><b>Ask t.ROY.</b></div>
        <div data-on={!lim || after(t, 1800, still)}><b>Earned it?</b> It&apos;s added.</div>
        <div data-on={!lim || after(t, 2600, still)}><b>Not yet?</b> You okay a short note, and Troy reviews it.</div>
      </div>
    </div>
  </div>;
}

export function PortraitChart({ phase, t, still, rows, gap, panAt }: { phase: ChartPhase; t: number; still: boolean; rows: ServiceRow[]; gap: number; panAt: number }) {
  const { w, h } = portraitSceneSize('chart', rows.length);
  const list = portraitChartRows(rows.length);
  return <div className="sc ps" style={{ width: w, height: h }}>
    <p className="ps-k" style={{ position: 'absolute', left: 0, top: 10 }}>What you&apos;d otherwise use</p>
    {rows.map((row, i) => <div key={row.id} className="ps-crow" data-s={row.status}
      data-on={phase === 'gaps' || after(t, chartRevealAt(i, true, panAt), still)} data-dim={phase === 'gaps' && i < gap} style={box(list[i])}>
      <span className="ps-crow__need">{row.need}</span>
      <span className="sc-pill ps-pill" data-s={row.status}>{row.status !== 'here' && row.limit ? row.limit : SERVICE_STATUS_LABEL[row.status]}</span>
    </div>)}
  </div>;
}

export function PortraitMeter({ t, still }: { t: number; still: boolean }) {
  const { w, h } = PORTRAIT_SIZE.meter;
  const phase = still ? 3 : meterPhase(t);
  const bars = phase === 1 ? [100, 0, 0, 0, 0, 0] : phase >= 2 ? [50, 45, 55, 40, 50, 45] : [0, 0, 0, 0, 0, 0];
  const fill = phase === 1 ? 16 : phase >= 2 ? 72 : 0;
  return <div className="sc ps" style={{ width: w, height: h }}>
    <div className="ps-meter" style={box(P_METER)}>
      <p className="ps-k">Steel Man meter, an example</p>
      <div className="sc-meter__track"><div className="sc-meter__fill" style={{ width: `${fill}%` }} /></div>
      <div className="sc-meter__bars ps-bars">{bars.map((b, i) => <div key={i}><b style={{ height: `${b}%` }} /></div>)}</div>
      <p key={phase} className="ps-body sc-rise">{METER_SAY[phase]}</p>
    </div>
  </div>;
}
