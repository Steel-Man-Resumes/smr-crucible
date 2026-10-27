/**
 * The typed view action layer: the database half (staff build S3). See
 * viewActionsShared.ts for the rules. The People, Today and person screens
 * and t.ROY's view tools all call these functions, so the checks are the same
 * whoever asks: the organization's customization policy for the person's
 * role, the same normalizers as the stored prefs and views, never a platform
 * admin acting for an organization, never under view-as (the route guard
 * refuses writes there first).
 *
 * Every change is written with its row in view_change_log (108) in the SAME
 * transaction where it is a pref or a grid look, so a change without its undo
 * entry cannot happen. Personal views are written through savedViews.ts
 * (policy, names, limits) and logged right after. Before 108 is applied the
 * change still happens and simply has no log entry (changeId null).
 *
 * users.staff_prefs is not row-protected; view_change_log is (owner-only), so
 * everything runs in the organization scope.
 */
import { runScoped, type OrgScope } from "./db";
import type { OrgActor } from "./authz/resolveOrgActor";
import { getMyCustomizationPolicy, isPolicyTableMissing } from "./customizationPolicy";
import { isSensitiveField, type CustomFieldDef } from "./customFieldsShared";
import { listFieldDefs } from "./customFields";
import { createSavedView, deleteSavedView, getMyRoleLayout, listSavedViews, updateSavedView, type SavedViewRecord } from "./savedViews";
import { BUILTIN_COLUMN_LABELS, defaultCaseloadColumns, normalizeViewDefinition, type ViewDefinition } from "./savedViewsShared";
import { normalizeStaffPrefs, resolveStaffPrefs, type StaffPrefs } from "./staffPrefsShared";
import { lockedChanges, lockedMessage, type PolicyAllowed } from "./customizationPolicyShared";
import {
  planDefaultColumns, planDefaultView, planDensity, planFold, planGridLayout, planHide, planPeopleMode, planPersonTabs, planTodayOrder, planUndo,
  type GridLayoutPatch, type LogSurface, type LoggedChange, type PlannedChange, type PrefPlan,
} from "./viewActionsShared";
import type { GridLayout } from "./viewLayoutShared";

export * from "./viewActionsShared";

const scopeOf = (a: OrgActor): OrgScope => ({ orgId: a.orgId, userId: a.userId, role: a.role });
const run = (sql: unknown) => sql as (s: string, p: unknown[]) => unknown;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface ViewActionContext {
  /** True when t.ROY made the change for the person (logged as by_ai). */
  byAi?: boolean;
}

export type ViewActionResult =
  | { ok: true; changeId: string | null; summary: string; target: string; before: unknown; after: unknown; prefs?: StaffPrefs; view?: SavedViewRecord | null }
  | { ok: false; error: string; reason: "policy" | "invalid" | "unchanged" | "missing" | "access" | "failed" };

/** Who may change their own view here: anyone on staff, as themselves. */
export const canChangeOwnView = (a: OrgActor) => !a.viaPlatformAdmin && a.capabilities.has("org.cohort.view");
const NO_ACCESS: ViewActionResult = { ok: false, reason: "access", error: "You do not have access to that." };

/* ------------------------------------------------------------ the state -- */

interface OwnState { own: Partial<StaffPrefs>; orgDefaults: Partial<StaffPrefs>; allowed: PolicyAllowed }

async function loadOwn(actor: OrgActor): Promise<OwnState> {
  const [rows, allowed] = await Promise.all([
    runScoped<[{ staff_prefs: unknown; defaults: unknown }[]]>(scopeOf(actor), (sql) => [
      run(sql)(`SELECT u.staff_prefs, (SELECT a.staff_pref_defaults FROM access_code a WHERE a.id = $2::uuid) AS defaults FROM users u WHERE u.id = $1::uuid`, [actor.userId, actor.orgId]),
    ]),
    getMyCustomizationPolicy(actor),
  ]);
  const r = rows[0][0];
  return { own: normalizeStaffPrefs(r?.staff_prefs), orgDefaults: normalizeStaffPrefs(r?.defaults), allowed };
}

/** The log insert, as a statement (shared by every writer). */
const LOG_INSERT = `INSERT INTO view_change_log (access_code_id, user_id, surface, action, target, summary, before, after, by_ai, undoes)
  VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9, $10::uuid) RETURNING id`;
