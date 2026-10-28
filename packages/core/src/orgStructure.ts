/**
 * Organization structure, the database half (migration 103, house lane L3a):
 * the profile (type, words, modules, setup), the unit tree, who works in which
 * unit, and enrollments.
 *
 * Every statement runs inside runScoped (org scope + user id) or runAsUser, so
 * the 103 policies decide what is visible and writable: the org boundary, the
 * owner-or-admin rule for structure, the enrollment writer rule, and REACH on
 * every enrollment row. The capability checks here are the friendly first
 * answer and keep a platform admin acting for an organization read-only; the
 * tables are the control.
 *
 * The SQL strings are exported (ORG_STRUCTURE_SQL) so the pglite test
 * (apps/consumer/lib/__tests__/org-structure-pglite.test.ts) runs these exact
 * statements against the real schema as the app role.
 */
import { randomUUID } from "node:crypto";
import { runAsUser, runScoped, type OrgScope } from "./db";
import { unitReachSql } from "./orgUnitReach";
import type { OrgActor } from "./authz/resolveOrgActor";
import {
  DEFAULT_TIMEZONE, ENROLLABLE_KINDS, ENROLLMENT_STATUS_LABELS, PROGRAM_ID_PATTERN, START_STATUSES, UNIT_NAME_MAX,
  canMoveEnrollment, checkUnitTree, labelProblem, LABEL_PROBLEM, DONE_ENROLLMENT_STATUSES, defaultOrgProfile, flattenUnitTree, isEnrollmentStatus, isOrgType,
  isStatusReason, isTimezoneLike, isUnitKind, isUnitRole, normalizeTerms, reasonsFor, resolveOrgModules, resolveOrgTerms,
  ORG_MODULES, storedOrgModules,
  type EnrollmentStatus, type OrgModules, type OrgProfile, type OrgTerms, type OrgType, type StatusReason,
  type UnitDraft, type UnitKind, type UnitRole,
} from "./orgStructureShared";

export * from "./orgStructureShared";

type Raw = (s: string, p?: unknown[]) => unknown;
const run = (sql: unknown) => sql as Raw;
const scopeOf = (a: Pick<OrgActor, "orgId" | "userId" | "role">): OrgScope => ({ orgId: a.orgId, userId: a.userId, role: a.role });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const OPEN = `('referred', 'enrolled', 'active', 'paused')`;

export type StructureResult<T = Record<never, never>> =
  | ({ ok: true } & T)
  | { ok: false; error: string; status: 400 | 403 | 404 | 409 | 503 };

const REFUSED = { ok: false as const, error: "You do not have access to that.", status: 403 as const };
const NOT_READY = { ok: false as const, error: "Programs and structure are not switched on yet. Try again after the next update.", status: 503 as const };
const bad = (error: string) => ({ ok: false as const, error, status: 400 as const });
const missing = (error = "That was not found, or it is not yours to change.") => ({ ok: false as const, error, status: 404 as const });

/** Structure writes: org.settings.manage, never a platform admin acting for the org. */
export const canManageStructure = (a: Pick<OrgActor, "viaPlatformAdmin" | "capabilities">) =>
  !a.viaPlatformAdmin && a.capabilities.has("org.settings.manage");
/** Enrollment writes: org.enrollment.write, never a platform admin acting for the org. */
export const canWriteEnrollments = (a: Pick<OrgActor, "viaPlatformAdmin" | "capabilities">) =>
  !a.viaPlatformAdmin && a.capabilities.has("org.enrollment.write");
/**
 * Creating an enrollment, reopening a finished one, or choosing its primary
 * staff member shows a person to more staff: the assign power (review B1).
 * The database refuses the same (smr_enrollment_assigner, deny wins).
 */
export const canAssignEnrollments = (a: Pick<OrgActor, "viaPlatformAdmin" | "capabilities">) =>
  !a.viaPlatformAdmin && a.capabilities.has("org.client.assign");
/** Reading the structure (units, words): anyone on staff. */
export const canReadStructure = (a: Pick<OrgActor, "capabilities">) => a.capabilities.has("org.cohort.view");

function isMissingTable(err: unknown): boolean {
  const code = (err as { code?: string })?.code;
  const message = String((err as { message?: string })?.message ?? "");
  return code === "42P01" || /relation "(org_profile|org_unit|unit_member|enrollment)" does not exist/.test(message);
}

/**
 * A database refusal in plain words. 103's own RAISE messages are written for
 * people and pass through; built-in constraint text never does.
 */
export function explainStructureError(err: unknown): { ok: false; error: string; status: 400 | 403 | 409 | 503 } {
  if (isMissingTable(err)) return NOT_READY;
  const code = (err as { code?: string })?.code;
  const message = String((err as { message?: string })?.message ?? "");
  // 109 (review round 2): the AI switch is the owner's alone.
  if (/ai_assist_owner_only/.test(message)) return { ok: false, error: "Only the owner turns t.ROY on or off for your organization.", status: 403 };
  if (code === "42501" || /row-level security|permission denied/i.test(message)) return REFUSED;
  if (code === "23505") {
    if (/enrollment_one_open/.test(message)) return { ok: false, error: "They are already in that one. Change the status on the one they have.", status: 409 };
    return { ok: false, error: "There is already an open group with that name in the same place. Pick another name.", status: 409 };
  }
  if (code === "22023" || /time zone/i.test(message)) return bad("That time zone is not one we know.");
  if (code === "23514" || code === "P0001") {
    if (/violates check constraint|new row for relation/i.test(message)) return bad("That did not save. Check the details and try again.");
    const plain = message.replace(/^ERROR:\s*/i, "").trim();
    return bad(plain ? plain.charAt(0).toUpperCase() + plain.slice(1) + (/[.!?]$/.test(plain) ? "" : ".") : "That did not save.");
  }
  if (code === "23503") return bad("Something it points to is gone. Reload and try again.");
  console.error("[orgStructure] write failed:", code, message.slice(0, 200));
  return { ok: false, error: "That did not save. Nothing was changed.", status: 400 };
}

