/**
 * Fix 2026-10-28 (walkthrough T02): the downloaded plan was every text line as
 * a bare <p>. The print page is now built from the plan's structure. These
 * tests prove the page has a heading per section, escapes every user line,
 * leaves empty parts out, uses no em dash in its fixed copy, and never holds
 * more than the on-screen plan shows (record "what you told us" lines, and
 * t.ROY's reading unless it is shown).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { INITIAL_STATE, plannerReducer, type PlannerState, type PlannerAction } from "../hurdles/reducer";
import { buildHurdlePlan, hurdlePlanText, COACHING_LINE, type HurdlePlan } from "../hurdles/plan";
import { buildHurdlePlanPrintHtml } from "../hurdles/plan-print";

const run = (actions: PlannerAction[], from: PlannerState = INITIAL_STATE) => actions.reduce(plannerReducer, from);
const pick = (...hurdles: string[]) => hurdles.map((h) => ({ type: "toggle", hurdle: h }) as PlannerAction);
const ans = (nodeId: string, ...choices: string[]): PlannerAction => ({ type: "answer", nodeId, choices });
const txt = (nodeId: string, text: string): PlannerAction => ({ type: "answer", nodeId, text });
const DATE = "October 28, 2026";

/** Valjean-style plan: record + transport, own words with markup in them. */
const valjean = () => buildHurdlePlan(run([...pick("transport", "record"), { type: "start" }, ans("record.where", "interview"), ans("record.raise", "wait"),
  ans("record.kind", "felony"), ans("record.when", "3to7"), ans("record.supervision", "no"), txt("record.state", "WI"),
  ans("record.worry", "details"), ans("record.lead", "work"), txt("record.own_words", "I made a mistake <script>alert(1)</script> & paid for it."), txt("record.now_words", "I've loaded trucks at Digne for a year."),
  ans("transport.what", "bus_hours")]));

const transportOnly = () => buildHurdlePlan(run([...pick("transport", "schedule"), { type: "start" }, ans("transport.what", "ride"), ans("transport.backup", "no")]));

/** Text a reader sees, without tags or the style block. */
const visible = (html: string) => html.replace(/<style>[\s\S]*?<\/style>/, "").replace(/<[^>]+>/g, " ");

describe("downloaded plan page (T02)", () => {
  it("has a title, the coaching line, and a heading for every section", () => {
    const plan = valjean();
    const html = buildHurdlePlanPrintHtml(plan, { targetJob: "Yard Hand", date: DATE });
    assert.match(html, /<h1>Your plan: Yard Hand<\/h1>/);
    assert.ok(html.includes(DATE));
    assert.ok(html.includes(COACHING_LINE));
    assert.match(html, /<h2>Plan what to say about the record<\/h2>/);
    for (const s of plan.hurdles.filter((x) => x.hurdle !== "record")) assert.ok(html.includes(`<h2>${s.label}</h2>`), `heading for ${s.hurdle}`);
    assert.match(html, /<h3>Do now<\/h3>/);
    assert.match(html, /<h3>What to say<\/h3><blockquote class="own">/);
    assert.match(html, /@page/);
    assert.match(html, /font-family: Georgia/);
  });

  it("keeps the record privacy note and the legal disclaimer", () => {
    const plan = valjean();
    const html = buildHurdlePlanPrintHtml(plan, { date: DATE });
    assert.ok(html.includes("Not saved anywhere. This copy is yours."));
    assert.ok(html.includes(plan.record!.disclaimer));
    assert.ok(visible(html).includes("This is coaching, not legal advice."));
  });

  it("escapes every user line (no HTML injection)", () => {
    const html = buildHurdlePlanPrintHtml(valjean(), { targetJob: "<img src=x onerror=alert(1)>", date: DATE, summaries: { transport: "<b>bold</b>" } });
    assert.ok(!html.includes("<script>"), "own words script tag escaped");
    assert.ok(!html.includes("<img"), "target job escaped");
    assert.ok(!html.includes("<b>bold"), "reading escaped");
    assert.ok(html.includes("&lt;script&gt;alert(1)&lt;/script&gt; &amp; paid for it."));
    assert.ok(html.includes("&lt;img src=x onerror=alert(1)&gt;"));
  });

  it("uses no em dash or double hyphen in its fixed copy", () => {
    for (const plan of [valjean(), transportOnly()]) {
      const html = buildHurdlePlanPrintHtml(plan, { targetJob: "Yard Hand", date: DATE, summaries: { transport: "Reading." } });
      assert.ok(!html.includes("\u2014"), "no em dash");
      assert.ok(!html.includes("--"), "no double hyphen");
    }
  });

  it("leaves empty parts out instead of printing them blank", () => {
    const plan = transportOnly();
    const html = buildHurdlePlanPrintHtml(plan, { date: DATE });
    assert.ok(!html.includes("Plan what to say about the record"), "no record part without the record hurdle");
    assert.ok(!html.includes("<ul></ul>"));
    assert.ok(!html.includes("<h3>What to ask an employer</h3>") || plan.hurdles.some((s) => s.askEmployer.length));
    assert.ok(!html.includes("reading of your answers"), "no reading when none is passed");
    // A hurdle with nothing in it is left out entirely.
    const empty: HurdlePlan = { ...plan, hurdles: [{ ...plan.hurdles[0], known: [], open: [], doNow: [], askEmployer: [], tell: null }] };
    const html2 = buildHurdlePlanPrintHtml(empty, { date: DATE });
    assert.ok(!html2.includes(`<h2>${plan.hurdles[0].label}</h2>`), "empty section omitted");
    assert.ok(!html2.includes("<h3>"));
    assert.ok(!/<h1>Your plan:/.test(html2), "no job, no colon");
  });

  it("holds the same lines as the plain-text copy, adding no new facts", () => {
    const plan = valjean();
    const html = buildHurdlePlanPrintHtml(plan, { date: DATE });
    const text = hurdlePlanText(plan);
    for (const s of plan.hurdles.filter((x) => x.hurdle !== "record")) {
      for (const line of [...s.known, ...s.open, ...s.doNow, ...s.askEmployer]) {
        assert.ok(text.includes(line), `text copy has: ${line}`);
        assert.ok(html.includes(line.replace(/&/g, "&amp;").replace(/'/g, "&#39;").replace(/"/g, "&quot;")), `print has: ${line}`);
      }
    }
    for (const src of plan.record!.legalFloor.sources) assert.ok(html.includes(src.url.replace(/&/g, "&amp;")), `source ${src.id}`);
  });

  it("never prints what the screen hides: record answers as 'what you told us', or a hidden reading", () => {
    const plan = valjean();
    const rec = plan.hurdles.find((s) => s.hurdle === "record")!;
    assert.ok(rec.known.length > 0, "the fixture has record answers to hide");
    // Even a plan whose record part is missing never prints the record hurdle's known lines.
    const noRecordPart: HurdlePlan = { ...plan, record: null };
    const html = buildHurdlePlanPrintHtml(noRecordPart, { date: DATE });
    for (const line of rec.known) assert.ok(!html.includes(line.replace(/'/g, "&#39;")), `record known line printed: ${line}`);
    // The page passes the reading only while it is on screen.
    const page = readFileSync(new URL("../../app/(dashboard)/dashboard/disclosure/page.tsx", import.meta.url), "utf8");
    assert.match(page, /buildHurdlePlanPrintHtml\(plan, \{[^}]*summaries: showReading \? wording\.summaries : undefined/);
    assert.ok(!/split\("\\n"\)\.map\(\(l\) => \(l \? `<p>/.test(page), "old line-by-line builder is gone");
  });
});
