/**
 * Phase 5 lane R1: one finished resume, everywhere. The reproductions from
 * the independent review (A1, A3, A5, A7) as tests, plus the server's own
 * status, the length rule and the revision save. Fictional people only.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { PDFDocument } from "pdf-lib";

import { handleDownloadPost, type DownloadDeps } from "../forge-download-handler";
import { buildFinishView, finishKey, FINISH_STATE_VERSION } from "../finish-gate";
import { cleanRevisionInput, computeRevision, gateRevision, inputFromRevision, CHECKER_VERSION } from "../revision-status";
import { pageLimitFor, lengthOpenItem } from "../length-rule";
import { importDecision, importPayload, afterSave } from "../forge-import";
import { finishPayloadFromRun } from "../finish-payload";
import { resumeTextToDocument, documentKeepsText } from "../revision-to-doc";
import { saveEditRevision, saveFinishRevision, type RevisionStore, type ArtifactLite } from "../revision-save";
import { ensureExportRevision, revisionIsCurrent, withRevisionMarker, artifactText } from "../revision-current";
import { formatResumeDownload } from "../../components/resume/resumeModel";
import type { ArtifactRevision, NewRevision, InsertRevisionResult } from "@crucible/core/src/artifactRevision";
import { revisionContentHash } from "@crucible/core/src/artifactRevision";
import { BAD_LETTER, FIXTURE_COOKIE, FIXTURE_CTX, GROUNDING, LETTER, OWN_WORDS, RESUME, RUN, SOURCE, allAnswered, finishState, longResume } from "./fixtures/revision-run";

const UID = "00000000-0000-4000-8000-0000000000a1";
const OTHER = "00000000-0000-4000-8000-0000000000b2";
const REV = "00000000-0000-4000-8000-00000000f001";

function post(body: unknown, deps?: DownloadDeps, headers: Record<string, string> = {}) {
  return handleDownloadPost(
    new Request("http://localhost/x", { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) }),
    deps
  );
}
const COOKIE = { cookie: `smr_writer_run=${FIXTURE_COOKIE}` };
const pages = async (res: Response) => (await PDFDocument.load(new Uint8Array(await res.arrayBuffer()))).getPageCount();
function input(over: Record<string, unknown> = {}) {
  const c = cleanRevisionInput(finishState(over), { receipt: FIXTURE_CTX });
  assert.ok(c.ok, c.ok ? "" : c.reason);
  return c.input;
}

// ---- A3: raw text is never an unmarked file --------------------------------------------

test("A3 repro: a txt download with `draft` omitted comes back marked DRAFT (was 200, unmarked)", async () => {
  const res = await post({ content: "MORGAN SAMPLE\nManaged 900 employees.", type: "resume", format: "txt" });
  assert.equal(res.status, 200);
  assert.match(await res.text(), /^DRAFT\n\nMORGAN SAMPLE/);
});

test("A3: the Refinery's docx request shape (no draft, no evidence) is a draft too", async () => {
  const res = await post({ content: RESUME, type: "resume", format: "docx", name: "Morgan Sample" });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("x-smr-status"), "draft");
});

// ---- revisions decide the mark on the server ----------------------------------------------

function revDeps(rev: Partial<ArtifactRevision> & { status: "draft" | "finished" }, owner = UID): DownloadDeps {
  const checked = input();
  return {
    userId: async () => UID,
    getRevision: async (userId, id) =>
      userId === owner && id === REV
        ? { id: REV, resume_text: RESUME, letter_text: LETTER, open_items: [],
            doc_kind: checked.docKind, length_choice: checked.lengthChoice, evidence: checked.evidence,
            defend_answers: checked.defendAnswers, kept_terms: checked.keptTerms,
            confirmed_credentials: checked.confirmedCredentials, ...rev } as never
        : null,
  };
}

test("historical finished rows with an incomplete checker download as drafts", async () => {
  const checked = input();
  const res = await post({ revisionId: REV, type: "resume", format: "txt" }, revDeps({
    status: "finished", evidence: { ...checked.evidence, grounding: { verifierRan: false } },
  }));
  assert.equal(res.headers.get("x-smr-status"), "draft");
  assert.match(await res.text(), /^DRAFT/);
});

test("revision id: a finished revision downloads unmarked, with ITS text (not what the page sent)", async () => {
  const res = await post({ revisionId: REV, content: "SOMETHING ELSE ENTIRELY", type: "resume", format: "txt", draft: true }, revDeps({ status: "finished" }));
  assert.equal(res.headers.get("x-smr-status"), "finished");
  assert.equal(res.headers.get("x-smr-revision"), REV);
  assert.equal(await res.text(), RESUME);
});

test("revision id: a draft revision is marked, with its stored open items on the to-do page, whatever the page says", async () => {
  const res = await post({ revisionId: REV, type: "resume", format: "pdf", draft: false }, revDeps({ status: "draft", open_items: ["Fix before you send: it runs three pages."] }));
  assert.equal(res.headers.get("x-smr-status"), "draft");
  assert.equal(await pages(res), 2, "one resume page plus the to-do page");
});

test("revision id: someone else's or an unknown revision is DRAFT; with no text it is 404; signed out it is DRAFT", async () => {
  const foreign = await post({ revisionId: REV, content: RESUME, type: "resume", format: "txt" }, revDeps({ status: "finished" }, OTHER));
  assert.equal(foreign.headers.get("x-smr-status"), "draft");
  assert.match(await foreign.text(), /^DRAFT\n\n/);
  assert.equal((await post({ revisionId: REV, type: "resume", format: "txt" }, revDeps({ status: "finished" }, OTHER))).status, 404);
  const unknown = await post({ revisionId: "00000000-0000-4000-8000-00000000dead", content: RESUME, type: "resume", format: "txt" }, revDeps({ status: "finished" }));
  assert.match(await unknown.text(), /^DRAFT/);
  const signedOut = await post({ revisionId: REV, content: RESUME, type: "resume", format: "txt" }, { ...revDeps({ status: "finished" }), userId: async () => null });
  assert.match(await signedOut.text(), /^DRAFT/);
});

test("revision id: the cover letter and the zip come from the revision too", async () => {
  const letter = await post({ revisionId: REV, type: "cover_letter", format: "txt" }, revDeps({ status: "finished" }));
  assert.equal(await letter.text(), LETTER);
  const zip = await post({ revisionId: REV, type: "resume", format: "zip" }, revDeps({ status: "finished" }));
  assert.equal(zip.status, 200);
  assert.equal(zip.headers.get("x-smr-status"), "finished");
});

test("signed out, the finish state: the server runs the gate itself and decides", async () => {
  const fin = await post({ finish: finishState({}, { signedOut: true }), type: "resume", format: "txt", draft: true }, undefined, COOKIE);
  assert.equal(fin.headers.get("x-smr-status"), "finished");
  assert.equal(await fin.text(), RESUME);
  // Same state, the skill no longer kept: the server says draft, whatever the page claims.
  const draft = await post({ finish: finishState({ keptTerms: [] }, { signedOut: true }), type: "resume", format: "txt", draft: false }, undefined, COOKIE);
  assert.equal(draft.headers.get("x-smr-status"), "draft");
  assert.match(await draft.text(), /^DRAFT\n\n/);
});

// ---- A5: the server's gate has ALL the evidence, the letter included ------------------------

test("A5 repro 1: a kept skill (D3) finishes on the server as on the page (the old email said draft)", () => {
  const view = buildFinishView({ resumeText: RESUME, ownWords: OWN_WORDS, defendAnswers: allAnswered(), keptTerms: ["Inventory control"], coverLetterText: LETTER });
  assert.equal(view.state, "finished", "the page, with its full inputs");
  // The old automatic email ran the gate with only text, own words and answers:
  const old = buildFinishView({ resumeText: RESUME, ownWords: OWN_WORDS, defendAnswers: allAnswered() });
  assert.equal(old.state, "draft", "what the old email decided");
  assert.equal(computeRevision(input()).status, "finished", "the server, with all the evidence");
});

test("A5 repro 2: an unsupported letter (900 employees, a PhD) keeps the whole version a draft (D5)", () => {
  const v = computeRevision(input({ coverLetterText: BAD_LETTER, written: { resume: RESUME, letter: BAD_LETTER } }));
  assert.equal(v.status, "draft");
  assert.ok(v.openItems.some((i) => /cover letter/.test(i)), v.openItems.join(" | "));
});

// ---- A7 and D8/C1: pages are part of status ----------------------------------------------

test("A7 repro: a 3-page resume the old gate called finished stays a draft, with a person-approved-cut item", () => {
  const { resume, source } = longResume();
  const view = buildFinishView({ resumeText: resume, ownWords: source, defendAnswers: [] });
  assert.equal(view.state, "finished", "the old gate alone");
  const c = cleanRevisionInput({ ...finishState(), resumeText: resume, coverLetterText: "", ownWords: source, keptTerms: [], defendAnswers: [], written: { resume, letter: "" }, ownResumeText: source }, { receipt: FIXTURE_CTX });
  assert.ok(c.ok);
  const v = computeRevision(c.input);
  assert.ok(v.pageCount >= 3, `pages ${v.pageCount}`);
  assert.equal(v.status, "draft");
  assert.match(v.lengthItem ?? "", /runs (three|four) pages\. Two pages is the most\. Pick the lines to cut; nothing comes off by itself\./);
  assert.equal(v.openItems[0], v.lengthItem);
  // Nothing was cut for them.
  assert.equal(c.input.resumeText, resume);
});

test("D8: the person's one-page choice holds a two-page resume as a draft; auto lets it finish", () => {
  const v1 = gateRevision(input({ lengthChoice: "one_page" }), 2);
  assert.equal(v1.status, "draft");
  assert.match(v1.lengthItem ?? "", /You chose one page/);
  assert.equal(gateRevision(input(), 2).status, "finished");
  assert.equal(gateRevision(input(), 0).status, "draft", "an empty page is never finished");
});

test("C1: each kind keeps its own length rule", () => {
  assert.equal(pageLimitFor("resume"), 2);
  assert.equal(pageLimitFor("resume", "one_page"), 1);
  assert.equal(pageLimitFor("cv_international"), 2);
  assert.equal(pageLimitFor("cv_academic"), null);
  assert.equal(pageLimitFor("cv_clinical"), null);
  assert.equal(pageLimitFor("artist_resume"), 2);
  assert.equal(pageLimitFor("artist_resume", "auto", { callAllowsFour: true }), 4);
  assert.equal(pageLimitFor("performer_resume"), 1);
  // The kind is the server's (review M1): set on the input, never read from a page.
  assert.equal(gateRevision({ ...input(), docKind: "cv_academic" }, 7).status, "finished");
  assert.equal(gateRevision({ ...input(), docKind: "performer_resume" }, 2).status, "draft");
  assert.equal(lengthOpenItem(2, 2), null);
});

// ---- the server never trusts a flag ------------------------------------------------------

test("cleanRevisionInput has no field for a status: a sent 'finished' changes nothing", () => {
  const withFlag = cleanRevisionInput({ ...finishState({ keptTerms: [] }), status: "finished", state: "finished", finished: true, draft: false }, { receipt: FIXTURE_CTX });
  assert.ok(withFlag.ok);
  assert.equal(computeRevision(withFlag.input).status, "draft");
});

test("a confirmation for a credential the writer never named is dropped (the page's restore filter)", () => {
  const c = cleanRevisionInput(finishState({ confirmedCredentials: [{ name: "CDL Class A", type: "license", when: "2020", text: "CDL Class A license, 2020" }] }), { receipt: FIXTURE_CTX });
  assert.ok(c.ok);
  assert.equal(c.input.confirmedCredentials.length, 0);
});

test("a stored revision re-checks to the same verdict (the email and edits re-run it)", () => {
  const i = input();
  const v = computeRevision(i);
  const back = inputFromRevision({
    doc_kind: i.docKind, length_choice: i.lengthChoice, resume_text: i.resumeText, letter_text: i.letterText,
    defend_answers: i.defendAnswers, kept_terms: i.keptTerms, confirmed_credentials: i.confirmedCredentials as unknown[], evidence: i.evidence as never,
  });
  assert.ok(back);
  assert.equal(computeRevision(back!).status, v.status);
  assert.equal(CHECKER_VERSION.length > 0, true);
});

// ---- A1: the import carries the finished state; a change in the same stage saves again ------

function storedRun(over: Record<string, unknown> = {}) {
  const run: Record<string, any> = { ...RUN, _ownerUserId: UID, _syncedLevel: 2 };
  const s = finishState(over);
  run.forgeFinish = {
    v: FINISH_STATE_VERSION,
    key: finishKey(run, false),
    docs: { resumeText: s.resumeText, coverLetterText: s.coverLetterText, withheldLines: [], keepInsideLines: false, grounding: s.grounding, written: s.written },
    defendAnswers: s.defendAnswers,
    addedTerms: [],
    keptTerms: s.keptTerms,
    confirmedCredentials: s.confirmedCredentials,
    credentialCutRemnants: [],
  };
  return run;
}

test("A1 repro: the import payload now carries the finished text and the confirmations (it left forgeFinish out)", () => {
  const p = importPayload(storedRun()) as { finish?: Record<string, unknown> };
  assert.ok(p.finish, "finish is sent");
  assert.equal(p.finish!.resumeText, RESUME);
  assert.deepEqual(p.finish!.keptTerms, ["Inventory control"]);
  assert.equal(p.finish!.ownWords, OWN_WORDS);
  assert.equal("status" in p.finish!, false, "no status travels");
});

test("A1 repro: a finish-page change after the stage was saved is saved again (importDecision said none)", () => {
  const run = storedRun();
  const synced = { ...run, ...afterSave(run, UID, 2) };
  assert.deepEqual(importDecision(synced, { id: UID }), { action: "none" }, "nothing new");
  // The person cuts the kept skill: same stage, new version.
  const changed: Record<string, any> = { ...synced, forgeFinish: storedRun({ keptTerms: [], resumeText: RESUME.replace(", Inventory control", "") }).forgeFinish };
  changed.forgeFinish.key = finishKey(changed, false);
  assert.deepEqual(importDecision(changed, { id: UID }), { action: "save", level: 2 });
});

test("A1: a stored finish from another run is never sent (finishKey), and the ownership rules are unchanged", () => {
  const run = storedRun();
  const other = { ...run, resumeText: "A different upload" };
  assert.equal(finishPayloadFromRun(other), null);
  assert.equal("finish" in importPayload(other), false);
  assert.deepEqual(importDecision({ ...run, _ownerUserId: OTHER }, { id: UID }), { action: "clear" });
  assert.equal(importDecision({ ...run, _ownerUserId: undefined, _syncedLevel: undefined }, { id: UID }).action, "ask");
});

// ---- the account's resume shows the finished words ----------------------------------------

test("revision-to-doc: the finished text becomes the account's document, every word kept, the cut skill gone", () => {
  const cut = RESUME.replace(", Inventory control", "");
  const doc = resumeTextToDocument(cut, { meta: { targetJob: "Line Cook" } });
  assert.ok(documentKeepsText(cut, doc));
  assert.equal(doc.contact.name, "Morgan Sample");
  assert.equal(doc.contact.email, "morgan@example.com");
  assert.equal(doc.experience[0].title, "LINE COOK");
  assert.equal(doc.experience[0].bullets.length, 3);
  assert.equal(doc.skills.includes("Inventory control"), false);
  assert.equal(doc.meta.targetJob, "Line Cook");
  assert.doesNotMatch(formatResumeDownload(doc as never), /Inventory control/);
});

// ---- saving: the server computes, stores, dedupes ------------------------------------------

function fakeStore(initial: ArtifactLite[] = []) {
  const arts = [...initial];
  const revs: ArtifactRevision[] = [];
  const updates: Array<{ id: string; content: Record<string, unknown> }> = [];
  const store: RevisionStore = {
    listResumeArtifacts: async () => arts,
    getArtifact: async (_u, id) => arts.find((a) => a.id === id) ?? null,
    createForgeArtifact: async (_u, content) => {
      const a = { id: `00000000-0000-4000-8000-0000000000${(10 + arts.length).toString(16)}`, artifact_type: "resume", target_context: { source: "forge" }, content };
      arts.push(a);
      return { id: a.id };
    },
    updateArtifactContent: async (_u, id, content) => {
      updates.push({ id, content });
      return "updated";
    },
    insertRevision: async (userId: string, r: NewRevision): Promise<InsertRevisionResult> => {
      const hash = revisionContentHash(r);
      const mine = revs.filter((x) => x.artifact_id === r.artifactId);
      const newest = mine[mine.length - 1];
      if (newest && newest.content_hash === hash) return { status: "saved", revision: newest, reused: true };
      const row = {
        id: `00000000-0000-4000-8000-00000000f${(100 + revs.length).toString(16)}`, user_id: userId, artifact_id: r.artifactId, revision_number: mine.length + 1,
        source: r.source, doc_kind: r.docKind, resume_text: r.resumeText, letter_text: r.letterText, kept_terms: r.keptTerms,
        confirmed_credentials: r.confirmedCredentials, defend_answers: r.defendAnswers, evidence: r.evidence, checker_version: r.checkerVersion,
        status: r.status, page_count: r.pageCount, page_limit: r.pageLimit, length_choice: r.lengthChoice, open_items: r.openItems, content_hash: hash, created_at: "now",
      } as ArtifactRevision;
      revs.push(row);
      return { status: "saved", revision: row, reused: false };
    },
    getLatestRevision: async (_u, id) => revs.filter((x) => x.artifact_id === id).at(-1) ?? null,
  };
  return { store, arts, revs, updates };
}

test("save: the finish page's state becomes revision 1 on a new Forge resume; the same state again is revision 1", async () => {
  const f = fakeStore();
  const a = await saveFinishRevision(UID, finishState(), { source: "forge_finish" }, f.store);
  assert.ok(a.ok);
  assert.equal(a.ok && a.revision.number, 1);
  assert.equal(a.ok && a.revision.status, "finished");
  assert.equal(f.arts.length, 1, "the Forge resume was made");
  const b = await saveFinishRevision(UID, finishState(), { source: "forge_import" }, f.store);
  assert.ok(b.ok && b.revision.reused && b.revision.id === (a.ok ? a.revision.id : ""));
  assert.equal(f.revs.length, 1);
});

test("save: an edit within the stage is a new revision, and the account's resume follows the saved words", async () => {
  const f = fakeStore([{ id: "00000000-0000-4000-8000-0000000000aa", artifact_type: "resume", target_context: { source: "forge" }, content: { meta: { targetJob: "Line Cook" } } }]);
  await saveFinishRevision(UID, finishState(), { source: "forge_finish" }, f.store);
  const cut = RESUME.replace(", Inventory control", "");
  const r = await saveFinishRevision(UID, finishState({ resumeText: cut, keptTerms: [] }), { source: "forge_finish" }, f.store);
  assert.ok(r.ok);
  assert.equal(r.ok && r.revision.number, 2);
  assert.equal(r.ok && r.revision.status, "finished");
  const last = f.updates.at(-1)!;
  assert.equal(JSON.stringify(last.content).includes("Inventory control"), false);
});

test("save: a Refinery edit carries the evidence over on the server; with no earlier revision it is a draft", async () => {
  const f = fakeStore([{ id: "00000000-0000-4000-8000-0000000000aa", artifact_type: "resume", target_context: { source: "forge" }, content: {} }]);
  const raw = await saveEditRevision(UID, "00000000-0000-4000-8000-0000000000aa", RESUME, LETTER, f.store);
  assert.ok(raw.ok);
  assert.equal(raw.ok && raw.revision.status, "draft", "raw text, no evidence");
  await saveFinishRevision(UID, finishState(), { source: "forge_finish" }, f.store);
  const same = await saveEditRevision(UID, "00000000-0000-4000-8000-0000000000aa", RESUME, LETTER, f.store);
  assert.equal(same.ok && same.revision.status, "finished", "same words on top of a finished revision");
  const added = await saveEditRevision(UID, "00000000-0000-4000-8000-0000000000aa", RESUME + "\n- Managed a team of 40.", LETTER, f.store);
  assert.equal(added.ok && added.revision.status, "draft", "a new unsupported line is asked about again");
  assert.equal((await saveEditRevision(UID, "00000000-0000-4000-8000-0000000000ff", RESUME, LETTER, f.store)).ok, false, "not the person's artifact");
});

test("the fixture's source is fictional", () => {
  assert.match(SOURCE, /example\.com/);
});

// ---- the Refinery: every export is a saved revision of what is STORED -------------------


test("export: the Forge resume the server rebuilt from revision 1 exports as revision 1, exactly (marker)", async () => {
  const f = fakeStore();
  const saved = await saveFinishRevision(UID, finishState(), { source: "forge_finish" }, f.store);
  assert.ok(saved.ok);
  // The fake store keeps the content the server wrote.
  const art = f.arts[0];
  art.content = f.updates.at(-1)!.content;
  const ex = await ensureExportRevision(UID, art.id, f.store);
  assert.ok(ex.ok);
  assert.equal(ex.ok && ex.revision.id, saved.ok ? saved.revision.id : "");
  assert.equal(ex.ok && ex.revision.status, "finished");
  assert.equal(f.revs.length, 1, "no new revision");
});

test("export: an edit in the Refinery breaks the marker, and the server makes a new revision from the stored content", async () => {
  const f = fakeStore();
  await saveFinishRevision(UID, finishState(), { source: "forge_finish" }, f.store);
  const art = f.arts[0];
  const content = { ...(f.updates.at(-1)!.content as Record<string, any>) };
  content.summary = "Line cook. I also managed a team of 40.";
  art.content = content;
  assert.equal(revisionIsCurrent(art.content, f.revs[0]), false);
  const ex = await ensureExportRevision(UID, art.id, f.store);
  assert.ok(ex.ok);
  assert.equal(ex.ok && ex.revision.revision_number, 2);
  assert.equal(ex.ok && ex.revision.source, "refinery_edit");
  // The stored content's change, applied to the saved text: the new summary line is in, every untouched line keeps its saved form.
  assert.ok(ex.ok && ex.revision.resume_text.includes("Line cook. I also managed a team of 40."), ex.ok ? ex.revision.resume_text : "");
  assert.ok(ex.ok && ex.revision.resume_text.includes("LINE COOK | Harbor Street Diner | 2019 - 2023"));
  assert.equal(ex.ok && ex.revision.status, "draft", "a new unsupported claim is asked about again");
});

test("export: a forged marker (wrong hash) vouches for nothing", () => {
  const rev = { id: REV, resume_text: "x", letter_text: "" };
  const good = withRevisionMarker({ contact: { name: "A" }, experience: [] }, REV);
  assert.equal(revisionIsCurrent(good, rev), true);
  const forged = { ...good, summary: "added later" };
  assert.equal(revisionIsCurrent(forged, rev), false);
  assert.equal(revisionIsCurrent({ ...good, _revision: { id: REV, hash: "0".repeat(64) } }, rev), false);
});

test("export: someone else's artifact, or one that is not a resume, gets nothing", async () => {
  const f = fakeStore([{ id: "00000000-0000-4000-8000-0000000000ab", artifact_type: "cover_letter", target_context: {}, content: { text: "Dear" } }]);
  assert.deepEqual(await ensureExportRevision(UID, "00000000-0000-4000-8000-0000000000ff", f.store), { ok: false, status: 404, reason: "artifact not found" });
  assert.deepEqual(await ensureExportRevision(UID, "00000000-0000-4000-8000-0000000000ab", f.store), { ok: false, status: 409, reason: "not a resume" });
});

test("never erase: an empty finish state saves nothing and touches nothing already saved", async () => {
  const f = fakeStore();
  const ok = await saveFinishRevision(UID, finishState(), { source: "forge_finish" }, f.store);
  assert.ok(ok.ok);
  const updates = f.updates.length;
  for (const empty of [finishState({ resumeText: "" }), finishState({ resumeText: "   " }), {}, null]) {
    const r = await saveFinishRevision(UID, empty, { source: "forge_import" }, f.store);
    assert.equal(r.ok, false);
  }
  assert.equal(f.revs.length, 1, "the saved revision stands");
  assert.equal(f.updates.length, updates, "the account's resume was not rewritten");
  assert.equal((await saveEditRevision(UID, f.arts[0].id, "", "", f.store)).ok, false);
  assert.equal(importPayload({ ...RUN, forgeFinish: undefined }).finish, undefined, "no finish, nothing sent");
});

// ---- review H1: a Refinery edit keeps the saved version's text; only changed lines are asked again ----

import { patchText, lineKey } from "../revision-patch";
import { remapAnswers } from "../revision-status";

async function finishedForge() {
  const f = fakeStore();
  const saved = await saveFinishRevision(UID, finishState(), { source: "forge_finish" }, f.store);
  assert.ok(saved.ok && saved.revision.status === "finished");
  const art = f.arts[0];
  art.content = f.updates.at(-1)!.content;
  return { f, art };
}

test("H1: text to document to text comes back identical (no edit)", async () => {
  const { f, art } = await finishedForge();
  const before = artifactText(art.content);
  assert.equal(patchText(RESUME, before, before), RESUME);
  // And through the export path, even when the marker is gone (an old client dropped it).
  const { _revision, ...noMarker } = art.content as Record<string, unknown>;
  void _revision;
  art.content = noMarker;
  const ex = await ensureExportRevision(UID, art.id, f.store);
  assert.ok(ex.ok);
  assert.equal(ex.ok && ex.revision.resume_text, RESUME, "the saved text, exactly");
  assert.equal(ex.ok && ex.revision.status, "finished");
});

test("H1: add a phone number stays finished", async () => {
  const { f, art } = await finishedForge();
  const c = art.content as Record<string, any>;
  art.content = { ...c, contact: { ...c.contact, phone: "555-010-0199" } };
  const ex = await ensureExportRevision(UID, art.id, f.store);
  assert.ok(ex.ok);
  assert.equal(ex.ok && ex.revision.status, "finished", ex.ok ? JSON.stringify(ex.revision.open_items) : "");
  assert.match(ex.ok ? ex.revision.resume_text : "", /555-010-0199/);
  assert.ok(ex.ok && ex.revision.resume_text.includes("LINE COOK | Harbor Street Diner | 2019 - 2023"), "the job line keeps its saved form");
});

test("H1: spacing, punctuation and section order alone stay finished", async () => {
  const { f, art } = await finishedForge();
  const c = art.content as Record<string, any>;
  const exp = c.experience.map((e: any) => ({ ...e, bullets: e.bullets.map((b: string, i: number) => (i === 0 ? b.replace(/\.$/, "") + " ." : b)) }));
  art.content = { ...c, experience: exp, skills: [...c.skills].reverse() };
  const ex = await ensureExportRevision(UID, art.id, f.store);
  assert.ok(ex.ok);
  assert.equal(ex.ok && ex.revision.status, "finished", ex.ok ? JSON.stringify(ex.revision.open_items) + "\n" + ex.revision.resume_text : "");
});

test("H1: change a title re-asks only the title", async () => {
  const { f, art } = await finishedForge();
  const c = art.content as Record<string, any>;
  art.content = { ...c, experience: [{ ...c.experience[0], title: "KITCHEN MANAGER" }] };
  const ex = await ensureExportRevision(UID, art.id, f.store);
  assert.ok(ex.ok);
  assert.equal(ex.ok && ex.revision.status, "draft");
  const items = (ex.ok ? ex.revision.open_items : []) as string[];
  assert.ok(items.length >= 1 && items.every((i) => /KITCHEN MANAGER/.test(i)), JSON.stringify(items));
  // Every other line kept its saved form.
  for (const line of ["- Ran the grill on the breakfast line.", "- Showed incoming culinary staff the equipment.", "Grill, Breakfast line, Vegetable prep, Kitchen closing, Inventory control"]) {
    assert.ok(ex.ok && ex.revision.resume_text.includes(line), line);
  }
});

test("H1: a new unsourced line is a draft on that line only", async () => {
  const { f, art } = await finishedForge();
  const c = art.content as Record<string, any>;
  art.content = { ...c, experience: [{ ...c.experience[0], bullets: [...c.experience[0].bullets, "Managed a team of 40 cooks."] }] };
  const ex = await ensureExportRevision(UID, art.id, f.store);
  assert.ok(ex.ok);
  assert.equal(ex.ok && ex.revision.status, "draft");
  const items = (ex.ok ? ex.revision.open_items : []) as string[];
  assert.ok(items.length >= 1 && items.every((i) => /team of 40/.test(i)), JSON.stringify(items));
});

test("H1: carried answers follow their line on a normalized key; a changed line loses its answer", () => {
  const a = [{ line: "- Showed incoming culinary staff the equipment.", answer: "Yes, most shifts.", verdict: "stands" as const }];
  const moved = remapAnswers(a, ["- Showed incoming  culinary staff the equipment"]);
  assert.equal(moved[0].line, "- Showed incoming  culinary staff the equipment");
  const changed = remapAnswers(a, ["- Trained every new cook on the equipment."]);
  assert.equal(changed[0].line, a[0].line, "no match: the answer stays on the old line, so the new line is asked");
  assert.equal(lineKey("LINE COOK | Harbor Street Diner | 2019 - 2023"), lineKey("LINE COOK | Harbor Street Diner, 2019 - 2023"));
});

// ---- review M2: a finish-page save never silently overwrites Refinery edits ----

test("M2: Refinery edits made after the last version are saved as their own revision, and kept", async () => {
  const { f, art } = await finishedForge();
  const c = art.content as Record<string, any>;
  const edited = { ...c, contentBlocks: [{ kind: "custom", label: "Volunteer", items: [{ id: "v1", text: "Food bank, Saturdays" }] }] };
  art.content = edited;
  const r = await saveFinishRevision(UID, finishState({ coverLetterText: LETTER.replace("Diner.", "Diner, most mornings."), written: { resume: RESUME, letter: LETTER.replace("Diner.", "Diner, most mornings.") } }), { source: "forge_finish" }, f.store);
  assert.ok(r.ok);
  assert.equal(r.ok && r.revision.accountCopy, "kept_refinery");
  // The Refinery copy is a saved revision, and the account's resume was not rewritten.
  assert.ok(f.revs.some((x) => x.source === "refinery_edit" && x.resume_text.includes("Food bank, Saturdays")), f.revs.map((x) => x.source).join(","));
  const last = f.updates.at(-1)!.content as Record<string, any>;
  assert.ok(JSON.stringify(last).includes("Food bank, Saturdays"), "the working copy still holds the Refinery edit");
  // A second finish-page change does not save the same Refinery copy again.
  const n = f.revs.filter((x) => x.source === "refinery_edit").length;
  art.content = last;
  await saveFinishRevision(UID, finishState(), { source: "forge_finish" }, f.store);
  assert.equal(f.revs.filter((x) => x.source === "refinery_edit").length, n);
});

test("M2: an older copy from before saved versions is kept as a revision before the resume is rewritten", async () => {
  const f = fakeStore([{ id: "00000000-0000-4000-8000-0000000000aa", artifact_type: "resume", target_context: { source: "forge" }, content: resumeTextToDocument(RESUME + "\n- Old line from an earlier run.") }]);
  const r = await saveFinishRevision(UID, finishState(), { source: "forge_finish" }, f.store);
  assert.ok(r.ok);
  assert.equal(r.ok && r.revision.accountCopy, "kept_earlier");
  assert.ok(f.revs.some((x) => x.source === "refinery_edit" && x.resume_text.includes("Old line from an earlier run.")));
  assert.equal(JSON.stringify(f.updates.at(-1)!.content).includes("Old line from an earlier run."), false, "then rewritten to the finished words");
});

// ---- review M3: a Tailor output or fork starts from its parent's revision ----

test("M3: an unchanged fork is finished; a changed line on a fork is asked again", async () => {
  const { f, art } = await finishedForge();
  const fork = { id: "00000000-0000-4000-8000-0000000000fa", artifact_type: "resume", target_context: { source: "job" }, content: JSON.parse(JSON.stringify(art.content)), parent_artifact_id: art.id };
  f.arts.push(fork);
  const same = await ensureExportRevision(UID, fork.id, f.store);
  assert.ok(same.ok);
  assert.equal(same.ok && same.revision.status, "finished");
  assert.equal(same.ok && same.revision.artifact_id, fork.id);
  assert.equal(same.ok && same.revision.resume_text, RESUME);
  const fork2 = { ...fork, id: "00000000-0000-4000-8000-0000000000fb", content: { ...(art.content as any), summary: "Line cook who led a crew of 12." } };
  f.arts.push(fork2);
  const changed = await ensureExportRevision(UID, fork2.id, f.store);
  assert.ok(changed.ok);
  assert.equal(changed.ok && changed.revision.status, "draft");
  assert.ok(((changed.ok ? changed.revision.open_items : []) as string[]).every((i) => /crew of 12/.test(i)));
});

test("M3: a parent that is not the person's gives nothing (the store reads as the person)", async () => {
  const { f, art } = await finishedForge();
  const orphan = { id: "00000000-0000-4000-8000-0000000000fc", artifact_type: "resume", target_context: {}, content: JSON.parse(JSON.stringify(art.content)), parent_artifact_id: "00000000-0000-4000-8000-0000000000dd" };
  f.arts.push(orphan);
  const ex = await ensureExportRevision(UID, orphan.id, f.store);
  assert.ok(ex.ok);
  assert.equal(ex.ok && ex.revision.status, "draft", "no parent evidence, no own words: raw text is never finished");
});

// ---- review M1: the client decides neither the kind nor the grounding ----

test("M1: a page's docKind is ignored (a 3-page resume sent as cv_academic stays a 2-page-limit draft)", () => {
  const { resume, source } = longResume();
  const c = cleanRevisionInput({ ...finishState(), resumeText: resume, coverLetterText: "", ownWords: source, ownResumeText: source, defendAnswers: [], keptTerms: [], written: { resume, letter: "" }, docKind: "cv_academic", writerReceipt: undefined });
  assert.ok(c.ok);
  assert.equal(c.ok && c.input.docKind, "resume");
  const v = computeRevision((c as any).input);
  assert.equal(v.status, "draft");
  assert.equal(v.pageLimit, 2);
});

test("M1 (reviewer P3): dropping or editing the grounding without the writer's receipt cannot finish", () => {
  const flagged = { verifierRan: true, removed: 0, residual: 1, unmatched: 0, outcomes: [{ claim: "Ran the grill on the breakfast line", status: "still_there", doc: "resume" }] };
  assert.equal(computeRevision(input({ grounding: flagged })).status, "draft", "the real flag (signed)");
  // The page drops the flag, keeping the old receipt: the receipt no longer matches.
  const signedForFlag = finishState({ grounding: flagged }).writerReceipt;
  const dropped = cleanRevisionInput(finishState({ grounding: null, writerReceipt: signedForFlag }), { receipt: FIXTURE_CTX });
  assert.ok(dropped.ok);
  const v = computeRevision((dropped as any).input);
  assert.equal(v.status, "draft");
  assert.ok(v.openItems.some((i) => /we need to re-check this version/.test(i)));
  // No receipt at all: same.
  assert.equal(computeRevision(input({ writerReceipt: "" })).status, "draft");
  // A forged receipt: same.
  assert.equal(computeRevision(input({ writerReceipt: "wr1." + "0".repeat(64) })).status, "draft");
});

// ---- review L2, L3, L5, L6, M4, I5 ----

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { REVISION_SAVES_PER_DAY, REVISION_TOO_LARGE } from "../revision-limits";
const src = (...p: string[]) => readFileSync(join(__dirname, "..", "..", ...p), "utf8");

test("L2: a revision read error is a retryable failure, never 'no revision' (download)", async () => {
  const deps: DownloadDeps = { userId: async () => UID, getRevision: async () => { throw new Error("db down"); } };
  const res = await post({ revisionId: REV, content: RESUME, type: "resume", format: "txt" }, deps);
  assert.equal(res.status, 503);
  assert.match(((await res.json()) as { error: string }).error, /Try again/);
});

test("L2: the Forge save never rebuilds over a finished resume on a read error", () => {
  const s = src("lib", "forge-persist.ts");
  assert.match(s, /const hasRevision = forgeResume \? !!\(await getLatestRevision\(userId, forgeResume\.id\)\) : false;/);
  assert.doesNotMatch(s, /getLatestRevision\([^)]*\)\.catch/);
});

test("L3: the browser-made .txt files (ResumeBuilder, Rush and its docx fallback) carry the DRAFT mark", () => {
  assert.match(src("components", "forge", "ResumeBuilder.tsx"), /new Blob\(\[`DRAFT\\n\\n\$\{formatResumeDownload\(doc\)\}`\]/);
  const rush = src("app", "(forge)", "rush", "page.tsx");
  assert.match(rush, /const text = `DRAFT\\n\\n\$\{buildResumeText\(\)\}`;/);
  assert.match(rush, /\/\/ Fallback to txt\s+handleDownloadTxt\(\);/);
});

test("L5: the signed-out package email attaches nothing (files go only to a signed-in proven address)", () => {
  const route = src("app", "api", "forge", "email-package", "route.ts");
  assert.doesNotMatch(route.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, ""), /packageFiles|attachments/);
  assert.match(src("lib", "package-delivery-worker.ts"), /files: packageFiles/);
});

test("L6 and L8: a sensible daily save cap and a plain, non-retry message for a version too big", () => {
  assert.equal(REVISION_SAVES_PER_DAY, 200);
  assert.match(REVISION_TOO_LARGE, /too big to save/);
  assert.doesNotMatch(REVISION_TOO_LARGE, /try again/i);
});

test("M4: a draft reads 'Draft: check it before you send it.' in the Refinery and on quick-apply", () => {
  assert.match(src("components", "resume", "ResumeWorkspace.tsx"), /"Draft: check it before you send it\."/);
  assert.match(src("app", "api", "quick-apply", "route.ts"), /message: "Draft: check it before you send it\."/);
});

test("I5: the in-app security page says checked versions and answers are saved, and can be downloaded or deleted", () => {
  assert.match(src("components", "SecurityContent.tsx"), /each checked version of your resume is\s+saved to your account, with the answers you gave about its lines\.\s+You can download or delete them in Settings\./);
});

test("M3: a Tailor output names its parent, and the server links it only when it is the person's own", () => {
  assert.match(src("components", "resume", "ResumeWorkspace.tsx"), /parentArtifactId: tailorParentRef\.current/);
  assert.match(src("app", "api", "artifacts", "route.ts"), /setArtifactParent\(userId, artifact\.id, body\.parentArtifactId\)/);
});

test("the person's Forge resume is the original, never a fork that copied its 'forge' tag", async () => {
  const { pickForgeArtifact } = await import("../revision-save");
  const orig = { id: "o", artifact_type: "resume", target_context: { source: "forge" }, content: {}, parent_artifact_id: null };
  const fork = { id: "f", artifact_type: "resume", target_context: { source: "forge" }, content: {}, parent_artifact_id: "o" };
  assert.equal(pickForgeArtifact([fork, orig])?.id, "o");
  assert.equal(pickForgeArtifact([fork])?.id, "f");
  assert.equal(pickForgeArtifact([]), null);
});

test("H1: putting a changed title back is finished again (the settled form returns)", async () => {
  const { f, art } = await finishedForge();
  const c = art.content as Record<string, any>;
  art.content = { ...c, experience: [{ ...c.experience[0], title: "KITCHEN MANAGER" }] };
  const t = await ensureExportRevision(UID, art.id, f.store);
  assert.equal(t.ok && t.revision.status, "draft");
  // The person undoes it, from a copy that still carries the older marker (a stale tab).
  art.content = c;
  const back = await ensureExportRevision(UID, art.id, f.store);
  assert.ok(back.ok);
  assert.equal(back.ok && back.revision.status, "finished", back.ok ? JSON.stringify(back.revision.open_items) : "");
  assert.ok(back.ok && back.revision.resume_text.includes("LINE COOK | Harbor Street Diner | 2019 - 2023"));
});

test("M2: content the Forge save derived from earlier inputs is replaced without keeping it (nothing of the person's)", async () => {
  const { withRevisionMarker } = await import("../revision-marker");
  const derived = withRevisionMarker(resumeTextToDocument(RESUME + "\n- Derived line.") as unknown as Record<string, unknown>, "", { kind: "derived" });
  const f = fakeStore([{ id: "00000000-0000-4000-8000-0000000000aa", artifact_type: "resume", target_context: { source: "forge" }, content: derived }]);
  const r = await saveFinishRevision(UID, finishState(), { source: "forge_finish" }, f.store);
  assert.ok(r.ok);
  assert.equal(r.ok && r.revision.accountCopy, undefined);
  assert.equal(r.ok && r.revision.number, 1);
  assert.equal(f.revs.length, 1);
  // The same derived content edited by the person (hash broken) IS kept.
  const edited = { ...(derived as any), summary: "My own words." };
  const f2 = fakeStore([{ id: "00000000-0000-4000-8000-0000000000ab", artifact_type: "resume", target_context: { source: "forge" }, content: edited }]);
  const r2 = await saveFinishRevision(UID, finishState(), { source: "forge_finish" }, f2.store);
  assert.ok(r2.ok && r2.revision.accountCopy === "kept_refinery");
});

// ---- review round 2: H-A (one field from several saved lines), M-A (number order) ----

async function finishedWith(resume: string, own: string = OWN_WORDS) {
  const f = fakeStore();
  const s = await saveFinishRevision(UID, finishState({ resumeText: resume, ownWords: own, defendAnswers: allAnswered(resume), written: { resume, letter: LETTER } }), { source: "forge_finish" }, f.store);
  assert.ok(s.ok, s.ok ? "" : s.reason);
  const art = f.arts[0];
  art.content = f.updates.at(-1)!.content;
  return { f, art, s };
}

test("H-A: a shortened multi-line summary: the deleted line is gone", async () => {
  const resume = RESUME.replace("Line cook\n", "PROFESSIONAL SUMMARY\nLine cook at Harbor Street Diner.\nI ran the grill on the breakfast line.\n");
  const { f, art } = await finishedWith(resume, OWN_WORDS + "\nLine cook at Harbor Street Diner.");
  art.content = { ...(art.content as any), summary: "I ran the grill on the breakfast line." };
  const ex = await ensureExportRevision(UID, art.id, f.store);
  assert.ok(ex.ok);
  const t = ex.ok ? ex.revision.resume_text : "";
  assert.equal(t.includes("Line cook at Harbor Street Diner."), false, t);
  assert.equal(t.split("\n").filter((l) => l.includes("I ran the grill on the breakfast line.")).length, 1, t);
  assert.ok(t.includes("LINE COOK | Harbor Street Diner | 2019 - 2023"), "untouched lines keep their saved form");
});

test("H-A: a skill cut from a two-line skills section does not come back and is not doubled", async () => {
  const resume = RESUME.replace("Grill, Breakfast line, Vegetable prep, Kitchen closing, Inventory control", "Grill, Breakfast line, Vegetable prep\nKitchen closing, Inventory control");
  const { f, art } = await finishedWith(resume);
  art.content = { ...(art.content as any), skills: (art.content as any).skills.filter((x: string) => x !== "Inventory control") };
  const ex = await ensureExportRevision(UID, art.id, f.store);
  assert.ok(ex.ok);
  const t = ex.ok ? ex.revision.resume_text : "";
  assert.equal(t.includes("Inventory control"), false, t);
  assert.equal(t.split("\n").filter((l) => /Kitchen closing/.test(l)).length, 1, t);
  assert.equal(t.split("\n").filter((l) => /\bGrill\b/.test(l) && /Vegetable prep/.test(l)).length, 1, t);
  assert.equal(ex.ok && ex.revision.status, "finished");
});

test("H-A: education lines and a custom block edited in the Refinery print what the editor shows", async () => {
  const resume = RESUME + "\n\nEDUCATION\nGED | Toledo Adult Education  2015\n\nVOLUNTEER\nFood bank, Saturdays";
  const { f, art } = await finishedWith(resume, OWN_WORDS + "\nGED from Toledo Adult Education in 2015.\nFood bank, Saturdays");
  const c = art.content as any;
  art.content = { ...c, education: [], contentBlocks: (c.contentBlocks ?? []).map((b: any) => ({ ...b, items: [] })) };
  const ex = await ensureExportRevision(UID, art.id, f.store);
  assert.ok(ex.ok);
  const t = ex.ok ? ex.revision.resume_text : "";
  assert.equal(/GED/.test(t), false, t);
  assert.equal(/Food bank/.test(t), false, t);
});

test("H-A: a Tailor copy with a removed line exports without it", async () => {
  const { f, art } = await finishedForge();
  const c = JSON.parse(JSON.stringify(art.content));
  c.experience[0].bullets = c.experience[0].bullets.filter((b: string) => !b.includes("Showed incoming"));
  const fork = { id: "00000000-0000-4000-8000-0000000000f9", artifact_type: "resume", target_context: { source: "job" }, content: c, parent_artifact_id: art.id };
  f.arts.push(fork);
  const ex = await ensureExportRevision(UID, fork.id, f.store);
  assert.ok(ex.ok);
  assert.equal(ex.ok && ex.revision.resume_text.includes("Showed incoming"), false);
  assert.equal(ex.ok && ex.revision.status, "finished");
});

test("H-A invariant: whatever the saved text, the exported text prints exactly the lines the editor shows", async () => {
  const { textFromBase } = await import("../revision-current");
  const { sameLineKeys } = await import("../revision-patch");
  const { art } = await finishedForge();
  const now = artifactText(art.content);
  for (const saved of ["ODD TEXT\nA line the document never held.", RESUME, RESUME.replace("Line cook\n", "PROFESSIONAL SUMMARY\nLine cook.\nSecond line.\n")]) {
    const out = textFromBase(art.content, { id: "00000000-0000-4000-8000-00000000beef", resume_text: saved, evidence: {} });
    assert.ok(sameLineKeys(artifactText(resumeTextToDocument(out)), now), out);
  }
});

test("M-A: '40 covers over 3 years' changed to '3 covers over 40 years' is asked again", async () => {
  const resume = RESUME.replace("- Ran the grill on the breakfast line.", "- Ran the grill for 40 covers an hour over 3 years.");
  const { f, art, s } = await finishedWith(resume, OWN_WORDS + "\nI ran the grill, about 40 covers an hour, for 3 years.");
  assert.equal(s.ok && s.revision.status, "finished");
  const c = JSON.parse(JSON.stringify(art.content));
  c.experience[0].bullets = c.experience[0].bullets.map((b: string) => b.replace("40 covers an hour over 3 years", "3 covers an hour over 40 years"));
  art.content = c;
  const ex = await ensureExportRevision(UID, art.id, f.store);
  assert.equal(ex.ok && ex.revision.status, "draft");
  assert.notEqual(lineKey("Ran the grill for 40 covers an hour over 3 years"), lineKey("Ran the grill for 3 covers an hour over 40 years"));
  assert.equal(lineKey("Grill | Breakfast line"), lineKey("Breakfast line, Grill"));
});

// ---- review round 2: the receipt is bound (M-B), keys rotate (L-A), environments split (I-1), own words are the server's (H2) ----

import { writerReceipt as signReceipt, verifyWriterReceipt as checkReceipt, readReceipt, receiptAccepted, writerSourceFrom } from "../writer-receipt";

const FLAGGED = { verifierRan: true, removed: 0, residual: 1, unmatched: 0, outcomes: [{ claim: "Ran the grill on the breakfast line", status: "still_there", doc: "resume" }] };

test("M-B (reviewer R2-R1): an older generation's clean receipt replayed onto newer text is not accepted", async () => {
  const W1 = { resume: RESUME.replace("\n- Showed incoming culinary staff the equipment.", ""), letter: LETTER };
  // The old unbound form (the reviewer's probe) is never accepted.
  const legacy = signReceipt(W1, GROUNDING);
  assert.equal(computeRevision(input({ written: W1, grounding: GROUNDING, writerReceipt: legacy })).status, "draft");
  // A properly bound gen-1 receipt (same person, same run) after gen 2 was recorded as newest: refused.
  const src = writerSourceFrom({ resumeText: SOURCE, goalNarrative: "I want to keep cooking." });
  const r1 = signReceipt(W1, GROUNDING, { userId: UID, runId: RUN.startedAt, source: src, nonce: "a".repeat(32), now: 1 });
  const replay = { ...finishState({ written: W1, grounding: GROUNDING, writerReceipt: r1 }), ownWords: src.ownWords, ownResumeText: src.ownResumeText, credentialsAnswer: src.credentialsAnswer, credentialRows: src.credentialRows };
  const f = fakeStore();
  (f.store as any).receiptState = async () => ({ newestNonce: "b".repeat(32), linked: true });
  const r = await saveFinishRevision(UID, replay, { source: "forge_finish" }, f.store);
  assert.ok(r.ok);
  assert.equal(r.ok && r.revision.status, "draft");
  // The same receipt while it IS the newest generation: accepted.
  const g = fakeStore();
  (g.store as any).receiptState = async () => ({ newestNonce: "a".repeat(32), linked: true });
  const ok = await saveFinishRevision(UID, replay, { source: "forge_finish" }, g.store);
  assert.ok(ok.ok);
  assert.equal((g.revs.at(-1)!.evidence as any).writerVerified, true, "the newest generation's receipt is accepted");
});

test("M-B / r3 L-1: a receipt made for another account, another run, or another browser is not accepted", async () => {
  const { runCookieHash } = await import("../writer-receipt");
  const src = { ownWords: OWN_WORDS, ownResumeText: SOURCE, credentialsAnswer: "", credentialRows: [] };
  const W = { resume: RESUME, letter: LETTER };
  const forOther = readReceipt(signReceipt(W, GROUNDING, { userId: OTHER, runId: "run-x", source: src }))!;
  assert.equal(receiptAccepted(forOther, { userId: UID, runId: "run-x" }), false);
  assert.equal(receiptAccepted(forOther, { userId: OTHER, runId: "run-x" }), true);
  assert.equal(receiptAccepted(forOther, { userId: OTHER, runId: "run-y" }), false, "signed in: the run being finished must be the receipt's run");
  assert.equal(receiptAccepted(forOther, { userId: OTHER }), false, "no run named: refused");
  const cookie = "a1".repeat(16);
  const runR = readReceipt(signReceipt(W, GROUNDING, { userId: null, runId: "run-x", source: src, cookie }))!;
  const ch = runCookieHash(cookie);
  assert.equal(receiptAccepted(runR, { userId: null, runId: "run-y", cookieHash: ch }), false, "signed out: another run");
  assert.equal(receiptAccepted(runR, { userId: null, runId: "run-x", cookieHash: ch }), true);
  assert.equal(receiptAccepted(runR, { userId: null, runId: "run-x", cookieHash: runCookieHash("b2".repeat(16)) }), false, "another browser (another cookie)");
  assert.equal(receiptAccepted(runR, { userId: null, runId: "run-x" }), false, "no cookie");
  assert.equal(receiptAccepted(runR, { userId: UID, runId: "run-x", cookieHash: ch, runLinked: false }), false, "import: the run is not the account's");
  assert.equal(receiptAccepted(runR, { userId: UID, runId: "run-x", cookieHash: ch, runLinked: true }), true, "import: the account's own run, this browser");
  assert.equal(receiptAccepted(runR, { userId: UID, runId: "run-x", runLinked: true }), false, "import from another browser (no cookie)");
  // A signed-out receipt made without a cookie (an old shape) is never accepted.
  const noCookie = readReceipt(signReceipt(W, GROUNDING, { userId: null, runId: "run-x", source: src }))!;
  assert.equal(receiptAccepted(noCookie, { userId: null, runId: "run-x", cookieHash: ch }), false);
});

test("H2: a request that sends the whole page as its own words saves as a DRAFT", async () => {
  // The writer's receipt attests the real source; the request swaps in the page as "own words".
  const page = RESUME + "\n" + LETTER;
  const forged = { ...finishState(), ownWords: page, ownResumeText: page, defendAnswers: [] };
  const f = fakeStore();
  (f.store as any).serverSource = async () => writerSourceFrom({ resumeText: SOURCE, goalNarrative: "I want to keep cooking." });
  const r = await saveFinishRevision(UID, forged, { source: "forge_finish" }, f.store);
  assert.ok(r.ok);
  assert.equal(r.ok && r.revision.status, "draft");
  const saved = f.revs.at(-1)!;
  assert.notEqual((saved.evidence as any).ownWords, page, "the page never becomes own words");
  // With no receipt at all, own words are only what the server holds.
  const noReceipt = await saveFinishRevision(UID, { ...forged, writerReceipt: "" }, { source: "forge_finish" }, f.store);
  assert.equal(noReceipt.ok && noReceipt.revision.status, "draft");
  assert.equal(((f.revs.at(-1)!.evidence) as any).ownWords, writerSourceFrom({ resumeText: SOURCE, goalNarrative: "I want to keep cooking." }).ownWords);
});

test("H2: a first save of a pasted resume with no writer's receipt stays a draft until the cards are answered", () => {
  const pasted = "MORGAN SAMPLE\nToledo, OH | morgan@example.com\n\nEXPERIENCE\nLINE COOK | Harbor Street Diner | 2019 - 2023\n- Managed 40 cooks on the line.";
  const c = cleanRevisionInput({ resumeText: pasted, coverLetterText: "", ownWords: pasted, ownResumeText: pasted, defendAnswers: [], runId: "r" }, { receipt: { userId: UID } });
  assert.ok(c.ok);
  assert.equal(computeRevision((c as any).input).status, "draft");
  assert.equal((c as any).input.evidence.ownWords, "");
});

test("L-A: a key rotation keeps receipts working for 14 days through the previous secret, and the person's own verified version is trusted", async () => {
  const keep = { ip: process.env.IP_HASH_SECRET, prev: process.env.WRITER_RECEIPT_PREVIOUS_SECRET };
  try {
    process.env.IP_HASH_SECRET = "old-key-0001";
    const t0 = Date.parse("2026-10-10T09:00:00Z");
    const W = { resume: RESUME, letter: LETTER };
    const src = { ownWords: OWN_WORDS, ownResumeText: SOURCE, credentialsAnswer: "", credentialRows: [] };
    const rec = signReceipt(W, GROUNDING, { userId: null, runId: "run", source: src, now: t0 });
    process.env.IP_HASH_SECRET = "new-key-0002";
    assert.equal(checkReceipt(rec, W, GROUNDING, t0 + 1000), null, "the new key alone does not verify it");
    process.env.WRITER_RECEIPT_PREVIOUS_SECRET = "old-key-0001";
    assert.ok(checkReceipt(rec, W, GROUNDING, t0 + 13 * 864e5), "within 14 days");
    assert.equal(checkReceipt(rec, W, GROUNDING, t0 + 15 * 864e5), null, "after 14 days");
    delete process.env.WRITER_RECEIPT_PREVIOUS_SECRET;
    // Signed in: the person's own verified revision is trusted as a match, rotation or not.
    const known = { written: W, grounding: GROUNDING, ownWords: OWN_WORDS, ownResumeText: SOURCE, credentialsAnswer: "", credentialRows: [], writerReceipt: rec };
    const c = cleanRevisionInput(finishState({ writerReceipt: rec }), { receipt: { userId: UID }, known });
    assert.ok(c.ok);
    assert.equal((c as any).input.evidence.writerVerified, true);
    assert.equal(computeRevision((c as any).input).status, "finished");
    // ...but not once a newer generation of the run was recorded.
    const c2 = cleanRevisionInput(finishState({ writerReceipt: rec }), { receipt: { userId: UID, newestNonce: "f".repeat(32) }, known });
    assert.equal((c2 as any).input.evidence.writerVerified, false);
  } finally {
    if (keep.ip === undefined) delete process.env.IP_HASH_SECRET; else process.env.IP_HASH_SECRET = keep.ip;
    if (keep.prev === undefined) delete process.env.WRITER_RECEIPT_PREVIOUS_SECRET; else process.env.WRITER_RECEIPT_PREVIOUS_SECRET = keep.prev;
  }
});

test("I-1: a receipt made on a preview deployment never verifies on production", () => {
  const keep = process.env.VERCEL_ENV;
  try {
    const W = { resume: RESUME, letter: LETTER };
    const src = { ownWords: OWN_WORDS, ownResumeText: SOURCE, credentialsAnswer: "", credentialRows: [] };
    process.env.VERCEL_ENV = "preview";
    const rec = signReceipt(W, GROUNDING, { userId: null, runId: "run", source: src });
    assert.ok(checkReceipt(rec, W, GROUNDING), "verifies where it was made");
    process.env.VERCEL_ENV = "production";
    assert.equal(checkReceipt(rec, W, GROUNDING), null);
  } finally {
    if (keep === undefined) delete process.env.VERCEL_ENV; else process.env.VERCEL_ENV = keep;
  }
});

test("L-B: the email line says what really happens", async () => {
  const { autoResultLine } = await import("../email-package-auto-line");
  assert.equal(autoResultLine({ sent: false, reason: "settling" }), "Your finished package is queued. You can close this page; delivery will be retried if needed.");
  const line = src("components", "forge", "finish", "FinishedEmailLine.tsx");
  assert.match(line, /send\(props\.revisionId\);/, "the page asks for delivery state immediately");
  assert.doesNotMatch(src("app", "api", "forge", "email-package", "auto", "route.ts"), /cron/i);
});

test("M-B: generate-docs signs a bound receipt and keeps the newest nonce per run, signed in; the import never saves an unsigned finish", () => {
  const route = src("app", "api", "forge", "generate-docs", "route.ts");
  assert.match(route, /writerReceipt\(\{ resume, letter: coverLetter \}, grounding, \{\s+userId: userId \?\? null,\s+runId,\s+source: writerSourceFrom\(raw\),\s+nonce,\s+now: issuedAt,\s+cookie: runCookie,\s+\}\)/);
  assert.match(route, /if \(runCookie\) out\.headers\.append\("Set-Cookie", runCookieHeader\(runCookie\)\);/);
  assert.match(route, /if \(userId && runId\) \{[\s\S]*recordWriterReceipt\(userId, runId, nonce, issuedAt\)/);
  assert.match(src("lib", "forge-persist.ts"), /return \{ revision: null, revisionProblem: "no receipt" \}/);
  const page = src("app", "(forge)", "output", "page.tsx");
  assert.match(page, /runId: session\.startedAt,/);
});

// ---- review round 3: L-1 replay leftovers, L-2 writer-received text, M-1 Check it again, I-1 ----

import { recheckDocs } from "../forge-recheck";
import { RECHECK_LINE, RECHECK_HREF, RECEIPT_OPEN_ITEM as RECHECK_ITEM, needsRecheck } from "../recheck-copy";

test("r3 L-1a: with the receipt omitted, the known-revision path still checks for a newer generation of its run", async () => {
  const f = fakeStore();
  const first = await saveFinishRevision(UID, finishState(), { source: "forge_finish" }, f.store);
  assert.ok(first.ok && first.revision.status === "finished");
  // A newer generation of that run was recorded since; the page sends no receipt.
  (f.store as any).receiptState = async () => ({ newestNonce: "9".repeat(32), linked: true });
  const replay = await saveFinishRevision(UID, { ...finishState(), writerReceipt: "", coverLetterText: LETTER + " Thanks." }, { source: "forge_finish" }, f.store);
  assert.ok(replay.ok);
  assert.equal((f.revs.at(-1)!.evidence as any).writerVerified, false);
  assert.equal(replay.ok && replay.revision.status, "draft");
  // Same, with no newer generation: the known version stands in (rotation-safe).
  const g = fakeStore();
  await saveFinishRevision(UID, finishState(), { source: "forge_finish" }, g.store);
  const ok = await saveFinishRevision(UID, { ...finishState(), writerReceipt: "", coverLetterText: LETTER + " Thanks." }, { source: "forge_finish" }, g.store);
  assert.equal((g.revs.at(-1)!.evidence as any).writerVerified, true, ok.ok ? "" : "x");
});

test("r3 L-1b: signed in, run X's receipt does not finish run Y's page", async () => {
  const f = fakeStore();
  const r = await saveFinishRevision(UID, { ...finishState(), runId: "2026-10-01T00:00:00.000Z" }, { source: "forge_finish" }, f.store);
  assert.ok(r.ok);
  assert.equal((f.revs.at(-1)!.evidence as any).writerVerified, false);
  assert.equal(r.ok && r.revision.status, "draft");
});

test("r3 L-1c: a signed-out receipt imports only in the browser holding its run cookie, and then the cookie is cleared", async () => {
  const { runCookieHash } = await import("../writer-receipt");
  const state = finishState({}, { signedOut: true });
  const f = fakeStore();
  const other = await saveFinishRevision(UID, state, { source: "forge_import" }, f.store);
  assert.equal((f.revs.at(-1)!.evidence as any).writerVerified, false, "another browser (no cookie)");
  assert.equal(other.ok && other.usedRunReceipt, undefined);
  const g = fakeStore();
  const mine = await saveFinishRevision(UID, state, { source: "forge_import", cookieHash: runCookieHash(FIXTURE_COOKIE) }, g.store);
  assert.ok(mine.ok && mine.revision.status === "finished");
  assert.equal(mine.ok && mine.usedRunReceipt, true, "the route clears the run cookie after this");
  for (const route of [["app", "api", "forge", "save", "route.ts"], ["app", "api", "revisions", "route.ts"]]) {
    assert.match(src(...route), /usedRunReceipt\) res\.headers\.append\("Set-Cookie", runCookieHeader\(null\)\)/, route.join("/"));
  }
  const { runCookieHeader } = await import("../writer-receipt");
  assert.match(runCookieHeader("ab".repeat(16)), /smr_writer_run=abab.*; Path=\/; HttpOnly; SameSite=Lax; Max-Age=604800/);
});

test("r3 L-2: own resume lines are the text the writer received; a separate 'original' the writer never saw does not count", () => {
  const s1 = writerSourceFrom({ resumeText: SOURCE, originalResumeText: SOURCE + "\nCDL Class A, 2020" } as any);
  assert.equal(s1.ownResumeText.includes("CDL Class A"), false);
  assert.equal(s1.ownResumeText, writerSourceFrom({ resumeText: SOURCE }).ownResumeText);
  const page = src("app", "(forge)", "output", "page.tsx");
  assert.doesNotMatch(page, /originalResumeText: session\.originalResumeText/, "the page does not send it to the writer");
  assert.match(src("lib", "finish-payload.ts"), /ownResumeText: withholdRecordLines\(run\.resumeText, keepSourceRecordLines\(choice\)\)\.kept/);
});

test("r3 I-1: the import comment about the original upload is true", () => {
  assert.match(src("lib", "forge-import.ts"), /stays in\n \* this browser: it is never sent, not here and not to the writer/);
});

const noFlags = async () => ({ text: "", hasFabrication: false, applied: false, flags: [], verifierRan: true });
/** A store whose server-held own words are the fixture person's (their saved Forge run). */
function heldStore() {
  const f = fakeStore();
  (f.store as any).serverSource = async () => writerSourceFrom({ resumeText: SOURCE, goalNarrative: "I want to keep cooking." });
  return f;
}
let rnd = 0;
const fixedRandom = () => (++rnd).toString(16).padStart(32, "0");

