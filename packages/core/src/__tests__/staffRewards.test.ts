/**
 * Staff rewards, the pure half (lane S6, migration 111). The SQL half is
 * proven in apps/consumer/lib/__tests__/staff-rewards-pglite.test.ts and the
 * isolation suite.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  MILESTONES, UNLOCKS, SKILL_MINUTES_SAVED, DEFAULT_MINUTES_SAVED, REWARDS_COPY, LISTING_NUDGE_LINE, NOT_COUNTED_FOR_TIME, RESEARCH_THRESHOLDS, NAME_STOPWORDS, foldAccents,
  buildMonthRecap, canAnswerRecognition, cleanKudosBody, cleanRecognitionBody, hasUnlock, milestoneDef, minutesSaved,
  monthWindow, namesMentioned, timeSavedWords, unlocksFor,
} from "../staffRewardsShared";
import {
  getRewardsSettings, setRewardsSettings, giveKudos, listKudos, giverBoard, refreshMilestones, rewardsOn, staffUnlocks,
  writeRecognitionNote, answerRecognitionNote, listRecognitionForReport, setProgramRewards, DEFAULT_REWARDS_SETTINGS,
} from "../staffRewards";
import type { OrgActor } from "../authz/resolveOrgActor";

const MIG111 = readFileSync(new URL("../../migrations/111_staff_rewards.sql", import.meta.url), "utf8");
const MIG112 = readFileSync(new URL("../../migrations/112_directory_contributions.sql", import.meta.url), "utf8");

test("every milestone key fits the 111 key shape and is written by the database somewhere", () => {
  const keys = MILESTONES.map((m) => m.key);
  assert.equal(new Set(keys).size, keys.length, "no duplicate keys");
  for (const k of keys) {
    assert.match(k, /^[a-z][a-z0-9_]{2,40}$/, k);
    // first_handoff_sent is written by lane S5's trigger (WIRING NEEDED); every other key appears in 111 or 112.
    if (k === "first_handoff_sent") continue;
    const learned = k.startsWith("learn_") && k !== "learn_three_tools" ? `staff-${k.slice(6).replace(/_/g, "-")}` : null;
    assert.ok(MIG111.includes(`'${k}'`) || MIG112.includes(`'${k}'`) || (learned && MIG111.includes(`'${learned}'`)), `${k} is awarded by 111 or 112`);
  }
});

test("no milestone rewards a participant's decision, consent or outcome (review round 1)", () => {
  const keys = MILESTONES.map((m) => m.key);
  for (const gone of ["first_ask_answered", "first_handoff_accepted"]) assert.ok(!keys.includes(gone), gone);
  assert.ok(!MIG111.includes("'first_ask_answered'"));
  assert.ok(!/s\.status = 'approved'/.test(MIG111), "no milestone waits on a participant's yes to an ask");
  assert.ok(!/f\.status = 'service_delivered'\s*\n\s*OR/.test(MIG111), "delivered alone (a provider's outcome) never earns the loop milestone");
  assert.match(MIG111, /length\(btrim\(COALESCE\(f\.status_reason, ''\)\)\) > 0/, "the loop counts when the staff member writes the reason");
  assert.match(MIG111, /length\(btrim\(s\.reason\)\) >= 20/, "the ask counts when it is sent with a clear reason, any answer");
  for (const m of MILESTONES) assert.ok(!/accepted|said yes|approved your|hired/i.test(`${m.title} ${m.detail}`) || ["first_draft_accepted", "recognized_by_program"].includes(m.key), `${m.key} is the staff member's own act`);
});

test("no milestone counts volume, notes, contacts or a client outcome", () => {
  const words = MILESTONES.map((m) => `${m.key} ${m.title} ${m.detail}`).join(" ").toLowerCase();
  for (const bad of ["hired", "placement", "placed", "wage", "notes written", "calls made", "contacts made", "retention", "per day", "most "]) {
    assert.ok(!words.includes(bad), `no milestone mentions "${bad}"`);
  }
});

test("the screens' words have no dashes as punctuation, no labels on people", () => {
  const all = [...MILESTONES.flatMap((m) => [m.title, m.detail]), ...UNLOCKS.flatMap((u) => [u.label, u.detail, u.howToEarn]), ...Object.values(REWARDS_COPY), LISTING_NUDGE_LINE].join(" \n ");
  assert.ok(!/[–—]/.test(all), "no en or em dashes");
  assert.ok(!/ -- /.test(all), "no double hyphen");
  assert.ok(!/\b(felon|offender|ex-con|convict)\b/i.test(all), "no labels on people");
  assert.match(all, /t\.ROY/, "t.ROY spelled that way");
  assert.ok(!/T\.ROY|t\.Roy|T\.roy/.test(all));
});

test("milestoneDef finds known keys only", () => {
  assert.equal(milestoneDef("first_kudos_given")?.group, "team");
  assert.equal(milestoneDef("made_up"), null);
});

test("unlocks open extra tools from milestones and never from nothing", () => {
  assert.deepEqual(unlocksFor([]), []);
  assert.deepEqual(unlocksFor(["first_saved_view"]), ["grid_color_rules"]);
  assert.ok(hasUnlock(["learn_three_tools"], "troy_month_recap"));
  assert.ok(!hasUnlock(["learn_prep_me"], "my_quick_prompts"), "one tool is not two");
  assert.ok(hasUnlock(["learn_prep_me", "learn_find_help"], "my_quick_prompts"));
  assert.ok(!hasUnlock(["learn_three_tools"], "my_quick_prompts"), "the summary badge does not count as a tool");
  assert.ok(hasUnlock(["first_verified_listing"], "directory_scout"));
  for (const u of UNLOCKS) assert.ok(u.howToEarn.length > 5 && u.detail.length > 10, u.key);
});

test("time saved: accepted drafts at the stated estimate, inside the window only", () => {
  const t0 = Date.parse("2026-10-01T00:00:00Z");
  const runs = [
    { skill: "staff-note-from-bullets", acceptedAt: "2026-10-02T10:00:00Z" },
    { skill: "staff-funder-narrative", acceptedAt: "2026-10-03T10:00:00Z" },
    { skill: "staff-unknown-thing", acceptedAt: "2026-10-04T10:00:00Z" },
    { skill: "staff-prep-me", acceptedAt: "2026-09-30T23:59:59Z" },
    { skill: "staff-prep-me", acceptedAt: "not a date" },
  ];
  const m = minutesSaved(runs, t0, Date.parse("2026-11-01T00:00:00Z"));
  assert.equal(m, SKILL_MINUTES_SAVED["staff-funder-narrative"] + DEFAULT_MINUTES_SAVED, "notes written never count toward time saved");
  for (const k of ["staff-note-from-bullets", "staff-outcome-note", "staff-outreach-draft", "staff-check-in"]) {
    assert.ok(NOT_COUNTED_FOR_TIME.has(k) && SKILL_MINUTES_SAVED[k] === undefined, `${k} is not counted`);
    assert.equal(minutesSaved([{ skill: k, acceptedAt: "2026-10-02T10:00:00Z" }], t0, Date.parse("2026-11-01T00:00:00Z")), 0);
  }
  assert.equal(minutesSaved([], t0, t0 + 1), 0);
});

test("time saved reads as about N, never a stopwatch", () => {
  assert.equal(timeSavedWords(0), null);
  assert.equal(timeSavedWords(-5), null);
  assert.equal(timeSavedWords(3), "about 5 minutes");
  assert.equal(timeSavedWords(42), "about 40 minutes");
  assert.equal(timeSavedWords(58), "about 1 hour");
  assert.equal(timeSavedWords(90), "about 1.5 hours");
  assert.equal(timeSavedWords(185), "about 3 hours");
});

test("a good catch is a few real words", () => {
  assert.equal(cleanKudosBody("  ").ok, false);
  assert.equal(cleanKudosBody("x".repeat(281)).ok, false);
  const ok = cleanKudosBody("Great  catch\u0007 on the deadline");
  assert.ok(ok.ok && ok.body === "Great catch on the deadline");
});

test("names (review rounds 2 and 3): the SQL rule, in the app", () => {
  const people = [{ id: "a", name: "Alma Reyes" }, { id: "b", name: "Ana Lin" }, { id: "c", name: "Bo Park" }, { id: "d", name: null },
    { id: "e", name: "Will Young" }, { id: "f", name: "José Luis Ortiz" }, { id: "g", name: "Circe Ayala Solano" }, { id: "h", name: "Bob Hale" }];
  assert.deepEqual(namesMentioned("great catch with alma reyes", people), ["a"], "full name, lower case");
  assert.deepEqual(namesMentioned("helped Ana", people), ["b"], "a capitalized 3-letter first name");
  assert.deepEqual(namesMentioned("work on the Reyes file", people), ["a"], "a capitalized last name mid-sentence");
  assert.deepEqual(namesMentioned("work on the reyes file", people), [], "known gap: one name in lower case is not caught");
  assert.deepEqual(namesMentioned("Bo was a great help", people), [], "two letters alone never count");
  assert.deepEqual(namesMentioned("thanks for bo park's paperwork", people), ["c"], "a full name does");
  assert.deepEqual(namesMentioned("Will you look. Young people came: Long day", people), [], "stopwords at a sentence start are ordinary words");
  assert.deepEqual(namesMentioned("thanks, it was Will who called", people), ["e"], "a capitalized name mid-sentence always counts, stopword or not");
  assert.deepEqual(namesMentioned("Bob called back", people), ["h"], "plain given names are not stopwords");
  assert.deepEqual(namesMentioned("thanks for helping jose ortiz", people), ["f"], "first and last, middle skipped, accents folded");
  assert.deepEqual(namesMentioned("the ayala solano file", people), ["g"], "all surname words together, any case");
  assert.deepEqual(namesMentioned("thanks for José", people), ["f"], "accents folded on the text side");
  assert.deepEqual(namesMentioned("Almanac review went well", people), [], "whole words only");
  for (const w of ["bob", "bill", "jack", "frank", "dean", "ray"]) assert.ok(!NAME_STOPWORDS.has(w) && !MIG111.includes(`'${w}'`), `${w} is a plain given name`);
  const sqlStop = (MIG111.match(/v_stop\s+text\[\] := ARRAY\[([^\]]+)\]/)?.[1] ?? "").match(/'([a-z]+)'/g)?.map((x) => x.slice(1, -1)) ?? [];
  assert.deepEqual([...new Set(sqlStop)].sort(), [...NAME_STOPWORDS].sort(), "SQL and TS stopwords are identical");
  assert.equal(foldAccents("Ñúñez Çelik"), "Nunez Celik");
});

test("the research thresholds are one set of numbers for Troy, the same in 111 and 112", () => {
  assert.deepEqual(RESEARCH_THRESHOLDS, { research_helper: 3, research_partner: 10, directory_anchor: 25 });
  for (const [k, n] of Object.entries(RESEARCH_THRESHOLDS)) {
    assert.ok(MIG112.includes(`v_credit >= ${n} THEN PERFORM public.staff_milestone_grant(c.submitted_by, c.access_code_id, '${k}'`), `112 grants ${k} at ${n}`);
    assert.ok(MIG111.includes(`'${k}', id, decided_at FROM mine WHERE running >= ${n}`), `111 derives ${k} at ${n}`);
    assert.ok(MIG112.includes(`m.key = '${k}' AND v_credit < ${n}`), `112 takes ${k} back below ${n}`);
  }
});

test("recognition answers: yes or no, take a yes back, change a no to yes", () => {
  assert.ok(canAnswerRecognition("asked", "approved"));
  assert.ok(canAnswerRecognition("asked", "declined"));
  assert.ok(canAnswerRecognition("approved", "withdrawn"));
  assert.ok(canAnswerRecognition("declined", "approved"));
  assert.ok(!canAnswerRecognition("withdrawn", "approved"));
  assert.ok(!canAnswerRecognition("approved", "asked"));
  // The same transitions as the 111 guard.
  assert.match(MIG111, /OLD\.status = 'asked' AND NEW\.status IN \('approved', 'declined'\)/);
  assert.match(MIG111, /OLD\.status = 'approved' AND NEW\.status = 'withdrawn'/);
  assert.match(MIG111, /OLD\.status = 'declined' AND NEW\.status = 'approved'/);
  assert.equal(cleanRecognitionBody("short").ok, false);
  assert.equal(cleanRecognitionBody("Built the checklist the whole team uses").ok, true);
});

test("the month recap: craft, thanks and time back, never an outcome", () => {
  const recap = buildMonthRecap({
    monthLabel: "October 2026", firstName: "Alma",
    milestones: [{ key: "first_kudos_given", earnedAt: "2026-10-02" }, { key: "made_up", earnedAt: "2026-10-03" }],
    kudosGiven: 2, kudosReceivedFrom: ["Sam", "Lee", "Sam"],
    minutesSaved: 125, contributionsApproved: 1, recognitionApproved: 1,
  });
  assert.equal(recap.title, "Alma's month: October 2026");
  assert.ok(recap.lines.some((l) => l.includes("You lifted someone up")));
  assert.ok(recap.lines.some((l) => l.includes("about 2 hours")));
  assert.ok(recap.lines.some((l) => l === "I sent good catches to colleagues."));
  assert.ok(recap.lines.some((l) => l === "Thanked by Sam and Lee."), JSON.stringify(recap.lines));
  assert.ok(!/\d/.test(recap.lines.join(" ").replace(/about [\d.]+ (hours?|minutes)/, "")), "names only, no counts (review round 2)");
  assert.ok(!recap.text.includes('"'), "never a colleague's words");
  assert.ok(recap.lines.some((l) => l.includes("funder report")));
  assert.ok(recap.lines.some((l) => l.includes("passed review")));
  assert.ok(!recap.text.includes("made_up"));
  assert.ok(!/[–—]/.test(recap.text));
  const empty = buildMonthRecap({ monthLabel: "October 2026", firstName: null, milestones: [], kudosGiven: 0, kudosReceivedFrom: [], minutesSaved: 0, contributionsApproved: 0, recognitionApproved: 0 });
  assert.ok(empty.empty && empty.title.startsWith("My month"));
});

test("monthWindow is the calendar month in UTC", () => {
  const w = monthWindow(Date.parse("2026-10-27T15:00:00Z"));
  assert.equal(new Date(w.fromMs).toISOString(), "2026-10-01T00:00:00.000Z");
  assert.equal(new Date(w.toMs).toISOString(), "2026-11-01T00:00:00.000Z");
  assert.equal(w.label, "October 2026");
});

const viewing: OrgActor = {
  userId: "00000000-0000-4000-8000-000000000001", orgId: "00000000-0000-4000-8000-000000000002", orgName: "Lakeshore Works (Demo)",
  role: "owner", capabilities: new Set(), reach: "all", viaPlatformAdmin: true,
};

test("a platform admin viewing an organization reads defaults and writes nothing (no database touched)", async () => {
  assert.deepEqual(await getRewardsSettings(viewing), DEFAULT_REWARDS_SETTINGS);
  assert.equal(DEFAULT_REWARDS_SETTINGS.rewardsOn, false, "off by default");
  assert.equal(await rewardsOn(viewing), false);
  assert.equal(await setRewardsSettings(viewing, { rewardsOn: true }), null);
  const k = await giveKudos(viewing, { toUserId: "00000000-0000-4000-8000-000000000003", body: "Great catch" });
  assert.equal(k.ok, false);
  assert.deepEqual(await listKudos(viewing), { received: [], given: [] });
  assert.deepEqual(await giverBoard(viewing), []);
  assert.equal(await refreshMilestones(viewing), 0);
  assert.deepEqual(await staffUnlocks(viewing), []);
  assert.equal((await writeRecognitionNote(viewing, { aboutUserId: "00000000-0000-4000-8000-000000000003", body: "Built the checklist the whole team uses" })).ok, false);
  assert.equal(await answerRecognitionNote(viewing, "00000000-0000-4000-8000-000000000004", "approved"), false);
  assert.equal(await listRecognitionForReport(viewing), null);
  assert.equal((await setProgramRewards(viewing, { teamBoardOn: false })).ok, false);
});

test("input checks run before the database: self, bad ids, a name with no linked work", async () => {
  const staff: OrgActor = { ...viewing, role: "staff", viaPlatformAdmin: false };
  assert.equal((await giveKudos(staff, { toUserId: staff.userId, body: "Great catch on that" })).ok, false, "not yourself");
  assert.equal((await giveKudos(staff, { toUserId: "nope", body: "Great catch on that" })).ok, false);
  assert.equal((await giveKudos(staff, { toUserId: "00000000-0000-4000-8000-000000000009", body: "x" })).ok, false, "too short");
  const other = await giveKudos(staff, { toUserId: "00000000-0000-4000-8000-000000000009", body: "Thanks for the help", workKind: "other", workId: "00000000-0000-4000-8000-000000000010" });
  assert.ok(!other.ok && /not linked/.test(other.reason), "other work carries no link");
  const badId = await giveKudos(staff, { toUserId: "00000000-0000-4000-8000-000000000009", body: "Thanks for the help", workKind: "listing", workId: "not-an-id" });
  assert.ok(!badId.ok && /not found/.test(badId.reason), "a listing link must be an id");
  assert.equal((await writeRecognitionNote(staff, { aboutUserId: "00000000-0000-4000-8000-000000000003", body: "Built the checklist the whole team uses" })).ok, false, "staff cannot write recognition notes");
  assert.equal((await setProgramRewards(staff, { teamBoardOn: false })).ok, false, "staff cannot change program settings");
});