/* --------------------------------------------------------------- SQL ---- */

export const ORG_STRUCTURE_SQL = {
  /** $1 org */
  readProfile: `SELECT org_type, display_name, timezone, terminology, modules, setup_completed_at
       FROM org_profile WHERE access_code_id = $1::uuid`,
  /** $1 org, $2 type, $3 display name, $4 tz, $5 terms json, $6 modules json, $7 mark setup complete */
  upsertProfile: `INSERT INTO org_profile (access_code_id, org_type, display_name, timezone, terminology, modules, setup_completed_at)
       VALUES ($1::uuid, $2, $3, $4, $5::jsonb, $6::jsonb, CASE WHEN $7::boolean THEN now() END)
       ON CONFLICT (access_code_id) DO UPDATE
         SET org_type = EXCLUDED.org_type, display_name = EXCLUDED.display_name, timezone = EXCLUDED.timezone,
             terminology = EXCLUDED.terminology, modules = EXCLUDED.modules,
             setup_completed_at = CASE WHEN $7::boolean THEN COALESCE(org_profile.setup_completed_at, now()) ELSE org_profile.setup_completed_at END
       RETURNING access_code_id`,
  /** $1 org */
  listUnits: `SELECT u.id, u.parent_id, u.kind, u.name, u.short_code, u.description,
            to_char(u.starts_on, 'YYYY-MM-DD') AS starts_on, to_char(u.ends_on, 'YYYY-MM-DD') AS ends_on,
            u.status, u.capacity, u.created_at, u.closed_at,
            (SELECT count(*)::int FROM unit_member m WHERE m.org_unit_id = u.id) AS staff_count,
            (SELECT count(*)::int FROM enrollment e WHERE e.org_unit_id = u.id AND e.status IN ${OPEN}) AS open_enrollments
       FROM org_unit u WHERE u.access_code_id = $1::uuid
      ORDER BY (u.status = 'closed'), lower(u.name)`,
  /** $1 org, $2 id, $3 parent, $4 kind, $5 name, $6 short code, $7 description, $8 starts, $9 ends, $10 capacity */
  insertUnit: `INSERT INTO org_unit (id, access_code_id, parent_id, kind, name, short_code, description, starts_on, ends_on, capacity)
       VALUES ($2::uuid, $1::uuid, $3::uuid, $4, $5, $6, $7, $8::date, $9::date, $10::int)
       RETURNING id`,
  /**
   * Setup's batch insert: written only while the organization has no units
   * other than this batch ($11 the batch ids), so a second setup, or two
   * admins finishing at once, never doubles the tree.
   */
  insertSetupUnit: `INSERT INTO org_unit (id, access_code_id, parent_id, kind, name)
       SELECT $2::uuid, $1::uuid, $3::uuid, $4, $5
        WHERE NOT EXISTS (SELECT 1 FROM org_unit x WHERE x.access_code_id = $1::uuid AND NOT (x.id = ANY($6::uuid[])))
       RETURNING id`,
  /** $1 org, $2 unit, $3 name, $4 kind, $5 short code, $6 description, $7 starts, $8 ends, $9 capacity */
  updateUnit: `UPDATE org_unit SET name = $3, kind = $4, short_code = $5, description = $6,
            starts_on = $7::date, ends_on = $8::date, capacity = $9::int
       WHERE access_code_id = $1::uuid AND id = $2::uuid RETURNING id`,
  /** $1 org, $2 unit, $3 new parent (NULL = top) */
  moveUnit: `UPDATE org_unit SET parent_id = $3::uuid WHERE access_code_id = $1::uuid AND id = $2::uuid RETURNING id`,
  /** $1 org, $2 unit, $3 'active' | 'closed' */
  setUnitStatus: `UPDATE org_unit SET status = $3 WHERE access_code_id = $1::uuid AND id = $2::uuid AND status <> $3 RETURNING id`,
  /** $1 org */
  listMembers: `SELECT m.org_unit_id, m.user_id, m.role_in_unit, m.added_at, u.name
       FROM unit_member m LEFT JOIN users u ON u.id = m.user_id
      WHERE m.access_code_id = $1::uuid ORDER BY lower(coalesce(u.name, ''))`,
  /** $1 org, $2 unit, $3 user, $4 role */
  upsertMember: `INSERT INTO unit_member (org_unit_id, user_id, access_code_id, role_in_unit)
       VALUES ($2::uuid, $3::uuid, $1::uuid, $4)
       ON CONFLICT (org_unit_id, user_id) DO UPDATE SET role_in_unit = EXCLUDED.role_in_unit
       RETURNING org_unit_id`,
  /** $1 org, $2 unit, $3 user */
  removeMember: `DELETE FROM unit_member WHERE access_code_id = $1::uuid AND org_unit_id = $2::uuid AND user_id = $3::uuid RETURNING org_unit_id`,
  /** $1 org. The owner and every staff row: who can be put in a unit. */
  listStaff: `SELECT ac.partner_user_id AS user_id, u.name, 'owner' AS role, false AS volunteer
       FROM access_code ac JOIN users u ON u.id = ac.partner_user_id WHERE ac.id = $1::uuid
     UNION ALL
     SELECT s.user_id, u.name, s.role,
            (EXISTS (SELECT 1 FROM org_capability_override o WHERE o.org_id = $1::uuid AND o.user_id = s.user_id
                       AND o.capability = 'org.participant.invite' AND o.effect = 'deny')
             AND EXISTS (SELECT 1 FROM org_capability_override o WHERE o.org_id = $1::uuid AND o.user_id = s.user_id
                       AND o.capability = 'org.outcome.write' AND o.effect = 'deny')) AS volunteer
       FROM org_staff s JOIN users u ON u.id = s.user_id
      WHERE s.access_code_id = $1::uuid AND s.user_id IS DISTINCT FROM (SELECT partner_user_id FROM access_code WHERE id = $1::uuid)`,
  /** $1 org, $2 participant or NULL, $3 unit or NULL, $4 include finished, $5 actor sees everyone, $6 actor. App-side reach as every other read (the policy is the first wall). */
  listEnrollments: `SELECT e.id, e.org_unit_id, u.name AS unit_name, u.kind AS unit_kind, u.status AS unit_status,
            e.participant_user_id, e.status, to_char(e.enrolled_on, 'YYYY-MM-DD') AS enrolled_on,
            to_char(e.exited_on, 'YYYY-MM-DD') AS exited_on, e.exit_reason, e.status_reason,
            e.primary_staff_id, ps.name AS primary_staff_name, e.program_participant_id, e.created_at, e.updated_at
       FROM enrollment e
       JOIN org_unit u ON u.id = e.org_unit_id
       LEFT JOIN users ps ON ps.id = e.primary_staff_id
      WHERE e.access_code_id = $1::uuid
        AND ($2::uuid IS NULL OR e.participant_user_id = $2::uuid)
        AND ($3::uuid IS NULL OR e.org_unit_id = $3::uuid)
        AND ($4::boolean OR e.status IN ${OPEN})
        AND ($5::boolean OR EXISTS (SELECT 1 FROM client_staff_assignment a
                                     WHERE a.access_code_id = $1::uuid AND a.client_user_id = e.participant_user_id AND a.staff_user_id = $6::uuid)
             OR ${unitReachSql("$1::uuid", "$6::uuid", "e.participant_user_id")})
      ORDER BY (e.status IN ${OPEN}) DESC, e.updated_at DESC
      LIMIT 500`,
  /** $1 org, $2 unit, $3 participant, $4 status, $5 primary staff, $6 program id, $7 enrolled on */
  insertEnrollment: `INSERT INTO enrollment (access_code_id, org_unit_id, participant_user_id, status, primary_staff_id, program_participant_id, enrolled_on)
       VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5::uuid, $6, $7::date)
       RETURNING id`,
  /** $1 org, $2 enrollment, $3 status, $4 reason */
  moveEnrollment: `UPDATE enrollment SET status = $3, status_reason = $4
       WHERE access_code_id = $1::uuid AND id = $2::uuid RETURNING id, status`,
  /** $1 org, $2 enrollment, $3 primary staff, $4 program id, $5 enrolled on */
  updateEnrollment: `UPDATE enrollment SET primary_staff_id = $3::uuid, program_participant_id = $4, enrolled_on = COALESCE($5::date, enrolled_on)
       WHERE access_code_id = $1::uuid AND id = $2::uuid RETURNING id`,
  /** $1 org, $2 enrollment */
  readEnrollment: `SELECT id, status, primary_staff_id, program_participant_id FROM enrollment WHERE access_code_id = $1::uuid AND id = $2::uuid`,
  /** $1 org, $2 enrollment */
  readEnrollmentStatus: `SELECT status FROM enrollment WHERE access_code_id = $1::uuid AND id = $2::uuid`,
} as const;

