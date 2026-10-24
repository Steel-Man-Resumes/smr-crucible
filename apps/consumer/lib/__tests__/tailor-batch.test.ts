/**
 * Multi-job tailoring (Troy 2026-10-23): pick up to three jobs, one action,
 * one resume and one AI action per job. These cases run the real coordinator
 * (lib/tailor-batch.ts) against the real server job runner
 * (lib/tailor-batch-server.ts) wired to an in-memory account. The generator
 * is a fake: no provider is ever called. Fictional jobs and person.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MAX_BATCH_JOBS, SELECTION_FULL_LINE, admitBatch, batchJobKey, batchSummary, clearTailorBatchStorage, createBatch, readBatch, runBatch, runnableIndexes, toggleSelection,
  BATCH_HANDOFF_KEY, BATCH_STORAGE_PREFIX, type BatchDeps, type BatchJob, type BatchState, type TailorResult,
} from "../tailor-batch";
import { generatorFailure, parseBatchJobRequest, remainingActions } from "../tailor-batch-server";
import { createTailorBatchRoute } from "../tailor-batch-route";
import { makeAccount, type AccountOptions } from "./tailor-batch-fakes";

const BATCH = "11111111-2222-4333-8444-555555555555";
const OWNER = "00000000-0000-4000-8000-0000000000a1";
const LONG = "Load and unload trucks. ".repeat(40);

function job(n: number, extra: Partial<BatchJob> = {}): BatchJob {
  return { selectKey: `job-${n}`, id: `job-${n}`, title: `Warehouse Associate ${n}`, company: `Example Co ${n}`, description: LONG, source: "jsearch", apply_url: `https://example.com/apply/${n}`, ...extra };
}

/** An in-memory account behind the REAL route handler (lib/tailor-batch-route.ts). */
function account(opts: AccountOptions = {}) {
  const acct = makeAccount(OWNER, opts);
  const route = createTailorBatchRoute({
    async session() { return { userId: OWNER, impersonating: false, realUserId: OWNER }; },
    sameOrigin: () => true,
    async laneKind() { return "ok"; },
    claims: () => acct.claims,
    async applicationStatus(_u, appId) { return acct.applications.find(a => a.id === appId)?.status ?? null; },
    inner: acct.inner,
    async allowance() { return { remaining: null, blockedReason: null, locked: false }; },
    now: () => acct.counters.clock,
  });
  return {
    ...acct, route,
    get actions() { return acct.counters.actions; },
    get generatorCalls() { return acct.counters.generatorCalls; },
  };
}

/** The client coordinator posting to the route, the way TailorBatchQueue does. */
function clientDeps(acct: ReturnType<typeof account>, extra: Partial<BatchDeps> = {}): BatchDeps & { updates: BatchState[] } {
  const updates: BatchState[] = [];
  return {
    updates,
    isCurrent: () => true,
    onUpdate: s => updates.push(s),
    async readPosting() { return null; },
    async tailor({ key, index, size, job: j, postingText, applicationId }) {
      const response = await acct.route.POST(new Request("https://app.example/api/tailor-batch", {
        method: "POST", headers: { "content-type": "application/json", "x-expected-account-id": OWNER },
        body: JSON.stringify({ batchId: key.split(":")[0], index, size, job: { ...j, description: postingText }, context: {}, laneId: null, applicationId: applicationId || j.existingApplicationId || null }),
      }));
      return (await response.json()) as TailorResult;
    },
    async confirm(artifactId) { return acct.artifacts.some(a => a.id === artifactId); },
    ...extra,
  };
}

const newBatch = (jobs: BatchJob[]) => createBatch(jobs, { batchId: BATCH, ownerUid: OWNER, laneId: null });

test("selection holds at most three; the fourth is refused, not dropped", () => {
  let sel: string[] = [];
  for (const k of ["a", "b", "c"]) sel = toggleSelection(sel, k).selected;
  const fourth = toggleSelection(sel, "d");
  assert.equal(fourth.refused, true);
  assert.deepEqual(fourth.selected, ["a", "b", "c"]);
  assert.deepEqual(toggleSelection(sel, "b").selected, ["a", "c"]);
  assert.match(SELECTION_FULL_LINE, /up to 3/);
  assert.equal(MAX_BATCH_JOBS, 3);
});

