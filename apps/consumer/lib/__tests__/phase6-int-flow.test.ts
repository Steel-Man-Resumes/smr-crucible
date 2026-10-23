/**
 * Phase 6 integration round (S1's list from review-int-r1): H1, H3, L2, M2,
 * L1, L6. Fictional people and fake stores only. No AI, no database.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { applyRewrite, buildFinishView, cutLine, jobHeaderLines, optionalNumberPrompts, recordJobOk, recordScopeYes, type DefendAnswer, type FinishView } from "../finish-gate";
import { cleanRevisionInput, computeRevision, remapAnswers, revisionRecord } from "../revision-status";
import { fromWriterNewest, withRewording } from "../source-kind";
import { saveFirstSection } from "../lane-first-save";
import { saveCheckRevision } from "../revision-check";
import { recheckDocs } from "../forge-recheck";
import { writerSourceFrom, writerReceipt } from "../writer-receipt";
import { resumeTextToDocument } from "../revision-to-doc";
import { changesNotAwaitingCards, changesStillOnPage } from "../changes-gate";
import { countPromptForLine, NEUTRAL_COUNT_PROMPT } from "../count-prompts";
import { laneHomeNext } from "../../components/lanes/LaneHome";
import type { RevisionStore } from "../revision-save";
import { fakeRevisionStore } from "./fixtures/fake-revision-store";

const read = (p: string) => readFileSync(join(__dirname, "..", "..", p), "utf8");
const UID = "00000000-0000-4000-8000-0000000000a1";
const FORGE = "00000000-0000-4000-8000-0000000000fa";
const BASE = { verifierRan: true, verifierRanByDoc: { resume: true, cover_letter: true }, removed: 0, residual: 0, unmatched: 0, outcomes: [] };
const GA = withRewording(BASE, "given");

const UPLOAD = `PAT EXAMPLE
Libby, MT | pat@example.com

WORK EXPERIENCE
Machine Operator | Acme Mill | 2018 - Present
Responsible for 3rd shift.
Ran the planer.

Dishwasher | Riverside Cafe | 2015 - 2018
Washed dishes and cleaned the kitchen.`;

const WRITTEN = `PAT EXAMPLE
Libby, MT | pat@example.com

PROFESSIONAL EXPERIENCE
Machine Operator | Acme Mill | 2018 - Present
- Supervised the 3rd shift crew.
- Ran the planer.

Dishwasher | Riverside Cafe | 2015 - 2018
- Washed dishes and cleaned the kitchen.`;

const own = writerSourceFrom({ resumeText: UPLOAD });
function view(resumeText: string, answers: DefendAnswer[] = []): FinishView {
  return buildFinishView({ resumeText, ownWords: own.ownWords, ownResumeText: own.ownResumeText, defendAnswers: answers, written: { resume: WRITTEN, letter: "" }, grounding: GA });
}

let nonce = 0;
const verifyFake = async (p: { output: string }) => ({ text: p.output, hasFabrication: false, applied: false, flags: [], verifierRan: true });
const deps = (store: RevisionStore) => ({ verify: verifyFake as never, random: () => `n${++nonce}`.padEnd(32, "0"), store });

/** A writer draft saved from generate-docs (its receipt), with cards still open. */
async function writerDraft() {
  const f = fakeRevisionStore(UID, [{ id: FORGE, artifact_type: "resume", target_context: { source: "forge" }, content: resumeTextToDocument(WRITTEN) as never }], UPLOAD);
  const c = cleanRevisionInput(
    { resumeText: WRITTEN, coverLetterText: "", written: { resume: WRITTEN, letter: "" }, grounding: GA, runId: "run-1", ...own, defendAnswers: [], writerReceipt: writerReceipt({ resume: WRITTEN, letter: "" }, GA, { userId: UID, runId: "run-1", source: own, nonce: "0".repeat(32), now: Date.now() }) },
    { receipt: { userId: UID, runId: "run-1" } }
  );
  assert.ok(c.ok);
  await f.store.insertRevision(UID, revisionRecord(FORGE, "forge_finish", c.input, computeRevision(c.input)));
  return f;
}
const lane = async (f: Awaited<ReturnType<typeof writerDraft>>) => {
  const newest = await f.store.getLatestRevision(UID, FORGE);
  return laneHomeNext("resume", { status: newest!.status, artifactId: FORGE, fromWriter: fromWriterNewest(newest) });
};

// ---- H1 -------------------------------------------------------------------------------------------------------

