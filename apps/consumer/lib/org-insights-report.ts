/**
 * Insights, shaped for the screen, the printed report and the funder CSV
 * (CRM lane C2, 2026-10-25). Pure functions over getOrgInsights' output: no
 * new counting, no new query. Every figure here is one the screen already
 * showed; this module only groups and labels it.
 *
 * ONE DEFINITION (B8 note N12). "Of those, ended before this check-in" is part
 * of "No longer there", never a figure beside it. In the CSV it now sits in
 * the Note column of the "No longer there" row, so a reader who sums the
 * Value column cannot count those placements twice. On screen it is a smaller
 * sub-line under the same cell.
 */
import type { OrgInsights } from "@crucible/core";
import { JOURNEY_STAGES } from "@crucible/core/src/journeyStages";
import { STATIONS, stationForJourneyStage, type StationId } from "./refinery-nav";

/** People sharing progress, per participant station. Legacy stages 1 and 3 both sit on Tailor and package. */
export function stationRows(stages: { stage: number; count: number }[]): { id: StationId; label: string; count: number; stages: number[] }[] {
  return STATIONS.map((s) => {
    const mine = stages.filter((x) => stationForJourneyStage(x.stage) === s.id);
    return { id: s.id, label: s.label, count: mine.reduce((n, x) => n + x.count, 0), stages: mine.map((x) => x.stage) };
  });
}

/** The legacy stage names, kept in the CSV for continuity with earlier exports. */
export const LEGACY_STAGE_SECTION = "Legacy stage";
const STAGE = JOURNEY_STAGES.map((st, n) => `${n}. ${st.long}`);

export const PERIOD_LABEL = "All time";

export function endedBeforeNote(n: number): string {
  return `Of those, ${n} ended before this check-in (from the end date). Part of this number, not added to it.`;
}

const cell = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
export type CsvRow = [section: string, measure: string, value: string | number, countedOver: string, note: string];

export function insightsCsvRows(orgName: string, i: OrgInsights): CsvRow[] {
  const n = i.people.sharingProgress;
  const overProgress = `${n} participants sharing progress`;
  return [
    ["About", "Organization", orgName, "", ""],
    ["About", "Period", PERIOD_LABEL, "", "No date filter yet. Every figure covers everything on record as of the date below."],
    ["About", "As of", i.asOf, "", ""],
    ["About", "Note", "Counted only over what participants agreed the organization can see. No names. 'Quiet' includes 'never started'.", "", ""],
    ["People", "Joined", i.people.joined, "everyone who joined", ""],
    ["People", "Sharing progress", n, `${i.people.joined} who joined`, ""],
    ["People", "Joined, not sharing", i.people.notSharing, `${i.people.joined} who joined`, ""],
    ["People", "Invited, not yet signed in", i.people.pendingInvites, "new invites only, offers not included", ""],
    ["People", "Offers open", i.people.offersOpen, "offers to people who already had an account, on the invited list", ""],
    ...i.stages.map((s) => [LEGACY_STAGE_SECTION, STAGE[s.stage] ?? `Stage ${s.stage}`, s.count, overProgress, ""] as CsvRow),
    ["Momentum", "Active this week", i.activity.activeThisWeek, overProgress, ""],
    ["Momentum", `Quiet ${i.quietAfterDays}+ days (includes never started)`, i.activity.quiet, overProgress, ""],
    ["Momentum", "Never started (inside the quiet number)", i.activity.neverStarted, overProgress, ""],
    ["Work toward a job", "Tailored a resume", i.outcomes.tailoredResume, overProgress, ""],
    ["Work toward a job", "Practiced an interview", i.outcomes.practicing, overProgress, ""],
    ["Work toward a job", "Applied somewhere", i.outcomes.withAnApplication, overProgress, ""],
    ["Work toward a job", "Applications in all", i.outcomes.applications, overProgress, ""],
    ["Work toward a job", "Hired, as participants recorded it", i.outcomes.hired, overProgress, ""],
    ["Applications pipeline", "Hearing back or interviewing", i.pipeline.interviewing, `${i.pipeline.sharers} participants sharing applications`, ""],
    ["Applications pipeline", "With an offer", i.pipeline.offered, `${i.pipeline.sharers} participants sharing applications`, ""],
    ["Placements (staff-recorded)", "Placements on record", i.placements.placements, "placements entered by staff", ""],
    ["Placements (staff-recorded)", "Confirmed", i.placements.bySource.staff_verified ?? 0, `${i.placements.placements} placements`, ""],
    ["Placements (staff-recorded)", "Known, unconfirmed", i.placements.bySource.staff_reported ?? 0, `${i.placements.placements} placements`, ""],
    ["Placements (staff-recorded)", "As told to staff", i.placements.bySource.participant_reported ?? 0, `${i.placements.placements} placements`, ""],
    ["Placements (staff-recorded)", "Left for a better job", i.placements.leftForBetter, `${i.placements.ended} placements that ended`, ""],
    ["Placements (staff-recorded)", "Median hourly wage", i.placements.medianWage ?? "", `${i.placements.wageKnownFor} placements with a known wage`, ""],
    ...i.placements.retention.flatMap((r) => {
      const over = `${r.eligible} placements old enough for a ${r.dayMark}-day check-in`;
      const sec = `Retention, ${r.dayMark} days`;
      return [
        [sec, "Still there", r.employed, over, ""],
        // Exports made before 2026-10-23 counted ended-before-mark placements
        // under "Not asked yet"; exports before 2026-10-25 listed them as a
        // row of their own.
        [sec, "No longer there", r.notEmployed, over, (r.endedBeforeMark ?? 0) > 0 ? endedBeforeNote(r.endedBeforeMark ?? 0) : ""],
        [sec, "Could not reach", r.unknown, over, ""],
        [sec, "Not asked yet", r.notAskedYet, over, ""],
      ] as CsvRow[];
    }),
  ];
}

export function insightsCsv(orgName: string, i: OrgInsights): string {
  return [["Section", "Measure", "Value", "Counted over", "Note"], ...insightsCsvRows(orgName, i)].map((r) => r.map(cell).join(",")).join("\r\n");
}