const logParams = (actor: OrgActor, c: PlannedChange, byAi: boolean, undoes: string | null = null) =>
  [actor.orgId, actor.userId, c.surface, c.action, c.target, c.summary.slice(0, 200), JSON.stringify(c.before ?? null), JSON.stringify(c.after ?? null), byAi, undoes];
/** Same as setOwnStaffPrefs: the server-owned viewsMovedTo marker survives. */
const PREFS_UPDATE = `UPDATE users SET staff_prefs = $2::jsonb || CASE WHEN jsonb_typeof(staff_prefs->'viewsMovedTo') = 'array'
  THEN jsonb_build_object('viewsMovedTo', staff_prefs->'viewsMovedTo') ELSE '{}'::jsonb END WHERE id = $1::uuid`;

/** Write a planned pref change and its log row together. */
async function commitPref(actor: OrgActor, state: OwnState, plan: PrefPlan, ctx: ViewActionContext, undo?: { of: string }): Promise<ViewActionResult> {
  if (!plan.ok) return plan;
  const c = plan.change;
  const write = async (withLog: boolean) => runScoped<unknown[]>(scopeOf(actor), (sql) => [
    run(sql)(PREFS_UPDATE, [actor.userId, JSON.stringify(plan.nextOwn)]),
    ...(withLog ? [run(sql)(LOG_INSERT, logParams(actor, c, !!ctx.byAi, undo?.of ?? null))] : []),
    ...(withLog && undo ? [run(sql)(`UPDATE view_change_log SET undone_at = now() WHERE id = $1::uuid AND user_id = $2::uuid AND access_code_id = $3::uuid AND undone_at IS NULL`, [undo.of, actor.userId, actor.orgId])] : []),
  ]);
  let changeId: string | null = null;
  try {
    const res = await write(true);
    changeId = (res[1] as { id: string }[])?.[0]?.id ?? null;
  } catch (err) {
    if (!isPolicyTableMissing(err)) return { ok: false, reason: "failed", error: "That change did not save. Try again." };
    await write(false);
  }
  return { ok: true, changeId, summary: c.summary, target: c.target, before: c.before, after: c.after, prefs: resolveStaffPrefs(state.orgDefaults, plan.nextOwn, state.allowed) };
}

/** Log a change that was written elsewhere (personal views). Best effort: the change already stands. */
async function logOnly(actor: OrgActor, c: PlannedChange, ctx: ViewActionContext): Promise<string | null> {
  try {
    const [rows] = await runScoped<[{ id: string }[]]>(scopeOf(actor), (sql) => [run(sql)(LOG_INSERT, logParams(actor, c, !!ctx.byAi))]);
    return rows[0]?.id ?? null;
  } catch (err) {
    if (!isPolicyTableMissing(err)) console.error("view change log failed:", (err as Error)?.message ?? err);
    return null;
  }
}

/** Column id -> words for a summary. A sensitive field is never named (the log can reach t.ROY through an undo). */
async function columnLabeler(actor: OrgActor): Promise<(id: string) => string> {
  const defs: CustomFieldDef[] = await listFieldDefs(actor, { entity: "participant", includeRetired: true }).catch(() => []);
  const byId = new Map(defs.map((d) => [`cf:${d.key}`, isSensitiveField(d) ? "a sensitive field" : d.label]));
  return (id) => byId.get(id) ?? (BUILTIN_COLUMN_LABELS as Record<string, string>)[id] ?? "a column";
}

/* ---------------------------------------------------------- the actions -- */

export async function setTodayOrder(actor: OrgActor, input: { order: unknown[] }, ctx: ViewActionContext = {}): Promise<ViewActionResult> {
  if (!canChangeOwnView(actor)) return NO_ACCESS;
  const s = await loadOwn(actor);
  return commitPref(actor, s, planTodayOrder(s.own, Array.isArray(input.order) ? input.order : [], s.allowed), ctx);
}

export async function foldSection(actor: OrgActor, input: { section: unknown; folded: boolean }, ctx: ViewActionContext = {}): Promise<ViewActionResult> {
  if (!canChangeOwnView(actor)) return NO_ACCESS;
  const s = await loadOwn(actor);
  return commitPref(actor, s, planFold(s.own, input.section, input.folded !== false, s.allowed), ctx);
}

export async function hideSection(actor: OrgActor, input: { section: unknown; hidden: boolean }, ctx: ViewActionContext = {}): Promise<ViewActionResult> {
  if (!canChangeOwnView(actor)) return NO_ACCESS;
  const s = await loadOwn(actor);
  return commitPref(actor, s, planHide(s.own, input.section, input.hidden !== false, s.allowed), ctx);
}