test("r3 M-1: a finish with no receipt is a draft with the re-check item; Check it again issues a receipt, rewrites nothing, and it finishes", async () => {
  // A pre-receipt finish state (the page held it in the browser before receipts existed).
  const pre = finishState({ writerReceipt: "" });
  const c0 = cleanRevisionInput(pre, { receipt: FIXTURE_CTX });
  const v0 = computeRevision((c0 as any).input);
  assert.equal(v0.status, "draft");
  assert.ok(needsRecheck(v0.openItems));
  assert.equal(RECHECK_ITEM.startsWith("Fix before you send: we need to re-check this version"), true);
  // Check it again: the current documents, the writer's documents, the person's source and answers.
  const r = await recheckDocs(
    {
      documents: { resume: pre.resumeText, letter: pre.coverLetterText },
      written: pre.written,
      source: { resumeText: SOURCE, goalNarrative: "I want to keep cooking." },
      answers: (pre.defendAnswers as Array<{ answer: string }>).map((a) => a.answer),
      runId: RUN.startedAt,
    },
    FIXTURE_CTX.userId,
    { verify: noFlags as any, random: fixedRandom, store: heldStore().store }
  );
  assert.ok(r.ok);
  const after: Record<string, any> = { ...pre, grounding: r.ok ? r.grounding : null, writerReceipt: r.ok ? r.receipt : "" };
  assert.equal(after.resumeText, pre.resumeText, "nothing rewritten");
  assert.deepEqual(after.defendAnswers, pre.defendAnswers, "answers kept");
  const c1 = cleanRevisionInput(after, { receipt: FIXTURE_CTX });
  assert.equal((c1 as any).input.evidence.writerVerified, true);
  assert.equal(computeRevision((c1 as any).input).status, "finished");
});

