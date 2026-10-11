/**
 * Phase 6 lane S1, round 2 (CC's truth ruling 2026-10-11): a rebuild from a
 * saved resume never lets AI-written lines count as the person's own words.
 * What counts is decided on the server, where the revision is read as the
 * person, from stored data the server wrote (lib/rebuild-source.ts). Nothing
 * a request sends (an origin, a flag, the page text) changes it.
 *
 * Fictional people and fake stores only. No AI, no database.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildFinishView, factsLockedFor, jobHeaderLines, recordJobOk, type DefendAnswer } from "../finish-gate";
import { cleanRevisionInput, computeRevision, editInput, givenTextMark, inputFromRevision, revisionRecord } from "../revision-status";
import { loadRebuildSource, rebuildInputs, type RebuildSource } from "../rebuild-source";
import { saveFirstSection } from "../lane-first-save";
import { writerSourceFrom } from "../writer-receipt";
import { rebuildActive } from "../lane-task";
import { withRewording } from "../source-kind";
import type { ArtifactLite } from "../revision-save";
import { finishState, FIXTURE_CTX } from "./fixtures/revision-run";
import { fakeRevisionStore } from "./fixtures/fake-revision-store";

const read = (p: string) => readFileSync(join(__dirname, "..", "..", p), "utf8");
const UID = "00000000-0000-4000-8000-0000000000a1";
const TAILOR = "00000000-0000-4000-8000-0000000000bb";

// The person's own upload (no credential anywhere in it).
const UPLOAD = `CASEY SAMPLE
Dayton, OH | casey@example.com

WORK EXPERIENCE
Stocker | Valley Foods | 2020 - 2023
Stocked shelves and unloaded the truck
Kept the back room clean`;

// A Tailor result: AI-written, with a credential line the person never gave.
const TAILOR_PAGE = `CASEY SAMPLE
Dayton, OH | casey@example.com

PROFESSIONAL EXPERIENCE
Stocker | Valley Foods | 2020 - 2023
- Stocked shelves and unloaded inbound freight trucks
- Kept the back room organized and clean

CERTIFICATIONS
Forklift Certification, current`;

const GROUNDING = { verifierRan: true, verifierRanByDoc: { resume: true, cover_letter: true }, removed: 0, residual: 0, unmatched: 0, outcomes: [] };

function fakeStore(initial: ArtifactLite[] = [], serverText?: string) {
  return fakeRevisionStore(UID, initial, serverText);
}

const tailorArtifact = (): ArtifactLite => ({ id: TAILOR, artifact_type: "resume", target_context: { source: "tailor", targetJob: "Stocker" }, content: {} });

/** Store a Tailor revision of TAILOR_PAGE carrying `evidence` (as a stored row would). */
async function tailorWith(evidence: Record<string, unknown>, source: "refinery_edit" | "forge_finish" = "refinery_edit", serverText?: string) {
  const f = fakeStore([tailorArtifact()], serverText);
  const c = cleanRevisionInput({ resumeText: TAILOR_PAGE, coverLetterText: "", ...evidence }, { trusted: true });
  assert.ok(c.ok);
  await f.store.insertRevision(UID, revisionRecord(TAILOR, source, c.input, computeRevision(c.input)));
  return f;
}

/** What the writer and the gate would see for this rebuild, given what the writer wrote. */
function build(rb: RebuildSource, request: Record<string, unknown>, written: string, grounding: Record<string, unknown>) {
  const r = rebuildInputs({ ...request }, rb);
  const source = writerSourceFrom({ ...r.source, goalNarrative: "I want steady work." });
  // Round 3: the grounding is stamped the way generate-docs stamps it, from the server's kind.
  const g = withRewording(grounding, rb.origin);
  const view = (answers: DefendAnswer[] = []) =>
    buildFinishView({ resumeText: written, ownWords: source.ownWords, ownResumeText: source.ownResumeText, defendAnswers: answers, written: { resume: written, letter: "" }, grounding: g });
  return { r, source, grounding: g, view };
}

// ---- a Tailor-origin page with an AI-added credential ------------------------------------------

