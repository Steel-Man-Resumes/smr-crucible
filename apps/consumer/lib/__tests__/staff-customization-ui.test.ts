/**
 * Staff build S3, the screens and routes: personal Today order, "What staff
 * can change for themselves" on Layouts, "Recent changes to my view" with
 * Undo, t.ROY's view cards, the grid mode on People, and the capability on
 * every new route. Fictional fixtures only.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { TodayView, ArrangeToday } from "../../components/org/TodayPage";
import { CustomizationPolicyPanel } from "../../components/org/LayoutSettingsPage";
import { RecentViewChanges } from "../../components/org/MyViewSettings";
import { SharedViewProposalCard, ViewChangeDoneCard, viewToolCards } from "../../components/org/TroyViewCards";
import type { TodayPayload } from "../today-view";
import { POLICY_KEYS, POLICY_KEY_TEXT, POLICY_ROLES, POLICY_SURFACES, ALL_ALLOWED } from "@crucible/core/src/customizationPolicyShared";

(globalThis as { React?: unknown }).React = React;
const CONSUMER = join(import.meta.dirname, "..", "..");
const read = (p: string) => readFileSync(join(CONSUMER, p), "utf8");
const NOW = new Date(2026, 9, 29, 9, 0, 0).getTime();

const DAY: TodayPayload = {
  sections: [{ key: "quiet", label: "Gone quiet" }, { key: "tasks", label: "Your tasks" }],
  hidden: [], collapsed: [], canAddTasks: false, reach: null, volunteer: false,
  items: [
    { key: "q:p2", section: "quiet", clientId: "p2", clientName: "Sam Cole", when: null, stage: 2, reason: "Sam was last active 33 days ago.", action: { label: "Check in", href: "/dashboard/clients/p2" } },
    { key: "task:t1", section: "tasks", clientId: null, clientName: null, taskId: "t1", when: null, reason: "Order intake folders", action: { label: "Mark done", href: "#" } },
  ],
};

test("Today: a person's own order comes first, then the role's; the role's order without one", () => {
  const mine = renderToStaticMarkup(React.createElement(TodayView, { state: { status: "ready", data: DAY }, nowMs: NOW, troyReady: false, tourReady: false, personalOrder: ["tasks"] }));
  assert.ok(mine.indexOf("Order intake folders") < mine.indexOf("Sam was last active"));
  const role = renderToStaticMarkup(React.createElement(TodayView, { state: { status: "ready", data: DAY }, nowMs: NOW, troyReady: false, tourReady: false }));
  assert.ok(role.indexOf("Sam was last active") < role.indexOf("Order intake folders"));
});

test("Today: 'Arrange my Today' only when the person may arrange it (never under view-as)", () => {
  const can = renderToStaticMarkup(React.createElement(TodayView, { state: { status: "ready", data: DAY }, nowMs: NOW, troyReady: false, tourReady: false, onArrange: async () => {} }));
  assert.match(can, /Arrange my Today/);
  const cannot = renderToStaticMarkup(React.createElement(TodayView, { state: { status: "ready", data: DAY }, nowMs: NOW, troyReady: false, tourReady: false }));
  assert.doesNotMatch(cannot, /Arrange my Today/);
});

test("Arrange my Today: locked parts say so in the organization's words", () => {
  const html = renderToStaticMarkup(React.createElement(ArrangeToday, { sections: DAY.sections, hidden: [], canOrder: false, canHide: true, onSave: async () => {}, onCancel: () => {} }));
  assert.match(html, /keeps the order of Today the same for everyone/);
  assert.doesNotMatch(html, /Move Gone quiet up/);
  assert.match(html, /Only your own Today changes/);
});

const POLICY = {
  policies: { staff: { ...ALL_ALLOWED, grid_edit: false }, org_admin: ALL_ALLOWED } as Record<string, Record<string, boolean>>,
  roles: POLICY_ROLES.map((r) => ({ key: r, label: r === "staff" ? "Staff" : "Admins" })),
  surfaces: POLICY_SURFACES.map((s) => ({ key: s, label: s, switches: POLICY_KEYS[s].map((k) => ({ key: k, ...POLICY_KEY_TEXT[k] })) })),
  canManage: true,
};

test("Layouts: 'What staff can change for themselves' lists every switch, with the organization's state", () => {
  const html = renderToStaticMarkup(React.createElement(CustomizationPolicyPanel, { initial: POLICY }));
  assert.match(html, /What staff can change for themselves/);
  for (const s of POLICY_SURFACES) for (const k of POLICY_KEYS[s]) assert.ok(html.includes(POLICY_KEY_TEXT[k].label.replace(/'/g, "&#x27;")), k);
  assert.match(html, /Fill in your fields from the grid<\/span>/);
  assert.match(html, /Allow everything again/, "a screen with something off offers to allow it all again");
  const ro = renderToStaticMarkup(React.createElement(CustomizationPolicyPanel, { initial: { ...POLICY, canManage: false } }));
  assert.match(ro, /Only someone who manages your organization&#x27;s settings can change these/);
  assert.match(ro, /disabled=""/);
});

test("Recent changes to my view: newest first, t.ROY's marked, Undo only where it can still undo", () => {
  const html = renderToStaticMarkup(React.createElement(RecentViewChanges, { initial: [
    { id: "c3", surface: "people", action: "density", summary: "Tall rows on People", byAi: true, at: "2026-10-27T16:00:00.000Z", undoneAt: null },
    { id: "c2", surface: "today", action: "undo", summary: "Undid: folded \"Gone quiet\" on Today", byAi: false, at: "2026-10-27T15:00:00.000Z", undoneAt: null },
    { id: "c1", surface: "today", action: "today_fold", summary: "Folded \"Gone quiet\" on Today", byAi: false, at: "2026-10-27T14:00:00.000Z", undoneAt: "2026-10-27T15:00:00.000Z" },
  ] }));
  assert.equal((html.match(/>Undo</g) ?? []).length, 1);
  assert.match(html, />t\.ROY</);
  assert.match(html, /line-through/);
  assert.match(html, /Nobody else sees this list/);
  assert.match(renderToStaticMarkup(React.createElement(RecentViewChanges, { initial: [] })), /Nothing yet/);
});

test("t.ROY cards: a done change says only your screen changed and offers Undo; a shared view only drafts", () => {
  const done = renderToStaticMarkup(React.createElement(ViewChangeDoneCard, { result: { status: "applied", changeId: "c1", summary: "Put \"Your tasks\" first on Today" } }));
  assert.match(done, /Done: Put &quot;Your tasks&quot; first on Today\. Only your screen changed\./);
  assert.match(done, />Undo</);
  assert.equal(renderToStaticMarkup(React.createElement(ViewChangeDoneCard, { result: { status: "locked", error: "x" } })), "");
  const staff = renderToStaticMarkup(React.createElement(SharedViewProposalCard, { result: { status: "needs_confirmation", draftBody: "Interviewing", proposal: { definition: {}, roleDefault: null }, canConfirm: false, note: "Nothing is saved." } }));
  assert.doesNotMatch(staff, /Share with everyone/);
  assert.match(staff, /Save as my own view/);
  const mgr = renderToStaticMarkup(React.createElement(SharedViewProposalCard, { result: { status: "needs_confirmation", draftBody: "Interviewing", proposal: { definition: {}, roleDefault: "staff" }, canConfirm: true } }));
  assert.match(mgr, /Share with everyone/);
  // Held back by the route's claim check (no draftBody): no card, nothing to save.
  assert.equal(renderToStaticMarkup(React.createElement(SharedViewProposalCard, { result: { status: "needs_confirmation", proposal: { definition: {}, roleDefault: null }, canConfirm: true } })), "");
  const cards = viewToolCards([
    { toolName: "change_my_view", state: "result", result: { status: "applied", changeId: "x", summary: "y" } },
    { toolName: "change_my_view", state: "result", result: { status: "locked" } },
    { toolName: "propose_shared_view", state: "result", result: { status: "needs_confirmation", draftBody: "n", proposal: { definition: {}, roleDefault: null } } },
    { toolName: "read_staff_tasks", state: "result", result: { status: "ok" } },
  ]);
  assert.deepEqual(cards.map((c) => c.key), [0, 2]);
});

test("routes: every new door checks the right capability, and writes refuse view-as through the guard", () => {
  const cases: [string, string, string][] = [
    ["app/api/org/prefs/view/route.ts", "POST", "org.cohort.view"],
    ["app/api/org/prefs/changes/route.ts", "GET", "org.cohort.view"],
    ["app/api/org/prefs/changes/route.ts", "POST", "org.cohort.view"],
    ["app/api/org/layouts/policy/route.ts", "GET", "org.cohort.view"],
    ["app/api/org/layouts/policy/route.ts", "PUT", "org.settings.manage"],
  ];
  for (const [file, method, cap] of cases) {
    const src = read(file);
    const body = src.slice(src.indexOf(`export async function ${method}(`));
    assert.match(body.slice(0, 300), new RegExp(`requireOrgCapability\\("${cap.replace(/\./g, "\\.")}", \\{ request \\}\\)`), `${file} ${method}`);
  }
  const view = read("app/api/org/prefs/view/route.ts");
  assert.match(view, /VIEW_ACTIONS as readonly string\[\]\)\.includes\(action\)/);
  // Final review should-fix 2: same-origin first, then JSON only (415), on every view write.
  for (const f of ["app/api/org/prefs/view/route.ts", "app/api/org/prefs/changes/route.ts", "app/api/org/views/route.ts"]) {
    const post = read(f).slice(read(f).indexOf("export async function POST("));
    assert.ok(post.indexOf("refuseCrossOrigin(request)") > -1 && post.indexOf("refuseCrossOrigin(request)") < post.indexOf("requireOrgCapability("), `${f}: same-origin first`);
    assert.match(post, /const body = await readJsonStrict\(request\);\s*if \(!body\) return NextResponse\.json\(\{ error: NOT_JSON \}, \{ status: 415 \}\);/, `${f}: JSON only`);
  }
  assert.match(view, /\{ byAi: false \}/);
  const values = read("app/api/org/fields/values/route.ts");
  assert.match(values, /setFieldValuesBatch\(guard\.actor, body\.batch, \{ fromGrid, gridAllowed: allowed\?\.grid_edit \?\? true \}\)/);
  assert.match(values, /requireOrgCapability\("org\.note\.write", \{ request \}\)/);
});

test("People: a Grid mode beside the list, the list on a phone, edits only where the person may write", () => {
  const wb = read("components/org/CaseloadWorkbench.tsx");
  assert.match(wb, /role="radiogroup" aria-label="Show People as"/);
  assert.match(wb, /The grid needs a wider screen\. Here is the list/);
  assert.match(wb, /matchMedia\("\(min-width: 768px\)"\)/);
  assert.match(wb, /canEdit=\{!readOnly && !!meta\?\.canEditValues\}/);
  assert.match(read("app/api/org/views/route.ts"), /canEditValues: canWriteFieldValues\(actor\) && prefs\.allowed\.grid_edit/);
});

test("words: no em or en dashes in the new screens and tools", () => {
  for (const f of ["components/org/PeopleGrid.tsx", "components/org/MyViewSettings.tsx", "components/org/TroyViewCards.tsx", "lib/people-grid.ts", "lib/tools/staff/view-tools.ts", "components/org/LayoutSettingsPage.tsx"]) {
    assert.doesNotMatch(read(f), /[–—]/, f);
  }
});

test("review round 1: the logo stays the owner's; the AI switch is the owner's in the wizard", () => {
  const brand = read("app/api/org/brand/route.ts");
  assert.match(brand, /const isLogoOwner = \(a: \{ role: string; viaPlatformAdmin: boolean \}\) => a\.role === "owner" && !a\.viaPlatformAdmin;/);
  assert.equal((brand.match(/if \(!isLogoOwner\(guard\.actor\)\) return NextResponse\.json\(\{ error: OWNER_ONLY \}, \{ status: 403 \}\);/g) ?? []).length, 2, "POST and DELETE");
  assert.match(brand, /canManage: isLogoOwner\(actor\)/);
  const wiz = read("components/org/OrgSetupWizard.tsx");
  assert.match(wiz, /disabled=\{m === "ai_assist" && !isOwner\}/);
  assert.match(wiz, /because AI cost is the owner&apos;s/);
});

test("review round 1: a copied sensitive answer stays hidden even after Show", () => {
  assert.match(read("components/org/PeopleGrid.tsx"), /if \(isMasked\(col\) \|\| \(forCopy && isSensitiveField\(def\)\)\) return isEmpty\(v\) \? "" : MASK;/);
  assert.match(read("components/org/PeopleGrid.tsx"), /row\.push\(textOf\(line\.rowId, gridCols\[c\], true\)\)/);
});
