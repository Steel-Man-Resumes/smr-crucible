/**
 * Finish gate round 17 (review-phase2-L4-r17-recheck F1, F2). Fictional people only.
 * F1: a references section or a "Supervisor:" block names someone else's job, never the person's own.
 * F2: a job line with a future or offer frame ("Shift Lead - Kroger - starting 2024") is not a job they held.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { getResumeStatus } from "../resumeStatus";

const C = "Sam Ortiz\n419-555-0177 | sam.ortiz@example.com | Toledo, OH\n\nWORK HISTORY\n";
const PAGE = (...headers: string[]) => `SAM ORTIZ\nToledo, OH | sam.ortiz@example.com\n\nPROFESSIONAL EXPERIENCE\n${headers.map((h) => `${h}\n- Ran the register`).join("\n")}`;
const titled = (header: string, src: string) =>
  getResumeStatus({ resumeText: PAGE(header), sourceText: src }).openItems.some((i) => i.kind === "title_unsaid");

const EARLY = "SHIFT LEAD | Kroger | Toledo, OH | 2016 - 2019";
const CASHIER_UP = C + "Cashier | Kroger | 2016 - 2019\nran the register\n";

test("R17 F1: a reference written like a job header never settles their header", () => {
  for (const ref of [
    "Mike Jones\nShift Lead\nKroger, Toledo, OH\n2016 - 2019",
    "Mike Jones - Shift Lead - Kroger - 2016 - 2019",
    "Shift Lead - Kroger - Mike Jones - 2016 - 2019",
    "Shift Lead | Kroger | Mike Jones | 2016 - 2019",
    "Mike Jones\tShift Lead\tKroger\t2016 - 2019",
    "Shift Lead at Kroger\n2016 - 2019",
  ]) {
    assert.ok(titled(EARLY, `${CASHIER_UP}\nREFERENCES\n${ref}`), `reference: ${JSON.stringify(ref)}`);
  }
});

test("R17 F1: a 'My supervisor:' block inside the work history is someone else's job", () => {
  const up = `${CASHIER_UP}My supervisor:\nShift Lead\nKroger, Toledo, OH\n2016 - 2019`;
  assert.ok(titled(EARLY, up));
});

test("R17 F1 controls: their own jobs still clear, and a work heading after references reads again", () => {
  const own = C + "Shift Lead | Kroger | 2016 - 2019\nopened the store";
  assert.ok(!titled(EARLY, own), "their own header");
  assert.ok(!titled(EARLY, `REFERENCES\nAvailable on request\n\nWORK EXPERIENCE\n${own.slice(C.length)}`), "work heading after references");
  assert.ok(!titled(EARLY, `${own}\n\nSupervisor: Mike Jones\n\nShift Lead at Kroger\n2016 - 2019`), "a blank line ends the supervisor block");
});

test("R17 F2: a future or offer frame on a job line is not a job they held", () => {
  const PAGE24 = "SHIFT LEAD | Kroger | Toledo, OH | 2024";
  for (const l of [
    "Shift Lead - Kroger - starting 2024",
    "Shift Lead | Kroger | starts 2024",
    "Shift Lead | Kroger | 2024 (offered)",
    "Shift Lead\tKroger\tupcoming 2024",
    "Shift Lead, Kroger, start date 2024",
  ]) {
    assert.ok(titled(PAGE24, `${CASHIER_UP}${l}`), `framed: ${l}`);
  }
  assert.ok(!titled(PAGE24, C + "Shift Lead - Kroger - 2024"), "control: an honest dated line clears");
});
