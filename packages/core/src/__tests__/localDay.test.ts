// Demo fix T2 (2026-10-28): staff t.ROY said "He was last active Thu Oct 29"
// while the person's card said Oct 28. The reads cut String(date).slice(0, 10)
// on Date objects in UTC. These pin the day to the organization's zone.
import { it } from "node:test";
import assert from "node:assert/strict";
import { localDay, DEFAULT_LOCAL_TIME_ZONE } from "../localDay";
import { buildClientTimeline, type TimelineRows } from "../orgStaffAssistant";
import { buildCaseloadDigest } from "../orgStaffCaseload";

// Wednesday Oct 28, 9:14 PM Central = Thursday Oct 29, 02:14 UTC.
const EVENING = new Date("2026-10-29T02:14:00Z");

it("a Date from the driver becomes the org-zone day, never 'Thu Oct 29'", () => {
  assert.equal(String(EVENING).slice(0, 10).includes("Oct"), true, "the old cut, for the record");
  assert.equal(localDay(EVENING, "America/Chicago"), "2026-10-28");
  assert.equal(localDay(EVENING, "America/New_York"), "2026-10-28");
  assert.equal(localDay(EVENING, "America/Detroit"), "2026-10-28");
  assert.equal(localDay(EVENING, "UTC"), "2026-10-29");
  assert.match(localDay(EVENING, DEFAULT_LOCAL_TIME_ZONE)!, /^\d{4}-\d{2}-\d{2}$/);
});

it("ISO and Postgres text times are read the same way", () => {
  assert.equal(localDay("2026-10-29T02:14:00.000Z", "America/Chicago"), "2026-10-28");
  assert.equal(localDay("2026-10-29 02:14:00+00", "America/Chicago"), "2026-10-28");
  assert.equal(localDay("2026-10-29T02:14:00+00:00", "America/New_York"), "2026-10-28");
});

it("plain dates pass through; no zone keeps the UTC day; junk is null", () => {
  assert.equal(localDay("2026-10-28", "Pacific/Honolulu"), "2026-10-28");
  assert.equal(localDay("2026-10-29T02:14:00Z"), "2026-10-29");
  assert.equal(localDay(null, "America/Chicago"), null);
  assert.equal(localDay("", "America/Chicago"), null);
  assert.equal(localDay("not a date", "America/Chicago"), null);
});

it("a zone the runtime does not know falls back to the default zone", () => {
  assert.equal(localDay(EVENING, "Mars/Olympus"), localDay(EVENING, DEFAULT_LOCAL_TIME_ZONE));
});

it("the sourced timeline dates and filters in the org zone", () => {
  const rows: TimelineRows = {
    notes: [{ id: "n1", kind: "general", body: "Called him", occurred_at: EVENING as unknown as string, author_name: "Lupe Diaz" }],
    tasks: null, asks: [], suggestions: [], outcomes: [], applications: null,
  };
  const t = buildClientTimeline("p1", "John", rows, "2026-10-28", "2026-10-28", 40, "America/Chicago");
  assert.equal(t.items.length, 1);
  assert.equal(t.items[0].on, "2026-10-28");
  // Read in UTC it falls on the 29th and outside the range: the old miss.
  assert.equal(buildClientTimeline("p1", "John", rows, "2026-10-28", "2026-10-28", 40, null).items.length, 0);
});

it("the caseload digest reads last active in the org zone when given one", () => {
  const input = {
    actorUserId: "00000000-0000-0000-0000-000000000001", seesAll: false, quietDays: 14,
    cohort: [{ userId: "00000000-0000-0000-0000-000000000007", name: "John Valjean", lastActiveAt: EVENING as unknown as string, joinedAt: "2026-10-20T15:00:00Z", hired: false, assignedStaffId: "00000000-0000-0000-0000-000000000001" }],
    tasks: [], outcomes: [], asks: [], lastNotes: [],
  };
  const now = Date.parse("2026-10-29T15:00:00Z");
  assert.equal(buildCaseloadDigest({ ...input, timeZone: "America/Chicago" }, now).people[0].lastActiveOn, "2026-10-28");
  assert.equal(buildCaseloadDigest(input, now).people[0].lastActiveOn, "2026-10-29");
});
