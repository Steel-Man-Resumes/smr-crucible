/**
 * The support search reading the checked directory (migration 082,
 * resource_app_v) first, with the earlier list only where the directory has
 * nothing as close (Phase 5 lane R3). Driven through searchSupport, the route's
 * whole search, with a fake directory reader that applies resourceAppSql's
 * own filter (national, or the person's state; the asked areas) to fictional
 * rows for Montana, Wisconsin, Ohio and national services. The real SQL is run
 * against the real view in the PGlite proof. Every org, URL and number here is
 * invented.
 */
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { searchSupport, fromDirectory, directoryScope, requestedWants, type SupportSearchDeps } from "../support-search";
import { resourceAppSql, RESOURCE_APP_LEVEL_CAP, RESOURCE_APP_LIMIT, type ResourceAppRow, type ResourcePlaceQuery } from "@crucible/core/src/resourceDirectoryShared";
import { foldName } from "../location-search";
import { countyKeyOf } from "../support-location";
import type { CounselorResult } from "../hud-counselors";
import { loadPlaceIndex, countiesIn, countiesOf, PLACE_FILE } from "../support-place-index";
import { parsePlace } from "../support-location";

const TODAY = "2026-10-10";

function row(over: Partial<ResourceAppRow> & Pick<ResourceAppRow, "service_id" | "area_id" | "geo_scope" | "state">): ResourceAppRow {
  return {
    org_name: "Sample Org", service_name: null, description: "A fictional service.", eligibility: null,
    area_label: "Area", county: null, counties: null, city: null, address: null, zip: null,
    phone: "555-555-0100", hours: null, website: null, source_url: "https://sample.example.org/page",
    last_checked: "2026-10-01", ...over,
  };
}

const ROWS: ResourceAppRow[] = [
  row({ service_id: "mt-pantry", area_id: "food", geo_scope: "county", state: "MT", county: "Lincoln", city: "Libby", zip: "59923",
        org_name: "Sample Kootenai Pantry", service_name: "Weekly food box", address: "10 Sample Ave", source_url: "https://pantry.example.org/hours" }),
  row({ service_id: "mt-jobs", area_id: "jobs", geo_scope: "city", state: "MT", city: "Libby", zip: "59923", org_name: "Sample Libby Work Desk" }),
  row({ service_id: "mt-flathead-shelter", area_id: "shelter", geo_scope: "multi_county", state: "MT", counties: ["Flathead", "Lake"], org_name: "Sample Valley Shelter" }),
  row({ service_id: "wi-shelter-line", area_id: "shelter", geo_scope: "statewide", state: "WI", org_name: "Sample Badger Shelter Line" }),
  row({ service_id: "wi-mke-food", area_id: "food", geo_scope: "city", state: "WI", city: "Milwaukee", org_name: "Sample Cream City Meals" }),
  row({ service_id: "oh-expunge", area_id: "expungement", geo_scope: "statewide", state: "OH", org_name: "Sample Buckeye Record Help",
        source_url: "https://ohrecords.example.org/clinic", last_checked: "2026-09-20" }),
  row({ service_id: "us-mental-line", area_id: "mental", geo_scope: "national", state: "DC", org_name: "Sample National Talk Line" }),
  row({ service_id: "us-food-finder", area_id: "food", geo_scope: "national", state: "DC", org_name: "Sample Food Finder" }),
];

/**
 * The view's WHERE and ORDER BY, as resourceAppSql writes them, in JS: the
 * asked areas; national rows; the state's statewide rows; its county and
 * city rows that match the place's counties, city or ZIP; closest first, then
 * newest; at most RESOURCE_APP_LEVEL_CAP per reach level. The real SQL runs against the real
 * view in the PGlite proof, including a 250-row state.
 */
