"use client";
/**
 * Act one scenes, composed in React (no screenshots) on fixed-size canvases
 * from lib/tour/layout.ts, so the camera frames exactly what is drawn.
 * Each scene is a pure function of the beat and `t`, the milliseconds the
 * beat has been playing: pausing freezes the scene, stepping replays it, and
 * `still` (reduced motion) shows the end state at once.
 */
import type { CSSProperties } from 'react';
import { useTranslations } from 'next-intl';
import { Flag, LockKeyhole, LockKeyholeOpen, Mic, Search } from 'lucide-react';
import { TroyLivingIcon } from '@crucible/consumer-ui';
import { BOARD_STATIONS, type ChartPhase, type LockPhase, type StationId } from '@/lib/tour/beats';
import { BOARD_TILES, CHART, LIMITS_PANEL, LOCK_CARD, METER_PANEL, SCENE_SIZE, TILE, chartRevealAt, chartRows, tileCentre } from '@/lib/tour/layout';
import type { ServiceRow } from '@/lib/tour/services';

const px = (b: { x: number; y: number; w?: number; h?: number }): CSSProperties => ({ left: b.x, top: b.y, ...(b.w ? { width: b.w } : {}), ...(b.h ? { height: b.h } : {}) });
const after = (t: number, ms: number, still: boolean) => still || t >= ms;
type Tr = ReturnType<typeof useTranslations>;
/** A chart row's words by its id, falling back to the English the data file carries. */
export const rowText = (tr: Tr, id: string, field: 'need' | 'limit' | 'here', fallback: string) => (tr.has(`rows.${id}.${field}`) ? tr(`rows.${id}.${field}`) : fallback);

export function TitleScene({ title, body }: { title: string; body: string }) {
  const tr = useTranslations('refineryAccount.tour');
  const { w, h } = SCENE_SIZE.title;
  return <div className="sc" style={{ width: w, height: h }}>
    <div className="sc-grid" />
    <div className="sc-title">
      <div className="sc-rise" style={{ animationDelay: '80ms' }}><TroyLivingIcon size={170} attention /></div>
      <div>
        <p className="sc-title__k sc-rise" style={{ animationDelay: '260ms' }}>{tr('kicker')}</p>
        <p className="sc-title__h sc-rise" style={{ animationDelay: '480ms' }}>{title}</p>
        <p className="sc-title__b sc-rise" style={{ animationDelay: '1200ms' }}>{body}</p>
      </div>
    </div>
  </div>;
}

const ORDER: (keyof typeof BOARD_TILES)[] = ['start', 'find', 'tailor', 'package', 'plan', 'practice', 'track', 'offer'];

