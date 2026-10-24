import { NextResponse } from "next/server";
import { createAccessCode } from "@crucible/core";
import { requirePlatformAdmin } from "@/lib/org-guard";
import { mintCodeChoice } from "@/lib/access-code-guard";

export async function POST(req: Request) {
  const guard = await requirePlatformAdmin();
  if (!guard.ok) return guard.response;

  const body = await req.json().catch(() => ({}));
  const { partnerName, dailyLimit, maxRedemptions, expiresAt, tier: requestedTier } = body;

  if (!partnerName) {
    return NextResponse.json({ error: "partnerName is required" }, { status: 400 });
  }

  // A code is a seat key anyone signed in can try. Random by default; a chosen
  // code only with an explicit confirm (lib/access-code-guard.ts).
  const choice = mintCodeChoice(body);
  if (!choice.ok) {
    return NextResponse.json({ error: choice.error }, { status: 400 });
  }
  const code = choice.code;

  // Seats the database's way (orgCode.ts seatsFull): empty or null = no
  // limit; otherwise a whole number of at least 1. A 0 would be a code nobody
  // can ever use, so it is refused rather than stored.
  const seatsRaw = maxRedemptions === undefined || maxRedemptions === "" ? null : maxRedemptions;
  if (seatsRaw !== null && !(Number.isInteger(seatsRaw) && seatsRaw >= 1 && seatsRaw <= 100000)) {
    return NextResponse.json({ error: "Seats must be a whole number of at least 1, or empty for no limit." }, { status: 400 });
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
      maxRedemptions: seatsRaw,
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
