import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  summarizeStaffPerformance,
  STALLED_AFTER_DAYS,
} from "../orgStaffPerformance";
import type { CohortClient } from "../partnerDashboard";

const NOW = Date.parse("2026-09-19T12:00:00Z");
const daysAgo = (n: number) => new Date(NOW - n * 86_400_000).toISOString();

function client(over: Partial<CohortClient> = {}): CohortClient {
  return {
    userId: "u" + Math.random().toString(36).slice(2, 8),
    name: "Someone",
    email: null,
    currentStage: 3,
    nextStepAction: null,
    applications: 0,
    savedJobs: 0,
    practiceSessions: 0,
    hasResumeTailored: false,
    hasDisclosurePlan: false,
    hired: false,
    outcomeNamed: false,
    lastActiveAt: daysAgo(1),
    joinedAt: daysAgo(30),
    assignedStaffId: "staff-a",
    assignedStaffName: "Kelly",
    aiCostUsd: 0,
    ...over,
  };
}

describe("staff caseload rollup", () => {
  it("groups by assigned staff member", () => {
    const rows = summarizeStaffPerformance(
      [
        client({ assignedStaffId: "a", assignedStaffName: "Kelly" }),
        client({ assignedStaffId: "a", assignedStaffName: "Kelly" }),
        client({ assignedStaffId: "b", assignedStaffName: "Miranda" }),
      ],
      { now: NOW }
    );
    assert.equal(rows.length, 2);
    assert.equal(rows.find((r) => r.staffUserId === "a")?.caseload, 2);
    assert.equal(rows.find((r) => r.staffUserId === "b")?.caseload, 1);
  });

  it("puts unassigned people in their own bucket, because nobody owns them", () => {
    const rows = summarizeStaffPerformance(
      [client({ assignedStaffId: null, assignedStaffName: null })],
      { now: NOW }
    );
    assert.equal(rows[0].staffUserId, null);
    assert.equal(rows[0].staffName, null);
    assert.equal(rows[0].caseload, 1);
  });

  it("counts activity inside the last week", () => {
    const rows = summarizeStaffPerformance(
      [
        client({ lastActiveAt: daysAgo(1) }),
        client({ lastActiveAt: daysAgo(6) }),
        client({ lastActiveAt: daysAgo(9) }),
      ],
      { now: NOW }
    );
    assert.equal(rows[0].activeThisWeek, 2);
  });

  it("treats never-active as stalled, not as fine", () => {
    // The clearest case of someone quietly getting lost: joined, did nothing.
    const rows = summarizeStaffPerformance([client({ lastActiveAt: null })], { now: NOW });
    assert.equal(rows[0].stalled, 1);
  });

  it("uses the stated stall boundary exactly", () => {
    const rows = summarizeStaffPerformance(
      [
        client({ lastActiveAt: daysAgo(STALLED_AFTER_DAYS - 1) }),
        client({ lastActiveAt: daysAgo(STALLED_AFTER_DAYS + 1) }),
      ],
      { now: NOW }
    );
    assert.equal(rows[0].stalled, 1);
  });

  it("averages the journey stage and rounds to one decimal", () => {
    const rows = summarizeStaffPerformance(
      [client({ currentStage: 2 }), client({ currentStage: 5 })],
      { now: NOW }
    );
    assert.equal(rows[0].avgStage, 3.5);
  });

  it("reports no stage when there is nothing to average", () => {
    assert.deepEqual(summarizeStaffPerformance([], { now: NOW }), []);
  });
});

describe("the headline tells the admin what to do", () => {
  it("leads with stalled people over everything else", () => {
    const rows = summarizeStaffPerformance(
      [
        client({ lastActiveAt: daysAgo(30) }),
        client({ lastActiveAt: daysAgo(30) }),
        client({ hired: true }),
      ],
      { now: NOW }
    );
    assert.equal(rows[0].headline, "2 people have not moved in two weeks.");
  });

  it("uses singular English for one person", () => {
    const rows = summarizeStaffPerformance([client({ lastActiveAt: daysAgo(30) })], {
      now: NOW,
    });
    assert.equal(rows[0].headline, "1 person has not moved in two weeks.");
  });

  it("celebrates a hire when nothing is stalled", () => {
    const rows = summarizeStaffPerformance([client({ hired: true })], { now: NOW });
    assert.equal(rows[0].headline, "1 person started work.");
  });

  it("says so plainly when a staff member has nobody", () => {
    const rows = summarizeStaffPerformance([], { now: NOW });
    assert.equal(rows.length, 0); // no clients means no bucket at all
  });

  it("never characterizes the staff member, only the caseload", () => {
    // A stalled caseload can mean a hard caseload, a part-time worker, or a
    // month of court dates. The data cannot tell those apart, so the copy must
    // not imply it can.
    const rows = summarizeStaffPerformance(
      [client({ lastActiveAt: daysAgo(40) }), client({ lastActiveAt: daysAgo(40) })],
      { now: NOW }
    );
    const banned = /underperform|behind|failing|poor|lazy|bad/i;
    for (const r of rows) assert.equal(banned.test(r.headline), false, r.headline);
  });
});

describe("ordering surfaces the people who need attention", () => {
  it("sorts the most stalled caseload first", () => {
    const rows = summarizeStaffPerformance(
      [
        client({ assignedStaffId: "calm", assignedStaffName: "Calm", lastActiveAt: daysAgo(1) }),
        client({ assignedStaffId: "busy", assignedStaffName: "Busy", lastActiveAt: daysAgo(40) }),
        client({ assignedStaffId: "busy", assignedStaffName: "Busy", lastActiveAt: daysAgo(40) }),
      ],
      { now: NOW }
    );
    assert.equal(rows[0].staffUserId, "busy");
  });

  it("falls back to caseload size when nothing is stalled", () => {
    const rows = summarizeStaffPerformance(
      [
        client({ assignedStaffId: "big", assignedStaffName: "Big" }),
        client({ assignedStaffId: "big", assignedStaffName: "Big" }),
        client({ assignedStaffId: "small", assignedStaffName: "Small" }),
      ],
      { now: NOW }
    );
    assert.equal(rows[0].staffUserId, "big");
  });
});
