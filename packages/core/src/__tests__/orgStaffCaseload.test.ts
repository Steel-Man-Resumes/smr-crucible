// House build L6: the pure rules behind staff t.ROY's caseload reads, the
// sourced timeline and the skill-run log. Dated fixtures, no database.
import { it } from "node:test";
import assert from "node:assert/strict";
import { buildCaseloadDigest, summarizeOutcomesForPeriod, lastQuarter, staffReachPredicate, ASK_WAITING_DAYS, type DigestInput } from "../orgStaffCaseload";
import { buildClientTimeline, type TimelineRows } from "../orgStaffAssistant";
import { skillRunRow, skillOutputHash, GENERAL_STAFF_SKILL } from "../aiSkillRun";
import type { Outcome } from "../orgOutcomes";

const NOW = Date.parse("2026-10-26T15:00:00Z");
const ME = "00000000-0000-0000-0000-000000000001";
const DANA = "00000000-0000-0000-0000-000000000007";
const LEE = "00000000-0000-0000-0000-000000000008";
const RAY = "00000000-0000-0000-0000-000000000009";

function digestInput(over: Partial<DigestInput> = {}): DigestInput {
  return {
    actorUserId: ME, seesAll: false, quietDays: 14,
    cohort: [
      { userId: DANA, name: "Dana Ray", lastActiveAt: "2026-10-01T10:00:00Z", joinedAt: "2026-08-01T00:00:00Z", hired: false, assignedStaffId: ME },
      { userId: LEE, name: "Lee Park", lastActiveAt: null, joinedAt: "2026-10-20T00:00:00Z", hired: false, assignedStaffId: ME },
    ],
    tasks: [
      { client_user_id: DANA, client_name: "Dana Ray", due_on: "2026-10-20", done_at: null },
      { client_user_id: DANA, client_name: "Dana Ray", due_on: "2026-10-30", done_at: null },
      { client_user_id: RAY, client_name: "Ray Moss", due_on: "2026-11-02", done_at: null },
    ],
    outcomes: [{ client_user_id: RAY, client_name: "Ray Moss", due_marks: [30], ended_on: null }],
    asks: [{ client_user_id: LEE, client_name: "Lee Park", scope: "resume", status: "pending", created_at: "2026-10-01T00:00:00Z" }],
    lastNotes: [{ client_user_id: DANA, last_on: "2026-09-10T00:00:00Z" }],
    ...over,
  };
}

it("digest: each stale flag carries a plain dated reason; nothing about anyone outside the input", () => {
  const d = buildCaseloadDigest(digestInput(), NOW);
  const dana = d.people.find((p) => p.participantId === DANA)!;
  assert.deepEqual(dana.flags.map((f) => f.flag).sort(), ["no_recent_note", "overdue_task", "quiet"]);
  assert.match(dana.flags.find((f) => f.flag === "quiet")!.reason, /^No activity in 25 days \(last active Oct 1\)$/);
  assert.match(dana.flags.find((f) => f.flag === "overdue_task")!.reason, /^1 task past due, the oldest due Oct 20$/);
  assert.match(dana.flags.find((f) => f.flag === "no_recent_note")!.reason, /^No case note since Sep 10$/);
  assert.equal(dana.nextTaskDue, "2026-10-30");
  const lee = d.people.find((p) => p.participantId === LEE)!;
  assert.deepEqual(lee.flags.map((f) => f.flag).sort(), ["ask_waiting", "never_started"], "joined 6 days ago: no 'no note' flag yet");
  assert.match(lee.flags.find((f) => f.flag === "ask_waiting")!.reason, /^Ask to share resume waiting 25 days$/);
  const ray = d.people.find((p) => p.participantId === RAY)!;
  assert.equal(ray.progressShared, false, "from org records only: progress not shared");
  assert.equal(ray.lastActiveOn, null);
  assert.ok(!ray.flags.some((f) => f.flag === "quiet" || f.flag === "never_started"), "not shared is never inactive");
  assert.ok(ray.flags.some((f) => f.flag === "retention_due" && f.reason === "30-day check-in due"));
  assert.deepEqual(d.counts, { people: 3, flagged: 3, quiet: 1, neverStarted: 1, overdueTasks: 1, retentionDue: 1, asksWaiting: 1, noRecentNote: 2, startedWork: 0 });
  assert.equal(d.reach, "assigned");
  assert.ok(!d.people.some((p) => p.flags.some((f) => f.flag === "unassigned")), "only someone who sees all gets the unassigned flag");
});

