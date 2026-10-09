import { NextResponse } from "next/server";
import { effectiveAuth as auth } from "@/lib/effective-auth";
import { auth as realAuth } from "@/auth";
import { persistForgeSession } from "@/lib/forge-persist";
import { isSameOriginJsonPost } from "@/lib/same-origin";
import { incrementUserUsage } from "@crucible/core";

/**
 * Saves the Forge run in this browser to the signed-in account: the Refinery's
 * sync on the dashboard, and the Forge's own import on sign-in
 * (components/forge/ForgeImport.tsx). The middleware already holds a session
 * that owes its second step (401) and turns away a revoked one.
 */

/** Saves per account per day: a run saves a few times; this only stops a loop or a script. */
const FORGE_SAVES_PER_DAY = 200;

export async function POST(request: Request) {
  const contentLength = request.headers.get("content-length");
  if (contentLength && parseInt(contentLength, 10) > 1_000_000) {
    return NextResponse.json({ error: "Request too large" }, { status: 413 });
  }

  // CSRF: only a page on this origin may write a run into the account.
  if (!isSameOriginJsonPost(request.headers)) {
    return NextResponse.json({ error: "Not allowed" }, { status: 403 });
  }

  const session = await auth();
  const userId = session?.user?.id;

  if (!userId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  // Never while an admin is viewing as someone (security review 3a Part 2
  // r1, M3): the run in the admin's browser is the admin's, and this route
  // writes to the effective account.
  const real = await realAuth();
  if (real?.user?.id !== userId) {
    return NextResponse.json({ error: "Forge saves are off while viewing as someone." }, { status: 403 });
  }

  const saves = await incrementUserUsage(userId, "forge-save").catch(() => 0);
  if (saves > FORGE_SAVES_PER_DAY) {
    return NextResponse.json({ error: "Too many saves today. Your work is still on this computer." }, { status: 429 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid data" }, { status: 400 });
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ error: "Invalid data" }, { status: 400 });
  }

  // BACKSTOP ONLY (security review 3a r2, L5). `_ownerUserId` is whatever the
  // client chose to send, so this cannot prove ownership and is not the
  // server's half of the shared-computer rule. The real rule is in the browser:
  // a run reaches this route only after the person said it is theirs
  // (ForgeImport, RefineryShell) or it is already marked theirs. This refusal
  // only catches a client that sends a run plainly marked for someone else.
  const marked = (body as Record<string, unknown>)._ownerUserId;
  if (typeof marked === "string" && marked !== userId) {
    return NextResponse.json({ error: "This work belongs to another account." }, { status: 409 });
  }

  try {
    await persistForgeSession(userId, body as Record<string, any>);
    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error("Forge save error:", err?.message || err);
    return NextResponse.json(
      { error: "Failed to save progress. Please try again." },
      { status: 500 }
    );
  }
}
