/**
 * Staff rewards, the pure half (lane S6, migration 111). The SQL half is
 * proven in apps/consumer/lib/__tests__/staff-rewards-pglite.test.ts and the
 * isolation suite.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  MILESTONES, UNLOCKS, SKILL_MINUTES_SAVED, DEFAULT_MINUTES_SAVED, REWARDS_COPY, LISTING_NUDGE_LINE,
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
    // first_handoff_accepted is written by lane S5's trigger (WIRING NEEDED); every other key appears in 111 or 112.
    if (k === "first_handoff_accepted") continue;
    const learned = k.startsWith("learn_") && k !== "learn_three_tools" ? `staff-${k.slice(6).replace(/_/g, "-")}` : null;
    assert.ok(MIG111.includes(`'${k}'`) || MIG112.includes(`'${k}'`) || (learned && MIG111.includes(`'${learned}'`)), `${k} is awarded by 111 or 112`);
  }
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
  assert.equal(m, SKILL_MINUTES_SAVED["staff-note-from-bullets"] + SKILL_MINUTES_SAVED["staff-funder-narrative"] + DEFAULT_MINUTES_SAVED);
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

test("names in a good catch: full names, distinctive first names, whole words, case-sensitive", () => {
  const people = [{ id: "a", name: "Alma Reyes" }, { id: "b", name: "Grace Lin" }, { id: "c", name: "Bo Park" }, { id: "d", name: null }];
  assert.deepEqual(namesMentioned("Thanks for helping Alma with the bus pass", people), ["a"]);
  assert.deepEqual(namesMentioned("Thanks for the grace you showed", people), [], "the word, not the person");
  assert.deepEqual(namesMentioned("Bo was a great help", people), [], "a short first name alone is too common to count");
  assert.deepEqual(namesMentioned("Thanks for Bo Park's paperwork", people), ["c"], "a full name counts");
  assert.deepEqual(namesMentioned("Almanac review went well", people), [], "whole words only");
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
    kudosGiven: 2, kudosReceived: [{ body: "Great catch on the deadline", fromFirstName: "Sam" }],
    minutesSaved: 125, contributionsApproved: 1, recognitionNotes: [{ body: "Built the checklist" }],
  });
  assert.equal(recap.title, "Alma's month: October 2026");
  assert.ok(recap.lines.some((l) => l.includes("You lifted someone up")));
  assert.ok(recap.lines.some((l) => l.includes("about 2 hours")));
  assert.ok(recap.lines.some((l) => l.includes("2 good catches")));
  assert.ok(recap.lines.some((l) => l.includes('Sam wrote: "Great catch on the deadline"')));
  assert.ok(recap.lines.some((l) => l.includes("One update")));
  assert.ok(!recap.text.includes("made_up"));
  assert.ok(!/[–—]/.test(recap.text));
  const empty = buildMonthRecap({ monthLabel: "October 2026", firstName: null, milestones: [], kudosGiven: 0, kudosReceived: [], minutesSaved: 0, contributionsApproved: 0, recognitionNotes: [] });
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
  const named = await giveKudos(staff, { toUserId: "00000000-0000-4000-8000-000000000009", body: "Thanks for helping Alma" }, ["00000000-0000-4000-8000-000000000010"]);
  assert.ok(!named.ok && /Leave the person's name out/.test(named.reason), "a named person needs the linked work");
  assert.equal((await writeRecognitionNote(staff, { aboutUserId: "00000000-0000-4000-8000-000000000003", body: "Built the checklist the whole team uses" })).ok, false, "staff cannot write recognition notes");
  assert.equal((await setProgramRewards(staff, { teamBoardOn: false })).ok, false, "staff cannot change program settings");
});
