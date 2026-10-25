/**
 * Insights by station, the funder CSV with one definition (B8 note N12), and
 * the print report rendered with react-dom/server (CRM lane C2, 2026-10-25).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { OrgInsights } from "@crucible/core";
import { JOURNEY_STAGES } from "@crucible/core/src/journeyStages";
import { LEGACY_STAGE_SECTION, PERIOD_LABEL, insightsCsv, insightsCsvRows, stationRows } from "../org-insights-report";
import { STATION_IDS } from "../refinery-nav";

const ROOT = join(__dirname, "..", "..");

const I: OrgInsights = {
  asOf: "2026-10-24T18:00:00.000Z", quietAfterDays: 14,
  people: { joined: 12, sharingProgress: 9, notSharing: 3, pendingInvites: 2, offersOpen: 1 },
  stages: [0, 1, 2, 3, 4, 5, 6].map((stage) => ({ stage, count: [1, 2, 1, 2, 0, 1, 2][stage] })),
  activity: { activeThisWeek: 5, quiet: 3, neverStarted: 1 },
  outcomes: { withAnApplication: 4, applications: 11, practicing: 3, tailoredResume: 6, hired: 1 },
  pipeline: { sharers: 4, applied: 4, interviewing: 2, offered: 1, hired: 1 },
  sharing: [{ scope: "applications", people: 4 }, { scope: "resume", people: 5 }, { scope: "documents", people: 2 }],
  joinsByWeek: [{ weekOf: "2026-10-12", joined: 3 }],
  staff: [{ userId: "s1", name: "Sam Case", caseload: 6, sharingProgress: 5, quiet: 1, neverStarted: 0, hired: 1, notes30: 4, lastNoteAt: "2026-10-20T12:00:00Z", openRequests: 1 }],
  unassigned: 2,
  placements: {
    placements: 5, bySource: { staff_verified: 2, staff_reported: 2, participant_reported: 1 }, stillEmployed: 3, ended: 2, leftForBetter: 1,
    medianWage: 17.5, wageKnownFor: 4,
    retention: [
      { dayMark: 30, eligible: 4, employed: 3, notEmployed: 1, endedBeforeMark: 1, unknown: 0, notAskedYet: 0 },
      { dayMark: 90, eligible: 2, employed: 1, notEmployed: 1, endedBeforeMark: 0, unknown: 0, notAskedYet: 0 },
    ],
  } as OrgInsights["placements"],
};

/** The CSV as it was built at 964090c (app/api/org/insights/route.ts toCsv), for the row-by-row diff. */
function oldCsvRows(orgName: string, i: OrgInsights): [string, string, string | number, string][] {
  const STAGE = JOURNEY_STAGES.map((st, n) => `${n}. ${st.long}`);
  const n = i.people.sharingProgress; const overProgress = `${n} participants sharing progress`;
  return [
    ["About", "Organization", orgName, ""], ["About", "As of", i.asOf, ""],
    ["About", "Note", "Counted only over what participants agreed the organization can see. No names. 'Quiet' includes 'never started'.", ""],
    ["People", "Joined", i.people.joined, "everyone who joined"], ["People", "Sharing progress", n, `${i.people.joined} who joined`],
    ["People", "Joined, not sharing", i.people.notSharing, `${i.people.joined} who joined`],
    ["People", "Invited, not yet signed in", i.people.pendingInvites, "new invites only, offers not included"],
    ["People", "Offers open", i.people.offersOpen, "offers to people who already had an account, on the invited list"],
    ...i.stages.map((s) => ["Stage", STAGE[s.stage] ?? `Stage ${s.stage}`, s.count, overProgress] as [string, string, number, string]),
    ["Momentum", "Active this week", i.activity.activeThisWeek, overProgress],
    ["Momentum", `Quiet ${i.quietAfterDays}+ days (includes never started)`, i.activity.quiet, overProgress],
    ["Momentum", "Never started (inside the quiet number)", i.activity.neverStarted, overProgress],
    ["Work toward a job", "Tailored a resume", i.outcomes.tailoredResume, overProgress], ["Work toward a job", "Practiced an interview", i.outcomes.practicing, overProgress],
    ["Work toward a job", "Applied somewhere", i.outcomes.withAnApplication, overProgress], ["Work toward a job", "Applications in all", i.outcomes.applications, overProgress],
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
        [`Retention, ${r.dayMark} days`, "Of those, ended before this check-in (from the end date)", r.endedBeforeMark ?? 0, over],
        [`Retention, ${r.dayMark} days`, "Could not reach", r.unknown, over], [`Retention, ${r.dayMark} days`, "Not asked yet", r.notAskedYet, over],
      ] as [string, string, number, string][];
    }),
  ];
}

