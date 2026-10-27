/**
 * Saved views and role layouts: the database half. See savedViewsShared.ts.
 *
 * Personal views belong to one person in one organization (migration 104
 * policy: owner only). Shared views and role layouts are written by people
 * who manage the organization's settings. Everything runs in the org scope.
 */
import { runScoped, type OrgScope } from "./db";
import type { OrgActor } from "./authz/resolveOrgActor";
import { isCustomizationTableMissing } from "./customFields";
import {
  MAX_PERSONAL_VIEWS, MAX_SHARED_VIEWS, cleanViewName, isLayoutRole, isViewSurface, legacyViewToDefinition, normalizeCaseloadLayout,
  normalizeTodayLayout, normalizeViewDefinition,
  type CaseloadLayout, type LayoutRole, type TodayLayout, type ViewDefinition, type ViewSurface,
} from "./savedViewsShared";
import { normalizeStaffPrefs } from "./staffPrefsShared";
import { getMyCustomizationPolicy } from "./customizationPolicy";
import { POLICY_LOCKED_TEXT, SUGGEST_CHANGE_LINE } from "./customizationPolicyShared";

export * from "./savedViewsShared";

const scopeOf = (a: OrgActor): OrgScope => ({ orgId: a.orgId, userId: a.userId, role: a.role });
const run = (sql: unknown) => sql as (s: string, p: unknown[]) => unknown;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Shared views and role layouts: people who manage the organization's settings (owner and org admins, Troy 2026-10-27). */
export const canManageSharedViews = (a: OrgActor) => !a.viaPlatformAdmin && a.capabilities.has("org.settings.manage");
const canUseViews = (a: OrgActor) => !a.viaPlatformAdmin && a.capabilities.has("org.cohort.view");

export interface SavedViewRecord {
  id: string;
  surface: ViewSurface;
  name: string;
  /** null = shared with the organization. */
  ownerUserId: string | null;
  roleDefault: LayoutRole | null;
  position: number;
  definition: ViewDefinition;
}

function viewFromRow(r: Record<string, unknown>): SavedViewRecord | null {
  if (!isViewSurface(r.surface)) return null;
  return {
    id: String(r.id), surface: r.surface, name: String(r.name), ownerUserId: (r.owner_user_id as string | null) ?? null,
    roleDefault: isLayoutRole(r.role_default) ? r.role_default : null, position: Number(r.position ?? 0),
    definition: normalizeViewDefinition(r.definition),
  };
}
const VIEW_COLS = `id, surface, name, owner_user_id, role_default, position, definition`;

/**
 * Your own views and the organization's shared ones, for one list. The
 * organization's customization policy (108) applies on READ: with personal
 * views turned off for your role, yours stay stored but are not listed; with
 * your own columns turned off, a personal view keeps its filters and sort but
 * shows the usual columns. Turning the switch back on brings them back.
 */
export async function listSavedViews(actor: OrgActor, surface: ViewSurface): Promise<SavedViewRecord[]> {
  if (!canUseViews(actor) || !isViewSurface(surface)) return [];
  try {
    const [[rows], allowed] = await Promise.all([
      runScoped<[Record<string, unknown>[]]>(scopeOf(actor), (sql) => [
        run(sql)(
          `SELECT ${VIEW_COLS} FROM saved_view
            WHERE access_code_id = $1::uuid AND surface = $2 AND (owner_user_id IS NULL OR owner_user_id = $3::uuid)
            ORDER BY (owner_user_id IS NULL) DESC, position, lower(name)`,
          [actor.orgId, surface, actor.userId],
        ),
      ]),
      getMyCustomizationPolicy(actor),
    ]);
    return rows.map(viewFromRow).filter((v): v is SavedViewRecord => !!v)
      .filter((v) => v.ownerUserId === null || allowed.personal_views)
      .map((v) => (v.ownerUserId !== null && !allowed.columns ? { ...v, definition: { ...v.definition, columns: null } } : v));
  } catch (err) {
    if (isCustomizationTableMissing(err)) return [];
    throw err;
  }
}

export type ViewResult = { ok: true; view: SavedViewRecord } | { ok: false; error: string };

function viewError(err: unknown): string {
  const code = (err as { code?: string })?.code;
  if (code === "23505") return "You already have a view with that name. Pick another name.";
  if (code === "42501" || /row-level security/i.test(String((err as { message?: string })?.message ?? ""))) return "You do not have access to that.";
  if (isCustomizationTableMissing(err)) return "Saved views are not switched on yet for this workspace.";
  return "That view did not save. Try again.";
}

