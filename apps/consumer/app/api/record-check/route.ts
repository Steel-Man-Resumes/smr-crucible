/**
 * POST /api/record-check -- build one record check checklist (D11).
 *
 * Its own route and its own prompt (lib/record-check). Requires the person's
 * own, current yes (consent layer "record_check"); staff acting as the person
 * are refused. Accepts exactly three fields: offense, state, job. The offense
 * goes to Anthropic only (no fallback); the model returns ids only, and
 * nothing typed is stored or logged here. Same-origin JSON only.
 * Daily caps and tier gate come from withRateLimit, like every AI route.
 */
import { withRateLimit } from "@/lib/withRateLimit";
import { handleBuild } from "@/lib/record-check/handler";
import { realRecordCheckDeps } from "@/lib/record-check/deps";
import { recordStepOn, switchedOffResponse } from "@/lib/server-switch";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

async function handlePost(request: Request) {
  return handleBuild(request, realRecordCheckDeps());
}

const limited = withRateLimit(handlePost, {
  mode: "user",
  endpoint: "record-check",
  requiredTier: "client",
  // Partner usage is logged as org + endpoint + time only (security r1 F7).
  partnerUsageWithoutUser: true,
});

// Off until its public copy ships (lib/server-switch.ts): 404 before sign-in,
// limits or anything else runs.
export async function POST(request: Request) {
  if (!recordStepOn()) return switchedOffResponse();
  return limited(request);
}
