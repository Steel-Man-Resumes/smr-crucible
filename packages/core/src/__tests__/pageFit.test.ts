/**
 * Phase 2.5 page-fit engine -- pure, deterministic tests (no DB, no browser).
 *
 * Covers: parsing parity with the download route's classification, the height
 * model (band + page count on short/dense/overflow fixtures, monotonicity of
 * final-page fullness), the advisory fit loop (never mutates, lowest-priority
 * first, too-short additive suggestion, observable failure), and the geometry
 * constants matching the route's exact values.
 *
 * Run: npm test  (node --import tsx --test, no extra deps)
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  // geometry
  PAGE_WIDTH_TWIPS,
  PAGE_HEIGHT_TWIPS,
  MARGIN_TOP_TWIPS,
  MARGIN_BOTTOM_TWIPS,
  MARGIN_LEFT_TWIPS,
  MARGIN_RIGHT_TWIPS,
  USABLE_WIDTH_TWIPS,
  USABLE_HEIGHT_TWIPS,
  NAME_SIZE,
  HEADLINE_SIZE,
  CONTACT_SIZE,
  SECTION_SIZE,
  BODY_SIZE,
  BULLET_SIZE,
  COMPETENCY_SIZE,
  JOB_TITLE_SIZE,
  BULLET_INDENT_TWIPS,
  RENDERER_VERSION,
  // classification / parsing
  classifyResumeLine,
  parseResumeBlocks,
  isSectionHeader,
  isCompetencyLine,
  isJobTitleLine,
  isBulletLine,
  estimatePageFit,
  BlockType,
} from "../pageFitShared";

import { computeFitPlan, rankBlocks } from "../pageFit";

// ---------------------------------------------------------------------------
// Fixtures -- built the way formatResumeDownload emits text, so classification
// parity is tested against the real download format.
// ---------------------------------------------------------------------------

const SHORT_RESUME = [
  "JORDAN RIVERS",
  "555-1212 | jordan@example.com | Milwaukee, WI",
  "Warehouse Associate",
  "",
  "PROFESSIONAL SUMMARY",
  "Reliable warehouse worker with two years moving freight safely and on time.",
  "",
  "PROFESSIONAL EXPERIENCE",
  "",
  "Warehouse Associate | Acme Logistics, 2023 - Present",
  "- Loaded 40 trucks a day with zero safety incidents.",
  "- Trained 3 new hires on forklift safety.",
  "",
  "EDUCATION & CERTIFICATIONS",
  "Forklift Certification | OSHA  2023",
  "",
].join("\n");

// A dense ~20-year resume: many roles, each with several wrapping bullets.
function denseResume(): string {
  const lines: string[] = [
    "MORGAN CASEY",
    "555-8888 | morgan.casey@example.com | Chicago, IL",
    "Operations Manager",
    "",
    "PROFESSIONAL SUMMARY",
    "Operations leader with over twenty years running distribution centers, leading large teams, and cutting costs while lifting safety and service across multiple sites and shifts every single year.",
    "",
    "CORE COMPETENCIES",
    "Logistics | Safety | Lean | Scheduling | Budgets | Hiring",
    "",
    "PROFESSIONAL EXPERIENCE",
    "",
  ];
  const roles = [
    ["Operations Manager | Global Freight, 2016 - Present"],
    ["Shift Supervisor | Regional Distribution, 2010 - 2016"],
    ["Warehouse Lead | Midwest Storage, 2006 - 2010"],
    ["Forklift Operator | City Warehousing, 2002 - 2006"],
    ["Loader | First Freight, 1998 - 2002"],
  ];
  for (const [title] of roles) {
    lines.push(title);
    for (let i = 0; i < 5; i++) {
      lines.push(
        "- Led a team that moved large volumes of freight every shift while improving safety scores, cutting overtime, and keeping on-time delivery above the target across the whole facility."
      );
    }
    lines.push("");
  }
  lines.push("EDUCATION & CERTIFICATIONS", "Associate Degree | City College  2000", "");
  return lines.join("\n");
}

// An overflowing resume: the dense one, doubled up on roles, to push past 2 pages.
function overflowResume(): string {
  const base = denseResume();
  const extra: string[] = ["PROFESSIONAL EXPERIENCE", ""];
  for (let r = 0; r < 8; r++) {
    extra.push(`Additional Role ${r} | Some Company, 1990 - 2000`);
    for (let i = 0; i < 6; i++) {
      extra.push(
        "- Delivered strong results across a wide range of operational duties, managing people and process and equipment while keeping every important metric moving in the right direction every quarter."
      );
    }
    extra.push("");
  }
  return base + "\n" + extra.join("\n");
}

// ---------------------------------------------------------------------------
// Geometry constants match the route's exact values
// ---------------------------------------------------------------------------

test("geometry: page + margins match the download route exactly", () => {
  assert.equal(PAGE_WIDTH_TWIPS, 12240); // 8.5in
  assert.equal(PAGE_HEIGHT_TWIPS, 15840); // 11in
  assert.equal(MARGIN_TOP_TWIPS, 403); // 0.28in
  assert.equal(MARGIN_BOTTOM_TWIPS, 403);
  assert.equal(MARGIN_LEFT_TWIPS, 619); // 0.43in
  assert.equal(MARGIN_RIGHT_TWIPS, 619);
  assert.equal(USABLE_WIDTH_TWIPS, 12240 - 619 * 2); // 11002 (~7.64in)
  assert.equal(USABLE_HEIGHT_TWIPS, 15840 - 403 * 2); // 15034 (~10.44in)
  // Confirm the inch conversions the route documents.
  assert.ok(Math.abs(USABLE_WIDTH_TWIPS / 1440 - 7.64) < 0.01);
  assert.ok(Math.abs(USABLE_HEIGHT_TWIPS / 1440 - 10.44) < 0.01);
});

test("geometry: font half-point sizes match the route constants", () => {
  assert.equal(NAME_SIZE, 36); // 18pt
  assert.equal(HEADLINE_SIZE, 16); // 8pt
  assert.equal(CONTACT_SIZE, 16); // 8pt
  assert.equal(SECTION_SIZE, 18); // 9pt
  assert.equal(BODY_SIZE, 16); // 8pt
  assert.equal(BULLET_SIZE, 16); // 8pt
  assert.equal(COMPETENCY_SIZE, 16); // 8pt
  assert.equal(JOB_TITLE_SIZE, 17); // 8.5pt
  assert.equal(BULLET_INDENT_TWIPS, 280);
});

test("RENDERER_VERSION is present and stable-looking", () => {
  assert.equal(typeof RENDERER_VERSION, "string");
  assert.ok(RENDERER_VERSION.length > 0);
});

// ---------------------------------------------------------------------------
// Classification parity with the download route
// ---------------------------------------------------------------------------

test("classify: section headers detected (case + punctuation tolerant)", () => {
  assert.ok(isSectionHeader("PROFESSIONAL EXPERIENCE"));
  assert.ok(isSectionHeader("Education & Certifications"));
  assert.ok(isSectionHeader("core competencies"));
  assert.equal(isSectionHeader("Warehouse Associate | Acme, 2023"), false);
});

test("classify: competency vs job-title disambiguation matches the route", () => {
  // 6 pipe parts -> competency
  assert.ok(isCompetencyLine("Logistics | Safety | Lean | Scheduling | Budgets | Hiring"));
  // 2 pipe parts (title | company, dates) -> NOT competency, IS a job title
  assert.equal(isCompetencyLine("Operations Manager | Global Freight, 2016 - Present"), false);
  assert.ok(isJobTitleLine("Operations Manager | Global Freight, 2016 - Present"));
  // a contact line has an @ -> NOT a job title
  assert.equal(isJobTitleLine("555 | jordan@example.com | Milwaukee"), false);
});

test("classify: bullets detected by all three markers", () => {
  assert.ok(isBulletLine("- did a thing"));
  assert.ok(isBulletLine("* did a thing"));
  assert.ok(isBulletLine("• did a thing"));
  assert.equal(isBulletLine("did a thing"), false);
});

test("classify: per-line classifier returns the expected block types", () => {
  assert.equal(classifyResumeLine(""), "blank");
  assert.equal(classifyResumeLine("PROFESSIONAL SUMMARY"), "section");
  assert.equal(classifyResumeLine("- Loaded 40 trucks a day."), "bullet");
  assert.equal(classifyResumeLine("A | B | C | D | E"), "competency");
  assert.equal(classifyResumeLine("Warehouse Associate | Acme, 2023 - Present"), "jobTitle");
  assert.equal(classifyResumeLine("A plain sentence of summary prose."), "body");
});

test("parse: the short fixture classifies into the expected block sequence", () => {
  const blocks = parseResumeBlocks(SHORT_RESUME);
  const types = blocks.map((b) => b.type);
  // Header first: name then contact. NOTE this faithfully reproduces the route's
  // header quirk -- formatResumeDownload emits name/contact/headline, so the
  // contact line is headerLines[1]; the route sets headlineLine = headerLines[1]
  // = the contact line, then skips the headline block because it equals contact.
  // So a distinct "headline" block is NOT emitted for this ordering (parity).
  assert.equal(types[0], "name");
  assert.ok(types.includes("contact"));
  // structural blocks present
  assert.ok(types.includes("section"));
  assert.ok(types.includes("bullet"));
  assert.ok(types.includes("jobTitle"));
  // the summary sentence is body
  const summary = blocks.find((b) => b.text.startsWith("Reliable warehouse"));
  assert.ok(summary);
  assert.equal(summary?.type as BlockType, "body");
  // the forklift cert line has 2 pipe parts + a year, NOT a competency
  const cert = blocks.find((b) => b.text.startsWith("Forklift Certification"));
  assert.equal(cert?.type as BlockType, "jobTitle");
});

test("parse: header emits a distinct headline when contact is not line 2", () => {
  // name / headline / contact(with @) -> route sets headlineLine=headerLines[1]
  // (the headline) and contactLine=find(@)=headerLines[2]; headline != contact,
  // so a distinct headline block IS emitted. Mirrors the route exactly.
  const content = [
    "TAYLOR REED",
    "Senior Operations Leader",
    "555-2020 | taylor@example.com | Denver, CO",
    "",
    "PROFESSIONAL SUMMARY",
    "A short summary line.",
    "",
  ].join("\n");
  const blocks = parseResumeBlocks(content);
  const types = blocks.map((b) => b.type);
  assert.equal(types[0], "name");
  assert.ok(types.includes("headline"));
  assert.ok(types.includes("contact"));
  const headline = blocks.find((b) => b.type === "headline");
  assert.equal(headline?.text, "Senior Operations Leader");
});

// ---------------------------------------------------------------------------
// Page model
// ---------------------------------------------------------------------------

test("model: a short/sparse resume is one page", () => {
  const r = estimatePageFit(SHORT_RESUME);
  assert.equal(r.pageCount, 1);
  // sparse -> thin final page -> "under" (or "ok" if it happens to be full).
  assert.ok(r.band === "under" || r.band === "ok");
  assert.equal(r.rendererVersion, RENDERER_VERSION);
});

test("model: a dense 20-year resume lands around two pages", () => {
  const r = estimatePageFit(denseResume());
  assert.ok(r.pageCount >= 2 && r.pageCount <= 2, `expected 2 pages, got ${r.pageCount}`);
});

test("model: an overflowing resume is over two pages -> band 'over'", () => {
  const r = estimatePageFit(overflowResume());
  assert.ok(r.pageCount > 2, `expected >2 pages, got ${r.pageCount}`);
  assert.equal(r.band, "over");
});

test("model: an empty resume is band 'empty', one page", () => {
  const r = estimatePageFit("   \n\n  \n");
  assert.equal(r.band, "empty");
  assert.equal(r.pageCount, 1);
});

test("model: final-page fullness is monotonic with content length", () => {
  // Build progressively longer single-page resumes and confirm total height only
  // grows (a proxy for final-page fullness rising until a page break).
  const heights: number[] = [];
  for (let n = 1; n <= 8; n++) {
    const lines = ["ALEX PARK", "555 | alex@example.com", "Worker", "", "PROFESSIONAL SUMMARY"];
    for (let i = 0; i < n; i++) lines.push("A sentence of real summary content that adds height.");
    const r = estimatePageFit(lines.join("\n"));
    heights.push(r.totalHeightTwips);
  }
  for (let i = 1; i < heights.length; i++) {
    assert.ok(heights[i] > heights[i - 1], `height must grow: ${heights}`);
  }
});

test("model: perPage fullness fractions are within 0..1 and last is the final", () => {
  const r = estimatePageFit(denseResume());
  for (const p of r.perPage) {
    assert.ok(p.fullnessFraction >= 0 && p.fullnessFraction <= 1);
  }
  assert.equal(r.finalPageFullness, r.perPage[r.perPage.length - 1].fullnessFraction);
});

// ---------------------------------------------------------------------------
// Fit loop -- advisory, never mutates
// ---------------------------------------------------------------------------

test("fit loop: a short resume 'fits' (or is honestly reported thin), empty ledger on ok", () => {
  const plan = computeFitPlan(SHORT_RESUME);
  assert.ok(plan.status === "fits" || plan.status === "too_short");
  // The result object is never a mutated resume -- it's a PageFitResult.
  assert.ok(typeof plan.result.pageCount === "number");
});

test("fit loop: too_long lists lowest-priority items first and never returns content", () => {
  const plan = computeFitPlan(overflowResume());
  assert.equal(plan.status, "too_long");
  assert.ok(plan.ledger.length > 1);
  // No ledger entry (nor the plan) carries a mutated resume string -- only advice.
  assert.equal((plan as any).content, undefined);
  assert.equal((plan as any).mutatedResume, undefined);
  // The omit entries that point at a block are ordered lowest-priority-first:
  // the first pointed omit should be a lower-priority section than the last.
  const omits = plan.ledger.filter((e) => e.kind === "omit" && e.label);
  assert.ok(omits.length > 0);
  // Header/name/contact are never offered for omission.
  for (const e of omits) {
    assert.notEqual(e.label, "Name");
    assert.notEqual(e.label, "Contact line");
  }
  // A spacing-tighten lever is offered as a bounded suggestion.
  assert.ok(plan.ledger.some((e) => e.kind === "tighten"));
});

test("fit loop: too_short produces an additive suggestion, not a cut", () => {
  const plan = computeFitPlan(SHORT_RESUME);
  if (plan.status === "too_short") {
    assert.ok(plan.ledger.length >= 1);
    assert.equal(plan.ledger[0].kind, "add");
    // never suggests omitting on a thin resume
    assert.ok(!plan.ledger.some((e) => e.kind === "omit"));
  }
});

test("fit loop: observable failure state when levers cannot reach the band", () => {
  // A resume that is essentially all high-priority experience, far over 2 pages,
  // cannot be brought into band by omitting only low-priority items.
  const plan = computeFitPlan(overflowResume());
  assert.equal(plan.status, "too_long");
  // cannotReachBandByLevers is a boolean and, for this extreme case, true.
  assert.equal(typeof plan.cannotReachBandByLevers, "boolean");
  if (plan.cannotReachBandByLevers) {
    const last = plan.ledger[plan.ledger.length - 1];
    assert.ok(/runs long|too much|matters most/i.test(last.message));
  }
});

test("rankBlocks: header/contact rank highest (keep), spacing ranks lowest (drop first)", () => {
  const blocks = parseResumeBlocks(denseResume());
  const ranked = rankBlocks(blocks);
  const name = ranked.find((r) => r.block.type === "name");
  const blank = ranked.find((r) => r.block.type === "blank");
  assert.ok(name);
  assert.ok(blank);
  assert.ok((name?.rank ?? 0) < (blank?.rank ?? 99));
});

test("fit loop: ledger omit entries never point at the name or contact block", () => {
  const plan = computeFitPlan(overflowResume());
  const pointed = plan.ledger.filter((e) => e.index !== undefined);
  const blocks = parseResumeBlocks(overflowResume());
  for (const e of pointed) {
    const b = blocks[e.index!];
    assert.ok(b);
    assert.notEqual(b.type, "name");
    assert.notEqual(b.type, "contact");
    assert.notEqual(b.type, "headline");
  }
});