/**
 * Columns: on one of your own views (viewId), or your People columns when no
 * view is chosen (viewId null). columns null = back to the usual columns.
 */
export async function setColumns(actor: OrgActor, input: { viewId?: string | null; columns: unknown[] | null }, ctx: ViewActionContext = {}): Promise<ViewActionResult> {
  if (!canChangeOwnView(actor)) return NO_ACCESS;
  const s = await loadOwn(actor);
  const labelOf = await columnLabeler(actor);
  if (input.viewId) {
    const view = await findOwnView(actor, input.viewId);
    if (!view) return { ok: false, reason: "missing", error: "That is not one of your own views." };
    return updateMyView(actor, { id: view.id, definition: { ...view.definition, columns: input.columns } }, ctx);
  }
  const effective = resolveStaffPrefs(s.orgDefaults, s.own, s.allowed);
  const layout = await getMyRoleLayout(actor).catch(() => ({ caseload: null }));
  const shown = defaultCaseloadColumns(layout.caseload, effective.caseloadHidden, effective.caseloadColumns);
  return commitPref(actor, s, planDefaultColumns(s.own, input.columns, s.allowed, shown, labelOf), ctx);
}

export async function setColumnWidth(actor: OrgActor, input: { viewId?: string | null; column: string; width: number | null }, ctx: ViewActionContext = {}): Promise<ViewActionResult> {
  return setGridLayout(actor, { viewId: input.viewId ?? null, patch: { widths: { [input.column]: input.width } } }, ctx);
}

/** This person's own grid look for one view (or no view). Never changes the view for anyone else. */
export async function setGridLayout(actor: OrgActor, input: { viewId?: string | null; patch: GridLayoutPatch }, ctx: ViewActionContext = {}): Promise<ViewActionResult> {
  if (!canChangeOwnView(actor)) return NO_ACCESS;
  const s = await loadOwn(actor);
  let base: GridLayout | null = null;
  if (input.viewId) {
    const view = (await listSavedViews(actor, "caseload")).find((v) => v.id === input.viewId);
    if (!view) return { ok: false, reason: "missing", error: "That view is not here any more." };
    base = view.definition.grid ?? null;
  }
  return commitPref(actor, s, planGridLayout(s.own, input.viewId ?? null, input.patch ?? {}, s.allowed, base, await columnLabeler(actor)), ctx);
}

export async function setDensity(actor: OrgActor, input: { density: unknown }, ctx: ViewActionContext = {}): Promise<ViewActionResult> {
  if (!canChangeOwnView(actor)) return NO_ACCESS;
  const s = await loadOwn(actor);
  return commitPref(actor, s, planDensity(s.own, input.density, s.allowed), ctx);
}

export async function setPeopleMode(actor: OrgActor, input: { mode: unknown }, ctx: ViewActionContext = {}): Promise<ViewActionResult> {
  if (!canChangeOwnView(actor)) return NO_ACCESS;
  const s = await loadOwn(actor);
  return commitPref(actor, s, planPeopleMode(s.own, input.mode, s.allowed), ctx);
}

/** Which view People opens with: a view you can see, "none", or null for the usual rule. */
export async function setDefaultView(actor: OrgActor, input: { viewId: string | null }, ctx: ViewActionContext = {}): Promise<ViewActionResult> {
  if (!canChangeOwnView(actor)) return NO_ACCESS;
  const s = await loadOwn(actor);
  let name: string | null = null;
  const id = input.viewId === null || input.viewId === "none" ? input.viewId : String(input.viewId).toLowerCase();
  if (id && id !== "none") {
    if (!UUID.test(id)) return { ok: false, reason: "invalid", error: "Pick one of the views in the menu." };
    const view = (await listSavedViews(actor, "caseload")).find((v) => v.id === id);
    if (!view) return { ok: false, reason: "missing", error: "That view is not here any more." };
    name = view.name;
  }
  return commitPref(actor, s, planDefaultView(s.own, id, s.allowed, name), ctx);
}

export async function setPersonTabsOrder(actor: OrgActor, input: { tabs: unknown[] }, ctx: ViewActionContext = {}): Promise<ViewActionResult> {
  if (!canChangeOwnView(actor)) return NO_ACCESS;
  const s = await loadOwn(actor);
  return commitPref(actor, s, planPersonTabs(s.own, Array.isArray(input.tabs) ? input.tabs : [], s.allowed), ctx);
}

/* ------------------------------------------------------- personal views -- */

