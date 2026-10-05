import { test } from "node:test";
import assert from "node:assert/strict";
import { withholdRecordLines } from "../record-lines";

const SRC = `Line Cook | Harbor Grill | 2021 - 2023
Cooked for 200 covers a night.
Kitchen Worker | State Correctional Institution | 2017 - 2020
Forklift operator after release, 2020 - 2021`;

test("default holds record lines back and reports every one", () => {
  const r = withholdRecordLines(SRC, false);
  assert.ok(!/Correctional/.test(r.kept));
  assert.ok(r.kept.includes("Harbor Grill"));
  assert.equal(r.withheld.length, 1);
  assert.match(r.withheld[0], /State Correctional Institution/);
});

test("keep returns the person's text unchanged and withholds nothing", () => {
  const r = withholdRecordLines(SRC, true);
  assert.ok(r.kept.includes("State Correctional Institution"));
  assert.deepEqual(r.withheld, []);
});

test("nothing withheld when nothing matches", () => {
  const r = withholdRecordLines("Cashier | Corner Market | 2019 - 2022", false);
  assert.deepEqual(r.withheld, []);
});