test("a batch is 1 to 3 jobs with stable per-job keys", () => {
  assert.throws(() => newBatch([]), /batch_empty/);
  assert.throws(() => newBatch([job(1), job(2), job(3), job(4)]), /batch_too_large/);
  assert.throws(() => newBatch([job(1), job(1)]), /batch_duplicate/);
  const b = newBatch([job(1), job(2)]);
  assert.deepEqual(b.jobs.map(j => j.key), [batchJobKey(BATCH, 0), batchJobKey(BATCH, 1)]);
  assert.equal(parseBatchJobRequest({ batchId: BATCH, index: 0, size: 4, job: { title: "a", company: "b", description: "" } }).ok, false);
  assert.equal(parseBatchJobRequest({ batchId: BATCH, index: 3, size: 3, job: { title: "a", company: "b", description: "" } }).ok, false);
  assert.equal(parseBatchJobRequest({ batchId: BATCH, index: 2, size: 3, job: { title: "a", company: "b", description: "" } }).ok, true);
});

test("allowance is checked for the whole batch up front, in plain words", () => {
  const all = admitBatch(3, 5);
  assert.equal(all.kind, "all");
  assert.equal(all.line, "3 jobs = 3 AI actions from your allowance. You have 5 left today.");
  const one = admitBatch(3, 1);
  assert.equal(one.kind, "some");
  assert.equal(one.runnable, 1);
  assert.match(one.line, /You have 1 left today, so one job can run now/);
  const none = admitBatch(2, 0);
  assert.equal(none.kind, "none");
  assert.match(none.line, /no AI actions left today/);
  assert.equal(admitBatch(2, null).kind, "all");
  assert.equal(admitBatch(2, 5, "Spending allowance is used.").kind, "none");
  assert.equal(remainingActions([null, 4, 2]), 2);
  assert.equal(remainingActions([null, undefined]), null);
  assert.equal(remainingActions([-1]), 0);
  for (const a of [all, one, none, admitBatch(2, null)]) assert.doesNotMatch(a.line, /—|--/);
});

test("a batch of two lands two application rows and two resumes, one AI action each", async () => {
  const acct = account();
  const final = await runBatch(newBatch([job(1), job(2)]), [0, 1], clientDeps(acct));
  assert.deepEqual(final.jobs.map(j => j.phase), ["saved", "saved"]);
  assert.equal(acct.applications.length, 2);
  const resumes = acct.artifacts.filter(a => a.type === "resume");
  assert.equal(resumes.length, 2);
  assert.equal(acct.artifacts.filter(a => a.type === "cover_letter").length, 2);
  assert.deepEqual(resumes.map(r => r.targetContext.batchKey), [batchJobKey(BATCH, 0), batchJobKey(BATCH, 1)]);
  // Each resume links to its own application.
  assert.deepEqual(resumes.map(r => r.targetContext.applicationId), acct.applications.map(a => a.id));
  assert.equal(acct.actions, 2);
  assert.equal(batchSummary(final).used, 2);
});

test("a forced failure on job 2 shows an error there and never touches job 1", async () => {
  const acct = account({ failTitles: new Set(["Warehouse Associate 2"]) });
  const deps = clientDeps(acct);
  const final = await runBatch(newBatch([job(1), job(2), job(3)]), [0, 1, 2], deps);
  assert.deepEqual(final.jobs.map(j => j.phase), ["saved", "failed", "saved"]);
  const failed = final.jobs[1];
  assert.equal(failed.code, "tailor_failed");
  assert.match(failed.error!, /used no AI action/);
  assert.equal(failed.actionUsed, false);
  const job1Artifact = final.jobs[0].artifactId;
  assert.equal(acct.claimRows.get(batchJobKey(BATCH, 1))?.status, "failed", "the failed key is released for a retry");
  // Job 1 was saved before job 2 failed and every later update leaves it as it was.
  const job1States = deps.updates.map(s => s.jobs[0]).filter(j => j.phase === "saved");
  assert.ok(job1States.every(j => j.artifactId === job1Artifact));
  assert.equal(acct.artifacts.filter(a => a.type === "resume").length, 2);
  assert.equal(acct.actions, 2);
});