/* ------------------------------------------------------------ profile -- */

interface ProfileRow { org_type: string; display_name: string | null; timezone: string; terminology: unknown; modules: unknown; setup_completed_at: string | null }

function toProfile(orgId: string, row: ProfileRow | undefined): OrgProfile {
  if (!row) return defaultOrgProfile(orgId);
  return {
    orgId,
    orgType: isOrgType(row.org_type) ? row.org_type : "other",
    displayName: row.display_name,
    timezone: row.timezone || DEFAULT_TIMEZONE,
    terms: resolveOrgTerms(row.terminology),
    modules: resolveOrgModules(row.modules),
    setupCompletedAt: row.setup_completed_at ? new Date(row.setup_completed_at).toISOString() : null,
    saved: true,
  };
}

/** The organization's profile as this actor's scope sees it; defaults when there is none (or 103 is not applied). */
export async function getOrgProfile(actor: Pick<OrgActor, "orgId" | "userId" | "role">): Promise<OrgProfile> {
  try {
    const [rows] = await runScoped<[ProfileRow[]]>(scopeOf(actor), (sql) => [run(sql)(ORG_STRUCTURE_SQL.readProfile, [actor.orgId])]);
    return toProfile(actor.orgId, rows[0]);
  } catch (err) {
    if (isMissingTable(err)) return defaultOrgProfile(actor.orgId);
    throw err;
  }
}

