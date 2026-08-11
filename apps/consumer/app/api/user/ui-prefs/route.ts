/**
 * GET / PATCH /api/user/ui-prefs
 *
 * Phase 7.2 + 7.7 app-wide accessibility/display preferences and the zero-PII
 * illustrated-avatar choice. GET returns the current prefs (defaults filled
 * for any unset column); PATCH does a partial update -- only the keys present
 * in the body change, every value normalized server-side (getUiPrefs /
 * setUiPrefs in @crucible/core). Auth required; own row only.
 */

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getUiPrefs, setUiPrefs, type UiPrefs } from "@crucible/core";

export const maxDuration = 10;

export async function GET() {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  const prefs = await getUiPrefs(userId);
  return NextResponse.json({ data: prefs });
}

export async function PATCH(req: Request) {
  const session = await auth();
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
  if ("avatar" in body) patch.avatar = body.avatar;

  const prefs = await setUiPrefs(userId, patch);
  return NextResponse.json({ ok: true, data: prefs });
}
