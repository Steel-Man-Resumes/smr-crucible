import { it } from "node:test";
import assert from "node:assert/strict";
import { withholdRecordSentences } from "../staff-ai-safety";

// 2026-10-30 (harness TRAP-ACT-04): "case notes" is the workspace's own term.
it("case notes are not a case number", () => {
  for (const t of ["Save that to her case notes.", "Add that to his case notes", "Open Case notes for Marqus", "case notes from Oct 27"]) {
    assert.equal(withholdRecordSentences(t).withheld, false, t);
  }
});
it("real case and docket numbers are still withheld", () => {
  for (const t of ["His case no. 24-CF-1182 is closed.", "Case #A1234 came up.", "docket number 2026-445", "case number: CR-99812", "Case No: 77812"]) {
    assert.equal(withholdRecordSentences(t).withheld, true, t);
  }
});
it("review R4-1 and R4-2: capitals, abbreviations, line breaks and jammed labels are withheld", () => {
  for (const t of ["CASE NO. 2024CF001182", "Her CASE NO. 24-CF-1182 is open.", "Case Num. 24-CF-1182 is open.", "case num. 1182", "BOOKING NO. B-445566", "case no.\n24-CF-1182", "case no24-CF-1182", "case num1182", "Case Number1182"]) {
    assert.equal(withholdRecordSentences(t).withheld, true, JSON.stringify(t));
  }
  const docket = withholdRecordSentences("DOCKET NO. 2026-445");
  assert.ok(!docket.text.includes("2026-445"), docket.text);
  assert.equal(withholdRecordSentences("Did he call? No. He did not.").withheld, false);
});
it("review R5-1 and R5-2: case numbers after 'number', or split from their label, never reach the model", () => {
  for (const t of ["Her case number is 24-CF-1182.", "Her booking number is B-44556.", "The case number: is 24-CF-1182", "case number = 24-CF-1182", "case number - 24-CF-1182", "case number (24-CF-1182)", "case number \"24-CF-1182\"", "Case number? 24-CF-1182", "She has court Monday. Her case number. 24-CF-1182", "Her docket number is below. 2026-445.", "She has court Monday.\ncase no.\n24-CF-1182"]) {
    const r = withholdRecordSentences(t);
    assert.ok(r.withheld && !/24-CF-1182|B-44556|2026-445/.test(r.text), JSON.stringify([t, r.text]));
  }
  for (const t of ["Save that to her case notes.", "In case 2 people come, call me.", "Just in case, bring 3 copies of the resume."]) assert.equal(withholdRecordSentences(t).withheld, false, t);
});