export function BoardScene({ station, start, noForge, t, still }: { station?: StationId; start?: boolean; noForge?: boolean; t: number; still: boolean }) {
  const tr = useTranslations('refineryAccount.tour');
  const { w, h } = SCENE_SIZE.board;
  const litIndex = station ? BOARD_STATIONS.findIndex(s => s.id === station) : -1;
  const lit = (id: StationId) => BOARD_STATIONS.findIndex(s => s.id === id) <= litIndex;
  const active = (id: StationId) => id === station;
  const on = (id: StationId, ms: number) => lit(id) && (!active(id) || after(t, ms, still));
  return <div className="sc" style={{ width: w, height: h }}>
    <div className="sc-grid" />
    <svg className="sc-path" width={w} height={h} aria-hidden="true">
      {ORDER.slice(0, -1).map((id, i) => {
        const a = tileCentre(id), b = tileCentre(ORDER[i + 1]);
        // Segment i leads into station i; the last one leads to the offer.
        return <line key={id} x1={a.x} y1={a.y} x2={b.x} y2={b.y} data-lit={i <= litIndex || (i === ORDER.length - 2 && litIndex === BOARD_STATIONS.length - 1)} />;
      })}
    </svg>

    <div className="sc-tile" data-kind="start" data-active={!!start} style={px(BOARD_TILES.start)}>
      <div className="sc-tile__head"><span className="sc-num" style={{ borderStyle: 'dashed' }}>0</span><p className="sc-tile__label">{noForge ? tr('yourBase') : tr('fromForge')}</p></div>
      <p className="sc-tile__line">{tr('trueHistory')}</p>
      <div className="sc-art" style={{ background: '#2a2620' }}>
        <div className="sc-paper" style={{ left: 54, top: 12, width: 156, height: 170 }}>
          <i className="h" /><i style={{ width: '70%' }} /><i style={{ width: '88%' }} /><i style={{ width: '62%' }} />
          <i style={{ width: '80%' }} /><i style={{ width: '45%' }} /><i style={{ width: '76%' }} /><i style={{ width: '58%' }} />
        </div>
      </div>
    </div>

    {BOARD_STATIONS.map((s, i) => <div key={s.id} className="sc-tile" data-lit={lit(s.id)} data-active={active(s.id)} style={px(BOARD_TILES[s.id])}>
      <div className="sc-tile__head"><span className="sc-num">{i + 1}</span><p className="sc-tile__label">{tr(`stations.${s.id}.label`)}</p></div>
      <p className="sc-tile__line">{tr(`stations.${s.id}.line`)}</p>
      <div className="sc-art">{art(s.id, on, t, still, active(s.id), tr)}</div>
    </div>)}

    <div className="sc-tile" data-kind="offer" data-lit={litIndex === BOARD_STATIONS.length - 1} style={px(BOARD_TILES.offer)}>
      <div className="sc-tile__head"><span className="sc-num"><Flag size={15} aria-hidden="true" /></span><p className="sc-tile__label">{tr('offer')}</p></div>
      <p className="sc-tile__line">{tr('nextStep')}</p>
      <div className="sc-art" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Flag size={84} color={litIndex === BOARD_STATIONS.length - 1 ? '#dbc173' : '#5a5446'} aria-hidden="true" />
      </div>
    </div>
  </div>;
}

function art(id: StationId, on: (id: StationId, ms: number) => boolean, t: number, still: boolean, isActive: boolean, tr: Tr) {
  switch (id) {
    case 'find': {
      const hit = on('find', 900);
      return <>
        <div className="sc-job" style={{ top: 12 }}><b /></div>
        <div className="sc-job" data-hit={hit} style={{ top: 62 }}><b style={{ width: '48%' }} />{hit && <span className="sc-badge">{tr('badge')}</span>}</div>
        <div className="sc-job" style={{ top: 112 }}><b style={{ width: '70%' }} /></div>
        <Search size={34} color="#dbc173" style={{ position: 'absolute', right: 14, top: 14, opacity: hit ? 1 : 0.35, transition: 'opacity 500ms' }} aria-hidden="true" />
      </>;
    }
    case 'tailor': {
      const done = on('tailor', 1000);
      return <>
        <div className="sc-paper" style={{ left: 18, top: 10, width: 150, height: 150 }}>
          <i className="h" /><i className={done ? 'gold' : ''} style={{ width: '84%' }} /><i style={{ width: '78%' }} />
          <i className={done ? 'gold' : ''} style={{ width: '72%' }} /><i style={{ width: '80%' }} /><i style={{ width: '66%' }} />
        </div>
        <span className="sc-chip" style={{ right: 12, top: 16, opacity: done ? 1 : 0.4 }}>{tr('chips.job')}</span>
        <span className="sc-chip" style={{ right: 12, top: 48, opacity: done ? 1 : 0, transform: done ? 'none' : 'translateY(6px)' }}>{tr('chips.facts')}</span>
        <span className="sc-chip" style={{ right: 12, top: 80, opacity: done ? 1 : 0, transform: done ? 'none' : 'translateY(6px)' }}>{tr('chips.copy')}</span>
      </>;
    }
    case 'package': {
      const packed = on('package', 900);
      return <div className="sc-env2" data-packed={packed}>
        <span className="sc-slip2" style={{ left: 64 }}><span className="sc-paper"><i className="h" /><i /><i /><i /></span></span>
        <span className="sc-slip2" style={{ left: 138 }}><span className="sc-paper"><i /><i /><i /><i /></span></span>
        <div className="sc-pocket"><span>{tr('toYou')}</span></div>
      </div>;
    }
    case 'plan':
      return <>
        {(['whenItComes', 'whatISay', 'whatISayNext'] as const).map((line, i) => <div key={line} className="sc-note" data-on={on('plan', 500 + i * 650)} style={{ top: 10 + i * 46 }}>{tr(`notes.${line}`)}</div>)}
      </>;
    case 'practice': {
      const live = on('practice', 300);
      return <>
        <div className="sc-bubble q" style={{ opacity: live ? 1 : 0.4 }}>{tr('question')}</div>
        <div className="sc-bubble a" style={{ opacity: on('practice', 1300) ? 1 : 0, transition: 'opacity 500ms' }}>{tr('answer')}</div>
        <div className="sc-wave" data-on={isActive}>{Array.from({ length: 9 }, (_, i) => <i key={i} style={{ animationDelay: `${i * 90}ms` }} />)}</div>
        <Mic size={26} color="#bc9aff" style={{ position: 'absolute', right: 14, bottom: 14 }} aria-hidden="true" />
      </>;
    }
    case 'track': {
      const steps = (['saved', 'applied', 'interview', 'offer'] as const).map(k => tr(`steps.${k}`));
      const reached = !on('track', 0) ? -1 : still || !isActive ? 3 : Math.min(3, Math.floor(Math.max(0, t - 500) / 750));
      const xs = [36, 100, 176, 244];
      return <>
        <div className="sc-steps">{steps.map((s, i) => <span key={s} data-on={i <= reached}>{s}</span>)}</div>
        <div style={{ position: 'absolute', left: 30, right: 30, top: 103, height: 2, background: '#ffffff1f' }} />
        {reached >= 0 && <span className="sc-marker" style={{ left: xs[reached] }} />}
      </>;
    }
  }
}

