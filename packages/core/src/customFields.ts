/**
 * Custom fields: the database half. See customFieldsShared.ts for the rules.
 *
 * Every statement runs inside the organization scope (runScoped), so the
 * row-level policies of migration 104 apply: definitions are org-scoped,
 * written only by managers; values are org-scoped AND reach-restricted
 * (smr_staff_reach). The app also checks reach itself, in SQL (IN_REACH
 * below), as the second wall, exactly as case notes do.
 *
 * Every change is written to the activity log by the database (104's
 * triggers), never by this file, so a route that forgets cannot skip it.
 */
import { runScoped, type OrgScope } from "./db";
// Reach through an organization unit, in APP SQL (L3a, 103): the second wall
// uses the same rule as the database's unit hook without leaning on it.
import { unitReachSql } from "./orgUnitReach";
import type { OrgActor } from "./authz/resolveOrgActor";
import {
  MAX_LIVE_FIELDS_PER_ENTITY, defFromRow, isChoiceType, isCustomFieldEntity, normalizeHelp, normalizeNewFieldDef, normalizeOptions,
  sensitiveWordIn, validateCustomFieldValue,
  type CustomFieldDef, type CustomFieldEntity, type CustomFieldValue, type FieldDefInput,
} from "./customFieldsShared";

export * from "./customFieldsShared";

const scopeOf = (a: OrgActor): OrgScope => ({ orgId: a.orgId, userId: a.userId, role: a.role });
const run = (sql: unknown) => sql as (s: string, p: unknown[]) => unknown;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Who may add, rename, reorder and retire fields: org.settings.manage, never a platform admin acting for an org. */
export const canManageFields = (a: OrgActor) => !a.viaPlatformAdmin && a.capabilities.has("org.settings.manage");
/** Who may read values: anyone who sees the caseload, for the people they reach. */
export const canReadFieldValues = (a: OrgActor) => !a.viaPlatformAdmin && a.capabilities.has("org.cohort.view");
/**
 * Who may fill values in: anyone who may write notes. A field value is an org
 * record about a person, the same kind of thing as a note, and the people who
 * can write a note about someone are exactly the people who should be able to
 * say "housing: stable" about them. Assigning (org.client.assign) is an admin
 * power about caseloads, not about the record, so it is not the gate.
 */
export const canWriteFieldValues = (a: OrgActor) => !a.viaPlatformAdmin && a.capabilities.has("org.note.write");

/** True when the error says one of 104's tables (or 103's) is not there yet. */
export function isCustomizationTableMissing(err: unknown): boolean {
  const code = (err as { code?: string })?.code;
  const msg = String((err as { message?: string })?.message ?? "");
  return code === "42P01" || /relation "?(public\.)?(custom_field_def|custom_field_value|custom_field_value_version|saved_view|org_role_layout|enrollment|org_unit)"? does not exist/.test(msg);
}

/** The database's own words for a refused write, kept only when they are ours (104's guard messages). */
function plainDbError(err: unknown, fallback: string): string {
  const msg = String((err as { message?: string })?.message ?? "");
  const code = (err as { code?: string })?.code;
  if (code === "23505") return "There is already a field with that name. Pick another name.";
  if (code === "42501" || /row-level security/i.test(msg)) return "You do not have access to that.";
  const ours = /^(a field keeps|a sensitive field stays|a choice field|each choice|a choice can be|only choice fields|no such field|that field is retired|enrollments are not set up|that record is not|expected )/i;
  return ours.test(msg) ? msg.charAt(0).toUpperCase() + msg.slice(1) + "." : fallback;
}

const DEF_COLS = `id, entity, key, label, type, options, required, help, sensitive, position, retired_at`;

/** Definitions for the org, in order. Retired ones last, only when asked for. */
export async function listFieldDefs(actor: OrgActor, opts: { entity?: CustomFieldEntity; includeRetired?: boolean } = {}): Promise<CustomFieldDef[]> {
  try {
    const [rows] = await runScoped<[Record<string, unknown>[]]>(scopeOf(actor), (sql) => [
      run(sql)(
        `SELECT ${DEF_COLS} FROM custom_field_def
          WHERE access_code_id = $1::uuid AND ($2::text IS NULL OR entity = $2::text) AND ($3::boolean OR retired_at IS NULL)
          ORDER BY entity, (retired_at IS NOT NULL), position, lower(label)`,
        [actor.orgId, opts.entity ?? null, !!opts.includeRetired],
      ),
    ]);
    return rows.map(defFromRow).filter((d): d is CustomFieldDef => !!d);
  } catch (err) {
    if (isCustomizationTableMissing(err)) return [];
    throw err;
  }
}

