/**
 * Camera and spotlight math for the entrance tour. Pure functions, unit tested.
 * Act one moves a camera over its own fixed stage. Act two never moves the
 * page: it measures the real element and draws a fixed cutout over it.
 */
export interface Box { x: number; y: number; w: number; h: number }
export interface Size { w: number; h: number }
export interface Camera { s: number; tx: number; ty: number }

export const ZOOM_MIN = 0.6;
export const ZOOM_MAX = 2.6;

/**
 * Frame a spot in a scene on a stage. `reserveBottom` is the stage height the
 * lower-third caption covers; the spot is framed in the space above it.
 */
export function frameCamera(stage: Size, scene: Size, spot: Box | null, reserveBottom = 0): Camera {
  const base = Math.min(stage.w / scene.w, stage.h / scene.h);
  const usableH = Math.max(1, stage.h - reserveBottom);
  let z: number;
  let cx = scene.w / 2;
  let cy = scene.h / 2;
  if (spot) {
    z = Math.min((0.82 * stage.w) / (spot.w * base), (0.86 * usableH) / (spot.h * base));
    z = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, z));
    cx = spot.x + spot.w / 2;
    cy = spot.y + spot.h / 2;
  } else {
    z = Math.min(1, usableH / (scene.h * base));
  }
  const s = base * z;
  const fit = (size: number, view: number, centre: number, c: number) => {
    const scaled = size * s;
    if (scaled <= view) return (view - scaled) / 2;
    return Math.min(0, Math.max(view - scaled, centre - c * s));
  };
  const tx = fit(scene.w, stage.w, stage.w / 2, cx);
  const scaledH = scene.h * s;
  const ty = scaledH <= usableH
    ? (usableH - scaledH) / 2
    // The scene may slide up under the caption, so a low spot still clears it.
    : Math.min(0, Math.max(usableH - scaledH, usableH / 2 - cy * s));
  return { s, tx, ty };
}

/** Where a scene box lands on the stage under a camera. */
export function onStage(box: Box, cam: Camera): Box {
  return { x: cam.tx + box.x * cam.s, y: cam.ty + box.y * cam.s, w: box.w * cam.s, h: box.h * cam.s };
}

export interface RectLike { left: number; top: number; width: number; height: number }

/** A padded cutout around a real element, kept inside the viewport. Null if nothing is visible. */
export function spotlightRect(rect: RectLike, vw: number, vh: number, pad = 6, margin = 4): Box | null {
  const x1 = Math.max(margin, rect.left - pad);
  const y1 = Math.max(margin, rect.top - pad);
  const x2 = Math.min(vw - margin, rect.left + rect.width + pad);
  const y2 = Math.min(vh - margin, rect.top + rect.height + pad);
  if (x2 - x1 < 2 || y2 - y1 < 2) return null;
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

function overlap(a: Box, b: Box): number {
  const ox = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const oy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  return ox * oy;
}

/**
 * Put the corner caption where it covers the least of the target. Ties go to
 * bottom-right, then bottom-left, so the caption mostly stays put.
 */
export function captionPlacement(target: Box | null, vw: number, vh: number, card: Size, margin = 16): Box {
  const w = Math.min(card.w, vw - margin * 2);
  const h = card.h;
  const options: Box[] = [
    { x: vw - margin - w, y: vh - margin - h, w, h },
    { x: margin, y: vh - margin - h, w, h },
    { x: vw - margin - w, y: margin, w, h },
    { x: margin, y: margin, w, h },
  ];
  if (!target) return options[0];
  let best = options[0];
  let bestArea = Infinity;
  for (const option of options) {
    const area = overlap(option, target);
    if (area < bestArea - 1) { bestArea = area; best = option; }
  }
  return best;
}

/** A gentle arc for t.ROY's particles, from the caption mark to the target. */
export function particlePath(from: { x: number; y: number }, to: { x: number; y: number }): string {
  const lift = Math.min(160, Math.max(40, Math.hypot(to.x - from.x, to.y - from.y) * 0.25));
  const mx = (from.x + to.x) / 2;
  const my = Math.min(from.y, to.y) - lift;
  return `M ${round(from.x)} ${round(from.y)} Q ${round(mx)} ${round(my)} ${round(to.x)} ${round(to.y)}`;
}

function round(n: number) { return Math.round(n * 10) / 10; }
