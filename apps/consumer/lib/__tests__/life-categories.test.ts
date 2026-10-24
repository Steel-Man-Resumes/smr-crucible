import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { BARRIER_CATEGORY_MAP } from "../resource-directory";
import { CATEGORY_AREAS, CURATED_CATEGORIES, OPT_IN_CATEGORIES, requestedWants, requestedCategories, isInterfaithOrChaplaincy, searchSupport } from "../support-search";
import { NEXT_CATEGORIES } from "../next-steps";

const ROOT = join(__dirname, "..", "..");
const read = (...p: string[]) => readFileSync(join(ROOT, ...p), "utf8");

test("health reaches the physical-health rows; faith reaches only faith rows", () => {
  assert.ok(CURATED_CATEGORIES.includes("health"));
  assert.ok(CURATED_CATEGORIES.includes("faith"));
  assert.deepEqual(CATEGORY_AREAS.health, ["physical"]);
  assert.deepEqual(CATEGORY_AREAS.faith, ["faith"]);
  assert.deepEqual(requestedWants("health", undefined).areas, ["physical"]);
  assert.deepEqual(requestedWants("faith", undefined).areas, ["faith"]);
});

test("faith is opt-in: never from a barrier, never in 'any kind of help', never inferred", () => {
  assert.deepEqual([...OPT_IN_CATEGORIES], ["faith"]);
  for (const [barrier, cats] of Object.entries(BARRIER_CATEGORY_MAP)) assert.ok(!cats.includes("faith"), barrier);
  // Every barrier together still never yields faith.
  const all = requestedCategories(undefined, Object.keys(BARRIER_CATEGORY_MAP));
  assert.ok(all !== "all" && !all.includes("faith"));
  const any = requestedWants(undefined, undefined);
  assert.ok(!any.categories.includes("faith"), "not part of any kind of help");
  assert.ok(!any.areas.includes("faith"), "faith rows do not appear in an unfiltered search");
  // No hurdle or barrier list in this tree names faith.
  for (const rel of [["lib", "resource-directory.ts"]]) {
    const src = read(...rel);
    const map = src.slice(src.indexOf("export const BARRIER_CATEGORY_MAP"), src.indexOf("};", src.indexOf("export const BARRIER_CATEGORY_MAP")));
    assert.doesNotMatch(map, /faith/);
  }
});

test("a faith search is not tied to the person and is not saved", () => {
  const route = read("app", "api", "resources-search", "route.ts");
  assert.match(route, /const optIn = typeof category === "string" && \(OPT_IN_CATEGORIES as readonly string\[\]\)\.includes\(category\);/);
  assert.match(route, /if\(!optIn && directoryRead/, "no coverage ticket under the person's id");
  assert.match(route, /userId: optIn \? null : session\?\.user\?\.id \?\? null/, "log row without a user id");
  const search = read("components", "lanes", "SupportSearch.tsx");
  assert.doesNotMatch(search, /localStorage|\/api\/user\/(profile|context|preferences)/, "the chosen category is not stored");
});

test("faith results put interfaith and chaplaincy first", async () => {
  assert.equal(isInterfaithOrChaplaincy({ title: "Hospital chaplain", provider: "County hospital" }), true);
  assert.equal(isInterfaithOrChaplaincy({ title: "Example Interfaith Council" }), true);
  assert.equal(isInterfaithOrChaplaincy({ title: "Example parish food shelf" }), false);
  const row = (id: string, name: string, geo: "city" | "national"): Record<string, unknown> => ({
    service_id: id, org_name: name, service_name: name, description: "Example listing.", eligibility: null, area_id: "faith", area_label: "Faith",
    geo_scope: geo, state: geo === "national" ? "DC" : "MT", county: null, counties: null, city: geo === "city" ? "Libby" : null, address: null, zip: null,
    phone: null, hours: null, website: "https://example.org", source_url: "https://example.org", last_checked: "2026-10-01",
  });
  // The closer listing is a single-tradition program; interfaith still comes first.
  const out = await searchSupport({ category: "faith", location: "Libby, MT" }, {
    findHud: async () => [],
    readDirectory: async () => [row("1", "Example Church Program", "city"), row("2", "Example Interfaith Council", "national")] as never,
  } as never);
  const titles = out.resources.map((r) => r.title);
  assert.ok(titles.length >= 2, titles.join(" | "));
  assert.match(titles[0], /Interfaith/, titles.join(" | "));
  // Without the faith category the same rows keep the usual closest-first order.
  assert.equal(isInterfaithOrChaplaincy({ title: titles[1] }), false);
});

test("cards name the need in plain words; faith last; no diagnosis words", () => {
  const ids = NEXT_CATEGORIES.map((c) => c.id);
  assert.equal(ids[ids.length - 1], "faith");
  assert.equal(NEXT_CATEGORIES.find((c) => c.id === "substance")?.label, "Recovery support");
  assert.equal(NEXT_CATEGORIES.find((c) => c.id === "faith")?.label, "Faith and community");
  for (const c of NEXT_CATEGORIES) assert.doesNotMatch(`${c.label} ${c.line}`, /addict|alcoholic|disorder|diagnos|church|christian|catholic|muslim|jewish/i, c.id);
  const select = read("components", "lanes", "SupportSearch.tsx");
  assert.match(select, /\{ id: "health", label: "Health care" \}/);
  assert.match(select, /\{ id: "faith", label: "Faith and spiritual support" \},\n\];/, "faith is last in the select");
});

test("the 988 line is static and on both help pages", () => {
  const line = read("components", "CrisisLine.tsx");
  assert.doesNotMatch(line, /"use client"|fetch\(|useEffect/);
  assert.match(line, /href="tel:988"/);
  assert.match(line, /988 Suicide and Crisis Lifeline/);
  for (const p of [["app", "(dashboard)", "dashboard", "next", "page.tsx"], ["app", "(dashboard)", "dashboard", "resources", "page.tsx"]]) {
    assert.match(read(...p), /<CrisisLine \/>/, p.join("/"));
  }
});
