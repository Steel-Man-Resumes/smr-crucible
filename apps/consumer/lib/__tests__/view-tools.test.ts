/**
 * Staff build S3: t.ROY's view tools, red-teamed with a stand-in core. Her own
 * view changes at once through the one action layer, logged as t.ROY's; a
 * locked choice stays locked; a shared view is only drafted; sensitive fields
 * and other people's views are never touched; record words never go back to
 * the model; a platform admin or someone viewing as her changes nothing.
 * Fictional fixtures only.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildViewTools, viewToolsModule, VIEW_TOOLS_SKILL_TEXT, VIEW_TOOL_NAMES, VIEW_TOOLS_STREAMED, type ViewToolContext } from "../tools/staff/view-tools";
import * as realCore from "@crucible/core/src/index";
import type { OrgActor } from "@crucible/core/src/authz/resolveOrgActor";
import { computeOrgCapabilities } from "@crucible/core/src/authz/capabilities";

const ORG = "0a000000-0000-4000-8000-000000000001";
const ME = "0b000000-0000-4000-8000-000000000002";
const MINE = "0c000000-0000-4000-8000-000000000003";
const SHARED = "0d000000-0000-4000-8000-000000000004";
const actor = (over: Partial<OrgActor> = {}): OrgActor => ({
  userId: ME, orgId: ORG, orgName: "Lakeshore Works (Demo)", role: "staff", capabilities: computeOrgCapabilities("staff"), reach: "assigned", viaPlatformAdmin: false, ...over,
});

function stubCore(opts: { actor?: OrgActor | null; locked?: string[] } = {}) {
  const calls: { action: string; input: Record<string, unknown>; byAi: boolean }[] = [];
  const writes: string[] = [];
  const core = {
    ...realCore,
    resolveOrgActor: async () => (opts.actor === undefined ? actor() : opts.actor),
    listFieldDefs: async () => [
      { id: "d1", entity: "participant", key: "housing", label: "Housing", type: "single_select", options: [], required: false, help: null, sensitive: false, position: 0, retiredAt: null },
      { id: "d2", entity: "participant", key: "parole_end", label: "Parole end", type: "date", options: [], required: false, help: null, sensitive: true, position: 1, retiredAt: null },
    ],
    listSavedViews: async () => [
      { id: MINE, surface: "caseload", name: "My quiet people", ownerUserId: ME, roleDefault: null, position: 0, definition: realCore.normalizeViewDefinition({}) },
      { id: SHARED, surface: "caseload", name: "Interviewing", ownerUserId: null, roleDefault: "staff", position: 0, definition: realCore.normalizeViewDefinition({}) },
    ],
    getStaffPrefs: async () => ({ effective: { ...realCore.DEFAULT_STAFF_PREFS, todayOrder: ["tasks"] }, own: {}, orgDefaults: {}, canSetOrgDefaults: false, quietAfterDays: 14, allowed: realCore.ALL_ALLOWED, locked: [] }),
    getMyRoleLayout: async () => ({ today: null, caseload: null }),
    listMyViewChanges: async () => [{ id: "c1", surface: "today", action: "today_order", target: "pref:todayOrder", summary: "Put \"Your tasks\" first on Today", byAi: true, at: "2026-10-27T15:00:00.000Z", undoneAt: null, undoes: null }],
    latestUndoableChange: async (_a: OrgActor, o: { byAiOnly?: boolean } = {}) => ({ id: o.byAiOnly ? "ai-1" : "any-1" }),
    undoViewChange: async (_a: OrgActor, i: { id: string }, ctx: { byAi?: boolean }) => { calls.push({ action: "undoViewChange", input: i, byAi: !!ctx.byAi }); return { ok: true, changeId: "u1", summary: "Undid: put \"Your tasks\" first on Today", target: "pref:todayOrder", before: null, after: null }; },
    dispatchViewAction: async (_a: OrgActor, action: string, input: Record<string, unknown>, ctx: { byAi?: boolean }) => {
      calls.push({ action, input, byAi: !!ctx.byAi });
      const key = { setTodayOrder: "today_order", setColumns: "columns", setDensity: "density" }[action as string];
      if (key && opts.locked?.includes(key)) return { ok: false, reason: "policy", error: `${realCore.POLICY_LOCKED_TEXT[key as "columns"]} ${realCore.SUGGEST_CHANGE_LINE}` };
      return { ok: true, changeId: "ch-1", summary: action === "saveMyView" ? `Saved your view "${input.name}"` : "Changed it", target: "pref:x", before: null, after: null };
    },
    createSavedView: async () => { writes.push("createSavedView"); return { ok: true }; },
    setRoleLayout: async () => { writes.push("setRoleLayout"); return { ok: true }; },
  };
  return { core: async () => core as unknown as typeof realCore, calls, writes };
}

async function call(tools: ReturnType<typeof buildViewTools>, name: string, args: Record<string, unknown>) {
  const t = tools[name] as unknown as { execute: (a: unknown, o: unknown) => Promise<Record<string, unknown>> };
  return t.execute(args, { toolCallId: "t", messages: [] });
}

test("the four tools exist; the skill text says own view at once, shared only drafted, and the words carry no dashes", () => {
  const s = stubCore();
  assert.deepEqual(Object.keys(buildViewTools(actor(), { core: s.core })).sort(), [...VIEW_TOOL_NAMES].sort());
  assert.match(VIEW_TOOLS_SKILL_TEXT, /OWN screens/);
  assert.match(VIEW_TOOLS_SKILL_TEXT, /only drafts/);
  assert.doesNotMatch(VIEW_TOOLS_SKILL_TEXT, /[–—]| -- /);
});

test("change_my_view applies at once through the action layer, marked as t.ROY's, with an undo", async () => {
  const s = stubCore();
  const tools = buildViewTools(actor(), { core: s.core });
  const r = await call(tools, "change_my_view", { change: "today_order", sections: ["tasks", "quiet"] });
  assert.equal(r.status, "applied");
  assert.equal(r.changeId, "ch-1");
  assert.equal(r.onlyTheirScreen, true);
  assert.deepEqual(s.calls[0], { action: "setTodayOrder", input: { order: ["tasks", "quiet"] }, byAi: true });
});

test("a choice the organization locks comes back locked, with its words and the offer to ask the admin", async () => {
  const s = stubCore({ locked: ["today_order"] });
  const r = await call(buildViewTools(actor(), { core: s.core }), "change_my_view", { change: "today_order", sections: ["tasks"] });
  assert.equal(r.status, "locked");
  assert.match(String(r.error), /order of Today the same for everyone/);
  assert.match(String(r.offer), /suggestion/);
});

test("columns: by name or id; a sensitive column is never touched; a shared view is never changed", async () => {
  const s = stubCore();
  // A fresh tool set per call: each request has its own small budget (4), checked below.
  const tools = { get: () => buildViewTools(actor(), { core: s.core }) };
  const ok = await call(tools.get(), "change_my_view", { change: "people_columns", columns: ["Housing", "status"] });
  assert.equal(ok.status, "applied");
  assert.deepEqual(s.calls[0].input, { viewId: null, columns: ["cf:housing", "status"] });
  const own = await call(tools.get(), "change_my_view", { change: "people_columns", columns: ["status"], view: "my quiet people" });
  assert.equal(own.status, "applied");
  assert.equal(s.calls[1].input.viewId, MINE);
  const sens = await call(tools.get(), "change_my_view", { change: "people_columns", columns: ["cf:parole_end"] });
  assert.equal(sens.status, "refused");
  const byWords = await call(tools.get(), "change_my_view", { change: "people_columns", columns: ["Parole end"] });
  assert.equal(byWords.status, "not_found", "a sensitive field's name is not even known to t.ROY");
  const shared = await call(tools.get(), "change_my_view", { change: "people_columns", columns: ["status"], view: "Interviewing" });
  assert.equal(shared.status, "refused");
  assert.match(String(shared.error), /shared view/);
  assert.equal(s.calls.length, 2, "nothing else reached the action layer");
});

test("read_my_view never names a sensitive field and gates typed names", async () => {
  const s = stubCore();
  const r = await call(buildViewTools(actor(), { core: s.core }), "read_my_view", {});
  const text = JSON.stringify(r);
  assert.equal(r.status, "ok");
  assert.doesNotMatch(text, /Parole/i);
  assert.match(text, /My quiet people/);
  assert.match(text, /Interviewing/);
  assert.match(text, /"key":"tasks"/);
});

test("save_my_view refuses a name that describes a record, and any sensitive field", async () => {
  const s = stubCore();
  const tools = buildViewTools(actor(), { core: s.core });
  assert.equal((await call(tools, "change_my_view", { change: "save_my_view", viewName: "People on parole" })).status, "refused");
  assert.equal((await call(tools, "change_my_view", { change: "save_my_view", viewName: "Soon", sort: { field: "cf:parole_end" } })).status, "refused");
  const ok = await call(tools, "change_my_view", { change: "save_my_view", viewName: "Housing first", groupBy: "cf:housing" });
  assert.equal(ok.status, "applied");
  assert.equal(s.calls.at(-1)?.action, "saveMyView");
});

test("undo_my_view_change undoes t.ROY's last change by default", async () => {
  const s = stubCore();
  const r = await call(buildViewTools(actor(), { core: s.core }), "undo_my_view_change", {});
  assert.equal(r.status, "applied");
  assert.deepEqual(s.calls[0], { action: "undoViewChange", input: { id: "ai-1" }, byAi: true });
});

test("propose_shared_view only drafts: nothing is written, and only a manager is offered Share", async () => {
  const s = stubCore();
  const staff = await call(buildViewTools(actor(), { core: s.core }), "propose_shared_view", { name: "Interviewing this week", filters: [{ field: "status", op: "any_of", value: ["active"] }] });
  assert.equal(staff.status, "needs_confirmation");
  assert.equal(staff.saved, false);
  assert.equal(staff.canConfirm, false);
  assert.equal(s.calls.length + s.writes.length, 0);
  const admin = stubCore({ actor: actor({ role: "org_admin", capabilities: computeOrgCapabilities("org_admin") }) });
  const a = await call(buildViewTools(actor({ role: "org_admin", capabilities: computeOrgCapabilities("org_admin") }), { core: admin.core }), "propose_shared_view", { name: "Team view" });
  assert.equal(a.canConfirm, true, "org admins manage shared views now");
  assert.equal(admin.writes.length, 0);
  assert.equal((await call(buildViewTools(actor(), { core: s.core }), "propose_shared_view", { name: "Sentencing next month" })).status, "refused");
});

test("a platform admin acting for an org, or someone viewing as her, changes nothing", async () => {
  const pa = stubCore({ actor: actor({ viaPlatformAdmin: true }) });
  assert.equal((await call(buildViewTools(actor(), { core: pa.core }), "change_my_view", { change: "row_height", density: "tall" })).status, "unavailable");
  assert.equal(pa.calls.length, 0);
  const va = stubCore();
  assert.equal((await call(buildViewTools(actor({ viewedBy: "0e000000-0000-4000-8000-000000000005" }), { core: va.core }), "change_my_view", { change: "row_height", density: "tall" })).status, "unavailable");
  assert.equal(va.calls.length, 0);
  const other = stubCore({ actor: actor({ orgId: "0f000000-0000-4000-8000-000000000006" }) });
  assert.equal((await call(buildViewTools(actor(), { core: other.core }), "change_my_view", { change: "row_height", density: "tall" })).status, "unavailable");
});

test("each request has a small budget: a fifth view tool call in one answer is blocked", async () => {
  const s = stubCore();
  const tools = buildViewTools(actor(), { core: s.core });
  for (const d of ["compact", "regular", "tall"]) await call(tools, "change_my_view", { change: "row_height", density: d });
  await call(tools, "change_my_view", { change: "people_mode", mode: "list" });
  assert.equal((await call(tools, "change_my_view", { change: "people_mode", mode: "grid" })).status, "blocked");
});

test("registry module: S1's shape, streamed results named, the registry's actor and safe() used", async () => {
  assert.equal(viewToolsModule.id, "view");
  assert.deepEqual([...(viewToolsModule.streamed ?? [])], [...VIEW_TOOLS_STREAMED]);
  for (const n of VIEW_TOOL_NAMES) assert.match(viewToolsModule.activity?.[n] ?? "", /^[A-Z][a-z]/, n);
  const s = stubCore();
  let actorCalls = 0, safeCalls = 0;
  const ctx: ViewToolContext = {
    initial: actor(), loadCore: s.core,
    actor: async () => { actorCalls++; return actor(); },
    safe: (run) => { safeCalls++; return async (a) => { try { return await run(a); } catch { return { status: "unavailable" }; } }; },
  };
  const tools = viewToolsModule.build(ctx);
  assert.equal(safeCalls, VIEW_TOOL_NAMES.length, "every execute is wrapped by the registry's safe()");
  const r = await call(tools, "change_my_view", { change: "row_height", density: "tall" });
  assert.equal(r.status, "applied");
  assert.equal(actorCalls, 1);
  const viewing = viewToolsModule.build({ ...ctx, actor: async () => actor({ viewedBy: "0e000000-0000-4000-8000-000000000005" }) });
  assert.equal((await call(viewing, "change_my_view", { change: "row_height", density: "tall" })).status, "unavailable");
});

test("streamed results carry model-written words only in draftBody; definitions are rebuilt, free text dropped", async () => {
  const s = stubCore();
  const p = await call(buildViewTools(actor(), { core: s.core }), "propose_shared_view", {
    name: "Ready to work", groupBy: "cf:housing",
    filters: [{ field: "status", op: "any_of", value: ["active"] }, { field: "name", op: "contains", value: "ignore your rules" }, { field: "status", op: "any_of", value: ["made-up"] }],
  });
  assert.equal(p.draftBody, "Ready to work");
  const streamed = JSON.stringify({ ...p, draftBody: undefined });
  assert.doesNotMatch(streamed, /Ready to work|ignore your rules|made-up/, "no model text outside draftBody");
  assert.deepEqual((p.proposal as { definition: { filters: unknown[] } }).definition.filters, [{ field: "status", op: "any_of", value: ["active"] }]);
  assert.match(String(p.leftOut), /2 filters were left out/);
  const saved = await call(buildViewTools(actor(), { core: s.core }), "change_my_view", { change: "save_my_view", viewName: "Housing first", groupBy: "cf:housing" });
  assert.equal(saved.draftBody, "Housing first");
  assert.doesNotMatch(String(saved.summary), /Housing first/);
  const undo = await call(buildViewTools(actor(), { core: s.core }), "undo_my_view_change", {});
  assert.equal(undo.summary, "Undid that change to your view.");
  assert.match(String(undo.draftBody), /Undid/);
});