/**
 * The organization's words for anyone who belongs to it (staff, the owner,
 * members). Safe defaults on every failure: a screen must never go blank or
 * error because the words could not be read.
 */
export async function getOrgTerms(orgId: string, userId: string): Promise<OrgTerms> {
  if (!UUID.test(orgId) || !UUID.test(userId)) return resolveOrgTerms(null);
  try {
    const out = await runAsUser<[ProfileRow[]]>(userId, (c) => [run(c)(ORG_STRUCTURE_SQL.readProfile, [orgId])]);
    return resolveOrgTerms(out[0]?.[0]?.terminology);
  } catch {
    return resolveOrgTerms(null);
  }
}

export interface ProfilePatch {
  orgType?: unknown; displayName?: unknown; timezone?: unknown; terms?: unknown; modules?: unknown;
}

/** Validate a patch over the current profile. Pure, exported for tests. */
export function applyProfilePatch(current: OrgProfile, patch: ProfilePatch):
  { ok: true; next: Omit<OrgProfile, "saved" | "setupCompletedAt" | "orgId"> } | { ok: false; error: string; fields?: Record<string, string> } {
  const next = { orgType: current.orgType, displayName: current.displayName, timezone: current.timezone, terms: { ...current.terms }, modules: { ...current.modules } };
  if (patch.orgType !== undefined) {
    if (!isOrgType(patch.orgType)) return { ok: false, error: "Pick what kind of organization this is." };
    next.orgType = patch.orgType;
  }
  if (patch.displayName !== undefined) {
    if (patch.displayName === null || patch.displayName === "") next.displayName = null;
    else if (typeof patch.displayName !== "string" || patch.displayName.trim().length > 120) return { ok: false, error: "Keep the name to 120 characters." };
    else next.displayName = patch.displayName.trim() || null;
  }
  if (patch.timezone !== undefined) {
    if (!isTimezoneLike(patch.timezone)) return { ok: false, error: "That time zone is not one we know." };
    next.timezone = patch.timezone;
  }
  if (patch.terms !== undefined) {
    const { terms, problems } = normalizeTerms(patch.terms);
    if (problems.length) return { ok: false, error: problems[0].message, fields: Object.fromEntries(problems.map((p) => [p.key, p.message])) };
    next.terms = resolveOrgTerms(terms);
  }
  if (patch.modules !== undefined) {
    if (!patch.modules || typeof patch.modules !== "object" || Array.isArray(patch.modules)) return { ok: false, error: "Modules are on or off." };
    const m = { ...next.modules } as OrgModules;
    for (const k of ORG_MODULES) {
      const v = (patch.modules as Record<string, unknown>)[k];
      if (v !== undefined) {
        if (typeof v !== "boolean") return { ok: false, error: "Modules are on or off." };
        m[k] = v;
      }
    }
    next.modules = m;
  }
  return { ok: true, next };
}

/** Only the words that differ from the default are stored. */
function storedTerms(terms: OrgTerms): Record<string, string> {
  return normalizeTerms(terms).terms as Record<string, string>;
}

/** Change type, name, time zone, words or modules (org.settings.manage). */
export async function updateOrgProfile(actor: OrgActor, patch: ProfilePatch): Promise<StructureResult<{ profile: OrgProfile }>> {
  if (!canManageStructure(actor)) return REFUSED;
  const current = await getOrgProfile(actor);
  const checked = applyProfilePatch(current, patch);
  if (!checked.ok) return bad(checked.error);
  const n = checked.next;
  try {
    const [rows] = await runScoped<[{ access_code_id: string }[]]>(scopeOf(actor), (sql) => [
      run(sql)(ORG_STRUCTURE_SQL.upsertProfile, [actor.orgId, n.orgType, n.displayName, n.timezone,
        JSON.stringify(storedTerms(n.terms)), JSON.stringify(storedOrgModules(n.modules)), false]),
    ]);
    if (!rows.length) return REFUSED;
    return { ok: true, profile: { ...current, ...n, saved: true } };
  } catch (err) {
    return explainStructureError(err);
  }
}

export interface SetupInput extends ProfilePatch { units?: unknown }

/**
 * Finish the setup wizard: the profile, marked complete, and the starting unit
 * tree, in ONE transaction. Units are written only when the organization has
 * none yet; otherwise the tree is left alone (it is changed on Structure).
 */
export async function completeOrgSetup(actor: OrgActor, input: SetupInput):
  Promise<StructureResult<{ profile: OrgProfile; unitsCreated: number; unitsSkipped: boolean }>> {
  if (!canManageStructure(actor)) return REFUSED;
  const current = await getOrgProfile(actor);
  const checked = applyProfilePatch(current, input);
  if (!checked.ok) return bad(checked.error);
  const n = checked.next;

  let units: UnitDraft[] = [];
  if (input.units !== undefined && input.units !== null) {
    if (!Array.isArray(input.units)) return bad("The groups did not come through. Try again.");
    units = input.units as UnitDraft[];
    const problems = checkUnitTree(units);
    if (problems.length) return bad(problems[0].message);
  }
  const flat = flattenUnitTree(units);
  const ids = flat.map(() => randomUUID());
  try {
    const out = await runScoped<unknown[][]>(scopeOf(actor), (sql) => [
      run(sql)(ORG_STRUCTURE_SQL.upsertProfile, [actor.orgId, n.orgType, n.displayName, n.timezone,
        JSON.stringify(storedTerms(n.terms)), JSON.stringify(storedOrgModules(n.modules)), true]),
      ...flat.map((u, i) => run(sql)(ORG_STRUCTURE_SQL.insertSetupUnit, [
        actor.orgId, ids[i], u.parentIndex === null ? null : ids[u.parentIndex], u.kind, u.name, ids,
      ])),
    ]);
    if (!(out[0] as unknown[]).length) return REFUSED;
    const created = out.slice(1).filter((r) => (r as unknown[]).length > 0).length;
    // Partial would mean the guard skipped a parent but not a child; it cannot,
    // since the guard is the same for every row in one transaction.
    return {
      ok: true,
      profile: { ...current, ...n, saved: true, setupCompletedAt: current.setupCompletedAt ?? new Date().toISOString() },
      unitsCreated: created,
      unitsSkipped: flat.length > 0 && created === 0,
    };
  } catch (err) {
    return explainStructureError(err);
  }
}

