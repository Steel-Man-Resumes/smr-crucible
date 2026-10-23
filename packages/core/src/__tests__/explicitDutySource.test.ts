import { test } from "node:test";
import assert from "node:assert/strict";
import { markGoalText, scopeHitsNotTheirs } from "../scopeWords";
import { numbersInContext } from "../resumeStatus";

const output = "Manage day-to-day production operations.";

test("an explicit responsibility gerund supports the same management action and object", () => {
  for (const source of [
    "Responsible for managing day-to-day production operations.",
    "Duties included managing day-to-day production operations.",
    "Responsibilities include managing day-to-day production operations.",
    "I was responsible for managing day-to-day production operations.",
  ]) assert.deepEqual(scopeHitsNotTheirs(output, source), [], source);
});

test("duty frames do not grant a new object, quantity or people scope", () => {
  const source = "Responsible for managing day-to-day production operations.";
  assert.ok(scopeHitsNotTheirs("Manage inventory.", source).length);
  assert.ok(scopeHitsNotTheirs("Supervised production employees.", source).length);
  assert.ok(scopeHitsNotTheirs("Managed all production employees.", source).length);
  assert.equal(numbersInContext("Managed a crew of 12.", "Responsible for managing a crew of 4."), false);
});

test("denial, plans, assistance and other subjects cannot supply the applicant's own action", () => {
  for (const source of [
    "Not responsible for managing day-to-day production operations.",
    "Responsible for managing no day-to-day production operations.",
    "I was not responsible for managing day-to-day production operations.",
    "I wanted to be responsible for managing day-to-day production operations.",
    "I intended to be responsible for managing day-to-day production operations.",
    "Responsible for managing day-to-day production operations starting Monday.",
    "Responsible for managing day-to-day production operations. Starting Monday.",
    "Assisted with managing day-to-day production operations.",
    "Responsible for assisting with managing day-to-day production operations.",
    "My manager was responsible for managing day-to-day production operations.",
    "They were responsible for managing day-to-day production operations.",
    "Someone responsible for managing day-to-day production operations.",
    "Responsible for managing day-to-day production operations with my lead.",
    markGoalText("Responsible for managing day-to-day production operations."),
  ]) assert.ok(scopeHitsNotTheirs(output, source).length, source);
  assert.ok(scopeHitsNotTheirs("Supervised employees.", "Responsible for managing no employees.").length);
});
