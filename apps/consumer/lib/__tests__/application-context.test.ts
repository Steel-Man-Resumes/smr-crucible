import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveApplicationContext, type ApplicationContextStore } from "../application-context";
test("a foreign application stops before any posting or document reads", async () => {
 let reads = 0;
 const store: ApplicationContextStore = { application: async () => null, documents: async () => { reads++; return []; }, latestRevision: async () => { reads++; return null; } };
 assert.equal(await resolveApplicationContext("owner-a", "foreign-job", store), null);
 assert.equal(reads, 0);
});
test("job B uses its exact snapshot and linked resume, even when titles match job A", async () => {
 const calls: string[] = [];
 const application = { id: "job-b", company: "Warehouse", job_title: "Clerk", resume_artifact_id: "resume-b", jd_full_text: "B duties", jd_excerpt: null, jd_fetched_at: null, jd_truncated: false };
 const snapshot = { id: "snapshot-b", application_id: "job-b", user_id: "owner", artifact_id: "resume-b", document_type: "resume" as const, provenance: "tailored" as const, content_snapshot: { summary: "The saved words for B" }, content_hash: "hash-b", created_at: "2026-10-15" };
 const context = await resolveApplicationContext("owner", "job-b", {
  application: async (owner, id) => { calls.push(`${owner}:${id}`); return application; },
  documents: async (owner, id) => { calls.push(`${owner}:${id}`); return [snapshot]; },
  latestRevision: async (owner, id) => { calls.push(`${owner}:${id}`); return null; },
 });
 assert.equal(context?.application.jd_full_text, "B duties");
 assert.equal(context?.resumeSnapshot?.id, "snapshot-b");
 assert.deepEqual(calls, ["owner:job-b", "owner:job-b", "owner:resume-b"]);
});
