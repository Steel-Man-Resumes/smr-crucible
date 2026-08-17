/**
 * Phase 7.2 + 7.7: the PURE, client-safe half of the UI-prefs module -- types,
 * option constants, and the normalize* validators. No db import, so client
 * components can import these values directly via
 * `@crucible/core/src/uiPrefsShared` without dragging server-only code (and
 * node:crypto) into the browser bundle. The db-backed getUiPrefs/setUiPrefs
 * live in ./uiPrefs and re-export everything here.
 *
 * The normalize* helpers never throw: an unknown value falls back to the safe
 * default, so a corrupt or stale stored value can never break the UI. Font
 * scale is SIZE ONLY -- it never touches color or contrast, so AA holds.
 */

export type FontScale = "normal" | "large" | "xl";
export type Density = "comfortable" | "compact";

export const FONT_SCALES: readonly FontScale[] = ["normal", "large", "xl"] as const;
export const DENSITIES: readonly Density[] = ["comfortable", "compact"] as const;

// Illustrated avatar: a small deterministic option set. Zero PII, no photo, no
// R2 -- we store the CHOICE and render an SVG from it client-side.
export const AVATAR_SHAPES = ["circle", "square", "hex", "shield"] as const;
export const AVATAR_COLORS = ["amber", "phos", "slate", "clay", "plum", "teal"] as const;
export const AVATAR_ACCENTS = ["solid", "ring", "corner"] as const;
export type AvatarShape = (typeof AVATAR_SHAPES)[number];
export type AvatarColor = (typeof AVATAR_COLORS)[number];
export type AvatarAccent = (typeof AVATAR_ACCENTS)[number];

export interface AvatarChoice {
  shape: AvatarShape;
  color: AvatarColor;
  accent: AvatarAccent;
  initial: string;
  /**
   * Phase 7.7 photo path. When set to a plausible avatar_asset UUID, the user
   * has chosen a PHOTO as their avatar and the nav renders that photo (via the
   * owner-scoped image proxy) instead of the illustrated mark. null/absent =
   * illustrated (the zero-PII default). This id is NOT an access grant -- the
   * image proxy re-checks ownership on every fetch, so a forged id renders
   * nothing for a stranger.
   */
  photoAssetId?: string | null;
}

export interface UiPrefs {
  fontScale: FontScale;
  reducedMotion: boolean | null; // null = follow the OS preference
  density: Density;
  avatar: AvatarChoice | null; // null = default derived-from-initial avatar
}

export const DEFAULT_UI_PREFS: UiPrefs = {
  fontScale: "normal",
  reducedMotion: null,
  density: "comfortable",
  avatar: null,
};

/** Coerce any input to a valid font scale. Unknown -> "normal". Pure. */
export function normalizeFontScale(v: unknown): FontScale {
  return FONT_SCALES.includes(v as FontScale) ? (v as FontScale) : "normal";
}

/** Coerce any input to a valid density. Unknown -> "comfortable". Pure. */
export function normalizeDensity(v: unknown): Density {
  return DENSITIES.includes(v as Density) ? (v as Density) : "comfortable";
}

/**
 * Coerce any input to the tri-state reduced-motion pref. Only true/false are
 * explicit overrides; anything else (null, undefined, "auto", a string) means
 * "follow the OS", represented as null. Pure.
 */
export function normalizeReducedMotion(v: unknown): boolean | null {
  if (v === true || v === false) return v;
  return null;
}

/** Take the first non-space character, uppercase, ASCII-safe. Pure. */
function normalizeInitial(v: unknown): string {
  if (typeof v !== "string") return "";
  return v.trim().charAt(0).toUpperCase();
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Coerce a stored photoAssetId to a plausible UUID string, or null. This is a
 * FORMAT check only, never an access grant -- the image proxy re-checks that the
 * asset actually belongs to the signed-in user before returning any bytes. Pure.
 */
export function normalizePhotoAssetId(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim().toLowerCase();
  return UUID_RE.test(s) ? s : null;
}

/**
 * Coerce any input to a valid avatar choice, or null if it isn't a usable
 * object. Every field falls back to the first option so a partial or corrupt
 * choice still renders something sensible. Pure.
 */
export function normalizeAvatar(v: unknown): AvatarChoice | null {
  if (!v || typeof v !== "object") return null;
  const raw = v as Record<string, unknown>;
  const shape = AVATAR_SHAPES.includes(raw.shape as AvatarShape)
    ? (raw.shape as AvatarShape)
    : AVATAR_SHAPES[0];
  const color = AVATAR_COLORS.includes(raw.color as AvatarColor)
    ? (raw.color as AvatarColor)
    : AVATAR_COLORS[0];
  const accent = AVATAR_ACCENTS.includes(raw.accent as AvatarAccent)
    ? (raw.accent as AvatarAccent)
    : AVATAR_ACCENTS[0];
  const initial = normalizeInitial(raw.initial);
  const photoAssetId = normalizePhotoAssetId(raw.photoAssetId);
  return { shape, color, accent, initial, photoAssetId };
}

/** Normalize a whole prefs bag (any subset) against the defaults. Pure. */
export function normalizeUiPrefs(v: unknown): UiPrefs {
  const raw = (v && typeof v === "object" ? v : {}) as Record<string, unknown>;
  return {
    fontScale: normalizeFontScale(raw.fontScale),
    reducedMotion: normalizeReducedMotion(raw.reducedMotion),
    density: normalizeDensity(raw.density),
    avatar: normalizeAvatar(raw.avatar),
  };
}
