/**
 * DELETE /api/user/delete-data
 *
 * Deletes all user data from Postgres:
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
 */

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { query } from "@crucible/core";

export async function DELETE() {
  const session = await auth();
  const userId = session?.user?.id;

  if (!userId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  try {
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
