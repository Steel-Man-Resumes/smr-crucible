import { test } from "node:test";
import assert from "node:assert/strict";
import {
  STORED_SESSION_VERSION,
  HOURS_OPTIONS,
  SHIFT_OPTIONS,
  splitPref,
  togglePreference,
  readSchedule,
  readCommute,
  writeSchedule,
  writeCommute,
  writeEnvironment,
  migratePreferences,
  migrateStoredSession,
} from "../forge-preferences";

const HOURS = HOURS_OPTIONS.map((o) => o.id);
const SHIFTS = SHIFT_OPTIONS.map((o) => o.id);

test("splitPref reads the joined string, drops blanks and repeats, tolerates arrays and junk", () => {
  assert.deepEqual(splitPref("physical, office"), ["physical", "office"]);
  assert.deepEqual(splitPref(" a ,, b , a"), ["a", "b"]);
  assert.deepEqual(splitPref(["x", 3, "y"]), ["x", "y"]);
  assert.deepEqual(splitPref(undefined), []);
  assert.deepEqual(splitPref({}), []);
});

test("a group takes several picks, and tapping a pick again takes it back", () => {
  let sel: string[] = [];
  sel = togglePreference(sel, "days", SHIFTS);
  sel = togglePreference(sel, "weekends", SHIFTS);
  assert.deepEqual(sel, ["days", "weekends"]);
  sel = togglePreference(sel, "days", SHIFTS);
  assert.deepEqual(sel, ["weekends"]);
});

test("'Open to anything' stands alone: it clears the rest, and any other pick clears it", () => {
  const opts = { exclusive: ["any"] };
  let sel = togglePreference([], "full-time", HOURS, opts);
  sel = togglePreference(sel, "part-time", HOURS, opts);
  assert.deepEqual(sel, ["full-time", "part-time"]);
  sel = togglePreference(sel, "any", HOURS, opts);
  assert.deepEqual(sel, ["any"]);
  sel = togglePreference(sel, "flexible", HOURS, opts);
  assert.deepEqual(sel, ["flexible"]);
});

test("a single-choice group swaps rather than stacks", () => {
  let sel = togglePreference([], "within-15", ["within-15", "within-30"], { single: true });
  sel = togglePreference(sel, "within-30", ["within-15", "within-30"], { single: true });
  assert.deepEqual(sel, ["within-30"]);
});

test("toggling one group leaves ids from a neighbouring group alone", () => {
  const all = ["full-time", "evenings"];
  assert.deepEqual(togglePreference(all, "days", SHIFTS), ["full-time", "evenings", "days"]);
  assert.deepEqual(togglePreference(all, "part-time", HOURS, { exclusive: ["any"] }), [
    "evenings",
    "full-time",
    "part-time",
  ]);
});

test("schedule and commute answers read back into their two halves", () => {
  assert.deepEqual(readSchedule("full-time, nights, evenings"), {
    hours: ["full-time"],
    shifts: ["evenings"],
  });
  assert.deepEqual(readCommute("bus, walk, within-30"), { modes: ["bus", "walk"], distance: "within-30" });
  assert.deepEqual(readCommute(""), { modes: [], distance: null });
});

test("what is written is always in option order, so a saved run reads the same every time", () => {
  assert.equal(writeSchedule(["part-time", "full-time"], ["weekends", "days"]), "full-time, part-time, days, weekends");
  assert.equal(writeEnvironment(["remote", "physical"]), "physical, remote");
  assert.equal(writeCommute(["bus", "walk"], "within-45"), "walk, bus, within-45");
  assert.equal(writeCommute([], null), "");
  assert.equal(writeCommute(["bus"], "not-a-real-id"), "bus");
});

test("old commute ids become a way and a distance", () => {
  assert.equal(migratePreferences({ commute: "walk" }).commute, "walk, within-15");
  assert.equal(migratePreferences({ commute: "bus" }).commute, "bus");
  assert.equal(migratePreferences({ commute: "drive-short" }).commute, "drive, within-30");
  assert.equal(migratePreferences({ commute: "drive-long" }).commute, "drive, further");
  // the old demo spelling
  assert.equal(migratePreferences({ commute: "short-drive" }).commute, "drive, within-30");
});

