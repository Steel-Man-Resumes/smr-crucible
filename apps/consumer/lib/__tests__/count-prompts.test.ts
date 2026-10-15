/**
 * D2 (2026-10-07): the bullet helper shows what to count, the person gives the
 * number. No figure or range is ever offered.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { countPromptsFor, quantityFromCounts } from "../count-prompts";
import * as numberTruth from "../number-truth";

test("D2: prompts name what to count for the line's work, with no digit or range", () => {
  const trucks = countPromptsFor("Loaded trucks at the dock", "Warehouse associate");
  assert.ok(trucks.includes("trucks loaded on a normal day"), JSON.stringify(trucks));
  assert.ok(countPromptsFor("Worked on a team of cooks").includes("people you worked alongside on your crew"));
  assert.ok(!countPromptsFor("Worked on a team of cooks").includes("new people you trained"), "training is offered only when the line says it");
  assert.ok(countPromptsFor("Trained new hires on the line").includes("new people you trained"));
  for (const line of ["Supervised a team", "Worked on a crew"]) assert.ok(!countPromptsFor(line).includes("people on your crew"));
  for (const line of ["Loaded trucks", "Ran the grill", "Helped residents with meals", "Welded steel", "Answered calls", "", "Did things"]) {
    const ps = countPromptsFor(line, "");
    assert.ok(ps.length >= 1);
    for (const p of ps) {
      assert.doesNotMatch(p, /\d/, p);
      assert.doesNotMatch(p, /\b(?:to|under|over|more than|about|between)\b\s*$/i, p);
      assert.doesNotMatch(p, /\b(?:one|two|three|four|five|six|seven|eight|nine|ten|dozen|hundred|thousand)\b/i, p);
    }
  }
});

test("D2: the figure the person types counts as their words", () => {
  const q = quantityFromCounts({ "trucks loaded on a normal day": " about 40 ", "pallets moved in a shift": "" });
  assert.equal(q, "about 40 trucks loaded on a normal day");
  assert.deepEqual(numberTruth.unsupportedNumbers("Loaded about 40 trucks a day.", "", q), []);
  assert.deepEqual(numberTruth.unsupportedNumbers("Loaded about 60 trucks a day.", "", q), ["60"]);
});

test("D2: no range or figure buttons remain in the bullet helper", () => {
  assert.equal((numberTruth as Record<string, unknown>).RANGE_CHOICES, undefined);
  const src = readFileSync(join(__dirname, "..", "..", "components", "resume", "BulletWorkshop.tsx"), "utf8");
  assert.doesNotMatch(src, /RANGE_CHOICES|QUANTITY_UNITS|setQuantitySource\("picked"\)/);
  assert.match(src, /countPromptsFor/);
});