/* --------------------------------------------------------------- units -- */

export interface OrgUnitRow {
  id: string; parent_id: string | null; kind: UnitKind; name: string; short_code: string | null; description: string | null;
  starts_on: string | null; ends_on: string | null; status: "active" | "closed"; capacity: number | null;
  created_at: string; closed_at: string | null; staff_count: number; open_enrollments: number;
}
export interface UnitMemberRow { org_unit_id: string; user_id: string; role_in_unit: UnitRole; added_at: string; name: string | null }
export interface OrgStaffOption { user_id: string; name: string | null; role: "owner" | "org_admin" | "staff"; volunteer?: boolean }

/**
 * The tree, every member of every unit, and who can be added. Counts of
 * people are what THIS viewer reaches (the enrollment rows pass the reach
 * policy); `countsArePartial` says so for someone who does not see everyone.
 */
export async function getOrgStructure(actor: OrgActor): Promise<
  { units: OrgUnitRow[]; members: UnitMemberRow[]; staff: OrgStaffOption[]; countsArePartial: boolean; ready: boolean } | null> {
  if (!canReadStructure(actor)) return null;
  try {
    const [units, members, staff] = await runScoped<[OrgUnitRow[], UnitMemberRow[], OrgStaffOption[]]>(scopeOf(actor), (sql) => [
      run(sql)(ORG_STRUCTURE_SQL.listUnits, [actor.orgId]),
      run(sql)(ORG_STRUCTURE_SQL.listMembers, [actor.orgId]),
      run(sql)(ORG_STRUCTURE_SQL.listStaff, [actor.orgId]),
    ]);
    return { units, members, staff, countsArePartial: actor.reach !== "all" || actor.viaPlatformAdmin, ready: true };
  } catch (err) {
    if (isMissingTable(err)) return { units: [], members: [], staff: [], countsArePartial: false, ready: false };
    throw err;
  }
}

export interface UnitInput {
  kind?: unknown; name?: unknown; parentId?: unknown; shortCode?: unknown; description?: unknown;
  startsOn?: unknown; endsOn?: unknown; capacity?: unknown;
}

type CleanUnit = { kind: UnitKind; name: string; parentId: string | null; shortCode: string | null; description: string | null; startsOn: string | null; endsOn: string | null; capacity: number | null };

/** Validate unit fields. Pure, exported for tests. */
export function cleanUnitInput(input: UnitInput, base?: Partial<CleanUnit>): { ok: true; unit: CleanUnit } | { ok: false; error: string } {
  const kind = input.kind ?? base?.kind;
  if (!isUnitKind(kind)) return { ok: false, error: "Pick what kind of group this is." };
  const nameRaw = input.name ?? base?.name;
  const name = typeof nameRaw === "string" ? nameRaw.trim().replace(/\s+/g, " ") : "";
  if (!name) return { ok: false, error: "Give it a name." };
  if (name.length > UNIT_NAME_MAX) return { ok: false, error: `Keep the name to ${UNIT_NAME_MAX} characters.` };
  if (labelProblem(name)) return { ok: false, error: LABEL_PROBLEM };
  const parentRaw = input.parentId === undefined ? base?.parentId ?? null : input.parentId;
  if (parentRaw !== null && parentRaw !== "" && (typeof parentRaw !== "string" || !UUID.test(parentRaw))) return { ok: false, error: "Pick where it sits." };
  const parentId = parentRaw ? String(parentRaw) : null;
  const opt = (v: unknown, b: string | null | undefined) => (v === undefined ? b ?? null : v === null || v === "" ? null : v);
  const shortCode = opt(input.shortCode, base?.shortCode);
  if (shortCode !== null && (typeof shortCode !== "string" || !/^[A-Za-z0-9][A-Za-z0-9-]{0,15}$/.test(shortCode))) return { ok: false, error: "A short code is up to 16 letters, numbers or dashes." };
  const description = opt(input.description, base?.description);
  if (description !== null && (typeof description !== "string" || description.length > 500)) return { ok: false, error: "Keep the description to 500 characters." };
  if (labelProblem(description as string | null)) return { ok: false, error: LABEL_PROBLEM };
  const startsOn = opt(input.startsOn, base?.startsOn);
  const endsOn = opt(input.endsOn, base?.endsOn);
  for (const d of [startsOn, endsOn]) if (d !== null && (typeof d !== "string" || !DAY.test(d) || Number.isNaN(Date.parse(d)))) return { ok: false, error: "Dates look like 2026-11-02." };
  if (startsOn && endsOn && String(endsOn) < String(startsOn)) return { ok: false, error: "It cannot end before it starts." };
  const capRaw = input.capacity === undefined ? base?.capacity ?? null : input.capacity;
  let capacity: number | null = null;
  if (capRaw !== null && capRaw !== "") {
    const c = Number(capRaw);
    if (!Number.isInteger(c) || c < 1 || c > 100000) return { ok: false, error: "Capacity is a whole number of people, or leave it blank." };
    capacity = c;
  }
  return { ok: true, unit: { kind, name, parentId, shortCode: shortCode as string | null, description: (description as string | null)?.trim() || null, startsOn: startsOn as string | null, endsOn: endsOn as string | null, capacity } };
}

