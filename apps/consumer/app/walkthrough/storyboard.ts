/**
 * Walkthrough storyboard + camera math.
 *
 * The walkthrough is a self-running "interactive slideshow" with a virtual
 * camera that zooms and pans across crisp DOM screens to guide attention.
 *
 * Everything is data here: each Beat names the screen to show, the region the
 * camera looks at, the caption, and how long to dwell. Tune the demo by editing
 * this file -- no engine changes needed.
 *
 * Design canvas is a fixed 1280 x 800 "stage". Focus regions are fractions of
 * that stage (0..1), so they are independent of the viewer's screen size.
 */

export const STAGE_W = 1280;
export const STAGE_H = 800;

/** A rectangle on the stage, expressed as fractions of width/height (0..1). */
export type Region = { x: number; y: number; w: number; h: number };

export const FULL: Region = { x: 0, y: 0, w: 1, h: 1 };

export type ScreenId =
  | "title"
  | "before"
  | "intake"
  | "processing"
  | "output"
  | "refinery"
  | "disclosure"
  | "interview"
  | "close";

export type Caption = {
  title?: string;
  body: string;
};

export type Beat = {
  id: string;
  screen: ScreenId;
  focus: Region;
  caption?: Caption;
  /** ms to dwell before auto-advancing. */
  duration: number;
};

/** Largest zoom factor the camera is allowed to apply. */
const MAX_ZOOM = 2.8;

const clamp = (v: number, lo: number, hi: number) =>
  Math.min(Math.max(v, lo), hi);

/**
 * Compute the CSS transform that frames `region` in the center of the stage.
 * transform-origin is the top-left (0,0) of the stage.
 *
 * The whole region is guaranteed visible (we scale by the smaller axis), and
 * the translate is clamped so the stage always covers the frame -- the camera
 * can never reveal empty space outside the screen.
 */
export function regionTransform(region: Region): string {
  const fit = Math.min(1 / region.w, 1 / region.h);
  const s = clamp(fit, 1, MAX_ZOOM);

  const cx = (region.x + region.w / 2) * STAGE_W;
  const cy = (region.y + region.h / 2) * STAGE_H;

  let tx = STAGE_W / 2 - cx * s;
  let ty = STAGE_H / 2 - cy * s;

  // Keep the view inside the stage (stage size after scale is STAGE_**s).
  tx = clamp(tx, STAGE_W * (1 - s), 0);
  ty = clamp(ty, STAGE_H * (1 - s), 0);

  return `translate(${tx.toFixed(2)}px, ${ty.toFixed(2)}px) scale(${s.toFixed(4)})`;
}

// ─── The storyboard ──────────────────────────────────────────────────────────
// Partner-framed narration (Mary Ann / Expo Wisconsin distributes to her team).
// Jordan Mitchell is the through-line. No em dashes anywhere (house style).

export const BEATS: Beat[] = [
  {
    id: "title",
    screen: "title",
    focus: FULL,
    duration: 4500,
  },
  {
    id: "before-full",
    screen: "before",
    focus: FULL,
    caption: {
      title: "Where most people start",
      body: "A plain resume. Real experience flattened into duties, and a gap nobody knows how to explain.",
    },
    duration: 6000,
  },
  {
    id: "before-bullets",
    screen: "before",
    focus: { x: 0.27, y: 0.30, w: 0.46, h: 0.30 },
    caption: {
      body: "Three years of accuracy and leadership are in here. On the page, they read like chores.",
    },
    duration: 5500,
  },
  {
    id: "before-gap",
    screen: "before",
    focus: { x: 0.27, y: 0.62, w: 0.46, h: 0.22 },
    caption: {
      body: "And a record and a timeline gap that a hiring system treats as risk.",
    },
    duration: 5500,
  },
  {
    id: "intake-all",
    screen: "intake",
    focus: FULL,
    caption: {
      title: "The Forge",
      body: "It starts with five minutes of honest answers, not a form to pass.",
    },
    duration: 5500,
  },
  {
    id: "intake-early",
    screen: "intake",
    focus: { x: 0.02, y: 0.26, w: 0.40, h: 0.50 },
    caption: {
      body: "Their experience and their goals, in their own words.",
    },
    duration: 5000,
  },
  {
    id: "intake-late",
    screen: "intake",
    focus: { x: 0.56, y: 0.26, w: 0.42, h: 0.50 },
    caption: {
      body: "The story they choose to share, and the constraints that make a job match real.",
    },
    duration: 5000,
  },
  {
    id: "processing",
    screen: "processing",
    focus: FULL,
    caption: {
      title: "The method",
      body: "Four AI analyses run in parallel: skills, narrative, career matches, and barriers mapped to resources.",
    },
    duration: 6000,
  },
  {
    id: "output-headline",
    screen: "output",
    focus: { x: 0.04, y: 0.05, w: 0.55, h: 0.30 },
    caption: {
      title: "The same person, reforged",
      body: "Not a score. A story. 'A Leader on the Rise.'",
    },
    duration: 6500,
  },
  {
    id: "output-strength",
    screen: "output",
    focus: { x: 0.03, y: 0.40, w: 0.47, h: 0.34 },
    caption: {
      body: "Strengths first, pulled straight from the evidence. Natural team leader. 99.2 percent accuracy.",
    },
    duration: 6000,
  },
  {
    id: "output-barrier",
    screen: "output",
    focus: { x: 0.51, y: 0.36, w: 0.46, h: 0.34 },
    caption: {
      body: "The record, handled with real fair-chance resources. Context, not a warning label.",
    },
    duration: 6500,
  },
  {
    id: "output-career",
    screen: "output",
    focus: { x: 0.51, y: 0.70, w: 0.46, h: 0.26 },
    caption: {
      body: "And concrete paths forward, each with a salary range and next steps.",
    },
    duration: 6000,
  },
  {
    id: "refinery-all",
    screen: "refinery",
    focus: FULL,
    caption: {
      title: "The Refinery",
      body: "From the plan to action. Six tools that stay on after the resume is built.",
    },
    duration: 5500,
  },
  {
    id: "refinery-tailor",
    screen: "refinery",
    focus: { x: 0.06, y: 0.30, w: 0.32, h: 0.30 },
    caption: {
      body: "Tailor a resume to any job, with AI that turns real work into quantified achievements.",
    },
    duration: 5000,
  },
  {
    id: "disclosure",
    screen: "disclosure",
    focus: { x: 0.18, y: 0.26, w: 0.64, h: 0.46 },
    caption: {
      title: "Disclosure practice",
      body: "How to talk about a record. Brief acknowledgment, then pivot to strengths.",
    },
    duration: 6500,
  },
  {
    id: "interview",
    screen: "interview",
    focus: { x: 0.16, y: 0.52, w: 0.68, h: 0.40 },
    caption: {
      title: "Interview practice",
      body: "Mock interviews with specific, encouraging feedback that builds real confidence.",
    },
    duration: 6500,
  },
  {
    id: "close",
    screen: "close",
    focus: FULL,
    duration: 8000,
  },
];
