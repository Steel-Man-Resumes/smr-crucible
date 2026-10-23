import { test } from "node:test";
import assert from "node:assert/strict";
import { selectedLaneDocument } from "../assistant-lane-document";
import type { PracticeEntry } from "@crucible/core/src/practiceRecordShared";
const entry = (id: string, title: string, names_facility = false): PracticeEntry => ({ id, user_id: "owner", section: "exhibition", title, venue: "Example Gallery", city: null, state: null, year: 2024, end_year: null, details: { kind: "solo" }, proof: "remembered", names_facility, created_at: "2026-10-01", updated_at: "2026-10-01" });
test("creative coach reads the visible lane document without revealing a held entry", () => {
 const result = selectedLaneDocument({ kind: "creative", kind_settings: { displayName: "Sample Artist", titleModes: { hidden: "leave_out" } } },
  [entry("visible", "Evening work"), { ...entry("hidden", "Northgate Correctional Program", true), venue: "Northgate Correctional Facility" }]);
 assert.match(result!.text, /Evening work/);
 assert.doesNotMatch(result!.text, /Northgate Correctional/);
 assert.equal(result!.source, "current_visible_lane_document");
 assert.match(result!.notice, /not a submitted snapshot/);
});
test("ordinary resume lanes do not project the shared practice record", () => {
 assert.equal(selectedLaneDocument({ kind: "resume" }, [entry("private", "Other work")]), null);
});
test("CV and performer kinds use their own output model", () => {
 for (const kind of ["cv", "performer"] as const) {
  const result = selectedLaneDocument({ kind, cv_type: "clinical", kind_settings: { displayName: "Sample Person" } }, []);
  assert.equal(result!.kind, kind); assert.match(result!.text, /Sample Person/);
 }
});
