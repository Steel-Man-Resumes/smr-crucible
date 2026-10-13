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

test("a held-back entry takes its duty lines with it (blank-line layout)", () => {
  const src = `Line Cook | Harbor Grill | 2021 - 2023
Cooked for 200 covers a night.

Kitchen Worker | State Correctional Institution | 2017 - 2020
Prepped meals for 900 people a day. Trained 6 new kitchen workers.

Dishwasher | Corner Diner | 2015 - 2017
Kept the dish line running.`;
  const r = withholdRecordLines(src, false);
  assert.ok(!r.kept.includes("900"), "duty lines must not stay loose");
  assert.ok(!r.kept.includes("Trained 6"));
  assert.ok(r.kept.includes("Harbor Grill") && r.kept.includes("Corner Diner"));
  assert.match(r.withheld[0], /State Correctional Institution .*1 line under it/);
});

test("a held-back entry takes its duty lines with it (no blank lines)", () => {
  const src = `Line Cook | Harbor Grill | 2021 - 2023
- Cooked for 200 covers a night.
Kitchen Worker | County Jail | 2017 - 2020
- Prepped meals for 900 people a day.
- Trained 6 new kitchen workers.
Dishwasher | Corner Diner | 2015 - 2017
- Kept the dish line running.`;
  const r = withholdRecordLines(src, false);
  assert.ok(!r.kept.includes("900"));
  assert.ok(r.kept.includes("Cooked for 200") && r.kept.includes("Kept the dish line"));
  assert.match(r.withheld[0], /County Jail .*2 lines under it/);
});

test("a record phrase inside another entry removes only that line", () => {
  const src = `Forklift Operator | Northgate Freight | 2020 - 2022
- Moved 40 pallets a shift.
- Hired through a reentry program.`;
  const r = withholdRecordLines(src, false);
  assert.ok(r.kept.includes("Northgate Freight") && r.kept.includes("40 pallets"));
  assert.equal(r.withheld.length, 1);
});
