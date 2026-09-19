import { NextResponse } from "next/server";
import { createAccessCode } from "@crucible/core";
import { requirePlatformAdmin } from "@/lib/org-guard";

export async function POST(req: Request) {
  const guard = await requirePlatformAdmin();
  if (!guard.ok) return guard.response;

  const body = await req.json();
  const { code, partnerName, dailyLimit, maxRedemptions, expiresAt, tier: requestedTier } = body;

  if (!code || !partnerName) {
    return NextResponse.json(
      { error: "code and partnerName are required" },
      { status: 400 }
    );
  }

  if (!/^[A-Z0-9]{4,20}$/.test(code)) {
    return NextResponse.json(
      { error: "code must be 4-20 uppercase alphanumeric characters" },
      { status: 400 }
    );
  }

  // Mintable tiers only -- 'client' = cohort seat code (keeps the redeemer's
  // client journey; role stays with the code owner), 'partner' = org staff.
  // 'admin'/'unlimited' are NEVER mintable from the API (escalation guard).
  const mintTier = requestedTier === "client" ? "client" : "partner";

  try {
    const accessCode = await createAccessCode({
      code,
      partnerName,
      tier: mintTier,
      dailyLimit: dailyLimit ?? 200,
      maxRedemptions: maxRedemptions ?? null,
      expiresAt: expiresAt ?? null,
      createdBy: guard.userId,
    });

    return NextResponse.json({ accessCode });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "unknown error";
    if (msg.includes("duplicate") || msg.includes("unique")) {
      return NextResponse.json(
        { error: "Code already exists" },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: "Failed to create code" }, { status: 500 });
  }
}
