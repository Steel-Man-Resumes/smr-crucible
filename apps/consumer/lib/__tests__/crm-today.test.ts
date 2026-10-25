/**
 * CRM wave 2026-10-25, lane C1: Today, every state, on fixture data.
 * Fictional people and a fictional organization only.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { computeOrgCapabilities, STAFF_PRESETS, cohortReach } from "@crucible/core/src/authz/capabilities";
import { todayHeadline, reasonStrip, thisWeek, relativeWhen, nobodySharesLine, personInitials, type TodayPayload } from "../today-view";
import { TodayView } from "../../components/org/TodayPage";

(globalThis as { React?: unknown }).React = React;
const CONSUMER = join(import.meta.dirname, "..", "..");
const read = (p: string) => readFileSync(join(CONSUMER, p), "utf8");
const VOLUNTEER = Array.from(computeOrgCapabilities("staff", [], STAFF_PRESETS.volunteer.denies));

// ── Today, every state, on fixtures ─────────────────────────────────────────
const NOW = new Date(2026, 9, 29, 9, 0, 0).getTime(); // Thursday Oct 29, local
const iso = (days: number) => new Date(NOW + days * 86400000).toISOString();
const SECTIONS = [
  ["tasks", "Your tasks"], ["retention", "Retention check-ins due"], ["interviews", "Interviews coming up"], ["followups", "Follow-ups due"],
  ["answered", "They answered you"], ["acknowledgement", "Waiting on an acknowledgement"], ["quiet", "Gone quiet"], ["never_started", "Never started"], ["unassigned", "Not assigned to anyone"],
].map(([key, label]) => ({ key, label }));
const FULL: TodayPayload = {
  sections: SECTIONS, hidden: [], canAddTasks: true, reach: { joined: 6, sharing: 4 }, volunteer: false,
  items: [
    { key: "task:t1", section: "tasks", clientId: null, clientName: null, taskId: "t1", when: "2026-10-30", reason: "Order intake folders (due Friday, Oct 30)", action: { label: "Mark done", href: "#" } },
    { key: "int:p1:a1", section: "interviews", clientId: "p1", clientName: "Dana Whitfield", when: iso(2), stage: 5, reason: "Dana is interviewing for Line Cook at Copperline Foods, next date Saturday, Oct 31.", action: { label: "Help them prepare", href: "/dashboard/clients/p1" } },
    { key: "q:p2", section: "quiet", clientId: "p2", clientName: "Sam Cole", when: iso(-33), stage: 2, reason: "Sam was last active 33 days ago. Worth asking what is in the way.", action: { label: "Check in", href: "/dashboard/clients/p2" } },
    { key: "ns:p3", section: "never_started", clientId: "p3", clientName: "Ray Diaz", when: iso(-10), stage: 0, reason: "Ray joined and has not started. A first conversation usually does more than a reminder.", action: { label: "Reach out", href: "/dashboard/clients/p3" } },
    { key: "fu:p4:a9", section: "followups", clientId: "p4", clientName: "Ana Ortiz", when: iso(1), stage: null, reason: "Ana planned to follow up on Picker at North Dock by Friday, Oct 30.", action: { label: "Check in", href: "/dashboard/clients/p4" } },
  ],
};
const render = (state: Parameters<typeof TodayView>[0]["state"]) => renderToStaticMarkup(React.createElement(TodayView, { state, nowMs: NOW, timeZone: undefined }));

test("Today ready: date, headline, reason strip in code order, rows with station, time, action and Prep me", () => {
  const html = render({ status: "ready", data: FULL });
  assert.match(html, /Thursday, Oct 29/);
  assert.match(html, /4 people need you today\. 1 task is yours\./);
  const chips = reasonStrip(FULL).map((c) => c.key);
  assert.deepEqual(chips, ["tasks", "interviews", "followups", "quiet", "never_started"]);
  assert.ok(html.indexOf("Interviews coming up") < html.indexOf("Follow-ups due") && html.indexOf("Follow-ups due") < html.indexOf("Gone quiet") && html.indexOf("Gone quiet") < html.indexOf("Never started"));
  assert.match(html, /Station: <\/span>Practice/);
  assert.match(html, /Station: <\/span>Find work/);
  assert.match(html, /in 2 days/);
  assert.match(html, /33 days ago/);
  assert.match(html, /aria-label="Prep me for Dana"/);
  assert.match(html, /Help them prepare/);
  assert.match(html, /Mark done/);
  assert.match(html, /This week/);
  assert.match(html, /Why someone might not be here/);
  assert.doesNotMatch(html, /\$/, "no $ prompt anywhere on Today");
  assert.doesNotMatch(html, /Stage \d of 6/);
});

test("Today keyboard path: every row action is a real link or button, in reading order", () => {
  const html = render({ status: "ready", data: FULL });
  const row = html.slice(html.indexOf("Dana is interviewing"));
  const a = row.indexOf("Help them prepare"), b = row.indexOf("Prep me for Dana");
  assert.ok(a > 0 && b > a, "primary action, then Prep me");
  assert.doesNotMatch(html, /<div[^>]*onClick|tabindex="0"/i);
});

test("Today loading: a skeleton with a status line, never the bare word Loading", () => {
  const html = render({ status: "loading" });
  assert.match(html, /aria-busy="true"/);
  assert.match(html, /Getting your day ready\./);
  assert.doesNotMatch(html, /Loading\.\.\./);
});

test("Today error: says nothing was lost and offers a retry", () => {
  const html = render({ status: "error" });
  assert.match(html, /role="alert"/);
  assert.match(html, /Your day did not load\. Nothing was lost\./);
  assert.match(html, /<button[^>]*>Try again<\/button>/);
});

test("Today 403: names who it is for and who to ask", () => {
  assert.match(render({ status: "forbidden" }), /Today is for staff with access to people&#x27;s progress\. Ask your organization&#x27;s owner\./);
});

test("Today empty: the plain line, the t.ROY offer, and Add a task stays", () => {
  const html = render({ status: "ready", data: { ...FULL, items: [] } });
  assert.match(html, /Nothing is waiting on you right now\./);
  assert.match(html, /Quiet days are when first conversations happen\. Want t\.ROY to suggest who to call\?/);
  assert.match(html, /Add a task for yourself/);
  assert.match(html, /Nothing dated in the next seven days\./);
});

test("Today empty because nobody shares: the count line, for org-wide viewers only", () => {
  const html = render({ status: "ready", data: { ...FULL, items: [], reach: { joined: 5, sharing: 0 } } });
  assert.match(html, /5 people joined\. None has turned on progress sharing yet, so nothing about their work shows here\. That is their choice\./);
  assert.equal(nobodySharesLine({ ...FULL, reach: { joined: 1, sharing: 0 } }), "1 person joined and has not turned on progress sharing yet, so nothing about their work shows here. That is their choice.");
  assert.equal(nobodySharesLine({ ...FULL, reach: null }), null, "someone with only their own caseload never gets org counts");
});

test("Today volunteer: assigned people only, the volunteer line, no org counts", () => {
  const v: TodayPayload = { ...FULL, volunteer: true, reach: null, canAddTasks: true };
  const html = render({ status: "ready", data: v });
  assert.match(html, /4 of your assigned people need you today\./);
  assert.match(html, /As a volunteer you see the people assigned to you\. Placements and invites are handled by staff\./);
  assert.doesNotMatch(html, /people joined/);
  assert.equal(todayHeadline({ ...v, items: FULL.items.slice(1, 2) }), "1 of your assigned people needs you today.");
  // And the scope itself: the volunteer preset reaches only assigned people.
  assert.equal(cohortReach(new Set(VOLUNTEER) as never), "assigned");
});

test("Today volunteer scope on the server: reach is null unless the viewer sees everyone", () => {
  const core = readFileSync(join(CONSUMER, "..", "..", "packages", "core", "src", "orgToday.ts"), "utf8");
  assert.match(core, /reach: seesAll \? \{ joined: cohort\.totalJoined, sharing: cohort\.summary\.consented \} : null/);
  assert.match(core, /assignedToStaffId: seesAll \? undefined : actor\.userId/);
  assert.match(read("app/api/org/today/route.ts"), /reach: view\.reach,/);
});

test("Today demo org: the shell carries the sample-data line; Today itself adds nothing", () => {
  const html = render({ status: "ready", data: FULL });
  assert.doesNotMatch(html, /Sample data/);
});

test("Today hidden sections: not shown, and a quiet link says how many", () => {
  const html = render({ status: "ready", data: { ...FULL, hidden: ["quiet"] } });
  assert.doesNotMatch(html, /Sam was last active/);
  assert.match(html, /1 section hidden in your settings/);
});

test("this week: dated items in the next seven days, soonest first", () => {
  const week = thisWeek(FULL, NOW).map((w) => [w.item.key, w.label]);
  assert.deepEqual(week, [["task:t1", "tomorrow"], ["fu:p4:a9", "tomorrow"], ["int:p1:a1", "in 2 days"]]);
  assert.equal(relativeWhen(null, NOW), null);
  assert.equal(personInitials("Dana Whitfield"), "DW");
});

