/**
 * "Recent changes to my view": your own view change log (migration 108).
 *   GET ?limit=30            your changes, newest first (made by hand or by t.ROY)
 *   POST { action: "undo", id }   put what that change touched back to how it was
 * Owner-only: the database lets a person read and mark only their own rows.
 */
import { NextResponse } from "next/server";
import { listMyViewChanges, undoViewChange } from "@crucible/core";
import { requireOrgCapability } from "@/lib/org-guard";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const guard = await requireOrgCapability("org.cohort.view", { request });
  if (!guard.ok) return guard.response;
  const limit = Number(new URL(request.url).searchParams.get("limit") ?? 30);
  return NextResponse.json({ changes: await listMyViewChanges(guard.actor, Number.isFinite(limit) ? limit : 30) });
}

export async function POST(request: Request) {
  const guard = await requireOrgCapability("org.cohort.view", { request });
  if (!guard.ok) return guard.response;
  const body = await request.json().catch(() => ({}));
  if (body?.action !== "undo" || typeof body.id !== "string") return NextResponse.json({ error: "Say which change to undo." }, { status: 400 });
  const res = await undoViewChange(guard.actor, { id: body.id }, { byAi: false });
  if (!res.ok) return NextResponse.json({ error: res.error, reason: res.reason }, { status: res.reason === "missing" ? 404 : res.reason === "policy" || res.reason === "access" ? 403 : 409 });
  return NextResponse.json(res);
}
