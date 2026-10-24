"use client";
/**
 * Act one scenes, composed in React (no screenshots) on fixed-size canvases
 * from lib/tour/layout.ts, so the camera frames exactly what is drawn.
 * Each scene is a pure function of the beat and `t`, the milliseconds the
 * beat has been playing: pausing freezes the scene, stepping replays it, and
 * `still` (reduced motion) shows the end state at once.
 */
import type { CSSProperties } from 'react';
import { Flag, LockKeyhole, LockKeyholeOpen, Mic, Search } from 'lucide-react';
import { TroyLivingIcon } from '@crucible/consumer-ui';
import { BOARD_STATIONS, type ChartPhase, type LockPhase, type StationId } from '@/lib/tour/beats';
import { BOARD_TILES, CHART, LIMITS_PANEL, LOCK_CARD, METER_PANEL, SCENE_SIZE, TILE, chartRevealAt, chartRows, chartSceneSize, tileCentre } from '@/lib/tour/layout';
import { SERVICE_STATUS_LABEL, type ServiceRow } from '@/lib/tour/services';
import { STEP_COPY } from '@/lib/progression-policy';

const px = (b: { x: number; y: number; w?: number; h?: number }): CSSProperties => ({ left: b.x, top: b.y, ...(b.w ? { width: b.w } : {}), ...(b.h ? { height: b.h } : {}) });
const after = (t: number, ms: number, still: boolean) => still || t >= ms;

export function TitleScene({ title, body }: { title: string; body: string }) {
  const { w, h } = SCENE_SIZE.title;
  return <div className="sc" style={{ width: w, height: h }}>
    <div className="sc-grid" />
    <div className="sc-title">
      <div className="sc-rise" style={{ animationDelay: '80ms' }}><TroyLivingIcon size={170} attention /></div>
      <div>
        <p className="sc-title__k sc-rise" style={{ animationDelay: '260ms' }}>The Refinery, with t.ROY</p>
        <p className="sc-title__h sc-rise" style={{ animationDelay: '480ms' }}>{title}</p>
        <p className="sc-title__b sc-rise" style={{ animationDelay: '1200ms' }}>{body}</p>
      </div>
    </div>
  </div>;
}

const ORDER: (keyof typeof BOARD_TILES)[] = ['start', 'find', 'tailor', 'package', 'plan', 'practice', 'track', 'offer'];

export function BoardScene({ station, start, t, still }: { station?: StationId; start?: boolean; t: number; still: boolean }) {
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
      <div className="sc-tile__head"><span className="sc-num" style={{ borderStyle: 'dashed' }}>0</span><p className="sc-tile__label">From the Forge</p></div>
      <p className="sc-tile__line">Your base resume</p>
      <div className="sc-art" style={{ background: '#2a2620' }}>
        <div className="sc-paper" style={{ left: 54, top: 12, width: 156, height: 170 }}>
          <i className="h" /><i style={{ width: '70%' }} /><i className="rough" style={{ width: '88%' }} /><i className="rough mark" style={{ width: '62%' }} />
          <i style={{ width: '80%' }} /><i className="rough" style={{ width: '45%' }} /><i className="rough mark" style={{ width: '76%' }} /><i style={{ width: '58%' }} />
        </div>
      </div>
    </div>

    {BOARD_STATIONS.map((s, i) => <div key={s.id} className="sc-tile" data-lit={lit(s.id)} data-active={active(s.id)} style={px(BOARD_TILES[s.id])}>
      <div className="sc-tile__head"><span className="sc-num">{i + 1}</span><p className="sc-tile__label">{s.label}</p></div>
      <p className="sc-tile__line">{s.line}</p>
      <div className="sc-art">{art(s.id, on, t, still, active(s.id))}</div>
    </div>)}

    <div className="sc-tile" data-kind="offer" data-lit={litIndex === BOARD_STATIONS.length - 1} style={px(BOARD_TILES.offer)}>
      <div className="sc-tile__head"><span className="sc-num"><Flag size={15} aria-hidden="true" /></span><p className="sc-tile__label">The offer</p></div>
      <p className="sc-tile__line">And then the next step</p>
      <div className="sc-art" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Flag size={84} color={litIndex === BOARD_STATIONS.length - 1 ? '#dbc173' : '#5a5446'} aria-hidden="true" />
      </div>
    </div>
  </div>;
}

