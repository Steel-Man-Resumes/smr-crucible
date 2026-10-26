/**
 * Insights by station, the funder CSV with one definition (B8 note N12), and
 * the print report rendered with react-dom/server (CRM lane C2, 2026-10-25).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
// Components compile with the classic JSX transform under tsx; give them React the way Next does.
(globalThis as { React?: typeof React }).React = React;
import { LEGACY_STAGE_SECTION, PERIOD_LABEL, insightsCsv, insightsCsvRows, stationRows } from "../org-insights-report";
import { STATION_IDS } from "../refinery-nav";

const ROOT = join(__dirname, "..", "..");

import { I } from "./fixtures/org-insights-fixture";

/**
 * The CSV exactly as 964090c built it for this fixture: produced once by
 * running the 964090c toCsv (git show 964090c:apps/consumer/app/api/org/insights/route.ts,
 * lines 13-61, verbatim) on fixtures/org-insights-fixture.ts. A snapshot, not a hand copy.
 */
function parseCsv(text: string): string[][] {
  return text.split("\r\n").map((line) => line.slice(1, -1).split('","').map((c) => c.replace(/""/g, '"')));
}
const OLD_CSV = readFileSync(join(__dirname, "fixtures", "insights-csv-964090c.csv"), "utf8");

test("stations: every person sharing progress counted once, at the station stationForJourneyStage names", () => {
  const rows = stationRows(I.stages);
  assert.deepEqual(rows.map((r) => r.id), [...STATION_IDS]);
  assert.equal(rows.reduce((n, r) => n + r.count, 0), I.stages.reduce((n, s) => n + s.count, 0));
  const by = Object.fromEntries(rows.map((r) => [r.id, r.count]));
  assert.deepEqual(by, { overview: 1, find: 1, tailor: 4, plan: 0, practice: 1, apply: 2, next: 0 });
  assert.deepEqual(rows.find((r) => r.id === "tailor")!.stages, [1, 3]);
});

test("CSV N12: the ended-before figure is a note on 'No longer there', never its own value row", () => {
  const rows = insightsCsvRows("Test Org (Demo)", I);
  assert.ok(!rows.some((r) => /ended before/i.test(r[1])), "no measure row for it");
  const r30 = rows.find((r) => r[0] === "Retention, 30 days" && r[1] === "No longer there")!;
  assert.equal(r30[2], 1);
  assert.match(r30[4], /^Of those, 1 ended before this check-in \(from the end date\)\. Part of this number, not added to it\.$/);
  const r90 = rows.find((r) => r[0] === "Retention, 90 days" && r[1] === "No longer there")!;
  assert.equal(r90[4], "", "no note when nothing ended before the mark (review N8)");
  // Summing a retention section's values now gives exactly the eligible count when every placement is answered.
  for (const r of I.placements.retention) {
    const sum = rows.filter((x) => x[0] === `Retention, ${r.dayMark} days`).reduce((n, x) => n + Number(x[2]), 0);
    assert.equal(sum, r.eligible, `${r.dayMark}-day values add to the eligible count`);
  }
});

test("CSV: no number changed. Same values, same order, one row moved to a note, stage rows labeled legacy", () => {
  const [oldHead, ...before] = parseCsv(OLD_CSV);
  assert.deepEqual(oldHead, ["Section", "Measure", "Value", "Counted over"]);
  const [newHead, ...after] = parseCsv(insightsCsv("Test Org (Demo)", I));
  assert.deepEqual(newHead, ["Section", "Measure", "Value", "Counted over", "Note"]);
  const key = (r: readonly string[]) => `${r[0].replace(/^Stage$/, LEGACY_STAGE_SECTION)}|${r[1]}|${r[2]}|${r[3]}`;
  const dropped = before.filter((r) => /ended before/i.test(r[1]));
  assert.equal(dropped.length, I.placements.retention.length);
  const kept = before.filter((r) => !dropped.includes(r)).map(key);
  const now = after.filter((r) => !(r[0] === "About" && r[1] === "Period")).map(key);
  assert.deepEqual(now, kept, "every other row identical to the 964090c text, in order");
  // The moved figures land on the matching 'No longer there' rows, and only when above 0.
  for (const r of dropped) {
    const nl = after.find((x) => x[0] === r[0] && x[1] === "No longer there")!;
    assert.equal(nl[4], Number(r[2]) > 0 ? `Of those, ${r[2]} ended before this check-in (from the end date). Part of this number, not added to it.` : "");
  }
  assert.equal(after.filter((r) => r[0] === LEGACY_STAGE_SECTION).length, 7);
  assert.ok(!after.some((r) => r[0] === "Stage"));
  assert.equal(after.find((r) => r[1] === "Period")![2], PERIOD_LABEL);
  assert.ok(after.every((r) => r.length === 5), "five columns on every line");
});

