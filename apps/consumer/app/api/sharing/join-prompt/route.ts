/**
 * GET -> should this person be asked, once, whether their organization may see
 * their progress? { show: false } or { show: true, orgId, orgName }.
 *
 * Read-only. The answer is recorded by POST /api/consent (the same consent the
 * Settings switch sets). Acts only as the signed-in person.
 */
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getJoinSharingPrompt } from "@crucible/core";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  try {
    // viewerId is the person's own id, so "Not now" can be remembered per account in this browser.
    return NextResponse.json({ ...(await getJoinSharingPrompt(userId)), viewerId: userId });
  } catch (err: any) {
    // A prompt that cannot be worked out is simply not shown.
    console.error("join sharing prompt failed:", err?.message || err);
    return NextResponse.json({ show: false });
  }
}
