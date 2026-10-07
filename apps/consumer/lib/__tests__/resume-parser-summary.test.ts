import { test } from "node:test";
import assert from "node:assert/strict";
import { profileToResume } from "../../components/resume/resumeParsers";

const base = {
  full_name: "Alex Rivera",
  email: "a@example.com",
  phone: "555-010-0000",
  work_history: [{ company: "Harbor Supply", title: "Forklift Operator", start_date: "2019", end_date: "2021", bullets: ["Moved 300 pallets a shift."] }],
};

const SRC = "Alex Rivera\nSUMMARY\nDependable warehouse worker   with six years\nof experience.\nLine Cook | Harbor Grill";

test("a parsed summary is carried into the document", () => {
  const doc = profileToResume({ ...base, summary: "  Dependable warehouse worker with six years of experience.  " }, SRC);
  assert.equal(doc.summary, "Dependable warehouse worker with six years of experience.");
});

test("no summary in the parse leaves the summary empty (nothing invented)", () => {
  assert.equal(profileToResume({ ...base }).summary, "");
  assert.equal(profileToResume({ ...base, summary: null }).summary, "");
  assert.equal(profileToResume({ ...base, summary: 42 }).summary, "");
});

test("a justice-sensitive summary is dropped whole", () => {
  const doc = profileToResume({ ...base, summary: "Hard worker since release in March." });
  assert.equal(doc.summary, "");
});

test("a bare section header is not taken as a summary", () => {
  assert.equal(profileToResume({ ...base, summary: "Summary" }).summary, "");
});

test("a summary that is not in the uploaded text is dropped (whitespace and case ignored)", () => {
  assert.equal(profileToResume({ ...base, summary: "Award-winning leader of large teams." }, SRC).summary, "");
  assert.equal(
    profileToResume({ ...base, summary: "DEPENDABLE warehouse worker with six years of experience." }, SRC).summary,
    "DEPENDABLE warehouse worker with six years of experience."
  );
});