export interface ViewInput { surface?: unknown; name?: unknown; definition?: unknown; shared?: unknown; roleDefault?: unknown }

export async function createSavedView(actor: OrgActor, input: ViewInput): Promise<ViewResult> {
  if (!canUseViews(actor)) return { ok: false, error: "You do not have access to that." };
  if (!isViewSurface(input.surface)) return { ok: false, error: "Choose which list the view is for." };
  const name = cleanViewName(input.name);
  if (!name) return { ok: false, error: "Give the view a name." };
  const shared = input.shared === true;
  if (shared && !canManageSharedViews(actor)) return { ok: false, error: "Only someone who manages your organization's settings can share a view with everyone." };
  const roleDefault = shared && isLayoutRole(input.roleDefault) ? input.roleDefault : null;
  const definition = normalizeViewDefinition(input.definition);
  const surface = input.surface;
  if (!shared) {
    const refused = await personalViewRefusal(actor, definition);
    if (refused) return { ok: false, error: refused };
  }
  try {
    const existing = await listSavedViews(actor, surface);
    const mine = existing.filter((v) => (shared ? v.ownerUserId === null : v.ownerUserId === actor.userId));
    if (mine.length >= (shared ? MAX_SHARED_VIEWS : MAX_PERSONAL_VIEWS)) return { ok: false, error: "That is the most views a list can hold. Remove one first." };
    const [rows] = await runScoped<[Record<string, unknown>[]]>(scopeOf(actor), (sql) => [
      run(sql)(
        `INSERT INTO saved_view (access_code_id, owner_user_id, surface, name, definition, role_default, position, created_by)
         VALUES ($1::uuid, $2::uuid, $3, $4, $5::jsonb, $6, $7, $8::uuid) RETURNING ${VIEW_COLS}`,
        [actor.orgId, shared ? null : actor.userId, surface, name, JSON.stringify(definition), roleDefault, mine.length, actor.userId],
      ),
    ]);
    const view = rows[0] ? viewFromRow(rows[0]) : null;
    return view ? { ok: true, view } : { ok: false, error: "That view did not save. Try again." };
  } catch (err) {
    return { ok: false, error: viewError(err) };
  }
}

/** Rename, change the definition, or (shared views) the role it opens first for. Never moves a view between people. */
export async function updateSavedView(actor: OrgActor, id: string, patch: { name?: unknown; definition?: unknown; roleDefault?: unknown }): Promise<ViewResult> {
  if (!canUseViews(actor) || !UUID.test(id)) return { ok: false, error: "No such view." };
  const name = patch.name === undefined ? null : cleanViewName(patch.name);
  if (patch.name !== undefined && !name) return { ok: false, error: "Give the view a name." };
  const normalized = patch.definition === undefined ? null : normalizeViewDefinition(patch.definition);
  const definition = normalized === null ? null : JSON.stringify(normalized);
  const setRole = patch.roleDefault !== undefined;
  // The policy applies to your own views only (shared views are a manager's,
  // and the update below only reaches them for a manager).
  try {
    const [own] = await runScoped<[{ owner_user_id: string | null }[]]>(scopeOf(actor), (sql) => [
      run(sql)(`SELECT owner_user_id FROM saved_view WHERE id = $2::uuid AND access_code_id = $1::uuid`, [actor.orgId, id]),
    ]);
    if (own[0]?.owner_user_id) {
      const refused = await personalViewRefusal(actor, normalized ?? { columns: null, filters: [], sort: null, groupBy: null });
      if (refused) return { ok: false, error: refused };
    }
  } catch (err) {
    return { ok: false, error: viewError(err) };
  }
  const roleDefault = isLayoutRole(patch.roleDefault) ? patch.roleDefault : null;
  try {
    // A shared view is changed only by a manager (the policy says so too);
    // a personal one only by its owner. role_default only on shared views.
    const [rows] = await runScoped<[Record<string, unknown>[]]>(scopeOf(actor), (sql) => [
      run(sql)(
        `UPDATE saved_view SET name = COALESCE($4, name), definition = COALESCE($5::jsonb, definition),
                role_default = CASE WHEN $6::boolean AND owner_user_id IS NULL THEN $7 ELSE role_default END, updated_at = now()
          WHERE id = $2::uuid AND access_code_id = $1::uuid
            AND (owner_user_id = $3::uuid OR (owner_user_id IS NULL AND $8::boolean))
          RETURNING ${VIEW_COLS}`,
        [actor.orgId, id, actor.userId, name, definition, setRole, roleDefault, canManageSharedViews(actor)],
      ),
    ]);
    const view = rows[0] ? viewFromRow(rows[0]) : null;
    return view ? { ok: true, view } : { ok: false, error: "No such view, or it is not yours to change." };
  } catch (err) {
    return { ok: false, error: viewError(err) };
  }
}

