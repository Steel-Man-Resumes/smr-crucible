import { NextResponse } from "next/server";
import { effectiveAuth as auth } from "@/lib/effective-auth";
import { getUserDailyUsage, getUserDailyLimit } from "@crucible/core";

export async function GET() {
  const session = await auth();
  const userId = session?.user?.id;

  if (!userId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const [used, limit] = await Promise.all([
    getUserDailyUsage(userId),
    getUserDailyLimit(userId),
  ]);

  return NextResponse.json({
    used,
    limit: limit === 0 ? null : limit, // null = unlimited
    remaining: limit === 0 ? null : Math.max(0, limit - used),
  });
}