it("digest: a fresh ask is not waiting, a done task is not open, and the cap holds", () => {
  const d = buildCaseloadDigest(digestInput({
    asks: [{ client_user_id: LEE, client_name: "Lee", scope: "resume", status: "pending", created_at: new Date(NOW - (ASK_WAITING_DAYS - 1) * 86400000).toISOString() }],
    tasks: [{ client_user_id: DANA, client_name: "Dana", due_on: "2026-10-01", done_at: "2026-10-02T00:00:00Z" }],
  }), NOW, 1);
  assert.equal(d.people.length, 1);
  assert.equal(d.more, true);
  assert.equal(d.counts.asksWaiting, 0);
  assert.equal(d.counts.overdueTasks, 0);
});

const outcome = (o: Partial<Outcome>): Outcome => ({
  id: "o", client_user_id: DANA, client_name: "Dana", employer: "Northside Lumber", job_title: null, start_date: "2026-07-15", hourly_wage: "19.00", hours_per_week: null,
  source: "staff_verified", verification_method: "pay_stub_seen", verified_by_name: null, verified_at: null, ended_on: null, end_reason: null, created_by_name: null,
  checks: [], due_marks: [], ...o,
});

it("period outcomes: only placements that started in the period; rates over the eligible; no wage anywhere", () => {
  const rows = [
    outcome({ id: "a", start_date: "2026-07-10", checks: [{ day_mark: 30, status: "employed", method: "pay_stub_seen", checked_at: "2026-08-12T00:00:00Z" }, { day_mark: 60, status: "employed", method: "pay_stub_seen", checked_at: "2026-09-12T00:00:00Z" }] }),
    outcome({ id: "b", start_date: "2026-08-20", source: "participant_reported", checks: [{ day_mark: 30, status: "unknown", method: "could_not_reach", checked_at: "2026-09-25T00:00:00Z" }] }),
    outcome({ id: "c", start_date: "2026-09-25", ended_on: "2026-10-05", end_reason: "left_for_better_job" }),
    outcome({ id: "d", start_date: "2026-05-01" }),
    outcome({ id: "e", start_date: "2026-08-01", end_reason: "entered_in_error" }),
  ];
  const p = summarizeOutcomesForPeriod(rows, "2026-07-01", "2026-09-30", "people on your caseload", NOW);
  assert.equal(p.placementsStarted, 3);
  assert.deepEqual(p.bySource.map((b) => [b.source, b.count]).sort(), [["participant_reported", 1], ["staff_verified", 2]]);
  assert.equal(p.leftForBetter, 1);
  const r30 = p.retention.find((r) => r.dayMark === 30)!;
  // c ended before its 30-day mark, so the record already answers it: not there (summarizeOutcomes' rule).
  assert.deepEqual([r30.eligible, r30.employed, r30.unknown, r30.notEmployed], [3, 1, 1, 1], JSON.stringify(r30));
  assert.equal(r30.employedPercent, 33);
  assert.ok(!p.retention.some((r) => r.dayMark === 180), "a mark nobody reached is left out, not reported as 0%");
  assert.equal(p.checksRecorded, 3);
  assert.equal(p.smallNumbers, true);
  assert.doesNotMatch(JSON.stringify(p), /19\.00|hourly|wage":/i, "no wage leaves the summary");
});

it("period defaults: the last full quarter, across a year boundary too", () => {
  assert.deepEqual(lastQuarter(NOW), { from: "2026-07-01", to: "2026-09-30" });
  assert.deepEqual(lastQuarter(Date.parse("2026-02-10T00:00:00Z")), { from: "2025-10-01", to: "2025-12-31" });
});

it("reach predicate: smr_staff_reach when present, the narrower app rule before, and only safe column names", () => {
  assert.equal(staffReachPredicate("r.participant_user_id", true), "(public.smr_staff_reach($1::uuid, $3::uuid, r.participant_user_id) AND $2::boolean IS NOT NULL)");
  assert.match(staffReachPredicate("e.participant_user_id", false), /\$2::boolean OR EXISTS \(SELECT 1 FROM client_staff_assignment a/);
  assert.match(staffReachPredicate("$4::uuid", true), /smr_staff_reach\(\$1::uuid, \$3::uuid, \$4::uuid\)/);
  assert.throws(() => staffReachPredicate("x); DROP TABLE users; --", true));
});

const rows: TimelineRows = {
  notes: [{ id: "n1", kind: "call", body: "Talked about the warehouse opening.", occurred_at: "2026-10-20T00:00:00Z", author_name: "Pat Lee" }],
  tasks: [{ id: "t1", title: "Bring ID", due_on: "2026-10-30", done_at: null, created_at: "2026-10-21T00:00:00Z", done_by_participant: false }],
  asks: [{ id: "a1", client_user_id: DANA, scope: "resume", status: "approved", reason: "To tailor it", created_at: "2026-10-01T00:00:00Z", answered_at: "2026-10-22T00:00:00Z" },
    { id: "a2", client_user_id: LEE, scope: "resume", status: "pending", reason: "x", created_at: "2026-10-22T00:00:00Z", answered_at: null }],
  suggestions: [],
  outcomes: [{ id: "o1", client_user_id: DANA, employer: "Northside Lumber", start_date: "2026-10-23", end_reason: null, ended_on: null, checks: [] }],
  applications: [{ id: "j1", job_title: "Warehouse associate", company: "Northside Lumber", status: "hired", created_at: "2026-09-01T00:00:00Z", status_updated_at: "2026-10-22T00:00:00Z" }],
};

it("timeline: dated items with refs to cite, newest first, only this person's, in range", () => {
  const t = buildClientTimeline(DANA, "Dana", rows, "2026-10-01", "2026-10-26");
  assert.deepEqual(t.items.map((i) => [i.ref, i.source, i.on]), [
    ["P1", "placement", "2026-10-23"], ["A1", "ask", "2026-10-22"], ["J1", "application", "2026-10-22"], ["T1", "task", "2026-10-21"], ["N1", "note", "2026-10-20"],
  ]);
  assert.equal(t.items.find((i) => i.ref === "N1")!.body, "Talked about the warehouse opening.");
  assert.ok(!t.items.some((i) => i.sourceId === "a2"), "another person's ask never enters");
  assert.equal(t.applicationsRead, true);
});

it("timeline: a person who does not share applications gets no application items, and the result says so", () => {
  const t = buildClientTimeline(DANA, "Dana", { ...rows, applications: null }, "2026-10-01", "2026-10-26");
  assert.ok(!t.items.some((i) => i.source === "application"));
  assert.equal(t.applicationsRead, false);
});

it("skill-run row: an unknown skill becomes staff-general, a bad id is dropped, the answer is only hashed", () => {
  const r = skillRunRow({ skill: "DROP TABLE", participantId: "not-a-uuid", inputSummary: "  Prep me:\n  Dana  ", tools: ["read_participant_overview", "bad name!", "read_participant_overview"], output: "The answer." });
  assert.equal(r.skill, GENERAL_STAFF_SKILL);
  assert.equal(r.participant, null);
  assert.equal(r.summary, "Prep me: Dana");
  assert.deepEqual(r.tools, ["read_participant_overview"]);
  assert.equal(r.outputHash, skillOutputHash("The answer."));
  assert.match(r.outputHash, /^[0-9a-f]{64}$/);
  assert.equal(skillRunRow({ skill: "staff-prep-me", participantId: DANA.toUpperCase(), inputSummary: "x".repeat(400), tools: [], output: "" }).summary.length, 300);
  assert.equal(skillRunRow({ skill: "staff-prep-me", participantId: DANA, inputSummary: "", tools: [], output: "" }).participant, DANA);
});

it("the composed timeline read logs before anything else and reads applications only through the shared branch", async () => {
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL("../orgStaffAssistant.ts", import.meta.url), "utf8");
  const body = src.slice(src.indexOf("export async function getClientTimeline"));
  assert.equal(body.indexOf("await "), body.indexOf("await recordStaffAssistantOpen(actor, clientId, \"timeline\")"), "the first await is the log");
  assert.match(body, /if \(h\.scopes\.applications\.shared\) \{\s*const apps = await getClientApplications\(actor, clientId, \{ via: "t\.ROY" \}\)/);
});
