/**
 * Consumer Design System Theme Constants
 *
 * Grounded in WS4 (trauma-informed UX) requirements:
 * - 18px body minimum
 * - System font stack (no custom font downloads — performance budget)
 * - 6th grade reading level enforced at component level
 * - WCAG 2.2 AA contrast ratios (4.5:1 body, 3:1 large text)
 * - No red (triggers), no government blue
 * - Warm earth tones
 */

export const FONT_STACK =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

export const COLORS = {
  // Primary palette — warm, non-institutional
  background: "#fdf8f0",
  foreground: "#2c2418",
  muted: "#8c7e6e",
  border: "#e0cebc",
  card: "#f9f3ea",
  surface: "#ffffff",

  // Accent — sage green (trust, growth, nature)
  accent: "#557553",
  accentHover: "#415d40",
  accentLight: "#e0e8df",

  // Status — no red, uses warm amber for warnings
  success: "#557553",
  info: "#3d89af",
  warning: "#d67a2a",
  error: "#c05e1f", // Warm amber, not red

  // Interactive
  focus: "#557553",
  disabled: "#c8bfb3",
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
