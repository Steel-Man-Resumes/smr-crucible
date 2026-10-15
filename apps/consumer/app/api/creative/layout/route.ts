/**
 * Creative lane page layout (artist resume, bio card). The work is in
 * lib/creative-render-handler.ts; this file only adds the per-IP rate limit.
 */

import { withRateLimit } from "@/lib/withRateLimit";
import { handleCreativeLayoutPost } from "@/lib/creative-render-handler";

export const runtime = "nodejs";
export const maxDuration = 15;

export const POST = withRateLimit(handleCreativeLayoutPost, {
  mode: "forge",
  endpoint: "creative-layout",
});
