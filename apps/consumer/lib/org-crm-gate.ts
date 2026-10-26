/**
 * What the staff-workflow routes share (house lane L5): the staff workspace
 * (crm_v2) check after the org guard, the same-origin refusal for writes, and
 * body reading. Everything about WHICH rows comes from core, never from here.
 */
import { NextResponse } from "next/server";
import { getOne, type OrgActor } from "@crucible/core";
import type { OrgGuardResult } from "@/lib/org-guard";
import { isSameOriginRequest } from "@/lib/same-origin";

export type CrmGate = { ok: true; actor: OrgActor } | { ok: false; response: NextResponse };

/**
 * After the org guard (each route calls requireOrgCapability itself, passing
 * its request, so view-as is honored: L2): the staff workspace must be on.
 */
export async function withCrm(guard: OrgGuardResult): Promise<CrmGate> {
  if (!guard.ok) return guard;
  const flag = await getOne<{ crm_v2: boolean }>(`SELECT crm_v2 FROM access_code WHERE id = $1`, [guard.actor.orgId]);
  if (!flag?.crm_v2) return { ok: false, response: NextResponse.json({ error: "Not found." }, { status: 404 }) };
  return guard;
}

/**
 * Writes come only from this app's own pages (lib/same-origin.ts). Checked
 * BEFORE the session is read, so a cross-site post learns nothing. The drafts
 * route also accepts a text/plain body (navigator.sendBeacon); same-origin is
 * what keeps that safe.
 */
export function refuseCrossOrigin(request: Request): NextResponse | null {
  return isSameOriginRequest(request.headers) ? null : NextResponse.json({ error: "Not allowed." }, { status: 403 });
}

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** JSON body, also when it arrives as text/plain (navigator.sendBeacon on page hide). */
export async function readJson(request: Request): Promise<Record<string, unknown>> {
  try {
    const text = await request.text();
    if (!text || text.length > 100_000) return {};
    const v = JSON.parse(text);
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch { return {}; }
}
