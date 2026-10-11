/**
 * Document Download API. The work is in lib/forge-download-handler.ts; this file
 * adds the per-IP rate limit and the two things the handler needs from the
 * server: who is signed in (fully: never a session that still owes its second
 * step) and how to read that person's saved revision (owner only, migration
 * 081). See that file for formats, how DRAFT is decided, and the limits.
 */

import { withRateLimit } from "@/lib/withRateLimit";
import { handleDownloadPost, type DownloadDeps } from "@/lib/forge-download-handler";
import { auth } from "@/auth";
import { forgeSessionUser } from "@/lib/session-policy";

export const runtime = "nodejs";
export const maxDuration = 30;

const deps: DownloadDeps = {
  userId: async () => {
    const session = await auth();
    return forgeSessionUser(session)?.id ?? null;
  },
  getRevision: async (userId, revisionId) => {
    const { getRevision } = await import("@crucible/core");
    return getRevision(userId, revisionId);
  },
  receiptState: async (userId, runId) => {
    const { newestWriterReceiptNonce, runBelongsTo } = await import("@crucible/core");
    return { newestNonce: await newestWriterReceiptNonce(userId, runId), linked: await runBelongsTo(userId, runId) };
  },
};

export const POST = withRateLimit((request: Request) => handleDownloadPost(request, deps), {
  mode: "forge",
  endpoint: "forge-download",
});
