/**
 * Forge-to-account sync: an empty or missing incoming value must never erase
 * what the account already holds, and a real new value must still update it.
 *
 * No database runs in this suite. The parameter builder is tested directly, and
 * the SQL text is checked for the properties that carry the rule (merge for the
 * object columns, NULLIF/COALESCE for the arrays). That is a pattern check, not
 * an execution of the SQL.
 *
 * Exception by the person's choice: record-related answers (criminalRecord,
 * challenges, challengeNarratives, goals). An explicit empty clears the saved
 * value; an absent one keeps it.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { dropAbsent, dropEmpty, profileUpsertParams, PROFILE_UPSERT_SQL } from "../forgeSession";

// Positions of the parameters in PROFILE_UPSERT_SQL.
const PROFILE = 2, NARRATIVE = 3, PREFS = 4, SKILLS = 5, PATHS = 6;
const parse = (v: unknown) => JSON.parse(v as string);

test("dropEmpty removes undefined, null, blanks, empty arrays and empty objects, keeps real values", () => {
  assert.deepEqual(
    dropEmpty({ a: undefined, b: null, c: "  ", d: [], e: {}, f: "x", g: [1], h: { k: 1 }, i: 0, j: false }),
    { f: "x", g: [1], h: { k: 1 }, i: 0, j: false }
  );
  assert.deepEqual(dropEmpty(undefined), {});
});

test("empty sync = kept for text, preferences, skills and career paths", () => {
  const p = profileUpsertParams("u1", {
    resumeText: "",
    preferences: { schedule: "", environment: "", commute: "", location: "" },
    goalNarrative: "",
    forgeOutput: undefined,
  });
  assert.deepEqual(parse(p[PROFILE]), {});
  assert.deepEqual(parse(p[NARRATIVE]), {});
  assert.deepEqual(parse(p[PREFS]), {});
  assert.deepEqual(parse(p[SKILLS]), []);
  assert.deepEqual(parse(p[PATHS]), []);
  assert.equal(p[1], null);
  assert.equal(p[7], null);
  // a forge output whose narrative is null must not write {"narrative": null}
  const q = profileUpsertParams("u1", { forgeOutput: { narrative: null, skills: [], career_paths: [] } });
  assert.deepEqual(parse(q[NARRATIVE]), {});
});

test("record-related answers: ABSENT keys are kept (nothing is sent for them)", () => {
  // The Mini Forge import and any sync that never asked sends these as undefined or null.
  const p = profileUpsertParams("u1", {
    challenges: undefined,
    criminalRecord: undefined,
    challengeNarratives: undefined,
    goals: undefined,
  });
  assert.deepEqual(parse(p[PROFILE]), {});
  assert.deepEqual(parse(p[NARRATIVE]), {});
  const n = profileUpsertParams("u1", {
    challenges: null as unknown as string[],
    criminalRecord: null as unknown as Record<string, unknown>,
    goals: null as unknown as string[],
  });
  assert.deepEqual(parse(n[PROFILE]), {});
  assert.deepEqual(parse(n[NARRATIVE]), {});
});

test("record-related answers: an EXPLICIT empty clears the saved value", () => {
  const p = profileUpsertParams("u1", {
    challenges: [],
    criminalRecord: {},
    challengeNarratives: {},
    goals: [],
  });
  assert.deepEqual(parse(p[PROFILE]), { challenges: [], criminalRecord: {}, challengeNarratives: {} });
  assert.deepEqual(parse(p[NARRATIVE]), { goals: [] });
  // and the merge writes those keys over the saved ones
  assert.match(PROFILE_UPSERT_SQL, /profile_data = COALESCE\(consumer_profile\.profile_data, '\{\}'::jsonb\) \|\| EXCLUDED\.profile_data/);
});

test("dropAbsent keeps explicit empties and drops only undefined and null", () => {
  assert.deepEqual(dropAbsent({ a: undefined, b: null, c: [], d: "", e: {}, f: 0 }), { c: [], d: "", e: {}, f: 0 });
});

test("existing data + new values = updated: real values are sent through", () => {
  const p = profileUpsertParams("u1", {
    readinessStage: "action",
    resumeText: "Jane\nForklift",
    preferences: { schedule: "full-time", location: "Madison, WI", environment: "" },
    goals: ["stable"],
    forgeOutput: { narrative: "story", skills: [{ name: "forklift" }], career_paths: [{ t: 1 }] },
  });
  assert.equal(p[1], "action");
  assert.deepEqual(parse(p[PROFILE]), { resumeText: "Jane\nForklift" });
  assert.deepEqual(parse(p[NARRATIVE]), { goals: ["stable"], narrative: "story" });
  assert.deepEqual(parse(p[PREFS]), { schedule: "full-time", location: "Madison, WI" });
  assert.deepEqual(parse(p[SKILLS]), [{ name: "forklift" }]);
  assert.deepEqual(parse(p[PATHS]), [{ t: 1 }]);
});

test("no existing row = inserted: parameters line up with the INSERT and the user id is first", () => {
  const p = profileUpsertParams("u-9", { preferences: { schedule: "part-time" } });
  assert.equal(p.length, 8);
  assert.equal(p[0], "u-9");
  assert.match(PROFILE_UPSERT_SQL, /VALUES \(\$1, \$2, \$3, \$4, \$5, \$6, \$7, \$8\)/);
  assert.match(PROFILE_UPSERT_SQL, /ON CONFLICT \(user_id\) DO UPDATE/);
});

test("the SQL never replaces a column with an incoming value that could be empty", () => {
  for (const col of ["profile_data", "narrative_data", "preferences"]) {
    assert.match(
      PROFILE_UPSERT_SQL,
      new RegExp(`${col} = COALESCE\\(consumer_profile\\.${col}, '\\{\\}'::jsonb\\) \\|\\| EXCLUDED\\.${col}`)
    );
  }
  for (const col of ["skills", "career_paths"]) {
    assert.match(
      PROFILE_UPSERT_SQL,
      new RegExp(`${col} = COALESCE\\(NULLIF\\(EXCLUDED\\.${col}, '\\[\\]'::jsonb\\), consumer_profile\\.${col}\\)`)
    );
  }
  assert.doesNotMatch(PROFILE_UPSERT_SQL, /(narrative_data|preferences|skills|career_paths) = EXCLUDED\./);
  // values travel as parameters, never spliced into the text
  assert.doesNotMatch(PROFILE_UPSERT_SQL, /\$\{/);
});