export async function createOrgUnit(actor: OrgActor, input: UnitInput): Promise<StructureResult<{ id: string }>> {
  if (!canManageStructure(actor)) return REFUSED;
  const c = cleanUnitInput(input);
  if (!c.ok) return bad(c.error);
  const u = c.unit;
  const id = randomUUID();
  try {
    const [rows] = await runScoped<[{ id: string }[]]>(scopeOf(actor), (sql) => [
      run(sql)(ORG_STRUCTURE_SQL.insertUnit, [actor.orgId, id, u.parentId, u.kind, u.name, u.shortCode, u.description, u.startsOn, u.endsOn, u.capacity]),
    ]);
    return rows[0] ? { ok: true, id: rows[0].id } : REFUSED;
  } catch (err) {
    return explainStructureError(err);
  }
}

async function readUnit(actor: OrgActor, unitId: string): Promise<OrgUnitRow | null> {
  const s = await getOrgStructure(actor);
  return s?.units.find((u) => u.id === unitId) ?? null;
}

/** Rename and edit details (name, kind, short code, description, dates, capacity). */
export async function updateOrgUnit(actor: OrgActor, unitId: string, input: UnitInput): Promise<StructureResult<{ id: string }>> {
  if (!canManageStructure(actor)) return REFUSED;
  if (!UUID.test(unitId)) return missing();
  const cur = await readUnit(actor, unitId);
  if (!cur) return missing();
  const c = cleanUnitInput({ ...input, parentId: undefined }, {
    kind: cur.kind, name: cur.name, parentId: cur.parent_id, shortCode: cur.short_code, description: cur.description,
    startsOn: cur.starts_on, endsOn: cur.ends_on, capacity: cur.capacity,
  });
  if (!c.ok) return bad(c.error);
  const u = c.unit;
  try {
    const [rows] = await runScoped<[{ id: string }[]]>(scopeOf(actor), (sql) => [
      run(sql)(ORG_STRUCTURE_SQL.updateUnit, [actor.orgId, unitId, u.name, u.kind, u.shortCode, u.description, u.startsOn, u.endsOn, u.capacity]),
    ]);
    return rows[0] ? { ok: true, id: unitId } : missing();
  } catch (err) {
    return explainStructureError(err);
  }
}

/** Move under another unit, or to the top (parentId null). Depth and cycles are checked by the database. */
export async function moveOrgUnit(actor: OrgActor, unitId: string, parentId: string | null): Promise<StructureResult<{ id: string }>> {
  if (!canManageStructure(actor)) return REFUSED;
  if (!UUID.test(unitId)) return missing();
  if (parentId !== null && !UUID.test(parentId)) return bad("Pick where it sits.");
  if (parentId === unitId) return bad("A group cannot sit inside itself.");
  try {
    const [rows] = await runScoped<[{ id: string }[]]>(scopeOf(actor), (sql) => [run(sql)(ORG_STRUCTURE_SQL.moveUnit, [actor.orgId, unitId, parentId])]);
    return rows[0] ? { ok: true, id: unitId } : missing();
  } catch (err) {
    return explainStructureError(err);
  }
}

/** Close (never delete) or reopen. Closing needs no open groups inside and nobody still enrolled. */
export async function setOrgUnitOpen(actor: OrgActor, unitId: string, open: boolean): Promise<StructureResult<{ id: string }>> {
  if (!canManageStructure(actor)) return REFUSED;
  if (!UUID.test(unitId)) return missing();
  try {
    const [rows] = await runScoped<[{ id: string }[]]>(scopeOf(actor), (sql) => [
      run(sql)(ORG_STRUCTURE_SQL.setUnitStatus, [actor.orgId, unitId, open ? "active" : "closed"]),
    ]);
    return rows[0] ? { ok: true, id: unitId } : missing(open ? "That group is already open, or it was not found." : "That group is already closed, or it was not found.");
  } catch (err) {
    return explainStructureError(err);
  }
}

/** Put a staff member in a unit (or change their role there). Leads and members then reach the people enrolled. */
export async function setUnitMember(actor: OrgActor, unitId: string, userId: string, role: unknown): Promise<StructureResult> {
  if (!canManageStructure(actor)) return REFUSED;
  if (!UUID.test(unitId) || !UUID.test(userId)) return missing();
  if (!isUnitRole(role)) return bad("Pick lead, member or viewer.");
  try {
    const [rows] = await runScoped<[unknown[]]>(scopeOf(actor), (sql) => [run(sql)(ORG_STRUCTURE_SQL.upsertMember, [actor.orgId, unitId, userId, role])]);
    return rows.length ? { ok: true } : REFUSED;
  } catch (err) {
    return explainStructureError(err);
  }
}