const viewRecord = (v: SavedViewRecord) => ({ name: v.name, definition: v.definition });

async function findOwnView(actor: OrgActor, id: string): Promise<SavedViewRecord | null> {
  if (!UUID.test(id)) return null;
  const views = await listSavedViews(actor, "caseload");
  return views.find((v) => v.id === id.toLowerCase() && v.ownerUserId === actor.userId) ?? null;
}

/** Save a new personal view of People. Nobody else sees it. */
export async function saveMyView(actor: OrgActor, input: { name: unknown; definition: unknown }, ctx: ViewActionContext = {}): Promise<ViewActionResult> {
  if (!canChangeOwnView(actor)) return NO_ACCESS;
  const res = await createSavedView(actor, { surface: "caseload", name: input.name, definition: input.definition, shared: false });
  if (!res.ok) return { ok: false, reason: /organization (does not|keeps)/.test(res.error) ? "policy" : "invalid", error: res.error };
  const c: PlannedChange = { surface: "views", action: "view_saved", target: `view:${res.view.id}`, summary: `Saved your view "${res.view.name}"`, before: null, after: viewRecord(res.view) };
  return { ok: true, changeId: await logOnly(actor, c, ctx), summary: c.summary, target: c.target, before: null, after: c.after, view: res.view };
}

/** Rename or rearrange one of your own views. Shared views are not changed here. */
export async function updateMyView(actor: OrgActor, input: { id: string; name?: unknown; definition?: unknown }, ctx: ViewActionContext = {}): Promise<ViewActionResult> {
  if (!canChangeOwnView(actor)) return NO_ACCESS;
  const view = await findOwnView(actor, input.id);
  if (!view) return { ok: false, reason: "missing", error: "That is not one of your own views." };
  const definition: ViewDefinition | undefined = input.definition === undefined ? undefined : normalizeViewDefinition(input.definition);
  const res = await updateSavedView(actor, view.id, { name: input.name, definition });
  if (!res.ok) return { ok: false, reason: /organization (does not|keeps)/.test(res.error) ? "policy" : "invalid", error: res.error };
  if (JSON.stringify(viewRecord(view)) === JSON.stringify(viewRecord(res.view))) return { ok: false, reason: "unchanged", error: "That is already how it is." };
  const renamed = res.view.name !== view.name;
  const c: PlannedChange = {
    surface: "views", action: renamed ? "view_renamed" : "view_changed", target: `view:${view.id}`,
    summary: renamed ? `Renamed your view "${view.name}" to "${res.view.name}"` : `Changed your view "${res.view.name}"`,
    before: viewRecord(view), after: viewRecord(res.view),
  };
  return { ok: true, changeId: await logOnly(actor, c, ctx), summary: c.summary, target: c.target, before: c.before, after: c.after, view: res.view };
}

/** Remove one of your own views. It can be brought back with Undo. */
export async function deleteMyView(actor: OrgActor, input: { id: string }, ctx: ViewActionContext = {}): Promise<ViewActionResult> {
  if (!canChangeOwnView(actor)) return NO_ACCESS;
  const view = await findOwnView(actor, input.id);
  if (!view) return { ok: false, reason: "missing", error: "That is not one of your own views." };
  if (!(await deleteSavedView(actor, view.id))) return { ok: false, reason: "failed", error: "That view was not removed. Try again." };
  const c: PlannedChange = { surface: "views", action: "view_removed", target: `view:${view.id}`, summary: `Removed your view "${view.name}"`, before: viewRecord(view), after: null };
  return { ok: true, changeId: await logOnly(actor, c, ctx), summary: c.summary, target: c.target, before: c.before, after: null, view: null };
}

/* ------------------------------------------------------------- the log --- */

export interface ViewChangeEntry {
  id: string; surface: LogSurface; action: string; target: string; summary: string; byAi: boolean;
  at: string; undoneAt: string | null; undoes: string | null;
}

/** Your own recent changes, newest first. [] before 108. */
export async function listMyViewChanges(actor: OrgActor, limit = 30): Promise<ViewChangeEntry[]> {
  if (!canChangeOwnView(actor)) return [];
  const n = Math.max(1, Math.min(100, Math.round(limit)));
  try {
    const [rows] = await runScoped<[Record<string, unknown>[]]>(scopeOf(actor), (sql) => [
      run(sql)(
        `SELECT id, surface, action, target, summary, by_ai, at, undone_at, undoes FROM view_change_log
          WHERE access_code_id = $1::uuid AND user_id = $2::uuid ORDER BY at DESC, id DESC LIMIT $3`,
        [actor.orgId, actor.userId, n],
      ),
    ]);
    return rows.map((r) => ({
      id: String(r.id), surface: r.surface as LogSurface, action: String(r.action), target: String(r.target), summary: String(r.summary),
      byAi: r.by_ai === true, at: new Date(String(r.at)).toISOString(), undoneAt: r.undone_at ? new Date(String(r.undone_at)).toISOString() : null,
      undoes: (r.undoes as string | null) ?? null,
    }));
  } catch (err) {
    if (isPolicyTableMissing(err)) return [];
    throw err;
  }
}