test("H1: writer draft -> Check and finish (artifact check, then a save of answers) -> the lane home still says Check and finish", async () => {
  const f = await writerDraft();
  assert.deepEqual(await lane(f), { label: "Check and finish", href: `/output?check=${FORGE}&cards=1` });
  // The page's needs_check path: R1's artifact recheck saves the checked version.
  const rc = await recheckDocs({ kind: "artifact", artifactId: FORGE }, UID, deps(f.store));
  assert.ok(rc.ok, JSON.stringify(rc));
  const checked = await f.store.getLatestRevision(UID, FORGE);
  assert.match(String((checked!.evidence as { runId?: string }).runId), /^artifact:/);
  assert.equal((checked!.evidence as { writerOrigin?: boolean }).writerOrigin, true, "the server stamped the origin from its base version");
  assert.deepEqual(await lane(f), { label: "Check and finish", href: `/output?check=${FORGE}&cards=1` }, "never a rebuild that drops the answers");
  // Answers saved in check mode carry it too.
  let answers: DefendAnswer[] = [];
  for (const h of jobHeaderLines(WRITTEN)) answers = recordJobOk(answers, h);
  const saved = await saveCheckRevision(UID, FORGE, { resumeText: WRITTEN, coverLetterText: "", defendAnswers: answers }, f.store);
  assert.ok(saved.ok, JSON.stringify(saved));
  assert.equal((await lane(f)).label === "Build it with t.ROY", false);
  // A raw "Build with me" section saved on top is not the writer's.
  await saveFirstSection(UID, { text: "PAT EXAMPLE\n\nWORK HISTORY\nCook | Diner | 2019\n- Grill", typed: "", keep: "replace" }, f.store);
  assert.equal((await lane(f)).label, "Build it with t.ROY");
});

test("H1: the origin is the server's: a request never sets it, and a check of a raw page never gets it", async () => {
  const sent = cleanRevisionInput({ resumeText: WRITTEN, coverLetterText: "", writerOrigin: true, writerVerified: true });
  assert.ok(sent.ok && sent.input.evidence.writerOrigin === undefined);
  const f = fakeRevisionStore(UID, [], UPLOAD);
  await saveFirstSection(UID, { text: UPLOAD, typed: "", keep: undefined }, f.store);
  const id = f.revs.at(-1)!.artifact_id;
  f.arts.find((a) => a.id === id)!.content = resumeTextToDocument(UPLOAD) as never;
  await recheckDocs({ kind: "artifact", artifactId: id }, UID, deps(f.store));
  const newest = f.revs.at(-1)!;
  assert.equal((newest.evidence as { writerOrigin?: boolean }).writerOrigin, undefined);
  assert.equal(fromWriterNewest(newest), false);
});

// ---- H3 and L2 ------------------------------------------------------------------------------------------------

const CHANGES = [
  { old: "Responsible for 3rd shift.", new: "- Supervised the 3rd shift crew.", why: "Responsible for reads like a job posting.", rule: "duty_phrasing" },
  { old: "Washed dishes and cleaned the kitchen.", new: "- Washed dishes and cleaned the kitchen.", why: "x", rule: "duty_phrasing" },
  { old: "Ran the planer.", new: "- Ran the planer.", why: "x", rule: "heading" },
];

test("H3: a change whose new line waits on a card (the set-aside people claim) is never returned as a finished fix", () => {
  const v = view(WRITTEN);
  assert.ok(v.groups.some((g) => g.line === "- Supervised the 3rd shift crew." && g.scope), JSON.stringify(v.groups.map((g) => g.line)));
  const kept = changesNotAwaitingCards(CHANGES, v);
  assert.ok(!kept.some((c) => c.new === "- Supervised the 3rd shift crew."));
  assert.equal(kept.length, 2, "lines with only a job tap on their header are still shown");
  // The route filters with its own finish gate over the final documents, before returning them.
  const route = read("app/api/forge/generate-docs/route.ts");
  assert.match(route, /const changes = changesNotAwaitingCards\(validChanges, cardView\);/);
  assert.match(route, /written: \{ resume, letter: coverLetter \},\s+grounding,/);
  assert.ok(route.indexOf("const changes = changesNotAwaitingCards") < route.indexOf("changes,\n"), "filtered before the response");
});

test("L2: the recap shows only changes whose new line is still on the resume (after No, Take it off or Fix this)", () => {
  const after = cutLine(WRITTEN, "- Supervised the 3rd shift crew.");
  const recap = changesStillOnPage(CHANGES, after);
  assert.ok(!recap.some((c) => c.new === "- Supervised the 3rd shift crew."));
  assert.equal(changesStillOnPage(CHANGES, WRITTEN).length, 3);
  const page = read("app/(forge)/output/page.tsx");
  assert.match(page, /const recapChanges = useMemo\(\(\) => changesStillOnPage\(changes, resumeText\), \[changes, resumeText\]\);/);
  assert.match(page, /<ChangesList changes=\{recapChanges\}/);
});