test("r3 M-1: what the fresh check flags comes back as a card (still a draft, never silently finished)", async () => {
  const pre = finishState({ writerReceipt: "" });
  const flagging = async ({ kind }: { kind: string }) =>
    kind === "resume"
      ? { text: "", hasFabrication: true, applied: false, flags: [{ claim: "Ran the grill on the breakfast line", reason: "not in source" }], verifierRan: true }
      : { text: "", hasFabrication: false, applied: false, flags: [], verifierRan: true };
  const r = await recheckDocs(
    { documents: { resume: pre.resumeText, letter: pre.coverLetterText }, written: pre.written, source: { resumeText: SOURCE, goalNarrative: "I want to keep cooking." }, runId: RUN.startedAt },
    FIXTURE_CTX.userId,
    { verify: flagging as any, random: fixedRandom, store: heldStore().store }
  );
  assert.ok(r.ok);
  const outcomes = (r.ok ? (r.grounding as any).outcomes : []) as Array<{ status: string }>;
  assert.ok(outcomes.some((o) => o.status === "still_there"), JSON.stringify(outcomes));
  const c = cleanRevisionInput({ ...pre, grounding: r.ok ? r.grounding : null, writerReceipt: r.ok ? r.receipt : "" }, { receipt: FIXTURE_CTX });
  const v = computeRevision((c as any).input);
  assert.equal(v.status, "draft");
  assert.equal(needsRecheck(v.openItems), false, "the receipt is good now; the card is the flagged line");
});

