/**
 * House build L4 (customization), the screens and routes: Today folds per
 * person and keeps the role's order, the person page shows the org's fields
 * (retired ones only with an answer), every field type has a real input, and
 * every route checks the right capability. Fictional fixtures only.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { toggleCollapsed, type TodayPayload } from "../today-view";
import { TodayView } from "../../components/org/TodayPage";
import { EarlierAnswers, FieldInput, fieldsToShow } from "../../components/org/CustomFieldsPanel";
import { CUSTOM_FIELD_TYPES, type CustomFieldDef } from "@crucible/core/src/customFieldsShared";

(globalThis as { React?: unknown }).React = React;
const CONSUMER = join(import.meta.dirname, "..", "..");
const read = (p: string) => readFileSync(join(CONSUMER, p), "utf8");
const NOW = new Date(2026, 9, 29, 9, 0, 0).getTime();

const DAY: TodayPayload = {
  sections: [{ key: "quiet", label: "Gone quiet" }, { key: "tasks", label: "Your tasks" }],
  hidden: [], collapsed: ["quiet"], canAddTasks: false, reach: null, volunteer: false,
  items: [
    { key: "q:p2", section: "quiet", clientId: "p2", clientName: "Sam Cole", when: null, stage: 2, reason: "Sam was last active 33 days ago.", action: { label: "Check in", href: "/dashboard/clients/p2" } },
    { key: "task:t1", section: "tasks", clientId: null, clientName: null, taskId: "t1", when: null, reason: "Order intake folders", action: { label: "Mark done", href: "#" } },
  ],
};
const today = (onToggleSection?: (k: string) => void) =>
  renderToStaticMarkup(React.createElement(TodayView, { state: { status: "ready", data: DAY }, nowMs: NOW, troyReady: false, tourReady: false, onToggleSection }));

test("Today: a folded section keeps its heading and count, its rows one tap away", () => {
  const html = today(() => {});
  assert.match(html, /Gone quiet/);
  assert.doesNotMatch(html, /Sam was last active/);
  assert.match(html, /aria-expanded="false"[^>]*>Show<span class="sr-only"> Gone quiet/);
  assert.match(html, /Order intake folders/);
  assert.match(html, /aria-expanded="true"[^>]*>Fold/);
});
test("Today: sections come in the order the server sent (the role's layout)", () => {
  const html = today(() => {});
  assert.ok(html.indexOf("Gone quiet") < html.indexOf("Your tasks"));
});
test("Today: with no fold control (view-as, older callers) nothing is folded", () => {
  const html = today(undefined);
  assert.match(html, /Sam was last active/);
  assert.doesNotMatch(html, />Fold</);
});
test("toggleCollapsed adds and removes one key", () => {
  assert.deepEqual(toggleCollapsed(undefined, "quiet"), ["quiet"]);
  assert.deepEqual(toggleCollapsed(["quiet", "tasks"], "quiet"), ["tasks"]);
});

const def = (over: Partial<CustomFieldDef>): CustomFieldDef => ({
  id: "d1", entity: "participant", key: "k", label: "Housing", type: "text", options: [], required: false, help: null, sensitive: false, position: 0, retiredAt: null, ...over,
});

test("person page: live fields, plus retired ones that still hold an answer", () => {
  const defs = [def({ id: "a", key: "a", position: 1 }), def({ id: "b", key: "b", retiredAt: "2026-10-01" }), def({ id: "c", key: "c", retiredAt: "2026-10-01" }), def({ id: "d", key: "d", position: 0 })];
  assert.deepEqual(fieldsToShow(defs, { b: "kept" }).map((d) => d.id), ["d", "a", "b"]);
});

test("every field type has a real, labelled input", () => {
  const opts = [{ id: "s", label: "Stable" }, { id: "o", label: "Old", retired: true }];
  for (const type of CUSTOM_FIELD_TYPES) {
    const html = renderToStaticMarkup(React.createElement(FieldInput, { def: def({ id: `f-${type}`, type, options: type.endsWith("select") ? opts : [], help: "Say it plainly", required: true }), value: null, staff: [{ id: "u1", name: "Alma Reyes" }], onChange: () => {} }));
    assert.match(html, new RegExp(`for="cf-f-${type}"`), type);
    assert.match(html, /\(needed\)/, type);
    assert.match(html, /aria-describedby="cf-f-[a-z_]+-help"/, type);
    if (type === "url") assert.match(html, /type="url"/);
    if (type === "date") assert.match(html, /type="date"/);
    if (type === "number") assert.match(html, /type="number"/);
    if (type === "staff_member") assert.match(html, /Alma Reyes/);
    if (type.endsWith("select")) assert.doesNotMatch(html, /Old \(retired\)/, `${type}: a retired choice is not offered`);
  }
  const kept = renderToStaticMarkup(React.createElement(FieldInput, { def: def({ type: "single_select", options: opts }), value: "o", staff: [], onChange: () => {} }));
  assert.match(kept, /Old \(retired\)/, "unless it is the answer already given");
  const sens = renderToStaticMarkup(React.createElement(FieldInput, { def: def({ label: "Parole officer" }), value: "", staff: [], onChange: () => {} }));
  assert.match(sens, /sensitive, never sent to AI tools/, "a record word marks the input sensitive");
});

test("routes check the right capability before anything else", () => {
  const routes: [string, string, string][] = [
    ["app/api/org/fields/route.ts", "GET", "org.cohort.view"],
    ["app/api/org/fields/route.ts", "POST", "org.settings.manage"],
    ["app/api/org/fields/values/route.ts", "GET", "org.cohort.view"],
    ["app/api/org/fields/values/route.ts", "PUT", "org.note.write"],
    ["app/api/org/views/route.ts", "GET", "org.cohort.view"],
    ["app/api/org/views/route.ts", "POST", "org.cohort.view"],
    ["app/api/org/layouts/route.ts", "GET", "org.cohort.view"],
    ["app/api/org/layouts/route.ts", "PUT", "org.settings.manage"],
    ["app/api/org/caseload/export/route.ts", "POST", "org.export"],
  ];
  for (const [file, method, cap] of routes) {
    const src = read(file);
    const body = src.slice(src.indexOf(`export async function ${method}`));
    assert.match(body.split("\n").slice(0, 3).join("\n"), new RegExp(`requireOrgCapability\\("${cap.replace(/\./g, "\\.")}"\\)`), `${method} ${file}`);
    assert.match(body.split("\n").slice(0, 4).join("\n"), /if \(!guard\.ok\) return guard\.response;/, `${method} ${file}`);
  }
});

test("the export: sensitive fields only by tick, logged, never for a platform admin acting for an org", () => {
  const src = read("app/api/org/caseload/export/route.ts");
  // A POST from this app's own pages only; a GET (a link, an image, a preview) gets nothing.
  assert.match(src, /export async function GET\(\) \{\n  return NextResponse\.json\(\{ error: "Use the Export button on People\." \}, \{ status: 405/);
  assert.match(src, /if \(!isSameOriginRequest\(request\.headers\)\) return NextResponse\.json\(\{ error: "Exports start from the People page\." \}, \{ status: 403 \}\);/);
  const wb = read("components/org/CaseloadWorkbench.tsx");
  assert.match(wb, /<form method="post" action="\/api\/org\/caseload\/export"/);
  assert.doesNotMatch(wb, /href=\{[^}]*caseload\/export/);
  assert.match(src, /includeSensitiveIds: ticked/);
  assert.match(src, /recordDataAccess\(\{[\s\S]*sensitiveFields: sensitiveIncluded/);
  assert.match(src, /if \(actor\.viaPlatformAdmin\) return/);
  assert.match(src, /assignedToStaffId: seesAll \? undefined : actor\.userId/, "a case manager exports only their own caseload");
});

test("Today's route applies the role's layout and sends nothing from a hidden section", () => {
  const src = read("app/api/org/today/route.ts");
  assert.match(src, /resolveTodaySections\(TODAY_SECTIONS, layout\.today\)/);
  assert.match(src, /items: view\.items\.filter\(\(i\) => shown\.has\(i\.section\)\)/);
  assert.match(src, /collapsed: prefs\.effective\.todayCollapsed/);
});

test("People uses the workbench for the staff workspace; the old prompt is gone", () => {
  const src = read("components/org/OrgDashboard.tsx");
  assert.match(src, /data\?\.crmV2 \? \(\s*<CaseloadWorkbench/);
  assert.doesNotMatch(src, /window\.prompt/);
  const wb = read("components/org/CaseloadWorkbench.tsx");
  assert.match(wb, /\/api\/org\/views\?surface=caseload/);
  assert.match(wb, /\/api\/org\/fields\/values\?entity=participant/);
  assert.match(wb, /applyView\(rows, draft/);
});

test("new screens: no em dashes in copy, no label on a person, nothing hard-codes a vendor", () => {
  for (const f of ["components/org/CaseloadWorkbench.tsx", "components/org/CustomFieldsPanel.tsx", "components/org/FieldsSettingsPage.tsx", "components/org/LayoutSettingsPage.tsx"]) {
    const src = read(f);
    assert.doesNotMatch(src, /—/, `${f}: em dash`);
    assert.doesNotMatch(src, /\b(felon|offender|ex-con|inmate)s?\b/i, `${f}: a label on a person`);
  }
});

test("GET /api/org/views never writes; the one-time move is a POST the screen calls", () => {
  const src = read("app/api/org/views/route.ts");
  const get = src.slice(src.indexOf("export async function GET"), src.indexOf("export async function POST"));
  assert.doesNotMatch(get, /migrateLegacySavedViews|INSERT|UPDATE/);
  const post = src.slice(src.indexOf("export async function POST"));
  assert.match(post, /case "move_legacy": \{\n      if \(guard\.actor\.viaPlatformAdmin\) return NextResponse\.json\(\{ moved: 0 \}\);/);
  assert.match(read("components/org/CaseloadWorkbench.tsx"), /JSON\.stringify\(\{ action: "move_legacy" \}\)/);
  // Read-only view-as refuses every non-GET API call at the edge (middleware), so the move cannot run under it.
  assert.match(read("middleware.ts"), /!\["GET", "HEAD", "OPTIONS"\]\.includes\(req\.method\)/);
});

test("Fields page: a sensitive field's box is locked on, with the way out explained", () => {
  const src = read("components/org/FieldsSettingsPage.tsx");
  assert.match(src, /const locked = !!initial\?\.sensitive;/);
  assert.match(src, /disabled=\{!!forced \|\| locked\}/);
  assert.match(src, /SENSITIVE_LOCKED_EXPLANATION/);
});

test("earlier answers read as sentences, newest first as sent; nothing when there are none", () => {
  const defs = [def({ key: "housing", label: "Housing", type: "single_select", options: [{ id: "s", label: "Stable" }] })];
  const names = new Map([["u1", "Alma Reyes"], ["u2", "Rafa Ortiz"]]);
  const html = renderToStaticMarkup(React.createElement(EarlierAnswers, { defs, staffNames: names, earlier: [
    { key: "housing", value: "s", setBy: "u1", setAt: "2026-10-01T10:00:00Z", change: "changed", replacedBy: "u2", replacedAt: "2026-10-20T10:00:00Z" },
  ] }));
  assert.match(html, /Earlier answers \(1\)/);
  assert.match(html, /Housing<\/span> was <span class="text-t-white">Stable<\/span>, set by Alma Reyes on Oct 1, 2026\. Changed by Rafa Ortiz on Oct 20, 2026\./);
  assert.equal(renderToStaticMarkup(React.createElement(EarlierAnswers, { defs, staffNames: names, earlier: [] })), "");
  assert.match(read("app/api/org/fields/values/route.ts"), /const wantsHistory = sp\.get\("history"\) === "1" && canSeeFieldHistory\(actor\);/);
});