export type FieldResult = { ok: true; def: CustomFieldDef } | { ok: false; error: string };

export async function createFieldDef(actor: OrgActor, input: FieldDefInput): Promise<FieldResult> {
  if (!canManageFields(actor)) return { ok: false, error: "Only someone who manages your organization's settings can add fields." };
  const clean = normalizeNewFieldDef(input);
  if (!clean.ok) return clean;
  const d = clean.def;
  try {
    const [existing] = await runScoped<[{ key: string; live: boolean; label: string }[]]>(scopeOf(actor), (sql) => [
      run(sql)(`SELECT key, retired_at IS NULL AS live, label FROM custom_field_def WHERE access_code_id = $1::uuid AND entity = $2::text`, [actor.orgId, d.entity]),
    ]);
    if (existing.filter((e) => e.live).length >= MAX_LIVE_FIELDS_PER_ENTITY) {
      return { ok: false, error: `You can have up to ${MAX_LIVE_FIELDS_PER_ENTITY} fields here. Retire one you no longer use first.` };
    }
    if (existing.some((e) => e.live && e.label.trim().toLowerCase() === d.label.toLowerCase())) {
      return { ok: false, error: `There is already a field called "${d.label}".` };
    }
    // The key never changes and never repeats, even after a field is retired:
    // an export from last year must still mean the same thing.
    const taken = new Set(existing.map((e) => e.key));
    let key = d.key;
    for (let n = 2; taken.has(key); n++) key = `${d.key.slice(0, 36)}_${n}`;
    const [rows] = await runScoped<[Record<string, unknown>[]]>(scopeOf(actor), (sql) => [
      run(sql)(
        `INSERT INTO custom_field_def (access_code_id, entity, key, label, type, options, required, help, sensitive, position)
         SELECT $1::uuid, $2, $3, $4, $5, $6::jsonb, $7, $8, $9,
                COALESCE((SELECT max(position) + 1 FROM custom_field_def WHERE access_code_id = $1::uuid AND entity = $2), 0)
         RETURNING ${DEF_COLS}`,
        [actor.orgId, d.entity, key, d.label, d.type, JSON.stringify(d.options), d.required, d.help, d.sensitive],
      ),
    ]);
    const def = rows[0] ? defFromRow(rows[0]) : null;
    return def ? { ok: true, def } : { ok: false, error: "That field did not save. Try again." };
  } catch (err) {
    if (isCustomizationTableMissing(err)) return { ok: false, error: "Custom fields are not switched on yet for this workspace." };
    return { ok: false, error: plainDbError(err, "That field did not save. Try again.") };
  }
}

export interface FieldDefPatch { label?: unknown; help?: unknown; required?: unknown; sensitive?: unknown; options?: unknown }

