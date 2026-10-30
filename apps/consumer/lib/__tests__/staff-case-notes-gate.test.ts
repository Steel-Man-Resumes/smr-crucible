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
it("review G6-1, G6-2, G6-3: no freeze on pasted forms, ordinary numbers untouched, notes with an id withheld", () => {
  for (const [lab, unit] of [["case", ". "], ["CASE NO.", " "], ["Case Number:", "\t"], ["case", " "], ["docket", "."]] as const) {
    const t = lab + unit.repeat(10_000) + "____";
    const start = performance.now();
    withholdRecordSentences(t);
    assert.ok(performance.now() - start < 250, `${lab} ${JSON.stringify(unit)} took ${(performance.now() - start).toFixed(1)} ms`);
  }
  for (const t of ["In case 100 people come, we need 100 chairs and $1000 in snacks.", "Just in case. The 2026 grant report is due.", "In any case, 120 employers answered.", "a case of 100 gloves", "Booking 200 seats for the fair.", "Booking the 3pm slot", "In case her 10am interview runs long, call me."]) {
    const r = withholdRecordSentences(t);
    assert.equal(r.withheld, false, t);
    assert.equal(r.text, t);
  }
  for (const t of ["Her case notes: CR-99812", "Add to her case notes: 24-CF-1182 dismissed."]) assert.equal(withholdRecordSentences(t).withheld, true, t);
});
it("review G7-1 to G7-3: notes with any record-shaped id, linear in lines, untouched lines verbatim", () => {
  for (const t of ["His case notes is B-445566", "In CASE notes  CR-99812 is closed.", "Just in CASE notes: 2024CF001182.", "Case notes: 1:24-cr-00123", "case notes: 24‐CF‐1182"]) {
    assert.equal(withholdRecordSentences(t).withheld, true, t);
  }
  for (const t of ["Save that to her case notes.", "case notes from 10/27", "case notes from 2026-10-27", "Case ID field is blank. Her phone is 555-0142.", "Monday.  She called.\tThen left."]) {
    const r = withholdRecordSentences(t);
    assert.equal(r.withheld, false, t);
    assert.equal(r.text, t, "a line with nothing withheld comes back exactly as typed");
  }
  for (const t of ["x\n".repeat(50_000), "case no.\n".repeat(50_000), "court. 24-CF-1182\n".repeat(50_000)]) {
    const start = performance.now();
    withholdRecordSentences(t);
    assert.ok(performance.now() - start < 1000, `${JSON.stringify(t.slice(0, 20))} x50000 took ${(performance.now() - start).toFixed(0)} ms`);
  }
});
it("review G8-1: short, spaced and phone-shaped ids inside a case notes sentence", () => {
  for (const t of ["Her case notes: A1234", "case notes say 24 CF 1182 is closed", "case notes: 123-4567"]) assert.equal(withholdRecordSentences(t).withheld, true, t);
  for (const t of ["Save that to her case notes.", "case notes from 10/27", "case notes from 2026-10-27", "Her case notes - see below. Meeting moved to 2026-11-03."]) assert.equal(withholdRecordSentences(t).withheld, false, t);
});
