import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeExplicitDutyLine, normalizeResumeDutyWording } from "../explicit-duty-wording";
import { jobsIn } from "@crucible/core/src/jobResolver";

const page = (dates: string, body: string) => `MORGAN SAMPLE\nWORK EXPERIENCE\nProduction Manager | Example Workshop | ${dates}\n${body}\nEDUCATION\nDiploma | Example School | 2018`;

test("explicit management retains its entire object, scope and current tense", () => {
  const line = "  - Responsible for managing day-to-day production operations for 12 employees with a colleague.";
  assert.equal(normalizeExplicitDutyLine(line, "present"), "  - Manage day-to-day production operations for 12 employees with a colleague.");
  assert.equal(normalizeExplicitDutyLine(line, "past"), "  - Managed day-to-day production operations for 12 employees with a colleague.");
  assert.equal(normalizeExplicitDutyLine(line), line);
});

test("explicit source time wins over job time", () => {
  assert.equal(normalizeExplicitDutyLine("- Duties included operating a pallet jack.", "present"), "- Operated a pallet jack.");
  assert.equal(normalizeExplicitDutyLine("- Is responsible for maintaining equipment.", "past"), "- Maintain equipment.");
});

test("implicit duties, qualifications and coordinated actions are not invented or partly rewritten", () => {
  for (const line of [
    "- Responsible for 3rd shift.",
    "- Responsible for the crew's safety gear.",
    "- Responsible for helping manage inventory.",
    "- Responsible for managing operations and training employees.",
    "- Responsible for safely operating machinery.",
    "- Not responsible for managing employees.",
    "- Helped manage production operations.",
  ]) assert.equal(normalizeExplicitDutyLine(line, "past"), line);
});

test("existing job dates determine time without altering headers, dates, sections or object text", () => {
  const line = "- Responsible for managing day-to-day production operations";
  for (const [dates, verb] of [["March 2019 - Present", "Manage"], ["June 2015 - March 2019", "Managed"]]) {
    const before = page(dates, line);
    const result = normalizeResumeDutyWording(before);
    assert.equal(result.text, before.replace(line, `- ${verb} day-to-day production operations`));
    assert.deepEqual(jobsIn(result.text).map((job) => job.header), jobsIn(before).map((job) => job.header));
    assert.equal(result.repairs.length, 1);
  }
});

test("normalization never restores missing work, rewrites another section or guesses duplicate lines", () => {
  const line = "- Responsible for managing inventory.";
  const before = page("2019 - Present", line) + `\nPROJECTS\n${line}`;
  assert.equal(normalizeResumeDutyWording(before).text, before);
  const withoutWork = "MORGAN SAMPLE\nEDUCATION\nDiploma | Example School | 2018";
  assert.deepEqual(normalizeResumeDutyWording(withoutWork), { text: withoutWork, repairs: [] });
});
