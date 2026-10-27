/**
 * Saved views and role layouts (house build L4, migration 104): the
 * definition allowlist, the filter/sort/group engine, the old saved sorts
 * moving over, and Today's order per role. Pure; fictional rows only.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  EMPTY_VIEW, applyView, caseloadViewFields, defaultCaseloadColumns, groupRows, initialViewId, legacyViewToDefinition, normalizeCaseloadLayout,
  normalizeTodayLayout, normalizeViewDefinition, normalizeViewFilter, resolveTodaySections, rowMatchesFilter, cleanViewName,
  type ViewRow,
} from "../savedViewsShared";
import { normalizeStaffPrefs, TODAY_SECTION_KEYS } from "../staffPrefsShared";
import type { CustomFieldDef } from "../customFieldsShared";

const NOW = Date.parse("2026-10-29T12:00:00Z");
const D = (days: number) => new Date(NOW - days * 86400000).toISOString();
const defs: CustomFieldDef[] = [
  { id: "1", entity: "participant", key: "housing", label: "Housing", type: "single_select", options: [{ id: "stable", label: "Stable" }, { id: "shelter", label: "Shelter" }], required: false, help: null, sensitive: false, position: 0, retiredAt: null },
  { id: "2", entity: "participant", key: "hours", label: "Hours wanted", type: "number", options: [], required: false, help: null, sensitive: false, position: 1, retiredAt: null },
  { id: "3", entity: "participant", key: "skills", label: "Skills", type: "multi_select", options: [{ id: "fork", label: "Forklift" }, { id: "cook", label: "Cooking" }], required: false, help: null, sensitive: false, position: 2, retiredAt: null },
  { id: "4", entity: "participant", key: "ready", label: "Ready", type: "boolean", options: [], required: false, help: null, sensitive: false, position: 3, retiredAt: null },
  { id: "5", entity: "enrollment", key: "cohort", label: "Cohort", type: "text", options: [], required: false, help: null, sensitive: false, position: 0, retiredAt: null },
];
const fields = caseloadViewFields(defs, { stations: [{ id: "overview", label: "Overview" }, { id: "apply", label: "Apply" }], statuses: [{ id: "behind", label: "Gone quiet" }, { id: "active", label: "Active" }] });
const fmap = new Map(fields.map((f) => [f.id, f]));
const row = (id: string, values: Record<string, unknown>): ViewRow => ({ id, values: { name: id, ...values } });
const ROWS: ViewRow[] = [
  row("Ana", { status: "active", staff: "s1", lastActive: D(1), "cf:housing": "stable", "cf:hours": 40, "cf:skills": ["fork"], "cf:ready": true }),
  row("Ben", { status: "behind", staff: null, lastActive: D(30), "cf:housing": "shelter", "cf:hours": 20, "cf:skills": ["fork", "cook"], "cf:ready": false }),
  row("Cy", { status: "behind", staff: "s2", lastActive: null, "cf:housing": null, "cf:hours": null, "cf:skills": [], "cf:ready": null }),
];
const ids = (rs: ViewRow[]) => rs.map((r) => r.id);
const ctx = { fields, nowMs: NOW };

describe("view fields", () => {
  it("built-ins first, then participant fields in order; enrollment fields are not caseload columns", () => {
    assert.deepEqual(fields.map((f) => f.id), ["name", "stage", "nextStep", "applications", "lastActive", "staff", "status", "joined", "cf:housing", "cf:hours", "cf:skills", "cf:ready"]);
    assert.equal(fmap.get("cf:skills")?.kind, "multi");
  });
});

describe("the definition allowlist", () => {
  it("drops unknown keys, unknown fields, bad ops and bad values; never throws", () => {
    for (const junk of [null, 1, "x", [], { columns: "all" }]) assert.deepEqual(normalizeViewDefinition(junk), { ...EMPTY_VIEW, columns: (junk as { columns?: unknown })?.columns === "all" ? null : null });
    const d = normalizeViewDefinition({
      columns: ["stage", "cf:housing", "name", "stage", "drop table", "cf:Bad"], extra: 1,
      filters: [{ field: "cf:hours", op: "gt", value: "10" }, { field: "status", op: "any_of", value: ["behind", 3] }, { field: "status", op: "sql", value: 1 }, { field: "nope", op: "is_set" }, { field: "lastActive", op: "within_days", value: 99999 }],
      sort: { field: "cf:hours", dir: "sideways" }, groupBy: "name",
    });
    assert.deepEqual(d, { columns: ["stage", "cf:housing"], filters: [{ field: "cf:hours", op: "gt", value: 10 }, { field: "status", op: "any_of", value: ["behind"] }], sort: { field: "cf:hours", dir: "asc" }, groupBy: null });
    assert.equal(normalizeViewFilter({ field: "joined", op: "before", value: "yesterday" }), null);
    assert.deepEqual(normalizeViewDefinition({ sort: { field: "needs_attention" } }).sort, { field: "needs_attention", dir: "asc" });
  });
  it("names are one clean line, 1 to 60 characters", () => {
    assert.equal(cleanViewName("  My\nquiet   people "), "My quiet people");
    assert.equal(cleanViewName("   "), null);
    assert.equal(cleanViewName("x".repeat(80))?.length, 60);
  });
});

describe("filters", () => {
  const f = (filter: Parameters<typeof rowMatchesFilter>[1]) => ids(ROWS.filter((r) => rowMatchesFilter(r, filter, fmap, NOW)));
  it("choice, multi, number, boolean, staff, empty and set", () => {
    assert.deepEqual(f({ field: "cf:housing", op: "any_of", value: ["shelter"] }), ["Ben"]);
    assert.deepEqual(f({ field: "cf:housing", op: "none_of", value: ["shelter"] }), ["Ana", "Cy"]);
    assert.deepEqual(f({ field: "cf:skills", op: "has_any", value: ["cook"] }), ["Ben"]);
    assert.deepEqual(f({ field: "cf:skills", op: "has_all", value: ["fork", "cook"] }), ["Ben"]);
    assert.deepEqual(f({ field: "cf:hours", op: "gt", value: 25 }), ["Ana"]);
    assert.deepEqual(f({ field: "cf:hours", op: "lt", value: 25 }), ["Ben"]);
    assert.deepEqual(f({ field: "cf:ready", op: "is_false" }), ["Ben"]);
    assert.deepEqual(f({ field: "cf:ready", op: "is_empty" }), ["Cy"]);
    assert.deepEqual(f({ field: "staff", op: "is_empty" }), ["Ben"]);
    assert.deepEqual(f({ field: "cf:housing", op: "is_set" }), ["Ana", "Ben"]);
    assert.deepEqual(f({ field: "name", op: "contains", value: "an" }), ["Ana"]);
  });
  it("dates: within and older than N days, before and after a day", () => {
    assert.deepEqual(f({ field: "lastActive", op: "within_days", value: 7 }), ["Ana"]);
    assert.deepEqual(f({ field: "lastActive", op: "older_than_days", value: 14 }), ["Ben"]);
    assert.deepEqual(f({ field: "lastActive", op: "before", value: "2026-10-20" }), ["Ben"]);
    assert.deepEqual(f({ field: "lastActive", op: "after", value: "2026-10-20" }), ["Ana"]);
  });
  it("a filter on a field that no longer exists hides nobody", () => {
    assert.deepEqual(f({ field: "cf:gone", op: "is_set" }), ["Ana", "Ben", "Cy"]);
  });
});

describe("applyView: filter, sort, find", () => {
  it("every filter must match (AND)", () => {
    assert.deepEqual(ids(applyView(ROWS, { ...EMPTY_VIEW, filters: [{ field: "status", op: "any_of", value: ["behind"] }, { field: "cf:hours", op: "is_set" }] }, ctx)), ["Ben"]);
  });
  it("sorts by a custom number either way, empties always last", () => {
    assert.deepEqual(ids(applyView(ROWS, { ...EMPTY_VIEW, sort: { field: "cf:hours", dir: "asc" } }, ctx)), ["Ben", "Ana", "Cy"]);
    assert.deepEqual(ids(applyView(ROWS, { ...EMPTY_VIEW, sort: { field: "cf:hours", dir: "desc" } }, ctx)), ["Ana", "Ben", "Cy"]);
  });
  it("sorts a choice by the field's own order, not alphabetically", () => {
    assert.deepEqual(ids(applyView(ROWS, { ...EMPTY_VIEW, sort: { field: "cf:housing", dir: "asc" } }, ctx)), ["Ana", "Ben", "Cy"]);
  });
  it("a preset sort uses the caller's comparator; no sort uses the default", () => {
    const presetSorts = { needs_attention: (a: ViewRow, b: ViewRow) => String(b.id).localeCompare(String(a.id)) };
    assert.deepEqual(ids(applyView(ROWS, { ...EMPTY_VIEW, sort: { field: "needs_attention", dir: "asc" } }, { ...ctx, presetSorts })), ["Cy", "Ben", "Ana"]);
    assert.deepEqual(ids(applyView(ROWS, EMPTY_VIEW, { ...ctx, defaultSort: presetSorts.needs_attention })), ["Cy", "Ben", "Ana"]);
  });
  it("find by name sits on top of the view; the input is never changed", () => {
    const copy = JSON.stringify(ROWS);
    assert.deepEqual(ids(applyView(ROWS, EMPTY_VIEW, { ...ctx, find: "B" })), ["Ben"]);
    assert.equal(JSON.stringify(ROWS), copy);
  });
  it("A VIEW NEVER WIDENS: it returns a subset of the rows it was given", () => {
    const out = applyView(ROWS, normalizeViewDefinition({ filters: [{ field: "staff", op: "any_of", value: ["someone-else"] }] }), ctx);
    assert.ok(out.every((r) => ROWS.includes(r)));
  });
});

describe("groupRows", () => {
  it("groups by a choice in option order, empty last as Not set", () => {
    const g = groupRows(ROWS, "cf:housing", { fields });
    assert.deepEqual(g.map((x) => [x.label, ids(x.rows)]), [["Stable", ["Ana"]], ["Shelter", ["Ben"]], ["Not set", ["Cy"]]]);
  });
  it("groups by staff with names, unassigned last", () => {
    const g = groupRows(ROWS, "staff", { fields, staffNames: new Map([["s1", "Alma"], ["s2", "Rafa"]]) });
    assert.deepEqual(g.map((x) => x.label), ["Alma", "Rafa", "Not assigned"]);
  });
  it("yes before no; an ungroupable field gives one group", () => {
    assert.deepEqual(groupRows(ROWS, "cf:ready", { fields }).map((x) => x.label), ["Yes", "No", "Not set"]);
    assert.equal(groupRows(ROWS, "cf:skills", { fields }).length, 1);
    assert.equal(groupRows(ROWS, null, { fields }).length, 1);
  });
});

describe("the old saved sorts move over with the same meaning", () => {
  it("status, staff, nobody, and the sort", () => {
    const legacy = normalizeStaffPrefs({ savedViews: [
      { name: "My quiet", sort: "last_active", status: "behind", staffId: "" },
      { name: "Nobody's", sort: "needs_attention", status: "", staffId: "__unassigned__" },
      { name: "Alma's", sort: "name", status: "", staffId: "11111111-2222-4333-8444-555555555555" },
    ] }).savedViews!;
    assert.deepEqual(legacyViewToDefinition(legacy[0]), { columns: null, filters: [{ field: "status", op: "any_of", value: ["behind"] }], sort: { field: "last_active", dir: "asc" }, groupBy: null });
    assert.deepEqual(legacyViewToDefinition(legacy[1]).filters, [{ field: "staff", op: "is_empty" }]);
    assert.deepEqual(legacyViewToDefinition(legacy[2]).filters, [{ field: "staff", op: "any_of", value: ["11111111-2222-4333-8444-555555555555"] }]);
    // and each survives the allowlist it will be read through
    for (const v of legacy) assert.deepEqual(normalizeViewDefinition(legacyViewToDefinition(v)), legacyViewToDefinition(v));
  });
  it("the move is idempotent, keeps the old list, and its marker survives a prefs save (source)", () => {
    const sv = readFileSync(new URL("../savedViews.ts", import.meta.url), "utf8");
    const mv = sv.slice(sv.indexOf("export async function migrateLegacySavedViews"));
    assert.match(mv, /if \(moved\.includes\(actor\.orgId\)\) return 0;/);
    assert.match(mv, /ON CONFLICT DO NOTHING/);
    assert.match(mv, /'\{viewsMovedTo\}'/);
    assert.doesNotMatch(mv.slice(0, mv.indexOf("\n}\n")), /savedViews'|- 'savedViews'|#- /, "the old list is never removed");
    const sp = readFileSync(new URL("../staffPrefs.ts", import.meta.url), "utf8");
    assert.match(sp, /jsonb_build_object\('viewsMovedTo', staff_prefs->'viewsMovedTo'\)/);
    assert.equal("viewsMovedTo" in normalizeStaffPrefs({ viewsMovedTo: ["x"] }), false, "a client can never set the marker");
  });
});

describe("role layouts", () => {
  it("Today: the role's order first, sections it does not mention after, hidden ones gone", () => {
    const layout = normalizeTodayLayout({ order: ["quiet", "tasks", "bogus"], hidden: ["unassigned", "nope"] });
    assert.deepEqual(layout, { order: ["quiet", "tasks"], hidden: ["unassigned"] });
    const out = resolveTodaySections(TODAY_SECTION_KEYS, layout);
    assert.deepEqual(out.slice(0, 3), ["quiet", "tasks", "retention"]);
    assert.ok(!out.includes("unassigned"));
    assert.equal(out.length, TODAY_SECTION_KEYS.length - 1);
    assert.deepEqual(resolveTodaySections(TODAY_SECTION_KEYS, null), [...TODAY_SECTION_KEYS]);
  });
  it("caseload columns: the role's set, else every built-in, minus what the person hid", () => {
    assert.deepEqual(normalizeCaseloadLayout({ columns: ["status", "cf:housing", "name", "x y"] }), { columns: ["status", "cf:housing"] });
    assert.deepEqual(defaultCaseloadColumns({ columns: ["status", "cf:housing"] }, ["status"]), ["cf:housing"]);
    assert.deepEqual(defaultCaseloadColumns(null, ["nextStep"]), ["stage", "applications", "lastActive", "staff", "status", "joined"]);
  });
  it("which view opens first: the one chosen last, else the role's shared default", () => {
    const views = [
      { id: "mine", ownerUserId: "u", roleDefault: null, position: 0 },
      { id: "staffdef", ownerUserId: null, roleDefault: "staff", position: 1 },
      { id: "admindef", ownerUserId: null, roleDefault: "org_admin", position: 0 },
    ];
    assert.equal(initialViewId(views, "staff", null), "staffdef");
    assert.equal(initialViewId(views, "org_admin", "gone"), "admindef");
    assert.equal(initialViewId(views, "staff", "mine"), "mine");
    assert.equal(initialViewId(views, "staff", ""), null, "an explicit choice of the default list stays");
    assert.equal(initialViewId(views, "owner", null), null);
  });
});

describe("the database half (source checks)", () => {
  const src = readFileSync(new URL("../savedViews.ts", import.meta.url), "utf8");
  it("everything runs in the org scope", () => {
    assert.doesNotMatch(src, /\b(query|getOne|insert)\s*\(/);
  });
  it("shared views and layouts need org.settings.manage, never a platform admin acting for an org", () => {
    assert.match(src, /canManageSharedViews = \(a: OrgActor\) => !a\.viaPlatformAdmin && a\.capabilities\.has\("org\.settings\.manage"\)/);
    const create = src.slice(src.indexOf("export async function createSavedView"));
    assert.match(create.slice(0, 900), /if \(shared && !canManageSharedViews\(actor\)\)/);
    assert.match(src.slice(src.indexOf("export async function setRoleLayout")).slice(0, 300), /canManageSharedViews\(actor\)/);
  });
  it("changes and deletes are limited to your own views, or shared ones for a manager", () => {
    for (const fn of ["updateSavedView", "deleteSavedView"]) {
      const body = src.slice(src.indexOf(`export async function ${fn}`));
      assert.match(body.slice(0, 3200), /owner_user_id = \$3::uuid OR \(owner_user_id IS NULL AND \$\d::boolean\)/, fn);
    }
  });
});