function fakeReader(rows = ROWS) {
  const calls: ResourcePlaceQuery[] = [];
  const read: NonNullable<SupportSearchDeps["readDirectory"]> = async (opts) => {
    calls.push(opts);
    const { params } = resourceAppSql(opts);
    const areas = params[0] as string[];
    const state = params.length === 6 ? (params[1] as string) : null;
    const keys = state ? (params[2] as string[]) : [];
    const cityKey = state ? (params[3] as string | null) : null;
    const zip = state ? (params[4] as string | null) : null;
    const cityHit = (r: ResourceAppRow) => (!!r.city && foldName(r.city) === cityKey) || (!!r.zip && r.zip.slice(0, 5) === zip);
    const rank: Record<string, number> = { city: 0, county: 1, multi_county: 1, statewide: 2, national: 3 };
    return rows
      .filter((r) => areas.includes(r.area_id) && (r.geo_scope === "national" || (state !== null && r.state === state && (
        r.geo_scope === "statewide"
        || (r.geo_scope === "city" && cityHit(r))
        || ((r.geo_scope === "county" || r.geo_scope === "multi_county")
            && ([r.county, ...(r.counties ?? [])].some((c) => !!c && keys.includes(countyKeyOf(c))) || cityHit(r)))))))
      .sort((a, b) => rank[a.geo_scope] - rank[b.geo_scope] || b.last_checked.localeCompare(a.last_checked))
      .filter((r, _i, all) => all.filter((x) => rank[x.geo_scope] === rank[r.geo_scope]).indexOf(r) < RESOURCE_APP_LEVEL_CAP);
  };
  return { read, calls };
}
const noHud = async (_q: string) => [] as CounselorResult[];
const run = (input: Record<string, unknown>, reader = fakeReader().read, findHud = noHud) =>
  searchSupport(input, { findHud, readDirectory: reader, today: TODAY });
const ids = (rs: { id: string }[]) => rs.map((r) => r.id);

