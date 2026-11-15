/**
 * POST /api/resume/spanish-reading -- "Lectura en español de tu currículum"
 * (lane D1).
 *
 * A faithful Spanish reading of one of the person's OWN saved English resumes.
 * Not a resume, not exportable, never a replacement for the English. Body:
 * { artifactId } and nothing else; the server loads the resume itself.
 *
 * OFF BY DEFAULT (SPANISH_READING_ENABLED, lib/server-switch.ts). While off the
 * route answers 404 exactly like a route that does not exist, before sign-in,
 * limits or anything else runs.
 *
 * The logic is in lib/spanish-reading/handler.ts; the real dependencies are in
 * lib/spanish-reading/deps.ts. Daily caps, the Refinery seat check and the
 * owner's per-workflow policy come from withRateLimit (workflow
 * "spanish-reading" is registered in lib/ai-operation-policy.ts). It is NOT in
 * PROGRESSION_AI, so it never spends the participant's progression call count.
 */
import { withRateLimit } from "@/lib/withRateLimit";
import { spanishReadingOn, switchedOffResponse } from "@/lib/server-switch";
import { handleSpanishReading } from "@/lib/spanish-reading/handler";
import { realReadingDeps } from "@/lib/spanish-reading/deps";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

async function handlePost(request: Request) {
  return handleSpanishReading(request, realReadingDeps());
}

const limited = withRateLimit(handlePost, {
  mode: "user",
  endpoint: "spanish-reading",
  requiredTier: "client",
});

export async function POST(request: Request) {
  if (!spanishReadingOn()) return switchedOffResponse();
  return limited(request);
}
