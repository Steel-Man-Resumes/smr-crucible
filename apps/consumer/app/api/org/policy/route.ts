/**
 * What the program requires participants to share.
 *   GET  the current version, whether it can be used/edited, and where each member stands
 *   PUT  { scopes, audience, purpose, coversExisting }   owner only; always a NEW version
 * The database checks the owner for itself and refuses scopes that can never be required.
 */
import { NextResponse } from "next/server";
import {
  getOrgPolicyState, setOrgSharingPolicy, REQUIRABLE_SCOPES, SHARING_SCOPE_TEXT, POLICY_AUDIENCES,
  POLICY_AUDIENCE_TEXT, POLICY_PURPOSE_PRESETS, SHARING_REQUIRED_TEXT,
} from "@crucible/core";
import { requireOrgCapability } from "@/lib/org-guard";

export const dynamic = "force-dynamic";

export async function GET() {
  const guard = await requireOrgCapability("org.staff.manage");
  if (!guard.ok) return guard.response;
  const state = await getOrgPolicyState(guard.actor);
  if (!state) return NextResponse.json({ error: "You do not have access to that." }, { status: 403 });
  return NextResponse.json({
    ...state,
    orgName: guard.actor.orgName,
    options: {
      scopes: REQUIRABLE_SCOPES.map((s) => ({ scope: s, label: SHARING_SCOPE_TEXT[s].label, shows: SHARING_SCOPE_TEXT[s].shows, never: SHARING_SCOPE_TEXT[s].never })),
      audiences: POLICY_AUDIENCES.map((a) => ({ audience: a, text: POLICY_AUDIENCE_TEXT[a] })),
      presets: POLICY_PURPOSE_PRESETS,
      text: SHARING_REQUIRED_TEXT,
    },
  });
}

export async function PUT(request: Request) {
  const guard = await requireOrgCapability("org.staff.manage");
  if (!guard.ok) return guard.response;
  const body = await request.json().catch(() => ({}));
  const res = await setOrgSharingPolicy(guard.actor, {
    scopes: Array.isArray(body.scopes) ? body.scopes.map(String) : [],
    audience: String(body.audience ?? ""), purpose: String(body.purpose ?? ""), coversExisting: body.coversExisting === true,
  });
  return res.ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: res.error }, { status: 400 });
}
