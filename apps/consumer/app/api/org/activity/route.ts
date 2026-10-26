/**
 * The organization activity log (migration 102).
 *
 *   GET ?participantId=&staffId=&entity=&from=YYYY-MM-DD&to=YYYY-MM-DD&before=
 *       The Audit screen. Needs `org.audit.view` (owners and admins by default).
 *   GET ?participantId=  without `org.audit.view`: that one person's history,
 *       for staff who may open them (`org.client.view_content`). Reach decides.
 *   GET ?format=csv  the same filters as a spreadsheet, for org admins and the
 *       owner holding `org.export`. The export itself is logged.
 *
 * Rows are reach-scoped in the database (a row about a person shows only to
 * staff who reach that person) and again in the SQL; this route adds the verb.
 * Nothing here writes a row: the log is written only by database triggers.
 */
import { NextResponse } from "next/server";
import {
  listOrgActivity, listParticipantActivity, activityFilterChoices, activityFilters, activitySentence, activityWho, activityPerson,
  activityCsv, recordDataAccess, ACTIVITY_ENTITIES, ACTIVITY_ENTITY_LABELS, type ActivityRow,
} from "@crucible/core";
import { requireOrgCapability } from "@/lib/org-guard";

export const dynamic = "force-dynamic";

const CSV_MAX_ROWS = 5000;

function shape(r: ActivityRow) {
  return {
    id: r.id, at: r.at, entity: r.entity, action: r.action,
    sentence: activitySentence(r), who: activityWho(r), person: activityPerson(r),
    personId: r.participant_user_id, staffName: r.staff_user_id ? r.staff_name : null,
  };
}

export async function GET(request: Request) {
  const params = Object.fromEntries(new URL(request.url).searchParams.entries());
  const audit = await requireOrgCapability("org.audit.view", { request });

  if (!audit.ok) {
    // Without the audit capability: one person's history only, for someone who may open people.
    if (!params.participantId || params.format === "csv") return audit.response;
    const staff = await requireOrgCapability("org.client.view_content", { request });
    if (!staff.ok) return staff.response;
    const res = await listParticipantActivity(staff.actor, params.participantId, params);
    if (!res.ok) return NextResponse.json({ error: "You do not have access to that." }, { status: 403 });
    return NextResponse.json({ rows: res.rows.map(shape), nextBefore: res.nextBefore });
  }

  const actor = audit.actor;
  const canExport = actor.capabilities.has("org.export") && (actor.role === "owner" || actor.role === "org_admin");

  if (params.format === "csv") {
    if (!canExport) return NextResponse.json({ error: "You do not have access to that." }, { status: 403 });
    const res = await listOrgActivity(actor, { ...params, limit: String(CSV_MAX_ROWS) }, { maxLimit: CSV_MAX_ROWS });
    if (!res.ok) return NextResponse.json({ error: "You do not have access to that." }, { status: 403 });
    const f = activityFilters(params);
    await recordDataAccess({ accessorUserId: actor.userId, resource: "org_activity", action: "export",
      context: { orgId: actor.orgId, rows: res.rows.length, entity: f.entity, from: f.from, to: f.to, byPerson: !!f.participantId, byStaff: !!f.staffId } });
    return new NextResponse(activityCsv(res.rows), {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="activity-${new Date().toISOString().slice(0, 10)}.csv"`,
        "cache-control": "no-store",
      },
    });
  }

  const res = await listOrgActivity(actor, params);
  if (!res.ok) return NextResponse.json({ error: "You do not have access to that." }, { status: 403 });
  const choices = params.before ? null : await activityFilterChoices(actor);
  return NextResponse.json({
    rows: res.rows.map(shape),
    nextBefore: res.nextBefore,
    canExport,
    choices: choices && {
      team: choices.team.map((t) => ({ id: t.id, name: t.name || "A team member" })),
      people: choices.people.map((p) => ({ id: p.id, name: p.name || `Name not shared (${p.id.slice(-4)})` })).sort((a, b) => a.name.localeCompare(b.name)),
      kinds: ACTIVITY_ENTITIES.map((e) => ({ id: e, name: ACTIVITY_ENTITY_LABELS[e] })),
    },
  });
}
