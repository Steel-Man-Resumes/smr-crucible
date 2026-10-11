/**
 * POST /api/forge/recheck: "Check it again" (Phase 5 R1, review r3 M-1).
 *
 * Re-runs the second check on the finish page's current documents and signs a
 * fresh writer's receipt. No rewrite; the person's answers stay. The work is
 * in lib/forge-recheck.ts; this file wires the real verifier, the newest-nonce
 * record (signed in) and the run cookie (signed out). IP rate limited like the
 * other Forge routes; works signed out before the wall, as generate-docs does.
 */

import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { auth } from "@/auth";
import { forgeUserId } from "@/lib/session-policy";
import { withRateLimit } from "@/lib/withRateLimit";
import { verifyGrounding } from "@/lib/grounding-verify";
import { recheckDocs } from "@/lib/forge-recheck";
import { runCookieHeader } from "@/lib/writer-receipt";

export const runtime = "nodejs";
export const maxDuration = 60;

async function handlePost(request: Request) {
  const len = Number(request.headers.get("content-length") || 0);
  if (len > 1_000_000) return NextResponse.json({ error: "Request too large" }, { status: 413 });
  const session = await auth();
  // Never credited to a session that still owes its two-step code.
  const userId = forgeUserId(session) ?? null;
  const body = await request.json().catch(() => null);
  const { recordWriterReceipt } = await import("@crucible/core");
  const result = await recheckDocs(body, userId, {
    verify: verifyGrounding,
    record: recordWriterReceipt,
    random: () => randomBytes(16).toString("hex"),
  });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  const res = NextResponse.json({ grounding: result.grounding, receipt: result.receipt });
  if (result.runCookie) res.headers.append("Set-Cookie", runCookieHeader(result.runCookie));
  return res;
}

export const POST = withRateLimit(handlePost, { mode: "forge", endpoint: "forge-recheck" });