test("r3 M-1: signed out, Check it again binds the fresh receipt to a new run cookie; bad input is refused", async () => {
  const pre = finishState({ writerReceipt: "" }, { signedOut: true });
  const r = await recheckDocs(
    { documents: { resume: pre.resumeText, letter: pre.coverLetterText }, written: pre.written, source: { resumeText: SOURCE }, runId: RUN.startedAt },
    null,
    { verify: noFlags as any, random: fixedRandom }
  );
  assert.ok(r.ok && r.runCookie && /^[0-9a-f]{32}$/.test(r.runCookie));
  assert.ok(r.ok && readReceipt(r.receipt)?.c, "bound to the cookie");
  assert.equal((await recheckDocs({ documents: { resume: "x" }, runId: "r" }, null, { verify: noFlags as any, random: fixedRandom })).ok, false);
  assert.equal((await recheckDocs({ documents: { resume: "x", letter: "" }, written: { resume: "x", letter: "" } }, null, { verify: noFlags as any, random: fixedRandom })).ok, false, "no run");
});

test("r3 M-1: the page shows the re-check card and runs it from ?check=1; the Refinery links there", () => {
  const page = src("app", "(forge)", "output", "page.tsx");
  assert.match(page, /data-testid="recheck-card"/);
  assert.match(page, /\{RECHECK_LINE\}/);
  assert.match(page, /get\("check"\) !== "1"/);
  assert.equal(RECHECK_LINE, "We need to re-check this version before it can be finished.");
  assert.equal(RECHECK_HREF, "/output?from=refinery&check=1");
  assert.match(src("components", "resume", "ResumeWorkspace.tsx"), /href=\{RECHECK_HREF\}/);
  assert.match(src("lib", "session-policy.ts"), /"\/api\/forge\/recheck",/);
});

