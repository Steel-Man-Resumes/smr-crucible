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
import { BAD_LETTER, LETTER, OWN_WORDS, RESUME, RUN, SOURCE, allAnswered, finishState, longResume } from "./fixtures/revision-run";

const UID = "00000000-0000-4000-8000-0000000000a1";
const OTHER = "00000000-0000-4000-8000-0000000000b2";
const REV = "00000000-0000-4000-8000-00000000f001";

function post(body: unknown, deps?: DownloadDeps) {
  return handleDownloadPost(
    new Request("http://localhost/x", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
    deps
  );
}
const pages = async (res: Response) => (await PDFDocument.load(new Uint8Array(await res.arrayBuffer()))).getPageCount();
function input(over: Record<string, unknown> = {}) {
  const c = cleanRevisionInput(finishState(over));
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
  return {
    userId: async () => UID,
    getRevision: async (userId, id) =>
      userId === owner && id === REV
        ? { id: REV, resume_text: RESUME, letter_text: LETTER, open_items: [], ...rev } as never
        : null,
  };
}

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
  const fin = await post({ finish: finishState(), type: "resume", format: "txt", draft: true });
  assert.equal(fin.headers.get("x-smr-status"), "finished");
  assert.equal(await fin.text(), RESUME);
  // Same state, the skill no longer kept: the server says draft, whatever the page claims.
  const draft = await post({ finish: finishState({ keptTerms: [] }), type: "resume", format: "txt", draft: false });
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
  const c = cleanRevisionInput({ ...finishState(), resumeText: resume, coverLetterText: "", ownWords: source, keptTerms: [], defendAnswers: [], written: { resume, letter: "" }, ownResumeText: source });
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
  assert.equal(gateRevision(input({ docKind: "cv_academic" }), 7).status, "finished");
  assert.equal(gateRevision(input({ docKind: "performer_resume" }), 2).status, "draft");
  assert.equal(lengthOpenItem(2, 2), null);
});

// ---- the server never trusts a flag ------------------------------------------------------

test("cleanRevisionInput has no field for a status: a sent 'finished' changes nothing", () => {
  const withFlag = cleanRevisionInput({ ...finishState({ keptTerms: [] }), status: "finished", state: "finished", finished: true, draft: false });
  assert.ok(withFlag.ok);
  assert.equal(computeRevision(withFlag.input).status, "draft");
});

test("a confirmation for a credential the writer never named is dropped (the page's restore filter)", () => {
  const c = cleanRevisionInput(finishState({ confirmedCredentials: [{ name: "CDL Class A", type: "license", when: "2020", text: "CDL Class A license, 2020" }] }));
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
  assert.equal(ex.ok && ex.revision.resume_text, artifactText(content), "the stored content, never a request's text");
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
