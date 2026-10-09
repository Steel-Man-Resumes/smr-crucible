/**
 * Document Download API. The work is in lib/forge-download-handler.ts; this file
 * only adds the per-IP rate limit. See that file for formats, DRAFT handling and
 * the safety limits.
 */

import { withRateLimit } from "@/lib/withRateLimit";
import { handleDownloadPost } from "@/lib/forge-download-handler";

export const runtime = "nodejs";
export const maxDuration = 30;

export const POST = withRateLimit(handleDownloadPost, {
  mode: "forge",
  endpoint: "forge-download",
});
