/**
 * GET /api/cron/sync-tracking
 *
 * Nightly Vercel cron: copies per-org tracking from Neon into the Airtable
 * "SMR partners" base so the dashboard stays current without anyone touching
 * it. PII-free (counts/rates/timestamps only). Schedule lives in vercel.json.
 *
 * Auth: Vercel sends `Authorization: Bearer ${CRON_SECRET}`. Fails closed --
 * if CRON_SECRET is not configured, the route rejects everything rather than
 * becoming publicly callable.
 */
import { NextResponse } from "next/server";
import { syncPartnerTrackingToAirtable } from "@crucible/core";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  const authHeader = request.headers.get("authorization");
  if (!secret || authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const apiKey = process.env.AIRTABLE_API_KEY;
  const baseId = process.env.AIRTABLE_TRACKING_BASE_ID;
  if (!apiKey || !baseId) {
    return NextResponse.json(
      { error: "AIRTABLE_API_KEY / AIRTABLE_TRACKING_BASE_ID not configured" },
      { status: 500 }
    );
  }

  try {
    const { orgs } = await syncPartnerTrackingToAirtable({ apiKey, baseId });
    return NextResponse.json({ ok: true, orgs, synced_at: new Date().toISOString() });
  } catch (err: any) {
    console.error("[cron/sync-tracking] failed:", err?.message || err);
    return NextResponse.json({ ok: false, error: "sync failed" }, { status: 500 });
  }
}
