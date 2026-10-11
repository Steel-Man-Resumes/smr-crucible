/**
 * GET  /api/next-step -- the single most valuable next action for the user.
 *      Thin wrapper over getNextStep() (packages/core). Cache-aware (1h) with
 *      server-side recompute + persist. Auth required.
 * POST /api/next-step { disclosure: "not_now" | "undo" } -- "I don't need this
 *      now" for the optional disclosure step (Codex review A6). Stamps the
 *      person's own profile, drops the cached step, returns the new one.
 *      Same-origin JSON only.
 */

import { NextResponse } from "next/server";
import { effectiveAuth as auth } from "@/lib/effective-auth";
import { getNextStep, invalidateNextStep, setDisclosureNotNow } from "@crucible/core";
import { isSameOriginJsonPost } from "@/lib/same-origin";

export const maxDuration = 10;

export async function GET() {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  try {
    const next = await getNextStep(userId);
    return NextResponse.json({ data: next });
  } catch (err) {
    console.error("[next-step] failed:", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "Could not compute next step" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  if (!isSameOriginJsonPost(request.headers)) {
    return NextResponse.json({ error: "Invalid request" }, { status: 403 });
  }
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  const body = (await request.json().catch(() => null)) as { disclosure?: unknown } | null;
  const choice = body?.disclosure;
  if (choice !== "not_now" && choice !== "undo") {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  try {
    await setDisclosureNotNow(userId, choice === "not_now");
    await invalidateNextStep(userId);
    const next = await getNextStep(userId);
    return NextResponse.json({ data: next });
  } catch (err) {
    console.error("[next-step] not-now failed:", err instanceof Error ? err.message : err);
    return NextResponse.json({ error: "That didn't save. Try again in a minute." }, { status: 500 });
  }
}
