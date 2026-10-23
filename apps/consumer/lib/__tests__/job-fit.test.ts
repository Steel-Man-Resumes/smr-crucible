import { test } from "node:test";
import assert from "node:assert/strict";
import { jobFitExclusion, readJobFit } from "../job-fit";
test("explicit no choices filter real requirements, not assumptions about a record", () => {
  const p = readJobFit({ noDriving: true, noHeavyLifting: true, noOvernight: true, excludedTitles: ["Sales"] });
  assert.ok(jobFitExclusion({ title: "Sales Associate" }, p));
  assert.equal(jobFitExclusion({ title: "Wholesale Associate" }, p), null);
  assert.ok(jobFitExclusion({ title: "Stocker", requirements: ["Must lift 50 pounds"] }, p));
  assert.ok(jobFitExclusion({ title: "Delivery", requirements: ["CDL required"] }, p));
  assert.equal(jobFitExclusion({ title: "Delivery", requirements: ["CDL not required"] }, p), null);
  assert.ok(jobFitExclusion({ title: "Stocker", requirements: ["Must work overnight"] }, p));
  assert.equal(jobFitExclusion({ title: "Stocker", description: "Background check required" }, p), null);
  assert.equal(jobFitExclusion({ title: "Stocker", requirements: ["Night shift preferred"] }, p), null);
});
