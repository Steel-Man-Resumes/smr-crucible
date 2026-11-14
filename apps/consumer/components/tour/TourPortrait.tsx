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
import { useTranslations } from 'next-intl';
import { Flag, LockKeyhole, LockKeyholeOpen, Mic, Search } from 'lucide-react';
import { TroyLivingIcon } from '@crucible/consumer-ui';
import { BOARD_STATIONS, type ChartPhase, type LockPhase, type StationId } from '@/lib/tour/beats';
import { P_CARD, P_LIMITS, P_LOCK_CARD, P_METER, P_ORDER, P_ROW, PORTRAIT_SIZE, PW, chartRevealAt, portraitChartRows, portraitSceneSize } from '@/lib/tour/layout';
import type { ServiceRow } from '@/lib/tour/services';
import { CLICK_AT, meterPhase, rowText } from './TourScenes';

const box = (b: { x: number; y: number; w: number; h: number }): CSSProperties => ({ left: b.x, top: b.y, width: b.w, height: b.h });
const after = (t: number, ms: number, still: boolean) => still || t >= ms;
type Tr = ReturnType<typeof useTranslations>;

export function PortraitTitle({ title, body }: { title: string; body: string }) {
  const tr = useTranslations('refineryAccount.tour');
  const { w, h } = PORTRAIT_SIZE.title;
  return <div className="sc ps" style={{ width: w, height: h }}>
    <div className="ps-title">
      <div className="sc-rise" style={{ animationDelay: '80ms' }}><TroyLivingIcon size={92} attention /></div>
      <p className="ps-k sc-rise" style={{ animationDelay: '260ms' }}>{tr('kicker')}</p>
      <p className="ps-title__h sc-rise" style={{ animationDelay: '480ms' }}>{title}</p>
      <p className="ps-title__b sc-rise" style={{ animationDelay: '1100ms' }}>{body}</p>
    </div>
  </div>;
}

