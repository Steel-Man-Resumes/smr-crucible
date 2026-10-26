/**
 * The Settings tour v2 playable slice (SETTINGS-TOUR-V2-STORYBOARD.md section 9):
 * three beats, M1 Map, C1 Coach and X1 Two kinds of help, about 30 s, so the
 * pace and the camera can be judged before the full rebuild.
 *
 * It opens only on /dashboard/settings?tour=settings&slice=1. Without slice=1
 * the v1 tour runs exactly as before. The slice saves nothing: it has no store,
 * no run, no reward, and its component makes no request at all.
 *
 * Pure rules, kept here so they are unit tested without React: the beats and
 * their chips, sweep timing, the eased camera curve, the page shot (scroll,
 * scale and origin for a zoom on the real page) and the stage map's camera.
 */
import { settingsTourRequested, TOP_BAR_PX } from './settings-tour';
import { ACT_CHANGE_MS, ORIENT_MS, holdMs } from './timing';
import type { Box, Camera, Size } from './geometry';

export const SLICE_PARAM = 'slice';

/** True only for the Settings page with ?tour=settings and slice=1. Anything else is the v1 tour or nothing. */
export function settingsSliceRequested(pathname: string | null | undefined, params: { get(name: string): string | null } | null | undefined): boolean {
  return settingsTourRequested(pathname, params) && params?.get(SLICE_PARAM) === '1';
}

export interface SliceChip {
  /** The page's own label for the control. */
  label: string;
  /** Element ids or data-tour ids; every visible match is part of the chip. */
  targets: readonly string[];
}

export interface SliceBeat {
  id: 'm1' | 'c1' | 'x1';
  /** SLOW lights one thing and holds; SWEEP hops chip to chip under one caption. */
  kind: 'slow' | 'sweep';
  where: 'stage' | 'page';
  title: string;
  body: string;
  /** A slow page beat's one target: every visible match is unioned into one cutout. */
  targets?: readonly string[];
  chips?: readonly SliceChip[];
  /** Page zoom cap on wide screens. Phones and motion-off never zoom. */
  zoom?: number;
  /** Per-chip dwell in ms, wide and phone. */
  dwell?: { wide: number; phone: number };
  /** One chip held longer, for a visible pause (X1: after Spanish). */
  split?: { index: number; ms: number };
}

/** The stage map: the Settings page's eight sections (page.tsx SECTIONS) and the real control names in each. */
export const MAP_TILES: readonly { id: string; label: string; controls: readonly string[] }[] = [
  { id: 'account', label: 'Account', controls: ['Resume Contact Info', 'Your picture', 'Join a program with a code', 'Hidden Employers', 'Your finished resume by email'] },
  { id: 'coach', label: 'Coach & AI', controls: ['Coaching style', 'Response length', 'Focus'] },
  { id: 'accessibility', label: 'Accessibility', controls: ['Plain language', 'Read aloud', 'Spanish (Espanol)', 'Text size', 'Motion', 'Spacing'] },
  { id: 'privacy', label: 'Privacy & Consent', controls: ['Who can see what', 'AI memory and personalization', 'De-identified research', 'Share your success story'] },
  { id: 'security', label: 'Security', controls: ['Password', 'Two-step verification', 'Active devices'] },
  { id: 'data', label: 'Data', controls: ['Download your data', 'Delete my data', 'Delete my account'] },
  { id: 'usage', label: 'Usage', controls: ['Daily Usage', 'Your AI usage'] },
  { id: 'help', label: 'Help & About', controls: ['Help & Feedback', 'About'] },
];

export const SLICE_BEATS: readonly SliceBeat[] = [
  { id: 'm1', kind: 'sweep', where: 'stage', title: 'The whole page',
    body: "Eight parts, top to bottom. We'll walk them in order.",
    chips: MAP_TILES.map(t => ({ label: t.label, targets: [t.id] })),
    dwell: { wide: 1100, phone: 1200 } },
  { id: 'c1', kind: 'slow', where: 'page', title: 'How t.ROY talks to you',
    body: "Supportive, balanced or direct. Brief or full answers. Guide me, or just answer. Press save when you're done, or it won't stick.",
    targets: ['settings-coach-choices'], zoom: 1.3 },
  { id: 'x1', kind: 'sweep', where: 'page', title: 'Two kinds of help',
    body: "Plain language, read aloud and Spanish change only t.ROY's answers. Text size, motion and spacing change the whole app, right away.",
    chips: [
      { label: 'Plain language', targets: ['settings-plain-language'] },
      { label: 'Read aloud', targets: ['settings-read-aloud'] },
      { label: 'Spanish (Espanol)', targets: ['settings-spanish'] },
      { label: 'Text size', targets: ['settings-text-size'] },
      { label: 'Motion', targets: ['settings-motion'] },
      { label: 'Spacing', targets: ['settings-spacing'] },
    ],
    dwell: { wide: 1700, phone: 1800 }, split: { index: 2, ms: 2200 } },
];

