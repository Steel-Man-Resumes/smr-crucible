import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getUserTier, setUserTier, type UserTier } from "@crucible/core";

const ALLOWED_SELF_TIERS: UserTier[] = ["client", "partner", "observer"];

// Tier priority — lower number = higher privilege
const TIER_RANK: Record<string, number> = {
  admin: 0,
  partner: 1,
  client: 2,
  observer: 3,
};

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const body = await req.json();
  const { tier } = body;

  // Validate tier value — cannot self-escalate to admin
  if (!tier || !ALLOWED_SELF_TIERS.includes(tier)) {
    return NextResponse.json({ error: "Invalid tier" }, { status: 400 });
  }

  // Only set if new tier isn't a downgrade from a code-based tier
  const currentTier = await getUserTier(session.user.id);
  const currentRank = TIER_RANK[currentTier] ?? 3;
  const newRank = TIER_RANK[tier] ?? 3;

  // Don't downgrade — code-based tier always wins
  if (newRank > currentRank) {
    return NextResponse.json({ tier: currentTier, unchanged: true });
  }

  await setUserTier(session.user.id, tier as UserTier);
  return NextResponse.json({ tier, success: true });
}
