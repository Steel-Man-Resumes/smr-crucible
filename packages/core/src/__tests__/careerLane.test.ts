/**
 * Career lanes (073): the pure rules every route and screen shares, and the
 * shape of the SQL the database half sends. The policies themselves are
 * proven against a scratch Postgres in the lane's database check; these keep
 * the rules from drifting.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  resolveLaneSettings,
  laneNameFromTarget,
  cleanLaneName,
  hybridAllowed,
  laneKey,
  isLaneKey,
  isLaneTool,
  looksLikeExampleResume,
  isFictionalPhone,
  isFictionalEmail,
  MAIN_LANE_KEY,
  LANE_FORMATS,
} from "../careerLaneShared";
import {
  LANE_LIST_SQL,
  LANE_ENSURE_FIRST_SQL,
  ARTIFACT_SET_LANE_SQL,
  LANE_ARCHIVE_SQL,
} from "../careerLane";
import { RLS_PROTECTED_TABLES } from "../rlsHealth";

const MIGRATIONS = join(__dirname, "..", "..", "migrations");

describe("lane settings", () => {
  it("a new lane needs a name; defaults are dated format, length by history", () => {
    assert.deepEqual(resolveLaneSettings({}, null), { ok: false, error: "name_required" });
    const r = resolveLaneSettings({ name: "Warehouse" }, null);
    assert.ok(r.ok);
    assert.equal(r.value.format, "chronological");
    assert.equal(r.value.length_pref, "auto");
    assert.equal(r.value.target_role, null);
  });

  it("names are trimmed, spaces collapsed, control characters dropped, capped at 60", () => {
    assert.equal(cleanLaneName("  Line\tcook \n "), "Line cook");
    assert.equal(cleanLaneName("x".repeat(80))!.length, 60);
    assert.equal(cleanLaneName("   "), null);
    assert.equal(cleanLaneName(42), null);
  });

  it("hybrid needs BOTH conditions: uneven history AND a skill-driven change of field", () => {
    assert.equal(hybridAllowed(true, true), true);
    assert.equal(hybridAllowed(true, false), false);
    assert.equal(hybridAllowed(false, true), false);
    assert.deepEqual(resolveLaneSettings({ name: "Office", format: "hybrid" }, null), { ok: false, error: "hybrid_needs_both" });
    assert.deepEqual(
      resolveLaneSettings({ name: "Office", format: "hybrid", hybridUnevenHistory: true }, null),
      { ok: false, error: "hybrid_needs_both" }
    );
    const ok = resolveLaneSettings({ name: "Office", format: "hybrid", hybridUnevenHistory: true, hybridFieldChange: true }, null);
    assert.ok(ok.ok && ok.value.format === "hybrid");
  });

  it("a condition cannot be switched off under a hybrid lane; the person picks dated first", () => {
    const cur = { name: "Office", target_role: null, format: "hybrid" as const, hybrid_uneven_history: true, hybrid_field_change: true, length_pref: "auto" as const };
    assert.deepEqual(resolveLaneSettings({ hybridFieldChange: false }, cur), { ok: false, error: "hybrid_needs_both" });
    const r = resolveLaneSettings({ format: "chronological", hybridFieldChange: false }, cur);
    assert.ok(r.ok && r.value.format === "chronological" && !r.value.hybrid_field_change);
  });

  it("functional is never a format; unknown values are refused, not guessed", () => {
    assert.deepEqual([...LANE_FORMATS], ["chronological", "hybrid"]);
    assert.deepEqual(resolveLaneSettings({ name: "x", format: "functional" }, null), { ok: false, error: "bad_format" });
    assert.deepEqual(resolveLaneSettings({ name: "x", lengthPref: "three_pages" }, null), { ok: false, error: "bad_length" });
  });

  it("an update keeps what was not sent", () => {
    const cur = { name: "Kitchen", target_role: "Line cook", format: "chronological" as const, hybrid_uneven_history: false, hybrid_field_change: false, length_pref: "one_page" as const };
    const r = resolveLaneSettings({ name: "Kitchen work" }, cur);
    assert.ok(r.ok);
    assert.equal(r.value.target_role, "Line cook");
    assert.equal(r.value.length_pref, "one_page");
  });
});

describe("first lane from the Forge target", () => {
  it("named from the target, in the person's words", () => {
    assert.equal(laneNameFromTarget("Warehouse"), "Warehouse");
    assert.equal(laneNameFromTarget("  Warehouse   Associate "), "Warehouse Associate");
  });
  it("no target, or the old 'General' label, makes no lane (work stays in main)", () => {
    assert.equal(laneNameFromTarget(""), null);
    assert.equal(laneNameFromTarget(undefined), null);
    assert.equal(laneNameFromTarget("General"), null);
  });
  it("a long target is cut at a word, never mid-word", () => {
    const n = laneNameFromTarget("Certified Nursing Assistant in a long term care facility near home")!;
    assert.ok(n.length <= 40, n);
    assert.ok("Certified Nursing Assistant in a long term care facility near home".startsWith(n));
    assert.ok(!/\s$/.test(n));
  });
  it("the first-lane SQL only inserts when the person has never had a lane", () => {
    assert.match(LANE_ENSURE_FIRST_SQL, /WHERE NOT EXISTS \(SELECT 1 FROM career_lane WHERE user_id = \$1\)/);
    assert.match(LANE_ENSURE_FIRST_SQL, /ON CONFLICT DO NOTHING/);
  });
});

describe("lane keys and tools", () => {
  it("null lane is main; a lane id is its own key", () => {
    assert.equal(laneKey(null), MAIN_LANE_KEY);
    assert.equal(laneKey("not-a-uuid"), MAIN_LANE_KEY);
    assert.equal(laneKey("0000000A-0000-4000-8000-000000000001"), "0000000a-0000-4000-8000-000000000001");
    assert.equal(isLaneKey("main"), true);
    assert.equal(isLaneKey("drop table"), false);
    assert.equal(isLaneTool("tailor"), true);
    assert.equal(isLaneTool("jobs"), false);
  });
});

describe("examples (074 mirror)", () => {
  it("reserved fictional numbers 555-0100 to 555-0199 only", () => {
    assert.equal(isFictionalPhone("(414) 555-0192"), true);
    assert.equal(isFictionalPhone("+1 262 555 0147"), true);
    assert.equal(isFictionalPhone("414-555-0200"), false);
    assert.equal(isFictionalPhone("414-555-1234"), false);
    assert.equal(isFictionalPhone(""), false);
  });
  it("reserved example domains only", () => {
    assert.equal(isFictionalEmail("morgan@example.com"), true);
    assert.equal(isFictionalEmail("x@mail.test"), true);
    assert.equal(isFictionalEmail("x@examples.com"), false);
    assert.equal(isFictionalEmail("x@gmail.com"), false);
  });
  it("a resume with no contact block is never an example", () => {
    assert.equal(looksLikeExampleResume({ experience: [] }), false);
    assert.equal(looksLikeExampleResume(null), false);
    assert.equal(looksLikeExampleResume({ contact: { phone: "608-555-0110" } }), true);
  });
  it("074 marks and never deletes, and refuses a role that RLS would blind", () => {
    const sql = readFileSync(join(MIGRATIONS, "074_mark_demo_resumes.sql"), "utf8");
    const code = sql.replace(/--.*$/gm, "");
    assert.doesNotMatch(code, /\bDELETE\b/i);
    assert.match(code, /UPDATE refinery_artifact\s+SET is_demo = true/);
    assert.match(code, /rolbypassrls OR rolsuper/);
  });
});

describe("073 schema", () => {
  const sql = readFileSync(join(MIGRATIONS, "073_career_lanes.sql"), "utf8");
  it("both new tables are owner-only, forced, and listed as protected", () => {
    assert.match(sql, /ARRAY\['career_lane', 'lane_tool_intro'\]/);
    assert.match(sql, /FORCE ROW LEVEL SECURITY/);
    assert.ok((RLS_PROTECTED_TABLES as readonly string[]).includes("career_lane"));
    assert.ok((RLS_PROTECTED_TABLES as readonly string[]).includes("lane_tool_intro"));
  });
  it("a resume can only sit in its own owner's lane (composite key)", () => {
    assert.match(sql, /FOREIGN KEY \(lane_id, user_id\) REFERENCES career_lane \(id, user_id\)/);
  });
  it("hybrid rule and the format list are in the database too", () => {
    assert.match(sql, /CHECK \(format <> 'hybrid' OR \(hybrid_uneven_history AND hybrid_field_change\)\)/);
    assert.match(sql, /CHECK \(format IN \('chronological', 'hybrid'\)\)/);
  });
  it("lanes are archived by the app, not deleted; archived lanes take no new work", () => {
    assert.doesNotMatch(LANE_ARCHIVE_SQL, /DELETE/);
    assert.match(ARTIFACT_SET_LANE_SQL, /archived_at IS NULL/);
    assert.match(LANE_LIST_SQL, /archived_at IS NULL/);
  });
});
