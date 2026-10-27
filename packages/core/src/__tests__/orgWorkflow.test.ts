/**
 * Staff workflow rules (migration 105, house lane L5), without a database:
 * the referral path and its reasons, draft kinds, search normalizing and the
 * duplicate rule, the timeline's SQL and wording, Today's referral section and
 * the retention-task de-duplication, and static checks on the migration.
 * The real SQL runs in apps/consumer/lib/__tests__/workflow-pglite.test.ts.
 * Fictional people only.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  REFERRAL_STATUSES, REFERRAL_TRANSITIONS, REFERRAL_DEFAULT_DUE_DAYS, checkReferralMove, defaultReferralDue, addDays, isReferralOverdue, referralNeedsReason,
  draftKindOk, DRAFT_KINDS, normalizeSearch, phoneDigits, searchable, duplicateReasons, parseTimelineTypes, parseTimelineCursor, TIMELINE_TYPES, TIMELINE_CHIPS,
  PARTNER_CONSENT_LINE, type ReferralStatus,
} from "../orgWorkflowShared";
import { timelineSql, timelineItemFromRow, availableTimelineTypes, OPTIONAL_TIMELINE_TABLES, type TimelineRow } from "../orgTimeline";
import { searchSql, duplicateSql, likeEscape, wordPatterns, nameScoreSql, cleanAliases, outsideReachReasons } from "../orgSearch";
import { LIST_REFERRALS_SQL, REFERRAL_SQL, listingName, canHandOff } from "../orgReferrals";
import { DRAFT_SQL } from "../orgDrafts";
import { buildTodayItems, TODAY_SECTIONS, type TodayInput } from "../orgTodayItems";
import { RLS_PROTECTED_TABLES } from "../rlsHealth";

const MIG = readFileSync(join(import.meta.dirname, "..", "..", "migrations", "105_workflow.sql"), "utf8");

describe("referrals: the closed loop", () => {
  it("TypeScript and the database agree on every move (smr_referral_next)", () => {
    const body = MIG.slice(MIG.indexOf("FUNCTION public.smr_referral_next"), MIG.indexOf("REVOKE ALL ON FUNCTION public.smr_referral_next"));
    for (const from of REFERRAL_STATUSES) {
      const m = body.match(new RegExp(`WHEN '${from}'\\s+THEN ARRAY\\[([^\\]]*)\\]`));
      const sql = m ? m[1].split(",").map((x) => x.trim().replace(/'/g, "")).filter(Boolean) : [];
      assert.deepEqual(sql, [...REFERRAL_TRANSITIONS[from]], `moves from ${from}`);
    }
  });
  it("closed is the end, and service delivered can only close", () => {
    assert.deepEqual(REFERRAL_TRANSITIONS.closed, []);
    assert.deepEqual(REFERRAL_TRANSITIONS.service_delivered, ["closed"]);
    for (const s of REFERRAL_STATUSES) assert.ok(!REFERRAL_TRANSITIONS[s].includes("draft"), `nothing goes back to draft (${s})`);
  });
  it("a reason is needed for declined, could not reach, and a close without help given", () => {
    assert.equal(referralNeedsReason("declined", false), true);
    assert.equal(referralNeedsReason("unable_to_contact", true), true);
    assert.equal(referralNeedsReason("closed", false), true);
    assert.equal(referralNeedsReason("closed", true), false);
    assert.equal(referralNeedsReason("accepted", false), false);
  });
  it("checkReferralMove: path, consent, reasons", () => {
    const base = { delivered: false, reason: null, toKind: "other" as const, consentOk: true };
    assert.equal(checkReferralMove({ ...base, from: "draft", to: "accepted" }).ok, false);
    assert.match((checkReferralMove({ ...base, from: "closed", to: "sent" }) as { error: string }).error, /closed/);
    assert.equal(checkReferralMove({ ...base, from: "draft", to: "sent" }).ok, true);
    assert.equal(checkReferralMove({ ...base, from: "sent", to: "declined" }).ok, false);
    assert.equal(checkReferralMove({ ...base, from: "sent", to: "declined", reason: "No openings" }).ok, true);
    assert.equal(checkReferralMove({ ...base, from: "service_delivered", to: "closed", delivered: true }).ok, true);
    const partner = { ...base, toKind: "partner_org" as const, consentOk: false };
    assert.deepEqual(checkReferralMove({ ...partner, from: "draft", to: "sent" }), { ok: false, error: PARTNER_CONSENT_LINE });
    assert.equal(checkReferralMove({ ...partner, from: "draft", to: "closed", reason: "Not needed now" }).ok, true, "a blocked draft can still be closed");
  });
  it("default next looks, and overdue", () => {
    assert.equal(addDays("2026-10-30", 3), "2026-11-02");
    assert.equal(defaultReferralDue("sent", "2026-10-26"), "2026-10-29");
    assert.equal(defaultReferralDue("closed", "2026-10-26"), null);
    for (const s of REFERRAL_STATUSES) assert.ok(s in REFERRAL_DEFAULT_DUE_DAYS);
    assert.equal(isReferralOverdue({ status: "sent", due_on: "2026-10-25" }, "2026-10-26"), true);
    assert.equal(isReferralOverdue({ status: "sent", due_on: "2026-10-26" }, "2026-10-26"), false, "due today is not overdue");
    assert.equal(isReferralOverdue({ status: "closed", due_on: "2026-01-01" }, "2026-10-26"), false);
    assert.equal(isReferralOverdue({ status: "draft", due_on: null }, "2026-10-26"), false);
  });
  it("partner wording never claims anything was sent", () => {
    assert.match(PARTNER_CONSENT_LINE, /stays a draft/);
    assert.doesNotMatch(PARTNER_CONSENT_LINE, /—/);
  });
  it("reads and writes carry the reach rule", () => {
    for (const sql of [LIST_REFERRALS_SQL, REFERRAL_SQL.insert, REFERRAL_SQL.move]) {
      assert.match(sql, /client_staff_assignment/);
      assert.match(sql, /access_code_redemption/);
    }
    assert.match(REFERRAL_SQL.move, /r\.status = \$5/, "a move only lands from the status it was read in");
    assert.match(LIST_REFERRALS_SQL, /staff_progress_counts/, "the name shown is the consent-gated one");
  });
  it("handing a referral to someone else needs org.client.assign (S3); the owner must reach the person in SQL", () => {
    const actor = (caps: string[]) => ({ userId: "me", capabilities: new Set(caps) }) as never;
    assert.equal(canHandOff(actor([]), null), true);
    assert.equal(canHandOff(actor([]), "me"), true);
    assert.equal(canHandOff(actor([]), "colleague"), false);
    assert.equal(canHandOff(actor(["org.client.assign"]), "colleague"), true);
    for (const sql of [REFERRAL_SQL.insert]) assert.match(sql, /public\.smr_staff_reach\(\$1::uuid, \$9::uuid, \$4::uuid\)/);
    assert.equal((MIG.match(/owner_staff_id IS NULL OR public\.smr_staff_reach\(access_code_id, owner_staff_id, participant_user_id\)/g) ?? []).length, 1, "the insert policy");
    assert.match(MIG, /IF NEW\.owner_staff_id IS DISTINCT FROM OLD\.owner_staff_id AND NEW\.owner_staff_id IS NOT NULL\s+AND NOT public\.smr_staff_reach\(NEW\.access_code_id, NEW\.owner_staff_id, NEW\.participant_user_id\)/,
      "an update checks the owner only when it changes, so a departed owner does not freeze the referral");
  });
  it("consent for a partner referral is the person's own choice, in the caller's org scope only (S1)", () => {
    const f = MIG.slice(MIG.indexOf("FUNCTION public.smr_referral_consent"), MIG.indexOf("REVOKE ALL ON FUNCTION public.smr_referral_consent"));
    assert.match(f, /p_org = NULLIF\(current_setting\('app\.org_id', true\), ''\)::uuid/);
    assert.match(f, /g\.basis = 'participant_choice'/);
  });
  it("a directory listing reads as organization and service", () => {
    assert.equal(listingName({ org_name: "Northside Pantry", service_name: "Food box" }), "Northside Pantry: Food box");
    assert.equal(listingName({ org_name: "Northside Pantry", service_name: "northside pantry" }), "Northside Pantry");
    assert.equal(listingName({ org_name: null, service_name: null }), "Directory listing");
  });
});

describe("drafts", () => {
  it("only the listed fields autosave, in the shape the database checks", () => {
    for (const k of ["note", "task", "ask_reason", "referral_reason", "outcome_note", "note_fix:0b7c3f9e-1111-4222-8333-944445555666", "field:intake_goal"]) assert.ok(draftKindOk(k), k);
    for (const k of ["", "Note", "note fix", "secret", "note:", "x", "note;drop", 7, null, "a".repeat(80)]) assert.equal(draftKindOk(k), false, String(k));
    assert.ok(MIG.includes(`kind ~ '^[a-z][a-z0-9_]{1,40}(:[a-z0-9_-]{1,60})?$'`), "same regex in the migration");
    assert.deepEqual([...DRAFT_KINDS].sort(), ["ask_reason", "field", "note", "note_fix", "outcome_note", "referral_reason", "task"]);
  });
  it("every draft statement is pinned to its author and organization; the purge is the owner-run function", () => {
    assert.equal(DRAFT_SQL.purge, "SELECT public.smr_purge_stale_staff_drafts() AS purged");
    for (const [name, sql] of Object.entries(DRAFT_SQL).filter(([n]) => n !== "purge")) {
      assert.match(sql, /user_id = \$2::uuid|VALUES \(\$2::uuid/, `${name} names the author`);
      assert.match(sql, /access_code_id = \$1::uuid|\$1::uuid, \$3::uuid/, `${name} names the org`);
    }
  });
});

describe("search", () => {
  it("normalizes case and space; phones as digits", () => {
    assert.equal(normalizeSearch("  Dana   WHITFIELD "), "dana whitfield");
    assert.equal(normalizeSearch(42), "");
    assert.equal(phoneDigits("(555) 010-0142"), "5550100142");
    assert.equal(phoneDigits("+1 555 010 0142"), "5550100142");
    assert.equal(searchable("d"), false);
    assert.equal(searchable("da"), true);
    assert.ok(MIG.includes("WHEN length(d) = 11 AND left(d, 1) = '1' THEN substr(d, 2)"), "the SQL phone rule matches");
  });
  it("escapes LIKE wildcards and builds word starts", () => {
    assert.equal(likeEscape("50%_off\\"), "50\\%\\_off\\\\");
    assert.deepEqual(wordPatterns("dan whit"), ["% dan%", "% whit%"]);
  });
  it("matches only on what the header may show: account details only with progress sharing on", () => {
    for (const env of [{ enrollment: true, trgm: "public" }, { enrollment: false, trgm: null }]) {
      const sql = searchSql(env);
      assert.match(sql, /CASE WHEN pc\.user_id IS NOT NULL THEN u\.name\s+ELSE oi\.invited_name\s+END/);
      assert.match(sql, /CASE WHEN pc\.user_id IS NOT NULL THEN lower\(u\.email\) ELSE lower\(oi\.invited_email\) END/);
      assert.match(sql, /staff_progress_counts/);
      assert.doesNotMatch(sql.replace(/CASE WHEN pc\.user_id IS NOT NULL THEN [^E]*ELSE/g, ""), /\bu\.email\b(?!\) ELSE)/, "no other use of the account email");
      assert.match(sql, /client_staff_assignment/, "reach-filtered");
      assert.equal(sql.includes("enrollment e"), env.enrollment, "program ids only when 103 is there");
      assert.equal(sql.includes("similarity("), !!env.trgm, "trigram only when the database has it");
    }
    assert.match(nameScoreSql("n", "$4", "$9", "ext"), /ext\.similarity\(n, \$4\)/);
  });
  it("outside reach, only an exact email or phone is counted, never a name (S6)", () => {
    assert.deepEqual(outsideReachReasons(["name", "email", "phone"]), ["email", "phone"]);
    assert.deepEqual(outsideReachReasons(["name"]), []);
  });
  it("the duplicate check counts people out of reach but the app never names them", () => {
    const sql = duplicateSql({ enrollment: false, trgm: null });
    assert.match(sql, /AS in_reach/);
    assert.match(sql, /org_invite oi0/, "pending invites count");
  });
  it("why someone looks like a duplicate", () => {
    const c = { name: "Dana Whitfield", email: "dana@example.test", phoneDigits: "5550100142", nameScore: 1 };
    assert.deepEqual(duplicateReasons(c, { email: "DANA@example.test" }), ["email"]);
    assert.deepEqual(duplicateReasons(c, { phone: "1-555-010-0142" }), ["phone"]);
    assert.deepEqual(duplicateReasons(c, { name: "dana  whitfield" }), ["name"]);
    assert.deepEqual(duplicateReasons({ ...c, nameScore: 0.7 }, { name: "Dana Whitfeld" }), ["name"], "a near-identical full name");
    assert.deepEqual(duplicateReasons({ ...c, nameScore: 0.7 }, { name: "Dana" }), [], "a first name alone is not enough");
    assert.deepEqual(duplicateReasons({ ...c, email: null, phoneDigits: null }, { email: "dana@example.test", phone: "5550100142" }), [], "nothing to compare is no match");
    assert.deepEqual(duplicateReasons(c, { phone: "0142" }), [], "a short number is not a phone match");
  });
  it("other names are cleaned: five at most, no repeats, trimmed", () => {
    assert.deepEqual(cleanAliases(" Dee ,dee, D. Whit,,A,B,C,D"), ["Dee", "D. Whit", "A", "B", "C"]);
    assert.deepEqual(cleanAliases(null), []);
    assert.equal(cleanAliases(["x".repeat(200)])[0].length, 120);
  });
});

describe("timeline", () => {
  const P = "11111111-1111-4111-8111-111111111111";
  it("every branch checks reach inside it, not only at the gate", () => {
    const sql = timelineSql([...TIMELINE_TYPES]);
    assert.equal((sql.match(/client_staff_assignment/g) ?? []).length, TIMELINE_TYPES.length);
    assert.match(sql, /ORDER BY at DESC, key DESC/);
    assert.match(sql, /\(at, key\) < \(\$5::timestamptz, \$6::text\)/);
  });
  it("tables from later migrations are read only when they exist", () => {
    assert.deepEqual(availableTimelineTypes([...TIMELINE_TYPES], new Set()), TIMELINE_TYPES.filter((t) => !OPTIONAL_TIMELINE_TABLES[t]));
    assert.ok(availableTimelineTypes([...TIMELINE_TYPES], new Set(["enrollment", "org_unit", "org_activity"])).includes("enrollment"));
    assert.ok(!availableTimelineTypes(["enrollment"], new Set(["enrollment"])).length, "both enrollment and org_unit are needed");
  });
  it("the activity branch leaves out what has its own branch", () => {
    const a = timelineSql(["activity"]);
    assert.match(a, /entity NOT IN \('note', 'task', 'outcome', 'retention', 'referral', 'sharing', 'comment'\)/);
    assert.match(a, /NOT \(a\.entity = 'enrollment' AND a\.action = 'created'\)/, "enrollment moves and custom field changes stay in");
  });
  it("filter types and cursors are parsed, never trusted", () => {
    assert.deepEqual(parseTimelineTypes("note,task,bogus"), ["note", "task"]);
    assert.deepEqual(parseTimelineTypes(""), [...TIMELINE_TYPES]);
    assert.deepEqual(parseTimelineTypes("bogus"), [...TIMELINE_TYPES]);
    assert.deepEqual(parseTimelineCursor(`2026-10-26T12:00:00.123456Z|note:${P}`), { at: "2026-10-26T12:00:00.123456Z", key: `note:${P}` });
    assert.equal(parseTimelineCursor(`2026-10-26T12:00:00Z|correction:123`)?.key, "correction:123");
    for (const bad of ["", "x|y", `yesterday|note:${P}`, `2026-10-26T12:00:00Z|note:${P}'; DROP`, `2026-10-26T12:00:00Z|Note:${P}`]) assert.equal(parseTimelineCursor(bad), null, bad);
    for (const c of TIMELINE_CHIPS) for (const t of c.types) assert.ok((TIMELINE_TYPES as readonly string[]).includes(t));
  });
  it("each line is written plainly, names no participant, and links to its source", () => {
    const row = (r: Partial<TimelineRow>): TimelineRow => ({ key: `note:${P}`, type: "note", at: "2026-10-20T15:00:00Z", src: P, actor_name: "Alma Reyes", f1: null, f2: null, f3: null, f4: null, f5: null, ...r });
    const cases: [Partial<TimelineRow>, string, RegExp][] = [
      [{ type: "note", f1: "call", f2: "Called about boots" }, "Call", /\?tab=notes#note-/],
      [{ type: "correction", key: "correction:12" }, "Note corrected. The earlier wording is kept with it.", /\?tab=notes#note-/],
      [{ type: "task", key: `task:${P}`, f1: "Bring ID", f2: "2026-10-30", f4: "open" }, "Task added: Bring ID, due Oct 30, 2026", /\?tab=tasks#task-/],
      [{ type: "task", key: `task:${P}`, f1: "30-day check-in: still at North Dock?", f4: "open", f5: "retention" }, "Check-in task made automatically: 30-day check-in: still at North Dock?", /#task-/],
      [{ type: "task", key: `task:${P}:1`, f1: "Bring ID", f3: "participant", f4: "done_event" }, "Task done, ticked off by them: Bring ID", /#task-/],
      [{ type: "ask", key: `ask:${P}`, f1: "resume", f2: "To help with Thursday", f3: "asked" }, "Asked them to share their resumes", /\?tab=shared/],
      [{ type: "ask", key: `ask:${P}:1`, f1: "applications", f3: "declined" }, "They said not now to sharing their applications", /\?tab=shared/],
      [{ type: "outcome", key: `outcome:${P}`, f1: "North Dock", f2: "Forklift operator", f3: "2026-09-01", f4: "staff_verified", f5: "recorded" }, "Placement recorded: Forklift operator at North Dock, started Sep 1, 2026", /#outcome-/],
      [{ type: "outcome", key: `outcome:${P}:1`, f1: "North Dock", f3: "2026-10-01", f4: "laid_off", f5: "ended" }, "Job at North Dock ended Oct 1, 2026: Laid off", /#outcome-/],
      [{ type: "retention", key: `retention:${P}`, f1: "30", f2: "unknown", f3: "North Dock" }, "30-day check-in at North Dock: could not reach them", /#outcome-/],
      // Team talk (109): a comment, a reply with mentions, a corrected one. Never a participant name.
      [{ type: "comment", key: `comment:${P}`, f1: "comment", f2: "Can you cover Thursday?", f4: "0" }, "Team comment", /\?tab=team#comment-/],
      [{ type: "comment", key: `comment:${P}`, f1: "reply", f2: "Yes", f4: "2" }, "Reply to a team comment, mentioning 2 team members", /#comment-/],
      [{ type: "comment", key: `comment:${P}`, f1: "comment", f2: "Fixed", f3: "2026-10-27T00:00:00Z", f4: "1" }, "Team comment, mentioning a team member (since corrected)", /#comment-/],
      [{ type: "retention", key: `retention:${P}`, f1: "30", f2: "employed", f3: "North Dock", f5: "superseded" }, "30-day check-in at North Dock: still working there (since corrected)", /#outcome-/],
      [{ type: "retention", key: `retention:${P}`, f1: "30", f2: "not_employed", f3: "North Dock", f4: "Wrong person called", f5: "correction" }, "Corrected the 30-day check-in at North Dock: no longer there", /#outcome-/],
      [{ type: "outcome", key: "outcomefix:9", f1: "North Dock", f3: "Typo in the start date", f4: "hourly_wage,start_date", f5: "corrected" }, "Placement at North Dock corrected (wage, start date)", /#outcome-/],
      [{ type: "referral", key: `referral:${P}`, f1: "Northside Pantry", f2: null, f3: "sent" }, "Referral to Northside Pantry made (sent)", /\?tab=referrals#referral-/],
      [{ type: "referral", key: `referral:${P}`, f1: "Northside Pantry", f2: "sent", f3: "service_delivered" }, "Referral to Northside Pantry: help was given", /#referral-/],
      [{ type: "enrollment", key: `enrollment:${P}`, f1: "Job readiness", f2: "active", f3: "2026-10-01" }, "Active in Job readiness (from Oct 1, 2026)", /#tl-enrollment-/],
      [{ type: "activity", key: "activity:77", f3: "Assigned to a case manager" }, "Assigned to a case manager", /#tl-activity-77/],
    ];
    for (const [r, title, href] of cases) {
      const i = timelineItemFromRow(row(r), P);
      assert.equal(i.title, title);
      assert.match(i.href, href);
      assert.ok(i.href.startsWith(`/dashboard/clients/${P}`));
      assert.doesNotMatch(i.title, /—/, "no em dash in UI copy");
    }
  });
});

describe("Today: referrals past due, and one line per retention check-in", () => {
  const NOW = Date.parse("2026-10-29T15:00:00Z");
  const ME = "staff-1";
  const base = (over: Partial<TodayInput> = {}): TodayInput => ({ actorUserId: ME, canAssignAll: false, canRecordOutcomes: true, quietDays: 14, tasks: [], outcomes: [], apps: [], answered: [], awaiting: [], cohort: [], invited: [], ...over });
  it("an overdue referral shows with a plain reason and a link to it", () => {
    const items = buildTodayItems(base({ referrals: [
      { id: "r1", participant_user_id: "p1", participant_name: "Dana Whitfield", to_name: "Northside Pantry", status: "sent", due_on: "2026-10-27" },
      { id: "r2", participant_user_id: "p2", participant_name: null, to_name: "Legal Aid Clinic", status: "accepted", due_on: "2026-10-28" },
      { id: "r3", participant_user_id: "p3", participant_name: "Ray Diaz", to_name: "Not yet", status: "sent", due_on: "2026-10-29" },
      { id: "r4", participant_user_id: "p4", participant_name: "Kim Hale", to_name: "Done place", status: "closed", due_on: "2026-10-01" },
    ] }), NOW).filter((i) => i.section === "referrals");
    assert.deepEqual(items.map((i) => [i.reason, i.action.href]), [
      ["Dana's referral to Northside Pantry is past its date (was due Tuesday, Oct 27): sent, no answer recorded. Check where it stands.", "/dashboard/clients/p1?tab=referrals#referral-r1"],
      ["A referral to Legal Aid Clinic is past its date (was due Wednesday, Oct 28): accepted, no contact recorded. Check where it stands.", "/dashboard/clients/p2?tab=referrals#referral-r2"],
    ]);
    assert.ok((TODAY_SECTIONS as readonly string[]).includes("referrals"));
  });
  it("an org's saved Today layout (104) that never mentions referrals still shows them, in code order; hiding it works", async () => {
    const { resolveTodaySections } = await import("../savedViewsShared");
    const got = resolveTodaySections(TODAY_SECTIONS, { order: ["quiet", "tasks"], hidden: [] });
    assert.deepEqual(got.slice(0, 3), ["quiet", "tasks", "retention"]);
    assert.ok(got.includes("referrals"));
    assert.ok(!resolveTodaySections(TODAY_SECTIONS, { order: [], hidden: ["referrals"] }).includes("referrals"));
    assert.deepEqual(resolveTodaySections(TODAY_SECTIONS, { order: ["referrals", "tasks"], hidden: [] }).slice(0, 2), ["referrals", "tasks"], "and an org can put it first");
  });
  it("no referrals input (before 105) is no section, not an error", () => {
    assert.equal(buildTodayItems(base(), NOW).filter((i) => i.section === "referrals").length, 0);
  });
  const outcome = { id: "o1", client_user_id: "p1", client_name: "Dana Whitfield", employer: "North Dock", start_date: "2026-07-20", ended_on: null, due_marks: [90] };
  const task = (owner: string, done: string | null = null) => ({ id: "t9", title: "90-day check-in: still at North Dock?", due_on: "2026-10-18", client_user_id: "p1", client_name: "Dana Whitfield",
    owner_user_id: owner, shared_with_participant: false, done_at: done, source_kind: "retention", source_id: "o1", source_mark: 90 });
  it("a check-in with its own task on my list shows once, as the task", () => {
    const items = buildTodayItems(base({ outcomes: [outcome], tasks: [task(ME)] }), NOW);
    assert.equal(items.filter((i) => i.section === "retention").length, 0);
    assert.equal(items.filter((i) => i.section === "tasks").length, 1);
  });
  it("a colleague's check-in task, or a finished one, leaves the retention line in place", () => {
    assert.equal(buildTodayItems(base({ outcomes: [outcome], tasks: [task("staff-2")] }), NOW).filter((i) => i.section === "retention").length, 1);
    assert.equal(buildTodayItems(base({ outcomes: [outcome], tasks: [task(ME, "2026-10-20T00:00:00Z")] }), NOW).filter((i) => i.section === "retention").length, 1);
  });
});

describe("migration 105, statically", () => {
  it("starts with its name and needs 102", () => {
    assert.equal(MIG.split("\n")[0], "-- 105_workflow.sql");
    assert.match(MIG, /to_regprocedure\('public\.smr_staff_reach\(uuid,uuid,uuid\)'\) IS NULL/);
    assert.match(MIG, /PERFORM public\.org_activity_write\(/, "activity goes through 102's one writer");
    assert.doesNotMatch(MIG, /INSERT INTO public\.org_activity/, "never written directly");
  });
  it("every new table: RLS enabled and forced, a restrictive reach policy, revoke before grant", () => {
    for (const t of ["staff_draft", "participant_contact", "referral", "referral_event"]) {
      assert.match(MIG, new RegExp(`ALTER TABLE ${t} ENABLE ROW LEVEL SECURITY;`));
      assert.match(MIG, new RegExp(`ALTER TABLE ${t} FORCE ROW LEVEL SECURITY;`));
      assert.match(MIG, new RegExp(`CREATE POLICY ${t}_reach ON ${t} AS RESTRICTIVE FOR ALL`));
      assert.ok((RLS_PROTECTED_TABLES as readonly string[]).includes(t), `${t} is in RLS_PROTECTED_TABLES`);
    }
    const grants = MIG.slice(MIG.indexOf("/* -------------------------------------------------------------------- grants -- */"));
    assert.ok(grants.indexOf("REVOKE ALL ON staff_draft, participant_contact, referral, referral_event FROM smr_app") < grants.indexOf("GRANT "));
    assert.match(grants, /GRANT SELECT ON referral_event TO smr_app;/);
    assert.doesNotMatch(grants, /referral_event TO smr_app[^;]*INSERT|INSERT[^;]*referral_event TO/);
  });
  it("account and organization deletes clear columns without tripping a guard or writing history (B1)", () => {
    assert.match(MIG, /FUNCTION public\.smr_only_gone_refs_cleared/);
    assert.equal((MIG.match(/smr_only_gone_refs_cleared\(to_jsonb\(NEW\), to_jsonb\(OLD\),\s+ARRAY\['created_by', 'updated_by', 'owner_staff_id', 'to_access_code_id'\]/g) ?? []).length, 2, "referral guard and history");
    assert.match(MIG, /smr_only_gone_refs_cleared\(to_jsonb\(NEW\) - 'phone_digits', to_jsonb\(OLD\) - 'phone_digits', ARRAY\['updated_by'\], ARRAY\['users'\]\)/, "participant_contact guard, ignoring the generated column");
  });
  it("drafts go after 30 days, and at once when staff or the person leave (S4)", () => {
    assert.match(MIG, /CREATE TRIGGER staff_draft_drop_on_staff_leave AFTER DELETE ON org_staff/);
    assert.match(MIG, /CREATE TRIGGER staff_draft_drop_on_member_leave AFTER DELETE ON access_code_redemption/);
    assert.match(MIG, /updated_at < now\(\) - interval '30 days'/);
  });
  it("retention tasks: owner fallback, re-dated by corrections, a 120-day backfill (S5); only the definer marks a task as system-made", () => {
    assert.match(MIG, /FUNCTION public\.smr_retention_task_owner/);
    assert.match(MIG, /SET due_on = NEW\.start_date \+ t\.source_mark/);
    assert.match(MIG, /start_date > current_date - 120 LOOP/);
    assert.match(MIG, /only the system makes check-in tasks/);
    const count = readFileSync(join(import.meta.dirname, "..", "..", "scripts", "105-backfill-count.sql"), "utf8");
    assert.match(count, /current_date - 120/);
    assert.doesNotMatch(count.replace(/--.*$/gm, ""), /\b(INSERT|UPDATE|DELETE|CREATE|ALTER|DROP)\b/i, "the count is read only");
  });
  it("drafts are owner-only for every verb", () => {
    const p = MIG.slice(MIG.indexOf("CREATE POLICY staff_draft_owner"), MIG.indexOf("DROP POLICY IF EXISTS staff_draft_reach"));
    assert.match(p, /FOR ALL/);
    assert.match(p, /USING \(user_id = NULLIF\(current_setting\('app\.user_id', true\), ''\)::uuid\s+AND access_code_id = NULLIF/);
  });
  it("definer functions pin their search path", () => {
    const defs = MIG.match(/CREATE OR REPLACE FUNCTION[\s\S]*?AS \$\$/g) ?? [];
    for (const d of defs.filter((x) => /SECURITY DEFINER/.test(x))) assert.match(d, /SET search_path = pg_catalog, public/, d.slice(0, 80));
  });
  it("no em dashes in what the migration tells people", () => {
    assert.doesNotMatch(MIG, /—/);
  });
});