/**
 * Why a personal view may not be saved as asked, or null. Personal views need
 * `personal_views`; a personal view that picks its own columns needs `columns`.
 */
async function personalViewRefusal(actor: OrgActor, def: ViewDefinition): Promise<string | null> {
  const allowed = await getMyCustomizationPolicy(actor);
  if (!allowed.personal_views) return `${POLICY_LOCKED_TEXT.personal_views} ${SUGGEST_CHANGE_LINE}`;
  if (!allowed.columns && def.columns !== null) return `${POLICY_LOCKED_TEXT.columns} ${SUGGEST_CHANGE_LINE}`;
  return null;
}

export async function deleteSavedView(actor: OrgActor, id: string): Promise<boolean> {
  if (!canUseViews(actor) || !UUID.test(id)) return false;
  try {
    const [rows] = await runScoped<[{ id: string }[]]>(scopeOf(actor), (sql) => [
      run(sql)(
        `DELETE FROM saved_view WHERE id = $2::uuid AND access_code_id = $1::uuid
           AND (owner_user_id = $3::uuid OR (owner_user_id IS NULL AND $4::boolean)) RETURNING id`,
        [actor.orgId, id, actor.userId, canManageSharedViews(actor)],
      ),
    ]);
    return rows.length > 0;
  } catch {
    return false;
  }
}

/** Put views in this order (yours, or the shared ones for a manager). */
export async function reorderSavedViews(actor: OrgActor, surface: ViewSurface, ids: string[], shared: boolean): Promise<boolean> {
  if (!canUseViews(actor) || !isViewSurface(surface) || (shared && !canManageSharedViews(actor))) return false;
  const clean = Array.from(new Set(ids.filter((i) => UUID.test(i)))).slice(0, 100);
  if (!clean.length) return false;
  try {
    await runScoped(scopeOf(actor), (sql) => [
      run(sql)(
        `UPDATE saved_view v SET position = o.n - 1, updated_at = now() FROM unnest($4::uuid[]) WITH ORDINALITY AS o(id, n)
          WHERE v.id = o.id AND v.access_code_id = $1::uuid AND v.surface = $2
            AND ${shared ? "v.owner_user_id IS NULL" : "v.owner_user_id = $3::uuid"}`,
        [actor.orgId, surface, actor.userId, clean],
      ),
    ]);
    return true;
  } catch {
    return false;
  }
}

/**
 * Move this person's old saved sorts (users.staff_prefs.savedViews, 052) into
 * personal caseload views in THIS organization, once.
 *
 * IDEMPOTENT, and nothing is lost:
 *  - the old list is left exactly where it was (it is not deleted, so going
 *    back to an older release loses nothing);
 *  - a marker (staff_prefs.viewsMovedTo, the org ids already done) stops a
 *    second move, so a view someone deleted does not come back;
 *  - two first loads at once are safe: the unique name index plus ON CONFLICT
 *    DO NOTHING means the second insert of the same name does nothing.
 * The marker is server-owned: setOwnStaffPrefs keeps it (staffPrefs.ts).
 * Returns how many views were created.
 */
