/**
 * The signed-in person's premium tools (lib/premium.ts, migration 079).
 *
 * GET  -> which premium tools are open, and any open request.
 * POST -> "Ask SMR for access": { tool, note? }. Files one row Troy sees in
 *         admin. Sends NO email to anyone. One open request per person.
 *
 * Signed in only, never while a second step is owed; POST is same-origin
 * JSON only and rate limited per account.
 */

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { withRateLimit } from "@/lib/withRateLimit";
import { isSameOriginJsonPost } from "@/lib/same-origin";
import { forgeSessionUser } from "@/lib/session-policy";
import { PREMIUM_TOOL_IDS, premiumGateOn, type PremiumStatus } from "@/lib/premium";

export const dynamic = "force-dynamic";

const ALL_OPEN = (): PremiumStatus => ({
  gate: false,
  open: [...PREMIUM_TOOL_IDS],
  orgMember: false,
  orgName: null,
  grantEndsAt: null,
  openRequest: null,
});

export async function GET() {
  const user = forgeSessionUser(await auth());
  if (!user?.id) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  if (!premiumGateOn()) return NextResponse.json({ data: ALL_OPEN() });
  const { getPremiumAccess } = await import("@crucible/core");
  try {
    const a = await getPremiumAccess(user.id);
    const data: PremiumStatus = {
      gate: true,
      open: a.open,
      orgMember: a.orgMember,
      orgName: a.orgName,
      grantEndsAt: a.grantEndsAt,
      openRequest: a.openRequest,
    };
    return NextResponse.json({ data });
  } catch (e) {
    // 079 not applied yet: the tools stay open, as before (lib/premium.ts).
    if ((e as { premiumNotReady?: boolean } | null)?.premiumNotReady) return NextResponse.json({ data: ALL_OPEN() });
    console.error("[premium] status read failed:", (e as { code?: string })?.code || "error");
    return NextResponse.json({ error: "We couldn't check your tools right now." }, { status: 503 });
  }
}

async function handlePost(request: Request) {
  if (!isSameOriginJsonPost(request.headers)) {
    return NextResponse.json({ error: "Invalid request" }, { status: 403 });
  }
  const user = forgeSessionUser(await auth());
  if (!user?.id) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const len = Number(request.headers.get("content-length") || 0);
  if (len > 4_000) return NextResponse.json({ error: "Request too large" }, { status: 413 });

  const body = await request.json().catch(() => null);
  const { isPremiumTool, requestPremiumAccess, PREMIUM_NOTE_MAX } = await import("@crucible/core");
  if (!body || typeof body !== "object" || !isPremiumTool((body as any).tool)) {
    return NextResponse.json({ error: "Pick the tool you're asking about." }, { status: 400 });
  }
  const rawNote = (body as any).note;
  const note = typeof rawNote === "string" ? rawNote.slice(0, PREMIUM_NOTE_MAX) : null;
  try {
    const r = await requestPremiumAccess(user.id, (body as any).tool, note);
    return NextResponse.json({ ok: true, created: r.created });
  } catch (e) {
    // Never log the note: it is the person's own words.
    console.error("[premium] request failed:", (e as { code?: string })?.code || "error");
    return NextResponse.json({ error: "That didn't go through. Try again in a minute." }, { status: 503 });
  }
}

export const POST = withRateLimit(handlePost, { mode: "user", endpoint: "premium-request" });