describe("directory first", () => {
  test("Montana, Libby, food: the Lincoln County pantry and the national finder, from the directory", async () => {
    const r = await run({ category: "food", location: "Libby, MT" });
    assert.deepEqual(ids(r.resources), ["dir-mt-pantry", "dir-us-food-finder"]);
    const pantry = r.resources[0];
    assert.equal(pantry.source, "directory");
    assert.equal(pantry.sourceLabel, "Steel Man's checked directory");
    assert.equal(pantry.area, "Lincoln County, MT");
    assert.equal(pantry.lastChecked, "2026-10-01");
    assert.equal(pantry.checkedLine, "Last checked Oct 1, 2026.");
    assert.equal(pantry.sourceUrl, "https://pantry.example.org/hours");
    assert.equal(pantry.address, "10 Sample Ave, Libby, MT 59923");
    assert.equal(r.coverage.line, null);
    assert.equal(r.directoryRead, true);
  });

  test("Montana, employment: a directory Libby listing replaces the earlier Lincoln County one", async () => {
    const r = await run({ category: "employment", location: "Libby, MT" });
    assert.ok(ids(r.resources).includes("dir-mt-jobs"));
    assert.ok(!ids(r.resources).includes("mt-job-service-libby"), "the earlier county listing is not doubled");
    assert.ok(!r.resources.some((x) => x.state === "WI" || x.state === "OH"));
  });

  test("Montana, housing: a multi-county listing reaches a named county, and a town in it through the Census list", async () => {
    const kal = await run({ category: "housing", location: "Flathead County, MT" });
    const shelter = kal.resources.find((x) => x.id === "dir-mt-flathead-shelter");
    assert.ok(shelter);
    assert.equal(shelter!.area, "Flathead and Lake counties, MT");
    const libby = await run({ category: "housing", location: "Libby, MT" });
    assert.ok(!ids(libby.resources).includes("dir-mt-flathead-shelter"), "Libby is in Lincoln County");
  });

  test("Wisconsin, Milwaukee, housing: a directory statewide line replaces earlier statewide entries but not Milwaukee County ones", async () => {
    const r = await run({ category: "housing", location: "Milwaukee, WI" });
    assert.ok(ids(r.resources).includes("dir-wi-shelter-line"));
    assert.ok(!ids(r.resources).includes("housing-211wi"), "earlier Wisconsin-wide housing is replaced");
    assert.ok(ids(r.resources).includes("housing-rescue-mission"), "earlier Milwaukee County housing is closer, so it stays");
    const sources = new Set(r.resources.map((x) => x.source));
    assert.ok(sources.has("directory") && sources.has("curated"));
    for (const x of r.resources) assert.ok(x.state === "WI" || x.state === null, `${x.id} is ${x.area}`);
  });

  test("Ohio, Columbus, legal: Ohio's statewide record help plus national help; an honest line about Columbus", async () => {
    const r = await run({ category: "legal", location: "Columbus, OH" });
    assert.ok(ids(r.resources).includes("dir-oh-expunge"));
    assert.ok(r.resources.every((x) => x.state === "OH" || x.scope === "national"));
    assert.ok(ids(r.resources).includes("legal-lsc"), "the directory has no national legal aid yet, so the earlier one stays");
    assert.equal(r.coverage.level, "state");
    assert.match(r.coverage.line ?? "", /We don't have checked listings for Columbus, OH itself yet\. These cover Ohio or work anywhere\./);
    const oh = r.resources.find((x) => x.id === "dir-oh-expunge")!;
    assert.equal(oh.checkedLine, "Last checked Sep 20, 2026.");
    assert.equal(oh.sourceUrl, "https://ohrecords.example.org/clinic");
  });

  test("a state with hundreds of statewide rows still shows the national line and the person's county", async () => {
    const big = [...ROWS];
    for (let i = 0; i < 260; i++) big.push(row({ service_id: `mt-state-${i}`, area_id: "food", geo_scope: "statewide", state: "MT", last_checked: "2026-10-09" }));
    const r = await run({ category: "food", location: "Libby, MT" }, fakeReader(big).read);
    assert.ok(ids(r.resources).includes("dir-us-food-finder"), "national line kept");
    assert.ok(ids(r.resources).includes("dir-mt-pantry"), "county pantry kept");
    assert.equal(r.resources.filter((x) => x.scope === "state").length, RESOURCE_APP_LEVEL_CAP);
  });

  test("New York: national only, even when a careless reader hands back other states' rows", async () => {
    const careless: NonNullable<SupportSearchDeps["readDirectory"]> = async () => ROWS;
    for (const category of ["food", "housing", "legal", "mental_health", "employment"]) {
      const r = await run({ category, location: "Brooklyn, NY" }, careless);
      for (const x of r.resources) assert.equal(x.scope, "national", `${category}: ${x.id} (${x.area})`);
      assert.match(r.coverage.line ?? "", /We don't have checked local listings for Brooklyn, NY yet\. These work anywhere\./);
    }
  });

  test("a directory area asked by name: food in Madison gets national help and an honest line", async () => {
    const r = await run({ category: "food", location: "Madison, WI" });
    assert.deepEqual(ids(r.resources), ["dir-us-food-finder"]);
    assert.match(r.coverage.line ?? "", /We don't have checked local listings for Madison, WI yet/);
  });

  test("national only, from the directory: no place, or no state", async () => {
    for (const location of [undefined, "Springfield"]) {
      const r = await run({ category: "mental_health", location });
      assert.ok(ids(r.resources).includes("dir-us-mental-line"));
      assert.ok(r.resources.every((x) => x.scope === "national"));
      assert.ok(r.coverage.line);
    }
  });

  test("the reader is asked for the person's state and the asked areas only", async () => {
    const { read, calls } = fakeReader();
    await run({ category: "housing", location: "Libby, MT" }, read);
    await run({ category: "employment", location: "Springfield" }, read);
    await run({ category: "nonsense", location: "Libby, MT" }, read);
    assert.deepEqual(calls, [
      { state: "MT", areas: ["shelter"], countyKeys: [], cityKey: "libby", zip: null },
      { state: null, areas: ["jobs", "training"], countyKeys: [], cityKey: "springfield", zip: null },
    ]);
  });

  test("a directory outage falls back to the earlier list, and says it did", async () => {
    const down: NonNullable<SupportSearchDeps["readDirectory"]> = async () => { throw new Error("relation does not exist"); };
    const r = await run({ category: "employment", location: "Libby, MT" }, down);
    assert.equal(r.directoryRead, false);
    assert.ok(ids(r.resources).includes("mt-job-service-libby"));
    assert.ok(r.resources.every((x) => x.source === "curated"));
  });

  test("every result names its source and a last-checked line; directory and earlier entries carry dates", async () => {
    const r = await run({ category: "housing", location: "Milwaukee, WI" }, fakeReader().read, async () => [
      { name: "Sample Counsel", address: "2 Main St", city: "Milwaukee", state: "WI", zip: "53202", phone: "", website: "", services: [] },
    ]);
    for (const x of r.resources) {
      assert.ok(["directory", "curated", "hud"].includes(x.source));
      assert.ok(x.sourceLabel && x.checkedLine);
      if (x.source !== "hud") assert.match(x.lastChecked ?? "", /^\d{4}-\d{2}-\d{2}$/);
      if (x.source === "directory") assert.ok(x.sourceUrl);
    }
    assert.ok(r.resources.some((x) => x.source === "hud"));
  });
});

describe("towns and ZIPs to counties (Census list)", () => {
  const CONSUMER = join(__dirname, "..", "..");
  const index = loadPlaceIndex(join(CONSUMER, PLACE_FILE));

  test("the list loads, and a town or ZIP finds its county in its own state", () => {
    assert.ok(index);
    assert.deepEqual(countiesIn(index!, parsePlace("Kalispell, MT")), ["flathead"]);
    assert.deepEqual(countiesIn(index!, parsePlace("Libby, MT")), ["lincoln"]);
    assert.deepEqual(countiesIn(index!, parsePlace("59901")), ["flathead"]);
    assert.ok(countiesIn(index!, parsePlace("Wauwatosa, WI")).includes("milwaukee"));
    assert.deepEqual(countiesIn(index!, parsePlace("Kalispell, WI")), [], "no Kalispell in Wisconsin");
    assert.deepEqual(countiesIn(index!, parsePlace("Springfield")), [], "no state, no county");
  });

  test("a town in a listed county now meets that county's listings", async () => {
    const withCounties = (location: string, category: string) => searchSupport(
      { category, location },
      { findHud: noHud, readDirectory: fakeReader().read, today: TODAY, countiesOf: (p) => countiesIn(index!, p) }
    );
    const kal = await withCounties("Kalispell, MT", "housing");
    assert.ok(ids(kal.resources).includes("dir-mt-flathead-shelter"));
    assert.equal(kal.coverage.line, null);
    const troy = await withCounties("Troy, MT", "food");
    assert.ok(ids(troy.resources).includes("dir-mt-pantry"), "Troy, MT is in Lincoln County");
    const troyNy = await withCounties("Troy, NY", "food");
    assert.ok(!ids(troyNy.resources).includes("dir-mt-pantry"));
    const wwi = await withCounties("West Milwaukee, WI", "housing");
    assert.ok(ids(wwi.resources).includes("housing-rescue-mission"));
  });

  test("a failing lookup changes nothing and throws nothing", async () => {
    const r = await searchSupport({ category: "food", location: "Libby, MT" },
      { findHud: noHud, readDirectory: fakeReader().read, today: TODAY, countiesOf: () => { throw new Error("x"); } });
    assert.ok(ids(r.resources).includes("dir-mt-pantry"));
    assert.equal(typeof countiesOf, "function");
  });

  test("the route traces the file it reads", () => {
    const cfg = readFileSync(join(CONSUMER, "next.config.mjs"), "utf8");
    assert.match(cfg, /"\/api\/resources-search": \["\.\/public\/forge-data\/us-places-2020\.v1\.json"\]/);
    const src = readFileSync(join(CONSUMER, "app", "api", "resources-search", "route.ts"), "utf8");
    assert.match(src, /countiesOf, isPlaceIn \}/);
  });
});

describe("pieces", () => {
  test("scope labels and matching keys from a row", () => {
    assert.equal(directoryScope(ROWS[0]).label, "Lincoln County, MT");
    assert.deepEqual(directoryScope(ROWS[0]).counties, ["lincoln"]);
    assert.equal(directoryScope(ROWS[1]).label, "Libby, MT");
    assert.equal(directoryScope(ROWS[3]).label, "Wisconsin");
    assert.equal(directoryScope(ROWS[6]).label, "Anywhere in the US");
    assert.equal(directoryScope(ROWS[6]).state, null);
  });

  test("a row never shows a non-web link", () => {
    const r = fromDirectory(row({ service_id: "x", area_id: "food", geo_scope: "national", state: "DC", website: "javascript:alert(1)", source_url: "ftp://x" }));
    assert.equal(r.website, undefined);
    assert.equal(r.sourceUrl, null);
  });

  test("asks: categories, barriers and area names", () => {
    assert.deepEqual(requestedWants("housing", undefined).areas, ["shelter"]);
    assert.deepEqual(requestedWants("food", undefined), { categories: [], areas: ["food"] });
    assert.deepEqual(requestedWants(undefined, ["criminal_record"]).areas.sort(), ["courts", "expungement", "jobs", "legal_aid", "training"]);
    assert.equal(requestedWants(undefined, undefined).areas.length, 20);
    assert.deepEqual(requestedWants("bogus", undefined), { categories: [], areas: [] });
  });

  test("the SQL keeps place and areas as parameters", () => {
    const { sql, params } = resourceAppSql({ state: "MT", areas: ["food", "x'; DROP"], countyKeys: ["lincoln", "x'; DROP"], cityKey: "libby'--", zip: "5992" });
    assert.match(sql, /FROM resource_app_v/);
    assert.doesNotMatch(sql, /'MT'|'food'|DROP|lincoln|libby/);
    assert.deepEqual(params, [["food"], "MT", ["lincoln"], null, null, 50]);
    // The place match comes before the limit, closest first.
    assert.ok(sql.indexOf("= ANY($3::text[])") < sql.indexOf("r.rn <="));
    assert.match(sql, /CASE geo_scope WHEN 'city' THEN 0/);
    assert.match(sql, /ORDER BY r\.lvl, r\.last_checked DESC/);
    const none = resourceAppSql({ state: "Montana", areas: ["food"] });
    assert.match(none.sql, /geo_scope = 'national'/);
    assert.deepEqual(none.params, [["food"], 50]);
    assert.deepEqual(resourceAppSql({ state: "MT", areas: ["food"], countyKeys: ["lincoln"], cityKey: "libby", zip: "59923" }).params,
      [["food"], "MT", ["lincoln"], "libby", "59923", 50]);
    // Each reach level is capped on its own, and the caps add up to the page (review N3).
    assert.equal(RESOURCE_APP_LEVEL_CAP * 4, RESOURCE_APP_LIMIT);
    assert.match(sql, /row_number\(\) OVER \(PARTITION BY m\.lvl/);
    assert.match(sql, /WHERE r\.rn <= \$6/);
  });

  test("the route reads the directory and keeps the premium hook", () => {
    const src = readFileSync(join(__dirname, "..", "..", "app", "api", "resources-search", "route.ts"), "utf8");
    assert.match(src, /readDirectory: readResourceDirectory/);
    assert.match(src, /premium: "resources"/);
    assert.match(src, /requiredTier: "client"/);
  });
});