test("retry is idempotent: saved jobs never re-run and a finished key is not charged twice", async () => {
  const failing = new Set(["Warehouse Associate 2"]);
  const acct = account({ failTitles: failing });
  const first = await runBatch(newBatch([job(1), job(2)]), [0, 1], clientDeps(acct));
  assert.deepEqual(first.jobs.map(j => j.phase), ["saved", "failed"]);
  assert.equal(acct.generatorCalls, 2);
  assert.equal(acct.actions, 1, "the failed generation was not counted");
  // Fix the cause, retry everything left: only job 2 reaches the generator.
  failing.clear();
  const second = await runBatch(first, runnableIndexes(first), clientDeps(acct));
  assert.deepEqual(second.jobs.map(j => j.phase), ["saved", "saved"]);
  assert.equal(acct.generatorCalls, 3);
  assert.equal(acct.actions, 2);
  assert.equal(second.jobs[0].artifactId, first.jobs[0].artifactId, "job 1 untouched");

  // Lost answer: the server finished the key, the browser never heard. Asking
  // again returns the saved resume, runs no generator and writes nothing.
  const lost = { ...second, jobs: second.jobs.map(j => ({ ...j, phase: "queued" as const })) };
  const before = acct.artifacts.length;
  const again = await runBatch(lost, [0, 1], clientDeps(acct));
  assert.deepEqual(again.jobs.map(j => j.phase), ["saved", "saved"]);
  assert.equal(acct.artifacts.length, before);
  assert.equal(acct.generatorCalls, 3);
  assert.equal(acct.actions, 2);
  assert.deepEqual(again.jobs.map(j => j.artifactId), second.jobs.map(j => j.artifactId));
});

test("a made-but-unsaved resume retries the save only, with no new AI action", async () => {
  const acct = account({ failSaveOnce: new Set(["Warehouse Associate 1"]) });
  const first = await runBatch(newBatch([job(1)]), [0], clientDeps(acct));
  assert.equal(first.jobs[0].phase, "failed");
  assert.equal(first.jobs[0].code, "save_failed");
  assert.equal(first.jobs[0].actionUsed, true);
  assert.equal(acct.actions, 1);
  // The finished result waits with the server-side claim, not in the browser state.
  assert.equal(acct.claimRows.get(batchJobKey(BATCH, 0))?.status, "generated");
  assert.doesNotMatch(JSON.stringify(first), /formatVersion/);
  const second = await runBatch(first, [0], clientDeps(acct));
  assert.equal(second.jobs[0].phase, "saved");
  assert.equal(acct.actions, 1, "the retry did not run the generator");
  assert.equal(acct.generatorCalls, 1);
  assert.equal(acct.applications.length, 1, "the retry reused the application row");
});

test("an allowance refusal stops the rest: not run, no action used", async () => {
  const acct = account({ allowance: 1 });
  const final = await runBatch(newBatch([job(1), job(2), job(3)]), [0, 1, 2], clientDeps(acct));
  assert.deepEqual(final.jobs.map(j => j.phase), ["saved", "failed", "skipped"]);
  assert.equal(final.jobs[1].code, "tool_allowance_used");
  assert.equal(final.jobs[2].actionUsed, false);
  assert.match(final.jobs[2].error!, /No AI action used/);
  assert.equal(acct.generatorCalls, 2, "job 3 never reached the generator");
});

test("a stale run writes nothing once a newer run owns the batch", async () => {
  const acct = account();
  let current = true;
  const deps = clientDeps(acct, {
    isCurrent: () => current,
    async confirm(id) { current = false; return acct.artifacts.some(a => a.id === id); },
  });
  const final = await runBatch(newBatch([job(1), job(2)]), [0, 1], deps);
  // The run lost ownership after job 1's save: no phase was written past that point.
  assert.equal(final.jobs[0].phase, "checking");
  assert.equal(final.jobs[1].phase, "queued");
  assert.equal(acct.artifacts.filter(a => a.type === "resume").length, 1);
});

test("the posting is read once per job, and only when the board text is thin", async () => {
  const acct = account();
  let reads = 0;
  const deps = clientDeps(acct, { async readPosting() { reads++; return { text: LONG + " Full posting.", source: "fetched" }; } });
  const thin = job(2, { description: "Short blurb." });
  const first = await runBatch(newBatch([job(1), thin]), [0, 1], { ...deps, async confirm() { return false; } });
  assert.equal(reads, 1, "only the thin posting was fetched");
  assert.equal(first.jobs[1].postingSource, "fetched");
  // Retry after a failed check reuses the stored posting, never a second read.
  await runBatch(first, [1], deps);
  assert.equal(reads, 1);
});

test("a picked saved job uses its own application row", async () => {
  const acct = account();
  acct.applications.push({ id: "00000000-0000-4000-8000-00000000aaaa", title: "Line Cook", company: "Corner Diner", source_id: "saved-1", status: "saved" });
  const appId = acct.applications[0].id;
  const final = await runBatch(newBatch([job(1, { selectKey: "saved-1", id: "saved-1", existingApplicationId: appId })]), [0], clientDeps(acct));
  assert.equal(final.jobs[0].phase, "saved");
  assert.equal(final.jobs[0].applicationId, appId);
  assert.equal(acct.applications.length, 1);
});