// ---- coordination: Check it again is the one server path, for a finish state OR an owned artifact ----

test("Check it again (artifact): an owned resume whose second check BLOCKs stays a draft, with that line as its card", async () => {
  const { f, art } = await finishedForge();
  const flagging = async ({ kind }: { kind: string }) =>
    kind === "resume"
      ? { text: "", hasFabrication: true, applied: false, flags: [{ claim: "Ran the grill on the breakfast line", reason: "not in source" }], verifierRan: true }
      : { text: "", hasFabrication: false, applied: false, flags: [], verifierRan: true };
  const r = await recheckDocs({ kind: "artifact", artifactId: art.id }, UID, { verify: flagging as any, random: fixedRandom, store: f.store });
  assert.ok(r.ok);
  assert.equal(r.ok && r.revision?.status, "draft");
  assert.ok(r.ok && (r.revision?.openItems ?? []).some((i) => /Ran the grill on the breakfast line/.test(i)), r.ok ? JSON.stringify(r.revision?.openItems) : "");
  assert.equal(r.ok && needsRecheck(r.revision?.openItems), false, "the receipt is fresh; the card is the flagged line");
  const saved = f.revs.at(-1)!;
  assert.equal((saved.evidence as any).writerVerified, true);
  assert.equal(saved.resume_text, RESUME, "the stored text, checked as it is (nothing rewritten)");
});

