/**
 * Composed scene geometry for act one, in scene pixels. The scenes draw from
 * these same numbers, so the camera frames exactly what is drawn.
 */
import type { StageSceneId, StationId } from './beats';
import type { Box } from './geometry';

export const SCENE_SIZE: Record<StageSceneId, { w: number; h: number }> = {
  title: { w: 1280, h: 800 },
  board: { w: 1600, h: 860 },
  lock: { w: 1280, h: 800 },
  chart: { w: 1600, h: 780 },
  meter: { w: 1280, h: 800 },
};

export const TILE = { w: 300, h: 270 };
const COLS = [110, 470, 830, 1190];
const TOP = 110;
const BOTTOM = 480;

/** The board reads as one path: start, three across, down, three back, the offer. */
export const BOARD_TILES: Record<'start' | 'offer' | StationId, { x: number; y: number }> = {
  start: { x: COLS[0], y: TOP },
  find: { x: COLS[1], y: TOP },
  tailor: { x: COLS[2], y: TOP },
  package: { x: COLS[3], y: TOP },
  plan: { x: COLS[3], y: BOTTOM },
  practice: { x: COLS[2], y: BOTTOM },
  track: { x: COLS[1], y: BOTTOM },
  offer: { x: COLS[0], y: BOTTOM },
};

const PAD = 18;
const BOARD_SHOTS: Record<string, (keyof typeof BOARD_TILES)[]> = {
  'start-to-tailor': ['start', 'find', 'tailor'],
  'package-turn': ['package', 'plan'],
  'practice-pair': ['practice', 'plan'],
  'finish-line': ['offer', 'track'],
};
function union(boxes: Box[]): Box {
  const x = Math.min(...boxes.map(b => b.x)), y = Math.min(...boxes.map(b => b.y));
  const r = Math.max(...boxes.map(b => b.x + b.w)), bottom = Math.max(...boxes.map(b => b.y + b.h));
  return { x, y, w: r - x, h: bottom - y };
}
function tileBox(id: keyof typeof BOARD_TILES): Box {
  const t = BOARD_TILES[id];
  return { x: t.x - PAD, y: t.y - PAD, w: TILE.w + PAD * 2, h: TILE.h + PAD * 2 };
}

/** Centre of a tile's edge, for drawing the path between stations. */
export function tileCentre(id: keyof typeof BOARD_TILES) {
  const t = BOARD_TILES[id];
  return { x: t.x + TILE.w / 2, y: t.y + TILE.h / 2 };
}

export const LOCK_CARD: Box = { x: 360, y: 130, w: 560, h: 290 };
export const LIMITS_PANEL: Box = { x: 170, y: 500, w: 940, h: 250 };
export const METER_PANEL: Box = { x: 170, y: 170, w: 940, h: 440 };

export interface ChartRowBox { x: number; y: number; w: number; h: number }
/** Two columns of cards, the honest gaps last. Wide, so the text stays readable. */
export const CHART = { x: 70, y: 40, w: 1460, gap: 36, rowsTop: 100, rowH: 78, rowGap: 10 };
export function chartRows(count: number): ChartRowBox[] {
  const perCol = Math.max(1, Math.ceil(count / 2));
  const w = (CHART.w - CHART.gap) / 2;
  return Array.from({ length: count }, (_, i) => {
    const col = i < perCol ? 0 : 1;
    const row = col ? i - perCol : i;
    return { x: CHART.x + col * (w + CHART.gap), y: CHART.rowsTop + row * (CHART.rowH + CHART.rowGap), w, h: CHART.rowH };
  });
}
/** When a row appears on the 'rows' beat, ms into the beat. Portrait: rows after the first shot wait for the pan. */
export function chartRevealAt(i: number, portrait: boolean, panAt: number): number {
  if (!portrait || i < P_CHART_FIRST) return 600 + i * 240;
  return panAt + 700 + (i - P_CHART_FIRST) * 240;
}

