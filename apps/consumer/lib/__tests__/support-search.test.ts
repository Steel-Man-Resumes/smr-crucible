/**
 * Support search geography (Phase 5 lane R3, Codex A4). Before this, any
 * place that was not "montana" got Wisconsin, and every HUD counselor was
 * labelled Milwaukee. Fake HUD answers only; nothing leaves the machine.
 * Every place, agency and number in the fake HUD rows is invented.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { parsePlace, stateFromZip } from "../support-location";
import { loadPlaceIndex, placeIn, countiesIn, PLACE_FILE } from "../support-place-index";
import { searchSupport, scopeCovers, hudQueryFor, fromHud, requestedCategories } from "../support-search";
import type { CounselorResult } from "../hud-counselors";

const TODAY = "2026-10-10";
const index = loadPlaceIndex(join(__dirname, "..", "..", PLACE_FILE));
const noHud = async (_q: string) => [] as CounselorResult[];
const run = (input: Record<string, unknown>, findHud = noHud) => searchSupport(input, { findHud, today: TODAY });
const states = (rs: { state: string | null }[]) => new Set(rs.map((r) => r.state));

describe("reading the place", () => {
  test("the Forge's saved shapes", () => {
    assert.deepEqual(
      { ...parsePlace("Milwaukee, WI") },
      { state: "WI", cityKey: "milwaukee", countyKey: null, countyKeys: [], zip: null, label: "Milwaukee, WI", given: true }
    );
    const z = parsePlace("Libby, MT 59923");
    assert.equal(z.state, "MT"); assert.equal(z.cityKey, "libby"); assert.equal(z.zip, "59923");
    const c = parsePlace("Lincoln County, MT");
    assert.equal(c.state, "MT"); assert.equal(c.countyKey, "lincoln"); assert.equal(c.cityKey, null);
    const p = parsePlace("53202 (Milwaukee, WI)");
    assert.equal(p.state, "WI"); assert.equal(p.cityKey, "milwaukee"); assert.equal(p.zip, "53202");
  });

  test("typed shapes: a spelled-out state, a state with no comma, a state alone", () => {
    assert.equal(parsePlace("Libby, Montana").state, "MT");
    assert.equal(parsePlace("Libby MT").state, "MT", "a code in capitals counts");
    assert.equal(parsePlace("Libby MT").cityKey, "libby");
    const census = { isPlaceIn: (k: string, st: string) => index ? placeIn(index, k, st) : false };
    assert.equal(parsePlace("libby mt", census).state, "MT", "lower case counts when Libby is a Montana place");
    assert.equal(parsePlace("libby mt", census).cityKey, "libby");
    assert.equal(parsePlace("libby mt").state, null, "without the Census check, lower case is not a state");
    assert.equal(parsePlace("Columbus Ohio").state, "OH");
    assert.equal(parsePlace("columbus new york").state, "NY");
    const ohio = parsePlace("Ohio");
    assert.equal(ohio.state, "OH"); assert.equal(ohio.cityKey, null); assert.equal(ohio.label, "Ohio");
    assert.equal(parsePlace("New York").state, "NY");
    assert.equal(parsePlace("Troy, NY").state, "NY");
  });

  test("a bare ZIP gives its state from the prefix, and nothing else", () => {
    const p = parsePlace("10001");
    assert.equal(p.state, "NY"); assert.equal(p.zip, "10001"); assert.equal(p.cityKey, null); assert.equal(p.label, "NY 10001");
    assert.equal(stateFromZip("59923"), "MT");
    assert.equal(stateFromZip("53202"), "WI");
    assert.equal(stateFromZip("43215"), "OH");
    assert.equal(stateFromZip("90210"), "CA");
    assert.equal(stateFromZip("09012"), null, "a military ZIP has no state");
    assert.equal(stateFromZip("abcde"), null);
  });

  test("ordinary words are not states (review M2)", () => {
    const census = { isPlaceIn: (k: string, st: string) => index ? placeIn(index, k, st) : false };
    for (const text of ["near me", "food near me", "Libby in", "Hi", "hi", "help ok", "shelter or food", "jobs in", "me", "oh"]) {
      const p = parsePlace(text, census);
      assert.equal(p.state, null, `"${text}" read as ${p.state}`);
    }
    assert.equal(parsePlace("HI").state, "HI", "a code alone in capitals is a state");
    assert.equal(parsePlace("Libby, in").state, "IN", "the comma form keeps its meaning");
    assert.equal(parsePlace("Montana").state, "MT");
  });

  test("an ambiguous city has no state, and nothing is guessed", () => {
    const p = parsePlace("Springfield");
    assert.equal(p.state, null); assert.equal(p.given, true); assert.equal(p.label, null);
    assert.equal(parsePlace("Portland or something").state, null);
    assert.equal(parsePlace("").given, false);
    assert.equal(parsePlace({ evil: true }).given, false);
  });

  test("ZIP edges: overrides, the Pacific prefix, DC, PO boxes (review L2, L3)", () => {
    assert.equal(stateFromZip("06390"), "NY", "Fishers Island");
    assert.equal(stateFromZip("06391"), "CT");
    assert.equal(stateFromZip("96799"), "AS", "American Samoa");
    assert.equal(stateFromZip("96813"), "HI");
    assert.equal(stateFromZip("83414"), "WY", "Alta, WY");
    assert.equal(stateFromZip("96910"), "GU");
    assert.equal(stateFromZip("96950"), "MP");
    assert.equal(stateFromZip("96940"), null, "Palau and the rest of 969 give no state");
    const dc = parsePlace("20500");
    assert.equal(dc.state, "DC"); assert.deepEqual(dc.countyKeys, ["district of columbia"]);
    assert.deepEqual(parsePlace("Washington, DC").countyKeys, ["district of columbia"]);
    const box = parsePlace("PO Box 12, Libby, MT 59923");
    assert.equal(box.state, "MT"); assert.equal(box.cityKey, "libby"); assert.equal(box.label, "Libby, MT");
    assert.equal(parsePlace("PO Box 12, MT 59923").cityKey, null);
  });

  test("a typed state beats a ZIP that points somewhere else", () => {
    const p = parsePlace("Libby, MT 10001");
    assert.equal(p.state, "MT"); assert.equal(p.zip, null);
  });
});

describe("who sees what", () => {
  test("Wisconsin: Milwaukee County help, Wisconsin help and national help; no Montana", async () => {
    const r = await run({ category: "housing", location: "Milwaukee, WI" });
    const s = states(r.resources);
    assert.ok(s.has("WI")); assert.ok(s.has(null)); assert.ok(!s.has("MT"));
    assert.ok(r.resources.some((x) => x.area === "Milwaukee County, WI"));
    assert.equal(r.coverage.line, null);
    assert.equal(r.coverage.level, "county");
    // A city inside Milwaukee County still finds it.
    const wauwatosa = await run({ category: "housing", location: "Wauwatosa, WI" });
    assert.ok(wauwatosa.resources.some((x) => x.area === "Milwaukee County, WI"));
  });

  test("elsewhere in Wisconsin: statewide and national only, with an honest line", async () => {
    const r = await run({ category: "housing", location: "Madison, WI" });
    assert.ok(!r.resources.some((x) => x.area === "Milwaukee County, WI"));
    assert.ok(r.resources.some((x) => x.area === "Wisconsin"));
    assert.equal(r.coverage.level, "state");
    assert.match(r.coverage.line ?? "", /We don't have checked listings for Madison, WI itself yet\. These cover Wisconsin or work anywhere\./);
  });

  test("Montana: Libby help and national help; no Wisconsin", async () => {
    const r = await run({ category: "employment", location: "Libby, MT" });
    const s = states(r.resources);
    assert.ok(s.has("MT")); assert.ok(!s.has("WI"));
    assert.equal(r.resources[0].id, "mt-job-service-libby", "local first");
    const byZip = await run({ category: "employment", location: "59923" });
    assert.ok(byZip.resources.some((x) => x.id === "mt-job-service-libby"), "a Lincoln County ZIP finds Libby help");
    const otherMt = await run({ category: "employment", location: "Billings, MT" });
    assert.ok(!otherMt.resources.some((x) => x.id === "mt-job-service-libby"), "Billings is not Lincoln County");
    assert.match(otherMt.coverage.line ?? "", /We don't have checked local listings for Billings, MT yet\. These work anywhere\./);
  });

  test("New York and Ohio: never Wisconsin or Montana; national services and a coverage line", async () => {
    for (const location of ["New York, NY", "Columbus, OH", "Troy, NY"]) {
      for (const category of ["food", "housing", "legal", "employment", "mental_health", undefined]) {
        const r = await run({ category, location });
        for (const x of r.resources) assert.equal(x.scope, "national", `${location} / ${category}: ${x.id} is ${x.area}`);
        assert.ok(!states(r.resources).has("WI") && !states(r.resources).has("MT"));
        assert.equal(r.coverage.level, "national");
        assert.match(r.coverage.line ?? "", /We don't have checked local listings for .+ yet\. These work anywhere\./);
      }
    }
  });

  test("a ZIP alone: placed in a county, or an honest state-level line, never a false 'nothing local' (review L2)", async () => {
    const withCensus = (location: string, category: string) => searchSupport({ category, location },
      { findHud: noHud, today: TODAY, countiesOf: (p) => (index ? countiesIn(index, p) : []), isPlaceIn: (k, st) => (index ? placeIn(index, k, st) : false) });
    const ny = await withCensus("10001", "food");
    assert.equal(ny.coverage.placeMatched, "county");
    assert.match(ny.coverage.line ?? "", /We don't have checked local listings for NY 10001 yet\. These work anywhere\./);
    const dc = await withCensus("20500", "food");
    assert.equal(dc.coverage.placeMatched, "county", "20500 has no Census entry; its prefix is all DC");
    const camp = await withCensus("42223", "legal");
    assert.equal(camp.coverage.placeMatched, "state", "Fort Campbell's prefix spans several counties: county left unknown");
    assert.match(camp.coverage.line ?? "", /We couldn't match ZIP 42223 to a county, so these cover Kentucky or work anywhere\./);
    assert.doesNotMatch(camp.coverage.line ?? "", /don't have checked local listings/);
    const near = await withCensus("near me", "housing");
    assert.equal(near.coverage.placeMatched, "none");
    assert.ok(near.resources.every((x) => x.scope === "national"), "no Maine listings for 'near me'");
  });

  test("national only: no place, or a place with no state", async () => {
    for (const location of [undefined, "", "Springfield"]) {
      const r = await run({ category: "mental_health", location });
      assert.ok(r.resources.length > 0);
      for (const x of r.resources) assert.equal(x.scope, "national");
      assert.ok(r.coverage.line);
    }
    const none = await run({ category: "mental_health" });
    assert.match(none.coverage.line ?? "", /Add your city and state/);
    const amb = await run({ category: "mental_health", location: "Springfield" });
    assert.match(amb.coverage.line ?? "", /couldn't tell which state/);
  });

  test("an unknown category returns nothing rather than everything", async () => {
    const r = await run({ category: "nonsense", location: "Milwaukee, WI" });
    assert.equal(r.resources.length, 0);
    assert.deepEqual(requestedCategories(undefined, ["criminal_record", "bogus"]), ["legal", "employment"]);
  });

  test("every result says where it came from and when it was last checked", async () => {
    const r = await run({ category: "legal", location: "Milwaukee, WI" });
    for (const x of r.resources) {
      assert.equal(x.source, "curated");
      assert.match(x.lastChecked ?? "", /^\d{4}-\d{2}-\d{2}$/);
      assert.match(x.checkedLine, /^Last checked [A-Z][a-z]{2} \d{1,2}, \d{4}\./);
      assert.ok(x.sourceLabel);
    }
    const old = r.resources.find((x) => x.lastChecked === "2026-03-14");
    assert.ok(old?.mayBeOutOfDate);
    assert.match(old!.checkedLine, /call first/);
  });

  test("scope rules, directly", () => {
    const mt = parsePlace("Libby, MT");
    assert.equal(scopeCovers({ level: "national", state: null, label: "x" }, parsePlace("")), true);
    assert.equal(scopeCovers({ level: "state", state: "MT", label: "x" }, mt), true);
    assert.equal(scopeCovers({ level: "state", state: "WI", label: "x" }, mt), false);
    assert.equal(scopeCovers({ level: "city", state: "MT", cities: ["libby"], label: "x" }, mt), true);
    assert.equal(scopeCovers({ level: "city", state: "NY", cities: ["troy"], label: "x" }, parsePlace("Troy, MT")), false);
    assert.equal(scopeCovers({ level: "county", state: "MT", counties: ["lincoln"], label: "x" }, parsePlace("Lincoln County, MT")), true);
    assert.equal(scopeCovers({ level: "state", state: "MT", label: "x" }, parsePlace("Springfield")), false);
  });
});

describe("HUD counselors", () => {
  const fake = (rows: CounselorResult[]) => {
    const asked: string[] = [];
    const fn = async (q: string) => { asked.push(q); return rows; };
    return { fn, asked };
  };
  const row = (over: Partial<CounselorResult>): CounselorResult => ({
    name: "Sample Housing Help", address: "1 Main St", city: "Sampletown", state: "OH", zip: "43000",
    phone: "555-555-0100", website: "", services: ["Rental help"], ...over,
  });

  test("a counselor keeps the address and state HUD gave; never labelled Milwaukee", async () => {
    const { fn, asked } = fake([row({ city: "Columbus", state: "OH", zip: "43215" }), row({ name: "Across The Line", city: "Covington", state: "KY" })]);
    const r = await run({ category: "housing", location: "Columbus, OH" }, fn);
    assert.deepEqual(asked, ["Columbus, OH"]);
    const hud = r.resources.filter((x) => x.source === "hud");
    assert.equal(hud.length, 1, "only counselors in the person's state");
    assert.equal(hud[0].state, "OH");
    assert.equal(hud[0].area, "Columbus, OH");
    assert.equal(hud[0].address, "1 Main St, Columbus, OH 43215");
    assert.equal(hud[0].lastChecked, null, "fetched today is not checked today");
    assert.match(hud[0].checkedLine, /HUD's live list\. We have not checked this one ourselves/);
    assert.ok(!JSON.stringify(r).toLowerCase().includes("milwaukee"));
    // HUD's list is not our check: the place still reads as not covered, and the line says HUD is there.
    assert.equal(r.coverage.level, "national");
    assert.match(r.coverage.line ?? "", /We don't have checked local listings for Columbus, OH yet\. These work anywhere\. HUD's counselors near you are listed too\./);
  });

  test("HUD is not asked without a state, and gets the normalised place, never the raw text", async () => {
    const { fn, asked } = fake([row({})]);
    await run({ category: "housing", location: "Springfield" }, fn);
    await run({ category: "housing" }, fn);
    assert.deepEqual(asked, []);
    await run({ category: "housing", location: "  Libby   MT  " }, fn);
    await run({ category: "housing", location: "59923" }, fn);
    assert.deepEqual(asked, ["Libby, MT", "59923"]);
    assert.equal(hudQueryFor(parsePlace("Ohio")), null, "a whole state is too wide for a distance search");
    await run({ category: "housing", location: "near me" }, fn);
    assert.deepEqual(asked, ["Libby, MT", "59923"], "'near me' never reaches HUD as Maine");
  });

  test("HUD failing leaves the checked list standing", async () => {
    const r = await run({ category: "housing", location: "Milwaukee, WI" }, async () => { throw new Error("offline"); });
    assert.ok(r.resources.length > 0);
  });

  test("fromHud ignores a junk state", () => {
    assert.equal(fromHud(row({ state: "Ohio!!" })).state, null);
  });
});

describe("the route", () => {
  const src = readFileSync(join(__dirname, "..", "..", "app", "api", "resources-search", "route.ts"), "utf8");
  test("no hard-coded Milwaukee, no Montana-only test, no raw location in the log", () => {
    assert.doesNotMatch(src, /geo:\s*"milwaukee"/);
    assert.doesNotMatch(src, /inMontana/);
    assert.doesNotMatch(src, /JSON\.stringify\(\{\s*category,\s*barriers,\s*location\s*\}\)/);
    assert.match(src, /searchSupport\(/);
    assert.match(src, /premium: "resources"/);
  });
});
