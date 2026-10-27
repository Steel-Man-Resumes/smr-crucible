/**
 * Staff build S3: the People grid. The pure spreadsheet rules (windowing,
 * keys, ranges, TSV, pasted text into values, the summary row, all-or-nothing
 * paste plans) and the rendered grid (roles for screen readers, sensitive
 * answers hidden, read-only built-ins, summary row). Fictional fixtures only.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  flattenGroups, inRange, moveCell, parseDateText, parseTsv, planPaste, rangeOf, rowLines, scrollToLine, summarize, summaryKindsFor, textToRaw, toTsv,
  visibleWindow, MASK, READ_ONLY_REASON,
} from "../people-grid";
import { PeopleGrid, type PeopleGridProps } from "../../components/org/PeopleGrid";
import { normalizeGridLayout } from "@crucible/core/src/viewLayoutShared";
import { validateCustomFieldValue, type CustomFieldDef } from "@crucible/core/src/customFieldsShared";
import type { ViewField, ViewRow } from "@crucible/core/src/savedViewsShared";

(globalThis as { React?: unknown }).React = React;

const def = (over: Partial<CustomFieldDef>): CustomFieldDef => ({
  id: "d1", entity: "participant", key: "k", label: "Field", type: "text", options: [], required: false, help: null, sensitive: false, position: 0, retiredAt: null, ...over,
});
const HOUSING = def({ id: "d1", key: "housing", label: "Housing", type: "single_select", options: [{ id: "stable", label: "Stable" }, { id: "shelter", label: "Shelter" }, { id: "old", label: "Old place", retired: true }] });
const HOURS = def({ id: "d2", key: "hours", label: "Hours a week", type: "number" });
const START = def({ id: "d3", key: "start", label: "Start date", type: "date" });
const PAROLE = def({ id: "d4", key: "parole_end", label: "Parole end", type: "date", sensitive: true });
const SKILLS = def({ id: "d5", key: "skills", label: "Skills", type: "multi_select", options: [{ id: "fork", label: "Forklift" }, { id: "weld", label: "Welding" }] });
const READY = def({ id: "d6", key: "ready", label: "Ready", type: "boolean" });
const COACH = def({ id: "d7", key: "coach", label: "Coach", type: "staff_member" });
const STAFF = [{ id: "a1111111-1111-4111-8111-111111111111", name: "Dana Lee" }];

test("lines: groups become headers with counts; a folded group keeps its header; no header when not grouped", () => {
  const rows = (ids: string[]) => ids.map((id) => ({ id, values: {} }));
  const lines = flattenGroups([{ key: "a", label: "Stable", rows: rows(["1", "2"]) }, { key: "", label: "Not set", rows: rows(["3"]) }], new Set([""]));
  assert.deepEqual(lines.map((l) => (l.kind === "group" ? `G:${l.label}:${l.count}:${l.collapsed}` : `R:${l.rowId}`)), ["G:Stable:2:false", "R:1", "R:2", "G:Not set:1:true"]);
  assert.deepEqual(rowLines(lines).map((l) => l.rowId), ["1", "2"]);
  assert.deepEqual(flattenGroups([{ key: "", label: "", rows: rows(["1"]) }], new Set()).map((l) => l.kind), ["row"]);
});

test("window: only the lines on screen, plus a margin; padding keeps the scrollbar honest", () => {
  const w = visibleWindow(4000, 400, 40, 5000, 5);
  assert.equal(w.start, 95);
  assert.equal(w.end, 116);
  assert.equal(w.padTop, 95 * 40);
  assert.equal(w.padBottom, (5000 - 116) * 40);
  assert.deepEqual(visibleWindow(0, 400, 40, 0), { start: 0, end: 0, padTop: 0, padBottom: 0 });
  assert.equal(scrollToLine(0, 400, 400, 40), 0);
  assert.equal(scrollToLine(30, 0, 400, 40), 31 * 40 - 400);
  assert.equal(scrollToLine(5, 0, 400, 40), 0, "already in view: no jump");
});

test("keys: arrows, Tab wraps, Home/End, Ctrl jumps, Page moves; never leaves the grid", () => {
  const b = { rows: 10, cols: 4, page: 3 };
  assert.deepEqual(moveCell({ row: 0, col: 0 }, "ArrowUp", {}, b), { row: 0, col: 0 });
  assert.deepEqual(moveCell({ row: 0, col: 3 }, "Tab", {}, b), { row: 1, col: 0 });
  assert.deepEqual(moveCell({ row: 1, col: 0 }, "Tab", { shift: true }, b), { row: 0, col: 3 });
  assert.deepEqual(moveCell({ row: 9, col: 3 }, "Tab", {}, b), { row: 9, col: 3 });
  assert.deepEqual(moveCell({ row: 4, col: 2 }, "Home", {}, b), { row: 4, col: 0 });
  assert.deepEqual(moveCell({ row: 4, col: 2 }, "End", { ctrl: true }, b), { row: 9, col: 3 });
  assert.deepEqual(moveCell({ row: 4, col: 2 }, "ArrowDown", { ctrl: true }, b), { row: 9, col: 2 });
  assert.deepEqual(moveCell({ row: 8, col: 1 }, "PageDown", {}, b), { row: 9, col: 1 });
  assert.equal(moveCell({ row: 0, col: 0 }, "x", {}, b), null);
  const r = rangeOf({ row: 5, col: 3 }, { row: 2, col: 1 });
  assert.deepEqual(r, { r0: 2, c0: 1, r1: 5, c1: 3 });
  assert.ok(inRange(r, 3, 2) && !inRange(r, 6, 2));
});

test("TSV: what spreadsheets write comes back the same, tabs, quotes and line breaks included", () => {
  const m = [["Alma Reyes", "Stable", "40"], ["Sam \"Sammy\" Cole", "two\nlines", "a\tb"]];
  assert.deepEqual(parseTsv(toTsv(m)), m);
  assert.deepEqual(parseTsv("a\tb\r\nc\td\r\n"), [["a", "b"], ["c", "d"]], "Windows line ends; a trailing break is not a row");
  assert.deepEqual(parseTsv("one"), [["one"]]);
  assert.deepEqual(parseTsv("a\t\tc"), [["a", "", "c"]]);
});

test("pasted text becomes the value each field expects", () => {
  assert.equal(textToRaw(HOUSING, " shelter "), "shelter");
  assert.equal(textToRaw(HOUSING, "STABLE"), "stable");
  assert.equal(textToRaw(HOUSING, "Mansion"), "Mansion", "unknown text passes through for the validator to explain");
  assert.equal(textToRaw(HOURS, "$1,250"), 1250);
  assert.equal(textToRaw(HOURS, ""), null, "empty clears");
  assert.equal(textToRaw(START, "10/27/2026"), "2026-10-27");
  assert.equal(textToRaw(START, "Oct 5, 2026"), "2026-10-05");
  assert.equal(textToRaw(READY, "Yes"), true);
  assert.equal(textToRaw(READY, "x"), true);
  assert.equal(textToRaw(READY, "no"), false);
  assert.deepEqual(textToRaw(SKILLS, "Forklift; welding"), ["fork", "weld"]);
  assert.equal(textToRaw(COACH, "dana lee", STAFF), STAFF[0].id);
  assert.equal(parseDateText("2026-02-30"), "2026-02-30", "the shape is read here; the validator refuses the impossible day");
  assert.equal(validateCustomFieldValue(START, textToRaw(START, "2026-02-30")).ok, false);
  assert.equal(parseDateText("next week"), null);
});

test("paste plan: all or nothing; every bad cell named; one value fills a selected range", () => {
  const cols = ["name", "cf:housing", "cf:hours"];
  const ids = ["p1", "p2", "p3"];
  const defs: Record<string, CustomFieldDef> = { "cf:housing": HOUSING, "cf:hours": HOURS };
  const target = (r: number, c: number) => (ids[r] ? { rowId: ids[r], colId: cols[c], key: defs[cols[c]]?.key ?? null } : null);
  const check = (t: { colId: string }, text: string) => {
    if (!defs[t.colId]) return { ok: false as const, error: READ_ONLY_REASON[t.colId] };
    const res = validateCustomFieldValue(defs[t.colId], textToRaw(defs[t.colId], text));
    return res.ok ? { ok: true as const, raw: res.value } : { ok: false as const, error: res.error };
  };
  const good = planPaste([["Stable", "40"], ["Shelter", "12"]], rangeOf({ row: 0, col: 1 }, { row: 0, col: 1 }), { rows: 3, cols: 3 }, target, check);
  assert.deepEqual(good.errors, {});
  assert.deepEqual(good.writes, { p1: { housing: "stable", hours: 40 }, p2: { housing: "shelter", hours: 12 } });
  const bad = planPaste([["Stable", "lots"], ["Mansion", "12"]], rangeOf({ row: 0, col: 1 }, { row: 0, col: 1 }), { rows: 3, cols: 3 }, target, check);
  assert.deepEqual(Object.keys(bad.errors).sort(), ["0:2", "1:1"]);
  assert.match(bad.errors["0:2"], /should be a number/);
  const ro = planPaste([["Someone else"]], rangeOf({ row: 0, col: 0 }, { row: 0, col: 0 }), { rows: 3, cols: 3 }, target, check);
  assert.match(ro.errors["0:0"], /own account/, "a person's own name is never pasted over");
  const fill = planPaste([["Shelter"]], rangeOf({ row: 0, col: 1 }, { row: 2, col: 1 }), { rows: 3, cols: 3 }, target, check);
  assert.deepEqual(fill.writes, { p1: { housing: "shelter" }, p2: { housing: "shelter" }, p3: { housing: "shelter" } });
  const edge = planPaste([["Stable"], ["Stable"], ["Stable"], ["Stable"]], rangeOf({ row: 1, col: 1 }, { row: 1, col: 1 }), { rows: 3, cols: 3 }, target, check);
  assert.match(edge.errors["3:1"], /past the edge/);
});

test("summary row: the right choices per column kind, the right words", () => {
  assert.ok(summaryKindsFor("number").includes("sum") && !summaryKindsFor("text").includes("sum"));
  assert.ok(summaryKindsFor("date").includes("latest") && summaryKindsFor("choice").includes("per_option"));
  const id = (v: unknown) => String(v);
  assert.equal(summarize("sum", [10, 20, null, 2.5], id), "Total 32.5");
  assert.equal(summarize("average", [10, 20], id), "Average 15");
  assert.equal(summarize("max", [], id), "No numbers");
  assert.equal(summarize("percent_filled", [1, null, null, 4], id), "50% filled in");
  assert.equal(summarize("earliest", ["2026-03-01", "2026-01-15"], id), "Earliest Jan 15, 2026");
  assert.equal(summarize("per_option", ["stable", "shelter", "stable"], (v) => (v === "stable" ? "Stable" : "Shelter")), "Stable 2, Shelter 1");
  assert.equal(summarize("per_option", [["fork", "weld"], ["fork"]], id), "fork 2, weld 1");
  assert.equal(summarize("unique", ["A", "a", "B"], id), "2 different");
  assert.equal(summarize("per_option", ["2027-01-01", "2027-02-01"], id, true), "2 filled in", "a hidden sensitive column only ever counts");
});

/* ------------------------------------------------------------ rendered -- */

