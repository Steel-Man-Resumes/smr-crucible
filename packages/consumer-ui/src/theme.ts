/**
 * Consumer Design System Theme Constants
 *
 * Hand-Forged Terminal system (Wave C, 2026-07-08) -- ported from
 * ~/repos/smr-website/docs/DESIGN-SYSTEM.md. Grounded in WS4
 * (trauma-informed UX) requirements:
 * - 15-16px body minimum, monospace throughout
 * - One monospace stack sitewide (no custom font downloads — performance budget)
 * - 6th grade reading level enforced at component level
 * - WCAG 2.2 AA contrast ratios (4.5:1 body, 3:1 large text)
 * - No red except semantic errors, no rounded corners
 */

export const FONT_STACK =
  'ui-monospace, "Cascadia Mono", Consolas, "Liberation Mono", Menlo, monospace';

export const COLORS = {
  // Hand-Forged Terminal palette
  background: "#0B0E0C", // bench black
  foreground: "#E9E6DA", // iron white
  muted: "#6D8562", // dim phosphor
  border: "#2A3324", // line
  card: "#10140F", // panel
  surface: "#151A13", // raised panel

  // Accent — steel gold ("the metal")
  accent: "#D4A84B",
  accentHover: "#E8C060",
  accentLight: "#9FBF8F", // phosphor green

  // Status
  success: "#9FBF8F",
  info: "#7FA3B5",
  warning: "#D4A84B",
  error: "#C4573A", // semantic only, never decorative

  // Interactive
  focus: "#E9E6DA",
  disabled: "#2A3324",
} as const;

export const SPACING = {
  /** 48px — minimum touch target (WCAG 2.5.5 AAA, design brief) */
  touchTarget: 48,
  /** Page padding on mobile */
  pagePadding: 16,
  /** Max content width for flow pages */
  flowMaxWidth: 512,
} as const;

export const TYPOGRAPHY = {
  /** 18px minimum body text */
  bodySize: 18,
  /** Line height for body text */
  bodyLineHeight: 28,
  /** Max words per screen display (design brief constraint) */
  maxWordsPerScreen: 50,
} as const;

/** Performance budget constants from design brief */
export const PERFORMANCE = {
  /** Max page weight in bytes */
  maxPageWeight: 500 * 1024, // 500 KB
  /** Max hero image size in bytes */
  maxHeroImageSize: 100 * 1024, // 100 KB
  /** Target first meaningful paint in ms */
  targetFMP: 3000, // 3 seconds on 3G
} as const;