/** Every word the slice puts on screen besides the beats. */
export const SLICE_COPY = {
  dialogLabel: 'Settings tour preview with t.ROY',
  guide: 't.ROY',
  stopOf: (n: number, total: number) => `Stop ${n} of ${total}`,
  mapKicker: 'Settings, top to bottom',
  endEyebrow: 'Settings tour preview',
  endTitle: 'Those were the first three stops',
  endBody: 'The preview ends here. Nothing was saved, and no setting changed.',
  again: 'Play it again',
  close: 'Close',
  chipsSr: (labels: readonly string[]) => `Shown: ${labels.join(', ')}.`,
};

/** A spotlight hop between chips on the real page, and a pan between tiles on the stage. */
export const HOP_MS = 550;
export const TILE_PAN_MS = 600;
/** C1: the scroll lands first, the zoom follows and overlaps it. */
export const SCROLL_MS = 1000;
export const ZOOM_AT_MS = 450;
export const ZOOM_MS = 850;
/** Stage zoom on each map tile, over the wide shot. */
export const TILE_ZOOM = 1.6;
/** Gap under the top bar for a target at block start. */
export const TOP_GAP = 12;
export const NARROW = 640;

/** Dwell per chip, with the split chip's longer hold taken from the others. */
export function chipDwells(beat: SliceBeat, phone: boolean): number[] {
  const n = beat.chips?.length ?? 0;
  if (!n || !beat.dwell) return [];
  const per = phone ? beat.dwell.phone : beat.dwell.wide;
  if (!beat.split || n < 2) return Array(n).fill(per);
  const rest = (n * per - beat.split.ms) / (n - 1);
  return Array.from({ length: n }, (_, k) => (k === beat.split!.index ? beat.split!.ms : rest));
}

/** A sweep holds for the longer of its reading time and the landing plus every chip's dwell. */
export function sweepMs(beat: SliceBeat, phone: boolean): number {
  const dwell = chipDwells(beat, phone).reduce((a, b) => a + b, 0);
  return Math.max(holdMs(beat), ORIENT_MS + dwell);
}

export function beatMs(beat: SliceBeat, phone: boolean): number {
  return beat.kind === 'sweep' ? sweepMs(beat, phone) : holdMs(beat);
}

/** When each chip lights, ms into the beat: the first at once (the camera lands on it), the next after the landing plus its dwell. */
export function chipStarts(beat: SliceBeat, phone: boolean): number[] {
  const d = chipDwells(beat, phone);
  const out: number[] = [];
  let at = ORIENT_MS;
  d.forEach((ms, k) => { out.push(k === 0 ? 0 : at); at += ms; });
  return out;
}

/** The lit chip at a moment in the beat. */
export function chipAt(beat: SliceBeat, phone: boolean, t: number): number {
  const starts = chipStarts(beat, phone);
  let k = 0;
  for (let n = 0; n < starts.length; n++) if (t >= starts[n]) k = n;
  return k;
}

/** The slice's wall time at default pace: the three beats plus the stage shrinking into the card. */
export function sliceRuntimeMs(phone: boolean): number {
  return SLICE_BEATS.reduce((sum, b) => sum + beatMs(b, phone), 0) + ACT_CHANGE_MS;
}

/** A CSS cubic-bezier as a function of time (0..1), for the page camera's rAF tween. */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number): (t: number) => number {
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
  const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  const sx = (u: number) => ((ax * u + bx) * u + cx) * u;
  const sy = (u: number) => ((ay * u + by) * u + cy) * u;
  return (t: number) => {
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    let lo = 0, hi = 1, u = t;
    for (let n = 0; n < 40; n++) {
      const x = sx(u);
      if (Math.abs(x - t) < 1e-6) break;
      if (x < t) lo = u; else hi = u;
      u = (lo + hi) / 2;
    }
    return sy(u);
  };
}
/** CAMERA_EASE in lib/tour/timing.ts, cubic-bezier(.65,0,.3,1). */
export const cameraEase = cubicBezier(0.65, 0, 0.3, 1);

/** Progress of a tween that starts `at` ms into the beat and runs `ms`, eased. */
export function tween(t: number, at: number, ms: number): number {
  return ms <= 0 ? (t >= at ? 1 : 0) : cameraEase(Math.min(1, Math.max(0, (t - at) / ms)));
}
export const lerp = (a: number, b: number, p: number) => a + (b - a) * p;
export function lerpBox(a: Box, b: Box, p: number): Box {
  return { x: lerp(a.x, b.x, p), y: lerp(a.y, b.y, p), w: lerp(a.w, b.w, p), h: lerp(a.h, b.h, p) };
}