function art(id: StationId, on: (id: StationId, ms: number) => boolean, t: number, still: boolean, isActive: boolean) {
  switch (id) {
    case 'find': {
      const hit = on('find', 900);
      return <>
        <div className="sc-job" style={{ top: 12 }}><b /></div>
        <div className="sc-job" data-hit={hit} style={{ top: 62 }}><b style={{ width: '48%' }} />{hit && <span className="sc-badge">Hires people with records</span>}</div>
        <div className="sc-job" style={{ top: 112 }}><b style={{ width: '70%' }} /></div>
        <Search size={34} color="#dbc173" style={{ position: 'absolute', right: 14, top: 14, opacity: hit ? 1 : 0.35, transition: 'opacity 500ms' }} aria-hidden="true" />
      </>;
    }
    case 'tailor': {
      const done = on('tailor', 1000);
      return <>
        <div className="sc-paper" style={{ left: 18, top: 10, width: 150, height: 150 }}>
          <i className="h" /><i className={done ? 'gold' : 'rough'} style={{ width: done ? '84%' : '70%' }} /><i className={done ? '' : 'rough mark'} style={{ width: done ? '78%' : '88%' }} />
          <i className={done ? 'gold' : 'rough'} style={{ width: done ? '72%' : '50%' }} /><i style={{ width: '80%' }} /><i className={done ? '' : 'rough mark'} style={{ width: done ? '66%' : '76%' }} />
        </div>
        <span className="sc-chip" style={{ right: 12, top: 16, opacity: done ? 1 : 0.4 }}>This job</span>
        <span className="sc-chip" style={{ right: 12, top: 48, opacity: done ? 1 : 0, transform: done ? 'none' : 'translateY(6px)' }}>Same facts</span>
        <span className="sc-chip" style={{ right: 12, top: 80, opacity: done ? 1 : 0, transform: done ? 'none' : 'translateY(6px)' }}>A new copy</span>
      </>;
    }
    case 'package': {
      const slid = on('package', 700);
      const closed = on('package', 1700);
      return <>
        <div className="sc-slip" style={{ left: 40, top: 8, transform: slid ? 'translate(14px,40px) rotate(-4deg)' : 'none', opacity: closed ? 0 : 1 }}><div className="sc-paper" style={{ inset: 6, padding: 6, boxShadow: 'none' }}><i className="h" /><i /><i /><i /></div></div>
        <div className="sc-slip" style={{ left: 150, top: 8, transform: slid ? 'translate(-24px,40px) rotate(5deg)' : 'none', opacity: closed ? 0 : 1 }}><div className="sc-paper" style={{ inset: 6, padding: 6, boxShadow: 'none' }}><i /><i /><i /><i /></div></div>
        <div className="sc-env" data-closed={closed}><div className="sc-env__flap" /><span className="sc-env__to">To: you</span></div>
      </>;
    }
    case 'plan':
      return <>
        {['When it comes up', 'What I say', 'What I say next'].map((line, i) => <div key={line} className="sc-note" data-on={on('plan', 500 + i * 650)} style={{ top: 10 + i * 46 }}>{line}</div>)}
      </>;
    case 'practice': {
      const live = on('practice', 300);
      return <>
        <div className="sc-bubble q" style={{ opacity: live ? 1 : 0.4 }}>Tell me about a hard day at work.</div>
        <div className="sc-bubble a" style={{ opacity: on('practice', 1300) ? 1 : 0, transition: 'opacity 500ms' }}>Here is one real example.</div>
        <div className="sc-wave" data-on={isActive}>{Array.from({ length: 9 }, (_, i) => <i key={i} style={{ animationDelay: `${i * 90}ms` }} />)}</div>
        <Mic size={26} color="#bc9aff" style={{ position: 'absolute', right: 14, bottom: 14 }} aria-hidden="true" />
      </>;
    }
    case 'track': {
      const steps = ['Saved', 'Applied', 'Interview', 'Offer'];
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
  const { w, h } = SCENE_SIZE.lock;
  const step = STEP_COPY.tailor;
  const open = phase !== 'locked' && (phase === 'limits' || after(t, CLICK_AT, still));
  const lim = phase === 'limits';
  return <div className="sc" style={{ width: w, height: h }}>
    <div className="sc-grid" />
    <div className="sc-lock" data-open={open} style={px(LOCK_CARD)}>
      <span className="sc-lock__state">{open ? <LockKeyholeOpen size={18} aria-hidden="true" /> : <LockKeyhole size={18} aria-hidden="true" />}{open ? 'Open early' : 'Locked for now'}</span>
      <h3>{step.label}</h3>
      {open
        ? <p className="sc-open">{step.label} is open. The recommended preparation is still there when you need it.</p>
        : <p>{step.reason}</p>}
      {!open && <span className="sc-ask" data-ask="true"><TroyLivingIcon size={30} />Ask t.ROY to open it early</span>}
      {open && <span className="sc-done"><LockKeyholeOpen size={18} aria-hidden="true" />{step.label} opened at your request.</span>}
    </div>
    <div className="sc-limits" style={{ ...px(LIMITS_PANEL), opacity: lim ? 1 : 0.35 }}>
      <div>
        <h4>AI actions per day</h4>
        <div className="sc-stairs">
          {['To start', 'After you tailor', 'After you apply'].map((label, i) => <div key={label}>
            <b style={{ height: `${40 + i * 30}%`, transform: lim && !after(t, 400 + i * 500, still) ? 'scaleY(0)' : 'none' }} />
            <span>{label}</span>
          </div>)}
        </div>
      </div>
      <div className="sc-flow">
        <h4>Need more?</h4>
        <div data-on={!lim || after(t, 2000, still)}><b>Ask t.ROY.</b></div>
        <div data-on={!lim || after(t, 2800, still)}><b>Earned it?</b> It&apos;s added.</div>
        <div data-on={!lim || after(t, 3600, still)}><b>Not yet?</b> You okay a short note, and Troy reviews it.</div>
      </div>
    </div>
  </div>;
}

/** Where the cursor goes and clicks in the lock scene, in scene pixels. */
export const ASK_POINT = { x: LOCK_CARD.x + 30 + 150, y: LOCK_CARD.y + LOCK_CARD.h - 58 };
export const CLICK_AT = 1900;

export function ChartScene({ phase, t, still, rows, gap, narrow = false, panAt = 0 }: { phase: ChartPhase; t: number; still: boolean; rows: ServiceRow[]; gap: number; narrow?: boolean; panAt?: number }) {
  const { w, h } = chartSceneSize(rows.length, narrow);
  const boxes = chartRows(rows.length, narrow ? 1 : 2);
  return <div className="sc" style={{ width: w, height: h }}>
    <div className="sc-grid" />
    <p className="sc-chart__k" style={{ left: CHART.x, top: CHART.y + 10 }}>What you&apos;d otherwise stitch together, and what&apos;s here</p>
    {rows.map((row, i) => <div key={row.id} className="sc-row" data-s={row.status}
      data-on={phase === 'gaps' || after(t, chartRevealAt(i, narrow, panAt), still)}
      data-dim={phase === 'gaps' && i < gap}
      style={{ left: boxes[i].x, top: boxes[i].y, width: boxes[i].w, height: boxes[i].h }}>
      <div className="sc-row__top">
        <span className="sc-row__need">{row.need}</span>
        <span className="sc-pill" data-s={row.status}>{row.status !== 'here' && row.limit ? row.limit : SERVICE_STATUS_LABEL[row.status]}</span>
      </div>
      <span className="sc-row__here">{row.here}</span>
    </div>)}
  </div>;
}

const BARS = 6;
export function MeterScene({ t, still }: { t: number; still: boolean }) {
  const { w, h } = SCENE_SIZE.meter;
  if (still) {
    return <div className="sc" style={{ width: w, height: h }}>
      <div className="sc-grid" />
      <div className="sc-meter" style={px(METER_PANEL)}>
        <p className="sc-meter__k">Steel Man meter (an illustration)</p>
        <div className="sc-meter__split">
          <MeterExample label="One thing, over and over" fill={16} bars={[100, 0, 0, 0, 0, 0]} />
          <MeterExample label="A little of everything" fill={72} bars={[50, 45, 55, 40, 50, 45]} />
        </div>
        <p className="sc-meter__say">It fills as you do the work.</p>
      </div>
    </div>;
  }
  // Empty, then one bar ground to the top, then breadth, then back to empty.
  const phase = t < 1600 ? 0 : t < 4300 ? 1 : t < 7300 ? 2 : 3;
  const bars = phase === 1 ? [100, 0, 0, 0, 0, 0] : phase === 2 ? [50, 45, 55, 40, 50, 45] : [0, 0, 0, 0, 0, 0];
  const fill = phase === 1 ? 16 : phase === 2 ? 72 : 0;
  const say = ['It starts empty and fills as you do the work.', 'One thing, over and over, barely moves it.', 'A little of everything moves it far.', 'That is how Steel Man status gets earned.'][phase];
  return <div className="sc" style={{ width: w, height: h }}>
    <div className="sc-grid" />
    <div className="sc-meter" style={px(METER_PANEL)}>
      <p className="sc-meter__k">Steel Man meter (an illustration)</p>
      <div className="sc-meter__track"><div className="sc-meter__fill" style={{ width: `${fill}%` }} /></div>
      <div className="sc-meter__bars">{Array.from({ length: BARS }, (_, i) => <div key={i}><b style={{ height: `${bars[i]}%` }} /></div>)}</div>
      <p key={phase} className="sc-meter__say sc-rise">{say}</p>
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
