/**
 * Resume layout API. The work is in lib/resume-layout-handler.ts; this file only
 * adds the per-IP rate limit.
 */

import { withRateLimit } from "@/lib/withRateLimit";
import { handleLayoutPost } from "@/lib/resume-layout-handler";

export const runtime = "nodejs";
export const maxDuration = 15;

export const POST = withRateLimit(handleLayoutPost, {
  mode: "forge",
  endpoint: "resume-layout",
});