test("Check it again (artifact): a clean check on an owned resume finishes it; another person's or a signed-out call gets nothing", async () => {
  const { f, art } = await finishedForge();
  const r = await recheckDocs({ kind: "artifact", artifactId: art.id }, UID, { verify: noFlags as any, random: fixedRandom, store: f.store });
  assert.ok(r.ok && r.revision?.status === "finished");
  assert.equal(r.ok && readReceipt(r.receipt)?.sub, `u:${UID}`);
  assert.equal(r.ok && readReceipt(r.receipt)?.run, `artifact:${art.id}`);
  const foreign = await recheckDocs({ kind: "artifact", artifactId: "00000000-0000-4000-8000-0000000000dd" }, UID, { verify: noFlags as any, random: fixedRandom, store: f.store });
  assert.deepEqual(foreign, { ok: false, status: 404, error: "We could not find that resume." });
  const out = await recheckDocs({ kind: "artifact", artifactId: art.id }, null, { verify: noFlags as any, random: fixedRandom, store: f.store });
  assert.equal(out.ok, false);
  assert.equal(!out.ok && out.status, 401);
});

test("Check it again (finish): written, grounding and a receipt sent in the request are never trusted", async () => {
  const pre = finishState({ writerReceipt: "" });
  const flagging = async ({ kind }: { kind: string }) =>
    kind === "resume"
      ? { text: "", hasFabrication: true, applied: false, flags: [{ claim: "Ran the grill on the breakfast line", reason: "x" }], verifierRan: true }
      : { text: "", hasFabrication: false, applied: false, flags: [], verifierRan: true };
  const r = await recheckDocs(
    {
      kind: "finish",
      documents: { resume: pre.resumeText, letter: pre.coverLetterText },
      // A forged clean check and other written documents: ignored.
      written: { resume: "SOMETHING ELSE", letter: "" },
      grounding: { verifierRan: true, outcomes: [] },
      writerReceipt: "wr2.forged",
      source: { resumeText: SOURCE, goalNarrative: "I want to keep cooking." },
      runId: RUN.startedAt,
    },
    UID,
    { verify: flagging as any, random: fixedRandom, store: heldStore().store }
  );
  assert.ok(r.ok);
  assert.deepEqual(r.ok && r.written, { resume: pre.resumeText, letter: pre.coverLetterText }, "written is what was checked");
  assert.ok(r.ok && ((r.grounding as any).outcomes as Array<{ status: string }>).some((o) => o.status === "still_there"), "the real check ran");
});

