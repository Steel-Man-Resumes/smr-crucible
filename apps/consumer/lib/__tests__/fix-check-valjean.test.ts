/**
 * Fix lane "check" (2026-10-24): the six defects the first real walk of
 * Refinery "Check and finish" found, each with the walk's own lines as
 * fixtures (fixtures/valjean-check.ts; every fact fictional). Mock AI only:
 * the verifier's reply is stubbed, no model is called.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildFinishView, changeListEntry, cutTerm, CUT_BY_YOU_NOTE, CUT_EARLIER_NOTE, type DefendAnswer } from "../finish-gate";
import { editInput, type RevisionInput } from "../revision-status";
import { personEvidenceLines, withPersonEvidence } from "../person-evidence";
import { claimInEvidence } from "../evidence-claim";
import { verifyGrounding } from "../grounding-verify";
import { recheckDocs } from "../forge-recheck";
import { saveFinishRevision, type ArtifactLite, type RevisionStore } from "../revision-save";
import { resumeTextToDocument } from "../revision-to-doc";
import { writerSourceFrom } from "../writer-receipt";
import { SUGGEST_FIX_FALLBACK, suggestFixNotice } from "../../components/forge/finish/DefendPanel";
import { runMintCheck } from "@crucible/core/src/resumeMintCheckShared";
import { revisionContentHash, type ArtifactRevision, type InsertRevisionResult, type NewRevision } from "@crucible/core/src/artifactRevision";
import { FINISHED, MASTER, PARENT_CUTS, REVISIONS, SKILLS_LINE, TAILORED, UPLOAD } from "./fixtures/valjean-check";
import { RESUME, SOURCE, allAnswered, finishState } from "./fixtures/revision-run";

const src = (...p: string[]) => readFileSync(join(__dirname, "..", "..", ...p), "utf8");
const thin = { ownWords: UPLOAD, ownResumeText: UPLOAD, credentialsAnswer: "", credentialRows: [] };
const given = withPersonEvidence(thin, personEvidenceLines(MASTER, REVISIONS, "tailored"));
const view = (resumeText: string, ownWords: string, extra: Partial<Parameters<typeof buildFinishView>[0]> = {}) =>
  buildFinishView({ resumeText, ownWords, ownResumeText: UPLOAD, defendAnswers: [], ...extra });
const skillCards = (v: ReturnType<typeof buildFinishView>) => v.groups.filter((g) => g.target === "skill").map((g) => g.line);

// ---- (3) and (6): the person's own evidence set ---------------------------------------------------

test("(6) the evidence set: confirmed Master Draft details and finished resumes, never a draft, an unchecked detail or the resume being checked", () => {
  const lines = personEvidenceLines(MASTER, REVISIONS, "tailored");
  assert.ok(lines.includes(MASTER.facts[0].text));
  assert.ok(lines.includes(MASTER.facts[1].text));
  assert.ok(!lines.includes(MASTER.facts[3].text), "a detail not confirmed is not evidence");
  assert.ok(lines.includes("- Supervise production employees and assign daily work."), "a finished resume's line");
  assert.ok(!lines.some((l) => /whole plant/.test(l)), "an older draft revision is not evidence");
  assert.ok(!lines.some((l) => /Crew supervision/.test(l)), "the resume being checked is never its own evidence");
  assert.ok(!personEvidenceLines({ facts: [{ id: "x", text: "I was incarcerated at a state prison from 2010 to 2014.", status: "confirmed" }] }, []).length, "record lines stay out");
  // Added to the person's words once, as their own paragraph.
  assert.ok(given.ownWords.startsWith(UPLOAD));
  assert.equal(given.ownResumeText, UPLOAD, "the upload is unchanged");
  assert.equal(withPersonEvidence(given, personEvidenceLines(MASTER, REVISIONS, "tailored")).ownWords, given.ownWords, "no line repeated");
});

test("(3) repro: with only the thin upload, the leadership skills each get a cut-only card", () => {
  const cards = skillCards(view(TAILORED, UPLOAD));
  for (const t of ["Crew supervision", "Work assignment and task delegation"]) assert.ok(cards.includes(t), `${t}: ${JSON.stringify(cards)}`);
});

test("(3) with the evidence he gave, a skill it supports is never flagged; one word it does not support is named", () => {
  const v = view(TAILORED, given.ownWords);
  const cards = skillCards(v);
  assert.ok(!cards.includes("Crew supervision"), JSON.stringify(cards));
  assert.ok(!cards.includes("Work assignment and task delegation"), JSON.stringify(cards));
  // "mentoring" is in no confirmed detail (his mentoring detail is not checked yet): still asked, and named.
  const mentor = v.groups.find((g) => g.line === "Training and mentoring new workers");
  assert.ok(mentor, JSON.stringify(cards));
  assert.ok(mentor!.items.some((i) => /"mentoring" isn't in anything you told us/.test(i.why)), JSON.stringify(mentor!.items.map((i) => i.why)));
  // The same mint check, read directly: the skills-term rule.
  const findings = runMintCheck({ output: TAILORED, source: given.ownWords, kind: "resume" }).findings.filter((f) => f.kind === "grid_scope_term").map((f) => f.line);
  assert.deepEqual(findings, ["Training and mentoring new workers"]);
});

test("(3) the skills-term rule still asks when the evidence does not say it: a title, a goal, help, another family", () => {
  const flagged = (own: string, term: string) =>
    runMintCheck({ output: `JV\n\nSKILLS\n${term} | Forklift operation`, source: `Jean Valjean\nI drove a forklift.\n${own}`, kind: "resume" }).findings.some((f) => f.line === term && f.kind === "grid_scope_term");
  assert.equal(flagged("I was the crew supervisor.", "Crew supervision"), true);
  assert.equal(flagged("I want a job where I supervise a crew.", "Crew supervision"), true);
  assert.equal(flagged("I helped assign tasks to the crew.", "Work assignment and task delegation"), true);
  assert.equal(flagged("I never assigned the work.", "Work assignment and task delegation"), true);
  assert.equal(flagged("I was assigned the daily work.", "Work assignment and task delegation"), true);
  assert.equal(flagged("I ran the kitchen at night.", "Kitchen supervision"), true);
  assert.equal(flagged("I supervised the dock crew.", "Crew supervision"), false);
  assert.equal(flagged("- Assign daily work to the crew.", "Work assignment and task delegation"), false);
});

test("(6) repro and fix: the title card for his own title, and the job card, read the finished resume", () => {
  const titled = (ownWords: string) => view(TAILORED, ownWords).groups.filter((g) => g.title && /Production Worker/.test(g.line));
  assert.ok(titled(UPLOAD).length >= 1, "repro: asked whether Production Worker was really his title");
  assert.equal(titled(given.ownWords).length, 0, JSON.stringify(titled(given.ownWords)));
});

test("(6) a flagged claim his evidence states is his: word for word (same job), or his job's exact dates beside its employer", () => {
  const letter = "Dear Hiring Team,\n\nBefore this, I was a Production Worker at Digne Lumber & Stone in Milwaukee from June 2015 to March 2019.\n\nI handle hiring, training, and scheduling for the production crew.";
  assert.equal(claimInEvidence("from June 2015 to March 2019", letter, given.ownWords), true);
  assert.equal(claimInEvidence("I handle hiring, training, and scheduling for the production crew", letter, given.ownWords), true);
  assert.equal(claimInEvidence("I manage day-to-day production operations, supervise the production employees, and assign the daily work", letter, given.ownWords), true);
  // Never: other dates, the dates beside another employer, a short phrase, a duty moved to another job.
  assert.equal(claimInEvidence("from June 2014 to March 2019", letter, given.ownWords), false);
  assert.equal(claimInEvidence("from June 2015 to March 2019", "At Madeleine Glassworks from June 2015 to March 2019, I ran the floor.", given.ownWords), false);
  assert.equal(claimInEvidence("Production Worker", letter, given.ownWords), false);
  const moved = TAILORED.replace("- Operated forklift and hoisting equipment.\n", "").replace("- Manage day-to-day production operations.", "- Operated forklift and hoisting equipment.");
  assert.equal(claimInEvidence("Operated forklift and hoisting equipment", moved, FINISHED), false, "a duty never moves between jobs on this rule");
  assert.equal(claimInEvidence("Operated forklift and hoisting equipment", TAILORED, FINISHED), true);
});

test("(6) the second check (stubbed reply) never flags what his evidence states; an invented claim is still flagged", async () => {
  const letter = "Dear Hiring Team,\n\nBefore this, I was a Production Worker at Digne Lumber & Stone in Milwaukee from June 2015 to March 2019.\n\nI handle hiring, training, and scheduling for the production crew. I supervised a crew of 40.\n\nJean Valjean";
  const reply = {
    hasFabrication: true,
    flags: [
      { claim: "from June 2015 to March 2019", why: "dates", kind: "date" },
      { claim: "I handle hiring, training, and scheduling for the production crew", why: "scope", kind: "scope" },
      { claim: "I supervised a crew of 40", why: "number", kind: "number" },
    ],
    cleaned: letter.replace(" I supervised a crew of 40.", ""),
  };
  const realFetch = globalThis.fetch;
  const realKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "test-token-not-a-key";
  globalThis.fetch = (async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(reply) } }] }), { status: 200, headers: { "Content-Type": "application/json" } })) as typeof fetch;
  try {
    const r = await verifyGrounding({ sourceText: given.ownWords, output: letter, kind: "cover_letter" });
    assert.deepEqual(r.flags.map((f) => f.claim), ["I supervised a crew of 40"]);
    assert.equal(r.hasFabrication, true);
  } finally {
    globalThis.fetch = realFetch;
    if (realKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = realKey;
  }
});

test("(6) the check page: a second-check claim his evidence states raises no card", () => {
  const grounding = { verifierRan: true, outcomes: [{ claim: "Handle hiring, training, and scheduling for the production crew", doc: "resume", status: "still_there" }] };
  const before = view(TAILORED, UPLOAD, { grounding, written: { resume: TAILORED, letter: "" } });
  assert.ok(before.openItems.some((i) => i.trace), "repro: held on the thin upload");
  const after = view(TAILORED, given.ownWords, { grounding, written: { resume: TAILORED, letter: "" } });
  assert.ok(!after.openItems.some((i) => i.trace), JSON.stringify(after.openItems.filter((i) => i.trace)));
});

// ---- (4): cutting one skill edits only that skill ----------------------------------------------------

test("(4) cutting one skill takes off only that item and keeps every separator and every other item as written", () => {
  const cut = cutTerm(TAILORED, "Crew supervision");
  const line = cut.split("\n").at(-1);
  assert.equal(line, "Training and mentoring new workers | Work assignment and task delegation | Material loading, unloading, and moving | Production recordkeeping and reporting | Equipment and building repair/maintenance");
  assert.equal(cut.replace(line!, ""), TAILORED.replace(SKILLS_LINE, ""), "nothing else on the page changed");
  // The last item takes the separator before it; a middle item the one after it.
  assert.ok(cutTerm(TAILORED, "Equipment and building repair/maintenance").endsWith("| Production recordkeeping and reporting"));
  assert.match(cutTerm(TAILORED, "Work assignment and task delegation"), /new workers \| Material loading, unloading, and moving \|/);
  // The old split on "and" made fragments that raised new cards; none now.
  const v = view(cutTerm(TAILORED, "Crew supervision"), given.ownWords);
  for (const frag of ["mentoring new workers", "task delegation", "Training", "Work assignment"]) assert.ok(!skillCards(v).includes(frag), `${frag}: ${JSON.stringify(skillCards(v))}`);
});

test("(4) a comma line and a half-term still cut the way they did", () => {
  assert.equal(cutTerm("SKILLS\nForklift, Lockout/tagout, Safety\n", "Lockout/tagout"), "SKILLS\nForklift, Safety\n");
  assert.equal(cutTerm("SKILLS\nForklift, pallet jack and hand truck\n", "pallet jack"), "SKILLS\nForklift, hand truck\n");
});

// ---- (5): blockers are read against the page as it is now --------------------------------------------

test("(5) a second-check claim cut from the page never blocks; reworded on one line, that line is the card", () => {
  const claim = "Work assignment and task delegation";
  const grounding = { verifierRan: true, outcomes: [{ claim, doc: "resume", status: "still_there" }] };
  const written = { resume: TAILORED, letter: "" };
  const general = (v: ReturnType<typeof buildFinishView>) => v.general.filter((i) => /Find it on the page/.test(i.question));
  // Cut: gone, nothing held.
  const cut = view(cutTerm(TAILORED, claim), given.ownWords, { grounding, written });
  assert.equal(general(cut).length, 0);
  assert.ok(!cut.openItems.some((i) => i.trace), JSON.stringify(cut.openItems.filter((i) => i.trace)));
  // The whole skills line rewritten in other words: not on the page, so not a blocker.
  const rewritten = TAILORED.replace(SKILLS_LINE, "Production supervision | Employee scheduling | Hiring | Training");
  const r = view(rewritten, given.ownWords, { grounding, written });
  assert.equal(general(r).length, 0, JSON.stringify(r.general));
  assert.ok(!r.openItems.some((i) => i.trace));
  // The old mangled form ("Work assignment, task delegation") still says it: a card on that line, never "Find it".
  const mangled = TAILORED.replace(SKILLS_LINE, "Crew supervision, Work assignment, task delegation, Hiring");
  const m = view(mangled, given.ownWords, { grounding, written });
  assert.equal(general(m).length, 0, JSON.stringify(m.general));
  const card = m.groups.find((g) => g.items.some((i) => (i as { trace?: boolean }).trace));
  assert.ok(card && card.line === "Crew supervision, Work assignment, task delegation, Hiring", JSON.stringify(m.groups.map((g) => g.line)));
  assert.ok(card!.items.some((i) => /still says it in other words/.test(i.question)));
});

// ---- (2): "You chose to leave this line out" only for the person's own cut ---------------------------

test("(2) a Tailor result never carries its parent's cut answers; the same resume keeps its own", () => {
  const base = {
    docKind: "resume", lengthChoice: "auto", resumeText: FINISHED, letterText: "", keptTerms: [], confirmedCredentials: [],
    defendAnswers: PARENT_CUTS as DefendAnswer[],
    evidence: { ownWords: UPLOAD, written: null, grounding: null, withheldLines: [], keepInsideLines: false, addedTerms: [], credentialCutRemnants: [], credentialsAnswer: "", credentialRows: [], ownResumeText: UPLOAD, writerReceipt: "", writerVerified: false },
  } as unknown as RevisionInput;
  const fork = editInput(base, TAILORED, "", { fork: true });
  assert.ok(fork.ok);
  assert.equal(fork.ok && fork.input.defendAnswers.filter((a) => a.verdict === "cut").length, 0);
  const same = editInput(base, TAILORED, "");
  assert.ok(same.ok);
  assert.equal(same.ok && same.input.defendAnswers.filter((a) => a.verdict === "cut").length, 2, "on the same resume they are the person's own");
});

test("(2) the before-and-after list says 'You chose' only for a cut made on this page; otherwise what the system knows", () => {
  const carried = PARENT_CUTS[0] as DefendAnswer;
  assert.deepEqual(changeListEntry(carried, new Set()), { after: "Not on this page", note: CUT_EARLIER_NOTE });
  assert.deepEqual(changeListEntry(carried, new Set([carried.line])), { after: "Removed from the page", note: CUT_BY_YOU_NOTE });
  assert.equal(changeListEntry(carried, null).note, CUT_BY_YOU_NOTE, "the Forge finish: every cut there is the person's tap");
  assert.doesNotMatch(CUT_EARLIER_NOTE, /you chose/i);
  const page = src("app", "(forge)", "output", "page.tsx");
  assert.match(page, /changeListEntry\(a, checkMode \? cutHere : null\)\.note/);
  assert.doesNotMatch(page, /"You chose to leave this line out\."/, "the copy lives in one place");
  assert.match(page, /setCutHere\(\(c\) => new Set\(c\)\.add\(group\.line\.trim\(\)\)\)/);
  assert.match(page, /setCutHere\(\(c\) => new Set\(c\)\.add\(line\.trim\(\)\)\)/);
});

// ---- (2), (3), (6) through the server path: Check and finish on a Tailor result ----------------------

const UID = "00000000-0000-4000-8000-0000000000a1";
function store(arts: ArtifactLite[]) {
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
  };
  return { s, revs };
}

test("(2)(3)(6) Check and finish on a Tailor result: the saved check reads his finished resume and confirmed details, and carries no parent cut", async () => {
  const arts: ArtifactLite[] = [];
  const { s, revs } = store(arts);
  // His finished Forge resume, with a line he cut there.
  const cutThere = { line: "- Scrubbed the walk-in cooler every night.", answer: "", verdict: "cut" };
  const saved = await saveFinishRevision(UID, finishState({ defendAnswers: [...allAnswered(), cutThere] }), { source: "forge_finish" }, s);
  assert.ok(saved.ok && saved.revision.status === "finished");
  const forge = arts[0];
  // A Tailor result made from it, with a skill only his confirmed detail supports.
  const tailored = `${RESUME.replace("Inventory control", "Training new cooks")}`;
  const fork: ArtifactLite = { id: "00000000-0000-4000-8000-0000000000f2", artifact_type: "resume", target_context: { source: "job" }, content: resumeTextToDocument(tailored) as unknown as Record<string, unknown>, parent_artifact_id: forge.id };
  arts.push(fork);
  const master = { facts: [{ id: "m1", text: "I trained the new cooks on the grill every week.", status: "confirmed" }] };
  s.personEvidence = async (_u, exclude) => personEvidenceLines(master, revs, exclude);
  const noFlags = async () => ({ text: "", hasFabrication: false, applied: false, flags: [], verifierRan: true });
  let n = 0;
  const r = await recheckDocs({ kind: "artifact", artifactId: fork.id }, UID, { verify: noFlags as never, random: () => (++n).toString(16).padStart(32, "0"), store: s });
  assert.ok(r.ok, JSON.stringify(r));
  const checked = revs.filter((x) => x.artifact_id === fork.id).at(-1)!;
  const ev = checked.evidence as { ownWords: string };
  assert.match(ev.ownWords, /I trained the new cooks on the grill every week\./, "a confirmed Master Draft detail");
  assert.match(ev.ownWords, /Ran the grill on the breakfast line\./, "a line of his finished resume");
  assert.ok(!(checked.defend_answers as DefendAnswer[]).some((a) => a.verdict === "cut"), "the parent's cut is not this resume's");
  assert.ok(!(checked.open_items as string[]).some((i) => /Training new cooks/.test(i)), JSON.stringify(checked.open_items));
});

// ---- (7): t.ROY's draft that could not be made is said on the card -----------------------------------

test("(7) a suggest-fix 422 or a failed call shows a plain line on the card, never nothing", () => {
  const server = "I could not make a safe suggestion from your page. You can add one true detail, use your own wording, or cut this line.";
  assert.equal(suggestFixNotice(server), server);
  assert.equal(suggestFixNotice(""), SUGGEST_FIX_FALLBACK);
  assert.equal(suggestFixNotice("Could not draft this line."), SUGGEST_FIX_FALLBACK);
  assert.doesNotMatch(SUGGEST_FIX_FALLBACK, /[\u2014\u2013]|--/);
  const panel = src("components", "forge", "finish", "DefendPanel.tsx");
  // The notice is set on every failure, the automatic first ask too, and the idle card renders it.
  assert.match(panel, /setNotice\(suggestFixNotice\(/);
  assert.match(panel, /data-testid="suggest-fix-notice"/);
  assert.match(panel, /response\.json\(\)\.catch\(\(\) => null\)/, "a non-JSON reply is a plain line, not a parse error");
  const route = src("app", "api", "forge", "suggest-fix", "route.ts");
  assert.match(route, /status: 422/);
  assert.match(route, /NextResponse\.json\(\{ error: "I could not make a safe suggestion/);
});
