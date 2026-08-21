/**
 * POST /api/user/export-data
 *
 * Real server-side data export -- the JBS "download your data" right, done
 * properly. Returns the data Steel Man Resumes holds for the signed-in user in
 * one JSON payload (their own content, account activity, and consent history --
 * not internal operational rows like deletion-task queues):
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
 * set, same user_id scoping) -- this is its read-only twin, including the
 * same Phase 1C reauth gate (a full data export is nearly as sensitive as
 * deletion): POST body must carry { confirm: true, password } for
 * password accounts or { confirm: true, typedConfirmation: "DELETE" } for
 * magic-link/OAuth-only accounts. Method changed from GET to POST for this
 * pass specifically so the reauth fields can travel in the body rather than
 * a query string (which would leak a password into logs/history).
 *
 * Per-category selection (Phase 7.4): the body may carry
 * `categories: string[]` to export only some of your data. Recognized keys:
 *   "resumes"      -> consumer_profile + forge_session + refinery_artifact
 *   "applications" -> job_application
 *   "chat"         -> coach_conversation
 *   "consent"      -> consent event history
 *   "usage"        -> ai_token_usage totals
 *   "decisions"    -> decision_log rows (the recorded AI decisions about you)
 *   "login_history"-> user_login_event rows (your own sign-in history)
 *   "org"          -> access_code_redemption rows (your org membership)
 *   "disclosure_rehearsal" -> decrypted disclosure rehearsal transcripts (5.1)
 *   "interview_voice"      -> decrypted interview voice transcripts (5.1)
 *   "avatar"               -> avatar_asset METADATA manifest (7.7): kind,
 *                            source, dimensions, mime, size, sha256, dates --
 *                            NO bytes. The image is owner-only via its proxy.
 *   "vault"                -> vault_document METADATA manifest (6.2): category,
 *                            label, filename, size, sha256, dates, linked job --
 *                            NO bytes. The actual encrypted files download as a
 *                            ZIP from the separate /api/user/export-vault route.
 * The `account` block (id/name/email) is always included. If `categories` is
 * missing/empty or contains "everything", the full dump is returned (the
 * default), so old callers are unchanged.
 *
 * Cache-Control: no-store + Pragma: no-cache -- this payload must never be
 * cached by a browser, proxy, or CDN.
 */

import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { auth } from "@/auth";
import { query, getOne, getUserConsents, exportUserConversations } from "@crucible/core";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store",
  Pragma: "no-cache",
} as const;