test("restoring a batch is owner-only and resets jobs a closed tab left in flight", () => {
  const b = newBatch([job(1), job(2)]);
  const mid = { ...b, jobs: [{ ...b.jobs[0], phase: "saved" as const, artifactId: "a" }, { ...b.jobs[1], phase: "tailoring" as const }] };
  assert.equal(readBatch(mid, "someone-else"), null);
  const back = readBatch(JSON.parse(JSON.stringify(mid)), OWNER)!;
  assert.deepEqual(back.jobs.map(j => j.phase), ["saved", "queued"]);
});

test("generator refusals map to per-job codes", () => {
  assert.equal(generatorFailure({ ok: false, status: 429, body: { error: "Come back tomorrow." } }).code, "allowance_used");
  assert.equal(generatorFailure({ ok: false, status: 429, body: { code: "tool_allowance_used", error: "x" } }).code, "tool_allowance_used");
  assert.equal(generatorFailure({ ok: false, status: 403, body: { code: "progression_locked", error: "x" } }).code, "progression_locked");
  assert.equal(generatorFailure({ ok: false, status: 500, body: {} }).code, "tailor_failed");
});

test("an application already past saved keeps its resume; the new one goes to the Library", async () => {
  const acct = account();
  acct.applications.push({ id: "00000000-0000-4000-8000-00000000bbbb", title: "Warehouse Associate 1", company: "Example Co 1", source_id: "job-1", status: "interviewing" });
  const final = await runBatch(newBatch([job(1)]), [0], clientDeps(acct));
  assert.equal(final.jobs[0].phase, "saved");
  assert.equal(final.jobs[0].linked, false);
  assert.equal(final.jobs[0].applicationStatus, "interviewing");
  const resume = acct.artifacts.find(a => a.type === "resume")!;
  assert.equal(resume.targetContext.applicationId, undefined, "no applicationId, so the artifacts route re-points nothing");
  const letter = acct.artifacts.find(a => a.type === "cover_letter")!;
  assert.equal(letter.targetContext.applicationId, undefined);
});

test("flagged lines travel with the saved resume and show in the queue state (DEC-46)", async () => {
  const acct = account({ flags: ["Ran a crew of 12"] });
  const final = await runBatch(newBatch([job(1)]), [0], clientDeps(acct));
  assert.deepEqual(final.jobs[0].truth?.flags, ["Ran a crew of 12"]);
  const resume = acct.artifacts.find(a => a.type === "resume")!;
  assert.deepEqual((resume.targetContext.batchTruth as { flags: string[] }).flags, ["Ran a crew of 12"]);
});

test("sign-out clears every batch key and the hand-offs; a new owner keeps only their own", () => {
  const data = new Map<string, string>([
    [BATCH_STORAGE_PREFIX + "a", JSON.stringify({ ownerUid: OWNER })],
    [BATCH_STORAGE_PREFIX + "b", JSON.stringify({ ownerUid: "someone-else" })],
    [BATCH_HANDOFF_KEY, "{}"], ["resume_target_job", "{}"], ["unrelated", "x"],
  ]);
  const storage = () => ({ get length() { return data.size; }, key: (i: number) => [...data.keys()][i] ?? null, getItem: (k: string) => data.get(k) ?? null, removeItem: (k: string) => { data.delete(k); } });
  clearTailorBatchStorage(storage(), OWNER);
  assert.deepEqual([...data.keys()].sort(), [BATCH_STORAGE_PREFIX + "a", BATCH_HANDOFF_KEY, "resume_target_job", "unrelated"].sort());
  clearTailorBatchStorage(storage());
  assert.deepEqual([...data.keys()], ["unrelated"]);
});

test("R1: only a fresh session read with nobody signed in counts as signed out", async () => {
  const { confirmedSignedOut } = await import("../tailor-batch");
  const reply = (status: number, body: unknown) => (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
  assert.equal(await confirmedSignedOut((async () => { throw new TypeError("offline"); }) as unknown as typeof fetch), false, "a failed read keeps the batch");
  assert.equal(await confirmedSignedOut(reply(503, {})), false, "a server error keeps the batch");
  assert.equal(await confirmedSignedOut(reply(200, { user: { id: OWNER } })), false, "still signed in keeps the batch");
  assert.equal(await confirmedSignedOut(reply(200, {})), true, "a confirmed sign-out clears it");
});