// ---- combined final review: N1 (real-length receipts survive a reload), N2 (signed-in check uses server-held words), L-a ----

import { readStoredFinish as readStored } from "../finish-gate";

test("N1: a real-length receipt survives a reload: the page stays finished and the import carries it", async () => {
  const { runCookieHash } = await import("../writer-receipt");
  for (const signedOut of [false, true]) {
    const st = finishState({}, { signedOut });
    assert.ok(st.writerReceipt.length > 300, `real wr2 receipts are long (${st.writerReceipt.length})`);
    // What the finish page keeps in the browser, and reads back after a reload.
    const run: Record<string, any> = { ...RUN };
    run.forgeFinish = {
      v: FINISH_STATE_VERSION,
      key: finishKey(run, false),
      docs: { resumeText: st.resumeText, coverLetterText: st.coverLetterText, withheldLines: [], keepInsideLines: false, grounding: st.grounding, written: st.written, receipt: st.writerReceipt },
      defendAnswers: st.defendAnswers,
      keptTerms: st.keptTerms,
    };
    const restored = readStored(run.forgeFinish, finishKey(run, false));
    assert.equal(restored?.docs.receipt, st.writerReceipt, "the receipt is kept on reload");
    // The import carries it, and the server still finishes it.
    const payload = importPayload(run).finish as Record<string, unknown>;
    assert.equal(payload.writerReceipt, st.writerReceipt, "the sign-in import carries the receipt");
    const ctx = signedOut ? { userId: null, runId: RUN.startedAt, cookieHash: runCookieHash(FIXTURE_COOKIE) } : FIXTURE_CTX;
    const c = cleanRevisionInput(payload, { receipt: ctx });
    assert.equal((c as any).input.evidence.writerVerified, true);
    assert.equal(computeRevision((c as any).input).status, "finished");
  }
});

