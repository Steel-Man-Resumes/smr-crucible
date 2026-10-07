import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { join } from "node:path";
import {
  buildLocationIndex,
  searchLocations,
  resolveZip,
  splitQuery,
  foldName,
  type RawLocationData,
} from "../location-search";
import { parseStateCode, stateCodeFrom } from "../location-state";

const FILE = join(__dirname, "..", "..", "public", "forge-data", "us-places-2020.v1.json");
const rawText = readFileSync(FILE, "utf8");
const index = buildLocationIndex(JSON.parse(rawText) as RawLocationData);

test("the shipped Census file is the compact build, small enough to load on a phone", () => {
  const data = JSON.parse(rawText) as RawLocationData;
  assert.equal(data.v, 1);
  assert.match(data.source ?? "", /Census/);
  assert.ok(data.places.length > 30000, `places: ${data.places.length}`);
  assert.ok(index.zips.size > 33000, `zips: ${index.zips.size}`);
  const gz = gzipSync(Buffer.from(rawText)).length;
  assert.ok(gz < 400 * 1024, `gzipped size ${gz} must stay under 400KB`);
});

test("a city prefix finds the city, biggest first", () => {
  const r = searchLocations(index, "milw");
  assert.equal(r[0].value, "Milwaukee, WI");
  assert.equal(r[0].kind, "place");
  assert.ok(r.length <= 8);
});

test("a full ZIP saves as City, ST ZIP and parses back to its state", () => {
  const r = searchLocations(index, "53202");
  assert.equal(r.length, 1);
  assert.equal(r[0].kind, "zip");
  assert.equal(r[0].value, "Milwaukee, WI 53202");
  assert.equal(parseStateCode(r[0].value), "WI");
  assert.equal(resolveZip(index, " 53202 "), "Milwaukee, WI 53202");
  assert.equal(resolveZip(index, "00000"), null);
});

test("a rural ZIP is labeled with its town, and the county rides along", () => {
  const [r] = searchLocations(index, "59923");
  assert.equal(r.value, "Libby, MT 59923");
  assert.equal(r.detail, "Lincoln County");
});

test("a ZIP prefix lists ZIP areas that start with it", () => {
  const r = searchLocations(index, "532");
  assert.ok(r.length > 1);
  for (const s of r) {
    assert.equal(s.kind, "zip");
    assert.ok(s.value.endsWith(s.value.slice(-5)) && s.value.slice(-5).startsWith("532"));
    assert.equal(parseStateCode(s.value), "WI");
  }
});

test("a state abbreviation or name narrows the list", () => {
  assert.equal(searchLocations(index, "springfield, il")[0].value, "Springfield, IL");
  assert.equal(searchLocations(index, "springfield mo")[0].value, "Springfield, MO");
  assert.equal(searchLocations(index, "portland or")[0].value, "Portland, OR");
  assert.equal(searchLocations(index, "libby montana")[0].value, "Libby, MT");
  for (const s of searchLocations(index, "springfield, il")) assert.equal(s.state, "IL");
});

test("saint and st, accents and punctuation all match", () => {
  assert.equal(foldName("St. Louis"), foldName("saint louis"));
  assert.equal(searchLocations(index, "saint louis")[0].value, "St. Louis, MO");
  assert.ok(searchLocations(index, "bayamon").some((s) => s.value === "Bayamón, PR"));
});

test("counties are findable by name", () => {
  const r = searchLocations(index, "lincoln county, mt");
  assert.equal(r[0].value, "Lincoln County, MT");
  assert.equal(r[0].kind, "county");
});

test("a rural place missing from the list still saves as typed, and its state still parses", () => {
  const typed = "Pine Hollow Ranch, MT";
  assert.deepEqual(searchLocations(index, typed), []);
  assert.equal(parseStateCode(typed), "MT");
  assert.equal(parseStateCode("Pine Hollow Ranch, Montana"), "MT");
});

test("nothing typed, or junk, gives no suggestions", () => {
  assert.deepEqual(searchLocations(index, ""), []);
  assert.deepEqual(searchLocations(index, "12"), []);
  assert.deepEqual(searchLocations(index, "123456"), []);
});

test("splitQuery reads a trailing state only when a name comes before it", () => {
  assert.deepEqual(splitQuery("or"), { name: "or", state: null });
  assert.deepEqual(splitQuery("charleston west virginia"), { name: "charleston", state: "WV" });
  assert.deepEqual(splitQuery("new york"), { name: "new york", state: null });
  assert.deepEqual(splitQuery("Milwaukee, WI 53202"), { name: "Milwaukee", state: "WI" });
});

test("parseStateCode reads every saved shape and never guesses", () => {
  assert.equal(parseStateCode("Milwaukee, WI"), "WI");
  assert.equal(parseStateCode("Milwaukee, WI 53202"), "WI");
  assert.equal(parseStateCode("Milwaukee, WI 53202-1234"), "WI");
  assert.equal(parseStateCode("53202 (Milwaukee, WI)"), "WI");
  assert.equal(parseStateCode("Lincoln County, MT"), "MT");
  assert.equal(parseStateCode("milwaukee, wi"), "WI");
  assert.equal(parseStateCode("Lansing, Michigan"), "MI");
  assert.equal(parseStateCode("San Juan, PR"), "PR");
  assert.equal(parseStateCode("Portland or something"), null);
  assert.equal(parseStateCode("53202"), null);
  assert.equal(parseStateCode("Milwaukee"), null);
  assert.equal(parseStateCode("Somewhere, XX"), null);
  assert.equal(parseStateCode(""), null);
  assert.equal(parseStateCode(undefined), null);
  assert.equal(parseStateCode(42), null);
  assert.equal(stateCodeFrom("wi"), "WI");
  assert.equal(stateCodeFrom("New Mexico"), "NM");
  assert.equal(stateCodeFrom("zz"), null);
});