export interface PageShotInput {
  /** The target's untransformed box: x in viewport pixels, y in document pixels. */
  target: Box;
  /** The page frame's untransformed top-left, same coordinates. */
  frame: { x: number; y: number };
  view: Size;
  /** Where the tour card sits on screen. */
  card: Box;
  maxScale: number;
  maxScroll: number;
  topBar?: number;
  gap?: number;
}
export interface PageShot {
  scrollTop: number;
  scale: number;
  /** The transform origin in the frame's own pixels: the target's top-left, so it stays put while it grows. */
  origin: { x: number; y: number };
  /** Where the target ends on screen, scaled. */
  box: Box;
}

const overlaps = (a: Box, b: Box) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

/**
 * The zoom for one real target: scroll it to block start under the top bar, then
 * scale the page around the target's top-left, as far as `maxScale`, never so far
 * that it runs under the card or off the screen. A phone or motion-off passes
 * maxScale 1 and gets a plain scroll.
 */
export function pageShot(input: PageShotInput): PageShot {
  const { target, frame, view, card } = input;
  const top = (input.topBar ?? TOP_BAR_PX) + (input.gap ?? TOP_GAP);
  const scrollTop = Math.round(Math.max(0, Math.min(input.maxScroll, target.y - top)));
  const y = target.y - scrollTop;
  const margin = 16;
  let s = Math.max(1, input.maxScale);
  s = Math.min(s, (view.h - margin - y) / Math.max(1, target.h), (view.w - margin - target.x) / Math.max(1, target.w));
  // Clear of the card: either the scaled box ends left of it, or it ends above it.
  const leftOf = (card.x - 8 - target.x) / Math.max(1, target.w);
  const above = (card.y - 12 - y) / Math.max(1, target.h);
  if (overlaps({ x: target.x, y, w: target.w * s, h: target.h * s }, card)) s = Math.min(s, Math.max(leftOf, above));
  s = Math.max(1, Math.min(Math.max(1, input.maxScale), s));
  s = Math.round(s * 1000) / 1000;
  return { scrollTop, scale: s, origin: { x: target.x - frame.x, y: target.y - frame.y }, box: { x: target.x, y, w: target.w * s, h: target.h * s } };
}

/**
 * Where a sweep chip's row sits while it is lit: on a focus line a third of the
 * way down the clear band (under the top bar, above a bottom card), so the page
 * pans under a spotlight that stays in about the same place.
 */
export function focusScroll(targetDocY: number, view: Size, bandBottom: number, maxScroll: number, topBar = TOP_BAR_PX): number {
  const top = topBar + TOP_GAP;
  const line = top + Math.max(0, bandBottom - top) * 0.3;
  return Math.round(Math.max(0, Math.min(maxScroll, targetDocY - line)));
}

/* ---------- The stage map (M1) ---------- */

export const MAP_SCENE: Size = { w: 1280, h: 720 };
export const MAP_TILE: Size = { w: 270, h: 262 };
const MAP_COLS = [70, 360, 650, 940];
const MAP_ROWS = [92, 380];
/** Row one left to right, row two left to right: the page's order, top to bottom. */
export function mapTileBox(index: number): Box {
  return { x: MAP_COLS[index % 4], y: MAP_ROWS[Math.floor(index / 4)], w: MAP_TILE.w, h: MAP_TILE.h };
}

/** The camera on the stage: a scale and a centre, kept inside the scene, framed above the lower-third caption. */
export function stageCamera(stage: Size, scene: Size, s: number, centre: { x: number; y: number } | null, reserveBottom: number): Camera {
  const usableH = Math.max(1, stage.h - reserveBottom);
  const cx = centre?.x ?? scene.w / 2, cy = centre?.y ?? scene.h / 2;
  const fit = (size: number, view: number, c: number) => {
    const scaled = size * s;
    if (scaled <= view) return (view - scaled) / 2;
    return Math.min(0, Math.max(view - scaled, view / 2 - c * s));
  };
  return { s, tx: fit(scene.w, stage.w, cx), ty: fit(scene.h, usableH, cy) };
}

/** The wide shot: every tile, framed above the caption. */
export function mapWideScale(stage: Size, reserveBottom: number): number {
  const usableH = Math.max(1, stage.h - reserveBottom);
  return Math.min(stage.w / MAP_SCENE.w, usableH / MAP_SCENE.h) * 0.96;
}

/* Phone: one column of section rows; the lit row opens to list its controls. */
export const P_MAP = { w: 320, rowH: 44, gap: 5, top: 6, line: 24, openPad: 10 };
export function portraitMapRows(open: number): Box[] {
  const rows: Box[] = [];
  let y = P_MAP.top;
  MAP_TILES.forEach((t, k) => {
    const h = P_MAP.rowH + (k === open ? t.controls.length * P_MAP.line + P_MAP.openPad : 0);
    rows.push({ x: 0, y, w: P_MAP.w, h });
    y += h + P_MAP.gap;
  });
  return rows;
}
export function portraitMapHeight(): number {
  const most = Math.max(...MAP_TILES.map(t => t.controls.length));
  return P_MAP.top + MAP_TILES.length * (P_MAP.rowH + P_MAP.gap) + most * P_MAP.line + P_MAP.openPad + 6;
}
