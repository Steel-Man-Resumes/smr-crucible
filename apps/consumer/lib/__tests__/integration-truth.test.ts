/**
 * Phase 6 integration, truth seams (review int-r1: M4, H4, M3, H2, M1, L4, L5). Fictional people only.
 *
 * - M4: one shared job resolver (core jobResolver) reads what a job header is, its facts and which of the
 *   person's jobs it is, for the job card, people scope, the stricter reading and the renderer.
 * - H4: dates are one job's start/end pair; merged stints or a moved date are a dates card with true words,
 *   never a title card and never settled by a title tap.
 * - M3: places compare without punctuation ("Libby MT" is "Libby, MT").
 * - H2: a number on a people claim must count what the person's number counted, read on both sides.
 * - M1/L4: the supervision set-aside follows the run's signed rewording A marker, on generate-docs and on
 *   every recheck path; strict runs never set it aside.
 * - L5: the rulebook and the writer prompt agree on "responsible for" a shift.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildFinishView, jobHeaderLines, jobHeaderReview, recordJobOk, recordScopeYes, recordTitleYes, type DefendAnswer } from "../finish-gate";
import { writerSourceFrom, writerReceipt } from "../writer-receipt";
import { withRewording } from "../source-kind";
import { recheckDocs } from "../forge-recheck";
import { cleanRevisionInput, computeRevision, revisionRecord } from "../revision-status";
import { resumeTextToDocument } from "../revision-to-doc";
import { saveFirstSection } from "../lane-first-save";
import { fakeRevisionStore } from "./fixtures/fake-revision-store";
import type { RevisionStore } from "../revision-save";
import { onlySupervisionUnsupported } from "../fact-trace";
import { parseResume } from "../resume-render/model";
import { buildForgeResumePrompts } from "../forge-resume-prompt";
import { jobsIn, readJobHeader, resolvePageJob } from "@crucible/core/src/jobResolver";
import { numbersInContext, scopeAllNotTheirsAnswered } from "@crucible/core/src/resumeStatus";
import { scopeHitsNotTheirs } from "@crucible/core/src/scopeWords";
import { resumeRulesBlock } from "@crucible/core/src/resumeRules";

const read = (p: string) => readFileSync(join(__dirname, "..", "..", p), "utf8");
const G = withRewording({ verifierRan: true, verifierRanByDoc: { resume: true, cover_letter: true }, removed: 0, residual: 0, unmatched: 0, outcomes: [] }, "given");
const STRICT = withRewording({ verifierRan: true, verifierRanByDoc: { resume: true, cover_letter: true }, removed: 0, residual: 0, unmatched: 0, outcomes: [] }, "page_only");
function view(own: string, page: string, answers: DefendAnswer[] = [], grounding: unknown = G) {
  const s = writerSourceFrom({ resumeText: own });
  return buildFinishView({ resumeText: page, ownWords: s.ownWords, ownResumeText: s.ownResumeText, defendAnswers: answers, written: { resume: page, letter: "" }, grounding });
}

// ---- M4: one resolver ------------------------------------------------------------------------------

test("M4: the resolver reads comma, dash, at, two-line, credential-title and rehire headers", () => {
  const facts = (h: string) => {
    const j = readJobHeader(h);
    return [j.title, j.employer, j.place, j.dates];
  };
  assert.deepEqual(facts("Machine Operator, Acme Mill, Libby MT, 2018 - Present"), ["Machine Operator", "Acme Mill", "Libby MT", "2018 - Present"]);
  assert.deepEqual(facts("Line cook - Harbor Diner - 2019 - 2023"), ["Line cook", "Harbor Diner", "", "2019 - 2023"]);
  assert.deepEqual(facts("Cashier at Quick Stop (2014 - 2015)"), ["Cashier", "Quick Stop", "", "2014 - 2015"]);
  assert.deepEqual(facts("Certified Nursing Assistant, Valley Care (2018 - 2020)"), ["Certified Nursing Assistant", "Valley Care", "", "2018 - 2020"]);
  assert.deepEqual(facts("FORKLIFT DRIVER | Northgate Supply | Libby, MT | 8/2021 - 12/2022"), ["FORKLIFT DRIVER", "Northgate Supply", "Libby, MT", "8/2021 - 12/2022"]);
  const own = "PAT EXAMPLE\nLibby, MT | pat@example.com\n\nWork Experience\nSTOCKER\nCorner Mart, Libby MT\n2016 - 2018\nStocked shelves.\n\nEducation\nLibby High School | 2015";
  const jobs = jobsIn(own, { own: true });
  assert.deepEqual(jobs.map((j) => [j.title, j.employer, j.place, j.dates]), [["STOCKER", "Corner Mart", "Libby MT", "2016 - 2018"]]);
  // A rehire: the dates decide; merged dates match none.
  const rehire = "Machine Operator | Acme Mill | 2012 - 2014\nRan the press.\nMachine Operator | Acme Mill | 2019 - Present\nRan the press and the saw.";
  assert.equal(resolvePageJob("MACHINE OPERATOR | Acme Mill | 2019 - Present", rehire).kind, "one");
  assert.equal(resolvePageJob("Machine Operator | Acme Mill | 2012 - Present", rehire).kind, "several");
});

test("M4: the job card, people scope, the stricter reading and the renderer read the same jobs", () => {
  const own = "JO EXAMPLE\njo@example.com\n\nWork Experience\nCNA | Valley Care Center | 2019 - 2021\nResponsible for helping residents with meals.";
  const page = "JO EXAMPLE\njo@example.com\n\nPROFESSIONAL EXPERIENCE\nCNA\nValley Care Center, 2019 - 2021\n- Helped residents with meals.";
  // The renderer: a two-line header is a job.
  const m = parseResume(page);
  assert.deepEqual(m.blocks.filter((b) => b.kind === "job").map((b) => (b as { title: string }).title), ["CNA"]);
  // The job card: the same header, one tap.
  assert.deepEqual(jobHeaderLines(page), ["CNA"]);
  const v = view(own, page);
  const g = v.groups.find((x) => x.line === "CNA");
  assert.ok(g && g.items.some((i) => i.kind === "job_confirm"), JSON.stringify(v.groups.map((x) => [x.line, x.items.map((i) => i.kind)])));
  // Its lines are not given the stricter "describe this line" reading for an unread header.
  assert.ok(!v.status.defendLines.some((d) => /Valley Care Center, 2019/.test(d.line)));
  // A changed employer on a two-line or comma header is a fact card (the title rule does not read those).
  const changed = view(own, page.replace("Valley Care Center, 2019 - 2021", "Valley Care Home, 2019 - 2021"));
  assert.ok(changed.groups.some((x) => x.line === "CNA" && x.items.some((i) => i.kind === "job_changed")));
  // People scope reads its words for that job through the same resolver.
  assert.equal(resolvePageJob("CNA | Valley Care Center, 2019 - 2021", own).kind, "one");
});

test("integration M4: a comma header with a changed employer is a job card, not zero checks", () => {
  const own = "LEE EXAMPLE\nlee@example.com\n\nWork Experience\nLine Cook | Lakeside Grill | 2019 - 2023\nCooked on the line.";
  const page = "LEE EXAMPLE\nlee@example.com\n\nPROFESSIONAL EXPERIENCE\nLine Cook, Harbor Grill Group, 2019 - 2023\n- Cooked on the line.";
  const v = view(own, page);
  assert.ok(v.groups.some((x) => x.line.startsWith("Line Cook, Harbor Grill Group") && x.items.some((i) => i.kind === "job_changed")), JSON.stringify(v.groups.map((x) => [x.line, x.items.map((i) => i.kind)])));
});

// ---- H4: dates are a pair ---------------------------------------------------------------------------

test("H4: merged stints are a dates card with true words; a title tap never settles it", () => {
  const own = "LEE EXAMPLE\nlee@example.com\n\nWork Experience\nMachine Operator | Acme Mill | 2012 - 2014\nRan the press.\n\nMachine Operator | Acme Mill | 2019 - Present\nRan the press and the saw.";
  const page = "LEE EXAMPLE\nlee@example.com\n\nPROFESSIONAL EXPERIENCE\nMachine Operator | Acme Mill | 2012 - Present\n- Ran the press and the saw.";
  for (const g of [G, STRICT]) {
    const v = view(own, page, [], g);
    const card = v.groups.find((x) => x.line === "Machine Operator | Acme Mill | 2012 - Present")!;
    assert.deepEqual(card.items.map((i) => i.kind), ["job_changed"]);
    assert.equal(card.items[0].why, "t.ROY changed the dates for this job. Your page says 2012 - 2014 and 2019 - Present.");
    assert.doesNotMatch(card.items[0].why, /isn't a title/);
    const tapped = view(own, page, recordJobOk(recordTitleYes([], card.line, "Machine Operator"), card.line), g);
    assert.equal(tapped.state, "draft");
    // Retyping the header to the person's own dates settles it.
    const fixed = page.replace("Machine Operator | Acme Mill | 2012 - Present", "Machine Operator | Acme Mill | 2019 - Present");
    assert.ok(!view(own, fixed, [], g).groups.some((x) => x.items.some((i) => i.kind === "job_changed")));
  }
  // Two jobs at one employer merged into one range.
  const two = "LEE EXAMPLE\nlee@example.com\n\nWork Experience\nCook | Harbor Grill | 2016 - 2018\nCooked on the line.\n\nLead Cook | Harbor Grill | 2018 - 2021\nRan the line on weekends.";
  const merged = "LEE EXAMPLE\nlee@example.com\n\nPROFESSIONAL EXPERIENCE\nCook | Harbor Grill | 2016 - 2021\n- Cooked on the line.\n\nLead Cook | Harbor Grill | 2018 - 2021\n- Ran the line on weekends.";
  const card = view(two, merged).groups.find((x) => x.line === "Cook | Harbor Grill | 2016 - 2021")!;
  assert.equal(card.items[0].why, "t.ROY changed the dates for this job. Your page says 2016 - 2018.");
  // A moved start month is the dates card too.
  const r = jobHeaderReview("Warehouse Associate | Midstate Distribution | 3/2021 - Present", "Warehouse Associate | Midstate Distribution | 8/2021 - Present");
  assert.deepEqual(r, { changes: ["3/2021"], dates: ["8/2021 - Present"] });
});

// ---- M3: places ------------------------------------------------------------------------------------

test("M3: 'Libby MT' and 'Libby, MT' are one place; no false changed-job card", () => {
  const page = "PAT EXAMPLE\nLibby, MT | pat@example.com\n\nPROFESSIONAL EXPERIENCE\nSTOCKER | Corner Mart | Libby, MT | 2016 - 2018\n- Stocked shelves.\n\nEDUCATION\nLibby High School | 2015";
  for (const own of [
    "PAT EXAMPLE\nLibby, MT | pat@example.com\n\nWork Experience\nSTOCKER\nCorner Mart, Libby MT\n2016 - 2018\nStocked shelves.\n\nEducation\nLibby High School | 2015",
    "PAT EXAMPLE\nLibby, MT | pat@example.com\n\nWork Experience\nStocker, Corner Mart, Libby MT, 2016-2018\nStocked shelves.\n\nEducation\nLibby High School | 2015",
  ]) {
    const v = view(own, page);
    const g = v.groups.find((x) => x.line.startsWith("STOCKER"));
    assert.ok(g && g.items.every((i) => i.kind === "job_confirm"), JSON.stringify(g?.items.map((i) => [i.kind, i.why])));
    assert.equal(view(own, page, recordJobOk([], g!.line)).state, "finished");
  }
  // A real place change is still a card, spelled as on the page.
  const other = "PAT EXAMPLE\npat@example.com\n\nWork Experience\nStocker | Corner Mart | Troy, MT | 2016 - 2018\nStocked shelves.";
  assert.deepEqual(jobHeaderReview("STOCKER | Corner Mart | Libby, MT | 2016 - 2018", other).changes, ["Libby, MT"]);
});

// ---- H2: numbers on people claims --------------------------------------------------------------------

test("H2: a number on a people claim must count what the person counted, read on both sides", () => {
  const src = "Machine Operator | Acme Mill | 2018 - Present\nResponsible for 3rd shift.\nRan 3 presses.";
  for (const line of ["- Supervised a crew of 3.", "- Supervised the 3rd shift crew of 3.", "- Supervised 3 operators on 3rd shift.", "- Supervised a crew of 3 on nights."]) {
    assert.equal(numbersInContext(line, src), false, line);
    assert.equal(onlySupervisionUnsupported(line.replace(/^- /, ""), src), false, `set-aside: ${line}`);
  }
  assert.equal(numbersInContext("- Ran 3 presses on 3rd shift.", src), true);
  const crew = "Machine Operator | Acme Mill | 2018 - Present\nI ran a crew of 3 on nights.";
  assert.equal(numbersInContext("- Led a crew of 3 on nights.", crew), true);
  assert.equal(numbersInContext("- Led 3 crew members.", crew), true);
  // The whole page: a moved number on a supervision line is still open after Looks right and Yes.
  const own = "SAM EXAMPLE\nsam@example.com\n\nWork Experience\nMachine Operator | Acme Mill | 2018 - Present\nResponsible for 3rd shift.\nRan 3 presses.";
  const page = "SAM EXAMPLE\nsam@example.com\n\nPROFESSIONAL EXPERIENCE\nMachine Operator | Acme Mill | 2018 - Present\n- Supervised a crew of 3.\n- Ran 3 presses.";
  const v0 = view(own, page);
  const sc = v0.groups.find((x) => x.scope?.overPeople)!;
  assert.ok(sc, JSON.stringify(v0.groups.map((x) => x.line)));
  let a = recordScopeYes([], sc.line, sc.scope!.families, sc.scope!.overPeople!.yes, sc.scope!.overPeople!.job);
  a = recordJobOk(a, "Machine Operator | Acme Mill | 2018 - Present");
  const v1 = view(own, page, a);
  assert.equal(v1.state, "draft", JSON.stringify(v1.openItems.map((i) => [i.kind, i.line])));
  assert.ok(v1.openItems.some((i) => i.line === "- Supervised a crew of 3."));
});

// ---- M1 / L4: the set-aside follows the signed marker --------------------------------------------------

const UPLOAD = "SAM EXAMPLE\nsam@example.com\n\nWORK EXPERIENCE\nMachine Operator | Acme Mill | 4/2019 - Present\nResponsible for 3rd shift.";
const PAGE = "SAM EXAMPLE\nsam@example.com\n\nPROFESSIONAL EXPERIENCE\nMachine Operator | Acme Mill | 4/2019 - Present\n- Supervised the 3rd shift crew.";
const UID = "00000000-0000-4000-8000-0000000000c1";
const FORGE = "00000000-0000-4000-8000-0000000000c2";
let nonce = 0;
function depsRecording(store: RevisionStore, seen: Array<boolean | undefined>) {
  const verify = async (p: { output: string; askSupervision?: boolean }) => {
    seen.push(p.askSupervision);
    return { text: p.output, hasFabrication: false, applied: false, flags: [], verifierRan: true };
  };
  return { verify: verify as never, random: () => `m${++nonce}`.padEnd(32, "0"), store };
}
async function forgeBuild(kind: "given" | "page_only") {
  const f = fakeRevisionStore(UID, [{ id: FORGE, artifact_type: "resume", target_context: { source: "forge" }, content: resumeTextToDocument(PAGE) as never }], UPLOAD);
  const own = writerSourceFrom({ resumeText: UPLOAD });
  const g = withRewording({ verifierRan: true, verifierRanByDoc: { resume: true, cover_letter: true }, outcomes: [] }, kind);
  const c = cleanRevisionInput(
    { resumeText: PAGE, coverLetterText: "", written: { resume: PAGE, letter: "" }, grounding: g, writerVerified: true, runId: "run-1", ...own, writerReceipt: writerReceipt({ resume: PAGE, letter: "" }, g, { userId: UID, runId: "run-1", source: own, nonce: "0".repeat(32), now: Date.now() }) },
    { trusted: true }
  );
  assert.ok(c.ok);
  await f.store.insertRevision(UID, revisionRecord(FORGE, "forge_finish", c.input, computeRevision(c.input)));
  return f;
}

test("M1/L4: signed-in Check it again sets supervision aside exactly when the run is marked rewording A", async () => {
  for (const [kind, want] of [["given", true], ["page_only", false]] as const) {
    const f = await forgeBuild(kind);
    const seen: Array<boolean | undefined> = [];
    const r = await recheckDocs({ kind: "finish", documents: { resume: PAGE, letter: "" }, runId: "run-1", source: { resumeText: PAGE } }, UID, depsRecording(f.store, seen));
    assert.ok(r.ok);
    assert.deepEqual(seen, [want, want], kind);
    assert.equal(r.ok && r.grounding.rewordingA === true, want);
  }
  // Signed out: never (the server holds nothing to mark).
  const f = await forgeBuild("given");
  const seen: Array<boolean | undefined> = [];
  await recheckDocs({ kind: "finish", documents: { resume: PAGE, letter: "" }, runId: "run-1", source: { resumeText: PAGE }, grounding: { rewordingA: true } }, null, depsRecording(f.store, seen));
  assert.deepEqual(seen, [false, false]);
});

test("M1/L4: the artifact recheck (Check and finish, check as it is) follows the same marker", async () => {
  // A page the person gave (marked "given"): on.
  const f = fakeRevisionStore(UID, [], UPLOAD);
  const saved = await saveFirstSection(UID, { text: UPLOAD, typed: "", keep: undefined }, f.store);
  assert.ok(saved.ok);
  const id = f.revs.at(-1)!.artifact_id;
  f.arts.find((x) => x.id === id)!.content = resumeTextToDocument(UPLOAD) as never;
  const seen: Array<boolean | undefined> = [];
  const r = await recheckDocs({ kind: "artifact", artifactId: id }, UID, depsRecording(f.store, seen));
  assert.ok(r.ok && r.grounding.rewordingA === true);
  assert.deepEqual(seen, [true, true]);
  // A Tailor page with no own words (page only): off.
  const T = "00000000-0000-4000-8000-0000000000c3";
  const t = fakeRevisionStore(UID, [{ id: T, artifact_type: "resume", target_context: { source: "tailor" }, content: resumeTextToDocument(PAGE) as never }], UPLOAD);
  const seen2: Array<boolean | undefined> = [];
  const r2 = await recheckDocs({ kind: "artifact", artifactId: T }, UID, depsRecording(t.store, seen2));
  assert.ok(r2.ok && r2.grounding.rewordingA === undefined);
  assert.deepEqual(seen2, [false, false]);
});

test("M1: after a marked recheck, the writer draft's supervision line is the one-tap card, settled by Yes", () => {
  const v = view(UPLOAD, PAGE);
  const sc = v.groups.find((x) => x.scope?.overPeople)!;
  assert.ok(sc);
  assert.ok(!v.groups.some((x) => x.items.some((i) => (i as { trace?: boolean }).trace)), "a grounding with the flag set aside carries no claim-trace item for the line");
  let a = recordScopeYes([], sc.line, sc.scope!.families, sc.scope!.overPeople!.yes, sc.scope!.overPeople!.job);
  a = recordJobOk(a, "Machine Operator | Acme Mill | 4/2019 - Present");
  assert.equal(view(UPLOAD, PAGE, a).state, "finished");
  assert.ok(scopeAllNotTheirsAnswered(sc.line, UPLOAD, a, { job: "Machine Operator | Acme Mill | 4/2019 - Present" }).length === 0);
});

test("L4: generate-docs sets supervision aside only for a marked run (rewordingAFor(sourceKind))", () => {
  const route = read("app/api/forge/generate-docs/route.ts");
  assert.equal((route.match(/askSupervision: rewordingAFor\(sourceKind\)/g) ?? []).length, 2);
  assert.match(route, /const grounding = withRewording\(\{[\s\S]*\}, sourceKind\)/);
});

// ---- L5: one rule for "responsible for" a shift ---------------------------------------------------

test("L5: the rulebook and the writer prompt agree on 'responsible for' a shift", () => {
  const truth = resumeRulesBlock("truth");
  const { system } = buildForgeResumePrompts({ narrative: { headline: "x" }, resumeText: UPLOAD });
  for (const text of [truth, system]) {
    assert.match(text, /"Responsible for" a shift or an area is not a people claim by itself/);
    assert.match(text, /Production Supervisor/);
    assert.doesNotMatch(text, /a shift, area, task or thing is never supervising people/);
  }
  // And the checks agree: no people words, so it is asked.
  assert.ok(scopeHitsNotTheirs("Supervised the 3rd shift crew.", "Responsible for 3rd shift.").length > 0);
});
