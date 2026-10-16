import { test } from "node:test";
import assert from "node:assert/strict";
import { applyRecordChoice, recordChoiceFrom, recordChoiceWords, stateSubstituteIn, keepSourceRecordLines, recordEntryLabel } from "../record-choice";

// The shape Troy's live run produced on 2026-10-15: the facility named as the employer twice.
const WRITTEN = [
  "JEAN VALJEAN",
  "Production Manager",
  "Milwaukee, WI | (414) 555-2460 | jean@example.test",
  "",
  "CAREER SUMMARY",
  "Production and heavy-labor worker with over 25 years in production, rigging, and heavy labor.",
  "",
  "PROFESSIONAL EXPERIENCE",
  "PRODUCTION MANAGER | Madeleine Glassworks | Milwaukee, WI | March 2019 - Present",
  "Manage day-to-day production operations.",
  "Handle hiring, training, and scheduling of employees.",
  "CREW LEADER | Toulon Correctional Facility | Toulon, IL | 2005 - 2015",
  "Assigned tasks and confirmed work was completed safely.",
  "Inspected ropes, chains, and lifting equipment before use.",
  "LABORER, MARINE YARD CREW | Toulon Correctional Facility | Toulon, IL | 1996 - 2005",
  "Performed heavy labor including lifting, hauling, and rope work.",
  "Followed all safety and security procedures at the prison.",
  "",
  "EDUCATION",
  "High School Equivalency Diploma (GED) | 2003",
].join("\n");

const SOURCE = "Jean Valjean\nToulon Correctional Facility, Toulon, IL\n1996 - 2005 Laborer, marine yard crew. Heavy lifting, hauling and rope work.\n2005 - 2015 Crew leader. Assigned tasks, inspected ropes and chains.\nDigne Lumber & Stone, Milwaukee WI, 2015 - 2019 production worker.";

const LETTER = "I ran a crew at Toulon Correctional Facility for ten years. I inspected rigging before every lift. At Madeleine Glassworks I manage production today.";

test("off: the inside entries come off the page, header and duties, and nothing names the facility afterwards", () => {
  const r = applyRecordChoice(WRITTEN, LETTER, "off", SOURCE);
  assert.ok(!/Toulon|prison|Correctional/i.test(r.resume), r.resume);
  assert.ok(r.resume.includes("PRODUCTION MANAGER | Madeleine Glassworks"));
  assert.ok(r.resume.includes("EDUCATION\nHigh School Equivalency Diploma (GED) | 2003"));
  assert.ok(!r.resume.includes("Assigned tasks"), "duty lines go with their header");
  assert.equal(r.entries.length, 2);
  assert.equal(r.entries[0].lines, 2);
  assert.match(recordEntryLabel(r.entries[0], "off"), /CREW LEADER .* 2 lines under it/);
  assert.ok(!/Toulon|Correctional/.test(r.letter));
  assert.ok(r.letter.includes("I inspected rigging before every lift."));
  assert.ok(r.letter.includes("Madeleine Glassworks"));
});

test("state: the work stays with the state as the employer; the facility is named nowhere", () => {
  const r = applyRecordChoice(WRITTEN, LETTER, "state", SOURCE);
  assert.ok(r.resume.includes("CREW LEADER | State of Illinois | Toulon, IL | 2005 - 2015"), r.resume);
  assert.ok(r.resume.includes("LABORER, MARINE YARD CREW | State of Illinois | Toulon, IL | 1996 - 2005"));
  assert.ok(r.resume.includes("Assigned tasks and confirmed work was completed safely."), "duties stay");
  assert.ok(!/Toulon Correctional|prison/i.test(r.resume), "a duty sentence naming the prison goes");
  assert.ok(r.resume.includes("Performed heavy labor including lifting, hauling, and rope work."));
  assert.deepEqual(r.swaps.map((s) => s.to), ["State of Illinois", "State of Illinois"]);
  assert.equal(r.entries[0].substitute, "State of Illinois");
  assert.ok(r.letter.includes("I ran a crew at State of Illinois for ten years."));
  assert.equal(recordChoiceWords(SOURCE, "state"), "State of Illinois");
  assert.equal(recordChoiceWords(SOURCE, "off"), "");
});

test("facility: the page is untouched and the entries are still listed for the card", () => {
  const r = applyRecordChoice(WRITTEN, LETTER, "facility", SOURCE);
  assert.equal(r.resume, WRITTEN);
  assert.equal(r.letter, LETTER);
  assert.equal(r.entries.length, 2);
  assert.deepEqual(r.swaps, []);
});

test("no inside work: nothing changes", () => {
  const plain = WRITTEN.split("\n").filter((l) => !/Toulon|prison/i.test(l)).join("\n");
  const r = applyRecordChoice(plain, LETTER.replace(/I ran a crew at Toulon Correctional Facility for ten years\. /, ""), "off", "");
  assert.equal(r.resume, plain);
  assert.equal(r.entries.length, 0);
});

test("state names and the generic fallback", () => {
  assert.equal(stateSubstituteIn("Waupun Correctional Institution | Waupun, WI | 2010 - 2012"), "State of Wisconsin");
  assert.equal(stateSubstituteIn("Kitchen worker, Cook County Jail, Chicago Illinois"), "State of Illinois");
  assert.equal(stateSubstituteIn("Federal prison camp, no place given"), null);
  const r = applyRecordChoice("NAME\nWORK EXPERIENCE\nCOOK | Federal Prison Camp | 2011 - 2013\nCooked for 300.", "", "state", "Federal Prison Camp 2011-2013 cook");
  assert.ok(r.resume.includes("COOK | State work program | 2011 - 2013"), r.resume);
});

test("old runs: keepInsideLines true was the facility choice; anything else is off", () => {
  assert.equal(recordChoiceFrom(undefined, true), "facility");
  assert.equal(recordChoiceFrom(undefined, false), "off");
  assert.equal(recordChoiceFrom("state", false), "state");
  assert.equal(recordChoiceFrom("nonsense", true), "facility");
  assert.equal(keepSourceRecordLines("off"), false);
  assert.equal(keepSourceRecordLines("state"), true);
  assert.equal(keepSourceRecordLines("facility"), true);
});
