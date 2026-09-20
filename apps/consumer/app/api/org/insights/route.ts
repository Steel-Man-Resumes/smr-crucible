/**
 * GET: the organization's numbers. Requires `org.insights.view`.
 * GET ?format=csv: the same numbers as a spreadsheet, and ALSO requires `org.export`.
 *
 * The CSV carries, on every row, what the figure was counted over. A number that
 * leaves the building without its denominator gets quoted as something it is not.
 * It contains no names and no per-person rows.
 */
import { NextResponse } from "next/server";
import { getOrgInsights, recordDataAccess, type OrgInsights } from "@crucible/core";
import { requireOrgCapability } from "@/lib/org-guard";
import { JOURNEY_STAGES } from "@crucible/core/src/journeyStages";

export const dynamic = "force-dynamic";

// The same stage names every screen uses, not a second list to drift.
const STAGE = JOURNEY_STAGES.map((st, n) => `${n}. ${st.long}`);
const cell = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;

function toCsv(orgName: string, i: OrgInsights): string {
  const n = i.people.sharingProgress;
  const overProgress = `${n} participants sharing progress`;
  const rows: [string, string, string | number, string][] = [
    ["About", "Organization", orgName, ""],
    ["About", "As of", i.asOf, ""],
    ["About", "Note", "Counted only over what participants agreed the organization can see. No names. 'Quiet' includes 'never started'.", ""],
    ["People", "Joined", i.people.joined, "everyone who joined"],
    ["People", "Sharing progress", n, `${i.people.joined} who joined`],
    ["People", "Joined, not sharing", i.people.notSharing, `${i.people.joined} who joined`],
    ["People", "Invited, not yet signed in", i.people.pendingInvites, "open invitations"],
    ...i.stages.map((s) => ["Stage", STAGE[s.stage] ?? `Stage ${s.stage}`, s.count, overProgress] as [string, string, number, string]),
    ["Momentum", "Active this week", i.activity.activeThisWeek, overProgress],
    ["Momentum", `Quiet ${i.quietAfterDays}+ days (includes never started)`, i.activity.quiet, overProgress],
    ["Momentum", "Never started (inside the quiet number)", i.activity.neverStarted, overProgress],
    ["Work toward a job", "Tailored a resume", i.outcomes.tailoredResume, overProgress],
    ["Work toward a job", "Practiced an interview", i.outcomes.practicing, overProgress],
    ["Work toward a job", "Applied somewhere", i.outcomes.withAnApplication, overProgress],
    ["Work toward a job", "Applications in all", i.outcomes.applications, overProgress],
    ["Work toward a job", "Hired, as participants recorded it", i.outcomes.hired, overProgress],
    ["Applications pipeline", "Hearing back or interviewing", i.pipeline.interviewing, `${i.pipeline.sharers} participants sharing applications`],
    ["Applications pipeline", "With an offer", i.pipeline.offered, `${i.pipeline.sharers} participants sharing applications`],
    ["Placements (staff-recorded)", "Placements on record", i.placements.placements, "placements entered by staff"],
    ["Placements (staff-recorded)", "Confirmed", i.placements.bySource.staff_verified ?? 0, `${i.placements.placements} placements`],
    ["Placements (staff-recorded)", "Known, unconfirmed", i.placements.bySource.staff_reported ?? 0, `${i.placements.placements} placements`],
    ["Placements (staff-recorded)", "As told to staff", i.placements.bySource.participant_reported ?? 0, `${i.placements.placements} placements`],
    ["Placements (staff-recorded)", "Left for a better job", i.placements.leftForBetter, `${i.placements.ended} placements that ended`],
    ["Placements (staff-recorded)", "Median hourly wage", i.placements.medianWage ?? "", `${i.placements.wageKnownFor} placements with a known wage`],
    ...i.placements.retention.flatMap((r) => {
      const over = `${r.eligible} placements old enough for a ${r.dayMark}-day check-in`;
      return [
        [`Retention, ${r.dayMark} days`, "Still there", r.employed, over], [`Retention, ${r.dayMark} days`, "No longer there", r.notEmployed, over],
        [`Retention, ${r.dayMark} days`, "Could not reach", r.unknown, over], [`Retention, ${r.dayMark} days`, "Not asked yet", r.notAskedYet, over],
      ] as [string, string, number, string][];
    }),
  ];
  return [["Section", "Measure", "Value", "Counted over"], ...rows].map((r) => r.map(cell).join(",")).join("\r\n");
}

export async function GET(request: Request) {
  const guard = await requireOrgCapability("org.insights.view");
  if (!guard.ok) return guard.response;
  const insights = await getOrgInsights(guard.actor);
  if (!insights) return NextResponse.json({ error: "You do not have access to that." }, { status: 403 });

  if (new URL(request.url).searchParams.get("format") === "csv") {
    if (!guard.actor.capabilities.has("org.export")) return NextResponse.json({ error: "You do not have access to that." }, { status: 403 });
    await recordDataAccess({ accessorUserId: guard.actor.userId, resource: "org_insights", action: "export", context: { orgId: guard.actor.orgId } });
    return new NextResponse(toCsv(guard.actor.orgName, insights), {
      headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="insights-${new Date().toISOString().slice(0, 10)}.csv"`, "cache-control": "no-store" },
    });
  }
  return NextResponse.json({ insights, orgName: guard.actor.orgName, canExport: guard.actor.capabilities.has("org.export") });
}
