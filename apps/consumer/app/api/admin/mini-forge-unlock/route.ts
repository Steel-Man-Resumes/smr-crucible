/**
 * Admin: unlock a Mini Forge plan that locked after too many wrong PINs
 * (078 tablet_session.locked_at; security review 3a Part 2 r1, M1). Platform
 * admins with a two-step sign-in only (requirePlatformAdmin), same-origin
 * JSON. Clears the wrong-PIN count and the lock; the plan, its PIN and a
 * finished import are untouched. Nothing is sent to anyone.
 */

import { NextResponse } from "next/server";
import { requirePlatformAdmin } from "@/lib/org-guard";
import { isSameOriginJsonPost } from "@/lib/same-origin";
import { canonicalImportCode } from "@/lib/mini-forge-guard";
import { clearPinLock, tabletColumnsMissing } from "@/lib/tablet-session";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const guard = await requirePlatformAdmin();
  if (!guard.ok) return guard.response;
  if (!isSameOriginJsonPost(request.headers)) {
    return NextResponse.json({ error: "Invalid request" }, { status: 403 });
  }
  const body = (await request.json().catch(() => null)) as { code?: unknown } | null;
  const code = canonicalImportCode(body?.code);
  if (!code) return NextResponse.json({ error: "Enter the plan's 6-letter code." }, { status: 400 });
  try {
    const found = await clearPinLock(code);
    if (!found) return NextResponse.json({ error: "No plan has that code." }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (tabletColumnsMissing(e)) return NextResponse.json({ error: "Migration 078 is not applied here yet." }, { status: 503 });
    throw e;
  }
}
