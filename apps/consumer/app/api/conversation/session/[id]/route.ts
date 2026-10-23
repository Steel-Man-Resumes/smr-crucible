/**
 * GET /api/conversation/session/[id]?purpose=... -- the DECRYPTED transcript
 * for one of the caller's OWN sessions (Phase 5.1). This is the session-history
 * detail view. Owner-exclusive: a foreign or unknown id returns 404, never
 * another user's transcript.
 *
 * no-store: a decrypted transcript must never be cached by a browser, proxy,
 * or CDN.
 */

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { readSavedVoiceReport, type SavedVoiceReport } from "@/lib/saved-voice-report";
import { getOneAsUser, type RefineryArtifact } from "@crucible/core";
import { getConversationTranscript, isConversationPurpose } from "@crucible/core";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store",
  Pragma: "no-cache",
} as const;

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(request: Request, context: RouteContext) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json(
      { error: "Not authenticated" },
      { status: 401, headers: NO_STORE_HEADERS }
    );
  }

  const purpose = new URL(request.url).searchParams.get("purpose");
  if (!isConversationPurpose(purpose)) {
    return NextResponse.json(
      { error: "Unknown purpose" },
      { status: 400, headers: NO_STORE_HEADERS }
    );
  }

  const { id } = await context.params;

  const transcript = await getConversationTranscript({
    ownerUserId: userId,
    purpose,
    sessionId: id,
  });
  if (!transcript) {
    return NextResponse.json(
      { error: "Not found" },
      { status: 404, headers: NO_STORE_HEADERS }
    );
  }

  // Read the existing feedback artifact only after the owner-exclusive
  // transcript lookup succeeded. No transcript is copied into artifact storage.
  let report: SavedVoiceReport | null = null;
  let reportStatus: "available" | "missing" | "unavailable" = "missing";
  if (purpose === "interview_voice") {
    try {
      const artifact = await getOneAsUser<RefineryArtifact>(userId,
        `SELECT id, artifact_type, target_context, content FROM refinery_artifact
         WHERE user_id=$1 AND artifact_type='interview_prep'
           AND target_context->>'voiceSessionId'=$2 AND content->>'mode'='voice'
         ORDER BY created_at DESC, id DESC LIMIT 1`, [userId, id]);
      report = readSavedVoiceReport(artifact, id);
      reportStatus = report ? "available" : "missing";
    } catch { reportStatus = "unavailable"; }
  }
  return NextResponse.json(
    { sessionId: id, purpose, transcript, ...(purpose === "interview_voice" ? { report, reportStatus } : {}) },
    { headers: NO_STORE_HEADERS }
  );
}