const FIELDS: ViewField[] = [
  { id: "name", label: "Name", kind: "text" },
  { id: "status", label: "Status", kind: "choice", options: [{ id: "active", label: "Active this week" }] },
  { id: "cf:housing", label: "Housing", kind: "choice", options: HOUSING.options },
  { id: "cf:hours", label: "Hours a week", kind: "number" },
  { id: "cf:parole_end", label: "Parole end", kind: "date", sensitive: true },
];
const ROWS: ViewRow[] = [
  { id: "p1", values: { name: "Alma Reyes", status: "active", "cf:housing": "stable", "cf:hours": 40, "cf:parole_end": "2027-01-15" } },
  { id: "p2", values: { name: "Sam Cole", status: "active", "cf:housing": null, "cf:hours": 12, "cf:parole_end": null } },
];
const props = (over: Partial<PeopleGridProps> = {}): PeopleGridProps => ({
  groups: [{ key: "", label: "", rows: ROWS }], columns: ["status", "cf:housing", "cf:hours", "cf:parole_end"], fields: FIELDS,
  defsByColumn: new Map([["cf:housing", HOUSING], ["cf:hours", HOURS], ["cf:parole_end", PAROLE]]), staff: STAFF,
  layout: normalizeGridLayout({ summaries: { "cf:hours": "sum", "cf:housing": "per_option" } }), density: "regular", sort: null, groupBy: null,
  canEdit: true, canArrange: true, canStyle: true, onLayout: () => {}, onColumns: () => {}, onSort: () => {}, onGroupBy: () => {}, onValues: () => {}, onOpen: () => {},
  builtinText: (col, r) => (col === "status" ? "Active this week" : String(r.values[col] ?? "")), labelOf: (c) => FIELDS.find((f) => f.id === c)?.label ?? c,
  ...over,
});

