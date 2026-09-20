/**
 * Is the organization boundary being enforced by the database right now?
 *
 * Signals only: which role the app connects as, whether that role can bypass
 * row-level security, whether each protected table is enabled AND forced,
 * whether an unscoped read comes back empty, and whether a scoped read of a
 * demo org still sees its rows. No rows, no names, no counts of real people.
 * Table names are not a secret; they are in the public repository.
 *
 * 200 when every check holds, 503 when any does not -- so an uptime monitor
 * can watch it, and so "RLS was switched off during an incident" cannot stay
 * quiet.
 */
import { NextResponse } from "next/server";
import { getRlsHealth } from "@crucible/core";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const health = await getRlsHealth();
    return NextResponse.json(health, { status: health.ok ? 200 : 503 });
  } catch {
    return NextResponse.json({ ok: false, problems: ["health check could not run"] }, { status: 503 });
  }
}