/** Rename, change help, required, sensitive, or the choices. Key and type never change. */
export async function updateFieldDef(actor: OrgActor, id: string, patch: FieldDefPatch): Promise<FieldResult> {
  if (!canManageFields(actor)) return { ok: false, error: "Only someone who manages your organization's settings can change fields." };
  if (!UUID.test(id)) return { ok: false, error: "No such field." };
  const current = (await listFieldDefs(actor, { includeRetired: true })).find((d) => d.id === id);
  if (!current) return { ok: false, error: "No such field." };
  const label = patch.label === undefined ? current.label : String(patch.label ?? "").replace(/\s+/g, " ").trim();
  if (!label) return { ok: false, error: "Give the field a name." };
  if (label.length > 80) return { ok: false, error: "Keep the name under 80 characters." };
  const help = patch.help === undefined ? current.help : normalizeHelp(patch.help);
  if (help === false) return { ok: false, error: "Keep the help line under 300 characters." };
  let options = current.options;
  const sentOptions = patch.options !== undefined && !(Array.isArray(patch.options) && patch.options.length === 0 && !isChoiceType(current.type));
  if (sentOptions) {
    if (!isChoiceType(current.type)) return { ok: false, error: "Only list fields have choices." };
    const o = normalizeOptions(patch.options, current.options);
    if (!o.ok) return o;
    options = o.options;
  }
  const forced = sensitiveWordIn({ label, key: current.key, help });
  // Sensitive is one way (104 refuses it too): lowering it would quietly let
  // the values reach AI tools and exports.
  if (current.sensitive && patch.sensitive === false) {
    return { ok: false, error: "A sensitive field stays sensitive. To change that, retire it and make a new field." };
  }
  const sensitive = forced !== null || current.sensitive || patch.sensitive === true;
  const required = patch.required === undefined ? current.required : patch.required === true;
  try {
    const [rows] = await runScoped<[Record<string, unknown>[]]>(scopeOf(actor), (sql) => [
      run(sql)(
        `UPDATE custom_field_def SET label = $3, help = $4, required = $5, sensitive = $6, options = $7::jsonb
          WHERE id = $2::uuid AND access_code_id = $1::uuid RETURNING ${DEF_COLS}`,
        [actor.orgId, id, label, help, required, sensitive, JSON.stringify(options)],
      ),
    ]);
    const def = rows[0] ? defFromRow(rows[0]) : null;
    return def ? { ok: true, def } : { ok: false, error: "That change did not save. Try again." };
  } catch (err) {
    return { ok: false, error: plainDbError(err, "That change did not save. Try again.") };
  }
}

/** Put fields in this order. Ids not listed keep their place after the listed ones. */
export async function reorderFieldDefs(actor: OrgActor, entity: CustomFieldEntity, ids: string[]): Promise<boolean> {
  if (!canManageFields(actor) || !isCustomFieldEntity(entity)) return false;
  const clean = Array.from(new Set(ids.filter((i) => typeof i === "string" && UUID.test(i)))).slice(0, 500);
  if (!clean.length) return false;
  try {
    await runScoped(scopeOf(actor), (sql) => [
      run(sql)(
        `UPDATE custom_field_def d SET position = o.n - 1
           FROM unnest($3::uuid[]) WITH ORDINALITY AS o(id, n)
          WHERE d.id = o.id AND d.access_code_id = $1::uuid AND d.entity = $2`,
        [actor.orgId, entity, clean],
      ),
      run(sql)(
        `UPDATE custom_field_def d SET position = $4 + sub.rn
           FROM (SELECT id, row_number() OVER (ORDER BY position, lower(label)) AS rn FROM custom_field_def
                  WHERE access_code_id = $1::uuid AND entity = $2 AND NOT (id = ANY($3::uuid[]))) sub
          WHERE d.id = sub.id`,
        [actor.orgId, entity, clean, clean.length],
      ),
    ]);
    return true;
  } catch {
    return false;
  }
}

/** Retire (hide from new entry, keep every value) or bring back. */
export async function setFieldRetired(actor: OrgActor, id: string, retired: boolean): Promise<FieldResult> {
  if (!canManageFields(actor)) return { ok: false, error: "Only someone who manages your organization's settings can retire fields." };
  if (!UUID.test(id)) return { ok: false, error: "No such field." };
  try {
    const [rows] = await runScoped<[Record<string, unknown>[]]>(scopeOf(actor), (sql) => [
      run(sql)(
        `UPDATE custom_field_def SET retired_at = CASE WHEN $3::boolean THEN COALESCE(retired_at, now()) ELSE NULL END,
                retired_by = CASE WHEN $3::boolean THEN COALESCE(retired_by, $4::uuid) ELSE NULL END
          WHERE id = $2::uuid AND access_code_id = $1::uuid RETURNING ${DEF_COLS}`,
        [actor.orgId, id, retired, actor.userId],
      ),
    ]);
    const def = rows[0] ? defFromRow(rows[0]) : null;
    return def ? { ok: true, def } : { ok: false, error: "No such field." };
  } catch (err) {
    return { ok: false, error: plainDbError(err, "That change did not save. Try again.") };
  }
}

/* ------------------------------------------------------------------ values -- */

/**
 * Whether 103's tables are here. Asked once per process until they are (a
 * positive answer is kept; a negative one is asked again next time, so a
 * migration applied while the app runs is picked up). Without them, reach is
 * assignment or sees-everyone only.
 */