export async function migrateLegacySavedViews(actor: OrgActor): Promise<number> {
  if (!canUseViews(actor)) return 0;
  try {
    const [rows] = await runScoped<[{ staff_prefs: Record<string, unknown> | null }[]]>(scopeOf(actor), (sql) => [
      run(sql)(`SELECT staff_prefs FROM users WHERE id = $1::uuid`, [actor.userId]),
    ]);
    const prefs = rows[0]?.staff_prefs ?? {};
    const moved = Array.isArray(prefs.viewsMovedTo) ? (prefs.viewsMovedTo as unknown[]).map(String) : [];
    if (moved.includes(actor.orgId)) return 0;
    const legacy = normalizeStaffPrefs(prefs).savedViews ?? [];
    const payload = legacy.map((v, i) => ({ name: v.name, position: i, definition: legacyViewToDefinition(v) }));
    const [inserted] = await runScoped<[{ id: string }[], unknown]>(scopeOf(actor), (sql) => [
      run(sql)(
        `INSERT INTO saved_view (access_code_id, owner_user_id, surface, name, definition, position, created_by)
         SELECT $1::uuid, $2::uuid, 'caseload', x.name, x.definition, x.position, $2::uuid
           FROM jsonb_to_recordset($3::jsonb) AS x(name text, definition jsonb, position int)
         ON CONFLICT DO NOTHING RETURNING id`,
        [actor.orgId, actor.userId, JSON.stringify(payload)],
      ),
      run(sql)(
        `UPDATE users SET staff_prefs = jsonb_set(COALESCE(staff_prefs, '{}'::jsonb), '{viewsMovedTo}',
                  (SELECT COALESCE(jsonb_agg(DISTINCT x), '[]'::jsonb) FROM jsonb_array_elements_text(
                     COALESCE(staff_prefs->'viewsMovedTo', '[]'::jsonb) || to_jsonb($2::text)) AS x))
          WHERE id = $1::uuid`,
        [actor.userId, actor.orgId],
      ),
    ]);
    return inserted.length;
  } catch (err) {
    if (isCustomizationTableMissing(err)) return 0;
    throw err;
  }
}

/* ------------------------------------------------------------ role layouts -- */

export interface RoleLayouts {
  today: Partial<Record<LayoutRole, TodayLayout>>;
  caseload: Partial<Record<LayoutRole, CaseloadLayout>>;
}

export async function getRoleLayouts(actor: OrgActor): Promise<RoleLayouts> {
  const out: RoleLayouts = { today: {}, caseload: {} };
  try {
    const [rows] = await runScoped<[{ role: string; surface: string; layout: unknown }[]]>(scopeOf(actor), (sql) => [
      run(sql)(`SELECT role, surface, layout FROM org_role_layout WHERE access_code_id = $1::uuid AND surface IN ('today', 'caseload')`, [actor.orgId]),
    ]);
    for (const r of rows) {
      if (!isLayoutRole(r.role)) continue;
      if (r.surface === "today") out.today[r.role] = normalizeTodayLayout(r.layout);
      else out.caseload[r.role] = normalizeCaseloadLayout(r.layout);
    }
    return out;
  } catch (err) {
    if (isCustomizationTableMissing(err)) return out;
    throw err;
  }
}

/** The layout for the actor's own role (what their screens use). */
export async function getMyRoleLayout(actor: OrgActor): Promise<{ today: TodayLayout | null; caseload: CaseloadLayout | null }> {
  const all = await getRoleLayouts(actor);
  return { today: all.today[actor.role] ?? null, caseload: all.caseload[actor.role] ?? null };
}

/** Set (layout) or reset to the built-in default (null) one role's layout for one surface. */
export async function setRoleLayout(actor: OrgActor, role: unknown, surface: "today" | "caseload", layout: unknown | null): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!canManageSharedViews(actor)) return { ok: false, error: "Only someone who manages your organization's settings can change layouts." };
  if (!isLayoutRole(role)) return { ok: false, error: "Choose a role." };
  if (surface !== "today" && surface !== "caseload") return { ok: false, error: "Choose a screen." };
  try {
    if (layout === null) {
      await runScoped(scopeOf(actor), (sql) => [
        run(sql)(`DELETE FROM org_role_layout WHERE access_code_id = $1::uuid AND role = $2 AND surface = $3`, [actor.orgId, role, surface]),
      ]);
      return { ok: true };
    }
    const clean = surface === "today" ? normalizeTodayLayout(layout) : normalizeCaseloadLayout(layout);
    await runScoped(scopeOf(actor), (sql) => [
      run(sql)(
        `INSERT INTO org_role_layout (access_code_id, role, surface, layout, updated_by) VALUES ($1::uuid, $2, $3, $4::jsonb, $5::uuid)
         ON CONFLICT (access_code_id, role, surface) DO UPDATE SET layout = EXCLUDED.layout, updated_by = EXCLUDED.updated_by, updated_at = now()`,
        [actor.orgId, role, surface, JSON.stringify(clean), actor.userId],
      ),
    ]);
    return { ok: true };
  } catch (err) {
    if (isCustomizationTableMissing(err)) return { ok: false, error: "Layouts are not switched on yet for this workspace." };
    const code = (err as { code?: string })?.code;
    return { ok: false, error: code === "42501" ? "You do not have access to that." : "That layout did not save. Try again." };
  }
}
