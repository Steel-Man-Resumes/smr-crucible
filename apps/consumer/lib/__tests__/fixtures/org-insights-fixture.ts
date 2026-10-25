/**
 * Insights fixture shared by org-insights-report.test.ts and the 964090c CSV
 * snapshot beside it (insights-csv-964090c.csv). Fictional numbers.
 */
import type { OrgInsights } from "@crucible/core";

export const I: OrgInsights = {
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