let unitTablesHere = false;
async function unitReachAvailable(actor: OrgActor): Promise<boolean> {
  if (unitTablesHere) return true;
  try {
    const [rows] = await runScoped<[{ ok: boolean }[]]>(scopeOf(actor), (sql) => [
      run(sql)(`SELECT (to_regclass('public.enrollment') IS NOT NULL AND to_regclass('public.org_unit') IS NOT NULL
                        AND to_regclass('public.unit_member') IS NOT NULL) AS ok`, []),
    ]);
    unitTablesHere = !!rows[0]?.ok;
  } catch {
    return false;
  }
  return unitTablesHere;
}

/**
 * Reach, as SQL, over ($1 org, $2 sees all, $3 actor) and a participant id
 * expression. The same predicate as case notes (orgClientView IN_REACH): a
 * member of this org, and the actor sees everyone, is assigned to them, or
 * (with 103) reaches them through a unit.
 */
export const reachSql = (who: string, units: boolean) => `
  EXISTS (SELECT 1 FROM access_code_redemption r WHERE r.user_id = ${who} AND r.access_code_id = $1::uuid)
  AND ($2::boolean OR EXISTS (SELECT 1 FROM client_staff_assignment a
                               WHERE a.access_code_id = $1::uuid AND a.client_user_id = ${who} AND a.staff_user_id = $3::uuid)${
    units ? `
       OR ${unitReachSql("$1::uuid", "$3::uuid", who)}` : ""})`;

/** entity id -> field key -> value. */
export type FieldValueMap = Record<string, Record<string, CustomFieldValue>>;

/**
 * Values for many records at once (the caseload), or for a list of ids.
 * Only people the actor reaches; retired fields included (old values are
 * history and still show).
 */
export async function getFieldValues(actor: OrgActor, entity: CustomFieldEntity, opts: { entityIds?: string[]; participantId?: string } = {}): Promise<FieldValueMap> {
  if (!canReadFieldValues(actor) || !isCustomFieldEntity(entity)) return {};
  const ids = opts.entityIds ? opts.entityIds.filter((i) => UUID.test(i)).slice(0, 5000) : null;
  const person = opts.participantId && UUID.test(opts.participantId) ? opts.participantId : null;
  const units = await unitReachAvailable(actor);
  try {
    const [rows] = await runScoped<[{ entity_id: string; key: string; value: CustomFieldValue }[]]>(scopeOf(actor), (sql) => [
      run(sql)(
        `SELECT v.entity_id, d.key, v.value
           FROM custom_field_value v JOIN custom_field_def d ON d.id = v.def_id
          WHERE v.access_code_id = $1::uuid AND d.access_code_id = $1::uuid AND d.entity = $4
            AND ($5::uuid[] IS NULL OR v.entity_id = ANY($5::uuid[]))
            AND ($6::uuid IS NULL OR v.participant_user_id = $6::uuid)
            AND ${reachSql("v.participant_user_id", units)}`,
        [actor.orgId, actor.capabilities.has("org.client.view_all"), actor.userId, entity, ids, person],
      ),
    ]);
    const out: FieldValueMap = {};
    for (const r of rows) (out[r.entity_id] ??= {})[r.key] = r.value;
    return out;
  } catch (err) {
    if (isCustomizationTableMissing(err)) return {};
    throw err;
  }
}

/** Staff and the owner of the org: who a staff_member field may name, with names for display. */
export async function getOrgStaffDirectory(actor: OrgActor): Promise<{ id: string; name: string }[]> {
  const [rows] = await runScoped<[{ id: string; name: string | null; email: string | null }[]]>(scopeOf(actor), (sql) => [
    run(sql)(
      `SELECT u.id, u.name, u.email FROM users u
        WHERE u.id IN (SELECT s.user_id FROM org_staff s WHERE s.access_code_id = $1::uuid
                       UNION SELECT a.partner_user_id FROM access_code a WHERE a.id = $1::uuid AND a.partner_user_id IS NOT NULL)
        ORDER BY lower(COALESCE(u.name, u.email, ''))`,
      [actor.orgId],
    ),
  ]);
  return rows.map((r) => ({ id: r.id, name: (r.name || r.email || "Staff member").trim() }));
}

