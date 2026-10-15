/**
 * Phase 6 integration round 2 (S1's list from review-int-r2): H1 forks, M1
 * same-job remap, M2 card terms in changes, L1 two-line job card, L2 walk
 * copy, L3 slash terms. Fictional people and fake stores only. No AI, no
 * database.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildFinishView, cutTerm, jobHeaderLines, recordJobOk, recordScopeYes, type DefendAnswer, type FinishView } from "../finish-gate";
import { cleanRevisionInput, computeRevision, pageOnlyGrounding, remapAnswers, revisionRecord, sameJobHeader } from "../revision-status";
import { fromWriterNewest, revisionKind, withRewording } from "../source-kind";
import { loadRebuildSource } from "../rebuild-source";
import { recheckDocs } from "../forge-recheck";
import { ensureExportRevision } from "../revision-current";
import { writerSourceFrom, writerReceipt } from "../writer-receipt";
import { resumeTextToDocument } from "../revision-to-doc";
import { changesNotAwaitingCards } from "../changes-gate";
import { draftNext } from "../../components/lanes/LaneHome";
import type { RevisionStore } from "../revision-save";
import { fakeRevisionStore } from "./fixtures/fake-revision-store";

const read = (p: string) => readFileSync(join(__dirname, "..", "..", p), "utf8");
const UID = "00000000-0000-4000-8000-0000000000a1";
const FORGE = "00000000-0000-4000-8000-0000000000fa";
const TAIL = "00000000-0000-4000-8000-0000000000fb";
const BASE = { verifierRan: true, verifierRanByDoc: { resume: true, cover_letter: true }, removed: 0, residual: 0, unmatched: 0, outcomes: [] };
const GA = withRewording(BASE, "given");

const UPLOAD = `PAT EXAMPLE
Libby, MT | pat@example.com

WORK EXPERIENCE
Machine Operator | Kootenai Wood Products | 2018 - Present
Responsible for 3rd shift.
Ran the planer.

Stocker | Corner Mart | 2015 - 2018
Stocked shelves.`;

const WRITTEN = `PAT EXAMPLE
Libby, MT | pat@example.com

PROFESSIONAL EXPERIENCE
Stocker | Corner Mart | 2015 - 2018
- Stocked shelves.

Machine Operator | Kootenai Wood Products | 2018 - Present
- Supervised the 3rd shift crew.
- Ran the planer.`;

const own = writerSourceFrom({ resumeText: UPLOAD });
const view = (resumeText: string, answers: DefendAnswer[] = [], written = WRITTEN): FinishView =>
  buildFinishView({ resumeText, ownWords: own.ownWords, ownResumeText: own.ownResumeText, defendAnswers: answers, written: { resume: written, letter: "" }, grounding: GA });

let nonce = 0;
const verifyFake = async (p: { output: string }) => ({ text: p.output, hasFabrication: false, applied: false, flags: [], verifierRan: true });
const deps = (store: RevisionStore) => ({ verify: verifyFake as never, random: () => `n${++nonce}`.padEnd(32, "0"), store });

// ---- H1: a fork never inherits the writer's eligibility -------------------------------------------------------

const TAILOR = WRITTEN.replace("- Ran the planer.", "- Ran the planer to keep a high-volume line moving.");

test("H1: writer draft -> Check and finish -> Tailor -> download: Rewrite choice, strict check as is, page_only rebuild", async () => {
  const f = fakeRevisionStore(UID, [{ id: FORGE, artifact_type: "resume", target_context: { source: "forge" }, content: resumeTextToDocument(WRITTEN) as never }], UPLOAD);
  const c = cleanRevisionInput(
    { resumeText: WRITTEN, coverLetterText: "", written: { resume: WRITTEN, letter: "" }, grounding: GA, runId: "run-1", ...own, defendAnswers: [], writerReceipt: writerReceipt({ resume: WRITTEN, letter: "" }, GA, { userId: UID, runId: "run-1", source: own, nonce: "0".repeat(32), now: Date.now() }) },
    { receipt: { userId: UID, runId: "run-1" } }
  );
  assert.ok(c.ok);
  await f.store.insertRevision(UID, revisionRecord(FORGE, "forge_finish", c.input, computeRevision(c.input)));
  // Check and finish on the writer draft: it keeps the writer's origin (integration r1 H1).
  assert.ok((await recheckDocs({ kind: "artifact", artifactId: FORGE }, UID, deps(f.store))).ok);
  assert.equal(fromWriterNewest(await f.store.getLatestRevision(UID, FORGE)), true);
  // The person tailors it, then downloads the Tailor: its first version is built on the parent's.
  f.arts.push({ id: TAIL, artifact_type: "resume", target_context: { source: "tailor", targetJob: "Machine Operator" }, content: resumeTextToDocument(TAILOR) as never, parent_artifact_id: FORGE });
  const ex = await ensureExportRevision(UID, TAIL, f.store);
  assert.ok(ex.ok, JSON.stringify(ex));
  const t = (await f.store.getLatestRevision(UID, TAIL))!;
  const ev = t.evidence as Record<string, unknown> & { grounding?: Record<string, unknown> };
  assert.equal(ev.writerOrigin, undefined, "never the parent's origin");
  assert.equal(ev.givenAsIs, undefined);
  assert.equal(ev.writerReceipt, "", "never the parent's receipt");
  assert.equal(ev.grounding?.sourceKind, "page_only");
  assert.equal(ev.grounding?.rewordingA, undefined);
  assert.equal(fromWriterNewest(t), false);
  assert.equal(revisionKind(t), "page_only");
  // The next step offers the writer (the vault opens the Rewrite / Check it as it is choice: no cards param).
  assert.deepEqual(draftNext({ artifactId: TAIL, fromWriter: fromWriterNewest(t) }), { label: "Build it with t.ROY", href: `/resume?rebuild=${TAIL}` });
  // Rebuild: page_only.
  assert.equal((await loadRebuildSource(UID, TAIL, f.store))!.origin, "page_only");
  // Check it as it is: strict.
  const rc = await recheckDocs({ kind: "artifact", artifactId: TAIL }, UID, deps(f.store));
  assert.ok(rc.ok, JSON.stringify(rc));
  assert.equal(rc.ok && rc.grounding.rewordingA, undefined);
  assert.equal(rc.ok && rc.grounding.sourceKind, "page_only");
  assert.equal(fromWriterNewest(await f.store.getLatestRevision(UID, TAIL)), false);
});

test("H1: a fork's page_only stamp is exactly the one every signer uses", () => {
  assert.deepEqual(pageOnlyGrounding({ ...GA, rechecked: true }), withRewording({ ...GA, rechecked: true }, "page_only"));
  assert.equal(pageOnlyGrounding(null), null);
});

// ---- M1: a job-keyed answer follows only the same job -------------------------------------------------------------

test("M1: a people Yes re-keys only to the same job; under another employer it is dropped and asked again", () => {
  const v = view(WRITTEN);
  const g = v.groups.find((x) => x.scope?.overPeople);
  assert.ok(g, JSON.stringify(v.groups.map((x) => x.line)));
  let a = recordScopeYes([], g!.line, g!.scope!.families, g!.scope!.overPeople!.yes, g!.scope!.overPeople!.job);
  for (const h of jobHeaderLines(WRITTEN)) a = recordJobOk(a, h);
  // A Refinery edit removes the Machine Operator header: the line now sits under Corner Mart.
  const moved = WRITTEN.replace("Machine Operator | Kootenai Wood Products | 2018 - Present\n", "");
  const remapped = remapAnswers(a, [moved]);
  const yes = remapped.find((x) => x.kind === "scope_yes");
  assert.ok(yes);
  assert.equal(yes!.job, undefined, "not re-keyed to a job the person never said they supervised at");
  assert.ok(view(moved, remapped, moved).groups.some((x) => x.line === "- Supervised the 3rd shift crew." && x.scope), "the card is asked again");
  // The same job with its dates fixed: re-keyed.
  const fixed = WRITTEN.replace("2018 - Present", "2018 - 2024");
  assert.equal(remapAnswers(a, [fixed]).find((x) => x.kind === "scope_yes")!.job, "Machine Operator | Kootenai Wood Products | 2018 - 2024");
  assert.equal(sameJobHeader("Machine Operator | Kootenai Wood Products | 2018 - Present", "MACHINE OPERATOR | Kootenai Wood Products Inc | 2018 - 2024"), true);
  assert.equal(sameJobHeader("Machine Operator | Kootenai Wood Products | 2018 - Present", "Stocker | Corner Mart | 2015 - 2018"), false);
});

// ---- M2: a term an open card asks about holds its change back -----------------------------------------------------

test("M2: a skills line carrying a term on the open D3 card is not played as t.ROY's fix", () => {
  const page = WRITTEN.replace("PROFESSIONAL EXPERIENCE", "CORE COMPETENCIES\nPlaner, Shelf stocking, Lockout/tagout\n\nPROFESSIONAL EXPERIENCE");
  const v = view(page, [], page);
  const skills = v.groups.find((x) => x.target === "skillset");
  assert.ok(skills && skills.terms?.some((t) => /lockout/i.test(t)), JSON.stringify(v.groups.map((x) => [x.line, x.terms])));
  const changes = [
    { old: "Hard worker", new: "Planer, Shelf stocking, Lockout/tagout", why: "x", rule: "soft_skill_list" },
    { old: "Stocked shelves.", new: "- Stocked shelves.", why: "x", rule: "duty_phrasing" },
  ];
  const kept = changesNotAwaitingCards(changes, v);
  assert.deepEqual(kept.map((c) => c.new), ["- Stocked shelves."]);
});

// ---- L1: a two-line header shows the whole job ---------------------------------------------------------------------

test("L1: a header the writer split over two lines shows title, employer and dates on the job card", () => {
  const twoLineUpload = `${UPLOAD.split("\n\nStocker")[0]}\n\nLine Cook | Harbor Grill | 2012 - 2015\nCooked on the line.`;
  const page = `PAT EXAMPLE\nLibby, MT | pat@example.com\n\nPROFESSIONAL EXPERIENCE\nLine Cook\nHarbor Grill, 2012 - 2015\n- Cooked on the line.`;
  const s = writerSourceFrom({ resumeText: twoLineUpload });
  const v = buildFinishView({ resumeText: page, ownWords: s.ownWords, ownResumeText: s.ownResumeText, defendAnswers: [], written: { resume: page, letter: "" }, grounding: GA });
  const g = v.groups.find((x) => x.job);
  assert.ok(g, JSON.stringify(v.groups.map((x) => [x.line, x.items.map((i) => i.kind)])));
  assert.equal(g!.job!.title, "Line Cook");
  assert.ok(g!.job!.rest.some((p) => /Harbor Grill/.test(p)), JSON.stringify(g!.job));
  assert.ok(g!.job!.rest.some((p) => /2012/.test(p) && /2015/.test(p)), JSON.stringify(g!.job));
});

// ---- L2 and L3 --------------------------------------------------------------------------------------------------------

test("L2: in a rebuild the no-marks walk line never says 'as you gave it'", () => {
  const walk = read("components/forge/markup/MarkupWalk.tsx");
  assert.match(walk, /startingPage\s+\? "Here's the page we're starting from\."/);
  assert.match(read("app/(forge)/output/page.tsx"), /<MarkupWalk tour=\{walkTour\} reduced=\{reduced\} startingPage=\{rebuilding\} \/>/);
});

test("L3: 'Take it off' cuts a slash term whole ('Lockout/tagout'); other terms still cut", () => {
  const t = `X\n\nCORE COMPETENCIES\nPlaner, Trim saw, Food prep, Lockout/tagout\n\nPROFESSIONAL EXPERIENCE\nA | B | 2019 - 2020\n- Ran it.`;
  assert.equal(cutTerm(t, "Lockout/tagout").split("\n")[3], "Planer, Trim saw, Food prep");
  assert.equal(cutTerm(t, "Trim saw").split("\n")[3], "Planer, Food prep, Lockout/tagout");
});
