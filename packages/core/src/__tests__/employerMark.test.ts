/**
 * The job-listing mark: one decision (isMarked) over two sources.
 *
 * Legacy (switch off): exact normalized name, as since Codex 12.
 * Directory (DIRECTORY_MARK_ENABLED): exact name AND the listing's place AND,
 * for a role mark, its title. When the listing cannot be placed, no mark.
 *
 * Run: npm test (node --import tsx --test)
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { isMarked, toStateCode, roleWords, type EmployerMarks, type DirectoryMark } from "../employer";

const site = (city: string, state = "MT"): DirectoryMark =>
  ({ basis: "employer", roleFamily: null, roleTitle: null, placeKind: "site", state, county: null, city });
const dir = (entries: Record<string, DirectoryMark[]>): EmployerMarks =>
  ({ source: "directory", byKey: new Map(Object.entries(entries)) });

test("legacy: exact normalized name, place ignored (today's behavior)", () => {
  const marks: EmployerMarks = { source: "legacy", names: new Set(["roehl transport"]) };
  assert.equal(isMarked("Roehl Transport, Inc.", {}, marks), true);
  assert.equal(isMarked("Targeted Staffing", {}, { source: "legacy", names: new Set(["target"]) }), false);
});

test("directory: a site mark marks a listing in that city and state", () => {
  const marks = dir({ "flathead county": [site("Kalispell")] });
  assert.equal(isMarked("Flathead County", { city: "Kalispell", state: "MT" }, marks), true);
  assert.equal(isMarked("Flathead County", { city: "kalispell", state: "Montana" }, marks), true);
});

test("directory: the same employer in another city or state is NOT marked", () => {
  const marks = dir({ "the home depot": [site("Kalispell")] });
  assert.equal(isMarked("The Home Depot", { city: "Missoula", state: "MT" }, marks), false);
  assert.equal(isMarked("The Home Depot", { city: "Kalispell", state: "WI" }, marks), false);
});

test("directory: a listing that cannot be placed gets no mark", () => {
  const marks = dir({ "flathead county": [site("Kalispell")] });
  assert.equal(isMarked("Flathead County", { city: "Kalispell", state: null }, marks), false);
  assert.equal(isMarked("Flathead County", { city: null, state: "MT" }, marks), false);
  assert.equal(isMarked("Flathead County", { city: "Kalispell", state: "ZZ" }, marks), false);
});

test("directory: statewide marks need only the state; county and service areas cannot be placed", () => {
  const sw: DirectoryMark = { ...site("x"), placeKind: "statewide", city: null };
  const county: DirectoryMark = { ...site("x"), placeKind: "county", county: "Flathead", city: null };
  assert.equal(isMarked("State Agency", { city: "Helena", state: "MT" }, dir({ "state agency": [sw] })), true);
  assert.equal(isMarked("County Co", { city: "Kalispell", state: "MT" }, dir({ "county": [county] })), false);
});

test("directory: a role mark needs the listing's title to carry the role", () => {
  const role: DirectoryMark = { ...site("Billings"), basis: "role", roleTitle: "Line Cook", roleFamily: "kitchen" };
  const marks = dir({ "peopleready": [role] });
  assert.equal(isMarked("PeopleReady", { city: "Billings", state: "MT", title: "Line Cook - Nights" }, marks), true);
  assert.equal(isMarked("PeopleReady", { city: "Billings", state: "MT", title: "Delivery Driver" }, marks), false);
  assert.equal(isMarked("PeopleReady", { city: "Billings", state: "MT", title: null }, marks), false);
});

test("directory: unknown employers are never marked", () => {
  assert.equal(isMarked("Somebody Else", { city: "Kalispell", state: "MT" }, dir({ "flathead county": [site("Kalispell")] })), false);
});

test("state codes: codes and names map; nonsense does not", () => {
  assert.equal(toStateCode("mt"), "MT");
  assert.equal(toStateCode("Wisconsin"), "WI");
  assert.equal(toStateCode("XX"), null);
  assert.equal(toStateCode(""), null);
});

test("role titles recorded with a city or 'job description' still match on the job words", () => {
  assert.deepEqual(roleWords("Housekeeper, Billings"), ["housekeeper"]);
  assert.deepEqual(roleWords("Licensed Addiction Counselor job description"), ["licensed", "addiction", "counselor"]);
  const role: DirectoryMark = { ...site("Billings"), basis: "role", roleTitle: "Housekeeper, Billings", roleFamily: null };
  const marks = dir({ "peopleready": [role] });
  assert.equal(isMarked("PeopleReady", { city: "Billings", state: "MT", title: "Housekeeper" }, marks), true);
  assert.equal(isMarked("PeopleReady", { city: "Billings", state: "MT", title: "Forklift Driver" }, marks), false);
  assert.equal(isMarked("PeopleReady", { city: "Missoula", state: "MT", title: "Housekeeper" }, marks), false);
});