export type SetValuesResult =
  | { ok: true; values: Record<string, CustomFieldValue> }
  | { ok: false; error: string; fieldErrors?: Record<string, string> };

/**
 * Set or clear values on ONE record. `patch` is field key -> raw value; an
 * empty value clears. Every value is checked against its field first (plain
 * messages); nothing is written unless all of them pass. The record must be
 * in reach (app check here, the reach policy in the database).
 */
export async function setFieldValues(actor: OrgActor, entity: CustomFieldEntity, entityId: string, patch: Record<string, unknown>): Promise<SetValuesResult> {
  if (!canWriteFieldValues(actor)) return { ok: false, error: "You do not have access to that." };
  if (!isCustomFieldEntity(entity) || !UUID.test(entityId)) return { ok: false, error: "No such record." };
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) return { ok: false, error: "Nothing to save." };
  const defs = await listFieldDefs(actor, { entity, includeRetired: true });
  const byKey = new Map(defs.map((d) => [d.key, d]));
  const keys = Object.keys(patch).slice(0, 100);
  if (!keys.length) return { ok: false, error: "Nothing to save." };

  // Who the record is about, and whether the actor reaches them.
  const seesAll = actor.capabilities.has("org.client.view_all");
  const units = await unitReachAvailable(actor);
  let participant: string | null = null;
  try {
    if (entity === "participant") {
      const [r] = await runScoped<[{ ok: boolean }[]]>(scopeOf(actor), (sql) => [
        run(sql)(`SELECT (${reachSql("$4::uuid", units)}) AS ok`, [actor.orgId, seesAll, actor.userId, entityId]),
      ]);
      participant = r[0]?.ok ? entityId : null;
    } else {
      const [r] = await runScoped<[{ who: string }[]]>(scopeOf(actor), (sql) => [
        run(sql)(
          `SELECT e.participant_user_id AS who FROM enrollment e
            WHERE e.id = $4::uuid AND e.access_code_id = $1::uuid AND ${reachSql("e.participant_user_id", units)}`,
          [actor.orgId, seesAll, actor.userId, entityId],
        ),
      ]);
      participant = r[0]?.who ?? null;
    }
  } catch (err) {
    if (isCustomizationTableMissing(err)) return { ok: false, error: entity === "enrollment" ? "Enrollments are not set up yet." : "Custom fields are not switched on yet for this workspace." };
    throw err;
  }
  if (!participant) return { ok: false, error: "That person is not on your caseload." };

  const current = (await getFieldValues(actor, entity, { entityIds: [entityId] }))[entityId] ?? {};
  const needsStaff = keys.some((k) => byKey.get(k)?.type === "staff_member");
  const staffIds = needsStaff ? new Set((await getOrgStaffDirectory(actor)).map((s) => s.id.toLowerCase())) : undefined;

  const fieldErrors: Record<string, string> = {};
  const upserts: { defId: string; value: CustomFieldValue }[] = [];
  const clears: string[] = [];
  for (const key of keys) {
    const def = byKey.get(key);
    if (!def) { fieldErrors[key] = "That field no longer exists."; continue; }
    if (def.retiredAt) { fieldErrors[key] = `${def.label} is retired. Its old answer stays, but it takes no new ones.`; continue; }
    // A choice that was retired after someone picked it may stay picked.
    const prev = current[key];
    const keepRetired = typeof prev === "string" ? [prev] : Array.isArray(prev) ? prev.map(String) : [];
    const res = validateCustomFieldValue(def, patch[key], { staffIds, allowRetiredOption: keepRetired });
    if (!res.ok) { fieldErrors[key] = res.error; continue; }
    if (res.value === null) clears.push(def.id);
    else upserts.push({ defId: def.id, value: res.value });
  }
  if (Object.keys(fieldErrors).length) return { ok: false, error: "Some answers need a fix.", fieldErrors };

  try {
    await runScoped(scopeOf(actor), (sql) => [
      ...upserts.map((u) =>
        run(sql)(
          `INSERT INTO custom_field_value (def_id, entity_id, access_code_id, participant_user_id, value)
           VALUES ($2::uuid, $3::uuid, $1::uuid, $4::uuid, $5::jsonb)
           ON CONFLICT (def_id, entity_id) DO UPDATE SET value = EXCLUDED.value
           WHERE custom_field_value.value IS DISTINCT FROM EXCLUDED.value`,
          [actor.orgId, u.defId, entityId, participant, JSON.stringify(u.value)],
        )),
      ...(clears.length
        ? [run(sql)(`DELETE FROM custom_field_value WHERE access_code_id = $1::uuid AND entity_id = $2::uuid AND def_id = ANY($3::uuid[])`, [actor.orgId, entityId, clears])]
        : []),
    ]);
  } catch (err) {
    return { ok: false, error: plainDbError(err, "Those answers did not save. Try again.") };
  }
  const after = (await getFieldValues(actor, entity, { entityIds: [entityId] }))[entityId] ?? {};
  return { ok: true, values: after };
}

