/**
 * Walkthrough W03 (2026-10-27): the People page line about people who joined
 * but have not turned on sharing. It said "joined with the code" for people
 * who joined by invitation, and "1 more person has joined ... but have not".
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { joinedNotSharingLine } from "../org-joined-not-sharing";

const ROOT = join(__dirname, "..", "..");

test("W03: one person reads in the singular all the way through", () => {
  assert.equal(
    joinedNotSharingLine(1, "program", { more: true }),
    "1 more person has joined your program but has not turned on sharing yet. They control that from their own Settings.",
  );
  assert.equal(
    joinedNotSharingLine(1),
    "1 person has joined your program but has not turned on sharing yet. They control that from their own Settings.",
  );
});

test("W03: more than one reads in the plural all the way through", () => {
  assert.equal(
    joinedNotSharingLine(3, "program", { more: true }),
    "3 more people have joined your program but have not turned on sharing yet. They control that from their own Settings.",
  );
});

test("W03: zero says nothing, and the organization's own word is used", () => {
  assert.equal(joinedNotSharingLine(0), "");
  assert.equal(joinedNotSharingLine(-2), "");
  assert.match(joinedNotSharingLine(2, "reentry program"), /joined your reentry program but have not/);
  assert.match(joinedNotSharingLine(2, "  "), /joined your program/);
});

test("W03: the line never says how they joined, and is no em dash or double hyphen", () => {
  for (const n of [1, 2]) for (const more of [true, false]) {
    const s = joinedNotSharingLine(n, "program", { more });
    assert.doesNotMatch(s, /code|invit/i);
    assert.doesNotMatch(s, /—|--/);
  }
});

test("W03: the People page uses the helper and no longer says 'joined with the code'", () => {
  const src = readFileSync(join(ROOT, "components/org/OrgDashboard.tsx"), "utf8");
  assert.doesNotMatch(src, /joined with the\s+code/);
  assert.equal((src.match(/joinedNotSharingLine\(/g) ?? []).length, 3, "all three places use the one line");
});
