/**
 * Today's sentences and the N6 fixes (CRM wave, lane C1), on dated fixtures.
 * Fictional people only. No database: buildTodayItems is the pure half of
 * getTodayView; what may be READ (and the access log) stays in orgToday.ts.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { todayReachFor, todayIsVolunteer } from "../orgToday";
import { computeOrgCapabilities, STAFF_PRESETS } from "../authz/capabilities";
import { buildTodayItems, TODAY_SECTIONS, INTERVIEW_STALE_DAYS, FOLLOWUP_OVERDUE_DAYS, type TodayInput } from "../orgTodayItems";

const NOW = Date.parse("2026-10-29T15:00:00Z");
const daysAgo = (n: number) => new Date(NOW - n * 86400000).toISOString();
const daysAhead = (n: number) => new Date(NOW + n * 86400000).toISOString();

const ME = "staff-1";
function base(over: Partial<TodayInput> = {}): TodayInput {
  return { actorUserId: ME, canAssignAll: true, canRecordOutcomes: true, quietDays: 14, tasks: [], outcomes: [], apps: [], answered: [], awaiting: [], cohort: [], invited: [], ...over };
}
const app = (o: Partial<TodayInput["apps"][number]> & { id: string; user_id: string }) => ({
  name: "Dana Whitfield", job_title: "Line Cook", company: "Copperline Foods", status: "applied", follow_up_at: null,
  status_updated_at: daysAgo(2), updated_at: daysAgo(2), ...o,
});

// The demo seed's shape: one of every reason the queue knows.
const DEMO = base({
  tasks: [
    { id: "t1", title: "Call about bus pass", due_on: "2026-10-28", client_user_id: "p1", client_name: "Dana Whitfield", owner_user_id: ME, shared_with_participant: true, done_at: null },
    { id: "t2", title: "Order intake folders", due_on: "2026-11-02", client_user_id: null, client_name: null, owner_user_id: ME, shared_with_participant: false, done_at: null },
    { id: "t3", title: "Someone else's", due_on: null, client_user_id: null, client_name: null, owner_user_id: "staff-2", shared_with_participant: false, done_at: null },
  ],
  outcomes: [{ id: "o1", client_user_id: "p2", client_name: "Marcus Lee", employer: "Riverside Fabrication", start_date: "2026-07-20", ended_on: null, due_marks: [90] }],
  apps: [
    app({ id: "a1", user_id: "p1", status: "interviewing", follow_up_at: daysAhead(2) }),
    app({ id: "a2", user_id: "p3", name: "Ana Ortiz", job_title: "Warehouse Associate", company: "North Dock", follow_up_at: daysAhead(1) }),
  ],
  answered: [{ user_id: "p4", name: "Jay Brooks", scope: "resumes", status: "approved", answered_at: daysAgo(1) }, { user_id: "p5", name: "Kim Hale", scope: "applications", status: "declined", answered_at: daysAgo(2) }],
  awaiting: [{ user_id: "p6", name: "Lou Grant" }],
  cohort: [
    { userId: "p7", name: "Ray Diaz", hired: false, lastActiveAt: null, joinedAt: daysAgo(10), assignedStaffId: ME },
    { userId: "p8", name: "Sam Cole", hired: false, lastActiveAt: daysAgo(33), joinedAt: daysAgo(60), assignedStaffId: null },
    { userId: "p9", name: "Tess Kim", hired: true, lastActiveAt: daysAgo(40), joinedAt: daysAgo(90), assignedStaffId: ME },
  ],
  invited: [{ userId: "p10", name: "Vic Moss", joinedAt: daysAgo(3), assignedStaffId: null }],
});

test("demo seed shape: every sentence is the one the queue already wrote", () => {
  const got = buildTodayItems(DEMO, NOW).map((i) => [i.section, i.reason, i.action.label, i.action.href]);
  assert.deepEqual(got, [
    ["tasks", "Call about bus pass (was due Wednesday, Oct 28) · shared with Dana", "Open Dana", "/dashboard/clients/p1"],
    ["tasks", "Order intake folders (due Monday, Nov 2)", "Mark done", "#"],
    ["retention", "Marcus started at Riverside Fabrication 90+ days ago. Time for the 90-day check-in: still there?", "Record the check-in", "/dashboard/clients/p2"],
    ["interviews", "Dana is interviewing for Line Cook at Copperline Foods, next date Saturday, Oct 31.", "Help them prepare", "/dashboard/clients/p1"],
    ["followups", "Ana planned to follow up on Warehouse Associate at North Dock by Friday, Oct 30.", "Check in", "/dashboard/clients/p3"],
    ["answered", "Jay shared what you asked for (resumes).", "Open it", "/dashboard/clients/p4"],
    ["answered", "Kim said not now to sharing their applications. That is theirs to decide.", "Open Kim", "/dashboard/clients/p5"],
    ["acknowledgement", "Lou has not acknowledged what your program requires. Nothing is open until they do, and only they can.", "Talk it through", "/dashboard/clients/p6"],
    ["never_started", "Ray joined and has not started. A first conversation usually does more than a reminder.", "Reach out", "/dashboard/clients/p7"],
    ["quiet", "Sam was last active 33 days ago. Worth asking what is in the way.", "Check in", "/dashboard/clients/p8"],
    ["unassigned", "Sam is not assigned to anyone, so they are on nobody's list.", "Assign them", "/dashboard/people"],
    ["unassigned", "Vic was invited by your organization and is not assigned to anyone. They have not turned on progress sharing, so you see only the name you entered.", "Assign them", "/dashboard/people#invited"],
  ]);
});

test("N6: two applications with the same title and company get two keys", () => {
  const items = buildTodayItems(base({ apps: [
    app({ id: "a1", user_id: "p1", status: "interviewing", follow_up_at: daysAhead(1) }),
    app({ id: "a2", user_id: "p1", status: "interviewing", follow_up_at: daysAhead(3) }),
    app({ id: "a3", user_id: "p1", follow_up_at: daysAhead(1) }),
    app({ id: "a4", user_id: "p1", follow_up_at: daysAhead(2) }),
  ] }), NOW);
  const keys = items.map((i) => i.key);
  assert.equal(new Set(keys).size, keys.length, "keys are unique");
  assert.equal(items.filter((i) => i.section === "interviews").length, 2);
  assert.equal(items.filter((i) => i.section === "followups").length, 2);
});

test(`N6: interviewing with no movement for ${INTERVIEW_STALE_DAYS} days leaves "Interviews coming up"`, () => {
  const items = buildTodayItems(base({ apps: [
    app({ id: "old", user_id: "p1", status: "interviewing", follow_up_at: null, status_updated_at: daysAgo(31), updated_at: daysAgo(31) }),
    app({ id: "oldPastDate", user_id: "p2", name: "Ana Ortiz", status: "interviewing", follow_up_at: daysAgo(20), status_updated_at: daysAgo(45), updated_at: daysAgo(45) }),
    app({ id: "edge", user_id: "p3", name: "Jay Brooks", status: "interviewing", follow_up_at: null, status_updated_at: daysAgo(29), updated_at: daysAgo(29) }),
    // Old status, but a future date was set: still coming up.
    app({ id: "future", user_id: "p4", name: "Kim Hale", status: "interviewing", follow_up_at: daysAhead(4), status_updated_at: daysAgo(50), updated_at: daysAgo(50) }),
    // Status is old but the row was edited last week: it moved.
    app({ id: "edited", user_id: "p5", name: "Lou Grant", status: "interviewing", follow_up_at: null, status_updated_at: daysAgo(40), updated_at: daysAgo(6) }),
  ] }), NOW);
  const by = (id: string) => items.find((i) => i.key.endsWith(`:${id}`))!;
  const stalled = (user: string) => items.find((i) => i.key === `int-stalled:${user}`)!;
  assert.equal(stalled("p1").section, "interview_stalled");
  assert.equal(stalled("p1").reason, "Dana marked Line Cook at Copperline Foods as interviewing 31 days ago, and nothing has moved since. Worth asking how it went.");
  assert.equal(stalled("p2").section, "interview_stalled");
  assert.equal(items.filter((i) => i.section === "quiet").length, 0, "stalled interviews never land in Gone quiet");
  assert.equal(by("edge").section, "interviews");
  assert.equal(by("future").section, "interviews");
  assert.equal(by("edited").section, "interviews");
});

test(`N6: follow-ups more than ${FOLLOWUP_OVERDUE_DAYS} days past collapse to one line per person`, () => {
  const items = buildTodayItems(base({ apps: [
    app({ id: "f1", user_id: "p1", job_title: "Line Cook", follow_up_at: daysAgo(40) }),
    app({ id: "f2", user_id: "p1", job_title: "Prep Cook", follow_up_at: daysAgo(20) }),
    app({ id: "f3", user_id: "p1", job_title: "Dishwasher", follow_up_at: daysAgo(15) }),
    app({ id: "recent", user_id: "p1", job_title: "Server", follow_up_at: daysAgo(3) }),
    app({ id: "one", user_id: "p2", name: "Ana Ortiz", job_title: "Picker", company: "North Dock", follow_up_at: daysAgo(16) }),
  ] }), NOW);
  const fu = items.filter((i) => i.section === "followups");
  assert.equal(fu.length, 3, "one current line for Dana, one overdue line each for Dana and Ana");
  const dana = fu.find((i) => i.key === "fu-overdue:p1")!;
  assert.equal(dana.reason, "Follow-ups overdue: Dana has 3 follow-ups more than two weeks past the dates they set. The oldest is Line Cook at Copperline Foods, from Saturday, Sep 19.");
  const ana = fu.find((i) => i.key === "fu-overdue:p2")!;
  assert.equal(ana.reason, "Follow-up overdue: Ana planned to follow up on Picker at North Dock by Tuesday, Oct 13, more than two weeks ago.");
  assert.ok(fu.some((i) => i.key === "fu:p1:recent"), "a recent follow-up keeps its own line");
});

test("a viewer who cannot assign everyone never gets the Not assigned section", () => {
  const items = buildTodayItems({ ...DEMO, canAssignAll: false }, NOW);
  assert.equal(items.filter((i) => i.section === "unassigned").length, 0);
});

test("every section the builder emits is a known Today section", () => {
  for (const i of buildTodayItems(DEMO, NOW)) assert.ok((TODAY_SECTIONS as readonly string[]).includes(i.section));
});

test("the read side still decides what is read: the SELECT and the access-log INSERT share one filter, verbatim", () => {
  const src = readFileSync(join(import.meta.dirname, "..", "orgToday.ts"), "utf8");
  const norm = (t: string) => t.replace(/\s+/g, " ").trim();
  const sel = src.slice(src.indexOf("FROM staff_shared_application ja JOIN users u"));
  const selWhere = norm(sel.slice(sel.indexOf("WHERE "), sel.indexOf("ORDER BY ja.follow_up_at")));
  const ins = src.slice(src.indexOf("INSERT INTO data_access_log"));
  const insWhere = norm(ins.slice(ins.indexOf("WHERE "), ins.indexOf("AND NOT EXISTS (SELECT 1 FROM data_access_log")));
  const FILTER = norm(`WHERE ${"${reach(\"ja.user_id\")}"} AND ${"${sharesApps(\"ja.user_id\")}"}
          AND (ja.status = 'interviewing' OR (ja.follow_up_at IS NOT NULL AND ja.follow_up_at < now() + interval '3 days'
               AND ja.status NOT IN ('hired', 'started_work', 'rejected', 'declined')))`);
  assert.equal(selWhere, FILTER, "SELECT filter, reach and sharing clauses included");
  assert.equal(insWhere, FILTER, "INSERT filter matches the SELECT");
  // The clauses themselves, as at 964090c.
  assert.ok(norm(src).includes(norm(`const reach = (who: string) => \`($2::boolean OR EXISTS (SELECT 1 FROM client_staff_assignment a
      WHERE a.access_code_id = $1::uuid AND a.client_user_id = ${"${who}"} AND a.staff_user_id = $3::uuid))\`;`)));
  assert.ok(norm(src).includes(norm(`WHERE g.user_id = ${"${who}"} AND g.access_code_id = $1::uuid AND g.scope = 'applications' AND g.revoked_at IS NULL
        AND g.text_version = ANY($4::text[])
        AND ja.created_at >= COALESCE(g.covers_from, '-infinity'::timestamptz)`)));
  assert.ok(norm(src).includes(norm(`AND NOT EXISTS (SELECT 1 FROM data_access_log l WHERE l.target_user_id = ja.user_id AND l.accessor_id = ($3::uuid)::text
                           AND l.access_reason = 'org_work_queue' AND l.accessed_at > date_trunc('day', now()))`)));
});

test("reach: org-wide counts only for view_all; a volunteer gets null", () => {
  const cohort = { totalJoined: 9, summary: { consented: 4 } };
  const vol = computeOrgCapabilities("staff", [], STAFF_PRESETS.volunteer.denies);
  assert.equal(todayReachFor(vol, cohort), null);
  assert.equal(todayReachFor(computeOrgCapabilities("staff", [], ["org.client.view_all"]), cohort), null);
  assert.deepEqual(todayReachFor(computeOrgCapabilities("owner"), cohort), { joined: 9, sharing: 4 });
  assert.equal(todayIsVolunteer("staff", vol), true);
  assert.equal(todayIsVolunteer("staff", computeOrgCapabilities("staff")), false);
  assert.equal(todayIsVolunteer("owner", vol), false);
});

test("S2: hiding Gone quiet cannot hide a stalled interview (separate section keys)", () => {
  const items = buildTodayItems(base({
    apps: [app({ id: "s1", user_id: "p1", status: "interviewing", status_updated_at: daysAgo(35), updated_at: daysAgo(35) })],
    cohort: [{ userId: "p1", name: "Dana Whitfield", hired: false, lastActiveAt: daysAgo(40), joinedAt: daysAgo(90), assignedStaffId: ME, currentStage: 5 }],
  }), NOW);
  const visibleWithQuietHidden = items.filter((i) => i.section !== "quiet");
  assert.ok(visibleWithQuietHidden.some((i) => i.key === "int-stalled:p1"));
  assert.equal(items.filter((i) => i.section === "quiet" && i.clientId === "p1").length, 1, "one Gone quiet row per person");
});

test("S2: several stalled interviews for one person are one line", () => {
  const items = buildTodayItems(base({ apps: [
    app({ id: "x1", user_id: "p1", status: "interviewing", job_title: "Line Cook", status_updated_at: daysAgo(50), updated_at: daysAgo(50) }),
    app({ id: "x2", user_id: "p1", status: "interviewing", job_title: "Prep Cook", status_updated_at: daysAgo(40), updated_at: daysAgo(40) }),
  ] }), NOW);
  const s = items.filter((i) => i.section === "interview_stalled");
  assert.equal(s.length, 1);
  assert.equal(s[0].reason, "Dana has 2 applications marked interviewing with nothing moving for over 30 days. The oldest is Line Cook at Copperline Foods, 50 days.");
});

test("S5: no retention rows for someone who cannot record placements", () => {
  assert.equal(buildTodayItems({ ...DEMO, canRecordOutcomes: false }, NOW).filter((i) => i.section === "retention").length, 0);
  assert.equal(buildTodayItems(DEMO, NOW).filter((i) => i.section === "retention").length, 1);
});

test("settings and the queue know the same sections", () => {
  const prefs = readFileSync(join(import.meta.dirname, "..", "staffPrefsShared.ts"), "utf8");
  for (const k of TODAY_SECTIONS) assert.match(prefs, new RegExp(`"${k}"`));
});

test("station rides only on people in the progress-sharing cohort", () => {
  const input = base({
    apps: [app({ id: "a1", user_id: "appsOnly", status: "interviewing", follow_up_at: daysAhead(2) }), app({ id: "a2", user_id: "both", status: "interviewing", follow_up_at: daysAhead(2) })],
    cohort: [{ userId: "both", name: "Ana Ortiz", hired: false, lastActiveAt: daysAgo(1), joinedAt: daysAgo(30), assignedStaffId: ME, currentStage: 5 }],
    invited: [{ userId: "inv", name: "Vic Moss", joinedAt: daysAgo(3), assignedStaffId: null }],
  });
  const items = buildTodayItems(input, NOW);
  assert.equal(items.find((i) => i.clientId === "appsOnly")!.stage, null, "sharing applications alone does not reveal progress");
  assert.equal(items.find((i) => i.clientId === "both")!.stage, 5);
  assert.equal(items.find((i) => i.clientId === "inv")!.stage, null);
});