/* ------------------------------------------------------- many at once (grid) -- */

export const MAX_BATCH_RECORDS = 500;
export const MAX_BATCH_CELLS = 2000;

export type BatchValuesResult =
  | { ok: true; values: FieldValueMap; written: number }
  | { ok: false; error: string; cellErrors?: Record<string, string> };

/** The grid's two statements (exported so the pglite test runs these exact strings). $1 org, then parallel arrays. */
export const CUSTOM_FIELD_BATCH_SQL = {
  /** $2 def ids, $3 participant ids, $4 values (JSON text). */
  upsert: `INSERT INTO custom_field_value (def_id, entity_id, access_code_id, participant_user_id, value)
           SELECT x.def_id, x.entity_id, $1::uuid, x.entity_id, x.value
             FROM unnest($2::uuid[], $3::uuid[], $4::jsonb[]) AS x(def_id, entity_id, value)
           ON CONFLICT (def_id, entity_id) DO UPDATE SET value = EXCLUDED.value
           WHERE custom_field_value.value IS DISTINCT FROM EXCLUDED.value`,
  /** $2 def ids, $3 participant ids. */
  clear: `DELETE FROM custom_field_value v USING unnest($2::uuid[], $3::uuid[]) AS x(def_id, entity_id)
            WHERE v.access_code_id = $1::uuid AND v.def_id = x.def_id AND v.entity_id = x.entity_id`,
};

/** The key a cell error is reported under: "<participant id>:<field key>". */
export const cellKey = (entityId: string, key: string) => `${entityId.toLowerCase()}:${key}`;

/**
 * Set or clear values on MANY people at once: the People grid (an edit, a
 * paste, a fill, a clear). ALL OR NOTHING: every cell is checked first (the
 * field exists and takes answers, the value fits the field, the person is in
 * reach); one bad cell and nothing is written, and every bad cell comes back
 * with its own plain reason. Then one transaction writes them all. The
 * database's reach policy and guard check every row again, and its triggers
 * log each change and keep each earlier answer.
 *
 * `fromGrid`: the organization may keep filling in fields to the person's
 * page (customization policy `grid_edit`, 108).
 */
