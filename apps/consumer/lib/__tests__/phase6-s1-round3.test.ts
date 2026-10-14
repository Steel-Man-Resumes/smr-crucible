/**
 * Phase 6 lane S1, round 3: regression tests for independent review r1
 * (H1, H2, M1 to M5, L1 to L4), with the reviewer's probes. Fictional people
 * and fake stores only. No AI, no database.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildFinishView, factsLockedFor, jobHeaderChanges, jobHeaderLines, recordJobOk, statusLine, type DefendAnswer, type FinishView } from "../finish-gate";
import { cleanRevisionInput, computeRevision, revisionRecord } from "../revision-status";
import { fromWriterNewest, revisionKind, rewordingAFor, withRewording, writtenByWriter } from "../source-kind";
import { loadRebuildSource, rebuildInputs } from "../rebuild-source";
import { saveFirstSection } from "../lane-first-save";
import { recheckDocs } from "../forge-recheck";
import { writerSourceFrom, writerReceipt } from "../writer-receipt";
import { resumeTextToDocument } from "../revision-to-doc";
import { laneHomeNext } from "../../components/lanes/LaneHome";
import type { ArtifactLite, RevisionStore } from "../revision-save";
import { fakeRevisionStore } from "./fixtures/fake-revision-store";

const read = (p: string) => readFileSync(join(__dirname, "..", "..", p), "utf8");
const UID = "00000000-0000-4000-8000-0000000000a1";
const TAILOR = "00000000-0000-4000-8000-0000000000bb";
const FORGE = "00000000-0000-4000-8000-0000000000fa";

// The reviewer's fixture (fictional).
const UPLOAD = `DANA REYES
Springfield, IL | 555-0142 | dana.reyes@example.com

WORK EXPERIENCE
Warehouse Associate | Midstate Distribution | 8/2021 - Present
Responsible for loading trucks
Responsible for inventory counts

Line Cook | Corner Diner | 3/2018 - 7/2021
Responsible for prep and grill

EDUCATION
Springfield High School, Diploma, 2017`;
const page = (body: string) => `DANA REYES
Springfield, IL | 555-0142 | dana.reyes@example.com

PROFESSIONAL EXPERIENCE
${body}

EDUCATION
Diploma | Springfield High School | 2017`;
const J2 = `Line Cook | Corner Diner | 3/2018 - 7/2021
- Prepped food and worked the grill`;
const BASE = { verifierRan: true, verifierRanByDoc: { resume: true, cover_letter: true }, removed: 0, residual: 0, unmatched: 0, outcomes: [] };
const A = withRewording(BASE, "given");
const STRICT = withRewording(BASE, "page_only");

function view(resumeText: string, grounding: unknown = A, answers: DefendAnswer[] = []): FinishView {
  return buildFinishView({ resumeText, ownWords: UPLOAD, defendAnswers: answers, written: { resume: resumeText, letter: "" }, grounding, ownResumeText: UPLOAD });
}
/** The page after a "Looks right" on every job that offers one. */
function afterTaps(resumeText: string, grounding: unknown = A): FinishView {
  let a: DefendAnswer[] = [];
  for (const h of jobHeaderLines(resumeText)) a = recordJobOk(a, h);
  return view(resumeText, grounding, a);
}

let nonce = 0;
const verifyFake = async (p: { output: string }) => ({ text: p.output, hasFabrication: false, applied: false, flags: [], verifierRan: true });
const deps = (store: RevisionStore) => ({ verify: verifyFake as never, random: () => `n${++nonce}`.padEnd(32, "0"), store });

// ---- H2: rewording A is opt-in --------------------------------------------------------------

