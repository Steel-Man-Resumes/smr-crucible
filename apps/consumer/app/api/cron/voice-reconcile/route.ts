/**
 * GET /api/cron/voice-reconcile
 *
 * Vercel cron, every 10 minutes: closes out any voice_session leases that
 * ran past their expires_at without the user (or the call route) ever
 * calling /api/interview-voice/end -- a crashed tab, a closed laptop lid, a
 * dropped network connection. For each one: best-effort hang up the OpenAI
 * call if a call_id was captured, mark the lease 'expired', and record the
 * elapsed audio time to ai_token_usage so metering stays accurate even for
 * abandoned sessions. Schedule lives in vercel.json.
 *
 * Auth: Vercel sends `Authorization: Bearer ${CRON_SECRET}`. Fails closed --
 * if CRON_SECRET is not configured, the route rejects everything rather than
 * becoming publicly callable. Same pattern as
 * apps/consumer/app/api/cron/sync-tracking/route.ts.
 */
import { drainPackageDeliveries } from "@/lib/package-delivery-worker";
import { NextResponse } from "next/server";
import { findExpiredActiveSessions, expireSession } from "@crucible/core";
import { recordTokenUsage } from "@/lib/ai-usage-log";
import { reconcileClosedVoiceUsage } from "@/lib/voice-usage-reconcile";
import { REALTIME_MODEL } from "@/lib/voice-instructions";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function hangupProviderCall(callId: string): Promise<void> {
  if (!process.env.OPENAI_API_KEY) return;
  try {
    await fetch(`https://api.openai.com/v1/realtime/calls/${callId}/hangup`, {
      method: "POST",
      signal: AbortSignal.timeout(3000),
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    });
  } catch (err) {
    console.error("[cron/voice-reconcile] hangup failed:", err);
  }
}

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const authHeader = request.headers.get("authorization");
  if (!secret || authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const started = Date.now();
    const expired = await findExpiredActiveSessions(100);
    let reconciled = 0;

    for (const voiceSession of expired) {
      if (Date.now() - started > 20_000) break;
      const hasProviderCall = !!voiceSession.call_id && voiceSession.call_id !== "pending";
      if (hasProviderCall) {
        await hangupProviderCall(voiceSession.call_id!);
      }

      const closed = await expireSession(voiceSession.id, "lease_expired");
      if (!closed) continue;

      await recordTokenUsage(
        "openai",
        REALTIME_MODEL,
        { inputTokens: 0, outputTokens: 0, audioSeconds: closed.elapsedSeconds },
        { userId: voiceSession.user_id, endpoint: "interview-voice", eventKey: `voice:${voiceSession.id}`, operationId: voiceSession.operation_id ?? undefined,
          usageMissing: !hasProviderCall, outcome: hasProviderCall ? "unknown" : "failed" }
      );
      reconciled++;
    }

    const recoveredUsage = await reconcileClosedVoiceUsage();
    const delivery = Date.now() - started < 25_000
      ? await drainPackageDeliveries().catch(() => ({ unavailable: true }))
      : { deferred: true };
    return NextResponse.json({
      recoveredUsage,
      ok: true,
      found: expired.length,
      reconciled,
      delivery,
      checked_at: new Date().toISOString(),
    });
  } catch (err: any) {
    console.error("[cron/voice-reconcile] failed:", err?.message || err);
    return NextResponse.json({ ok: false, error: "reconcile failed" }, { status: 500 });
  }
}
