import { test } from "node:test";
import assert from "node:assert/strict";
import { createEmptyResume, scoreResume } from "../../components/resume/resumeModel";

function fullDoc() {
  const doc = createEmptyResume("forge");
  doc.contact = { name: "Alex Rivera", phone: "555-010-0000", email: "a@example.com", city: "", state: "" };
  doc.summary =
    "Dependable warehouse worker with six years of forklift and inventory experience who shows up on time and trains new hires.";
  doc.experience = [
    { id: "1", title: "Forklift Operator", company: "Harbor Supply", startDate: "2019", endDate: "2021", bullets: ["Moved 300 pallets a shift.", "Trained four new hires."] },
    { id: "2", title: "Stock Clerk", company: "Corner Market", startDate: "2017", endDate: "2019", bullets: ["Restocked shelves daily."] },
  ];
  doc.skills = ["Forklift", "Inventory", "Scanning", "Safety", "Training", "Teamwork", "Packing", "Loading"];
  return doc;
}

test("no education line no longer caps the score: everything else filled = 100", () => {
  const doc = fullDoc();
  assert.equal(doc.education.filter((e) => e.credential.trim()).length, 0);
  assert.equal(scoreResume(doc).overall, 100);
});

test("adding an education line still scores 100", () => {
  const doc = fullDoc();
  doc.education = [{ id: "e", institution: "", credential: "GED", year: "" }];
  assert.equal(scoreResume(doc).overall, 100);
});

test("an empty document still scores 0", () => {
  assert.equal(scoreResume(createEmptyResume("forge")).overall, 0);
});

test("a missing summary still costs points, with or without education", () => {
  const doc = fullDoc();
  doc.summary = "";
  const without = scoreResume(doc).overall;
  doc.education = [{ id: "e", institution: "", credential: "GED", year: "" }];
  const withEd = scoreResume(doc).overall;
  assert.ok(without < 100 && withEd < 100);
  assert.equal(without, 78); // 70 of the 90 weight that applies
  assert.equal(withEd, 80); // 15+35+10+20 of 100
});

test("empty education keeps an optional tip and does not mark the score down", () => {
  const edu = scoreResume(fullDoc()).sections.find((s) => s.section === "education");
  assert.equal(edu?.status, "empty");
  assert.match(edu?.tip ?? "", /^Optional/);
});