test("Tailor page with no stored own words: page only; the AI credential is NOT theirs (D4 card), and the strict rule holds", async () => {
  const f = await tailorWith({});
  const rb = await loadRebuildSource(UID, TAILOR, f.store);
  assert.ok(rb);
  assert.equal(rb!.origin, "page_only");
  assert.equal(rb!.ownResumeText, "");
  assert.equal(rb!.pageText, TAILOR_PAGE, "the page may be shown");
  // The writer starts from the page; nothing on it counts as their words. Worst case: it keeps the credential line.
  const b = build(rb!, { resumeText: TAILOR_PAGE }, TAILOR_PAGE, GROUNDING);
  assert.equal(b.r.writer.resumeText, TAILOR_PAGE, "the page is the writer's starting point");
  assert.equal(b.source.ownResumeText, "", "the receipt and the gate get no page text as own words");
  assert.ok(!b.source.ownWords.includes("Forklift"));
  const v = b.view();
  assert.ok(v.groups.some((g) => g.credentialName && /Forklift/i.test(g.credentialName)), JSON.stringify(v.groups.map((g) => [g.line, g.credentialName])));
  assert.equal(factsLockedFor({ resume: TAILOR_PAGE, letter: "" }, b.grounding), false, "lines are confirmed the stricter way");
  assert.ok(!v.groups.some((g) => g.job), "no one-tap job confirms on a page that is not theirs");
  // The server, with the writer's receipt over exactly that source, agrees.
  const st = finishState({ resumeText: TAILOR_PAGE, coverLetterText: "", written: { resume: TAILOR_PAGE, letter: "" }, grounding: b.grounding, ownWords: b.source.ownWords, ownResumeText: b.source.ownResumeText, defendAnswers: [], keptTerms: [] });
  const c = cleanRevisionInput(st, { receipt: FIXTURE_CTX });
  assert.ok(c.ok);
  assert.equal(c.input.evidence.writerVerified, true);
  const verdict = computeRevision(c.input);
  assert.equal(verdict.status, "draft");
  assert.ok(verdict.openItems.some((i) => /Forklift/.test(i)), verdict.openItems.join(" | "));
});

test("Tailor page with the person's stored own words: those are the source; the page is only shown", async () => {
  const own = writerSourceFrom({ resumeText: UPLOAD });
  const f = await tailorWith({ ownWords: own.ownWords, ownResumeText: own.ownResumeText, writerVerified: true });
  const rb = await loadRebuildSource(UID, TAILOR, f.store);
  assert.equal(rb!.origin, "own_words");
  assert.equal(rb!.ownResumeText, own.ownResumeText);
  const b = build(rb!, { resumeText: TAILOR_PAGE }, TAILOR_PAGE, GROUNDING);
  // Round 3 (review r1 M5): the writer starts from the page; own words stay the stored ones.
  assert.equal(b.r.writer.resumeText, TAILOR_PAGE);
  assert.equal(b.source.ownResumeText, own.ownResumeText);
  assert.ok(!b.source.ownWords.includes("Forklift"));
  // A writer that put the credential back is asked about it.
  assert.ok(b.view().groups.some((g) => g.credentialName && /Forklift/i.test(g.credentialName)));
});