test("N2 (reviewer probe): signed in, a check over request-chosen documents and words never finishes a page with zero cards", async () => {
  const PAGE = RESUME.replace("- Showed incoming culinary staff the equipment.", "- Managed a team of 40 cooks across three sites.");
  const f = heldStore();
  // Step 1: Check it again, the page claimed as its own source.
  const r = await recheckDocs(
    { kind: "finish", documents: { resume: PAGE, letter: "" }, source: { resumeText: PAGE }, runId: "kit-run-1" },
    UID,
    { verify: noFlags as any, random: fixedRandom, store: f.store }
  );
  assert.ok(r.ok);
  assert.equal(readReceipt(r.ok ? r.receipt : "")?.src, (await import("../writer-receipt")).sourceHash(await (f.store as any).serverSource()), "signed over the SERVER-held own words");
  // Step 2: save, claiming the page as own words, zero cards answered.
  const saved = await saveFinishRevision(
    UID,
    { resumeText: PAGE, coverLetterText: "", written: r.ok ? r.written : null, grounding: r.ok ? r.grounding : null, writerReceipt: r.ok ? r.receipt : "", ownWords: PAGE, ownResumeText: PAGE, defendAnswers: [], runId: "kit-run-1" },
    { source: "forge_finish" },
    f.store
  );
  assert.ok(saved.ok);
  assert.equal(saved.ok && saved.revision.status, "draft");
  const ev = f.revs.at(-1)!.evidence as any;
  assert.notEqual(ev.ownWords, PAGE, "own words are the server's");
  assert.ok((saved.ok ? saved.revision.openItems : []).some((i) => /team of 40/.test(i)));
});

test("N2: an 'artifact:' run is refused on the finish path; a signed-out check's receipt is never imported into an account", async () => {
  const pre = finishState({ writerReceipt: "" }, { signedOut: true });
  const refused = await recheckDocs({ kind: "finish", documents: { resume: pre.resumeText, letter: "" }, source: {}, runId: "artifact:00000000-0000-4000-8000-0000000000aa" }, UID, { verify: noFlags as any, random: fixedRandom, store: heldStore().store });
  assert.equal(refused.ok, false);
  const { runCookieHash } = await import("../writer-receipt");
  const r = await recheckDocs(
    { kind: "finish", documents: { resume: pre.resumeText, letter: pre.coverLetterText }, source: { resumeText: SOURCE, goalNarrative: "I want to keep cooking." }, runId: RUN.startedAt },
    null,
    { verify: noFlags as any, random: fixedRandom }
  );
  assert.ok(r.ok && readReceipt(r.receipt)?.k === "check");
  const st = { ...pre, written: r.ok ? r.written : null, grounding: r.ok ? r.grounding : null, writerReceipt: r.ok ? r.receipt : "" };
  const ch = runCookieHash(r.ok ? r.runCookie! : "");
  // Signed out, in that browser: its own files only.
  assert.equal((cleanRevisionInput(st, { receipt: { userId: null, runId: RUN.startedAt, cookieHash: ch } }) as any).input.evidence.writerVerified, true);
  // Into an account (same browser, the account's own run): refused.
  assert.equal((cleanRevisionInput(st, { receipt: { userId: UID, runId: RUN.startedAt, cookieHash: ch, runLinked: true } }) as any).input.evidence.writerVerified, false);
});

test("L-a: /api/forge/recheck takes same-origin JSON only", () => {
  assert.match(src("app", "api", "forge", "recheck", "route.ts"), /if \(!isSameOriginJsonPost\(request\.headers\)\) return NextResponse\.json\(\{ error: "Invalid request" \}, \{ status: 403 \}\);/);
});
