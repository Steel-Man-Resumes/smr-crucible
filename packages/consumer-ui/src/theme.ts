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
  '"IBM Plex Mono", "Cascadia Mono", Consolas, monospace';

export const COLORS = {
  // Workshop Tape v2 palette
  background: "#eaede9",
  foreground: "#1c1e1b",
  muted: "#6d736d",
  border: "#d3d8d1",
  card: "#ffffff",
  surface: "#f5f6f4",

  // Accent — amber steel ("the metal")
  accent: "#9b6d1d",
  accentHover: "#795212",
  accentLight: "#a7cf98",

  // Status
  success: "#4f6b57",
  info: "#4f6b57",
  warning: "#9b6d1d",
  error: "#972d24",

  // Interactive
  focus: "#9b6d1d",
  disabled: "#aeb5ad",
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
