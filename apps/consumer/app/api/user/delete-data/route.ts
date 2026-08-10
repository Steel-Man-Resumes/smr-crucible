/**
 * DELETE /api/user/delete-data
 *
 * Deletes all user data from Postgres:
 * - secure_object rows (Phase 1C vault/transcript/headshot platform) + the
 *   underlying R2 ciphertext, via the deletion_task retry ledger
 * - refinery_artifact (resumes, disclosure plans, etc.)
 * - forge_session
 * - consumer_profile
 * - job_application
 * - decision_log entries
 * - ai_usage entries
 * - coach_conversation (AI coach memory -- full transcript erase)
 *
 * Does NOT delete the user account itself (they can sign back in).
 * Client-side should also clear localStorage after calling this.
 *
 * REAUTH CONTRACT (Phase 1C): this is destructive and irreversible, so a
 * valid session alone is not enough -- the request body must additionally
 * prove intent:
 *   { "confirm": true, "password": "..." }       -- password-account users
 *   { "confirm": true, "typedConfirmation": "DELETE" }  -- magic-link-only
 *                                                    users (no password_hash)
 * `confirm: true` is always required. If the account has a password_hash,
 * `password` must bcrypt-match it (same compare pattern as auth.ts). If it
 * doesn't (magic-link/OAuth-only account), `typedConfirmation` must be the
 * exact string "DELETE" instead, since there's no secret to re-prove.
 *
 * TRANSACTION LIMITATION: `query()` (packages/core/src/db.ts) runs over
 * neon-http, which executes one statement per HTTP call with no
 * cross-statement transaction -- there is no BEGIN/COMMIT spanning these
 * DELETEs from this driver. Instead, every step here is written to be safe
 * to retry: each DELETE is scoped to `user_id = $1` on tables with no
 * further dependency on each other, so a crash between any two steps just
 * means the next attempt re-runs the remaining (now-empty-safe) deletes.
 * The one truly two-phase part -- R2 object deletion -- goes through
 * enqueueDeletion()/deletion_task instead of an inline R2 call for exactly
 * this reason: the R2 delete can be retried by the cron independently of
 * whether the DB rows are still around.
 */

import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { auth } from "@/auth";
import { query, getOne, listSecureObjectsForOwner, enqueueDeletion } from "@crucible/core";

export async function DELETE(req: Request) {
  const session = await auth();
  const userId = session?.user?.id;

  if (!userId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  if (body?.confirm !== true) {
    return NextResponse.json(
      { error: "Set confirm: true to acknowledge this permanently deletes your data." },
      { status: 400 }
    );
  }

  const account = await getOne<{ password_hash: string | null }>(
    "SELECT password_hash FROM users WHERE id = $1",
    [userId]
  );
  if (account?.password_hash) {
    const password = typeof body?.password === "string" ? body.password : "";
    const valid = password && (await bcrypt.compare(password, account.password_hash));
    if (!valid) {
      return NextResponse.json(
        { error: "Enter your password to confirm account deletion." },
        { status: 400 }
      );
    }
  } else {
    if (body?.typedConfirmation !== "DELETE") {
      return NextResponse.json(
        { error: 'Type "DELETE" in typedConfirmation to confirm account deletion.' },
        { status: 400 }
      );
    }
  }

  try {
    // Secure objects: enqueue R2 cleanup before dropping the rows so a
    // retry can always re-derive what's left to delete (see TRANSACTION
    // LIMITATION note above).
    const secureObjects = await listSecureObjectsForOwner(userId);
    for (const obj of secureObjects) {
      await enqueueDeletion(userId, "r2_object", `${obj.bucket}::${obj.object_key}`);
    }
    await query("DELETE FROM secure_object WHERE owner_user_id = $1", [userId]);

    // Delete in dependency order (children first)
    // refinery_artifact has CASCADE on user_id, but be explicit
    await query("DELETE FROM refinery_artifact WHERE user_id = $1", [userId]);
    await query("DELETE FROM job_application WHERE user_id = $1", [userId]);
    await query("DELETE FROM decision_log WHERE user_id = $1", [userId]);
    await query("DELETE FROM ai_usage WHERE user_id = $1", [userId]);
    await query("DELETE FROM coach_conversation WHERE user_id = $1", [userId]);
    await query("DELETE FROM forge_session WHERE user_id = $1", [userId]);
    await query("DELETE FROM consumer_profile WHERE user_id = $1", [userId]);
    // Reset access codes and tier
    await query("DELETE FROM access_code_redemption WHERE user_id = $1", [userId]);
    await query("UPDATE users SET tier = 'client' WHERE id = $1", [userId]);

    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error("Data deletion error:", err?.message || err);
    return NextResponse.json(
      { error: "Failed to delete data. Please try again." },
      { status: 500 }
    );
  }
}