test("the route builds the CSV from the one shared definition", () => {
  const src = readFileSync(join(ROOT, "app/api/org/insights/route.ts"), "utf8");
  assert.match(src, /insightsCsv\(guard\.actor\.orgName, insights\)/);
  assert.doesNotMatch(src, /function toCsv/);
  assert.match(src, /recordDataAccess\(/, "the export is still audited");
  assert.match(src, /org\.export/, "the export still needs org.export");
});

test("the old cohort CSV button is gone for organizations that have Insights", () => {
  const src = readFileSync(join(ROOT, "components/org/OrgDashboard.tsx"), "utf8");
  const at = src.indexOf("/api/partner/cohort?format=csv");
  assert.ok(at > 0, "kept for organizations without the workspace");
  assert.match(src.slice(Math.max(0, at - 300), at), /!data\?\.crmV2/);
  assert.doesNotMatch(src, /mission control/i);
});

async function renderReport(orgName: string) {
  const { InsightsReport } = await import("../../components/org/InsightsReport");
  return renderToStaticMarkup(React.createElement(InsightsReport, {
    d: I, orgName, orgId: "00000000-0000-4000-8000-000000000001", hasLogo: false, canExport: true, generatedAt: "2026-10-24T18:00:00.000Z",
  }));
}

test("print report renders: org mark and name, period, sections, counted-over notes, footer", async () => {
  const html = await renderReport("Harbor Light Works (Demo)");
  assert.match(html, /class="insights-report/);
  assert.match(html, /ins-print-head[^]*data-org-mark[^]*Harbor Light Works<[^]*with Steel Man Resumes/);
  assert.match(html, /All time, as of Oct 24, 2026/);
  assert.match(html, /Sample data\. The participants are fictional, and so is any employer marked fictional\./, "a demo org's printed report says so");
  for (const h of ["People", "Where people are", "Momentum", "Work toward a job", "Placements your team recorded", "Your team", "What people chose to share"]) {
    assert.ok(html.includes(`>${h}</h2>`), `section ${h}`);
  }
  for (const st of ["Overview", "Find work", "Tailor and package", "Plan what to say", "Practice", "Apply and track", "What comes next"]) assert.ok(html.includes(st), st);
  assert.doesNotMatch(html, /Getting oriented|Building foundation|Applying &amp; tracking/, "no legacy stage names on screen");
  assert.match(html, /of those, 1 ended before this check-in/);
  assert.match(html, /Counts are rows, never a claim about people outside this organization\. Generated Oct 24, 2026\./);
  // Every tile carries what it was counted over.
  const tiles = [...html.matchAll(/<div class="ins-tile[^"]*">(.*?)<\/div><\/div>/g)].map((m) => m[1]);
  assert.ok(tiles.length >= 15);
  for (const t of tiles) assert.match(t, /text-\[11px\] text-t-phos-dim mt-0\.5">[^<]{4,}/, `tile has a note: ${t.slice(0, 80)}`);
});

test("the printed sample-data line is the shell's sentence, word for word", async () => {
  const { DEMO_PRINT_LINE } = await import("../../components/org/InsightsReport");
  const { DEMO_SAMPLE_LINE } = await import("../demo-line");
  const shell = readFileSync(join(ROOT, "app/(dashboard)/RefineryShell.tsx"), "utf8").replace(/\s+/g, " ");
  // One sentence, one place (lib/demo-line.ts): the shell renders the same constant.
  assert.equal(DEMO_PRINT_LINE, DEMO_SAMPLE_LINE);
  assert.ok(shell.includes("{DEMO_SAMPLE_LINE}") && shell.includes('import { DEMO_SAMPLE_LINE, isDemoOrgName } from "@/lib/demo-line"'), "RefineryShell carries the same sentence");
});

test("a non-demo org's report has no sample-data line; the print stylesheet hides the app around it", async () => {
  const html = await renderReport("Harbor Light Works");
  assert.doesNotMatch(html, /Sample data/);
  const css = readFileSync(join(ROOT, "components/org/insights-print.css"), "utf8");
  assert.match(css, /@media print/);
  assert.match(css, /body:has\(\.insights-report\) \*:not\(:has\(\.insights-report\)\):not\(\.insights-report\):not\(\.insights-report \*\) \{ display: none !important; \}/);
  const page = readFileSync(join(ROOT, "app/(dashboard)/dashboard/insights/page.tsx"), "utf8");
  assert.match(page, /insights-print\.css/);
});