async function readEntry(actor: OrgActor, id: string): Promise<(LoggedChange & { surface: LogSurface }) | null> {
  if (!UUID.test(id)) return null;
  try {
    const [rows] = await runScoped<[Record<string, unknown>[]]>(scopeOf(actor), (sql) => [
      run(sql)(`SELECT id, surface, action, target, summary, before, after, undone_at FROM view_change_log WHERE id = $1::uuid AND access_code_id = $2::uuid AND user_id = $3::uuid`, [id, actor.orgId, actor.userId]),
    ]);
    const r = rows[0];
    return r ? { id: String(r.id), surface: r.surface as LogSurface, action: String(r.action), target: String(r.target), summary: String(r.summary), before: r.before ?? null, after: r.after ?? null, undoneAt: r.undone_at ? String(r.undone_at) : null } : null;
  } catch (err) {
    if (isPolicyTableMissing(err)) return null;
    throw err;
  }
}

/** Your most recent change that is not undone yet (t.ROY's only, when `byAiOnly`). */
export async function latestUndoableChange(actor: OrgActor, opts: { byAiOnly?: boolean } = {}): Promise<ViewChangeEntry | null> {
  const list = await listMyViewChanges(actor, 50);
  return list.find((e) => !e.undoneAt && e.action !== "undo" && (!opts.byAiOnly || e.byAi)) ?? null;
}

/**
 * Undo one of your own changes: put what it changed back to how it was just
 * before it. The undo is a change too (logged, and it can be undone). The
 * organization's policy still applies: a choice it now locks is not written.
 */
export async function undoViewChange(actor: OrgActor, input: { id: string }, ctx: ViewActionContext = {}): Promise<ViewActionResult> {
  if (!canChangeOwnView(actor)) return NO_ACCESS;
  const entry = await readEntry(actor, input.id);
  if (!entry) return { ok: false, reason: "missing", error: "That change is not in your list." };
  const plan = planUndo(entry);
  if (!plan.ok) return plan;
  const markUndone = async () => {
    try {
      await runScoped(scopeOf(actor), (sql) => [
        run(sql)(`UPDATE view_change_log SET undone_at = now() WHERE id = $1::uuid AND user_id = $2::uuid AND access_code_id = $3::uuid AND undone_at IS NULL`, [entry.id, actor.userId, actor.orgId]),
      ]);
    } catch (err) { console.error("view change undo mark failed:", (err as Error)?.message ?? err); }
  };

  if (plan.kind === "view") {
    const now = (await listSavedViews(actor, "caseload")).find((v) => v.id === plan.viewId && v.ownerUserId === actor.userId) ?? null;
    let result: ViewActionResult;
    if (!plan.restore) {
      // It was created: undo removes it (if it is still here).
      if (!now) { await markUndone(); return { ok: false, reason: "unchanged", error: "That view is already gone." }; }
      if (!(await deleteSavedView(actor, now.id))) return { ok: false, reason: "failed", error: "That did not undo. Try again." };
      result = { ok: true, changeId: null, summary: plan.summary, target: entry.target, before: viewRecord(now), after: null, view: null };
    } else if (!now) {
      // It was removed: undo brings it back (a new id, the same name and arrangement).
      const res = await createSavedView(actor, { surface: "caseload", name: plan.restore.name, definition: plan.restore.definition, shared: false });
      if (!res.ok) return { ok: false, reason: "failed", error: res.error };
      result = { ok: true, changeId: null, summary: plan.summary, target: `view:${res.view.id}`, before: null, after: viewRecord(res.view), view: res.view };
    } else {
      const res = await updateSavedView(actor, now.id, { name: plan.restore.name, definition: plan.restore.definition });
      if (!res.ok) return { ok: false, reason: "failed", error: res.error };
      result = { ok: true, changeId: null, summary: plan.summary, target: entry.target, before: viewRecord(now), after: viewRecord(res.view), view: res.view };
    }
    await markUndone();
    let changeId: string | null = null;
    try {
      const [rows] = await runScoped<[{ id: string }[]]>(scopeOf(actor), (sql) => [
        run(sql)(LOG_INSERT, logParams(actor, { surface: "views", action: "undo", target: result.ok ? result.target : entry.target, summary: plan.summary, before: result.ok ? result.before : null, after: result.ok ? result.after : null }, !!ctx.byAi, entry.id)),
      ]);
      changeId = rows[0]?.id ?? null;
    } catch (err) { if (!isPolicyTableMissing(err)) console.error("view change log failed:", (err as Error)?.message ?? err); }
    return result.ok ? { ...result, changeId } : result;
  }

  const s = await loadOwn(actor);
  const nextOwn: Partial<StaffPrefs> = { ...s.own };
  let before: unknown, after: unknown, target: string;
  if (plan.kind === "pref") {
    before = s.own[plan.key] ?? null;
    if (plan.value === null) delete nextOwn[plan.key];
    else (nextOwn as Record<string, unknown>)[plan.key] = plan.value;
    after = plan.value;
    target = `pref:${String(plan.key)}`;
  } else {
    const layouts = { ...(s.own.viewLayouts ?? {}) };
    before = layouts[plan.key] ?? null;
    if (plan.value) layouts[plan.key] = plan.value; else delete layouts[plan.key];
    nextOwn.viewLayouts = layouts;
    after = plan.value;
    target = `layout:${plan.key}`;
  }
  // Re-normalize, then make sure the policy allows writing it back.
  const normalized = normalizeStaffPrefs(nextOwn);
  const blocked = lockedChanges(s.own, normalized, s.allowed);
  if (blocked.length) return { ok: false, reason: "policy", error: lockedMessage(blocked) };
  if (JSON.stringify(before ?? null) === JSON.stringify(after ?? null)) {
    await markUndone();
    return { ok: false, reason: "unchanged", error: "It is already back to how it was." };
  }
  const prefPlan: PrefPlan = { ok: true, nextOwn: normalized, change: { surface: entry.surface, action: "undo", target, summary: plan.summary, before, after } };
  return commitPref(actor, s, prefPlan, ctx, { of: entry.id });
}