test("stations: every person sharing progress counted once, at the station stationForJourneyStage names", () => {
  const rows = stationRows(I.stages);
  assert.deepEqual(rows.map((r) => r.id), [...STATION_IDS]);
  assert.equal(rows.reduce((n, r) => n + r.count, 0), I.stages.reduce((n, s) => n + s.count, 0));
  const by = Object.fromEntries(rows.map((r) => [r.id, r.count]));
  assert.deepEqual(by, { overview: 1, find: 1, tailor: 4, plan: 0, practice: 1, apply: 2, next: 0 });
  assert.deepEqual(rows.find((r) => r.id === "tailor")!.stages, [1, 3]);
});

test("CSV N12: the ended-before figure is a note on 'No longer there', never its own value row", () => {
  const rows = insightsCsvRows("Test Org (Demo)", I);
  assert.ok(!rows.some((r) => /ended before/i.test(r[1])), "no measure row for it");
  const r30 = rows.find((r) => r[0] === "Retention, 30 days" && r[1] === "No longer there")!;
  assert.equal(r30[2], 1);
  assert.match(r30[4], /^Of those, 1 ended before this check-in \(from the end date\)\. Part of this number, not added to it\.$/);
  // Summing a retention section's values now gives exactly the eligible count when every placement is answered.
  for (const r of I.placements.retention) {
    const sum = rows.filter((x) => x[0] === `Retention, ${r.dayMark} days`).reduce((n, x) => n + Number(x[2]), 0);
    assert.equal(sum, r.eligible, `${r.dayMark}-day values add to the eligible count`);
  }
});

test("CSV: no number changed. Same values, same order, one row moved to a note, stage rows labeled legacy", () => {
  const before = oldCsvRows("Test Org (Demo)", I);
  const after = insightsCsvRows("Test Org (Demo)", I);
  const key = (r: readonly unknown[]) => `${String(r[0]).replace(/^Stage$/, LEGACY_STAGE_SECTION)}|${r[1]}|${r[2]}|${r[3]}`;
  const dropped = before.filter((r) => /ended before/i.test(String(r[1])));
  assert.equal(dropped.length, I.placements.retention.length);
  const kept = before.filter((r) => !dropped.includes(r)).map(key);
  const now = after.filter((r) => !(r[0] === "About" && r[1] === "Period")).map(key);
  assert.deepEqual(now, kept, "every other row identical, in order");
  assert.ok(after.filter((r) => r[0] === LEGACY_STAGE_SECTION).length === 7);
  assert.ok(!after.some((r) => r[0] === "Stage"));
  const period = after.find((r) => r[1] === "Period")!;
  assert.equal(period[2], PERIOD_LABEL);
  const csv = insightsCsv("Test Org (Demo)", I);
  assert.equal(csv.split("\r\n")[0], '"Section","Measure","Value","Counted over","Note"');
  assert.ok(csv.split("\r\n").every((l) => l.split('","').length === 5), "five columns on every line");
});

test("the route builds the CSV from the one shared definition", () => {
  const src = readFileSync(join(ROOT, "app/api/org/insights/route.ts"), "utf8");
  assert.match(src, /insightsCsv\(guard\.actor\.orgName, insights\)/);
  assert.doesNotMatch(src, /function toCsv/);
  assert.match(src, /recordDataAccess\(/, "the export is still audited");
  assert.match(src, /org\.export/, "the export still needs org.export");
});

test("the old cohort CSV button is gone for organizations that have Insights", () => {
  const src = readFileSync(join(ROOT, "components/org/OrgDashboard.tsx"), "utf8");
  const at = src.indexOf("/api/partner/cohort?format=csv");
  assert.ok(at > 0, "kept for organizations without the workspace");
  assert.match(src.slice(Math.max(0, at - 300), at), /!data\?\.crmV2/);
  assert.doesNotMatch(src, /mission control/i);
});
