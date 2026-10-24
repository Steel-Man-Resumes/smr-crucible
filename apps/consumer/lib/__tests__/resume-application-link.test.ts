/**
 * A tailored resume from a saved job links both ways, even when its first save
 * went out unlinked (walk 2026-10-24, bug 11: the Snap On case). Fictional ids.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { jobPackageApplicationId, linkResumeOnUpdate, LINK_APPLICATION_SQL, LINK_ARTIFACT_CONTEXT_SQL } from "../resume-application-link";

const U = "00000000-0000-4000-8000-0000000000aa";
const ART = "00000000-0000-4000-8000-0000000000b1";
const APP = "00000000-0000-4000-8000-0000000000a1";
const content = { formatVersion: 3, meta: { targetJob: "Picker" }, jobPackage: { applicationId: APP, coverLetterText: "" } };

function fake(linkedRows: unknown[]) {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const snaps: unknown[] = []; const inval: string[] = [];
  return {
    calls, snaps, inval,
    deps: {
      query: async (_u: string, sql: string, params: unknown[]) => { calls.push({ sql, params }); return sql === LINK_APPLICATION_SQL ? linkedRows : []; },
      snapshot: async (o: unknown) => { snaps.push(o); },
      invalidate: async (u: string) => { inval.push(u); },
    },
  };
}

test("reads the application id a workspace save names", () => {
  assert.equal(jobPackageApplicationId(content), APP);
  assert.equal(jobPackageApplicationId({ jobPackage: { applicationId: "not-a-uuid" } }), null);
  assert.equal(jobPackageApplicationId({ jobPackage: null }), null);
  assert.equal(jobPackageApplicationId({}), null);
  assert.equal(jobPackageApplicationId(null), null);
});

test("a resume save naming its job fills the missing link both ways, then snapshots and invalidates", async () => {
  const f = fake([{ id: APP }]);
  assert.equal(await linkResumeOnUpdate(U, ART, "resume", content, f.deps), true);
  assert.deepEqual(f.calls.map((c) => c.sql), [LINK_APPLICATION_SQL, LINK_ARTIFACT_CONTEXT_SQL]);
  assert.deepEqual(f.calls[0].params, [ART, APP, U]);
  assert.deepEqual(f.calls[1].params, [ART, APP, U]);
  assert.equal(f.snaps.length, 1); assert.deepEqual(f.inval, [U]);
});

test("an application already linked is never replaced and gets no new snapshot", async () => {
  const f = fake([]);
  assert.equal(await linkResumeOnUpdate(U, ART, "resume", content, f.deps), false);
  assert.equal(f.snaps.length, 0); assert.equal(f.inval.length, 0);
});

test("non-resumes and saves with no job do nothing", async () => {
  for (const [type, c] of [["cover_letter", content], ["resume", { formatVersion: 3 }], ["resume", { jobPackage: { applicationId: "x" } }]] as const) {
    const f = fake([{ id: APP }]);
    assert.equal(await linkResumeOnUpdate(U, ART, type, c, f.deps), false);
    assert.equal(f.calls.length, 0);
  }
});

test("a link failure never fails the save", async () => {
  const deps = { query: async () => { throw new Error("db down"); } };
  assert.equal(await linkResumeOnUpdate(U, ART, "resume", content, deps), false);
});

test("the SQL only fills gaps and checks ownership", () => {
  assert.match(LINK_APPLICATION_SQL, /resume_artifact_id IS NULL/);
  assert.match(LINK_APPLICATION_SQL, /user_id = \$3/);
  assert.match(LINK_APPLICATION_SQL, /a\.id = \$1 AND a\.user_id = \$3/);
  assert.match(LINK_ARTIFACT_CONTEXT_SQL, /COALESCE\(target_context->>'applicationId', ''\) = ''/);
  assert.match(LINK_ARTIFACT_CONTEXT_SQL, /j\.resume_artifact_id = \$1/);
});

test("PATCH /api/artifacts/[id] runs the link after a successful update", () => {
  const src = readFileSync(join(__dirname, "..", "..", "app", "api", "artifacts", "[id]", "route.ts"), "utf8");
  const conflict = src.indexOf('result.status === "conflict"');
  const link = src.indexOf("await linkResumeOnUpdate(");
  assert.ok(conflict > 0 && link > conflict, "linked only after every refusal is handled");
  assert.match(src, /provenance: "tailored"/);
});
