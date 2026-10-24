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
function tileBox(id: keyof typeof BOARD_TILES): Box {
  const t = BOARD_TILES[id];
  return { x: t.x - PAD, y: t.y - PAD, w: TILE.w + PAD * 2, h: TILE.h + PAD * 2 };
}

/** Centre of a tile's edge, for drawing the path between stations. */
export function tileCentre(id: keyof typeof BOARD_TILES) {
  const t = BOARD_TILES[id];
  return { x: t.x + TILE.w / 2, y: t.y + TILE.h / 2 };
}

export const LOCK_CARD: Box = { x: 360, y: 110, w: 560, h: 340 };
export const LIMITS_PANEL: Box = { x: 170, y: 500, w: 940, h: 250 };
export const METER_PANEL: Box = { x: 170, y: 170, w: 940, h: 440 };

export interface ChartRowBox { x: number; y: number; w: number; h: number }
/** Two columns of cards, the honest gaps last. Wide, so the text stays readable. */
export const CHART = { x: 70, y: 40, w: 1460, gap: 36, rowsTop: 100, rowH: 78, rowGap: 10 };
export function chartRows(count: number, cols: 1 | 2 = 2): ChartRowBox[] {
  const perCol = cols === 1 ? count : Math.max(1, Math.ceil(count / 2));
  const w = cols === 1 ? CHART_NARROW.w - CHART.x * 2 : (CHART.w - CHART.gap) / 2;
  return Array.from({ length: count }, (_, i) => {
    const col = i < perCol ? 0 : 1;
    const row = col ? i - perCol : i;
    return { x: CHART.x + col * (w + CHART.gap), y: CHART.rowsTop + row * (CHART.rowH + CHART.rowGap), w, h: CHART.rowH };
  });
}
/** On a phone the chart is one column and the camera pans down it in two shots. */
export const CHART_NARROW = { w: 760, firstShot: 6 };
export function chartSceneSize(count: number, narrow: boolean) {
  if (!narrow) return SCENE_SIZE.chart;
  const rows = chartRows(count, 1);
  return { w: CHART_NARROW.w, h: (rows.length ? rows[rows.length - 1].y + rows[rows.length - 1].h : CHART.rowsTop) + 60 };
}
/** When a row appears on the 'rows' beat, ms into the beat. Narrow: the second half waits for the pan. */
export function chartRevealAt(i: number, narrow: boolean, panAt: number): number {
  if (!narrow || i < CHART_NARROW.firstShot) return 600 + i * 240;
  return panAt + 700 + (i - CHART_NARROW.firstShot) * 240;
}

/** A named spot in a scene. Chart spots depend on the row data, so they take it. */
export function spotBox(scene: StageSceneId, spot: string | undefined, chart?: { rows: number; gapStart: number; narrow?: boolean }): Box | null {
  if (!spot) return null;
  if (scene === 'board') {
    if (spot === 'board') return { x: 70, y: 70, w: 1460, h: 720 };
    if (spot in BOARD_TILES) return tileBox(spot as keyof typeof BOARD_TILES);
  }
  if (scene === 'lock') {
    if (spot === 'lock-card') return pad(LOCK_CARD, 24);
    if (spot === 'limits') return pad(LIMITS_PANEL, 20);
  }
  if (scene === 'meter' && spot === 'meter') return pad(METER_PANEL, 20);
  if (scene === 'chart' && chart) {
    const rows = chartRows(chart.rows, chart.narrow ? 1 : 2);
    if (!rows.length) return null;
    const union = (list: ChartRowBox[], pad: number): Box => {
      const x = Math.min(...list.map(r => r.x)), y = Math.min(...list.map(r => r.y));
      const r = Math.max(...list.map(g => g.x + g.w)), b = Math.max(...list.map(g => g.y + g.h));
      return { x: x - pad, y: y - pad, w: r - x + pad * 2, h: b - y + pad * 2 };
    };
    if (spot === 'chart' && chart.narrow) return union(rows.slice(0, CHART_NARROW.firstShot), 18);
    if (spot === 'chart-rest' && chart.narrow) return union(rows.slice(CHART_NARROW.firstShot, Math.max(CHART_NARROW.firstShot + 1, chart.gapStart)), 18);
    if (spot === 'chart') {
      const bottom = Math.max(...rows.map(r => r.y + r.h));
      return { x: CHART.x - 24, y: CHART.y - 16, w: CHART.w + 48, h: bottom - CHART.y + 40 };
    }
    if (spot === 'chart-gaps' && chart.gapStart < rows.length) return union(rows.slice(chart.gapStart), 18);
  }
  return null;
}

function pad(b: Box, p: number): Box {
  return { x: b.x - p, y: b.y - p, w: b.w + p * 2, h: b.h + p * 2 };
}
