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
