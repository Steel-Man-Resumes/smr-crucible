/**
 * The participant's sharing controls.
 *
 *   GET   what is on, per organization; who asked; who opened what; the exact
 *         words for each choice (served from the same constants the grant
 *         records a version of, so the page cannot drift from the record)
 *   POST  { action: "grant" | "revoke", orgId, scope }
 *         { action: "answer", requestId, approve }
 *
 * Acts only ever as the signed-in person. There is no parameter here that
 * names whose sharing is being changed.
 */
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import {
  getSharingState,
  getMyAccessLog,
  grantSharing,
  revokeSharing,
  answerSharingRequest,
  SHARING_SCOPES,
  SHARING_SCOPE_TEXT,
  SHARING_ALWAYS_TEXT,
  SHARING_TEXT_VERSION,
  getMyPolicies,
  acknowledgePolicy,
  POLICY_AUDIENCE_TEXT,
  SHARING_REQUIRED_TEXT,
} from "@crucible/core";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const [orgs, log, policies] = await Promise.all([getSharingState(userId), getMyAccessLog(userId), getMyPolicies(userId)]);
  return NextResponse.json({
    // What each program REQUIRES, in its own words, and whether this person has acknowledged it.
    policies: policies.map((p) => ({ ...p, audienceText: POLICY_AUDIENCE_TEXT[p.audience] })),
    requiredText: SHARING_REQUIRED_TEXT,
    orgs: orgs.filter((o) => o.enabled),
    log,
    text: { version: SHARING_TEXT_VERSION, scopes: SHARING_SCOPES.map((s) => ({ scope: s, ...SHARING_SCOPE_TEXT[s] })), always: SHARING_ALWAYS_TEXT },
  });
}

export async function POST(request: Request) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const body = await request.json().catch(() => ({}));
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const id = String(body.action === "answer" ? body.requestId ?? "" : body.action === "acknowledge" ? body.versionId ?? "" : body.orgId ?? "");
  if (!UUID.test(id)) return NextResponse.json({ error: "Not found." }, { status: 404 });

  const res =
    body.action === "grant" ? await grantSharing(userId, String(body.orgId ?? ""), String(body.scope ?? ""))
    : body.action === "revoke" ? await revokeSharing(userId, String(body.orgId ?? ""), String(body.scope ?? ""))
    : body.action === "answer" ? await answerSharingRequest(userId, String(body.requestId ?? ""), body.approve === true)
    : body.action === "acknowledge" ? await acknowledgePolicy(userId, String(body.versionId ?? ""))
    : ({ ok: false, error: "Unknown action." } as const);
  return res.ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: res.error }, { status: 400 });
}