export async function setFieldValuesBatch(
  actor: OrgActor,
  items: { entityId: string; values: Record<string, unknown> }[],
  opts: { fromGrid?: boolean; gridAllowed?: boolean } = {},
): Promise<BatchValuesResult> {
  if (!canWriteFieldValues(actor)) return { ok: false, error: "You do not have access to that." };
  if (opts.fromGrid && opts.gridAllowed === false) {
    return { ok: false, error: "Your organization has fields filled in on each person's page, not in the grid. If it should change, ask whoever manages your organization's settings." };
  }
  if (!Array.isArray(items) || !items.length) return { ok: false, error: "Nothing to save." };
  if (items.length > MAX_BATCH_RECORDS) return { ok: false, error: `Change at most ${MAX_BATCH_RECORDS} people at a time.` };
  const cells: { entityId: string; key: string; raw: unknown }[] = [];
  for (const it of items) {
    if (!it || typeof it.entityId !== "string" || !UUID.test(it.entityId) || !it.values || typeof it.values !== "object" || Array.isArray(it.values)) {
      return { ok: false, error: "Some of those rows are not people on your list." };
    }
    for (const [key, raw] of Object.entries(it.values)) cells.push({ entityId: it.entityId.toLowerCase(), key, raw });
  }
  if (!cells.length) return { ok: false, error: "Nothing to save." };
  if (cells.length > MAX_BATCH_CELLS) return { ok: false, error: `Change at most ${MAX_BATCH_CELLS.toLocaleString("en-US")} cells at a time.` };

  const ids = Array.from(new Set(cells.map((c) => c.entityId)));
  const defs = await listFieldDefs(actor, { entity: "participant", includeRetired: true });
  const byKey = new Map(defs.map((d) => [d.key, d]));
  const seesAll = actor.capabilities.has("org.client.view_all");
  const units = await unitReachAvailable(actor);
  let reached: Set<string>;
  try {
    const [rows] = await runScoped<[{ id: string }[]]>(scopeOf(actor), (sql) => [
      run(sql)(`SELECT x.id::text AS id FROM unnest($4::uuid[]) AS x(id) WHERE ${reachSql("x.id", units)}`, [actor.orgId, seesAll, actor.userId, ids]),
    ]);
    reached = new Set(rows.map((r) => r.id.toLowerCase()));
  } catch (err) {
    if (isCustomizationTableMissing(err)) return { ok: false, error: "Custom fields are not switched on yet for this workspace." };
    throw err;
  }
  const current = await getFieldValues(actor, "participant", { entityIds: ids.filter((i) => reached.has(i)) });
  const needsStaff = cells.some((c) => byKey.get(c.key)?.type === "staff_member");
  const staffIds = needsStaff ? new Set((await getOrgStaffDirectory(actor)).map((x) => x.id.toLowerCase())) : undefined;

  const cellErrors: Record<string, string> = {};
  const upserts: { defId: string; entityId: string; value: CustomFieldValue }[] = [];
  const clears: { defId: string; entityId: string }[] = [];
  for (const c of cells) {
    const k = cellKey(c.entityId, c.key);
    if (!reached.has(c.entityId)) { cellErrors[k] = "That person is not on your caseload."; continue; }
    const def = byKey.get(c.key);
    if (!def) { cellErrors[k] = "That field no longer exists."; continue; }
    if (def.retiredAt) { cellErrors[k] = `${def.label} is retired. Its old answers stay, but it takes no new ones.`; continue; }
    const prev = current[c.entityId]?.[c.key];
    const keepRetired = typeof prev === "string" ? [prev] : Array.isArray(prev) ? prev.map(String) : [];
    const res = validateCustomFieldValue(def, c.raw, { staffIds, allowRetiredOption: keepRetired });
    if (!res.ok) { cellErrors[k] = res.error; continue; }
    if (res.value === null) { if (prev !== undefined) clears.push({ defId: def.id, entityId: c.entityId }); }
    else if (JSON.stringify(prev) !== JSON.stringify(res.value)) upserts.push({ defId: def.id, entityId: c.entityId, value: res.value });
  }
  const bad = Object.keys(cellErrors).length;
  if (bad) return { ok: false, error: bad === 1 ? "Nothing was saved. One cell needs a fix." : `Nothing was saved. ${bad} cells need a fix.`, cellErrors };
  if (upserts.length || clears.length) {
    try {
      // Two statements whatever the size: one upsert over unnest, one delete.
      await runScoped(scopeOf(actor), (sql) => [
        ...(upserts.length ? [run(sql)(
          CUSTOM_FIELD_BATCH_SQL.upsert,
          [actor.orgId, upserts.map((u) => u.defId), upserts.map((u) => u.entityId), upserts.map((u) => JSON.stringify(u.value))],
        )] : []),
        ...(clears.length ? [run(sql)(
          CUSTOM_FIELD_BATCH_SQL.clear,
          [actor.orgId, clears.map((c) => c.defId), clears.map((c) => c.entityId)],
        )] : []),
      ]);
    } catch (err) {
      return { ok: false, error: plainDbError(err, "Nothing was saved. Try again.") };
    }
  }
  const after = await getFieldValues(actor, "participant", { entityIds: ids });
  return { ok: true, values: after, written: upserts.length + clears.length };
}

/* ------------------------------------------------------------ value history -- */

export interface FieldValueVersion {
  key: string; value: CustomFieldValue; setBy: string | null; setAt: string | null;
  change: "changed" | "cleared"; replacedBy: string | null; replacedAt: string;
}