/** A named spot in a scene. Chart spots depend on the row data, so they take it. */
export function spotBox(scene: StageSceneId, spot: string | undefined, chart?: { rows: number; gapStart: number }): Box | null {
  if (!spot) return null;
  if (scene === 'board') {
    if (spot === 'board') return { x: 70, y: 70, w: 1460, h: 720 };
    if (spot in BOARD_TILES) return tileBox(spot as keyof typeof BOARD_TILES);
    // Station shots vary: a pan across, a turn down, a pair, the finish line.
    if (spot in BOARD_SHOTS) return union(BOARD_SHOTS[spot].map(tileBox));
  }
  if (scene === 'lock') {
    if (spot === 'lock-card') return pad(LOCK_CARD, 24);
    if (spot === 'limits') return pad(LIMITS_PANEL, 20);
  }
  if (scene === 'meter' && spot === 'meter') return pad(METER_PANEL, 20);
  if (scene === 'chart' && chart) {
    const rows = chartRows(chart.rows);
    if (!rows.length) return null;
    if (spot === 'chart') {
      const bottom = Math.max(...rows.map(r => r.y + r.h));
      return { x: CHART.x - 24, y: CHART.y - 16, w: CHART.w + 48, h: bottom - CHART.y + 40 };
    }
    if (spot === 'chart-gaps' && chart.gapStart < rows.length) {
      const b = union(rows.slice(chart.gapStart));
      return { x: b.x - 18, y: b.y - 18, w: b.w + 36, h: b.h + 36 };
    }
  }
  return null;
}

function pad(b: Box, p: number): Box {
  return { x: b.x - p, y: b.y - p, w: b.w + p * 2, h: b.h + p * 2 };
}

/* ---------- Portrait (phones): composed for a tall screen, never a shrunk landscape canvas ---------- */

/** Scene width in portrait. At a 390 or 360 px phone the camera lands near 1:1. */
export const PW = 320;
/** Smallest font size used in any portrait scene, in scene pixels (entrance-tour.css .ps-* rules). */
export const PORTRAIT_MIN_FONT = 15;
/** The camera never shrinks a portrait scene below this, so 15 px scene text stays at 13 px or more. */
export const PORTRAIT_MIN_SCALE = 13 / PORTRAIT_MIN_FONT;

export const P_ROW = { h: 44, gap: 5, top: 6 };
export const P_ORDER: ('start' | StationId | 'offer')[] = ['start', 'find', 'tailor', 'package', 'plan', 'practice', 'track', 'offer'];
const P_LIST_H = P_ROW.top + P_ORDER.length * (P_ROW.h + P_ROW.gap);
export const P_CARD: Box = { x: 0, y: P_LIST_H + 14, w: PW, h: 370 };
export const P_LOCK_CARD: Box = { x: 0, y: 0, w: PW, h: 290 };
export const P_LIMITS: Box = { x: 0, y: 306, w: PW, h: 400 };
export const P_METER: Box = { x: 0, y: 0, w: PW, h: 400 };
export const P_CHART = { top: 44, rowH: 60, gap: 6 };

export function portraitChartRows(count: number): ChartRowBox[] {
  return Array.from({ length: count }, (_, i) => ({ x: 0, y: P_CHART.top + i * (P_CHART.rowH + P_CHART.gap), w: PW, h: P_CHART.rowH }));
}

export const PORTRAIT_SIZE: Record<StageSceneId, { w: number; h: number }> = {
  title: { w: PW, h: 500 },
  board: { w: PW, h: P_CARD.y + P_CARD.h + 10 },
  lock: { w: PW, h: P_LIMITS.y + P_LIMITS.h + 10 },
  chart: { w: PW, h: 0 },
  meter: { w: PW, h: P_METER.h + 10 },
};

export function portraitSceneSize(scene: StageSceneId, rows: number) {
  if (scene !== 'chart') return PORTRAIT_SIZE[scene];
  const list = portraitChartRows(rows);
  return { w: PW, h: (list.length ? list[list.length - 1].y + list[list.length - 1].h : P_CHART.top) + 16 };
}

/** Shots of the one-column chart: the first rows, the rest, the gaps. */
export const P_CHART_FIRST = 5;
export function portraitSpot(scene: StageSceneId, spot: string | undefined, chart?: { rows: number; gapStart: number }): Box | null {
  if (!spot) return null;
  if (scene === 'board') {
    if (spot === 'board') return { x: 0, y: 0, w: PW, h: P_LIST_H };
    return P_CARD;
  }
  if (scene === 'lock') return spot === 'limits' ? P_LIMITS : P_LOCK_CARD;
  if (scene === 'meter') return P_METER;
  if (scene === 'chart' && chart) {
    const rows = portraitChartRows(chart.rows);
    const pick = spot === 'chart' ? rows.slice(0, Math.min(P_CHART_FIRST, chart.gapStart))
      : spot === 'chart-rest' ? rows.slice(P_CHART_FIRST, chart.gapStart)
      : rows.slice(chart.gapStart);
    if (!pick.length) return null;
    const b = union(pick);
    return { x: 0, y: b.y - (spot === 'chart' ? P_CHART.top : 8), w: PW, h: b.h + (spot === 'chart' ? P_CHART.top : 8) + 8 };
  }
  return null;
}
