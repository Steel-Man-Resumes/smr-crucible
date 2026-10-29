/**
 * Walkthrough W12 (2026-10-27): the staff read-only view of a shared base
 * resume showed the current job as "2021" while the participant's printable
 * said "2021 - Present". Both now use one formatter, workEntryDates.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
(globalThis as { React?: typeof React }).React = React;
import { createEmptyResume, formatResumeDownload, workEntryDates } from "../../components/resume/resumeModel";

test("W12: an empty end date is the current job", () => {
  assert.equal(workEntryDates({ startDate: "2021", endDate: "" }), "2021 - Present");
  assert.equal(workEntryDates({ startDate: "2012", endDate: "2016" }), "2012 - 2016");
  assert.equal(workEntryDates({ startDate: "2021", endDate: null }), "2021 - Present");
});

test("W12: the participant's download still reads the same", () => {
  const doc = createEmptyResume();
  doc.experience = [
    { id: "a", title: "Forklift Operator", company: "Steadfast Staffing", startDate: "2021", endDate: "", bullets: ["Operate forklift."] },
    { id: "b", title: "Shift lead", company: "Northgate Parts Distribution", startDate: "2012", endDate: "2016", bullets: [] },
  ];
  const out = formatResumeDownload(doc);
  assert.match(out, /Forklift Operator \| Steadfast Staffing, 2021 - Present/);
  assert.match(out, /Shift lead \| Northgate Parts Distribution, 2012 - 2016/);
});

test("W12: the staff view of a shared resume shows the current job the way the printable does", async () => {
  const { SharedTab } = await import("../../components/org/ClientPage");
  const content = {
    contact: { name: "Marqus Relly" }, summary: "Warehouse worker.",
    experience: [
      { id: "a", title: "Forklift Operator", company: "Steadfast Staffing", startDate: "2021", endDate: "", bullets: ["Operate forklift."] },
      { id: "b", title: "Shift lead", company: "Northgate Parts Distribution", startDate: "2012", endDate: "2016", bullets: [] },
      { id: "c", title: "Volunteer", company: "Food pantry", startDate: "", endDate: "", bullets: [] },
    ],
  };
  const open = { shared: true, sharedAt: "2026-10-27T12:00:00Z", requestPending: false, required: false, stoppedByParticipant: false, fromDate: null };
  const closed = { ...open, shared: false, sharedAt: null };
  const html = renderToStaticMarkup(React.createElement(SharedTab, {
    client: { name: "Marqus Relly", email: null, currentStage: 1, scopes: { applications: closed, resume: open, documents: closed }, progress: null } as never,
    clientId: "c1", first: "Marqus", item: "resume", loading: false,
    rows: [{ id: "r1", content, updated_at: "2026-10-27T12:00:00Z", is_current: true }],
    viewer: { canRequest: false, canSuggest: false }, suggestions: [], onPick: () => {}, onChange: () => {},
  }));
  assert.match(html, />2021 - Present</);
  assert.match(html, />2012 - 2016</);
  assert.doesNotMatch(html, />2021</, "never the bare start year");
  assert.equal((html.match(/Present/g) ?? []).length, 1, "an undated entry does not claim to be current");
});