/** Who may see earlier answers: people who manage the organization's settings. */
export const canSeeFieldHistory = (a: OrgActor) => canManageFields(a);

/**
 * Earlier answers on ONE record, newest first (custom_field_value_version,
 * 104: kept by a trigger whenever a value is overwritten or cleared). For
 * managers only, and only within reach (app check here, the reach policy in
 * the database).
 */
export async function getFieldValueHistory(actor: OrgActor, entity: CustomFieldEntity, entityId: string): Promise<FieldValueVersion[]> {
  if (!canSeeFieldHistory(actor) || !isCustomFieldEntity(entity) || !UUID.test(entityId)) return [];
  const units = await unitReachAvailable(actor);
  try {
    const [rows] = await runScoped<[{ key: string; value: CustomFieldValue; set_by: string | null; set_at: string | null; change: "changed" | "cleared"; replaced_by: string | null; replaced_at: string }[]]>(scopeOf(actor), (sql) => [
      run(sql)(
        `SELECT d.key, h.value, h.set_by, h.set_at, h.change, h.replaced_by, h.replaced_at
           FROM custom_field_value_version h JOIN custom_field_def d ON d.id = h.def_id
          WHERE h.access_code_id = $1::uuid AND d.access_code_id = $1::uuid AND d.entity = $4 AND h.entity_id = $5::uuid
            AND ${reachSql("h.participant_user_id", units)}
          ORDER BY h.replaced_at DESC, h.id DESC LIMIT 200`,
        [actor.orgId, actor.capabilities.has("org.client.view_all"), actor.userId, entity, entityId],
      ),
    ]);
    return rows.map((r) => ({ key: r.key, value: r.value, setBy: r.set_by, setAt: r.set_at ? String(r.set_at) : null, change: r.change, replacedBy: r.replaced_by, replacedAt: String(r.replaced_at) }));
  } catch (err) {
    if (isCustomizationTableMissing(err)) return [];
    throw err;
  }
}

/* ------------------------------------------------------------- enrollments -- */

export interface EnrollmentSummary { id: string; programName: string | null; status: string; enrolledOn: string | null; exitedOn: string | null }

/**
 * A person's enrollments (103), for showing their custom fields. Returns
 * null when 103 is not applied in this database, so the page can say nothing
 * rather than an error.
 */
export async function listParticipantEnrollments(actor: OrgActor, participantId: string): Promise<EnrollmentSummary[] | null> {
  if (!canReadFieldValues(actor) || !UUID.test(participantId)) return [];
  try {
    const [exists] = await runScoped<[{ e: boolean; u: boolean }[]]>(scopeOf(actor), (sql) => [
      run(sql)(`SELECT to_regclass('public.enrollment') IS NOT NULL AS e, to_regclass('public.org_unit') IS NOT NULL AS u`, []),
    ]);
    if (!exists[0]?.e) return null;
    const units = exists[0].u && (await unitReachAvailable(actor));
    const unitJoin = exists[0].u ? `LEFT JOIN org_unit ou ON ou.id = e.org_unit_id AND ou.access_code_id = e.access_code_id` : "";
    const [rows] = await runScoped<[{ id: string; program_name: string | null; status: string; enrolled_on: string | null; exited_on: string | null }[]]>(scopeOf(actor), (sql) => [
      run(sql)(
        `SELECT e.id, ${exists[0].u ? "ou.name" : "NULL::text"} AS program_name, e.status,
                to_char(e.enrolled_on, 'YYYY-MM-DD') AS enrolled_on, to_char(e.exited_on, 'YYYY-MM-DD') AS exited_on
           FROM enrollment e ${unitJoin}
          WHERE e.access_code_id = $1::uuid AND e.participant_user_id = $4::uuid AND ${reachSql("e.participant_user_id", units)}
          ORDER BY e.enrolled_on DESC NULLS LAST LIMIT 50`,
        [actor.orgId, actor.capabilities.has("org.client.view_all"), actor.userId, participantId],
      ),
    ]);
    return rows.map((r) => ({ id: r.id, programName: r.program_name, status: r.status, enrolledOn: r.enrolled_on, exitedOn: r.exited_on }));
  } catch (err) {
    if (isCustomizationTableMissing(err)) return null;
    // A column 103 named differently must not break the person's page.
    return null;
  }
}
