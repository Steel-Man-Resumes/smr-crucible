import { beginAiOperation } from "./ai-operation-server";
import { withAiOperation } from "./ai-operation-context";
import { verifyGrounding } from "./grounding-verify";
import { verifyStory, readStoryDraft } from "./story-verification";
import { sendFinishedPackage, type AutoDeps } from "./email-package-auto";
import { packageFrom, resendKey, resendTransport } from "./email-package-send";
export async function packageDeliveryDeps(): Promise<AutoDeps> {
 const core = await import("@crucible/core");
 const { packageFiles } = await import("./email-package-files");
 const key = resendKey();
 return { target: core.getPackageEmailTarget, count: core.incrementIpUsage, claim: core.claimPackageEmailVersion,
  release: core.releasePackageEmailVersion, prepare: core.preparePackageEmail, complete: core.completePackageEmailVersion,
  story: async revision => {
   const draft = readStoryDraft(revision.evidence.storyDraft);
   const source = typeof revision.evidence.ownWords === "string" ? revision.evidence.ownWords : "";
   if (!draft || !source) return null;
   const operation = await beginAiOperation({userId:revision.user_id, endpoint:"forge-package-story"});
   if (operation.response) return null;
   return withAiOperation(operation.context, async () => {
    try {
     const checked = await verifyStory({ ...draft }, source, verifyGrounding);
     await operation.finish(checked.story_verification.checked ? "succeeded" : "failed");
     return checked.story_verification.checked ? checked : null;
    } catch (error) { await operation.finish("failed"); throw error; }
   });
  },
  getRevision: core.getRevision, getLatestRevision: core.getLatestRevision, files: packageFiles,
  transport: key ? resendTransport(key) : null, from: packageFrom() };
}
/** Existing maintenance tick; bounded work, no new schedule. */
export async function drainPackageDeliveries(): Promise<{ processed: number; retrying: number }> {
 const core = await import("@crucible/core");
 const jobs = await core.duePackageDeliveries();
 const deps = await packageDeliveryDeps();
 let processed = 0, retrying = 0;
 const deadline = Date.now() + 20_000;
 // Leave headroom for voice reconciliation in this shared 60-second route.
 for (const job of jobs.slice(0, 1)) {
  if (Date.now() > deadline) break;
  if (!(await core.claimPackageDelivery(job))) continue;
  try {
   const result = await sendFinishedPackage(job.user_id, { revisionId: job.revision_id }, deps);
   const retry = !result.sent && ["settling", "failed", "delivery_pending", "not_configured", "unproven", "limit", "already_today"].includes(result.reason);
   await core.finishPackageDelivery(job, retry, result.sent ? "accepted" : result.reason);
   processed++;
   if (retry) retrying++;
  } catch { await core.finishPackageDelivery(job, true, "failed"); retrying++; }
 }
 return { processed, retrying };
}
