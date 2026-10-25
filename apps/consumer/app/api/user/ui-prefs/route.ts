/**
 * GET / PATCH /api/user/ui-prefs
 *
 * Phase 7.2 + 7.7 app-wide accessibility/display preferences and the zero-PII
 * illustrated-avatar choice. GET returns the current prefs (defaults filled
 * for any unset column); PATCH does a partial update -- only the keys present
 * in the body change, every value normalized server-side (getUiPrefs /
 * setUiPrefs in @crucible/core). Auth required; own row only. Display prefs
 * are "preference" (assist may help); the avatar field is "private" (SF-5):
 * no impersonation may set or clear the person's photo choice, and GET hides
 * the photo id while impersonating.
 */

import { NextResponse } from "next/server";
import { effectiveAuth as auth } from "@/lib/effective-auth";
import { settingsRefusal } from "@/lib/settings-guard";
import { getUiPrefs, setUiPrefs, type UiPrefs } from "@crucible/core";

export const maxDuration = 10;

export async function GET() {
  const session = await auth();
  { const refused = settingsRefusal(session, "preference", "read"); if (refused) return refused; }
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  const prefs = await getUiPrefs(userId);
  // The photo choice is the person's own (the avatar routes are "private"):
  // an operator viewing or assisting never sees which photo it is.
  if (session?.impersonation && prefs.avatar?.photoAssetId) {
    return NextResponse.json({ data: { ...prefs, avatar: { ...prefs.avatar, photoAssetId: null } } });
  }
  return NextResponse.json({ data: prefs });
}

export async function PATCH(req: Request) {
  const session = await auth();
  { const refused = settingsRefusal(session, "preference", "write"); if (refused) return refused; }
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  const body = await req.json().catch(() => ({}));

  // Only forward keys the caller actually sent -- setUiPrefs normalizes each.
  const patch: Partial<UiPrefs> = {};
  if ("fontScale" in body) patch.fontScale = body.fontScale;
  if ("density" in body) patch.density = body.density;
  if ("reducedMotion" in body) patch.reducedMotion = body.reducedMotion;
  if ("avatar" in body) {
    // The avatar (including the photo choice) is private to the person, like
    // the avatar routes: refused under any impersonation, assist included.
    const refused = settingsRefusal(session, "private", "write"); if (refused) return refused;
    patch.avatar = body.avatar;
  }

  const prefs = await setUiPrefs(userId, patch);
  return NextResponse.json({ ok: true, data: prefs });
}
