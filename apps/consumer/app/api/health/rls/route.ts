/**
 * Is the organization boundary being enforced by the database right now?
 *
 * Public response: { ok } only. 200 when every check holds, 503 when any does
 * not -- so an uptime monitor can watch it, and so "RLS was switched off during
 * an incident" cannot stay quiet. `ok` is false whenever the app role can
 * bypass row-level security, any protected table is not enabled AND forced, an
 * unscoped read returns rows, or a scoped read of a demo org sees nothing.
 *
 * Full detail (role name, roleCanBypass, per-table flags, latest migration,
 * problems) only for a signed-in platform admin: open this URL in a browser
 * where you are signed in to the Refinery as a platform admin. The public
 * payload no longer names the database role or lists tables (security sweep
 * 2026-09-30, #22: recon value only, but no reason to hand it out).
 */
import { NextResponse } from "next/server";
import { getRlsHealth } from "@crucible/core";
import { requirePlatformAdmin } from "@/lib/org-guard";

export const dynamic = "force-dynamic";

export async function GET() {
  const admin = await requirePlatformAdmin().catch(() => ({ ok: false as const }));
  const headers = { "Cache-Control": "no-store" };
  try {
    const health = await getRlsHealth();
    const status = health.ok ? 200 : 503;
    return NextResponse.json(admin.ok ? health : { ok: health.ok }, { status, headers });
  } catch {
    return NextResponse.json(
      admin.ok ? { ok: false, problems: ["health check could not run"] } : { ok: false },
      { status: 503, headers }
    );
  }
}
