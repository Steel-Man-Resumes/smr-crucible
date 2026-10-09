/**
 * POST /api/record-check -- build one record check checklist (D11).
 *
 * Its own route and its own prompt (lib/record-check). Requires the person's
 * own, current yes (consent layer "record_check"); staff acting as the person
 * are refused. Accepts exactly three fields: offense, state, job. The offense
 * goes to Anthropic only (no fallback) and is never stored or logged here.
 * Daily caps and tier gate come from withRateLimit, like every AI route.
 */
import { withRateLimit } from "@/lib/withRateLimit";
import { handleBuild } from "@/lib/record-check/handler";
import { realRecordCheckDeps } from "@/lib/record-check/deps";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

async function handlePost(request: Request) {
  return handleBuild(request, realRecordCheckDeps());
}

export const POST = withRateLimit(handlePost, { mode: "user", endpoint: "record-check", requiredTier: "client" });