/* ---------------------------------------------------------- one door ---- */

/**
 * One door for every view action by name, for the route and for t.ROY's
 * tools. Unknown names are refused. The input is untrusted: each action
 * cleans its own.
 */
export async function dispatchViewAction(actor: OrgActor, action: unknown, input: Record<string, unknown>, ctx: ViewActionContext = {}): Promise<ViewActionResult> {
  const i = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  const viewId = typeof i.viewId === "string" && i.viewId ? i.viewId : null;
  switch (action) {
    case "setTodayOrder": return setTodayOrder(actor, { order: Array.isArray(i.order) ? i.order : [] }, ctx);
    case "foldSection": return foldSection(actor, { section: i.section, folded: i.folded !== false }, ctx);
    case "hideSection": return hideSection(actor, { section: i.section, hidden: i.hidden !== false }, ctx);
    case "setColumns": return setColumns(actor, { viewId, columns: Array.isArray(i.columns) ? i.columns : null }, ctx);
    case "setColumnWidth": return setColumnWidth(actor, { viewId, column: str(i.column), width: typeof i.width === "number" ? i.width : null }, ctx);
    case "setGridLayout": return setGridLayout(actor, { viewId, patch: (i.patch && typeof i.patch === "object" ? i.patch : {}) as GridLayoutPatch }, ctx);
    case "setDensity": return setDensity(actor, { density: i.density }, ctx);
    case "setPeopleMode": return setPeopleMode(actor, { mode: i.mode }, ctx);
    case "setDefaultView": return setDefaultView(actor, { viewId: i.viewId === "none" ? "none" : viewId }, ctx);
    case "saveMyView": return saveMyView(actor, { name: i.name, definition: i.definition }, ctx);
    case "updateMyView": return updateMyView(actor, { id: str(i.id), name: i.name, definition: i.definition }, ctx);
    case "deleteMyView": return deleteMyView(actor, { id: str(i.id) }, ctx);
    case "setPersonTabsOrder": return setPersonTabsOrder(actor, { tabs: Array.isArray(i.tabs) ? i.tabs : [] }, ctx);
    case "undoViewChange": return undoViewChange(actor, { id: str(i.id) }, ctx);
    default: return { ok: false, reason: "invalid", error: "Unknown change." };
  }
}