test("round 2b: page only, with a stored upload: the upload is their words, the page never is", async () => {
  const f = await tailorWith({}, "refinery_edit", UPLOAD);
  const rb = await loadRebuildSource(UID, TAILOR, f.store);
  assert.equal(rb!.origin, "page_only");
  assert.equal(rb!.ownResumeText, writerSourceFrom({ resumeText: UPLOAD }).ownResumeText, "the account's stored upload");
  const written = `CASEY SAMPLE
Dayton, OH | casey@example.com

PROFESSIONAL EXPERIENCE
Stocker | Valley Foods | 2020 - 2023
- Stocked shelves and unloaded the truck
- Kept the back room clean
- Moved inbound freight with the warehouse team

CERTIFICATIONS
Forklift Certification, current`;
  const b = build(rb!, { resumeText: TAILOR_PAGE }, written, GROUNDING);
  assert.equal(b.r.writer.resumeText, TAILOR_PAGE, "the page is still only the starting point");
  assert.ok(!b.source.ownWords.includes("Forklift"));
  assert.equal(factsLockedFor({ resume: written, letter: "" }, b.grounding), false, "still the stricter rule");
  const v = b.view();
  // The AI credential is still asked.
  assert.ok(v.groups.some((g) => g.credentialName && /Forklift/i.test(g.credentialName)), JSON.stringify(v.groups.map((g) => g.line)));
  // Lines that match her upload are not; her title, employer and years are hers.
  for (const line of ["- Stocked shelves and unloaded the truck", "- Kept the back room clean", "Stocker | Valley Foods | 2020 - 2023"]) {
    assert.ok(!v.groups.some((g) => g.line === line), line);
  }
  assert.ok(!v.openItems.some((i) => i.rule === "STD-T05" || i.kind === "title_unsaid"));
  // Fewer cards than with no stored upload at all.
  const none = build((await loadRebuildSource(UID, TAILOR, (await tailorWith({})).store))!, { resumeText: TAILOR_PAGE }, written, GROUNDING).view();
  assert.ok(v.groups.length < none.groups.length, `${v.groups.length} vs ${none.groups.length}`);
});

// ---- a raw "I have one" save ---------------------------------------------------------------------

const RAW = `CASEY SAMPLE
Dayton, OH | casey@example.com

WORK EXPERIENCE
Stocker | Valley Foods | 2020 - 2023
Stocked shelves and unloaded the truck
Kept the back room clean

CERTIFICATIONS
Forklift card, 2021`;

test("raw 'I have one' save: the server marked it, so its lines are theirs on the rebuild", async () => {
  // The account also holds some other upload: the marked page wins, and it is the person's.
  const f = fakeStore([], "An older paste about something else");
  const saved = await saveFirstSection(UID, { text: RAW, typed: "", keep: undefined }, f.store);
  assert.ok(saved.ok);
  const rev = f.revs.at(-1)!;
  assert.equal((rev.evidence as { givenAsIs?: string }).givenAsIs, givenTextMark(RAW), "marked by the server when saved");
  const rb = await loadRebuildSource(UID, rev.artifact_id, f.store);
  assert.equal(rb!.origin, "given");
  assert.equal(rb!.ownResumeText, RAW);
  // The writer rewords it, keeping her own credential line.
  const written = `CASEY SAMPLE
Dayton, OH | casey@example.com

PROFESSIONAL EXPERIENCE
Stocker | Valley Foods | 2020 - 2023
- Stocked shelves and unloaded the truck
- Kept the back room clean

CERTIFICATIONS
Forklift card, 2021`;
  const b = build(rb!, { resumeText: "anything the page sends" }, written, GROUNDING);
  assert.equal(b.source.ownResumeText, RAW, "the request's resume text is never used");
  const v0 = b.view();
  assert.ok(!v0.groups.some((g) => g.credentialName), "her own credential line is not asked");
  let answers: DefendAnswer[] = [];
  for (const h of jobHeaderLines(written)) answers = recordJobOk(answers, h);
  assert.equal(b.view(answers).state, "finished", "one tap per job, rewording A");
});

test("the mark holds only for that exact text, saved by the server as given", async () => {
  const f = fakeStore([], "Stocker at Valley Foods from 2020 to 2023.");
  await saveFirstSection(UID, { text: RAW, typed: "", keep: undefined }, f.store);
  const rev = f.revs.at(-1)!;
  // A Refinery edit on top carries the evidence, but the text no longer matches the mark.
  const base = inputFromRevision(rev);
  const edited = editInput(base, RAW.replace("Forklift card, 2021", "Forklift Certification, current"));
  assert.ok(edited.ok);
  await f.store.insertRevision(UID, revisionRecord(rev.artifact_id, "refinery_edit", edited.input, computeRevision(edited.input)));
  const rb = await loadRebuildSource(UID, rev.artifact_id, f.store);
  assert.notEqual(rb!.origin, "given");
  assert.ok(!rb!.ownResumeText.includes("Forklift Certification"), "the edited page is not their words");
  // A mark on a row that is not a first save does not count.
  const own = writerSourceFrom({ resumeText: UPLOAD });
  const g = await tailorWith({ givenAsIs: givenTextMark(TAILOR_PAGE), ownWords: own.ownWords, ownResumeText: "" }, "refinery_edit");
  assert.equal((await loadRebuildSource(UID, TAILOR, g.store))!.origin, "page_only");
});

