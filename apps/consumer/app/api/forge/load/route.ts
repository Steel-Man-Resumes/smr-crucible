import { NextResponse } from "next/server";
import { effectiveAuth as auth } from "@/lib/effective-auth";
import { loadForgeProfile } from "@crucible/core";

export async function GET() {
  const session = await auth();
  const userId = session?.user?.id;

  if (!userId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const profile = await loadForgeProfile(userId);

  if (!profile) {
    return NextResponse.json({ data: null });
  }

  return NextResponse.json({ data: profile });
}
