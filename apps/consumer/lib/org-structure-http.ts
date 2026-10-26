/**
 * The organization structure routes' logic (house lane L3a, migration 103),
 * with the database calls passed in so the tests
 * (lib/__tests__/org-structure-http.test.ts) run the real handlers:
 *   app/api/org/profile/route.ts      GET words and settings, PATCH them
 *   app/api/org/setup/route.ts        POST finish the setup wizard
 *   app/api/org/structure/route.ts    GET the tree, POST unit and staff changes
 *   app/api/org/enrollments/route.ts  GET enrollments, POST create / status / details
 * are thin wrappers that supply the guard's actor and these dependencies.
 *
 * Capability per action: structure and words need org.settings.manage;
 * enrollments need org.enrollment.write; reads need org.cohort.view. A
 * platform admin acting for an organization reads and never writes. The
 * database (103) refuses the same things again.
 */
import { NextResponse } from "next/server";
import type {
  OrgActor, OrgProfile, ProfilePatch, SetupInput, StructureResult, UnitInput, EnrollmentInput, EnrollmentRow,
  OrgUnitRow, UnitMemberRow, OrgStaffOption,
} from "@crucible/core";

type Actor = OrgActor;
const noStore = { "Cache-Control": "private, no-store" };
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: noStore });
const REFUSED = "You do not have access to that.";
export const BODY_MAX = 64 * 1024;

export function canManage(actor: Actor): boolean {
  return !actor.viaPlatformAdmin && actor.capabilities.has("org.settings.manage");
}
export function canEnroll(actor: Actor): boolean {
  return !actor.viaPlatformAdmin && actor.capabilities.has("org.enrollment.write");
}
/** Creating, reopening, or choosing an enrollment's staff member: the assign power too (review B1). */
export function canAssign(actor: Actor): boolean {
  return canEnroll(actor) && actor.capabilities.has("org.client.assign");
}

function result(r: StructureResult<Record<string, unknown>>, okBody?: Record<string, unknown>): NextResponse {
  if (r.ok) {
    const { ok: _ok, ...rest } = r as { ok: true } & Record<string, unknown>;
    return json({ ok: true, ...rest, ...(okBody ?? {}) });
  }
  return json({ error: r.error }, r.status);
}

