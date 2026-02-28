import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getUserAccessCodes } from "@crucible/core";

export async function GET() {
  const session = await auth();
  const userId = session?.user?.id;

  if (!userId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const codes = await getUserAccessCodes(userId);

  return NextResponse.json({
    codes: codes.map((c) => ({
      partner_name: c.partner_name,
      tier: c.tier,
      daily_limit: c.daily_limit,
      redeemed_at: c.redeemed_at,
    })),
  });
}