test("several old commute picks keep every way and the farthest distance", () => {
  assert.equal(migratePreferences({ commute: "walk, drive-long" }).commute, "walk, drive, further");
  assert.equal(migratePreferences({ commute: "bus, drive-short" }).commute, "bus, drive, within-30");
});

test("the old 'working with people' pick becomes 'with the public'; the rest carry over", () => {
  assert.equal(migratePreferences({ environment: "people" }).environment, "public");
  assert.equal(
    migratePreferences({ environment: "physical, office, people, remote" }).environment,
    "physical, public, office, remote"
  );
});

test("schedule ids are unchanged and keep their picks", () => {
  assert.equal(migratePreferences({ schedule: "full-time, part-time" }).schedule, "full-time, part-time");
  assert.equal(migratePreferences({ schedule: "any" }).schedule, "any");
});

test("keys the page does not own, and unrelated values, pass through untouched", () => {
  const out = migratePreferences({
    location: "Milwaukee, WI",
    workType: "warehouse",
    commute: "drive-short",
  });
  assert.equal(out.location, "Milwaukee, WI");
  assert.equal(out.workType, "warehouse");
  assert.equal(out.commute, "drive, within-30");
  // a key that was never answered is not invented
  assert.equal("schedule" in out, false);
});

test("migrating twice changes nothing", () => {
  const once = migratePreferences({ environment: "people, outdoors", commute: "walk, drive-long", schedule: "part-time, evenings" });
  assert.deepEqual(migratePreferences(once), once);
});

test("bad input never throws and never invents answers", () => {
  assert.deepEqual(migratePreferences(null), {});
  assert.deepEqual(migratePreferences("text"), {});
  assert.deepEqual(migratePreferences([1, 2]), {});
  assert.deepEqual(migratePreferences({ commute: 5, location: 7 }), {});
});

test("a run saved before versioning is migrated and stamped, and nothing else in it moves", () => {
  const saved = {
    _savedAt: 1700000000000,
    readinessStage: "action",
    resumeText: "Jane Doe\nForklift operator",
    goals: ["stable"],
    pagesVisited: ["welcome", "resume", "goals", "story", "preferences"],
    preferences: { schedule: "full-time", environment: "people", commute: "drive-short", location: "Madison, WI" },
    carriedIn: { code: "ABC", skills: ["x"], jobs: [] },
    _ownerUserId: "u-1",
  };
  const copy = JSON.parse(JSON.stringify(saved));
  const { session, migrated } = migrateStoredSession(saved);
  assert.equal(migrated, true);
  assert.equal(session._v, STORED_SESSION_VERSION);
  assert.deepEqual(session.preferences, {
    schedule: "full-time",
    environment: "public",
    commute: "drive, within-30",
    location: "Madison, WI",
  });
  // everything else, including the save time and account stamp, is carried across as it was
  for (const k of ["_savedAt", "readinessStage", "resumeText", "goals", "pagesVisited", "carriedIn", "_ownerUserId"]) {
    assert.deepEqual(session[k], (saved as Record<string, unknown>)[k], k);
  }
  // the input object is not changed
  assert.deepEqual(saved, copy);
});

test("a run with no preferences yet is stamped but gets none added", () => {
  const { session, migrated } = migrateStoredSession({ _savedAt: 5, resumeText: "x" });
  assert.equal(migrated, true);
  assert.equal("preferences" in session, false);
  assert.equal(session._v, STORED_SESSION_VERSION);
});

test("a run already on the current version is left exactly alone", () => {
  const current = { _v: STORED_SESSION_VERSION, _savedAt: 9, preferences: { environment: "weird-id", commute: "bike, within-60" } };
  const { session, migrated } = migrateStoredSession(current);
  assert.equal(migrated, false);
  assert.deepEqual(session, current);
});

test("something that is not a run comes back empty", () => {
  for (const bad of [null, undefined, "x", 7, [1]]) {
    const { session, migrated } = migrateStoredSession(bad);
    assert.deepEqual(session, {});
    assert.equal(migrated, false);
  }
});
