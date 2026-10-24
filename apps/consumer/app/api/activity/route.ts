/**
 * POST /api/activity
 *
 * Phase 1D: server-side counterpart to the localStorage "consumer_progress"
 * tracker. The client's trackProgress() helper (apps/consumer/lib/
 * track-progress.ts) fire-and-forgets a ping here whenever it also writes to
 * localStorage (dual-write -- localStorage keeps working until Phase 4.2
 * retires it). Body is intentionally tiny: { type, context? }.
 */

import { NextResponse } from "next/server";
import { effectiveAuth as auth } from "@/lib/effective-auth";
import { recordProgressEvent, isProgressEventType, runAsUser } from "@crucible/core";

const MAX_BODY_BYTES = 2_000;

export async function POST(request: Request) {
  const contentLength = request.headers.get("content-length");
  if (contentLength && parseInt(contentLength, 10) > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "Request too large" }, { status: 413 });
  }

  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "Request too large" }, { status: 413 });
  }

  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }
  const { type, context } = body as { type?: unknown; context?: unknown };
  if (!isProgressEventType(type)) {
    return NextResponse.json({ error: "Unknown event type" }, { status: 400 });
  }
  const eventContext =
    context && typeof context === "object" && !Array.isArray(context)
      ? (context as Record<string, unknown>)
      : {};

  try {
    if (type === "session_start") {
      // One session_start per account per UTC day, whatever page or tab sends it.
      // The lock serializes two tabs opening at once so neither double-counts.
      await runAsUser(userId, (sql) => [
        sql`SELECT pg_advisory_xact_lock(hashtextextended(${userId}, 875))`,
        sql`INSERT INTO user_progress_event(user_id,event_type,context)
          SELECT ${userId}::uuid,'session_start',${JSON.stringify(eventContext)}::jsonb
          WHERE NOT EXISTS (SELECT 1 FROM user_progress_event WHERE user_id=${userId}::uuid AND event_type='session_start'
            AND created_at >= date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC')`,
      ]);
      return NextResponse.json({ ok: true });
    }
    await recordProgressEvent(userId, type, eventContext);
  } catch (err: any) {
    console.error("recordProgressEvent error:", err?.message || err);
    return NextResponse.json({ error: "Failed to record activity" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