export function PortraitBoard({ station, start, noForge, t, still }: { station?: StationId; start?: boolean; noForge?: boolean; t: number; still: boolean }) {
  const tr = useTranslations('refineryAccount.tour');
  const { w, h } = PORTRAIT_SIZE.board;
  const litIndex = station ? BOARD_STATIONS.findIndex(s => s.id === station) : -1;
  const current = station ? BOARD_STATIONS[litIndex] : null;
  return <div className="sc ps" style={{ width: w, height: h }}>
    {P_ORDER.map((id, i) => {
      const n = BOARD_STATIONS.findIndex(s => s.id === id);
      const lit = id === 'start' || (n >= 0 && n <= litIndex) || (id === 'offer' && litIndex === BOARD_STATIONS.length - 1);
      const label = id === 'start' ? (noForge ? tr('baseResume') : tr('fromForge')) : id === 'offer' ? tr('offer') : tr(`stations.${BOARD_STATIONS[n].id}.label`);
      return <div key={id} className="ps-row" data-lit={lit} data-active={id === station || (id === 'start' && !!start)}
        style={{ top: P_ROW.top + i * (P_ROW.h + P_ROW.gap), height: P_ROW.h, width: PW }}>
        <span className="ps-num">{id === 'start' ? '0' : id === 'offer' ? <Flag size={14} aria-hidden="true" /> : n + 1}</span>
        <span className="ps-row__label">{label}</span>
      </div>;
    })}
    <div className="ps-card" style={box(P_CARD)}>
      {current ? <>
        <p className="ps-card__t">{tr(`stations.${current.id}.label`)}</p>
        <div className="ps-art">{art(current.id, t, still, tr)}</div>
      </> : <>
        <p className="ps-k">{noForge ? tr('yourBase') : tr('fromForge')}</p>
        <p className="ps-card__t">{tr('baseResume')}</p>
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

function art(id: StationId, t: number, still: boolean, tr: Tr) {
  switch (id) {
    case 'find': {
      const hit = after(t, 900, still);
      return <div className="ps-stack">
        <div className="ps-job"><b /><Search size={20} color="#dbc173" aria-hidden="true" /></div>
        <div className="ps-job" data-hit={hit}><b style={{ width: '50%' }} />{hit && <span className="ps-badge">{tr('badge')}</span>}</div>
        <div className="ps-job"><b style={{ width: '66%' }} /></div>
      </div>;
    }
    case 'tailor': {
      const done = after(t, 1000, still);
      return <div className="ps-split">
        <Paper gold={done} />
        <div className="ps-chips">{(['job', 'facts', 'copy'] as const).map((c, i) => <span key={c} className="ps-chip" style={{ opacity: done || i === 0 ? 1 : 0 }}>{tr(`chips.${c}`)}</span>)}</div>
      </div>;
    }
    case 'package': {
      const packed = after(t, 1200, still);
      return <div className="ps-env" data-packed={packed}>
        <span className="ps-slip" style={{ left: 50 }}><Paper /></span>
        <span className="ps-slip" style={{ left: 140 }}><Paper /></span>
        <div className="ps-pocket"><span>{tr('toYou')}</span></div>
      </div>;
    }
    case 'plan':
      return <div className="ps-stack">{(['whenItComes', 'whatISay', 'whatISayNext'] as const).map((line, i) => <div key={line} className="ps-note" data-on={after(t, 500 + i * 650, still)}>{tr(`notes.${line}`)}</div>)}</div>;
    case 'practice':
      return <div className="ps-stack">
        <div className="ps-bubble q">{tr('question')}</div>
        <div className="ps-bubble a" style={{ opacity: after(t, 1300, still) ? 1 : 0 }}>{tr('answer')}</div>
        <div className="ps-wave"><Mic size={20} color="#bc9aff" aria-hidden="true" />{Array.from({ length: 9 }, (_, i) => <i key={i} style={{ animationDelay: `${i * 90}ms` }} />)}</div>
      </div>;
    case 'track': {
      const reached = still ? 3 : Math.min(3, Math.floor(Math.max(0, t - 500) / 750));
      return <div className="ps-steps">{(['saved', 'applied', 'interview', 'offer'] as const).map((s, i) => <span key={s} data-on={i <= reached}>{tr(`steps.${s}`)}</span>)}</div>;
    }
  }
}

export function PortraitLock({ phase, t, still }: { phase: LockPhase; t: number; still: boolean }) {
  const tr = useTranslations('refineryAccount.tour');
  const { w, h } = PORTRAIT_SIZE.lock;
  const stepLabel = tr('lock.tailorLabel');
  const open = phase !== 'locked' && (phase === 'limits' || after(t, CLICK_AT, still));
  const lim = phase === 'limits';
  return <div className="sc ps" style={{ width: w, height: h }}>
    <div className="ps-lock" data-open={open} style={box(P_LOCK_CARD)}>
      <span className="ps-k ps-lock__state">{open ? <LockKeyholeOpen size={16} aria-hidden="true" /> : <LockKeyhole size={16} aria-hidden="true" />}{open ? tr('lock.openEarly') : tr('lock.lockedForNow')}</span>
      <p className="ps-card__t">{stepLabel}</p>
      {open ? <p className="ps-body ps-open">{tr('lock.isOpen', { step: stepLabel })}</p> : <p className="ps-body">{tr('lock.tailorReason')}</p>}
      {open ? <span className="ps-done">{tr('lock.opened', { step: stepLabel })}</span>
        : <span className="ps-ask" data-pressed={!still && t >= CLICK_AT - 100}><TroyLivingIcon size={26} />{tr('lock.ask')}</span>}
    </div>
    <div className="ps-limits" style={{ ...box(P_LIMITS), opacity: lim ? 1 : 0 }}>
      <p className="ps-k">{tr('lock.actionsPerDay')}</p>
      <div className="ps-stairs">{(['toStart', 'afterTailor', 'afterApply'] as const).map((label, i) => <div key={label}>
        <b style={{ height: `${36 + i * 30}%`, transform: lim && !after(t, 300 + i * 450, still) ? 'scaleY(0)' : 'none' }} /><span>{tr(`lock.stairs.${label}`)}</span>
      </div>)}</div>
      <p className="ps-k">{tr('lock.needMore')}</p>
      <div className="ps-flow">
        <div data-on={true}>{tr.rich('lock.flowAsk', { b: (c) => <b>{c}</b> })}</div>
        <div data-on={!lim || after(t, 1800, still)}>{tr.rich('lock.flowEarned', { b: (c) => <b>{c}</b> })}</div>
        <div data-on={!lim || after(t, 2600, still)}>{tr.rich('lock.flowNotYet', { b: (c) => <b>{c}</b> })}</div>
      </div>
    </div>
  </div>;
}

export function PortraitChart({ phase, t, still, rows, gap, panAt }: { phase: ChartPhase; t: number; still: boolean; rows: ServiceRow[]; gap: number; panAt: number }) {
  const tr = useTranslations('refineryAccount.tour');
  const { w, h } = portraitSceneSize('chart', rows.length);
  const list = portraitChartRows(rows.length);
  return <div className="sc ps" style={{ width: w, height: h }}>
    <p className="ps-k" style={{ position: 'absolute', left: 0, top: 10 }}>{tr('chart.portraitKicker')}</p>
    {rows.map((row, i) => <div key={row.id} className="ps-crow" data-s={row.status}
      data-on={phase === 'gaps' || after(t, chartRevealAt(i, true, panAt), still)} data-dim={phase === 'gaps' && i < gap} style={box(list[i])}>
      <span className="ps-crow__need">{rowText(tr, row.id, 'need', row.need)}</span>
      <span className="sc-pill ps-pill" data-s={row.status}>{row.status !== 'here' && row.limit ? rowText(tr, row.id, 'limit', row.limit) : tr(`chart.status.${row.status}`)}</span>
    </div>)}
  </div>;
}

export function PortraitMeter({ t, still }: { t: number; still: boolean }) {
  const tr = useTranslations('refineryAccount.tour');
  const { w, h } = PORTRAIT_SIZE.meter;
  const phase = still ? 3 : meterPhase(t);
  const bars = phase === 1 ? [100, 0, 0, 0, 0, 0] : phase >= 2 ? [50, 45, 55, 40, 50, 45] : [0, 0, 0, 0, 0, 0];
  const fill = phase === 1 ? 16 : phase >= 2 ? 72 : 0;
  return <div className="sc ps" style={{ width: w, height: h }}>
    <div className="ps-meter" style={box(P_METER)}>
      <p className="ps-k">{tr('meter.title')}</p>
      <div className="sc-meter__track"><div className="sc-meter__fill" style={{ width: `${fill}%` }} /></div>
      <div className="sc-meter__bars ps-bars">{bars.map((b, i) => <div key={i}><b style={{ height: `${b}%` }} /></div>)}</div>
      <p key={phase} className="ps-body sc-rise">{tr(`meter.say.${phase}`)}</p>
    </div>
  </div>;
}
