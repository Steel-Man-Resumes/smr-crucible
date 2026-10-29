/**
 * Custom field values (migration 104), for the people the caller reaches.
 *   GET ?entity=participant                      every value in reach (the caseload)
 *   GET ?entity=participant&participant=<id>     one person's values
 *   GET ?entity=enrollment&participant=<id>      that person's enrollments and their values
 *   GET ...&history=1                            also earlier answers (managers only)
 *   PUT { entity, entityId, values: { key: value } }   set or clear (empty clears)
 *   PUT { entity: "participant", batch: [{ entityId, values }], fromGrid: true }
 *        many people at once (the People grid: an edit, a paste, a clear).
 *        ALL OR NOTHING: one bad cell and nothing is written; every bad cell
 *        comes back in cellErrors ("<person id>:<field key>" -> reason). From
 *        the grid it also needs the organization's grid_edit switch (108).
 * Reach is checked in core (SQL) and by the database reach policy. Writes
 * need org.note.write: a value is an org record about a person, like a note.
 * Every change lands in the activity log by database trigger.
 */
import { NextResponse } from "next/server";
import {
  canSeeFieldHistory, canWriteFieldValues, getFieldValueHistory, getFieldValues, getMyCustomizationPolicy, getOrgStaffDirectory, isCustomFieldEntity, listFieldDefs,
  listParticipantEnrollments, setFieldValues, setFieldValuesBatch,
} from "@crucible/core";
import { requireOrgCapability } from "@/lib/org-guard";

export const dynamic = "force-dynamic";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(request: Request) {
  const guard = await requireOrgCapability("org.cohort.view", { request });
  if (!guard.ok) return guard.response;
  const sp = new URL(request.url).searchParams;
  const entity = sp.get("entity") ?? "participant";
  if (!isCustomFieldEntity(entity)) return NextResponse.json({ error: "Unknown record." }, { status: 400 });
  const participant = sp.get("participant");
  if (participant && !UUID.test(participant)) return NextResponse.json({ error: "No such person." }, { status: 400 });
  const actor = guard.actor;
  const [defs, staff] = await Promise.all([listFieldDefs(actor, { entity, includeRetired: true }), getOrgStaffDirectory(actor)]);
  let enrollments = undefined;
  let values;
  let history: Record<string, Awaited<ReturnType<typeof getFieldValueHistory>>> | undefined;
  const wantsHistory = sp.get("history") === "1" && canSeeFieldHistory(actor);
  if (entity === "enrollment") {
    if (!participant) return NextResponse.json({ error: "Say whose enrollments." }, { status: 400 });
    enrollments = await listParticipantEnrollments(actor, participant);
    values = enrollments?.length ? await getFieldValues(actor, "enrollment", { entityIds: enrollments.map((e) => e.id) }) : {};
    if (wantsHistory && enrollments?.length) {
      history = Object.fromEntries(await Promise.all(enrollments.map(async (e) => [e.id, await getFieldValueHistory(actor, "enrollment", e.id)] as const)));
    }
  } else {
    values = await getFieldValues(actor, "participant", participant ? { entityIds: [participant] } : {});
    if (wantsHistory && participant) history = { [participant]: await getFieldValueHistory(actor, "participant", participant) };
  }
  return NextResponse.json({
    defs, values, staff, canEdit: canWriteFieldValues(actor), canSeeHistory: canSeeFieldHistory(actor),
    ...(history ? { history } : {}),
    // null = enrollments are not set up in this workspace yet (103 not applied).
    ...(entity === "enrollment" ? { enrollments } : {}),
  });
}

export async function PUT(request: Request) {
  const guard = await requireOrgCapability("org.note.write", { request });
  if (!guard.ok) return guard.response;
  const body = await request.json().catch(() => ({}));
  if (Array.isArray(body.batch)) {
    if (body.entity !== "participant") return NextResponse.json({ error: "No such record." }, { status: 400 });
    // A batch is the grid's write, whatever the body says (final review nit 7): the grid_edit switch always applies.
    const allowed = await getMyCustomizationPolicy(guard.actor, { forWrite: true }).catch(() => null);
    const res = await setFieldValuesBatch(guard.actor, body.batch, { fromGrid: true, gridAllowed: allowed?.grid_edit === true });
    if (res.ok) return NextResponse.json(res);
    return NextResponse.json(res, { status: res.error === "You do not have access to that." || /not in the grid/.test(res.error) ? 403 : 400 });
  }
  if (!isCustomFieldEntity(body.entity) || typeof body.entityId !== "string") return NextResponse.json({ error: "No such record." }, { status: 400 });
  const res = await setFieldValues(guard.actor, body.entity, body.entityId, body.values ?? {});
  if (res.ok) return NextResponse.json(res);
  return NextResponse.json(res, { status: res.error === "You do not have access to that." ? 403 : res.error === "That person is not on your caseload." ? 404 : 400 });
}