export async function removeUnitMember(actor: OrgActor, unitId: string, userId: string): Promise<StructureResult> {
  if (!canManageStructure(actor)) return REFUSED;
  if (!UUID.test(unitId) || !UUID.test(userId)) return missing();
  try {
    const [rows] = await runScoped<[unknown[]]>(scopeOf(actor), (sql) => [run(sql)(ORG_STRUCTURE_SQL.removeMember, [actor.orgId, unitId, userId])]);
    return rows.length ? { ok: true } : missing();
  } catch (err) {
    return explainStructureError(err);
  }
}

/* --------------------------------------------------------- enrollments -- */

export interface EnrollmentRow {
  id: string; org_unit_id: string; unit_name: string; unit_kind: UnitKind; unit_status: "active" | "closed";
  participant_user_id: string; status: EnrollmentStatus; enrolled_on: string | null; exited_on: string | null;
  exit_reason: StatusReason | null; status_reason: StatusReason | null; primary_staff_id: string | null; primary_staff_name: string | null;
  program_participant_id: string | null; created_at: string; updated_at: string;
}

/**
 * Enrollments this actor reaches (the reach policy filters the rows). For one
 * participant, one unit, or the whole organization. Never for a platform admin
 * acting for the organization: participant records are casework.
 */
export async function listEnrollments(actor: OrgActor, opts: { participantId?: string | null; unitId?: string | null; includeDone?: boolean } = {}):
  Promise<EnrollmentRow[] | null> {
  if (actor.viaPlatformAdmin || !canReadStructure(actor)) return null;
  const participant = opts.participantId && UUID.test(opts.participantId) ? opts.participantId : null;
  const unit = opts.unitId && UUID.test(opts.unitId) ? opts.unitId : null;
  if ((opts.participantId && !participant) || (opts.unitId && !unit)) return [];
  try {
    const [rows] = await runScoped<[EnrollmentRow[]]>(scopeOf(actor), (sql) => [
      run(sql)(ORG_STRUCTURE_SQL.listEnrollments, [actor.orgId, participant, unit, opts.includeDone !== false,
        actor.capabilities.has("org.client.view_all"), actor.userId]),
    ]);
    return rows;
  } catch (err) {
    if (isMissingTable(err)) return [];
    throw err;
  }
}

export interface EnrollmentInput {
  participantId?: unknown; unitId?: unknown; status?: unknown; primaryStaffId?: unknown; programParticipantId?: unknown; enrolledOn?: unknown;
}

/** Validate a new enrollment. Pure, exported for tests. */
export function cleanEnrollmentInput(input: EnrollmentInput):
  { ok: true; v: { participantId: string; unitId: string; status: EnrollmentStatus; primaryStaffId: string | null; programParticipantId: string | null; enrolledOn: string | null } }
  | { ok: false; error: string } {
  if (typeof input.participantId !== "string" || !UUID.test(input.participantId)) return { ok: false, error: "Pick the person." };
  if (typeof input.unitId !== "string" || !UUID.test(input.unitId)) return { ok: false, error: "Pick the program." };
  const status = input.status === undefined || input.status === null || input.status === "" ? "enrolled" : input.status;
  if (!isEnrollmentStatus(status) || !START_STATUSES.includes(status)) return { ok: false, error: "Start as referred, enrolled or active." };
  const staff = input.primaryStaffId === undefined || input.primaryStaffId === null || input.primaryStaffId === "" ? null : input.primaryStaffId;
  if (staff !== null && (typeof staff !== "string" || !UUID.test(staff))) return { ok: false, error: "Pick a staff member from the list." };
  const pid = cleanProgramId(input.programParticipantId);
  if (pid === false) return { ok: false, error: "Your own id uses letters, numbers, spaces and . _ / - (up to 40)." };
  const day = input.enrolledOn === undefined || input.enrolledOn === null || input.enrolledOn === "" ? null : input.enrolledOn;
  if (day !== null && (typeof day !== "string" || !DAY.test(day) || Number.isNaN(Date.parse(day)))) return { ok: false, error: "Dates look like 2026-11-02." };
  return { ok: true, v: { participantId: input.participantId, unitId: input.unitId, status, primaryStaffId: staff as string | null, programParticipantId: pid, enrolledOn: day as string | null } };
}

/** null = none; false = not allowed; string = cleaned. */
export function cleanProgramId(v: unknown): string | null | false {
  if (v === undefined || v === null) return null;
  if (typeof v !== "string") return false;
  const t = v.trim();
  if (!t) return null;
  return PROGRAM_ID_PATTERN.test(t) ? t : false;
}

export async function createEnrollment(actor: OrgActor, input: EnrollmentInput): Promise<StructureResult<{ id: string }>> {
  if (!canWriteEnrollments(actor) || !canAssignEnrollments(actor)) return REFUSED;
  const c = cleanEnrollmentInput(input);
  if (!c.ok) return bad(c.error);
  const v = c.v;
  try {
    const [rows] = await runScoped<[{ id: string }[]]>(scopeOf(actor), (sql) => [
      run(sql)(ORG_STRUCTURE_SQL.insertEnrollment, [actor.orgId, v.unitId, v.participantId, v.status, v.primaryStaffId, v.programParticipantId, v.enrolledOn]),
    ]);
    return rows[0] ? { ok: true, id: rows[0].id } : REFUSED;
  } catch (err) {
    const e = explainStructureError(err);
    // The reach policy refuses an INSERT for someone the writer does not reach.
    if (e.status === 403) return { ok: false, error: "That person is not on your list.", status: 403 };
    return e;
  }
}