export async function POST(req: Request) {
  const session = await auth();
  const userId = session?.user?.id;

  if (!userId) {
    return NextResponse.json(
      { error: "Not authenticated" },
      { status: 401, headers: NO_STORE_HEADERS }
    );
  }

  const body = await req.json().catch(() => ({}));
  if (body?.confirm !== true) {
    return NextResponse.json(
      { error: "Set confirm: true to acknowledge this exports all your stored data." },
      { status: 400, headers: NO_STORE_HEADERS }
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
        { error: "Enter your password to confirm this export." },
        { status: 400, headers: NO_STORE_HEADERS }
      );
    }
  } else {
    if (body?.typedConfirmation !== "DELETE") {
      return NextResponse.json(
        { error: 'Type "DELETE" in typedConfirmation to confirm this export.' },
        { status: 400, headers: NO_STORE_HEADERS }
      );
    }
  }

  // Per-category selection. Missing/empty or "everything" -> full dump.
  const rawCats = Array.isArray(body?.categories) ? body.categories : [];
  const selected = new Set(
    rawCats.filter((c: unknown): c is string => typeof c === "string")
  );
  const everything = selected.size === 0 || selected.has("everything");
  const want = (cat: string) => everything || selected.has(cat);

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

    const payload: Record<string, unknown> = {
      exported_at: new Date().toISOString(),
      format_version: "1.1",
      categories: everything ? "everything" : Array.from(selected),
      account: {
        id: userId,
        name: session.user?.name ?? null,
        email: session.user?.email ?? null,
      },
    };
    if (want("resumes")) {
      payload.consumerProfile = consumerProfileRows;
      payload.forgeSessions = forgeSessionRows;
      payload.refineryArtifacts = refineryArtifactRows;
    }
    if (want("applications")) payload.jobApplications = jobApplicationRows;
    if (want("chat")) payload.coachConversation = coachConversationRows;

    // Phase 5.1: DECRYPTED, text-only transcripts, split by purpose so each is
    // its own export category. Only decrypt when actually requested.
    if (want("disclosure_rehearsal") || want("interview_voice")) {
      const conversations = await exportUserConversations(userId);
      if (want("disclosure_rehearsal")) {
        payload.disclosureRehearsals = conversations.filter(
          (c) => c.purpose === "disclosure_rehearsal"
        );
      }
      if (want("interview_voice")) {
        payload.interviewVoiceSessions = conversations.filter(
          (c) => c.purpose === "interview_voice"
        );
      }
    }
    // Phase 6.2: vault inventory (metadata only, no bytes). Joined to
    // secure_object for real size/mime/sha and to job_application for the link.
    if (want("vault")) {
      payload.vaultDocuments = await query(
        `SELECT vd.id, vd.category, vd.label, vd.original_filename, vd.note,
                so.mime_type, so.byte_size, so.sha256,
                vd.created_at, vd.updated_at,
                vd.linked_job_id,
                ja.job_title AS linked_job_title, ja.company AS linked_job_company
           FROM vault_document vd
           JOIN secure_object so ON so.id = vd.secure_object_id
           LEFT JOIN job_application ja ON ja.id = vd.linked_job_id
          WHERE vd.user_id = $1
          ORDER BY vd.created_at DESC`,
        [userId]
      );
    }
    // Phase 7.7: avatar photo/headshot inventory (metadata only, no bytes). The
    // encrypted image bytes are owner-only and reachable solely through the
    // per-asset image proxy; this manifest records what exists. Metadata-only
    // (not a zip) is a deliberate choice: an avatar is a single small square the
    // user chose, and the JSON manifest is enough to know what is stored.
    if (want("avatar")) {
      payload.avatarAssets = await query(
        `SELECT aa.id, aa.kind, aa.source_asset_id, aa.width, aa.height,
                so.mime_type, so.byte_size, so.sha256, aa.created_at
           FROM avatar_asset aa
           JOIN secure_object so ON so.id = aa.secure_object_id
          WHERE aa.user_id = $1
          ORDER BY aa.created_at DESC`,
        [userId]
      );
    }
    if (want("consent")) payload.consent = consents;
    if (want("usage")) {
      payload.aiUsage = {
        totals: aiUsageTotals[0] ?? { calls: 0, input_tokens: 0, output_tokens: 0, cost_usd: 0 },
        perEndpoint: aiUsageByEndpoint,
      };
    }

    // Account activity + governance the user is entitled to (Phase compliance,
    // 2026-08-21): the recorded AI decisions about them, their own login history,
    // and their org membership. SELECT * (their own rows) avoids column drift.
    if (want("decisions")) {
      payload.decisions = await query(
        `SELECT * FROM decision_log WHERE user_id = $1 ORDER BY created_at DESC LIMIT 2000`,
        [userId]
      );
    }
    if (want("login_history")) {
      payload.loginHistory = await query(
        `SELECT * FROM user_login_event WHERE user_id = $1 ORDER BY created_at DESC LIMIT 2000`,
        [userId]
      );
    }
    if (want("org")) {
      payload.orgMembership = await query(
        `SELECT * FROM access_code_redemption WHERE user_id = $1`,
        [userId]
      );
    }

    return new NextResponse(JSON.stringify(payload, null, 2), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Content-Disposition": 'attachment; filename="steel-man-resumes-export.json"',
        ...NO_STORE_HEADERS,
      },
    });
  } catch (err: any) {
    console.error("Data export error:", err?.message || err);
    return NextResponse.json(
      { error: "Failed to export data. Please try again." },
      { status: 500, headers: NO_STORE_HEADERS }
    );
  }
}
