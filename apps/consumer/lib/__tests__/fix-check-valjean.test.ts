/**
 * Fix lane "check" (2026-10-24): the six defects the first real walk of
 * Refinery "Check and finish" found, each with the walk's own lines as
 * fixtures (fixtures/valjean-check.ts; every fact fictional), and fix round 1
 * after review (B1 to B5, S2 to S6, N1, N2, Q6). Mock AI only: the verifier's
 * reply is stubbed, no model is called.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { buildFinishView, changeListEntry, cutTerm, finishedLineWhy, CUT_BY_YOU_NOTE, CUT_EARLIER_NOTE, type DefendAnswer } from "../finish-gate";
import { editInput, inputFromRevision, type RevisionInput } from "../revision-status";
import { finishedLinesOf, personEvidenceFrom } from "../person-evidence";
import { NO_PERSON_EVIDENCE, type PersonEvidence } from "../person-evidence-shape";
import { claimInEvidence } from "../evidence-claim";
import { verifyGrounding } from "../grounding-verify";
import { recheckDocs } from "../forge-recheck";
import { loadCheckSource } from "../revision-check";
import { saveFinishRevision, type ArtifactLite, type RevisionStore } from "../revision-save";
import { resumeTextToDocument } from "../revision-to-doc";
import { writerSourceFrom } from "../writer-receipt";
import { IdleActions, suggestFixNotice } from "../../components/forge/finish/DefendPanel";
import { ApprovedChanges } from "../../components/forge/finish/ApprovedChanges";
import { runMintCheck } from "@crucible/core/src/resumeMintCheckShared";
import { revisionContentHash, type ArtifactRevision, type InsertRevisionResult, type NewRevision } from "@crucible/core/src/artifactRevision";
import { ARTIFACTS, FINISHED, FINISHED_WITH_RECORD, MASTER, PARENT_CUTS, REVISIONS, SKILLS_LINE, TAILORED, UPLOAD } from "./fixtures/valjean-check";
import { RESUME, SOURCE, allAnswered, finishState } from "./fixtures/revision-run";

const pe = personEvidenceFrom(MASTER, REVISIONS, ARTIFACTS, "tailored");
const view = (resumeText: string, extra: Partial<Parameters<typeof buildFinishView>[0]> = {}) =>
  buildFinishView({ resumeText, ownWords: UPLOAD, ownResumeText: UPLOAD, defendAnswers: [], ...extra });
const withFacts = { personFacts: pe.facts, unconfirmedFacts: pe.unconfirmed, finishedLines: pe.finished };
const skillCards = (v: ReturnType<typeof buildFinishView>) => v.groups.filter((g) => g.target === "skill").map((g) => g.line);
const traced = (v: ReturnType<typeof buildFinishView>) => v.openItems.filter((i) => (i as { trace?: boolean }).trace);

// ---- the evidence set ---------------------------------------------------------------------------

test("evidence: confirmed details are facts; unconfirmed details are pointers only; finished resumes are separate blocks", () => {
  assert.deepEqual(pe.facts, MASTER.facts.filter((f) => f.status === "confirmed").map((f) => f.text));
  assert.deepEqual(pe.unconfirmed, [MASTER.facts[3].text]);
  assert.deepEqual(pe.finished.map((b) => b.name), ["your Forge resume"]);
  assert.ok(pe.finished[0].lines.includes("- Supervise production employees and assign daily work."));
  assert.ok(!pe.finished.some((b) => b.lines.some((l) => /whole plant/.test(l))), "an older draft is never evidence");
  assert.ok(!pe.finished.some((b) => b.lines.some((l) => /Crew supervision/.test(l))), "the resume being checked is never its own evidence");
});

test("S2: a resume counts only when its NEWEST version is finished", () => {
  assert.ok(!pe.finished.some((b) => b.lines.some((l) => /Trained 12 new hires/.test(l))), "finished once, then a newer draft: not counted");
});

test("B2: a job block about the record goes whole, header and every line under it, never onto the job above", () => {
  const lines = finishedLinesOf(FINISHED_WITH_RECORD);
  assert.ok(lines.includes("- Operated forklift and hoisting equipment."));
  for (const gone of ["Kitchen Lead | Stanley Correctional Institution, 2010 - 2014", "- Supervised a crew of twelve kitchen workers on every shift.", "- Planned weekly menus and ordered food for 1,500 meals a day."]) {
    assert.ok(!lines.includes(gone), gone);
  }
  assert.ok(lines.includes("SKILLS"), "the next section stays");
  const two = personEvidenceFrom(null, [
    { artifact_id: "a", status: "finished", resume_text: FINISHED_WITH_RECORD, created_at: "2026-10-01T00:00:00Z", revision_number: 1 },
    { artifact_id: "b", status: "finished", resume_text: FINISHED, created_at: "2026-10-02T00:00:00Z", revision_number: 1 },
  ], [], "x");
  assert.equal(two.finished.length, 2, "one block per resume");
});

test("S1 ruling: a finished line never clears a card by itself; the card says where it was finished", () => {
  const grounding = { verifierRan: true, outcomes: [{ claim: "Supervise production employees and assign daily work", doc: "resume", status: "still_there", kind: "scope" }] };
  const written = { resume: TAILORED, letter: "" };
  const v = view(TAILORED, { grounding, written, finishedLines: pe.finished });
  const t = traced(v);
  assert.equal(t.length, 1, "still open: checked once is not evidence");
  assert.equal(t[0].why, finishedLineWhy("your Forge resume"));
  assert.equal(t[0].question, view(TAILORED, { grounding, written }).openItems.find((i) => (i as { trace?: boolean }).trace)!.question, "the same answer path");
  // The skills cards are not cleared by finished lines either.
  assert.ok(skillCards(view(TAILORED, { finishedLines: pe.finished })).includes("Crew supervision"));
});

// ---- (3) skills ---------------------------------------------------------------------------------

test("(3) repro: with only the thin upload, the leadership skills each get a cut-only card", () => {
  const cards = skillCards(view(TAILORED));
  for (const t of ["Crew supervision", "Work assignment and task delegation"]) assert.ok(cards.includes(t), `${t}: ${JSON.stringify(cards)}`);
});

test("(3) with his confirmed details, a skill they support is not asked; the one word they do not support is named, with the detail that would settle it", () => {
  const v = view(TAILORED, withFacts);
  const cards = skillCards(v);
  assert.ok(!cards.includes("Crew supervision"), JSON.stringify(cards));
  assert.ok(!cards.includes("Work assignment and task delegation"), JSON.stringify(cards));
  const mentor = v.groups.find((g) => g.line === "Training and mentoring new workers");
  assert.ok(mentor, JSON.stringify(cards));
  const why = mentor!.items.map((i) => i.why).join(" ");
  assert.match(why, /"mentoring" isn't in anything you told us/);
  // Review Q6: the unconfirmed detail that would settle it.
  assert.match(why, /You wrote "I trained and mentored new workers on the rigging crew\." in your Master Draft but haven't confirmed it\. Confirm it there, or cut it\./);
});

test("B3: someone else handing out work never clears the person's delegation skill", () => {
  const flagged = (own: string) =>
    runMintCheck({ output: `JV\n\nSKILLS\nWork assignment and task delegation | Forklift operation`, source: `Jean Valjean\nI drove a forklift.\n${own}`, kind: "resume" }).findings.some((f) => f.line === "Work assignment and task delegation" && f.kind === "grid_scope_term");
  assert.equal(flagged("My supervisor assigned tasks to me every morning."), true);
  assert.equal(flagged("The lead assigned the daily work and I did it."), true);
  assert.equal(flagged("I assign the daily work."), false);
});

// ---- (6) the truth check reads what he gave -------------------------------------------------------

test("(6) the title card for his own title reads his confirmed detail", () => {
  const titled = (extra: Partial<Parameters<typeof buildFinishView>[0]>) => view(TAILORED, extra).groups.filter((g) => g.title && /Production Worker/.test(g.line));
  assert.ok(titled({}).length >= 1, "repro: asked whether Production Worker was really his title");
  assert.equal(titled(withFacts).length, 0);
});

const SRC = `${UPLOAD}\n\n${pe.facts.join("\n")}`;
const NAMED = `${UPLOAD}\n\nAt Madeleine Glassworks I handle hiring, training, and scheduling for the production crew.`;
const CLAIM = "Handle hiring, training, and scheduling for the production crew";
const underDigne = TAILORED.replace("- Handle hiring, training, and scheduling for the production crew.\n", "").replace("- Assisted with repairs to buildings and equipment.", "- Assisted with repairs to buildings and equipment.\n- Handle hiring, training, and scheduling for the production crew.");

test("B1: a detail clears a claim only under the job it names, or in a letter sentence naming no other employer", () => {
  assert.equal(claimInEvidence(CLAIM, TAILORED, NAMED, { kind: "scope" }), true, "under the job the detail names");
  assert.equal(claimInEvidence(CLAIM, underDigne, NAMED, { kind: "scope" }), false, "moved to another employer");
  assert.equal(claimInEvidence(CLAIM, underDigne, SRC, { kind: "scope" }), false, "a detail naming no job never moves onto one");
  assert.equal(claimInEvidence(CLAIM, TAILORED, SRC, { kind: "scope" }), false, "nor onto the right one: it does not say which");
  const letter = (s: string) => `Dear Hiring Team,\n\n${s}\n\nJean Valjean`;
  assert.equal(claimInEvidence("I handle hiring, training, and scheduling for the production crew", letter("I handle hiring, training, and scheduling for the production crew."), SRC, { kind: "scope" }), true);
  assert.equal(claimInEvidence("I handle hiring, training, and scheduling for the production crew at Digne Lumber & Stone", letter("I handle hiring, training, and scheduling for the production crew at Digne Lumber & Stone."), `${SRC}\nI handle hiring, training, and scheduling for the production crew at Digne Lumber & Stone.`, { kind: "scope", employers: ["Digne Lumber & Stone"] }), true, "the detail names that employer");
  assert.equal(claimInEvidence("I handle hiring, training, and scheduling for the production crew", letter("At Digne Lumber & Stone, I handle hiring, training, and scheduling for the production crew."), SRC, { kind: "scope", employers: ["Digne Lumber & Stone"] }), false, "the sentence names an employer the detail does not");
});

test("S3: the override respects the flag: never a number or result, never a supported fragment of an overstated line", () => {
  const over = TAILORED.replace("- Handle hiring, training, and scheduling for the production crew.", "- Led all hiring, training, and scheduling for the production crew of 60 across three plants.");
  assert.equal(claimInEvidence("hiring, training, and scheduling for the production crew", over, NAMED, { kind: "scope" }), false);
  assert.equal(claimInEvidence(CLAIM, TAILORED, NAMED, { kind: "number" }), false);
  assert.equal(claimInEvidence(CLAIM, TAILORED, NAMED, { kind: "result" }), false);
  assert.equal(claimInEvidence(CLAIM, TAILORED, NAMED, { kind: "title" }), false);
});

test("S4: his own dates clear only in a sentence that names exactly one employer, that job's", () => {
  const src = `${FINISHED.replace("SKILLS", "SKILLS")}`; // job blocks with dates (as an upload would carry them)
  const one = "Before this, I was a Production Worker at Digne Lumber & Stone in Milwaukee from June 2015 to March 2019.";
  assert.equal(claimInEvidence("from June 2015 to March 2019", one, src, { kind: "date" }), true);
  assert.equal(claimInEvidence("from June 2015 to March 2019", "I worked at Madeleine Glassworks and Digne Lumber & Stone from June 2015 to March 2019.", src, { kind: "date" }), false);
  assert.equal(claimInEvidence("from June 2015 to March 2019", "At Madeleine Glassworks from June 2015 to March 2019, I ran the floor.", src, { kind: "date" }), false);
  assert.equal(claimInEvidence("from June 2014 to March 2019", one, src, { kind: "date" }), false);
  // A confirmed detail with the dates beside the employer counts the same.
  assert.equal(claimInEvidence("from June 2015 to March 2019", one, SRC, { kind: "date", employers: ["Digne Lumber & Stone"] }), true);
});

async function withVerifierReply<T>(reply: unknown, run: () => Promise<T>): Promise<T> {
  const realFetch = globalThis.fetch;
  const realKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "test-token-not-a-key";
  globalThis.fetch = (async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(reply) } }] }), { status: 200, headers: { "Content-Type": "application/json" } })) as typeof fetch;
  try {
    return await run();
  } finally {
    globalThis.fetch = realFetch;
    if (realKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = realKey;
  }
}

test("(6) and S5: the second check never flags what his confirmed details state, and its rewrite never drops that line", async () => {
  const letter = "Dear Hiring Team,\n\nI handle hiring, training, and scheduling for the production crew.\n\nI supervised a crew of 40 on every shift.\n\nJean Valjean";
  const reply = {
    hasFabrication: true,
    flags: [
      { claim: "I handle hiring, training, and scheduling for the production crew", why: "scope", kind: "scope" },
      { claim: "I supervised a crew of 40 on every shift", why: "number", kind: "number" },
    ],
    cleaned: "Dear Hiring Team,\n\nI work in production.\n\nJean Valjean",
  };
  const r = await withVerifierReply(reply, () => verifyGrounding({ sourceText: SRC, output: letter, kind: "cover_letter" }));
  assert.deepEqual(r.flags.map((f) => f.claim), ["I supervised a crew of 40 on every shift"]);
  assert.equal(r.applied, false, "the rewrite would drop the line the override cleared");
  assert.equal(r.text, letter);
  // Repro of the old miss: with the claim not in his words, it stays a flag and the rewrite applies.
  const r2 = await withVerifierReply(reply, () => verifyGrounding({ sourceText: UPLOAD, output: letter, kind: "cover_letter" }));
  assert.equal(r2.flags.length, 2);
});

// ---- (4) cutting one skill --------------------------------------------------------------------------

test("(4) cutting one skill takes off only that item and keeps every separator and every other item as written", () => {
  const cut = cutTerm(TAILORED, "Crew supervision");
  const line = cut.split("\n").at(-1);
  assert.equal(line, "Training and mentoring new workers | Work assignment and task delegation | Material loading, unloading, and moving | Production recordkeeping and reporting | Equipment and building repair/maintenance");
  assert.equal(cut.replace(line!, ""), TAILORED.replace(SKILLS_LINE, ""), "nothing else on the page changed");
  assert.ok(cutTerm(TAILORED, "Equipment and building repair/maintenance").endsWith("| Production recordkeeping and reporting"));
  const v = view(cutTerm(TAILORED, "Crew supervision"), withFacts);
  for (const frag of ["mentoring new workers", "task delegation", "Training", "Work assignment"]) assert.ok(!skillCards(v).includes(frag), `${frag}: ${JSON.stringify(skillCards(v))}`);
});

test("(4) and N1: a comma line, a half-term and an Oxford comma cut cleanly", () => {
  assert.equal(cutTerm("SKILLS\nForklift, Lockout/tagout, Safety\n", "Lockout/tagout"), "SKILLS\nForklift, Safety\n");
  assert.equal(cutTerm("SKILLS\nForklift, pallet jack and hand truck\n", "pallet jack"), "SKILLS\nForklift, hand truck\n");
  assert.equal(cutTerm("SKILLS\nRigging, heavy lifting, and forklift\n", "heavy lifting"), "SKILLS\nRigging and forklift\n");
});

// ---- (5) and B4: blockers read against the page as it is now ---------------------------------------

test("(5) a second-check claim cut from the page never blocks; reworded on one line, that line is the card", () => {
  const claim = "Work assignment and task delegation";
  const grounding = { verifierRan: true, outcomes: [{ claim, doc: "resume", status: "still_there" }] };
  const written = { resume: TAILORED, letter: "" };
  const general = (v: ReturnType<typeof buildFinishView>) => v.general.filter((i) => /Find it on the page/.test(i.question));
  const cut = view(cutTerm(TAILORED, claim), { grounding, written });
  assert.equal(general(cut).length, 0);
  assert.equal(traced(cut).length, 0);
  const rewritten = view(TAILORED.replace(SKILLS_LINE, "Production supervision | Employee scheduling | Hiring | Training"), { grounding, written });
  assert.equal(traced(rewritten).length, 0);
  const mangled = view(TAILORED.replace(SKILLS_LINE, "Crew supervision, Work assignment, task delegation, Hiring"), { grounding, written });
  assert.equal(general(mangled).length, 0);
  const card = mangled.groups.find((g) => g.items.some((i) => (i as { trace?: boolean }).trace));
  assert.equal(card?.line, "Crew supervision, Work assignment, task delegation, Hiring");
  assert.ok(card!.items.some((i) => /still says it in other words/.test(i.question)));
});

test("B4: a flagged claim reordered on one line, with a word pair on another line too, still blocks", () => {
  const head = "MORGAN SAMPLE\nToledo, OH | morgan@example.com\n\nPROFESSIONAL EXPERIENCE\nLINE COOK | Harbor Street Diner | 2019 - 2023";
  const written = `${head}\n- Cut food waste on the breakfast line by changing prep.\n- Cooked eggs on the breakfast line.`;
  const now = `${head}\n- Cut food waste by changing prep on the breakfast line.\n- Cooked eggs on the breakfast line.`;
  const grounding = { verifierRan: true, outcomes: [{ claim: "Cut food waste on the breakfast line by changing prep", doc: "resume", status: "still_there" }] };
  const v = buildFinishView({ resumeText: now, ownWords: SOURCE, defendAnswers: [], grounding, written: { resume: written, letter: "" } });
  const held = traced(v);
  assert.equal(held.length, 1, JSON.stringify(v.openItems));
  assert.equal(held[0].severity, "BLOCK");
  assert.ok(v.general.some((i) => (i as { trace?: boolean }).trace), "held in the general list");
});

// ---- (2) "You chose to leave this line out" ---------------------------------------------------------

test("(2) a Tailor result never carries its parent's cut answers; the same resume keeps its own", () => {
  const base = {
    docKind: "resume", lengthChoice: "auto", resumeText: FINISHED, letterText: "", keptTerms: [], confirmedCredentials: [],
    defendAnswers: PARENT_CUTS as DefendAnswer[],
    evidence: { ownWords: UPLOAD, written: null, grounding: null, withheldLines: [], keepInsideLines: false, addedTerms: [], credentialCutRemnants: [], credentialsAnswer: "", credentialRows: [], ownResumeText: UPLOAD, writerReceipt: "", writerVerified: false, personFacts: ["x"], finishedLines: [] },
  } as unknown as RevisionInput;
  const fork = editInput(base, TAILORED, "", { fork: true });
  assert.ok(fork.ok);
  assert.equal(fork.ok && fork.input.defendAnswers.filter((a) => a.verdict === "cut").length, 0);
  const same = editInput(base, TAILORED, "");
  assert.ok(same.ok);
  assert.equal(same.ok && same.input.defendAnswers.filter((a) => a.verdict === "cut").length, 2);
  // Review B5: neither an edit nor a fork carries person evidence.
  assert.equal(fork.ok && fork.input.evidence.personFacts, undefined);
  assert.equal(same.ok && same.input.evidence.personFacts, undefined);
});

test("(2) render: the before-and-after list says 'You chose' only for a cut made on this page", () => {
  const carried = PARENT_CUTS[0] as DefendAnswer;
  const html = (cutHere: ReadonlySet<string> | null) => renderToStaticMarkup(React.createElement(ApprovedChanges, { answers: [carried], cutHere, changeNotes: {} }));
  const opened = html(new Set());
  assert.ok(opened.includes(CUT_EARLIER_NOTE.replace(/'/g, "&#x27;")), opened);
  assert.ok(!/You chose/.test(opened), opened);
  assert.ok(opened.includes("Not on this page"));
  assert.ok(html(new Set([carried.line])).includes(CUT_BY_YOU_NOTE));
  assert.ok(html(null).includes(CUT_BY_YOU_NOTE), "the Forge finish: every cut there is the person's tap");
  assert.equal(renderToStaticMarkup(React.createElement(ApprovedChanges, { answers: [], cutHere: null, changeNotes: {} })), "");
  assert.deepEqual(changeListEntry({ line: "- x", answer: "x", verdict: "stands", kind: "assisted", replaced: "- y" }, new Set()).after, "- x");
});

// ---- the server path: Check and finish on a Tailor result ------------------------------------------

const UID = "00000000-0000-4000-8000-0000000000a1";
function store(arts: ArtifactLite[], evidence: () => PersonEvidence) {
  const revs: ArtifactRevision[] = [];
  const s: RevisionStore = {
    listResumeArtifacts: async () => arts,
    getArtifact: async (_u, id) => arts.find((a) => a.id === id) ?? null,
    createForgeArtifact: async (_u, content) => {
      const a = { id: "00000000-0000-4000-8000-0000000000f1", artifact_type: "resume", target_context: { source: "forge" }, content };
      arts.push(a);
      return { id: a.id };
    },
    updateArtifactContent: async (_u, id, content) => {
      const a = arts.find((x) => x.id === id);
      if (a) a.content = content;
      return "updated";
    },
    insertRevision: async (userId: string, r: NewRevision): Promise<InsertRevisionResult> => {
      const mine = revs.filter((x) => x.artifact_id === r.artifactId);
      const row = {
        id: `00000000-0000-4000-8000-00000000e${(100 + revs.length).toString(16)}`, user_id: userId, artifact_id: r.artifactId, revision_number: mine.length + 1,
        source: r.source, doc_kind: r.docKind, resume_text: r.resumeText, letter_text: r.letterText, kept_terms: r.keptTerms,
        confirmed_credentials: r.confirmedCredentials, defend_answers: r.defendAnswers, evidence: r.evidence, checker_version: r.checkerVersion,
        status: r.status, page_count: r.pageCount, page_limit: r.pageLimit, length_choice: r.lengthChoice, open_items: r.openItems, content_hash: revisionContentHash(r), created_at: `2026-10-24T00:00:0${revs.length}Z`,
      } as ArtifactRevision;
      revs.push(row);
      return { status: "saved", revision: row, reused: false };
    },
    getLatestRevision: async (_u, id) => revs.filter((x) => x.artifact_id === id).at(-1) ?? null,
    listRevisions: async (_u, id) => revs.filter((x) => x.artifact_id === id),
    serverSource: async () => writerSourceFrom({ resumeText: SOURCE, goalNarrative: "I want to keep cooking." }),
    personEvidence: async () => evidence(),
  };
  return { s, revs };
}

test("B5 and (2)(3)(6): Check and finish reads his confirmed detail fresh each time, keeps it out of ownWords, and drops it when he withdraws it", async () => {
  const detail = "I trained the new cooks on the grill every week.";
  let current: PersonEvidence = { facts: [detail], unconfirmed: [], finished: [] };
  const arts: ArtifactLite[] = [];
  const { s, revs } = store(arts, () => current);
  const cutThere = { line: "- Scrubbed the walk-in cooler every night.", answer: "", verdict: "cut" };
  const saved = await saveFinishRevision(UID, finishState({ defendAnswers: [...allAnswered(), cutThere] }), { source: "forge_finish" }, s);
  assert.ok(saved.ok && saved.revision.status === "finished");
  const tailored = RESUME.replace("Inventory control", "Training new cooks");
  const fork: ArtifactLite = { id: "00000000-0000-4000-8000-0000000000f2", artifact_type: "resume", target_context: { source: "job" }, content: resumeTextToDocument(tailored) as unknown as Record<string, unknown>, parent_artifact_id: arts[0].id };
  arts.push(fork);
  const noFlags = async () => ({ text: "", hasFabrication: false, applied: false, flags: [], verifierRan: true });
  let n = 0;
  const random = () => (++n).toString(16).padStart(32, "0");
  const check = async () => {
    const r = await recheckDocs({ kind: "artifact", artifactId: fork.id }, UID, { verify: noFlags as never, random, store: s });
    assert.ok(r.ok, JSON.stringify(r));
    return revs.filter((x) => x.artifact_id === fork.id).at(-1)!;
  };
  const first = await check();
  const ev1 = first.evidence as { ownWords: string; personFacts?: string[] };
  assert.deepEqual(ev1.personFacts, [detail], "its own field");
  assert.ok(!ev1.ownWords.includes(detail), "never in ownWords");
  assert.ok(!(first.defend_answers as DefendAnswer[]).some((a) => a.verdict === "cut"), "the parent's cut is not this resume's");
  assert.ok(!(first.open_items as string[]).some((i) => /Training new cooks/.test(i)), JSON.stringify(first.open_items));
  // A fork made from this checked version carries none of it.
  const forked = editInput(inputFromRevision(first), tailored, "", { fork: true });
  assert.ok(forked.ok && forked.input.evidence.personFacts === undefined && !forked.input.evidence.ownWords.includes(detail));
  // He sets the detail back to "needs check": the next load and the next check read it as gone.
  current = { facts: [], unconfirmed: [detail], finished: [] };
  const loaded = await loadCheckSource(UID, fork.id, s);
  assert.ok(loaded.ok && (loaded.source.evidence.personFacts ?? []).length === 0, "the load is fresh");
  const second = await check();
  assert.ok((second.open_items as string[]).some((i) => /Training new cooks/.test(i)), JSON.stringify(second.open_items));
  assert.ok(!(second.evidence as { ownWords: string }).ownWords.includes(detail));
  void NO_PERSON_EVIDENCE;
});

// ---- (7) and N2: t.ROY's draft that could not be made is said on the card, in the card's own buttons ---

test("(7) and N2 render: the notice shows under the buttons and names only the buttons the card shows", () => {
  const render = (answerable: boolean) => {
    const notice = suggestFixNotice({ answerable });
    return { notice, html: renderToStaticMarkup(React.createElement(IdleActions, { target: "resume", answerable, suggesting: false, notice, onDraft() {}, onAnswer() {}, onChange() {}, onCut() {} })) };
  };
  const yes = render(true);
  assert.ok(yes.html.includes('data-testid="suggest-fix-notice"'));
  assert.ok(yes.html.includes("This is true as written") && /true as written, change it, or cut it/.test(yes.notice));
  const no = render(false);
  assert.ok(!no.html.includes("This is true as written"), no.html);
  assert.ok(no.html.includes("Change it") && no.html.includes("Cut it"));
  assert.match(no.notice, /Change it or cut it\.$/);
  assert.doesNotMatch(no.notice, /true/);
  // While t.ROY is still drafting, no notice.
  assert.ok(!renderToStaticMarkup(React.createElement(IdleActions, { target: "resume", answerable: true, suggesting: true, notice: "x", onDraft() {}, onAnswer() {}, onChange() {}, onCut() {} })).includes("suggest-fix-notice"));
  for (const n of [yes.notice, no.notice]) assert.doesNotMatch(n, /[\u2014\u2013]|--/);
});