// ---- forged claims ---------------------------------------------------------------------------------

test("a forged claim of origin is ignored: requests never set the mark, the origin or the own words", async () => {
  // 1. A page that sends the mark itself: never stored (only the server's own call sets it).
  const sent = cleanRevisionInput({ ...finishState({ resumeText: TAILOR_PAGE, coverLetterText: "", written: null, grounding: null }), givenAsIs: givenTextMark(TAILOR_PAGE) }, { receipt: FIXTURE_CTX });
  assert.ok(sent.ok);
  assert.equal(sent.input.evidence.givenAsIs, undefined);
  // 2. A malformed mark on a stored row is dropped too.
  const bad = cleanRevisionInput({ resumeText: "x\ny", givenAsIs: "yes" }, { trusted: true });
  assert.ok(bad.ok);
  assert.equal(bad.ok ? bad.input.evidence.givenAsIs : "unreached", undefined);
  // 3. Origin, mark and own words in the request do nothing: only the stored row decides.
  const f = await tailorWith({});
  const rb = await loadRebuildSource(UID, TAILOR, f.store);
  const forged = rebuildInputs({ resumeText: TAILOR_PAGE, origin: "given", givenAsIs: true, ownResumeText: TAILOR_PAGE } as Record<string, unknown>, rb!);
  assert.equal(forged.source.resumeText, "");
  assert.equal(writerSourceFrom(forged.source).ownResumeText, "");
  // 4. Someone else's resume is not there.
  assert.equal(await loadRebuildSource("00000000-0000-4000-8000-0000000000a2", TAILOR, f.store), null);
});

test("the writer route reads the rebuild itself, owner only, and binds the receipt to the server's source", () => {
  const route = read("app/api/forge/generate-docs/route.ts");
  assert.match(route, /const caller = await revisionCaller\(\);/);
  assert.match(route, /loadRebuildSource\(caller\.userId, rebuildFrom, await rebuildStore\(\)\)/);
  assert.match(route, /buildTrustedSource\(\{\s+resumeText: sourceInput\.resumeText,/);
  assert.match(route, /const raw = sourceInput as unknown as Record<string, unknown>;/);
  assert.match(route, /evidence: writerSourceFrom\(raw\)/);
  assert.match(route, /\}, sourceKind\);/);
  assert.match(route, /if \(!isSameOriginJsonPost\(request\.headers\)\) return NextResponse\.json\(\{ error: "Not allowed" \}, \{ status: 403 \}\);/);
  assert.match(read("app/api/revisions/rebuild/route.ts"), /loadRebuildSource\(caller\.userId, artifactId, await rebuildStore\(\)\)/);
  // The page sends only the id, and takes the evidence the receipt is bound to.
  const page = read("app/(forge)/output/page.tsx");
  assert.match(page, /rebuildFrom: rebuildActive\(session\) \?\? undefined,/);
  assert.match(page, /setRunEvidence\(readRunEvidence\(data\.evidence\)\);/);
});

test("the rebuild ends as soon as the person gives a new resume", () => {
  const rb = { id: "a1", page: TAILOR_PAGE, resumeAt: "" };
  assert.equal(rebuildActive({ rebuild: rb, originalResumeText: TAILOR_PAGE }), "a1");
  assert.equal(rebuildActive({ rebuild: rb, originalResumeText: "a new upload", resumeText: "a new upload" }), null);
  assert.equal(rebuildActive({ rebuild: rb, originalResumeText: TAILOR_PAGE, resumeText: "typed something" }), null);
  assert.equal(rebuildActive({ rebuild: { id: "a2", page: RAW, resumeAt: UPLOAD }, originalResumeText: RAW, resumeText: UPLOAD }), "a2");
  assert.equal(rebuildActive({}), null);
});
