/**
 * The lane's resume (walk 2026-10-24, bug 9). The Valjean shape: a base resume
 * with a finished version, and a newer tailored copy with no version at all.
 * Fictional ids.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pickLaneResume } from "../lane-resume-pick";
import { resolveSelectedWork, type WorkContextStore } from "../assistant-work-context";
import { workspaceNextAction } from "../workspace-next-action";

const U = "00000000-0000-4000-8000-0000000000aa";
const BASE = { id: "00000000-0000-4000-8000-0000000000b1", lane_id: null, artifact_type: "resume", is_demo: false, content: {} };
const TAILORED = { id: "00000000-0000-4000-8000-0000000000b2", lane_id: null, artifact_type: "resume", is_demo: false, content: {} };
const DRAFTED = { id: "00000000-0000-4000-8000-0000000000b3", lane_id: null, artifact_type: "resume", is_demo: false, content: {} };

test("the newest resume with a finished version wins over a newer copy with none", () => {
  assert.equal(pickLaneResume([TAILORED, BASE], new Map([[BASE.id, "finished"]])), BASE);
});
test("then the newest with any version, then the newest", () => {
  assert.equal(pickLaneResume([TAILORED, DRAFTED, BASE], new Map([[DRAFTED.id, "draft"], [BASE.id, "draft"]])), DRAFTED);
  assert.equal(pickLaneResume([TAILORED, BASE], new Map()), TAILORED);
  assert.equal(pickLaneResume([], new Map()), null);
});
test("among finished ones the listing order holds (pinned first, then newest edit)", () => {
  assert.equal(pickLaneResume([DRAFTED, TAILORED, BASE], new Map([[TAILORED.id, "finished"], [BASE.id, "finished"]])), TAILORED);
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
  // The real store's laneResume runs pickLaneResume over the lane's listing.
  const picked = pickLaneResume([TAILORED, BASE], new Map([[BASE.id, "finished"]]));
  const work = await resolveSelectedWork(U, {}, store(picked, { [BASE.id]: rev(BASE.id, "finished") }));
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
  assert.match(ctx, /laneResume: async[\s\S]*?pickLaneResume\(items, /);
  assert.doesNotMatch(ctx, /laneId: laneId \?\? "main", limit: 1 \}\)\)\.items\[0\]/);
  const home = readFileSync(join(__dirname, "..", "..", "components", "lanes", "LaneHome.tsx"), "utf8");
  assert.match(home, /work\?\.selection\?\.artifactId \? \([\s\S]*?data-testid="lane-home-review"/);
});
