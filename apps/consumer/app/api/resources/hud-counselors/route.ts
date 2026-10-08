/**
 * HUD Housing Counselor API Proxy
 *
 * Proxies the public HUD Housing Counselor API (lib/hud-counselors.ts).
 * No API key required: HUD exposes this freely.
 * Returns structured list of housing counseling agencies near a location.
 */

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { checkPremium } from "@/lib/premium-server";
import { findHudCounselors } from "@/lib/hud-counselors";

export const maxDuration = 15;

export async function GET(request: Request) {
  // Local resources are a premium tool (lib/premium.ts): signed in, and open
  // through an organization or a grant.
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Please sign in to use this feature." }, { status: 401 });
  const locked = await checkPremium(userId, "resources");
  if (locked) return locked;

  const { searchParams } = new URL(request.url);
  return NextResponse.json({ counselors: await findHudCounselors(searchParams.get("location")) });
}
