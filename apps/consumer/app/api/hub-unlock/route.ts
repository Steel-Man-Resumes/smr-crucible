import { NextResponse } from "next/server";
import { query, getOne, redeemAccessCode } from "@crucible/core";

/**
 * Server-to-server endpoint for the Waukesha Hub to unlock Forge/Refinery access.
 *
 * The Hub calls this when a user crosses the credit threshold.
 * Requires a shared secret (HUB_UNLOCK_SECRET env var).
 *
 * If the user doesn't have a Crucible account yet, we create a pre-authorization
 * record so when they sign up on Crucible, the access code is auto-applied.
 */
export async function POST(request: Request) {
  const secret = request.headers.get("x-hub-secret");
  if (!secret || secret !== process.env.HUB_UNLOCK_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json();
  const { email, hub_user_id, unlock_level } = body;

  if (!email || !hub_user_id) {
    return NextResponse.json({ error: "email and hub_user_id are required" }, { status: 400 });
  }

  if (!["forge", "refinery"].includes(unlock_level)) {
    return NextResponse.json({ error: "unlock_level must be 'forge' or 'refinery'" }, { status: 400 });
  }

  try {
    // Determine the access code to use
    const codeValue = unlock_level === "refinery" ? "WAUKESHA-HUB-REFINERY" : "WAUKESHA-HUB-FORGE";

    // Ensure the access code exists (create if not)
    let accessCode = await getOne<{ id: string }>(
      "SELECT id FROM access_code WHERE code = $1",
      [codeValue]
    );

    if (!accessCode) {
      const rows = await query<{ id: string }>(
        `INSERT INTO access_code (code, partner_name, tier, daily_limit, max_redemptions, is_active)
         VALUES ($1, 'Waukesha Resource Navigator', 'partner', 200, NULL, true)
         RETURNING id`,
        [codeValue]
      );
      accessCode = rows[0];
    }

    // Check if user exists in Crucible by email
    const crucibleUser = await getOne<{ id: string }>(
      "SELECT id FROM users WHERE email = $1",
      [email.toLowerCase().trim()]
    );

    if (crucibleUser) {
      // Through the one redemption path. This route used to insert the
      // membership row itself, with no active, expiry or capacity check, and
      // bump the counter in a separate statement. "already_member" is success
      // here: the hub is asking that they HAVE access, not that it be new.
      const res = await redeemAccessCode(crucibleUser.id, codeValue);
      if (!res.success && res.outcome !== "already_member") {
        return NextResponse.json(
          { success: false, status: "not_redeemed", reason: res.outcome },
          { status: 409 }
        );
      }

      return NextResponse.json({
        success: true,
        status: "redeemed",
        crucible_user_id: crucibleUser.id,
      });
    }

    // User doesn't exist yet -- store a pre-authorization
    // When they sign up with this email, the access code will be waiting
    const existingPreauth = await getOne<{ id: string }>(
      "SELECT id FROM hub_preauthorizations WHERE email = $1 AND access_code_id = $2",
      [email.toLowerCase().trim(), accessCode.id]
    );

    if (!existingPreauth) {
      // The table comes from migration 050. It used to be created here, per
      // request, AFTER the SELECT above had already needed it.
      await query(
        `INSERT INTO hub_preauthorizations (email, hub_user_id, access_code_id, unlock_level)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (email, access_code_id) DO NOTHING`,
        [email.toLowerCase().trim(), hub_user_id, accessCode.id, unlock_level]
      );
    }

    return NextResponse.json({
      success: true,
      status: "preauthorized",
      message: "User doesn't have a Crucible account yet. Access code will be applied when they sign up.",
    });
  } catch (err) {
    console.error("Hub unlock error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