test("grid: a real grid for screen readers, with row and column counts and one tab stop", () => {
  const html = renderToStaticMarkup(React.createElement(PeopleGrid, props()));
  assert.match(html, /role="grid"/);
  assert.match(html, /aria-rowcount="4"/);
  assert.match(html, /aria-colcount="6"/);
  assert.match(html, /role="columnheader"[^>]*aria-sort="none"/);
  assert.equal((html.match(/tabindex="0"/g) ?? []).length, 1);
  assert.match(html, /role="gridcell"[^>]*aria-readonly="true"/, "built-ins are read-only");
  assert.match(html, /Alma Reyes/);
});

test("grid: sensitive answers are hidden, never shown or summed, until the person chooses to show them", () => {
  const html = renderToStaticMarkup(React.createElement(PeopleGrid, props({ layout: normalizeGridLayout({ summaries: { "cf:parole_end": "latest" } }) })));
  assert.doesNotMatch(html, /2027/);
  assert.doesNotMatch(html, /Jan 15/);
  assert.match(html, new RegExp(MASK));
  assert.match(html, /aria-label="Sensitive"/);
});

test("grid: the summary row shows totals and counts for the rows shown", () => {
  const html = renderToStaticMarkup(React.createElement(PeopleGrid, props()));
  assert.match(html, /Total 52/);
  assert.match(html, /Stable 1/);
  assert.match(html, /2 people/);
});

test("grid: frozen columns stay put; widths come from the person's look", () => {
  const html = renderToStaticMarkup(React.createElement(PeopleGrid, props({ layout: normalizeGridLayout({ frozen: 2, widths: { status: 300 } }) })));
  assert.match(html, /width:300px;position:sticky;left:264px/);
});

test("grid: when the organization keeps the look the same, there is no resize handle and the summary is plain words", () => {
  const html = renderToStaticMarkup(React.createElement(PeopleGrid, props({ canStyle: false })));
  assert.doesNotMatch(html, /cursor-col-resize/);
  assert.doesNotMatch(html, /<select/);
});
