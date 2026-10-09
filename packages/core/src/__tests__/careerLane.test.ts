/**
 * Career lanes (074): the pure rules every route and screen shares, and the
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
  looksLikeExampleLetterText,
  isFictionalPhone,
  MAX_OPEN_LANES,
  MAX_TOTAL_LANES,
  isFictionalEmail,
  MAIN_LANE_KEY,
  LANE_FORMATS,
} from "../careerLaneShared";
import {
  LANE_LIST_SQL,
  LANE_ENSURE_FIRST_SQL,
  ARTIFACT_SET_LANE_SQL,
  LANE_ARCHIVE_SQL,
  LANE_OF_NEWEST_RESUME_SQL,
} from "../careerLane";
import { ARTIFACT_FORK_SQL } from "../refineryArtifact";
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
  it("two tabs cannot make two first lanes, even with different targets (is_first marker, unique per person)", () => {
    assert.match(LANE_ENSURE_FIRST_SQL, /is_first\)\s+SELECT \$1, \$2, \$3, true/);
    const sql = readFileSync(join(MIGRATIONS, "074_career_lanes.sql"), "utf8");
    assert.match(sql, /CREATE UNIQUE INDEX IF NOT EXISTS career_lane_one_first_uniq\s+ON career_lane \(user_id\) WHERE is_first/);
  });
  it("a screen opens in the open lane holding the newest resume, examples left out", () => {
    assert.match(LANE_OF_NEWEST_RESUME_SQL, /l\.archived_at IS NULL/);
    assert.match(LANE_OF_NEWEST_RESUME_SQL, /is_demo = false/);
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

describe("examples (075 mirror)", () => {
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
  it("SQL and TypeScript agree on the edge shapes: padded email, phone stored as a number", () => {
    assert.equal(isFictionalEmail("  Morgan@Example.com  "), true);
    assert.equal(isFictionalPhone(4145550192), true);
    assert.equal(isFictionalPhone(4145551234), false);
    const sql = readFileSync(join(MIGRATIONS, "075_mark_demo_resumes.sql"), "utf8");
    assert.match(sql, /btrim\(lower\(COALESCE\(content->'contact'->>'email', ''\)\)\)/);
  });
  it("in a letter, the address must END at the reserved name; real domains that contain one are left", () => {
    for (const t of ["Write to pat@example.org.", "x@demo.example, thanks", "reach me: x@mail.test", "Call (262) 555-0147 any time."]) {
      assert.equal(looksLikeExampleLetterText(t), true, t);
    }
    for (const t of ["jane@hr.test.com", "jo@example.com.au", "x@mail.invalid.org", "Call 414-867-5309.", "ref 1555-01234"]) {
      assert.equal(looksLikeExampleLetterText(t), false, t);
    }
    const sql = readFileSync(join(MIGRATIONS, "075_mark_demo_resumes.sql"), "utf8");
    assert.match(sql, /\(\?!\[a-z0-9-\]\|\\\.\[a-z0-9\]\)/);
  });
  it("075 leaves demo accounts alone, in its own clause (sign-in email is itself a reserved address)", () => {
    const sql = readFileSync(join(MIGRATIONS, "075_mark_demo_resumes.sql"), "utf8");
    assert.match(sql, /DEMO ACCOUNTS ARE LEFT ALONE/);
    assert.match(sql, /AND NOT EXISTS \(\s+SELECT 1 FROM users u\s+WHERE u\.id = refinery_artifact\.user_id/);
    const dry = readFileSync(join(MIGRATIONS, "dry-run", "075_mark_demo_resumes_count.sql"), "utf8");
    assert.match(dry, /BEGIN TRANSACTION READ ONLY/);
    assert.match(dry, /count\(\*\)/);
    assert.doesNotMatch(dry.replace(/--.*$/gm, ""), /\b(UPDATE|DELETE|INSERT)\b/);
  });
  it("both migrations give up on a lock after 5 seconds rather than queue every request", () => {
    for (const f of ["074_career_lanes.sql", "075_mark_demo_resumes.sql"]) {
      assert.match(readFileSync(join(MIGRATIONS, f), "utf8"), /SET LOCAL lock_timeout = '5s';/, f);
    }
  });
  it("a resume with no contact block is never an example", () => {
    assert.equal(looksLikeExampleResume({ experience: [] }), false);
    assert.equal(looksLikeExampleResume(null), false);
    assert.equal(looksLikeExampleResume({ contact: { phone: "608-555-0110" } }), true);
  });
  it("075 marks and never deletes, and refuses a role that RLS would blind", () => {
    const sql = readFileSync(join(MIGRATIONS, "075_mark_demo_resumes.sql"), "utf8");
    const code = sql.replace(/--.*$/gm, "");
    assert.doesNotMatch(code, /\bDELETE\b/i);
    assert.match(code, /UPDATE refinery_artifact\s+SET is_demo = true/);
    assert.match(code, /rolbypassrls OR rolsuper/);
  });
});

describe("074 schema", () => {
  const sql = readFileSync(join(MIGRATIONS, "074_career_lanes.sql"), "utf8");
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
  it("a fork of work in an archived lane goes to the newest open lane, or main; main stays main", () => {
    assert.match(ARTIFACT_FORK_SQL, /WHEN src\.lane_id IS NULL THEN NULL/);
    assert.match(ARTIFACT_FORK_SQL, /l\.archived_at IS NULL\)\s+THEN src\.lane_id/);
    assert.match(ARTIFACT_FORK_SQL, /ORDER BY l\.created_at DESC LIMIT 1/);
  });
  it("caps: open lanes, and all lanes ever made, so create-and-archive cannot loop forever", () => {
    assert.ok(MAX_OPEN_LANES < MAX_TOTAL_LANES);
  });
  it("lanes are archived by the app, not deleted; archived lanes take no new work", () => {
    assert.doesNotMatch(LANE_ARCHIVE_SQL, /DELETE/);
    assert.match(ARTIFACT_SET_LANE_SQL, /archived_at IS NULL/);
    // Review s2 LOW 1: resume work never moves into a creative or CV lane (the 077 rollback stays clean).
    assert.match(ARTIFACT_SET_LANE_SQL, /COALESCE\(l\.kind, 'resume'\) = 'resume'/);
    assert.match(LANE_LIST_SQL, /archived_at IS NULL/);
  });
});