export function LockScene({ phase, t, still }: { phase: LockPhase; t: number; still: boolean }) {
  const tr = useTranslations('refineryAccount.tour');
  const { w, h } = SCENE_SIZE.lock;
  const stepLabel = tr('lock.tailorLabel');
  const open = phase !== 'locked' && (phase === 'limits' || after(t, CLICK_AT, still));
  const lim = phase === 'limits';
  return <div className="sc" style={{ width: w, height: h }}>
    <div className="sc-grid" />
    <div className="sc-lock" data-open={open} style={px(LOCK_CARD)}>
      <span className="sc-lock__state">{open ? <LockKeyholeOpen size={18} aria-hidden="true" /> : <LockKeyhole size={18} aria-hidden="true" />}{open ? tr('lock.openEarly') : tr('lock.lockedForNow')}</span>
      <h3>{stepLabel}</h3>
      {open
        ? <p className="sc-open">{tr('lock.isOpen', { step: stepLabel })}</p>
        : <p>{tr('lock.tailorReason')}</p>}
      {!open && <span className="sc-ask" data-ask="true"><TroyLivingIcon size={30} />{tr('lock.ask')}</span>}
      {open && <span className="sc-done"><LockKeyholeOpen size={18} aria-hidden="true" />{tr('lock.opened', { step: stepLabel })}</span>}
    </div>
    <div className="sc-limits" style={{ ...px(LIMITS_PANEL), opacity: lim ? 1 : 0, transform: lim ? 'none' : 'translateY(40px)' }}>
      <div>
        <h4>{tr('lock.actionsPerDay')}</h4>
        <div className="sc-stairs">
          {(['toStart', 'afterTailor', 'afterApply'] as const).map((label, i) => <div key={label}>
            <b style={{ height: `${40 + i * 30}%`, transform: lim && !after(t, 300 + i * 450, still) ? 'scaleY(0)' : 'none' }} />
            <span>{tr(`lock.stairs.${label}`)}</span>
          </div>)}
        </div>
      </div>
      <div className="sc-flow">
        <h4>{tr('lock.needMore')}</h4>
        <div data-on={true}>{tr.rich('lock.flowAsk', { b: (c) => <b>{c}</b> })}</div>
        <div data-on={!lim || after(t, 1800, still)}>{tr.rich('lock.flowEarned', { b: (c) => <b>{c}</b> })}</div>
        <div data-on={!lim || after(t, 2600, still)}>{tr.rich('lock.flowNotYet', { b: (c) => <b>{c}</b> })}</div>
      </div>
    </div>
  </div>;
}

/** Where the cursor goes and clicks in the lock scene, in scene pixels. */
/** Centre of the drawn Ask button: card padding, state line, title, two-line reason, then the button. */
export const ASK_POINT = { x: LOCK_CARD.x + 30 + 150, y: LOCK_CARD.y + 212 };
export const CLICK_AT = 1900;

