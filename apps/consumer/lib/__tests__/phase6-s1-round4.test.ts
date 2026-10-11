/**
 * Phase 6 lane S1, round 4: regression tests for recheck review r2 (M1 to M3,
 * L1, L3, L5), built from the reviewer's probes 4 and 5. Fictional people and
 * fake stores only. No AI, no database.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildFinishView, jobHeaderChanges, jobHeaderLines, recordJobOk, type DefendAnswer, type FinishView } from "../finish-gate";
import { givenTextMark } from "../revision-status";
import { fromWriterNewest, revisionKind, withRewording, writtenByWriter } from "../source-kind";
import { writerReceipt } from "../writer-receipt";
import { laneHomeNext } from "../../components/lanes/LaneHome";
import type { ArtifactRevision } from "@crucible/core/src/artifactRevision";

const read = (p: string) => readFileSync(join(__dirname, "..", "..", p), "utf8");
const UID = "00000000-0000-4000-8000-000000000001";
const GA = withRewording({ verifierRan: true, verifierRanByDoc: { resume: true, cover_letter: true }, removed: 0, residual: 0, unmatched: 0, outcomes: [] }, "given");
const HEAD = `DANA REYES\nSpringfield, IL | 555-0142 | dana.reyes@example.com\n\n`;

function views(upload: string, body: string): { before: FinishView; after: FinishView; page: string } {
  const page = `${HEAD}PROFESSIONAL EXPERIENCE\n${body}\n\nEDUCATION\nDiploma | Springfield High School | 2017`;
  const own = `${HEAD}${upload}\n\nEDUCATION\nSpringfield High School, Diploma, 2017`;
  let a: DefendAnswer[] = [];
  for (const h of jobHeaderLines(page)) a = recordJobOk(a, h);
  const v = (answers: DefendAnswer[]) => buildFinishView({ resumeText: page, ownWords: own, defendAnswers: answers, written: { resume: page, letter: "" }, grounding: GA, ownResumeText: own });
  return { before: v([]), after: v(a), page };
}

// ---- M3: dates compared as dates ----------------------------------------------------------------------

test("M3: a date range without spaces, or with an en dash, is the same date: a plain 'Looks right', no changed card", () => {
  for (const upload of ["8/2021-Present", "8/2021–Present", "8/2021 — Present", "8/2021 to Present"]) {
    const { before, after } = views(
      `WORK EXPERIENCE\nWarehouse Associate | Midstate Distribution | ${upload}\nResponsible for loading trucks`,
      `Warehouse Associate | Midstate Distribution | 8/2021 - Present\n- Load outbound trucks`
    );
    const jobs = before.groups.filter((g) => g.job);
    assert.equal(jobs.length, 1, upload);
    assert.equal(jobs[0].job!.changes, undefined, `${upload}: ${JSON.stringify(jobs[0].job)}`);
    assert.equal(after.state, "finished", `${upload}: ${JSON.stringify(after.openItems.map((i) => i.line))}`);
  }
});

test("M3: the probe-4 controls still hold (as given passes; a changed date or place is a card)", () => {
  const pass = [
    [`WORK EXPERIENCE\nWarehouse Associate | Midstate Distribution | Aug 2021 - Present\nResponsible for loading trucks`, `Warehouse Associate | Midstate Distribution | Aug 2021 - Present\n- Load outbound trucks`],
    [`WORK EXPERIENCE\nWarehouse Associate, Midstate Distribution, 8/2021 - Present\nResponsible for loading trucks`, `Warehouse Associate | Midstate Distribution | 8/2021 - Present\n- Load outbound trucks`],
    [`WORK EXPERIENCE\nMidstate Distribution, Springfield, IL\nWarehouse Associate, August 2021 to Present\nResponsible for loading trucks`, `Warehouse Associate | Midstate Distribution | Springfield, IL | August 2021 - Present\n- Load outbound trucks`],
  ];
  for (const [upload, body] of pass) assert.equal(views(upload, body).after.state, "finished", body);
  const caught: Array<[string, string, string]> = [
    [`WORK EXPERIENCE\nWarehouse Associate | Midstate Distribution | Aug 2021 - Present\nResponsible for loading trucks`, `Warehouse Associate | Midstate Distribution | Jun 2021 - Present\n- Load outbound trucks`, "Jun 2021"],
    [`WORK EXPERIENCE\nWarehouse Associate | Midstate Distribution | 8/2021 - Present\nResponsible for loading trucks`, `Warehouse Associate | Midstate Distribution | 8/2021 - Current\n- Load outbound trucks`, "Current"],
    [`WORK EXPERIENCE\nWarehouse Associate | Midstate Distribution | 8/2021 - Present\nResponsible for loading trucks`, `Warehouse Associate | Midstate Distribution | Springfield, IL | 8/2021 - Present\n- Load outbound trucks`, "Springfield"],
  ];
  for (const [upload, body, shown] of caught) {
    const { after } = views(upload, body);
    assert.equal(after.state, "draft", body);
    const g = after.groups.find((x) => x.job?.changes);
    assert.ok(g, body);
    // L3: shown as written on the page, case kept.
    assert.ok(g!.job!.changes!.includes(shown), `${body}: ${JSON.stringify(g!.job!.changes)}`);
  }
  // Probe 4: moved dates between two jobs and a neighbor's start month are still caught.
  const twoCooks = `WORK EXPERIENCE\nLine Cook | Corner Diner | 3/2018 - 7/2021\nResponsible for prep and grill\n\nLine Cook | Harbor Grill | 1/2015 - 2/2018\nResponsible for fryer`;
  for (const body of [
    `Line Cook | Corner Diner | 1/2015 - 7/2021\n- Prepped food and worked the grill\n\nLine Cook | Harbor Grill | 1/2015 - 2/2018\n- Ran the fryer`,
    `Line Cook | Corner Diner | 3/2018 - 2/2018\n- Prepped food\n\nLine Cook | Harbor Grill | 1/2015 - 7/2021\n- Ran the fryer`,
  ]) assert.equal(views(twoCooks, body).after.state, "draft", body);
  const listed = `WORK EXPERIENCE\nWarehouse Associate | Midstate Distribution | 8/2021 - Present\nLine Cook | Corner Diner | 3/2018 - 7/2021`;
  assert.equal(views(listed, `Warehouse Associate | Midstate Distribution | 3/2018 - Present\n- Load trucks\n\nLine Cook | Corner Diner | 3/2018 - 7/2021\n- Prep`).after.state, "draft");
});

test("L3: the changed-job card names the parts as the page spells them", () => {
  assert.deepEqual(jobHeaderChanges("Warehouse Associate | Midstate Distribution, Chicago IL | Jun 2021 - Present", "Warehouse Associate | Midstate Distribution | Aug 2021 - Present"), ["Chicago IL", "Jun 2021"]);
});

// ---- M1 and M2: source kind and fromWriter, on stored rows -------------------------------------------------

const own = { ownWords: "", ownResumeText: "UPLOAD TEXT", credentialsAnswer: "", credentialRows: [] as unknown[] };
const G = { verifierRan: true, verifierRanByDoc: { resume: true, cover_letter: true } };
function rev(n: number, source: string, text: string, ev: Record<string, unknown>): ArtifactRevision {
  return { id: `r${n}`, artifact_id: "a1", revision_number: n, source, doc_kind: "resume", length_choice: "auto", resume_text: text, letter_text: "", kept_terms: [], confirmed_credentials: [], defend_answers: [], evidence: ev, status: "draft" } as unknown as ArtifactRevision;
}
const TAILOR = "DANA\nWORK\nWarehouse Associate | Midstate | 2021 - Present\n- Forklift certified";
const W = "DANA\nWORK\nWarehouse Associate | Midstate | 2021 - Present\n- Load trucks";
const writerVersion = () =>
  rev(1, "forge_finish", W, {
    written: { resume: W, letter: "" },
    grounding: { ...G, rewordingA: true, sourceKind: "given" },
    writerVerified: true,
    runId: "run-1",
    ...own,
    writerReceipt: writerReceipt({ resume: W, letter: "" }, { ...G, rewordingA: true, sourceKind: "given" }, { userId: UID, runId: "run-1", source: own, nonce: "2".repeat(32), now: Date.now() }),
  });

test("M1: a raw 'Build with me' or restored raw version on top of an old writer build goes to 'Build it with t.ROY'", () => {
  const wv = writerVersion();
  const S = "DANA\n\nWORK HISTORY\nCook | Diner | 2019\n- Grill";
  const raw = rev(2, "forge_finish", S, { written: null, grounding: null, writerVerified: false, runId: "", ...own, givenAsIs: givenTextMark(S) });
  assert.equal(fromWriterNewest(raw), false, "the newest version decides");
  assert.equal(fromWriterNewest(wv), true);
  assert.deepEqual(laneHomeNext("resume", { status: "draft", artifactId: "a1", fromWriter: fromWriterNewest(raw) }), { label: "Build it with t.ROY", href: "/resume?rebuild=a1" });
  // Check-mode answers or a Refinery edit on a writer version carry its evidence: still the writer's.
  assert.equal(fromWriterNewest(rev(3, "refinery_edit", W.replace("Load trucks", "Load the trucks"), { ...(wv.evidence as Record<string, unknown>) })), true);
  // The route reads the newest version only (no full revision export for the lane home).
  const route = read("app/api/revisions/route.ts");
  assert.match(route, /fromWriter: fromWriterNewest\(rev\)/);
  assert.doesNotMatch(route.slice(route.indexOf("export async function GET")), /exportRevisions/);
});

test("M2: a legacy (pre-kind) check of a Tailor page is 'unknown', never rewording A; a legacy writer build stays eligible", () => {
  // Saved by an artifact check before round 3: verified, own words = the stored upload, no sourceKind.
  const legacy = rev(1, "refinery_edit", TAILOR, {
    written: { resume: TAILOR, letter: "" },
    grounding: G,
    writerVerified: true,
    runId: "artifact:a1",
    ...own,
    writerReceipt: writerReceipt({ resume: TAILOR, letter: "" }, G, { userId: UID, runId: "artifact:a1", source: own, nonce: "1".repeat(32), now: Date.now() }),
  });
  assert.equal(writtenByWriter(legacy), false);
  assert.equal(revisionKind(legacy), "unknown");
  // A legacy generate-docs build (no kind recorded, no page-only start): own words.
  const legacyBuild = rev(1, "forge_finish", W, {
    written: { resume: W, letter: "" },
    grounding: G,
    writerVerified: true,
    runId: "run-1",
    ...own,
    writerReceipt: writerReceipt({ resume: W, letter: "" }, G, { userId: UID, runId: "run-1", source: own, nonce: "3".repeat(32), now: Date.now() }),
  });
  assert.equal(revisionKind(legacyBuild), "own_words");
  // A legacy page-only rebuild (round 2 flag) is never eligible.
  const legacyPageOnly = rev(1, "forge_finish", W, { ...(legacyBuild.evidence as Record<string, unknown>), grounding: { ...G, startingPageOnly: true } });
  assert.notEqual(revisionKind(legacyPageOnly), "own_words");
  // Recorded kinds are read as recorded.
  assert.equal(revisionKind(writerVersion()), "own_words");
  assert.equal(revisionKind(rev(1, "forge_finish", W, { ...(legacyBuild.evidence as Record<string, unknown>), grounding: { ...G, sourceKind: "page_only" } })), "page_only");
});

// ---- L5 and L1 ----------------------------------------------------------------------------------------------

test("L5: Check it as it is never classifies a page from a base version whose text differs", () => {
  const src = read("lib/forge-recheck.ts");
  assert.match(src, /baseKind === "own_words" && base && base\.resume_text !== resume \? "unknown" : baseKind/);
});

test("L1: a rebuild's analysis gets the page as starting text only; its checks read the run's own text", () => {
  const proc = read("app/(forge)/processing/page.tsx");
  assert.match(proc, /resumeText: session\.resumeText,\s+startingText: rebuildActive\(session\) \? session\.originalResumeText : undefined,/);
  const route = read("app/api/analyze/route.ts");
  assert.match(route, /STARTING PAGE \(a saved page to rebuild from; it may not be in the person's own words/);
  // The trusted source the report's checks read never includes it.
  for (const block of route.split("buildTrustedSource({").slice(1)) assert.doesNotMatch(block.slice(0, 400), /startingText/);
});