/** Move an enrollment along (paused, finished, left...) with a reason from the plain list where one is asked. */
export async function changeEnrollmentStatus(actor: OrgActor, enrollmentId: string, to: unknown, reason?: unknown): Promise<StructureResult<{ status: EnrollmentStatus }>> {
  if (!canWriteEnrollments(actor)) return REFUSED;
  if (!UUID.test(enrollmentId)) return missing();
  if (!isEnrollmentStatus(to)) return bad("Pick a status.");
  let why: StatusReason | null = null;
  if (reason !== undefined && reason !== null && reason !== "") {
    if (!isStatusReason(reason) || reason === "left_organization") return bad("Pick a reason from the list.");
    why = reason;
  }
  const allowed = reasonsFor(to);
  if (allowed.length && !why) return bad("Pick a reason. It helps the next person who opens this.");
  if (why && allowed.length && !allowed.includes(why)) return bad("That reason does not fit this change. Pick one from the list.");
  try {
    const [cur] = await runScoped<[{ status: EnrollmentStatus }[]]>(scopeOf(actor), (sql) => [run(sql)(ORG_STRUCTURE_SQL.readEnrollmentStatus, [actor.orgId, enrollmentId])]);
    const from = cur[0]?.status;
    if (!from) return missing();
    if (from === to) return { ok: true, status: to };
    if (DONE_ENROLLMENT_STATUSES.includes(from) && !DONE_ENROLLMENT_STATUSES.includes(to) && !canAssignEnrollments(actor)) {
      return { ok: false, error: "Only someone who assigns people can reopen an enrollment.", status: 403 };
    }
    if (!canMoveEnrollment(from, to)) return bad(`It cannot go straight from ${ENROLLMENT_STATUS_LABELS[from].toLowerCase()} to ${ENROLLMENT_STATUS_LABELS[to].toLowerCase()}.`);
    const [rows] = await runScoped<[{ id: string; status: EnrollmentStatus }[]]>(scopeOf(actor), (sql) => [
      run(sql)(ORG_STRUCTURE_SQL.moveEnrollment, [actor.orgId, enrollmentId, to, why]),
    ]);
    return rows[0] ? { ok: true, status: rows[0].status } : missing();
  } catch (err) {
    return explainStructureError(err);
  }
}

/** Primary staff member, the organization's own id, the start date. */
export async function updateEnrollmentDetails(actor: OrgActor, enrollmentId: string, input: { primaryStaffId?: unknown; programParticipantId?: unknown; enrolledOn?: unknown }):
  Promise<StructureResult> {
  if (!canWriteEnrollments(actor)) return REFUSED;
  if (!UUID.test(enrollmentId)) return missing();
  let cur: { primary_staff_id: string | null; program_participant_id: string | null } | undefined;
  try {
    const [rows] = await runScoped<[{ primary_staff_id: string | null; program_participant_id: string | null }[]]>(scopeOf(actor), (sql) => [
      run(sql)(ORG_STRUCTURE_SQL.readEnrollment, [actor.orgId, enrollmentId]),
    ]);
    cur = rows[0];
  } catch (err) {
    return explainStructureError(err);
  }
  if (!cur) return missing();
  const staff = input.primaryStaffId === undefined ? cur.primary_staff_id : input.primaryStaffId === null || input.primaryStaffId === "" ? null : input.primaryStaffId;
  if (staff !== null && (typeof staff !== "string" || !UUID.test(staff))) return bad("Pick a staff member from the list.");
  if (staff !== null && staff !== cur.primary_staff_id && !canAssignEnrollments(actor)) {
    return { ok: false, error: "Only someone who assigns people can choose the staff member on an enrollment.", status: 403 };
  }
  const pid = input.programParticipantId === undefined ? cur.program_participant_id : cleanProgramId(input.programParticipantId);
  if (pid === false) return bad("Your own id uses letters, numbers, spaces and . _ / - (up to 40).");
  const day = input.enrolledOn === undefined || input.enrolledOn === null || input.enrolledOn === "" ? null : input.enrolledOn;
  if (day !== null && (typeof day !== "string" || !DAY.test(day) || Number.isNaN(Date.parse(day)))) return bad("Dates look like 2026-11-02.");
  try {
    const [rows] = await runScoped<[unknown[]]>(scopeOf(actor), (sql) => [
      run(sql)(ORG_STRUCTURE_SQL.updateEnrollment, [actor.orgId, enrollmentId, staff, pid, day]),
    ]);
    return rows.length ? { ok: true } : missing();
  } catch (err) {
    return explainStructureError(err);
  }
}

/** Units a person can be enrolled in, for pickers (open, enrollable kinds). Pure over the tree. */
export function enrollableUnits(units: readonly OrgUnitRow[]): OrgUnitRow[] {
  return units.filter((u) => u.status === "active" && ENROLLABLE_KINDS.includes(u.kind));
}

/** A unit's path, top first ("Main center / Adult services / Fall cohort"). Pure. */
export function unitPath(units: readonly Pick<OrgUnitRow, "id" | "parent_id" | "name">[], id: string): string {
  const byId = new Map(units.map((u) => [u.id, u]));
  const names: string[] = [];
  let cur = byId.get(id);
  let guard = 0;
  while (cur && guard++ < 10) { names.unshift(cur.name); cur = cur.parent_id ? byId.get(cur.parent_id) : undefined; }
  return names.join(" / ");
}