test("H2: a grounding without the signed marker gets the strict rule; withRewording never keeps a handed-in marker", () => {
  const written = { resume: "x\ny", letter: "" };
  assert.equal(factsLockedFor(written, BASE), false, "verifier ran, but no marker: strict");
  assert.equal(factsLockedFor(written, { ...BASE, rechecked: true }), false, "the reviewer's probe");
  assert.equal(factsLockedFor(written, A), true);
  assert.equal(factsLockedFor(written, { ...A, verifierRan: false }), false);
  assert.deepEqual(["given", "own_words", "page_only", "unknown"].map((k) => rewordingAFor(k as never)), [true, true, false, false]);
  const carried = withRewording({ ...BASE, rewordingA: true, sourceKind: "given", startingPageOnly: false }, "page_only");
  assert.equal(carried.rewordingA, undefined);
  assert.equal(carried.sourceKind, "page_only");
  assert.equal(withRewording({ ...BASE, rewordingA: true }, "unknown").rewordingA, undefined);
});

test("H2: generate-docs stamps the kind it worked out (a Forge run is 'given', a rebuild the server's kind)", () => {
  const route = read("app/api/forge/generate-docs/route.ts");
  assert.match(route, /let sourceKind: SourceKind = "given";/);
  assert.match(route, /sourceKind = rb\.origin;/);
  assert.match(route, /const grounding = withRewording\(\{/);
  assert.doesNotMatch(route, /startingPageOnly/);
});

/** A Forge resume whose newest version is a build of run-1, stamped with `kind`. */
async function forgeBuild(kind: "given" | "page_only") {
  const text = page(`Warehouse Associate | Midstate Distribution | 8/2021 - Present\n- Load outbound trucks\n${J2}`);
  const f = fakeRevisionStore(UID, [{ id: FORGE, artifact_type: "resume", target_context: { source: "forge" }, content: resumeTextToDocument(text) as never }], UPLOAD);
  const own = writerSourceFrom({ resumeText: UPLOAD });
  const c = cleanRevisionInput(
    { resumeText: text, coverLetterText: "", written: { resume: text, letter: "" }, grounding: withRewording(BASE, kind), writerVerified: true, runId: "run-1", ...own, writerReceipt: writerReceipt({ resume: text, letter: "" }, withRewording(BASE, kind), { userId: UID, runId: "run-1", source: own, nonce: "0".repeat(32), now: Date.now() }) },
    { trusted: true }
  );
  assert.ok(c.ok);
  await f.store.insertRevision(UID, revisionRecord(FORGE, "forge_finish", c.input, computeRevision(c.input)));
  return { f, text };
}

test("H2, signer 2: signed-in Check it again takes the run's kind from the version the server holds", async () => {
  for (const [kind, marked] of [["given", true], ["page_only", false]] as const) {
    const { f, text } = await forgeBuild(kind);
    const r = await recheckDocs({ kind: "finish", documents: { resume: text, letter: "" }, runId: "run-1", source: { resumeText: text } }, UID, deps(f.store));
    assert.ok(r.ok, JSON.stringify(r));
    assert.equal(r.ok && r.grounding.rewordingA === true, marked, `${kind}: a page-only build stays strict after a re-check (review r1 H2 failure 1)`);
  }
  // A run the server holds nothing for: unknown, strict.
  const { f, text } = await forgeBuild("given");
  const none = await recheckDocs({ kind: "finish", documents: { resume: text, letter: "" }, runId: "run-other", source: {} }, UID, deps(f.store));
  assert.ok(none.ok && none.grounding.rewordingA === undefined && none.grounding.sourceKind === "unknown");
  // Signed out: the server holds nothing; never A, whatever the request says.
  const out = await recheckDocs({ kind: "finish", documents: { resume: text, letter: "" }, runId: "run-1", source: { resumeText: text }, grounding: { rewordingA: true } }, null, deps(f.store));
  assert.ok(out.ok && out.grounding.rewordingA === undefined);
});

const TAILOR_PAGE = page(`Warehouse Associate | Midstate Distribution | 8/2021 - Present
- Loaded inbound freight with the receiving team
${J2}

CERTIFICATIONS
Forklift Certification, current`);

test("H2, signer 3: Check it as it is on a Tailor page with no stored own words stays strict (review r1 failure 2)", async () => {
  const f = fakeRevisionStore(UID, [{ id: TAILOR, artifact_type: "resume", target_context: { source: "tailor" }, content: resumeTextToDocument(TAILOR_PAGE) as never }], UPLOAD);
  const r = await recheckDocs({ kind: "artifact", artifactId: TAILOR }, UID, deps(f.store));
  assert.ok(r.ok, JSON.stringify(r));
  assert.equal(r.ok && r.grounding.rewordingA, undefined);
  assert.equal(r.ok && r.grounding.sourceKind, "page_only");
  assert.equal(factsLockedFor(r.ok ? r.written : null, r.ok ? r.grounding : null), false);
});

test("H2, signer 3: Check it as it is on a page the person gave (marked) is eligible, through the same rule", async () => {
  const f = fakeRevisionStore(UID, [], UPLOAD);
  const saved = await saveFirstSection(UID, { text: UPLOAD, typed: "", keep: undefined }, f.store);
  assert.ok(saved.ok);
  const id = f.revs.at(-1)!.artifact_id;
  f.arts.find((a) => a.id === id)!.content = resumeTextToDocument(UPLOAD) as never;
  const r = await recheckDocs({ kind: "artifact", artifactId: id }, UID, deps(f.store));
  assert.ok(r.ok && r.grounding.rewordingA === true && r.grounding.sourceKind === "given", JSON.stringify(r.ok && r.grounding));
});

// ---- H1 + M4: the writer's drafts, said by the server ------------------------------------------

test("H1: the preview account's state (a raw first save later opened in check mode) shows 'Build it with t.ROY' again", async () => {
  // The raw save as it was before round 2 (no given mark), then the old check mode's artifact check on top.
  const f = fakeRevisionStore(UID, [], UPLOAD);
  await saveFirstSection(UID, { text: UPLOAD, typed: "", keep: undefined }, f.store);
  const raw = f.revs.at(-1)!;
  delete (raw.evidence as { givenAsIs?: string }).givenAsIs;
  f.arts.find((a) => a.id === raw.artifact_id)!.content = resumeTextToDocument(UPLOAD) as never;
  const rc = await recheckDocs({ kind: "artifact", artifactId: raw.artifact_id }, UID, deps(f.store));
  assert.ok(rc.ok);
  const lineage = f.revs.filter((r) => r.artifact_id === raw.artifact_id);
  assert.equal(lineage.length, 2);
  const checked = lineage.at(-1)!;
  assert.equal((checked.evidence as { writerVerified?: boolean }).writerVerified, true, "the check is verified...");
  assert.equal(writtenByWriter(checked), false, "...but it is an artifact check, not the writer");
  assert.equal(fromWriterNewest(lineage.at(-1)), false);
  // Whatever that check decided (here it passed: the page is her own upload), the writer never made it.
  for (const status of [checked.status, "draft", "finished"] as const) {
    assert.deepEqual(laneHomeNext("resume", { status, artifactId: raw.artifact_id, fromWriter: fromWriterNewest(lineage.at(-1)) }), {
      label: "Build it with t.ROY",
      href: `/resume?rebuild=${raw.artifact_id}`,
    });
  }
  assert.deepEqual(laneHomeNext("resume", { status: "finished", artifactId: "w", fromWriter: true }), { label: "Get your files in My resumes", href: "/dashboard/vault" });
  // A build the writer made is "from the writer", whatever is checked on top.
  const { f: g } = await forgeBuild("given");
  assert.equal(fromWriterNewest(g.revs.at(-1)), true);
  // The lane home reads the server's word for it.
  const route = read("app/api/revisions/route.ts");
  assert.match(route, /fromWriter: fromWriterNewest\(rev\)/);
  assert.match(read("components/lanes/LaneHome.tsx"), /fromWriter: r\.fromWriter === true/);
});

test("M4: check mode checks and saves nothing until the person picks; the choice screen reads a read-only route", () => {
  const p = read("app/(forge)/output/page.tsx");
  assert.match(p, /if \(!checkId \|\| !signedIn \|\| !checkAsIs \|\| checkLoaded\.current === checkId\) return;/);
  assert.match(p, /\}, \[checkId, signedIn, checkAsIs\]\);/);
  const choice = p.slice(p.indexOf("const [choicePage, setChoicePage]"), p.indexOf("// ---- the gate"));
  assert.match(choice, /fetch\(`\/api\/revisions\/rebuild\?artifactId=/);
  assert.doesNotMatch(choice, /method: "POST"|\/api\/forge\/recheck/);
  assert.doesNotMatch(read("app/api/revisions/rebuild/route.ts"), /export async function POST|insertRevision/);
});

test("H1 + M4: a marked first save stays 'given' after a check of the same text (the lineage keeps it)", async () => {
  const f = fakeRevisionStore(UID, [], UPLOAD);
  await saveFirstSection(UID, { text: UPLOAD, typed: "", keep: undefined }, f.store);
  const id = f.revs.at(-1)!.artifact_id;
  f.arts.find((a) => a.id === id)!.content = resumeTextToDocument(UPLOAD) as never;
  await recheckDocs({ kind: "artifact", artifactId: id }, UID, deps(f.store));
  const rb = await loadRebuildSource(UID, id, f.store);
  assert.equal(rb!.origin, "given");
});

// ---- M1: job headers the gate cannot read ---------------------------------------------------------

test("M1: under A, a comma, two-line or dash job header with a changed employer is never zero checks", () => {
  for (const [name, body] of [
    ["comma", `Warehouse Associate, Midstate Logistics Group, 8/2021 - Present\n- Load outbound trucks\n${J2}`],
    ["two-line", `Midstate Logistics Group, Springfield, IL\nWarehouse Associate, 8/2021 - Present\n- Load outbound trucks\n${J2}`],
    ["dash", `Warehouse Associate - Midstate Logistics Group - 8/2021 to Present\n- Load outbound trucks\n${J2}`],
  ] as const) {
    const v = afterTaps(page(body));
    assert.equal(v.state, "draft", name);
    assert.ok(v.openItems.some((i) => /Midstate Logistics Group/.test(i.line)), `${name}: ${JSON.stringify(v.openItems.map((i) => i.line))}`);
  }
  // A dash header in her own words with a moved month is asked too.
  const month = afterTaps(page(`Warehouse Associate - Midstate Distribution - 3/2021 to Present\n- Load outbound trucks\n${J2}`));
  assert.ok(month.openItems.some((i) => /3\/2021/.test(i.line)), JSON.stringify(month.openItems.map((i) => i.line)));
  // The pipe control still finishes on taps alone.
  assert.equal(afterTaps(page(`Warehouse Associate | Midstate Distribution | 8/2021 - Present\n- Load outbound trucks\n${J2}`)).state, "finished");
});

// ---- M2: "Looks right" settles only an unchanged header ------------------------------------------

test("M2: a changed month, a shortened employer or an added city is a fact card that a tap never settles", () => {
  for (const [name, header, changed] of [
    ["month 8/2021 -> 3/2021", "Warehouse Associate | Midstate Distribution | 3/2021 - Present", "3/2021"],
    ["month 8/2021 -> 1/2021", "Warehouse Associate | Midstate Distribution | 1/2021 - Present", "1/2021"],
    ["month dropped", "Warehouse Associate | Midstate Distribution | 2021 - Present", "2021"],
    ["employer shortened", "Warehouse Associate | Midstate | 8/2021 - Present", "midstate"],
    ["city added", "Warehouse Associate | Midstate Distribution, Chicago IL | 8/2021 - Present", "chicago il"],
    ["end date invented", "Warehouse Associate | Midstate Distribution | 8/2021 - 12/2021", "12/2021"],
  ] as const) {
    const text = page(`${header}\n- Load outbound trucks\n${J2}`);
    assert.ok(jobHeaderChanges(header, UPLOAD).map((c) => c.toLowerCase()).includes(changed), `${name}: ${jobHeaderChanges(header, UPLOAD)}`);
    const v = afterTaps(text);
    assert.equal(v.state, "draft", name);
    const g = v.groups.find((x) => x.line === header);
    // A fact card on that header (a changed-job card, or the number card when the month is a number she never gave).
    assert.ok(g && g.items.length && g.items.every((i) => i.kind !== "job_confirm"), `${name}: ${JSON.stringify(g?.items.map((i) => i.kind))}`);
    if (g!.job) {
      assert.ok(g!.job.changes?.length, `${name}: a changed-job card`);
      // Integration H4: a changed date gets the dates copy, naming the person's own dates for that job.
      if (/month|date/.test(name)) assert.match(g!.items[0].why, /^t\.ROY changed the dates for this job\. Your page says 8\/2021 - Present\./);
      else assert.match(g!.items[0].why, /t\.ROY changed this job\. Not on your page:/);
    }
  }
  // Unchanged: the tap card, with true copy.
  const same = view(page(`Warehouse Associate | Midstate Distribution | 8/2021 - Present\n- Load outbound trucks\n${J2}`));
  const g = same.groups.find((x) => x.job);
  assert.ok(g && !g.job!.changes);
  assert.match(g!.items[0].why, /^These are from your page\./);
  assert.equal(statusLine(same), "Check your two jobs, one tap each, and it's ready.");
  // The card shows no "Looks right" on a changed job.
  const ui = read("components/forge/finish/DefendPanel.tsx");
  assert.match(ui, /const changed = group\.items\.some\(\(item\) => item\.kind === "job_changed"\)/);
  assert.match(ui, /\{!changed && \(\s+<button onClick=\{\(\) => actions\.onJobOk\?\.\(group\)\}/);
  assert.doesNotMatch(read("lib/finish-gate.ts"), /come from your own page/);
});

// ---- M3: a rebuild never writes the stored upload ---------------------------------------------------

test("M3: a rebuild reads the stored upload with held-back lines kept, applies the person's choice, and never writes it", async () => {
  const withInside = `${UPLOAD}\n\nKitchen Worker | State Correctional Facility | 2015 - 2018\nCooked for 300 residents`;
  const f = fakeRevisionStore(UID, [{ id: TAILOR, artifact_type: "resume", target_context: { source: "tailor" }, content: {} }], withInside);
  const c = cleanRevisionInput({ resumeText: TAILOR_PAGE, coverLetterText: "" }, { trusted: true });
  assert.ok(c.ok);
  await f.store.insertRevision(UID, revisionRecord(TAILOR, "refinery_edit", c.input, computeRevision(c.input)));
  const rb = await loadRebuildSource(UID, TAILOR, f.store);
  assert.deepEqual(f.keeps, [true], "read with held-back lines kept");
  assert.match(rb!.ownResumeText, /State Correctional Facility/);
  const r = rebuildInputs({ resumeText: "ignored" }, rb!);
  assert.doesNotMatch(writerSourceFrom({ ...r.source, keepInsideLines: false }).ownResumeText, /Correctional/, "held back by default");
  assert.match(writerSourceFrom({ ...r.source, keepInsideLines: true }).ownResumeText, /Correctional/, "put back when they choose");
  // The browser never gets the own words, and the run's resume text is not written.
  assert.doesNotMatch(read("app/api/revisions/rebuild/route.ts"), /ownResumeText:/);
  const rp = read("app/(forge)/resume/page.tsx");
  const write = rp.slice(rp.indexOf("// A new build from that page"), rp.indexOf('router.replace("/processing")'));
  assert.doesNotMatch(write, /\bresumeText: /);
  // The "put it back" list comes from the page the writer read, as in a normal run.
  assert.match(read("app/api/forge/generate-docs/route.ts"), /withholdRecordLines\(input\.resumeText, input\.keepInsideLines === true\)/);
});

// ---- M5: "Rewrite it with t.ROY" rebuilds from this page ----------------------------------------------

test("M5: the writer starts from the page for every kind; own words stay the server's; page lines not in them are asked", async () => {
  const own = writerSourceFrom({ resumeText: UPLOAD });
  const f = fakeRevisionStore(UID, [{ id: TAILOR, artifact_type: "resume", target_context: { source: "tailor" }, content: {} }]);
  // Round 4 (review r2 M2): a version counts as own words only with the kind its signer recorded.
  const c = cleanRevisionInput({ resumeText: TAILOR_PAGE, coverLetterText: "", ...own, writerVerified: true, written: { resume: TAILOR_PAGE, letter: "" }, grounding: withRewording(BASE, "own_words") }, { trusted: true });
  assert.ok(c.ok);
  await f.store.insertRevision(UID, revisionRecord(TAILOR, "refinery_edit", c.input, computeRevision(c.input)));
  const rb = await loadRebuildSource(UID, TAILOR, f.store);
  assert.equal(rb!.origin, "own_words");
  const r = rebuildInputs({ resumeText: "x" }, rb!);
  assert.equal(r.writer.resumeText, TAILOR_PAGE, "tailoring carries over");
  assert.equal(r.source.resumeText, own.ownResumeText);
  // The writer keeps a tailored line she never said: under the server's kind it is still a card.
  const g = withRewording(BASE, rb!.origin);
  const v = buildFinishView({ resumeText: TAILOR_PAGE, ownWords: own.ownWords, ownResumeText: own.ownResumeText, defendAnswers: [], written: { resume: TAILOR_PAGE, letter: "" }, grounding: g });
  assert.ok(v.groups.some((x) => x.credentialName), "the AI credential");
  assert.ok(v.groups.some((x) => x.line === "- Loaded inbound freight with the receiving team") || v.openItems.length > 0);
  assert.match(read("app/(forge)/output/page.tsx"), /\{REWRITE_WITH_TROY_LABEL\}/);
});

// ---- L1 to L4 ----------------------------------------------------------------------------------------------

test("L1: the rebuild branch of generate-docs is same-origin JSON only", () => {
  const route = read("app/api/forge/generate-docs/route.ts");
  const branch = route.slice(route.indexOf("if (rebuildFrom !== undefined) {"), route.indexOf("const r = rebuildInputs(body, rb);"));
  assert.ok(branch.indexOf("isSameOriginJsonPost(request.headers)") < branch.indexOf("revisionCaller()"));
});

test("L2: the rebuild comment states the paste-trust model accurately", () => {
  const src = read("lib/rebuild-source.ts");
  assert.match(src, /still come from the\s+\* request, the same paste-trust model as every Forge run/);
  assert.doesNotMatch(src, /Nothing in a\s+\* request \(an origin, a flag, the page text\) changes it\./);
});

test("L3: a year in her words is never a count ('Loaded 2018 trucks in a year')", () => {
  for (const line of ["- Loaded 2018 trucks in a year", "- Loaded 2017 trucks"]) {
    const v = afterTaps(page(`Warehouse Associate | Midstate Distribution | 8/2021 - Present\n${line}\n${J2}`));
    assert.equal(v.state, "draft", line);
    assert.ok(v.openItems.some((i) => i.line === line), JSON.stringify(v.openItems.map((i) => i.line)));
  }
  // A year used as a date is not asked.
  assert.equal(afterTaps(page(`Warehouse Associate | Midstate Distribution | 8/2021 - Present\n- Loaded trucks since 2021\n${J2}`)).state, "finished");
});

test("L4: a rebuild's analysis reads the saved page as starting text (never as own words)", () => {
  // Round 4 (review r2 L1): as separate starting text; tested in phase6-s1-round4.
  assert.match(read("app/(forge)/processing/page.tsx"), /startingText: rebuildActive\(session\) \? session\.originalResumeText : undefined,/);
});

test("the probes' strict control: the same changed pages under the strict rule still ask", () => {
  const v = afterTaps(page(`Warehouse Associate, Midstate Logistics Group, 8/2021 - Present\n- Load outbound trucks\n${J2}`), STRICT);
  assert.equal(v.state, "draft");
});

void revisionKind;
void ({} as ArtifactLite);
