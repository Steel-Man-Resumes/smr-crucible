/**
 * Today's task (migration 083, Phase 5 lane R2): the pure parts and the
 * migration's shape. The PGlite e2e (outside the repo, own port) applies the
 * real migration and runs the routes as the app role. Invented data only.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { readLaneFocusInput, cleanFocusTarget, isLaneTask, LANE_TASKS, MAIN_TASKS, OTHER_TASKS } from "../laneFocusShared";
import { LANE_FOCUS_UPSERT_SQL, LANE_FOCUS_GET_SQL, laneFocusTableMissing } from "../laneFocus";
import { RLS_PROTECTED_TABLES } from "../rlsHealth";

const MIG = readFileSync(join(import.meta.dirname, "..", "..", "migrations", "083_lane_focus.sql"), "utf8");
const LANE = "00000000-0000-4000-8000-0000000000aa";

test("three main routes, three quieter ones, nothing else", () => {
  assert.deepEqual([...MAIN_TASKS], ["resume", "job", "interview"]);
  assert.deepEqual([...OTHER_TASKS], ["documents", "explore", "support"]);
  assert.deepEqual([...LANE_TASKS].sort(), [...MAIN_TASKS, ...OTHER_TASKS].sort());
  assert.equal(isLaneTask("rush"), false, "Rush is a branch of the job route, not its own entrance");
  assert.equal(isLaneTask("story"), false);
});

test("the migration's task list matches the code's, exactly", () => {
  const m = MIG.match(/task IN \(([^)]+)\)/);
  assert.ok(m, "task CHECK present");
  const inSql = m![1].split(",").map((x) => x.trim().replace(/'/g, ""));
  assert.deepEqual(inSql, [...LANE_TASKS]);
});

test("request reading: task required, lane is a uuid or main, target cleaned", () => {
  assert.deepEqual(readLaneFocusInput({ task: "job", target: "  forklift   driver " }), {
    ok: true,
    focus: { task: "job", laneId: null, target: "forklift driver" },
  });
  assert.deepEqual(readLaneFocusInput({ task: "resume", laneId: LANE.toUpperCase() }), {
    ok: true,
    focus: { task: "resume", laneId: LANE, target: null },
  });
  assert.equal(readLaneFocusInput({ task: "resume", laneId: "main" }).ok, true);
  assert.equal(readLaneFocusInput({ task: "rush" }).ok, false);
  assert.equal(readLaneFocusInput({ task: "job", laneId: "'; drop table x" }).ok, false);
  assert.equal(readLaneFocusInput({ task: "job", target: 7 }).ok, false);
  assert.equal(readLaneFocusInput(null).ok, false);
  assert.equal(readLaneFocusInput([]).ok, false);
  assert.equal(cleanFocusTarget("   "), null);
  assert.equal(cleanFocusTarget("x".repeat(300))!.length, 200);
});

test("owner only: RLS forced, four owner policies, composite lane key, protected list", () => {
  assert.match(MIG, /FORCE ROW LEVEL SECURITY/);
  for (const cmd of ["SELECT", "INSERT", "UPDATE", "DELETE"]) {
    assert.match(MIG, new RegExp(`FOR ${cmd} (USING|WITH CHECK) \\(user_id = NULLIF\\(current_setting\\('app.user_id', true\\), ''\\)::uuid\\)`));
  }
  assert.match(MIG, /FOREIGN KEY \(lane_id, user_id\) REFERENCES career_lane \(id, user_id\)/);
  assert.match(MIG, /user_id\s+UUID PRIMARY KEY/);
  assert.ok((RLS_PROTECTED_TABLES as readonly string[]).includes("lane_focus"));
});

test("add only and idempotent, with a written rollback", () => {
  assert.match(MIG, /CREATE TABLE IF NOT EXISTS lane_focus/);
  assert.match(MIG, /DROP POLICY IF EXISTS/);
  assert.doesNotMatch(MIG.replace(/^--.*$/gm, ""), /\b(DROP TABLE|DROP COLUMN|ALTER TABLE \w+ DROP|TRUNCATE|DELETE FROM)\b/i);
  assert.match(MIG, /ROLLBACK/);
  assert.match(MIG, /DROP TABLE IF EXISTS lane_focus;/);
});

test("the upsert keys on the caller and cannot move a row to someone else", () => {
  assert.match(LANE_FOCUS_UPSERT_SQL, /ON CONFLICT \(user_id\) DO UPDATE/);
  assert.match(LANE_FOCUS_UPSERT_SQL, /WHERE lane_focus\.user_id = \$1/);
  const setClause = LANE_FOCUS_UPSERT_SQL.split("DO UPDATE SET")[1].split("WHERE")[0];
  assert.doesNotMatch(setClause, /(^|[\s,])user_id\s*=/, "the update never sets user_id");
  assert.match(LANE_FOCUS_GET_SQL, /WHERE user_id = \$1/);
});

test("a missing table (083 not applied) reads as no task picked", () => {
  assert.equal(laneFocusTableMissing({ code: "42P01" }), true);
  assert.equal(laneFocusTableMissing({ message: 'relation "lane_focus" does not exist' }), true);
  assert.equal(laneFocusTableMissing({ code: "23503" }), false);
});