export function ChartScene({ phase, t, still, rows, gap }: { phase: ChartPhase; t: number; still: boolean; rows: ServiceRow[]; gap: number }) {
  const tr = useTranslations('refineryAccount.tour');
  const { w, h } = SCENE_SIZE.chart;
  const boxes = chartRows(rows.length);
  return <div className="sc" style={{ width: w, height: h }}>
    <div className="sc-grid" />
    <p className="sc-chart__k" style={{ left: CHART.x, top: CHART.y + 10 }}>{tr('chart.kicker')}</p>
    {rows.map((row, i) => <div key={row.id} className="sc-row" data-s={row.status}
      data-on={phase === 'gaps' || after(t, chartRevealAt(i, false, 0), still)}
      data-dim={phase === 'gaps' && i < gap}
      style={{ left: boxes[i].x, top: boxes[i].y, width: boxes[i].w, height: boxes[i].h }}>
      <div className="sc-row__top">
        <span className="sc-row__need">{rowText(tr, row.id, 'need', row.need)}</span>
        <span className="sc-pill" data-s={row.status}>{row.status !== 'here' && row.limit ? rowText(tr, row.id, 'limit', row.limit) : tr(`chart.status.${row.status}`)}</span>
      </div>
      <span className="sc-row__here">{row.status === 'absent' ? rowText(tr, row.id, 'here', row.here) : row.here}</span>
    </div>)}
  </div>;
}

const BARS = 6;
/** Empty, one bar ground to the top, then breadth, then the breadth example held with the honest line. */
export function meterPhase(t: number): 0 | 1 | 2 | 3 { return t < 1400 ? 0 : t < 3800 ? 1 : t < 6200 ? 2 : 3; }
export const METER_SAY = [
  'It fills as you do the work.',
  'One thing, over and over, barely moves it.',
  'A little of everything moves it far.',
  'This one is an example. Yours starts at the real number.',
] as const;
export function MeterScene({ t, still }: { t: number; still: boolean }) {
  const tr = useTranslations('refineryAccount.tour');
  const { w, h } = SCENE_SIZE.meter;
  if (still) {
    return <div className="sc" style={{ width: w, height: h }}>
      <div className="sc-grid" />
      <div className="sc-meter" style={px(METER_PANEL)}>
        <p className="sc-meter__k">{tr('meter.title')}</p>
        <div className="sc-meter__split">
          <MeterExample label={tr('meter.one')} fill={16} bars={[100, 0, 0, 0, 0, 0]} />
          <MeterExample label={tr('meter.many')} fill={72} bars={[50, 45, 55, 40, 50, 45]} />
        </div>
        <p className="sc-meter__say">{tr('meter.say.3')}</p>
      </div>
    </div>;
  }
  const phase = meterPhase(t);
  const bars = phase === 1 ? [100, 0, 0, 0, 0, 0] : phase >= 2 ? [50, 45, 55, 40, 50, 45] : [0, 0, 0, 0, 0, 0];
  const fill = phase === 1 ? 16 : phase >= 2 ? 72 : 0;
  return <div className="sc" style={{ width: w, height: h }}>
    <div className="sc-grid" />
    <div className="sc-meter" style={px(METER_PANEL)}>
      <p className="sc-meter__k">{tr('meter.title')}</p>
      <div className="sc-meter__track"><div className="sc-meter__fill" style={{ width: `${fill}%` }} /></div>
      <div className="sc-meter__bars">{Array.from({ length: BARS }, (_, i) => <div key={i}><b style={{ height: `${bars[i]}%` }} /></div>)}</div>
      <p key={phase} className="sc-meter__say sc-rise">{tr(`meter.say.${phase}`)}</p>
    </div>
  </div>;
}

function MeterExample({ label, fill, bars }: { label: string; fill: number; bars: number[] }) {
  return <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
    <p className="sc-meter__say" style={{ fontSize: 20 }}>{label}</p>
    <div className="sc-meter__track"><div className="sc-meter__fill" style={{ width: `${fill}%` }} /></div>
    <div className="sc-meter__bars" style={{ height: 150, gap: 10 }}>{bars.map((b, i) => <div key={i}><b style={{ height: `${b}%` }} /></div>)}</div>
  </div>;
}

export { TILE };
