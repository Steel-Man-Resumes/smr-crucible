"use client";
/**
 * The Settings tour's stage scenes (v2), composed in React on fixed canvases so
 * the camera frames exactly what is drawn: the goal card, the map of the eight
 * sections, and the recap. A drawn map of the real sections and their real
 * control names, not a screenshot. Phones get scenes composed for a tall screen.
 * Every scene is a function of `t`, the ms the beat has played, so Pause freezes
 * it and motion-off (`still`) shows the end state at once.
 */
import { TroyLivingIcon } from '@crucible/consumer-ui';
import { MAP_TILES, OBJECTIVES, SETTINGS_TOUR_COPY, type ObjectiveId } from '@/lib/tour/settings-beats';
import { MAP_SCENE, P_MAP, mapTileBox, portraitMapHeight, portraitMapRows } from '@/lib/tour/settings-camera';

export const GOAL_SCENE = { w: 1280, h: 720 };
export const P_GOAL_SCENE = { w: 320, h: 600 };
export const RECAP_SCENE = { w: 1280, h: 720 };
export const P_RECAP_SCENE = { w: 320, h: 560 };

const on = (t: number, ms: number, still: boolean) => still || t >= ms;

/** A drawn check mark; it strokes itself in when it appears. */
export function Check({ size = 22, done, pop }: { size?: number; done: boolean; pop?: boolean }) {
  return <svg className="st-check" data-done={done} data-pop={!!pop} width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
    <circle cx="12" cy="12" r="10.5" />
    <path d="M7 12.5 L10.5 16 L17 8.5" />
  </svg>;
}

/**
 * When each part of the goal card appears, ms into the beat, slowed by the goal's
 * pace (Troy 2026-10-26: 1.75 times slower than the first cut): the rise delays,
 * the five agenda lines, then the small print.
 */
export function goalTimes(pace = 1) {
  const p = (ms: number) => Math.round(ms * pace);
  return { rise: [80, 220, 400, 900].map(p), agenda: OBJECTIVES.map((_, k) => p(2600 + k * 650)), small: p(6000) };
}
interface GoalProps { title: string; body: string; t: number; still: boolean; pace?: number; claimed?: boolean }

export function GoalScene({ title, body, t, still, pace, claimed }: GoalProps) {
  const g = goalTimes(pace);
  return <div className="sc" style={{ width: GOAL_SCENE.w, height: GOAL_SCENE.h }}>
    <div className="sc-grid" />
    <div className="st-goal">
      <div className="sc-rise" style={{ animationDelay: `${g.rise[0]}ms` }}><TroyLivingIcon size={150} attention /></div>
      <div className="st-goal__text">
        <p className="sc-title__k sc-rise" style={{ animationDelay: `${g.rise[1]}ms` }}>{SETTINGS_TOUR_COPY.goalKicker}</p>
        <p className="st-goal__h sc-rise" style={{ animationDelay: `${g.rise[2]}ms` }}>{title}</p>
        <p className="st-goal__b sc-rise" style={{ animationDelay: `${g.rise[3]}ms` }}>{body}</p>
        <ol className="st-agenda">
          {OBJECTIVES.map((o, k) => <li key={o.id} data-on={on(t, g.agenda[k], still)}><span className="sc-num">{k + 1}</span>{o.agenda}</li>)}
        </ol>
        <p className="st-goal__s" data-on={on(t, g.small, still)}>{claimed ? SETTINGS_TOUR_COPY.goalSmallClaimed : SETTINGS_TOUR_COPY.goalSmall}</p>
      </div>
    </div>
  </div>;
}

export function PortraitGoal({ title, body, t, still, pace, claimed }: GoalProps) {
  const g = goalTimes(pace);
  return <div className="sc ps" style={{ width: P_GOAL_SCENE.w, height: P_GOAL_SCENE.h }}>
    <div className="st-pgoal">
      <p className="ps-k">{SETTINGS_TOUR_COPY.goalKicker}</p>
      <p className="ps-title__h">{title}</p>
      <p className="ps-title__b">{body}</p>
      <ol className="st-agenda st-agenda--p">
        {OBJECTIVES.map((o, k) => <li key={o.id} data-on={on(t, g.agenda[k], still)}><span className="ps-num">{k + 1}</span>{o.agenda}</li>)}
      </ol>
      <p className="st-goal__s" data-on={on(t, g.small, still)}>{claimed ? SETTINGS_TOUR_COPY.goalSmallClaimed : SETTINGS_TOUR_COPY.goalSmall}</p>
    </div>
  </div>;
}

export function MapScene({ active }: { active: number }) {
  return <div className="sc" style={{ width: MAP_SCENE.w, height: MAP_SCENE.h }}>
    <div className="sc-grid" />
    <p className="st-map__k" style={{ left: 70, top: 34 }}>{SETTINGS_TOUR_COPY.mapKicker}</p>
    {MAP_TILES.map((tile, k) => {
      const b = mapTileBox(k);
      return <div key={tile.id} className="st-tile" data-active={k === active} data-lit={active >= 0 && k <= active} style={{ left: b.x, top: b.y, width: b.w, height: b.h }}>
        <div className="st-tile__head"><span className="sc-num">{k + 1}</span><p className="st-tile__label">{tile.label}</p></div>
        <ul className="st-tile__list">{tile.controls.map(c => <li key={c}>{c}</li>)}</ul>
      </div>;
    })}
  </div>;
}

export function PortraitMap({ open }: { open: number }) {
  const rows = portraitMapRows(open);
  return <div className="sc ps" style={{ width: P_MAP.w, height: portraitMapHeight() }}>
    {MAP_TILES.map((tile, k) => <div key={tile.id} className="st-prow" data-active={k === open} data-lit={open >= 0 && k <= open} style={{ top: rows[k].y, height: rows[k].h, width: P_MAP.w }}>
      <div className="st-prow__head"><span className="ps-num">{k + 1}</span><span className="ps-row__label">{tile.label}</span></div>
      <ul className="st-prow__list" aria-hidden={k !== open}>{tile.controls.map(c => <li key={c}>{c}</li>)}</ul>
    </div>)}
  </div>;
}

/** The recap: one line per objective, each appearing with its tick. */
export function RecapScene({ title, t, still, hold, done, portrait }: { title: string; t: number; still: boolean; hold: number; done: ReadonlySet<ObjectiveId>; portrait: boolean }) {
  const step = Math.max(900, (hold - 1600) / OBJECTIVES.length);
  const size = portrait ? P_RECAP_SCENE : RECAP_SCENE;
  return <div className={`sc${portrait ? ' ps' : ''}`} style={{ width: size.w, height: size.h }}>
    {!portrait && <div className="sc-grid" />}
    <div className={portrait ? 'st-precap' : 'st-recap'}>
      <p className={portrait ? 'ps-k' : 'sc-title__k'}>{SETTINGS_TOUR_COPY.goalKicker}</p>
      <p className={portrait ? 'ps-title__h' : 'st-goal__h'}>{title}</p>
      <ul className="st-recap__list">
        {OBJECTIVES.map((o, k) => {
          const shown = on(t, 700 + k * step, still);
          return <li key={o.id} data-on={shown}><Check size={portrait ? 22 : 30} done={shown && done.has(o.id)} pop={shown && !still} /><span>{o.recap}</span></li>;
        })}
      </ul>
    </div>
  </div>;
}
