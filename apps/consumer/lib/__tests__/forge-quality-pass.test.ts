import { test } from "node:test";
import assert from "node:assert/strict";
import { acceptForgeQualityRevision, forgeQualityIssues } from "../forge-quality-pass";

const source = `MORGAN SAMPLE
WORK EXPERIENCE
Warehouse Associate | Midstate Distribution | 8/2021 - Present
Responsible for loading trucks and moving 40 pallets a night with a pallet jack.`;
const header = `MORGAN SAMPLE

CAREER SUMMARY
Warehouse work loading trucks and using a pallet jack.

PROFESSIONAL EXPERIENCE
Warehouse Associate | Midstate Distribution | 8/2021 - Present
`;
const weak = header + "- Responsible for loading trucks and moving 40 pallets a night with a pallet jack.";
const strong = header + "- Loaded trucks and moved 40 pallets a night with a pallet jack.";

test("a better grounded bullet can replace weak wording without another user task", () => {
  assert.ok(forgeQualityIssues(weak).length > forgeQualityIssues(strong).length);
  assert.equal(acceptForgeQualityRevision(weak, strong, source), true);
});

test("the writing pass cannot change job facts, numbers, credentials or drop work", () => {
  const candidates = [
    strong.replace("MORGAN SAMPLE", "MORGAN SMITH"),
    strong.replace("8/2021", "3/2021"),
    strong.replace("40 pallets", "80 pallets"),
    strong.replace("- Loaded trucks and moved 40 pallets a night with a pallet jack.", ""),
    strong.replace("- Loaded", "- Forklift certified.\n- Loaded"),
  ];
  for (const candidate of candidates) assert.equal(acceptForgeQualityRevision(weak, candidate, source), false, candidate);
});

test("the writing pass keeps the person's contact line", () => {
  const before = weak.replace("MORGAN SAMPLE", "MORGAN SAMPLE\nmorgan@example.com");
  const after = strong.replace("MORGAN SAMPLE", "MORGAN SAMPLE\nother@example.com");
  assert.equal(acceptForgeQualityRevision(before, after, source), false);
});

test("a missing career summary is included in the writing repair request", () => {
  const bare = "MORGAN SAMPLE\nPROFESSIONAL EXPERIENCE\nWarehouse Associate | Midstate Distribution | 8/2021 - Present\n- Loaded trucks and moved 40 pallets a night with a pallet jack.";
  assert.ok(forgeQualityIssues(bare).some((finding) => /summary/i.test(finding.why)));
});
