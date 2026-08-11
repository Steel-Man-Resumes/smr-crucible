/**
 * Phase 7.2 + 7.7: db-backed accessibility/display prefs + illustrated-avatar
 * choice. Backed by users.ui_* columns (migration 039).
 *
 * The pure types/constants/validators live in ./uiPrefsShared (no db import) so
 * client components can use them without pulling server code into the browser
 * bundle. This module re-exports all of that and adds the db getter/setter.
 */

import { query, getOne } from "./db";
import {
  normalizeFontScale,
  normalizeDensity,
  normalizeReducedMotion,
  normalizeAvatar,
  DEFAULT_UI_PREFS,
  type UiPrefs,
} from "./uiPrefsShared";

export * from "./uiPrefsShared";

interface UiPrefsRow {
  ui_font_scale: string | null;
  ui_reduced_motion: boolean | null;
  ui_density: string | null;
  ui_avatar: unknown;
}

/** Read a user's UI prefs, filling defaults for any NULL column. */
export async function getUiPrefs(userId: string): Promise<UiPrefs> {
  const row = await getOne<UiPrefsRow>(
    `SELECT ui_font_scale, ui_reduced_motion, ui_density, ui_avatar
       FROM users WHERE id = $1`,
    [userId]
  );
  if (!row) return { ...DEFAULT_UI_PREFS };
  return {
    fontScale: normalizeFontScale(row.ui_font_scale ?? undefined),
    reducedMotion: normalizeReducedMotion(row.ui_reduced_motion),
    density: normalizeDensity(row.ui_density ?? undefined),
    avatar: normalizeAvatar(row.ui_avatar),
  };
}

/**
 * Partial update: only the keys present in `patch` change. Values are
 * normalized before they touch the DB, so a bad value writes the safe default
 * rather than failing. Returns the full, current prefs after the write.
 */
export async function setUiPrefs(
  userId: string,
  patch: Partial<UiPrefs>
): Promise<UiPrefs> {
  const sets: string[] = [];
  const params: unknown[] = [userId];

  function push(column: string, value: unknown) {
    params.push(value);
    sets.push(`${column} = $${params.length}`);
  }

  if ("fontScale" in patch) push("ui_font_scale", normalizeFontScale(patch.fontScale));
  if ("density" in patch) push("ui_density", normalizeDensity(patch.density));
  if ("reducedMotion" in patch) push("ui_reduced_motion", normalizeReducedMotion(patch.reducedMotion));
  if ("avatar" in patch) {
    const av = normalizeAvatar(patch.avatar);
    push("ui_avatar", av ? JSON.stringify(av) : null);
  }

  if (sets.length) {
    await query(`UPDATE users SET ${sets.join(", ")} WHERE id = $1`, params);
  }
  return getUiPrefs(userId);
}
