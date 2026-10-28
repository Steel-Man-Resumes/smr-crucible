/**
 * Staff build S3: customization within limits. The policy (108), the grid
 * look, the new personal prefs, the typed view action planners and the undo
 * planner, all pure; plus source checks on the database halves. Fictional
 * fixtures only.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  ALL_ALLOWED, ALL_POLICY_KEYS, POLICY_KEYS, POLICY_LOCKED_TEXT, POLICY_SURFACES, lockedChanges, lockedKeys, lockedMessage, normalizeAllowed,
  prefsUnderPolicy, resolveAllPolicies, resolvePolicy, surfaceOfKey, type PolicyAllowed,
} from "../customizationPolicyShared";
import {
  DEFAULT_STAFF_PREFS, PERSON_TAB_KEYS, normalizeStaffPrefs, orderPersonTabs, orderTodaySections, resolveStaffPrefs, staffRewardsOn, staffSuggestionsOn,
} from "../staffPrefsShared";
import {
  EMPTY_GRID_LAYOUT, MAX_COLUMN_WIDTH, MIN_COLUMN_WIDTH, isLayoutColumnId, layoutKeyFor, mergeGridLayouts, normalizeGridLayout, normalizeViewLayouts,
} from "../viewLayoutShared";
import { defaultCaseloadColumns, initialViewId, isViewFieldId, normalizeViewDefinition, sameArrangement } from "../savedViewsShared";
import {
  columnChangeWords, gridChangeWords, planDefaultColumns, planDefaultView, planDensity, planFold, planGridLayout, planHide, planPeopleMode,
  planPersonTabs, planTodayOrder, planUndo,
} from "../viewActionsShared";

const SRC = join(import.meta.dirname, "..");
const read = (f: string) => readFileSync(join(SRC, f), "utf8");
const V1 = "11111111-2222-4333-8444-555555555555";
const off = (...keys: (keyof PolicyAllowed)[]): PolicyAllowed => ({ ...ALL_ALLOWED, ...Object.fromEntries(keys.map((k) => [k, false])) });
const label = (id: string) => ({ stage: "Station", status: "Status", "cf:housing": "Housing" } as Record<string, string>)[id] ?? id;

describe("customization policy (108)", () => {
  it("everything is allowed until a manager turns it off; the owner is never limited", () => {
    assert.deepEqual(resolvePolicy("staff", []), ALL_ALLOWED);
    const rows = [{ role: "staff", surface: "today", allowed: { today_order: false } }, { role: "org_admin", surface: "people", allowed: { grid_edit: false } }];
    assert.equal(resolvePolicy("staff", rows).today_order, false);
    assert.equal(resolvePolicy("staff", rows).grid_edit, true, "another role's row never applies");
    assert.equal(resolvePolicy("org_admin", rows).grid_edit, false);
    assert.deepEqual(resolvePolicy("owner", rows), ALL_ALLOWED);
    assert.equal(resolveAllPolicies(rows).staff.today_order, false);
  });
  it("a stored row is cleaned: only its own screen's keys, only yes or no", () => {
    assert.deepEqual(normalizeAllowed("today", { today_order: false, grid_edit: false, today_fold: "no", extra: true }), { today_order: false });
    assert.deepEqual(normalizeAllowed("people", null), {});
    // A key on the wrong screen's row is ignored at resolve time too.
    assert.equal(resolvePolicy("staff", [{ role: "staff", surface: "today", allowed: { grid_edit: false } }]).grid_edit, true);
  });
  it("every key belongs to exactly one screen and has a locked sentence and a label", () => {
    const seen = new Set<string>();
    for (const s of POLICY_SURFACES) for (const k of POLICY_KEYS[s]) { assert.ok(!seen.has(k), k); seen.add(k); assert.equal(surfaceOfKey(k), s); }
    for (const k of ALL_POLICY_KEYS) assert.match(POLICY_LOCKED_TEXT[k], /^Your organization /);
    assert.deepEqual(lockedKeys(off("columns", "density")), ["columns", "density"]);
  });
  it("READ: a locked choice is left out (falls back to the org default) but not deleted", () => {
    const own = normalizeStaffPrefs({ todayOrder: ["quiet"], todayCollapsed: ["tasks"], density: "tall", caseloadColumns: ["status"] });
    const p = prefsUnderPolicy(own, off("today_order", "density"));
    assert.equal(p.todayOrder, undefined);
    assert.equal(p.density, undefined);
    assert.deepEqual(p.todayCollapsed, ["tasks"]);
    assert.deepEqual(own.todayOrder, ["quiet"], "the stored value is untouched");
    const eff = resolveStaffPrefs({ density: "compact" }, own, off("density"));
    assert.equal(eff.density, "compact", "the organization's default wins when the person's own choice is locked");
    assert.equal(resolveStaffPrefs({}, own).density, "tall", "and the person's choice comes back when the switch opens");
  });
  it("READ: row height inside a stored grid look follows the density switch", () => {
    const own = normalizeStaffPrefs({ viewLayouts: { default: { widths: { status: 200 }, rowHeight: "tall" } } });
    const p = prefsUnderPolicy(own, off("density"));
    assert.equal(p.viewLayouts?.default.rowHeight, null);
    assert.equal(p.viewLayouts?.default.widths.status, 200);
  });
  it("WRITE: only a CHANGE to a locked choice is refused; a full save that leaves it alone passes", () => {
    const before = normalizeStaffPrefs({ todayOrder: ["quiet"], noteKind: "call" });
    assert.deepEqual(lockedChanges(before, { ...before, noteKind: "meeting" }, off("today_order")), []);
    assert.deepEqual(lockedChanges(before, { ...before, todayOrder: ["tasks"] }, off("today_order")), ["today_order"]);
    assert.deepEqual(lockedChanges(before, { noteKind: "call" }, off("today_order")), ["today_order"], "clearing a locked choice is a change too");
    assert.match(lockedMessage(["today_order"]), /order of Today the same for everyone\. If it should change, ask whoever manages/);
    assert.equal(lockedMessage([]), "");
  });
});

describe("grid look", () => {
  it("normalizes widths, frozen, row height and summaries; drops the unknown", () => {
    const l = normalizeGridLayout({ widths: { status: 9999, "cf:housing": 10, bogus: 100, name: 240 }, frozen: 9, rowHeight: "huge", summaries: { applications: "sum", status: "nope", stage: "none" } });
    assert.deepEqual(l.widths, { status: MAX_COLUMN_WIDTH, "cf:housing": MIN_COLUMN_WIDTH, name: 240 });
    assert.equal(l.frozen, 3);
    assert.equal(l.rowHeight, null);
    assert.deepEqual(l.summaries, { applications: "sum" });
    assert.deepEqual(normalizeGridLayout("x"), EMPTY_GRID_LAYOUT);
  });
  it("a person's own look wins over the view's, key by key", () => {
    const m = mergeGridLayouts(normalizeGridLayout({ widths: { a: 1, status: 100 }, summaries: { applications: "sum" }, rowHeight: "tall" }), normalizeGridLayout({ widths: { status: 300 }, frozen: 2 }));
    assert.equal(m.widths.status, 300);
    assert.equal(m.summaries.applications, "sum");
    assert.equal(m.rowHeight, "tall");
    assert.equal(m.frozen, 2);
  });
  it("layouts are kept per view id or 'default', and empty ones are not stored", () => {
    assert.equal(layoutKeyFor(null), "default");
    assert.equal(layoutKeyFor(V1.toUpperCase()), V1);
    assert.deepEqual(Object.keys(normalizeViewLayouts({ default: { frozen: 2 }, [V1]: {}, "not-an-id": { frozen: 2 } })), ["default"]);
  });
  it("the layout column rule is the views' column rule", () => {
    for (const id of ["name", "stage", "nextStep", "applications", "lastActive", "staff", "status", "joined", "cf:housing", "cf:x", "cf:Housing", "cf:", "evil", "cf:a_b_9"]) {
      assert.equal(isLayoutColumnId(id), isViewFieldId(id), id);
    }
  });
});

describe("personal prefs (S3)", () => {
  it("normalizes the new choices", () => {
    const p = normalizeStaffPrefs({
      todayOrder: ["quiet", "nope", "quiet", "tasks"], caseloadColumns: ["name", "status", "cf:housing", "<x>"], defaultView: V1.toUpperCase(),
      density: "tall", personTabs: ["timeline", "notes", "bogus"], peopleMode: "grid", troySuggestions: false, rewardsOn: true,
    });
    assert.deepEqual(p.todayOrder, ["quiet", "tasks"]);
    assert.deepEqual(p.caseloadColumns, ["status", "cf:housing"]);
    assert.equal(p.defaultView, V1);
    assert.equal(p.density, "tall");
    assert.deepEqual(p.personTabs, ["timeline", "notes"]);
    assert.equal(p.peopleMode, "grid");
    assert.equal(normalizeStaffPrefs({ defaultView: "none" }).defaultView, "none");
    assert.equal(normalizeStaffPrefs({ defaultView: "'; drop" }).defaultView, undefined);
  });
  it("suggestions default on, rewards default off (Troy 2026-10-27)", () => {
    assert.equal(staffSuggestionsOn(DEFAULT_STAFF_PREFS), true);
    assert.equal(staffSuggestionsOn({ troySuggestions: false }), false);
    assert.equal(staffRewardsOn(DEFAULT_STAFF_PREFS), false);
    assert.equal(staffRewardsOn({ rewardsOn: true }), true);
    assert.equal(staffSuggestionsOn(null), true);
  });
  it("own order first, then the rest in the role's order; a new section never vanishes", () => {
    const secs = [{ key: "tasks" }, { key: "quiet" }, { key: "retention" }];
    assert.deepEqual(orderTodaySections(secs, ["retention", "gone"]).map((s) => s.key), ["retention", "tasks", "quiet"]);
    assert.deepEqual(orderTodaySections(secs, []).map((s) => s.key), ["tasks", "quiet", "retention"]);
    const tabs = PERSON_TAB_KEYS.map((key) => ({ key }));
    assert.deepEqual(orderPersonTabs(tabs, ["timeline"]).map((t) => t.key).slice(0, 2), ["timeline", "notes"]);
  });
  it("the person tab list matches the person page's tabs", () => {
    const page = readFileSync(join(SRC, "..", "..", "..", "apps", "consumer", "lib", "org-person-view.ts"), "utf8");
    const keys = Array.from(page.slice(page.indexOf("PERSON_TABS")).matchAll(/key: "([a-z]+)"/g)).map((m) => m[1]).slice(0, PERSON_TAB_KEYS.length);
    assert.deepEqual(keys, [...PERSON_TAB_KEYS]);
  });
  it("a person's own columns win over the role's; the view picked as default opens first, then the URL rule", () => {
    assert.deepEqual(defaultCaseloadColumns({ columns: ["stage", "status"] }, [], ["cf:housing", "name"]), ["cf:housing"]);
    assert.deepEqual(defaultCaseloadColumns({ columns: ["stage", "status"] }, ["stage"], null), ["status"]);
    const views = [{ id: V1, ownerUserId: null, roleDefault: "staff", position: 0 }, { id: "v2", ownerUserId: "me", roleDefault: null, position: 0 }];
    assert.equal(initialViewId(views, "staff", null, "v2"), "v2");
    assert.equal(initialViewId(views, "staff", "v2", "none"), null);
    assert.equal(initialViewId(views, "staff", null, "gone"), V1, "a default that no longer exists falls back to the role's");
  });
  it("a view's grid look rides along but never makes the view 'changed'", () => {
    const a = normalizeViewDefinition({ filters: [{ field: "status", op: "any_of", value: ["active"] }], grid: { widths: { status: 200 } } });
    const b = normalizeViewDefinition({ filters: [{ field: "status", op: "any_of", value: ["active"] }] });
    assert.equal(a.grid?.widths.status, 200);
    assert.equal(sameArrangement(a, b), true);
    assert.equal(sameArrangement(a, { ...b, groupBy: "status" }), false);
  });
});

describe("view action planners", () => {
  it("Today order: cleaned, logged with before/after, refused when locked", () => {
    const p = planTodayOrder({}, ["tasks", "x", "quiet"], ALL_ALLOWED);
    assert.ok(p.ok);
    if (p.ok) {
      assert.deepEqual(p.nextOwn.todayOrder, ["tasks", "quiet"]);
      assert.equal(p.change.target, "pref:todayOrder");
      assert.equal(p.change.before, null);
      assert.deepEqual(p.change.after, ["tasks", "quiet"]);
      assert.equal(p.change.summary, 'Put "Your tasks" first on Today');
    }
    const l = planTodayOrder({}, ["tasks"], off("today_order"));
    assert.equal(l.ok, false);
    if (!l.ok) { assert.equal(l.reason, "policy"); assert.match(l.error, /order of Today/); }
    const back = planTodayOrder({ todayOrder: ["tasks"] }, [], ALL_ALLOWED);
    assert.ok(back.ok && back.nextOwn.todayOrder === undefined && back.change.summary === "Put Today back in your organization's order");
    assert.equal(planTodayOrder({}, ["nope"], ALL_ALLOWED).ok, false);
    const same = planTodayOrder({ todayOrder: ["tasks"] }, ["tasks"], ALL_ALLOWED);
    assert.ok(!same.ok && same.reason === "unchanged");
  });
  it("fold and hide, each under its own switch", () => {
    const f = planFold({ todayCollapsed: ["quiet"] }, "tasks", true, ALL_ALLOWED);
    assert.ok(f.ok && JSON.stringify(f.nextOwn.todayCollapsed) === JSON.stringify(["quiet", "tasks"]));
    const u = planFold({ todayCollapsed: ["quiet"] }, "quiet", false, ALL_ALLOWED);
    assert.ok(u.ok && u.change.summary === 'Opened "Gone quiet" on Today');
    assert.equal(planFold({}, "tasks", true, off("today_fold")).ok, false);
    assert.equal(planHide({}, "tasks", true, off("today_hide")).ok, false);
    assert.equal(planHide({}, "tasks", true, off("today_fold")).ok, true);
    assert.equal(planFold({}, "<script>", true, ALL_ALLOWED).ok, false);
  });
  it("People columns, density, mode and default view", () => {
    const c = planDefaultColumns({}, ["status", "cf:housing", "name", "nope"], ALL_ALLOWED, ["stage", "status"], label);
    assert.ok(c.ok);
    if (c.ok) { assert.deepEqual(c.nextOwn.caseloadColumns, ["status", "cf:housing"]); assert.equal(c.change.summary, "Showed Housing and hid Station on People"); }
    assert.equal(planDefaultColumns({}, ["status"], off("columns"), [], label).ok, false);
    const reset = planDefaultColumns({ caseloadColumns: ["status"] }, null, ALL_ALLOWED, ["status"], label);
    assert.ok(reset.ok && reset.nextOwn.caseloadColumns === undefined);
    assert.equal(planDensity({}, "tall", off("density")).ok, false);
    assert.equal(planDensity({}, "huge", ALL_ALLOWED).ok, false);
    assert.ok(planDensity({}, "compact", ALL_ALLOWED).ok);
    assert.ok(planPeopleMode({}, "grid", off(...ALL_POLICY_KEYS)).ok, "list or grid is always the person's own");
    const d = planDefaultView({}, V1, ALL_ALLOWED, "My quiet people");
    assert.ok(d.ok && d.change.summary === 'People now opens with "My quiet people"');
    assert.equal(planDefaultView({}, V1, off("default_view"), "x").ok, false);
  });
  it("column words read like a person wrote them", () => {
    assert.equal(columnChangeWords(["a"], ["a", "b"], (x) => x.toUpperCase()), "Showed B");
    assert.equal(columnChangeWords(["a", "b"], ["b", "a"], (x) => x), "Moved columns around");
    assert.equal(columnChangeWords([], ["a", "b", "c", "d"], (x) => x), "Showed a, b and 2 more");
  });
  it("grid look: own copy per view, clamped, logged with words; switches respected", () => {
    const g = planGridLayout({}, V1, { widths: { status: 5000 }, summaries: { applications: "sum" } }, ALL_ALLOWED, normalizeGridLayout({ frozen: 2 }), label);
    assert.ok(g.ok);
    if (g.ok) {
      const l = g.nextOwn.viewLayouts![V1];
      assert.equal(l.widths.status, MAX_COLUMN_WIDTH);
      assert.equal(l.frozen, 2, "starts from the view's own look");
      assert.equal(g.change.target, `layout:${V1}`);
      assert.equal(g.change.before, null);
    }
    assert.equal(planGridLayout({}, null, { widths: { status: 200 } }, off("column_width"), null, label).ok, false);
    assert.equal(planGridLayout({}, null, { rowHeight: "tall" }, off("density"), null, label).ok, false);
    assert.equal(planGridLayout({}, null, { frozen: 7 }, ALL_ALLOWED, null, label).ok, false);
    assert.equal(planGridLayout({}, null, { widths: { "drop table": 1 } }, ALL_ALLOWED, null, label).ok, false);
    const back = planGridLayout({ viewLayouts: { default: normalizeGridLayout({ frozen: 2 }) } }, null, { frozen: 1 }, ALL_ALLOWED, null, label);
    assert.ok(back.ok && back.nextOwn.viewLayouts!.default === undefined && back.change.after === null, "back to plain is stored as nothing");
    assert.equal(gridChangeWords(normalizeGridLayout({}), normalizeGridLayout({ frozen: 2 }), label), "Froze the first 2 columns");
    assert.equal(gridChangeWords(normalizeGridLayout({}), normalizeGridLayout({ widths: { status: 300 } }), label), "Widened Status");
    assert.equal(gridChangeWords(normalizeGridLayout({}), normalizeGridLayout({ summaries: { "cf:housing": "per_option" } }), label), 'Showed "Count of each" under Housing');
  });
  it("person tab order", () => {
    const p = planPersonTabs({}, ["timeline", "x"], ALL_ALLOWED);
    assert.ok(p.ok && p.change.summary === 'Put "Timeline" first on a person\'s page');
    assert.equal(planPersonTabs({}, ["timeline"], off("person_tabs_order")).ok, false);
  });
  it("undo puts the target back to how it was just before; never twice; never a server-owned key", () => {
    const u = planUndo({ id: "c1", target: "pref:todayOrder", summary: "Put \"Your tasks\" first on Today", before: null, after: ["tasks"], undoneAt: null, action: "today_order" });
    assert.ok(u.ok && u.kind === "pref" && u.key === "todayOrder" && u.value === null);
    if (u.ok) assert.equal(u.summary, 'Undid: put "Your tasks" first on Today');
    assert.equal(planUndo({ id: "c1", target: "pref:todayOrder", summary: "x", before: null, after: null, undoneAt: "2026-10-27", action: "x" }).ok, false);
    assert.equal(planUndo({ id: "c1", target: "pref:viewsMovedTo", summary: "x", before: [], after: [], undoneAt: null, action: "x" }).ok, false);
    const lay = planUndo({ id: "c2", target: "layout:default", summary: "Froze", before: { frozen: 2 }, after: null, undoneAt: null, action: "grid_layout" });
    assert.ok(lay.ok && lay.kind === "layout" && lay.value?.frozen === 2);
    const view = planUndo({ id: "c3", target: `view:${V1}`, summary: "Removed your view", before: { name: "Mine", definition: {} }, after: null, undoneAt: null, action: "view_removed" });
    assert.ok(view.ok && view.kind === "view" && view.restore?.name === "Mine");
    const made = planUndo({ id: "c4", target: `view:${V1}`, summary: "Saved", before: null, after: { name: "x" }, undoneAt: null, action: "view_saved" });
    assert.ok(made.ok && made.kind === "view" && made.restore === null, "undoing a save removes the view");
    assert.equal(planUndo({ id: "c5", target: "org:layout", summary: "x", before: null, after: null, undoneAt: null, action: "x" }).ok, false);
  });
});

describe("the database halves (source checks)", () => {
  const actions = read("viewActions.ts");
  const prefs = read("staffPrefs.ts");
  const policy = read("customizationPolicy.ts");
  const views = read("savedViews.ts");
  const fields = read("customFields.ts");
  it("every view action refuses a platform admin acting for an org and runs in the org scope", () => {
    assert.match(actions, /canChangeOwnView = \(a: OrgActor\) => !a\.viaPlatformAdmin && a\.capabilities\.has\("org\.cohort\.view"\)/);
    for (const fn of ["setTodayOrder", "foldSection", "hideSection", "setColumns", "setGridLayout", "setDensity", "setPeopleMode", "setDefaultView", "setPersonTabsOrder", "saveMyView", "updateMyView", "deleteMyView", "undoViewChange"]) {
      const body = actions.slice(actions.indexOf(`export async function ${fn}(`));
      assert.match(body.slice(0, 300), /if \(!canChangeOwnView\(actor\)\) return NO_ACCESS;/, fn);
    }
    assert.doesNotMatch(actions, /\bquery\(/, "no unscoped statement");
  });
  it("a pref change and its log row are one transaction; the log names the person as themselves", () => {
    assert.match(actions, /run\(sql\)\(PREFS_UPDATE[\s\S]{0,200}LOG_INSERT/);
    assert.match(actions, /logParams = \(actor: OrgActor[\s\S]{0,80}\[actor\.orgId, actor\.userId,/);
  });
  it("a personal view action only ever touches the actor's own views", () => {
    assert.match(actions, /v\.ownerUserId === actor\.userId/);
    assert.match(actions, /shared: false/);
    assert.doesNotMatch(actions, /shared: true/);
  });
  it("prefs: the policy is applied on read and on write", () => {
    assert.match(prefs, /resolveStaffPrefs\(o\?\.staff_pref_defaults, u\?\.staff_prefs, allowed\)/);
    assert.match(prefs, /const blocked = lockedChanges\(before, after, allowed\);\s*if \(blocked\.length\) return \{ ok: false/);
  });
  it("org defaults and quiet-after follow org.settings.manage (owner and org admins)", () => {
    assert.match(prefs, /canManageSettings = \(actor: OrgActor\) => !actor\.viaPlatformAdmin && actor\.capabilities\.has\("org\.settings\.manage"\)/);
  });
  it("the policy is written only by managers, never by a platform admin acting for an org", () => {
    assert.match(policy, /canManageCustomizationPolicy = \(a: OrgActor\) => !a\.viaPlatformAdmin && a\.capabilities\.has\("org\.settings\.manage"\)/);
    assert.match(policy, /if \(!canManageCustomizationPolicy\(actor\)\) return \{ ok: false/);
  });
  it("personal views follow the policy on read and on write", () => {
    assert.match(views, /\.filter\(\(v\) => v\.ownerUserId === null \|\| allowed\.personal_views\)/);
    assert.match(views, /if \(!allowed\.personal_views\) return/);
    assert.match(views, /if \(!allowed\.columns && def\.columns !== null\) return/);
  });
  it("the grid's batch write is all or nothing: every cell checked before one transaction", () => {
    const body = fields.slice(fields.indexOf("export async function setFieldValuesBatch"));
    assert.ok(body.indexOf("if (bad) return") > 0 && body.indexOf("if (bad) return") < body.indexOf("CUSTOM_FIELD_BATCH_SQL.upsert"), "errors return before any write");
    assert.match(body, /if \(!reached\.has\(c\.entityId\)\) \{ cellErrors\[k\] = "That person is not on your caseload\."/);
    assert.match(body, /validateCustomFieldValue\(def, c\.raw/);
    assert.match(body, /opts\.fromGrid && opts\.gridAllowed === false/);
    assert.match(body, /if \(!canWriteFieldValues\(actor\)\)/);
  });
});

describe("review round 1", () => {
  it("t.ROY for staff (ai_assist) is the owner's switch; admins change everything else", async () => {
    const { aiSwitchRefused, AI_SWITCH_OWNER_ONLY } = await import("../orgStructure");
    const on = { modules: { ai_assist: true } }, off = { modules: { ai_assist: false } };
    assert.equal(aiSwitchRefused({ role: "org_admin" }, on, off), true);
    assert.equal(aiSwitchRefused({ role: "org_admin" }, on, on), false, "a save that leaves it alone passes");
    assert.equal(aiSwitchRefused({ role: "owner" }, on, off), false);
    assert.match(AI_SWITCH_OWNER_ONLY, /owner/);
    const src = read("orgStructure.ts");
    assert.equal((src.match(/if \(aiSwitchRefused\(actor, current, n\)\) return bad\(AI_SWITCH_OWNER_ONLY\);/g) ?? []).length, 2, "profile update and setup both check it");
  });
  it("a policy that cannot be read never opens the limits", () => {
    const src = read("customizationPolicy.ts");
    assert.match(src, /if \(opts\.forWrite\) throw err;\s*return \{ \.\.\.NONE_ALLOWED \};/);
    for (const f of ["viewActions.ts", "staffPrefs.ts", "savedViews.ts"]) assert.match(read(f), /getMyCustomizationPolicy\(actor, \{ forWrite: true \}\)/, f);
  });
  it("undo marks first, in the same statement as the change and its log row", async () => {
    const { VIEW_UNDO_SQL } = await import("../viewActions");
    for (const [k, sql] of Object.entries(VIEW_UNDO_SQL)) {
      assert.match(sql, /^WITH m AS \(UPDATE view_change_log SET undone_at = now\(\)\s+WHERE id = \$3::uuid AND user_id = \$1::uuid AND access_code_id = \$2::uuid AND undone_at IS NULL RETURNING id\)/, k);
      assert.match(sql, /EXISTS \(SELECT 1 FROM m\)/, k);
    }
  });
  it("personal views are not removed while the switch is off; the grid writes in two statements", () => {
    assert.match(read("savedViews.ts"), /if \(own\[0\]\?\.owner_user_id && !\(await getMyCustomizationPolicy\(actor, \{ forWrite: true \}\)\)\.personal_views\) return false;/);
    const body = read("customFields.ts").slice(read("customFields.ts").indexOf("export async function setFieldValuesBatch"));
    assert.match(body, /CUSTOM_FIELD_BATCH_SQL\.upsert/);
    assert.doesNotMatch(body, /upserts\.map\(\(u\) =>\s*run\(sql\)/);
  });
});