/** Read a JSON body, never more than `max` bytes. Null on anything but a JSON object. */
export async function readJsonBody(request: Request, max = BODY_MAX): Promise<Record<string, unknown> | null> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > max) return null;
  let text: string;
  try { text = await request.text(); } catch { return null; }
  if (text.length > max) return null;
  try {
    const v = JSON.parse(text);
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------- profile -- */

export interface ProfileDeps {
  getOrgProfile: (a: Actor) => Promise<OrgProfile>;
  updateOrgProfile: (a: Actor, p: ProfilePatch) => Promise<StructureResult<{ profile: OrgProfile }>>;
  completeOrgSetup: (a: Actor, i: SetupInput) => Promise<StructureResult<{ profile: OrgProfile; unitsCreated: number; unitsSkipped: boolean }>>;
}

/** GET /api/org/profile: the words and settings, plus whether this person can change them and whether setup is still open. */
export async function handleProfileGet(actor: Actor, deps: Pick<ProfileDeps, "getOrgProfile">): Promise<NextResponse> {
  const profile = await deps.getOrgProfile(actor);
  const manage = canManage(actor);
  return json({ profile, canManage: manage, needsSetup: manage && !profile.setupCompletedAt });
}

/** PATCH /api/org/profile */
export async function handleProfilePatch(request: Request, actor: Actor, deps: Pick<ProfileDeps, "updateOrgProfile">): Promise<NextResponse> {
  if (!canManage(actor)) return json({ error: REFUSED }, 403);
  const body = await readJsonBody(request);
  if (!body) return json({ error: "That did not come through. Try again." }, 400);
  const patch: ProfilePatch = {};
  for (const k of ["orgType", "displayName", "timezone", "terms", "modules"] as const) if (k in body) patch[k] = body[k];
  return result(await deps.updateOrgProfile(actor, patch));
}

/** POST /api/org/setup */
export async function handleSetupPost(request: Request, actor: Actor, deps: Pick<ProfileDeps, "completeOrgSetup">): Promise<NextResponse> {
  if (!canManage(actor)) return json({ error: REFUSED }, 403);
  const body = await readJsonBody(request);
  if (!body) return json({ error: "That did not come through. Try again." }, 400);
  const input: SetupInput = {};
  for (const k of ["orgType", "displayName", "timezone", "terms", "modules", "units"] as const) if (k in body) input[k] = body[k];
  if (input.orgType === undefined) return json({ error: "Pick what kind of organization this is." }, 400);
  return result(await deps.completeOrgSetup(actor, input));
}

/* ----------------------------------------------------------- structure -- */

export interface StructureDeps {
  getOrgStructure: (a: Actor) => Promise<{ units: OrgUnitRow[]; members: UnitMemberRow[]; staff: OrgStaffOption[]; countsArePartial: boolean; ready: boolean } | null>;
  createOrgUnit: (a: Actor, i: UnitInput) => Promise<StructureResult<{ id: string }>>;
  updateOrgUnit: (a: Actor, id: string, i: UnitInput) => Promise<StructureResult<{ id: string }>>;
  moveOrgUnit: (a: Actor, id: string, parentId: string | null) => Promise<StructureResult<{ id: string }>>;
  setOrgUnitOpen: (a: Actor, id: string, open: boolean) => Promise<StructureResult<{ id: string }>>;
  setUnitMember: (a: Actor, unitId: string, userId: string, role: unknown) => Promise<StructureResult>;
  removeUnitMember: (a: Actor, unitId: string, userId: string) => Promise<StructureResult>;
}

export async function handleStructureGet(actor: Actor, deps: Pick<StructureDeps, "getOrgStructure">): Promise<NextResponse> {
  const s = await deps.getOrgStructure(actor);
  if (!s) return json({ error: REFUSED }, 403);
  // Who works where is staff information; the list of staff to pick from is for those who can change it.
  return json({ ...s, staff: canManage(actor) ? s.staff : [], canManage: canManage(actor), canEnroll: canEnroll(actor), canAssign: canAssign(actor) });
}

const STRUCTURE_ACTIONS = ["create_unit", "update_unit", "move_unit", "close_unit", "reopen_unit", "set_member", "remove_member"] as const;
const str = (v: unknown) => (typeof v === "string" ? v : "");

/** POST /api/org/structure { action, ... } */
export async function handleStructurePost(request: Request, actor: Actor, deps: Omit<StructureDeps, "getOrgStructure">): Promise<NextResponse> {
  if (!canManage(actor)) return json({ error: REFUSED }, 403);
  const body = await readJsonBody(request);
  if (!body) return json({ error: "That did not come through. Try again." }, 400);
  const action = body.action;
  if (typeof action !== "string" || !(STRUCTURE_ACTIONS as readonly string[]).includes(action)) return json({ error: "Unknown change." }, 400);
  const unit: UnitInput = {
    kind: body.kind, name: body.name, parentId: body.parentId, shortCode: body.shortCode, description: body.description,
    startsOn: body.startsOn, endsOn: body.endsOn, capacity: body.capacity,
  };
  switch (action) {
    case "create_unit": return result(await deps.createOrgUnit(actor, unit));
    case "update_unit": {
      const patch: UnitInput = {};
      for (const k of ["kind", "name", "shortCode", "description", "startsOn", "endsOn", "capacity"] as const) if (k in body) patch[k] = body[k];
      return result(await deps.updateOrgUnit(actor, str(body.unitId), patch));
    }
    case "move_unit": {
      const parent = body.parentId === null || body.parentId === "" || body.parentId === undefined ? null : str(body.parentId);
      return result(await deps.moveOrgUnit(actor, str(body.unitId), parent));
    }
    case "close_unit": return result(await deps.setOrgUnitOpen(actor, str(body.unitId), false));
    case "reopen_unit": return result(await deps.setOrgUnitOpen(actor, str(body.unitId), true));
    case "set_member": return result(await deps.setUnitMember(actor, str(body.unitId), str(body.userId), body.role));
    case "remove_member": return result(await deps.removeUnitMember(actor, str(body.unitId), str(body.userId)));
  }
  return json({ error: "Unknown change." }, 400);
}

/* --------------------------------------------------------- enrollments -- */

export interface EnrollmentDeps {
  listEnrollments: (a: Actor, o: { participantId?: string | null; unitId?: string | null; includeDone?: boolean }) => Promise<EnrollmentRow[] | null>;
  createEnrollment: (a: Actor, i: EnrollmentInput) => Promise<StructureResult<{ id: string }>>;
  changeEnrollmentStatus: (a: Actor, id: string, to: unknown, reason?: unknown) => Promise<StructureResult<{ status: string }>>;
  updateEnrollmentDetails: (a: Actor, id: string, i: { primaryStaffId?: unknown; programParticipantId?: unknown; enrolledOn?: unknown }) => Promise<StructureResult>;
}

/** GET /api/org/enrollments?participant=&unit=&open=1 (rows the viewer reaches; nothing for a platform admin acting for the org). */
export async function handleEnrollmentsGet(url: URL, actor: Actor, deps: Pick<EnrollmentDeps, "listEnrollments">): Promise<NextResponse> {
  const rows = await deps.listEnrollments(actor, {
    participantId: url.searchParams.get("participant"),
    unitId: url.searchParams.get("unit"),
    includeDone: url.searchParams.get("open") !== "1",
  });
  if (rows === null) return json({ error: REFUSED }, 403);
  return json({ enrollments: rows, canEnroll: canEnroll(actor), canAssign: canAssign(actor) });
}

/** POST /api/org/enrollments { action: "create" | "status" | "details", ... } */
export async function handleEnrollmentsPost(request: Request, actor: Actor, deps: Omit<EnrollmentDeps, "listEnrollments">): Promise<NextResponse> {
  if (!canEnroll(actor)) return json({ error: REFUSED }, 403);
  const body = await readJsonBody(request);
  if (!body) return json({ error: "That did not come through. Try again." }, 400);
  switch (body.action) {
    case "create":
      if (!canAssign(actor)) return json({ error: "Only someone who assigns people can enroll them." }, 403);
      return result(await deps.createEnrollment(actor, {
        participantId: body.participantId, unitId: body.unitId, status: body.status, primaryStaffId: body.primaryStaffId,
        programParticipantId: body.programParticipantId, enrolledOn: body.enrolledOn,
      }));
    case "status":
      return result(await deps.changeEnrollmentStatus(actor, str(body.enrollmentId), body.status, body.reason));
    case "details": {
      const patch: { primaryStaffId?: unknown; programParticipantId?: unknown; enrolledOn?: unknown } = {};
      for (const k of ["primaryStaffId", "programParticipantId", "enrolledOn"] as const) if (k in body) patch[k] = body[k];
      return result(await deps.updateEnrollmentDetails(actor, str(body.enrollmentId), patch));
    }
  }
  return json({ error: "Unknown change." }, 400);
}
