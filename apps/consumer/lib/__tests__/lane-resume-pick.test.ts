/**
 * The lane's resume (walk 2026-10-24, bug 9). The Valjean shape: a base resume
 * with a finished version, and a newer tailored copy with no version at all.
 * Fictional ids.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { LANE_RESUME_PICK_SQL } from "@crucible/core/src/refineryArtifact";
import { resolveSelectedWork, type WorkContextStore } from "../assistant-work-context";
import { workspaceNextAction } from "../workspace-next-action";

const U = "00000000-0000-4000-8000-0000000000aa";
const BASE = { id: "00000000-0000-4000-8000-0000000000b1", lane_id: null, artifact_type: "resume", is_demo: false, content: {} };
const TAILORED = { id: "00000000-0000-4000-8000-0000000000b2", lane_id: null, artifact_type: "resume", is_demo: false, content: {} };
const DRAFTED = { id: "00000000-0000-4000-8000-0000000000b3", lane_id: null, artifact_type: "resume", is_demo: false, content: {} };

test("the pick ranks finished, then any version, then none; pinned then newest within a tier; no examples", () => {
  assert.match(LANE_RESUME_PICK_SQL, /ORDER BY CASE WHEN lr\.status = 'finished' THEN 0 WHEN lr\.status IS NOT NULL THEN 1 ELSE 2 END,\s+a\.is_current DESC, a\.updated_at DESC, a\.id ASC\s+LIMIT 1/);
  assert.match(LANE_RESUME_PICK_SQL, /a\.is_demo = false/);
  assert.match(LANE_RESUME_PICK_SQL, /^SELECT a\.id\b/, "id only; the caller loads one row");
  assert.match(LANE_RESUME_PICK_SQL, /ORDER BY r\.revision_number DESC LIMIT 1/, "the latest version decides the tier");
});

const rev = (artifactId: string, status: "draft" | "finished") => ({ id: "00000000-0000-4000-8000-0000000000c1", artifact_id: artifactId, revision_number: 2, status, resume_text: "Text", open_items: [], created_at: "2026-10-22T23:20:00.000Z", source: "forge_finish" } as any);
function store(pick: typeof BASE | null, revisions: Record<string, ReturnType<typeof rev>>): WorkContextStore {
  return {
    focus: async () => ({ task: "resume", laneId: null, target: null }),
    lane: async () => null, application: async () => null, artifact: async () => null, revision: async () => null,
    laneResume: async () => pick,
    latest: async (_u, id) => revisions[id] ?? null,
  };
}

test("Valjean shape: the coach, lane home and progression all see the finished base resume", async () => {
  // The real store's laneResume returns the SQL pick, which is BASE here (proven in pglite).
  const work = await resolveSelectedWork(U, {}, store(BASE, { [BASE.id]: rev(BASE.id, "finished") }));
  assert.equal(work.selection.artifactId, BASE.id);
  assert.equal(work.revision?.artifactId, BASE.id, "its version is read, not the empty copy's");
  const next = workspaceNextAction({ work: work as any, task: "resume" });
  assert.notEqual(next?.label, "Start your resume");
});

test("a lane whose only resume has no version says Review this resume, never Start your resume", async () => {
  const work = await resolveSelectedWork(U, {}, store(TAILORED, {}));
  assert.equal(work.revision, null);
  assert.equal(work.selection.artifactId, TAILORED.id);
  assert.deepEqual(workspaceNextAction({ work: work as any, task: "resume" }), { label: "Review this resume", href: `/dashboard/application-tailor?id=${TAILORED.id}` });
  // A truly empty lane still starts one.
  const empty = await resolveSelectedWork(U, {}, store(null, {}));
  assert.deepEqual(workspaceNextAction({ work: empty as any, task: "resume" }), { label: "Start your resume", href: "/resume" });
});

test("the real store uses the one pick, and the lane home shows a version-less resume", () => {
  const ctx = readFileSync(join(__dirname, "..", "assistant-work-context.ts"), "utf8");
  assert.match(ctx, /laneResume: \(uid, laneId\) => c\.getLaneResume\(uid, laneId \?\? null\)/);
  assert.doesNotMatch(ctx, /laneId: laneId \?\? "main", limit: 1 \}\)\)\.items\[0\]/);
  const home = readFileSync(join(__dirname, "..", "..", "components", "lanes", "LaneHome.tsx"), "utf8");
  assert.match(home, /work\?\.selection\?\.artifactId \? \([\s\S]*?data-testid="lane-home-review"/);
});
