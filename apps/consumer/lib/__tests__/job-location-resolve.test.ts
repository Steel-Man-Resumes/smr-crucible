/**
 * The job board's "Where?" box is free text. 2026-11-18 live demo: "OH, cinncinati"
 * returned nothing while "OH" worked. These use the real Census place list.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildLocationIndex, type RawLocationData } from "../location-search";
import { resolveJobLocation } from "../job-location-resolve";

const index = buildLocationIndex(
  JSON.parse(readFileSync(join(__dirname, "..", "..", "public", "forge-data", "us-places-2020.v1.json"), "utf8")) as RawLocationData,
);
const r = (s: string) => resolveJobLocation(index, s).value;

test("the demo string: state first, city misspelled", () => {
  assert.equal(r("OH, cinncinati"), "Cincinnati, OH");
  assert.equal(resolveJobLocation(index, "OH, cinncinati").changed, true);
});

test("other shapes of the same place", () => {
  assert.equal(r("cincinnati, oh"), "Cincinnati, OH");
  assert.equal(r("Cincinati OH"), "Cincinnati, OH");
  assert.equal(r("Ohio, Cincinnati"), "Cincinnati, OH");
  assert.equal(r("milwakee, wi"), "Milwaukee, WI");
  assert.equal(r("Kalispell, MT"), "Kalispell, MT");
  assert.equal(resolveJobLocation(index, "Kalispell, MT").changed, false);
});

test("a state alone, a remote search and unknown text pass through", () => {
  assert.equal(r("OH"), "OH");
  assert.equal(r("Ohio"), "Ohio");
  assert.equal(r("United States"), "United States");
  assert.equal(r("somewhere nice"), "somewhere nice");
});

test("ZIPs resolve to their place", () => {
  assert.match(r("45202"), /^Cincinnati, OH 45202$/);
});

test("short names are not guessed at", () => {
  // "Eli, OH" is not a place; do not turn it into some other short town.
  assert.equal(r("Eli, OH"), "Eli, OH");
});

test("names that start with a state name are not split (review 11/18)", () => {
  assert.equal(r("Kansas City"), "Kansas City");
  assert.equal(r("Oklahoma City"), "Oklahoma City");
  assert.equal(r("Virginia Beach"), "Virginia Beach");
  assert.equal(r("Virginia Beach VA"), "Virginia Beach, VA");
  assert.equal(r("Indiana PA"), "Indiana, PA");
  assert.equal(r("Nevada City CA"), "Nevada City, CA");
  assert.equal(r("Washington DC"), "Washington, DC");
  assert.equal(r("Kansas City, MO"), "Kansas City, MO");
});

test("swapped letters count as one slip; unknown towns are not guessed", () => {
  assert.equal(r("Akorn, OH"), "Akron, OH");
  assert.equal(r("Dayten, OH"), "Dayton, OH");
  assert.equal(r("99999"), "99999");
  assert.equal(r("45202-1234"), "Cincinnati, OH 45202");
});

test("no index means no change", () => {
  assert.deepEqual(resolveJobLocation(null, "OH, cinncinati"), { value: "OH, cinncinati", changed: false });
});
