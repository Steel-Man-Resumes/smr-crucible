/**
 * Consumer Design System Theme Constants
 *
 * Workshop Tape + lite trash-polka v2 -- ported from
 * ~/repos/smr-website/docs/DESIGN-SYSTEM.md (conservative baseline remap,
 * 2026-07-14; supersedes the v1 Hand-Forged Terminal hex values). Grounded
 * in WS4 (trauma-informed UX) requirements:
 * - 15-16px body minimum for CLI-styled form fields
 * - 6th grade reading level enforced at component level
 * - WCAG 2.2 AA contrast ratios (4.5:1 body, 3:1 large text)
 * - No red except semantic errors/rare emphasis, no rounded corners
 */

export const FONT_STACK =
  'ui-monospace, "Cascadia Mono", Consolas, "Liberation Mono", Menlo, monospace';

export const COLORS = {
  // Workshop Tape v2 palette
  background: "#121110", // shop floor black
  foreground: "#ece7d9", // bone
  muted: "#6d8562", // dim phosphor (CLI-adjacent decorative text only)
  border: "#3a352c", // line
  card: "#1a1815", // panel
  surface: "#201d18", // raised panel

  // Accent — amber steel ("the metal")
  accent: "#c9973f",
  accentHover: "#e0bd6e",
  accentLight: "#9fbf8f", // phosphor green -- CLI fields only

  // Status
  success: "#9fbf8f",
  info: "#b9b3a0",
  warning: "#c9973f",
  error: "#ad2318", // semantic only, never decorative

  // Interactive
  focus: "#ece7d9",
  disabled: "#3a352c",
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
