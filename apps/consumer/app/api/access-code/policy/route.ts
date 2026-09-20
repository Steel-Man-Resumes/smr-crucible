/**
 * GET ?code=XXXX -- what the program behind a code requires, BEFORE joining.
 * Signed-in users only. Returns { policy: null } when it requires nothing, and
 * the same for an unknown code: this is not a way to test whether codes exist.
 */
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getPolicyForCode, SHARING_SCOPE_TEXT, POLICY_AUDIENCE_TEXT, SHARING_REQUIRED_TEXT } from "@crucible/core";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const code = new URL(request.url).searchParams.get("code") ?? "";
  if (!/^[A-Za-z0-9-]{4,40}$/.test(code)) return NextResponse.json({ policy: null });
  const p = await getPolicyForCode(code);
  if (!p) return NextResponse.json({ policy: null });
  return NextResponse.json({
    policy: { ...p, items: p.scopes.map((s) => ({ scope: s, ...SHARING_SCOPE_TEXT[s] })), audienceText: POLICY_AUDIENCE_TEXT[p.audience] },
    text: SHARING_REQUIRED_TEXT,
  });
}