// ---- M2 ------------------------------------------------------------------------------------------------------------

test("M2: in a rebuild the walk, the replay and the change check all use the page the writer started from; the panels read the server's own words", () => {
  const page = read("app/(forge)/output/page.tsx");
  assert.match(page, /const startingPage = rebuilding \? session\.originalResumeText \?\? "" : session\.resumeText \?\? "";/);
  assert.doesNotMatch(page, /buildResumeTour\(startingPage\)/); // Reading tour happens once, on processing.
  assert.match(page, /pageLines\(startingPage\)/);
  assert.match(page, /readChanges\(data\.changes, rebuildActive\(session\) \? session\.originalResumeText \?\? "" : session\.resumeText \?\? "", data\.resume \|\| ""\)/);
  // The processing tour walks the same page.
  assert.match(read("app/(forge)/processing/page.tsx"), /session\.originalResumeText \|\| session\.resumeText/);
  // The server checks `old` against the writer's starting text (the page, in a rebuild).
  assert.match(read("app/api/forge/generate-docs/route.ts"), /ownResumeText: withholdRecordLines\(input\.resumeText, keepSource\)\.kept,/);
  // Older panels: the server's own words when the page has them, never the starting page.
  assert.match(page, /const panelSource = runEvidence \? runEvidence\.ownResumeText : session\.resumeText;/);
  assert.doesNotMatch(page, /sourceText=\{session\.resumeText\}/);
  assert.doesNotMatch(page, /findDiscrepancies\(resumeText, \{ sourceText: session\.resumeText \}\)/);
  // Nothing in the walk, the replay or the recap calls those lines the person's words.
  for (const f of ["components/forge/markup/MarkupWalk.tsx", "components/forge/markup/LiveFix.tsx", "components/forge/markup/ChangesList.tsx"]) {
    assert.doesNotMatch(read(f), /your (?:own )?words/i, f);
  }
});

// ---- L1 ------------------------------------------------------------------------------------------------------------

test("L1: after Fix this on a header, or a Refinery edit of it, the people answer moves with the job (no second card)", () => {
  const v = view(WRITTEN);
  const g = v.groups.find((x) => x.scope?.overPeople);
  assert.ok(g, JSON.stringify(v.groups.map((x) => [x.line, x.scope])));
  let a = recordScopeYes([], g!.line, g!.scope!.families, g!.scope!.overPeople!.yes, g!.scope!.overPeople!.job);
  for (const h of jobHeaderLines(WRITTEN)) a = recordJobOk(a, h);
  assert.ok(!view(WRITTEN, a).groups.some((x) => x.scope), "settled before the edit");
  // Fix this on the header (the person retypes it).
  const header = "Machine Operator | Acme Mill | 2018 - Present";
  const r = applyRewrite(WRITTEN, a, header, "Machine Operator | Acme Mill | 2018 - present");
  assert.ok(r.changed);
  assert.ok(r.answers.some((x) => x.kind === "scope_yes" && x.job === "Machine Operator | Acme Mill | 2018 - present"));
  assert.ok(!view(r.text, r.answers).groups.some((x) => x.scope), "the people card does not come back");
  // A Refinery edit of the header (no rewrite record): remapAnswers follows the job.
  const edited = WRITTEN.replace(header, "Machine Operator | Acme Mill | 2018 - 2024");
  const remapped = remapAnswers(a, [edited]);
  assert.ok(remapped.some((x) => x.kind === "scope_yes" && x.job === "Machine Operator | Acme Mill | 2018 - 2024"), JSON.stringify(remapped));
});

// ---- L6 ------------------------------------------------------------------------------------------------------------

test("L6: the number prompt fits the job; unsure means a neutral 'how many'", () => {
  assert.equal(countPromptForLine("Washed dishes and cleaned the kitchen.", "Dishwasher"), NEUTRAL_COUNT_PROMPT);
  assert.equal(countPromptForLine("Washed dishes", "Dishwasher"), "dishes or racks you washed in a shift");
  assert.equal(countPromptForLine("Load outbound trucks", "Warehouse Associate"), "trucks loaded on a normal day");
  const prompts = optionalNumberPrompts(WRITTEN);
  const dish = prompts.find((p) => /Washed dishes/.test(p.line));
  assert.ok(dish);
  assert.doesNotMatch(dish!.count, /customers|tables/);
  for (const p of prompts) assert.doesNotMatch(p.count, /\d/);
});
