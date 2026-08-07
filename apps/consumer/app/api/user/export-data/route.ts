/**
 * GET /api/user/export-data
 *
 * Real server-side data export -- the JBS "download your data" right, done
 * properly. Returns every row Postgres holds for the signed-in user in one
 * JSON payload:
 * - consumer_profile (profile_data, narrative_data, preferences, skills,
 *   career_paths, forge_output)
 * - forge_session content (all sessions ever linked to this user)
 * - refinery_artifact rows (resumes, cover letters, disclosure plans, etc.)
 * - job_application rows (the tracker pipeline)
 * - coach_conversation messages (full AI coach transcript)
 * - consent event history (current state per layer, from consumer_consent)
 * - ai_token_usage totals for this user (not the raw per-call rows -- cost
 *   totals and per-endpoint breakdown, matching what /api/user/ai-costs shows)
 *
 * Mirrors the auth + ownership pattern of /api/user/delete-data (same table
 * set, same user_id scoping) -- this is its read-only twin.
 */

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { query, getUserConsents } from "@crucible/core";

export async function GET() {
  const session = await auth();
  const userId = session?.user?.id;

  if (!userId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  try {
    const [
      consumerProfileRows,
      forgeSessionRows,
      refineryArtifactRows,
      jobApplicationRows,
      coachConversationRows,
      consents,
      aiUsageTotals,
      aiUsageByEndpoint,
    ] = await Promise.all([
      query(
        `SELECT readiness_stage, profile_data, narrative_data, preferences,
                skills, career_paths, forge_output, created_at, updated_at
           FROM consumer_profile
          WHERE user_id = $1`,
        [userId]
      ),
      query(
        `SELECT session_id, current_page, page_data, resume_text, parsed_profile,
                forge_output, status, started_at, completed_at, last_activity_at
           FROM forge_session
          WHERE user_id = $1
          ORDER BY started_at DESC`,
        [userId]
      ),
      query(
        `SELECT id, artifact_type, target_context, content, iteration_number,
                scaffold_level, created_at, updated_at
           FROM refinery_artifact
          WHERE user_id = $1
          ORDER BY created_at DESC`,
        [userId]
      ),
      query(
        `SELECT id, job_title, company, location, salary, description,
                employment_type, source, status, status_updated_at, notes,
                applied_at, follow_up_at, created_at, updated_at
           FROM job_application
          WHERE user_id = $1
          ORDER BY created_at DESC`,
        [userId]
      ),
      query(
        `SELECT role, content, created_at
           FROM coach_conversation
          WHERE user_id = $1
          ORDER BY created_at ASC`,
        [userId]
      ),
      getUserConsents(userId),
      query(
        `SELECT COUNT(*)::int AS calls,
                COALESCE(SUM(input_tokens), 0)::bigint AS input_tokens,
                COALESCE(SUM(output_tokens), 0)::bigint AS output_tokens,
                COALESCE(SUM(cost_usd), 0)::numeric(12,4) AS cost_usd
           FROM ai_token_usage
          WHERE user_id = $1`,
        [userId]
      ),
      query(
        `SELECT endpoint,
                COUNT(*)::int AS calls,
                SUM(cost_usd)::numeric(12,4) AS cost_usd
           FROM ai_token_usage
          WHERE user_id = $1
          GROUP BY endpoint
          ORDER BY SUM(cost_usd) DESC`,
        [userId]
      ),
    ]);

    const payload = {
      exported_at: new Date().toISOString(),
      format_version: "1.0",
      account: {
        id: userId,
        name: session.user?.name ?? null,
        email: session.user?.email ?? null,
      },
      consumerProfile: consumerProfileRows,
      forgeSessions: forgeSessionRows,
      refineryArtifacts: refineryArtifactRows,
      jobApplications: jobApplicationRows,
      coachConversation: coachConversationRows,
      consent: consents,
      aiUsage: {
        totals: aiUsageTotals[0] ?? { calls: 0, input_tokens: 0, output_tokens: 0, cost_usd: 0 },
        perEndpoint: aiUsageByEndpoint,
      },
    };

    return new NextResponse(JSON.stringify(payload, null, 2), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Content-Disposition": 'attachment; filename="steel-man-resumes-export.json"',
      },
    });
  } catch (err: any) {
    console.error("Data export error:", err?.message || err);
    return NextResponse.json(
      { error: "Failed to export data. Please try again." },
      { status: 500 }
    );
  }
}
