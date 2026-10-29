/**
 * Phase 5 lane R2: lanes first (Troy 2026-10-10; Codex review section C),
 * the immediate reward, "Check and finish", and the Get support view.
 *
 * Every test here fails on e11fb6f (the modules, routes and copy are new).
 * Fictional people only (Morgan Sample, example.com). No AI, no database.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { planForgePath, previousPath, isLanesFirst, nextPath } from "../forge-path";
import {
  TASK_COPY,
  MAIN_TASKS,
  OTHER_TASKS,
  FIRST_SCREEN_TITLE,
  HELP_LINK_LABEL,
  SOMETHING_ELSE_LABEL,
  DRAFT_BADGE,
  CHECK_AND_FINISH_LABEL,
  INTAKE_HAVE_ONE,
  INTAKE_BUILD,
  laneHeaderLine,
  routeHref,
  nextActionFor,
  decisionsToFirstSave,
} from "../lane-task";
import { applyFirstFix, checkFirstSection, firstSectionText, pickFirstFix } from "../first-fix";
import { readSupportResponse } from "../../components/lanes/SupportSearch";
import { laneHomeNext } from "../../components/lanes/LaneHome";
import { loadCheckSource, saveCheckRevision } from "../revision-check";
import { recheckDocs } from "../forge-recheck";
import { writerSourceFrom } from "../writer-receipt";
import { saveFinishRevision, type ArtifactLite, type RevisionStore } from "../revision-save";
import { resumeTextToDocument } from "../revision-to-doc";
import { saveFirstSection, listVersions, restoreVersion, type LaneFirstStore } from "../lane-first-save";
import { refineryOpenWithoutResume, keepGoingHref, savedWorkHref, taskNeedsResume, forgeStartUrl } from "../lane-task";
import { revisionContentHash, type ArtifactRevision, type InsertRevisionResult, type NewRevision } from "@crucible/core/src/artifactRevision";
import { RESUME, SOURCE, finishState, allAnswered, OWN_WORDS } from "./fixtures/revision-run";
import { FORGE_SIGN_IN_PAGES } from "../forge-access";
import { recordTitleYes } from "../finish-gate";
import { CLIENT_PATH } from "../forge-front-door";

const root = join(import.meta.dirname, "..", "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");
const UID = "00000000-0000-4000-8000-0000000000a1";

// ---- the first screen -------------------------------------------------------------

test("first screen: 'What do you need today?', four main routes in Troy's words (one for having no lane yet), a quieter Something else, a quiet help link", () => {
  assert.equal(FIRST_SCREEN_TITLE, "What do you need today?");
  // Troy 2026-10-23: "I don't know what I want yet" is a main-sized choice, not hidden under Something else.
  assert.deepEqual(MAIN_TASKS.map((t) => TASK_COPY[t].label), ["Get a resume I can use", "Go after a job", "Get ready for an interview", "I don't know what I want yet"]);
  assert.deepEqual([...OTHER_TASKS], ["documents", "support"]);
  assert.match(TASK_COPY.documents.label, /Creative work, a CV, or a performer page/);
  assert.equal(TASK_COPY.explore.label, "I don't know what I want yet");
  assert.equal(TASK_COPY.support.label, "Get support");
  assert.equal(SOMETHING_ELSE_LABEL, "Something else");
  assert.equal(HELP_LINK_LABEL, "Something getting in the way? Get help");
  const picker = read("components/lanes/TaskPicker.tsx");
  assert.match(picker, /MAIN_TASKS\.map/);
  assert.match(picker, /aria-expanded=\{more\}/, "Something else is folded until asked for");
});

test("the Forge front door and old /welcome links land on the first screen; /start is walled with the other Forge screens", () => {
  assert.equal(CLIENT_PATH.route, "/start");
  assert.ok((FORGE_SIGN_IN_PAGES as readonly string[]).includes("/start"));
  assert.match(read("middleware.ts"), /"\/start",/);
  const welcome = read("app/(forge)/welcome/page.tsx");
  assert.match(welcome, /router\.replace\("\/start"\)/);
  assert.match(welcome, /const toStart = !isDemo && !session\.isDemo/, "the partner walkthrough keeps the readiness page");
  assert.ok(existsSync(join(root, "app/(forge)/start/page.tsx")));
});

test("the dashboard asks first, then becomes the lane home with All tools second", () => {
  const d = read("app/(dashboard)/dashboard/page.tsx");
  const picker = d.indexOf("<TaskPicker");
  const profile = d.indexOf("<ProfileSetup contact");
  assert.ok(picker > 0 && profile > picker, "the question comes before the profile form");
  const home = d.indexOf("{focus.task ? <LaneHome");
  const work = d.indexOf("<SavedJobsPanel");
  assert.ok(home > 0 && work > home, "current goal precedes saved applications");
  assert.doesNotMatch(d, /All tools\n/);
  assert.match(read("lib/refinery-nav.ts"), /legacyId: "refinery-nav-jobs"/);
  assert.match(read("app/(dashboard)/RefineryShell.tsx"), /<RefineryBoard/);
});

// ---- the lane header --------------------------------------------------------------

test("lane header: 'Working toward: <target or a job> · Today: <task>', with Change, on Forge and Refinery screens", () => {
  assert.deepEqual(laneHeaderLine("resume", null), { toward: "a job", today: "your resume" });
  assert.deepEqual(laneHeaderLine("job", "  forklift   driver "), { toward: "forklift driver", today: "going after a job" });
  const h = read("components/lanes/LaneHeader.tsx");
  assert.match(h, /Working toward:/);
  assert.match(h, /Today:/);
  assert.match(h, /Change/);
  assert.match(read("app/(forge)/ForgeShell.tsx"), /<ForgeLaneHeader \/>/);
  assert.match(read("app/(dashboard)/RefineryShell.tsx"), /<RefineryLaneHeader state=\{onboarding.state\} \/>/);
});

// ---- routes -----------------------------------------------------------------------

test("routes: resume goes to intake; the job route has one small step; interview practices when a resume is on file", () => {
  const out = { signedIn: false, hasResume: false };
  assert.equal(routeHref("resume", out), "/resume");
  assert.equal(routeHref("job", out), "/start?step=job");
  assert.equal(routeHref("interview", out), "/login?from=forge&callbackUrl=%2Fdashboard%2Finterview");
  assert.equal(routeHref("interview", { signedIn: true, hasResume: true }), "/dashboard/interview");
  assert.equal(routeHref("support", { signedIn: true, hasResume: false }), "/dashboard/resources#support");
  assert.equal(routeHref("support", out), "/start?step=support", "help without finishing a resume first");
});

test("Rush is the job route's 'short on time' branch, not its own entrance", () => {
  const start = read("app/(forge)/start/page.tsx");
  assert.match(start, /data-testid="rush-branch"/);
  assert.match(start, /Job in mind and short on time\?/);
  assert.doesNotMatch(read("components/lanes/TaskPicker.tsx"), /rush/i);
});

// ---- the path: no readiness, no short/full, nothing before the first page ---------

test("lanes-first path: resume, a short SMR direction check, then build; optional screens only when asked", () => {
  const ids = (s: Parameters<typeof planForgePath>[0]) => planForgePath(s).screens.map((x) => x.id);
  // Troy 2026-10-20: the story questions (what is in the way, the record, goals and wants) are back on every lanes-first run, all skippable.
  assert.deepEqual(ids({ laneTask: "resume", readinessStage: "preparation" }), ["resume", "goals", "story", "processing", "output"]);
  assert.deepEqual(ids({ laneTask: "job", readinessStage: "action" }), ["resume", "goals", "story", "processing", "output"]);
  assert.deepEqual(ids({ laneTask: "resume", pathExtras: ["goals", "preferences"] }), ["resume", "goals", "story", "preferences", "processing", "output"]);
  assert.deepEqual(ids({ laneTask: "resume", pathExtras: ["story"] }), ["resume", "goals", "story", "processing", "output"]);
  const p = planForgePath({ laneTask: "resume" });
  assert.equal(previousPath(p, "resume", { laneTask: "resume" }), "/start");
  assert.equal(nextPath(p, "resume"), "/goals");
  assert.equal(nextPath(p, "goals"), "/story");
  assert.equal(nextPath(p, "story"), "/processing");
  // Old runs and the demo walkthrough are untouched.
  assert.equal(isLanesFirst({ laneTask: "resume", isDemo: true }), false);
  assert.deepEqual(ids({ readinessStage: "preparation" }), ["resume", "goals", "story", "preferences", "processing", "output"]);
});

// ---- intake: two choices, help in a panel, no outside-builder detour --------------

test("intake: 'I have one' and 'Build with me' only; LinkedIn, Indeed, IRS, Work Number and Credly move into Help", () => {
  assert.equal(INTAKE_HAVE_ONE.label, "I have one");
  assert.equal(INTAKE_BUILD.label, "Build with me");
  const page = read("app/(forge)/resume/page.tsx");
  const lanes = page.slice(page.indexOf("// --- Path Selection, lanes first"), page.indexOf("// --- Path Selection ---"));
  assert.equal((lanes.match(/data-testid="intake-(have-one|build)"/g) || []).length, 2);
  assert.doesNotMatch(lanes, /setActivePath\("(import|external|paste|guided)"\)/, "no third route");
  assert.match(lanes, /<IntakeHelp \/>/);
  const help = read("components/forge/lanes/IntakeExtras.tsx");
  for (const s of ["LinkedIn", "Indeed", "irs.gov", "theworknumber.com", "credly.com"]) assert.ok(help.includes(s), s);
  assert.doesNotMatch(help, /canva\.com|Free resume builders/i, "the outside-builder detour is gone from the main path");
});

// ---- the immediate reward ----------------------------------------------------------

const PAGE_NO_CONTACT = `Morgan Sample
Work History
LINE COOK | Harbor Street Diner | 2019 - 2023
- Ran the grill on the breakfast line.`;

test("first fix: a page with no way to reach the person asks for it, and only what they typed goes on the page", () => {
  const fix = pickFirstFix(PAGE_NO_CONTACT);
  assert.equal(fix.kind, "add_contact");
  assert.deepEqual(applyFirstFix(PAGE_NO_CONTACT, fix, "  "), { ok: false, problem: "empty" });
  assert.deepEqual(applyFirstFix(PAGE_NO_CONTACT, fix, "call me maybe"), { ok: false, problem: "not_contact" });
  const r = applyFirstFix(PAGE_NO_CONTACT, fix, "morgan@example.com");
  assert.ok(r.ok);
  const before = new Set(PAGE_NO_CONTACT.split("\n"));
  const added = r.ok ? r.text.split("\n").filter((l) => !before.has(l)) : [];
  assert.deepEqual(added, ["morgan@example.com"], "nothing added but the person's own words");
  assert.equal(r.ok && r.text.split("\n")[1], "morgan@example.com", "right under the name");
});

test("first fix: jobs with no section name get 'Work History' above them, only on the person's tap", () => {
  const page = `Morgan Sample\nmorgan@example.com\nLINE COOK | Harbor Street Diner | 2019 - 2023\n- Ran the grill.`;
  const fix = pickFirstFix(page);
  assert.equal(fix.kind, "add_heading");
  const r = applyFirstFix(page, fix, fix.start);
  assert.ok(r.ok && r.text.split("\n")[2] === "WORK HISTORY");
});

test("first fix: a rule the page breaks is handed back to change; empty takes the line off; the same line is refused", () => {
  const page = `Morgan Sample\nmorgan@example.com\nWork History\nLINE COOK | Harbor Street Diner | 2019 - \n- Ran the grill on the breakfast line.`;
  const fix = pickFirstFix(page, Date.parse("2026-10-10"));
  assert.equal(fix.kind, "edit_line");
  assert.ok(fix.line);
  assert.deepEqual(applyFirstFix(page, fix, fix.line!), { ok: false, problem: "unchanged" });
  const typed = "LINE COOK | Harbor Street Diner | 2019 - 2023";
  const r = applyFirstFix(page, fix, typed);
  assert.ok(r.ok && r.text.includes(typed) && !r.text.includes(fix.line + "\n"));
  const cut = applyFirstFix(page, fix, "");
  assert.ok(cut.ok && !cut.text.split("\n").includes(fix.line!));
});

test("first fix: a page that passes says so and saves as it is", () => {
  const page = `Morgan Sample\nToledo, OH | morgan@example.com\n\nWork History\nLINE COOK | Harbor Street Diner | 2019 - 2023\n- Ran the grill on the breakfast line.`;
  assert.equal(pickFirstFix(page, Date.parse("2026-10-10")).kind, "none");
});

test("Build with me: one job and one true duty become a first section, word for word", () => {
  const f = { name: "Morgan Sample", contact: "morgan@example.com", title: "Line cook", employer: "Harbor Street Diner", years: "2019 to 2023", duty: "I ran the grill on the breakfast line." };
  assert.deepEqual(checkFirstSection({ ...f, duty: "" }), { ok: false, missing: ["duty"] });
  assert.deepEqual(checkFirstSection({ ...f, name: " ", title: "", employer: "" }), { ok: false, missing: ["name", "title"] });
  const text = firstSectionText(f);
  assert.equal(text, "Morgan Sample\nmorgan@example.com\n\nWORK HISTORY\nLine cook | Harbor Street Diner | 2019 to 2023\n- I ran the grill on the breakfast line.");
});

test("H2: the first save is DRAFT: the page is never its own evidence; only what the person typed counts as theirs", async () => {
  const f = laneStore();
  // Build with me: the one duty is what they typed.
  const text = firstSectionText({ name: "Morgan Sample", contact: "morgan@example.com", title: "Line cook", employer: "Harbor Street Diner", years: "2019 to 2023", duty: "I ran the grill on the breakfast line." });
  const r = await saveFirstSection(UID, { text, typed: "I ran the grill on the breakfast line.", keep: undefined }, f.store);
  assert.ok(r.ok);
  assert.equal(r.ok && r.revision.number, 1);
  assert.equal(r.ok && r.revision.status, "draft", "a first section is a draft until its lines are answered on the finish page");
  // The page is never its own evidence. R1 now works the person's words out on
  // the server (their stored upload and answers) when it holds them; the
  // request's part is only what they typed here.
  const ev = f.revs.at(-1)!.evidence as { ownWords?: string; ownResumeText?: string };
  assert.ok(!(ev.ownWords ?? "").includes("WORK HISTORY"), "the saved page is not counted as their words");
  assert.notEqual(ev.ownWords, text);
  assert.deepEqual(f.revs.at(-1)!.defend_answers, []);
  // With no words held on the server, R1 trusts none from a request: still never the page.
  const bare = laneStore();
  delete (bare.store as { serverSource?: unknown }).serverSource;
  await saveFirstSection(UID, { text, typed: text, keep: undefined }, bare.store);
  assert.ok(!((bare.revs.at(-1)!.evidence as { ownWords?: string }).ownWords ?? "").includes("WORK HISTORY"));
  assert.equal(bare.revs.at(-1)!.status, "draft");
  // I have one, saved as it is (nothing typed): still a draft, never compared with itself.
  const g = laneStore();
  const asIs = await saveFirstSection(UID, { text: RESUME, typed: "", keep: undefined }, g.store);
  assert.equal(asIs.ok && asIs.revision.status, "draft");
  const comp = read("components/forge/lanes/FirstSave.tsx");
  assert.match(comp, /\/api\/lane-first/);
  assert.doesNotMatch(comp, /finishPayload/, "the client no longer builds the evidence");
  assert.match(comp, /Saved to your account \(version/);
  assert.match(comp, /DRAFT_BADGE/);
  assert.doesNotMatch(comp, /Every line on it is in your own words/);
});

test("H3: someone with a saved resume is asked first; nothing is written until they pick", async () => {
  const f = laneStore();
  await saveFinishRevision(UID, finishState(), { source: "forge_finish" }, f.store);
  const before = JSON.stringify(f.arts);
  const r = await saveFirstSection(UID, { text: "Morgan Sample\n\nWORK HISTORY\nCook | Lakeside Grill | 2024\n- I cooked.", typed: "I cooked.", keep: undefined }, f.store);
  assert.ok(!r.ok && r.status === 409 && r.reason === "ask_keep");
  assert.equal(JSON.stringify(f.arts), before, "no write before the answer");
  assert.equal(f.revs.length, 1);
});

test("H3: 'Start a new resume' keeps the saved one, word for word and still finished, as its own item in My resumes", async () => {
  const f = laneStore();
  await saveFinishRevision(UID, finishState(), { source: "forge_finish" }, f.store);
  const oldRev = f.revs.at(-1)!;
  assert.equal(oldRev.status, "finished");
  const cook = "Morgan Sample\n\nWORK HISTORY\nCook | Lakeside Grill | 2024\n- I cooked.";
  const r = await saveFirstSection(UID, { text: cook, typed: "I cooked.", keep: "new" }, f.store);
  assert.ok(r.ok && r.keptCopyId);
  const kept = f.arts.find((a) => a.id === (r.ok ? r.keptCopyId : ""))!;
  assert.equal((kept.target_context as { source?: string }).source, "kept");
  const keptRev = f.revs.filter((x) => x.artifact_id === kept.id).at(-1)!;
  assert.equal(keptRev.resume_text, oldRev.resume_text, "the saved resume, word for word");
  assert.equal(keptRev.status, "finished", "and still finished");
  assert.deepEqual(keptRev.defend_answers, oldRev.defend_answers);
  assert.ok(JSON.stringify(kept.content).includes("Harbor Street Diner"));
  // The new work is the main resume, as a draft.
  assert.equal(r.ok && r.revision.status, "draft");
  // A second save in the same sitting updates the new one, never the kept copy.
  const r2 = await saveFirstSection(UID, { text: cook + "\n- I cleaned.", typed: "I cooked.\nI cleaned.", keep: "replace" }, f.store);
  assert.ok(r2.ok);
  assert.equal(f.revs.filter((x) => x.artifact_id === kept.id).length, 1);
});

test("H3: 'Replace my current one' keeps the earlier version in its history, and it can be brought back with its status", async () => {
  const f = laneStore();
  await saveFinishRevision(UID, finishState(), { source: "forge_finish" }, f.store);
  const main = f.arts[0];
  const r = await saveFirstSection(UID, { text: "Morgan Sample\n\nWORK HISTORY\nCook | Lakeside Grill | 2024\n- I cooked.", typed: "I cooked.", keep: "replace" }, f.store);
  assert.ok(r.ok && !r.keptCopyId);
  const versions = (await listVersions(UID, main.id, f.store))!;
  assert.equal(versions.length, 2);
  assert.equal(versions[1].status, "finished");
  assert.match(versions[1].preview, /MORGAN SAMPLE/);
  const back = await restoreVersion(UID, main.id, versions[1].id, f.store);
  assert.ok(back.ok);
  assert.equal(back.ok && back.revision.status, "finished", "same words, answers and evidence: the same status");
  assert.equal(back.ok && back.revision.number, 3);
  assert.ok(JSON.stringify(main.content).includes("Harbor Street Diner"), "the resume shows the earlier words again");
  // Another person's version id, or a version of another resume, is refused.
  assert.equal((await restoreVersion(UID, main.id, "00000000-0000-4000-8000-00000000ffff", f.store)).ok, false);
});

// ---- the support step: never offense details, the privacy line stays true ---------

test("support step: asks what would help, never for offense details; the privacy line says AI services and the account", () => {
  const s = read("app/(forge)/story/page.tsx");
  for (const gone of ["Type of charge", "Number of charges", "Most recent charge", "probation or parole", "crimRecord", "Here&apos;s the deal"]) {
    assert.ok(!s.includes(gone), `removed: ${gone}`);
  }
  assert.match(s, /Want help with something getting in the way\?/);
  assert.match(s, /criminalRecord: undefined/);
  assert.match(s, /goes to the AI services we use/);
  assert.match(s, /it&apos;s saved there/);
  assert.match(s, /NO_FOLLOW_UP = new Set\(\["criminal_record"\]\)/, "ticking a record asks nothing more");
});

// ---- the finish page ---------------------------------------------------------------

test("finish (lanes first): one next action by route; PDF the main download; Word, text and the package under More formats", () => {
  assert.deepEqual(nextActionFor("job", { signedIn: true, finished: true }), { label: "Pick a job to go after", href: "/dashboard/jobs" });
  assert.deepEqual(nextActionFor("interview", { signedIn: true, finished: false }), { label: "Practice for your interview", href: "/dashboard/interview" });
  assert.equal(nextActionFor("resume", { signedIn: true, finished: true }).label, "Use this resume");
  const box = read("components/forge/finish/LaneFinish.tsx");
  assert.match(box, /onDownloadFormat\("pdf"\)[\s\S]*data-testid="main-action"/);
  const more = box.slice(box.indexOf("MORE_FORMATS_LABEL}</summary>"));
  for (const f of ['"docx"', '"txt"', "format-package"]) assert.ok(more.includes(f), f);
  const page = read("app/(forge)/output/page.tsx");
  assert.match(page, /lanes \|\| checkMode \? \(\s*<LaneDownloadBox/);
  assert.match(page, /<LaneNextAction action=\{nextActionFor\(session\.laneTask/);
});

test("finish (lanes first): the cover letter belongs to the job route; elsewhere it is offered, never forced", () => {
  const page = read("app/(forge)/output/page.tsx");
  assert.match(page, /const offerLetterOnly = lanes && session\.laneTask !== "job"/);
  assert.match(page, /setParkedLetter\(data\.coverLetter \|\| ""\);[\s\S]{0,120}setCoverLetterText\(""\)/);
  assert.match(page, /data-testid="add-letter"/);
});

test("finish: the truth cards and the gate are untouched by lanes (same DefendPanel, same buildFinishView)", () => {
  const page = read("app/(forge)/output/page.tsx");
  assert.equal((page.match(/<DefendPanel /g) || []).length, 1);
  assert.match(page, /buildFinishView\(\{/);
});

// ---- decision count -----------------------------------------------------------------

test("choice count: from sign-in to a first saved resume section, 3 or fewer required decisions on every main route", () => {
  for (const task of ["resume", "job", "interview"] as const) {
    for (const intake of ["have_one", "build"] as const) {
      const steps = decisionsToFirstSave(task, intake);
      assert.ok(steps.length <= 3, `${task}/${intake}: ${steps.length} decisions`);
      // The first screen carries four main routes plus Something else (Troy 2026-10-23: the
      // no-lane-yet answer is main-sized); every later screen stays at four options or fewer.
      for (const st of steps) assert.ok(st.options.length >= 1 && st.options.length <= (st.screen === "/start" ? 5 : 4), `${st.question}: ${st.options.length} options`);
    }
  }
  // Before (e11fb6f): readiness (4) -> short/full (2) -> five intake routes -> builder intro ->
  // name -> contact -> job -> duties -> another job? -> skills -> education -> extras -> review ->
  // goals (8) -> preferences -> build. The job step adds no decision: one optional box and Continue.
  const start = read("app/(forge)/start/page.tsx");
  const job = start.slice(start.indexOf('if (step === "job")'), start.indexOf("// ---- \"Something else\""));
  assert.equal((job.match(/<button/g) || []).length, 1, "the job step has one button: Continue");
});

// ---- Check and finish ----------------------------------------------------------------

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
      const a = arts.find((x) => x.id === id);
      if (a) a.content = content;
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
    // The person's stored upload and typed answers, as R1's coreStore reads them (consumer_profile).
    serverSource: async () => writerSourceFrom({ resumeText: SOURCE, goalNarrative: "I want to keep cooking." }),
  };
  return { store, arts, revs, updates };
}

function laneStore(initial: ArtifactLite[] = []) {
  const f = fakeStore(initial);
  const store: LaneFirstStore = {
    ...f.store,
    createResumeArtifact: async (_u, targetContext, content) => {
      const a = { id: `00000000-0000-4000-8000-0000000001${(10 + f.arts.length).toString(16)}`, artifact_type: "resume", target_context: targetContext, content };
      f.arts.push(a);
      return { id: a.id };
    },
    getRevision: async (_u, id) => f.revs.find((x) => x.id === id) ?? null,
    listRevisions: async (_u, id) => f.revs.filter((x) => x.artifact_id === id),
  };
  return { ...f, store };
}

const TAILOR = "00000000-0000-4000-8000-0000000000bb";
const tailorArtifact = (): ArtifactLite => ({
  id: TAILOR,
  artifact_type: "resume",
  target_context: { source: "tailor", targetJob: "Prep Cook" },
  content: resumeTextToDocument(RESUME) as unknown as Record<string, unknown>,
});

test("check and finish: only the person's own resumes; a letter or an unknown id is refused", async () => {
  const f = fakeStore([tailorArtifact(), { id: "00000000-0000-4000-8000-0000000000cc", artifact_type: "cover_letter", target_context: {}, content: { text: "Dear team" } }]);
  assert.equal((await loadCheckSource(UID, "00000000-0000-4000-8000-0000000000ff", f.store)).ok, false);
  const letter = await loadCheckSource(UID, "00000000-0000-4000-8000-0000000000cc", f.store);
  assert.ok(!letter.ok && letter.status === 409);
  const save = await saveCheckRevision(UID, "00000000-0000-4000-8000-0000000000ff", finishState(), f.store);
  assert.ok(!save.ok && save.status === 404);
});

test("Check and finish appears on the lane home, My resumes and the Tailor result, with the draft badge wording", () => {
  assert.equal(DRAFT_BADGE, "Draft: check it before you send it.");
  assert.equal(CHECK_AND_FINISH_LABEL, "Check and finish");
  assert.match(read("components/lanes/LaneHome.tsx"), /\/output\?check=\$\{rev\.artifactId\}/);
  assert.match(read("app/(dashboard)/dashboard/vault/page.tsx"), /<CheckAndFinish artifactId=\{a\.id\}/);
  assert.match(read("components/resume/ResumeWorkspace.tsx"), /<CheckAndFinish/);
  // Phase 6 (plan Q1): "Check and finish" is for a draft the writer made; a page saved as given goes to the writer.
  assert.deepEqual(laneHomeNext("resume", { status: "draft", artifactId: "x", fromWriter: true }), { label: "Check and finish", href: "/output?check=x&cards=1" });
  assert.deepEqual(laneHomeNext("resume", { status: "draft", artifactId: "x" }), { label: "Build it with t.ROY", href: "/resume?rebuild=x" });
  assert.deepEqual(laneHomeNext("resume", null), { label: "Start your resume", href: "/resume" });
  const route = read("app/api/revisions/check/route.ts");
  assert.match(route, /revisionCaller/);
  assert.match(route, /isSameOriginJsonPost/);
});

// ---- Refinery names and Get support -----------------------------------------------

test("Refinery names: the board's stations and every tool still in the nav", () => {
  // The nav became a path of stations (2026-10-23); its labels live in lib/refinery-nav.ts.
  const shell = read("lib/refinery-nav.ts");
  for (const label of ["Overview", "Find work", "Tailor and package", "Plan what to say", "Practice", "Apply and track", "What comes next", "Local help", "Private records and documents", "Tailor for a job", "Creative work", "CV", "Performer page", "Disclosure plan", "Progress", "Settings"]) {
    assert.ok(shell.includes(`label: "${label}"`), label);
  }
  for (const old of ['label: "Job Paths"', 'label: "Library"', 'label: "Vault"']) assert.ok(!shell.includes(old), old);
});

test("Get support reads R3's fields: coverage line, last checked, source; older answers still render", () => {
  const r = readSupportResponse({
    resources: [
      { id: "a", title: "Ride help", provider: "County transit", checkedLine: "Last checked Oct 1, 2026.", sourceLabel: "Steel Man's checked directory", website: "javascript:alert(1)", mayBeOutOfDate: false, fees: "No charge", whatToBring: "Photo ID", limits: "One ride each week" },
      { title: "" },
    ],
    coverage: { level: "state", line: "We haven't checked local help in this county yet. These work statewide.", place: "Lincoln County, MT" },
  });
  assert.equal(r.results.length, 1);
  assert.equal(r.results[0].checkedLine, "Last checked Oct 1, 2026.");
  assert.equal(r.results[0].website, undefined, "only http(s) links");
  assert.equal(r.results[0].fees, "No charge");
  assert.equal(r.results[0].whatToBring, "Photo ID");
  assert.equal(r.results[0].limits, "One ride each week");
  const malformed = readSupportResponse({resources:[{title:"Help",fees:15,whatToBring:[],limits:" "}]});
  assert.equal(malformed.results[0].fees, undefined);
  assert.equal(malformed.results[0].whatToBring, undefined);
  assert.equal(malformed.results[0].limits, undefined);
  assert.equal(r.coverage?.line, "We haven't checked local help in this county yet. These work statewide.");
  const old = readSupportResponse({ resources: [{ id: "b", title: "Legal aid" }] });
  assert.equal(old.coverage, null);
  assert.equal(old.results[0].checkedLine, undefined);
  assert.equal(old.results[0].fees, undefined);
  assert.equal(old.results[0].whatToBring, undefined);
  assert.equal(old.results[0].limits, undefined);
  const page = read("app/(dashboard)/dashboard/resources/page.tsx");
  assert.match(page, /<SupportSearch /);
  assert.match(page, /id="paths"/);
});

test("the fixture is fictional", () => {
  assert.match(SOURCE, /example\.com/);
});

// ---- review round 1: H1, L1, L2, L4 ------------------------------------------------

test("H1: without a resume, Get support, the job board and the documents open; interview and follow-up remain reachable", () => {
  for (const p of ["/dashboard/orientation", "/dashboard/resources", "/dashboard/jobs", "/dashboard/creative", "/dashboard/cv/abc", "/dashboard/performer"]) {
    assert.equal(refineryOpenWithoutResume(p, null), true, p);
  }
  assert.equal(refineryOpenWithoutResume("/dashboard/interview", "interview"), true);
  assert.equal(refineryOpenWithoutResume("/dashboard/application-tailor", "job"), false);
  // Forge first, always (Troy 2026-10-15): the overview is not a door around the Forge.
  assert.equal(refineryOpenWithoutResume("/dashboard", "support"), false, "the lane home still needs a Forge run first");
  assert.equal(refineryOpenWithoutResume("/dashboard", "resume"), false);
  assert.equal(refineryOpenWithoutResume("/dashboard", null), false, "a new account on the overview goes to the Forge");
  assert.equal(forgeStartUrl("refinery.steelmanresumes.com"), "https://forge.steelmanresumes.com/start?from=refinery");
  assert.equal(forgeStartUrl("the-crucible-git-x-troy-carrs-projects.vercel.app"), "/start?from=refinery");
  assert.equal(forgeStartUrl("localhost"), "/start?from=refinery");
  assert.equal(taskNeedsResume("job"), false);
  const shell = read("app/(dashboard)/RefineryShell.tsx");
  assert.match(shell, /!refineryOpenWithoutResume\(pathname, laneFocus\.task\)/);
  assert.match(shell, /laneFocus\.loaded &&/, "never bounces before the task is known");
});

test("H1: Keep going follows the route; the lane home's next step too", () => {
  const ctx = { signedIn: true, hasForgeOutput: false, hasResumeText: false, forgeNext: "/resume" };
  assert.equal(keepGoingHref("support", ctx), "/dashboard/resources#support");
  assert.equal(keepGoingHref("documents", ctx), "/dashboard/creative");
  assert.equal(keepGoingHref("explore", ctx), "/dashboard/paths");
  assert.equal(keepGoingHref("job", ctx), "/start?step=job");
  assert.equal(keepGoingHref("job", { ...ctx, hasResumeText: true }), "/resume");
  assert.equal(keepGoingHref("resume", ctx), "/resume");
  assert.equal(keepGoingHref("interview", { ...ctx, hasForgeOutput: true }), "/dashboard/interview");
  assert.deepEqual(laneHomeNext("job", null), { label: "Pick a job to go after", href: "/dashboard/jobs" });
  assert.deepEqual(laneHomeNext("interview", null), { label: "Practice for your interview", href: "/dashboard/interview" });
  assert.match(read("app/(forge)/start/page.tsx"), /const next = keepGoingHref\(task,/);
});

test("demo 10/29 (Ceci): Keep going opens the account's saved resume, never the intake", () => {
  const ctx = { signedIn: true, hasForgeOutput: false, hasResumeText: false, forgeNext: "/resume" };
  const draft = { artifactId: "a1b2", status: "draft", fromWriter: true };
  // The live bug: "version 2 saved", then Keep going asked "Do you have a resume?".
  assert.equal(keepGoingHref("resume", { ...ctx, savedWork: draft }), "/output?check=a1b2&cards=1", "the writer's draft opens on its cards");
  assert.equal(keepGoingHref("job", { ...ctx, savedWork: draft }), "/output?check=a1b2&cards=1");
  assert.equal(keepGoingHref("resume", { ...ctx, hasResumeText: true, savedWork: draft }), "/output?check=a1b2&cards=1", "a stale local text never beats the account");
  // A page saved as given, or a finished one: My resumes, where View shows it. Never a new build.
  assert.equal(keepGoingHref("resume", { ...ctx, savedWork: { artifactId: "a1b2", status: "draft", fromWriter: false } }), "/dashboard/vault");
  assert.equal(keepGoingHref("resume", { ...ctx, savedWork: { artifactId: "a1b2", status: "finished", fromWriter: true } }), "/dashboard/vault");
  assert.equal(savedWorkHref({ artifactId: "a b", status: "draft", fromWriter: true }), "/output?check=a%20b&cards=1");
  // This browser's own finished run still opens where it is; no saved work keeps the old routes.
  assert.equal(keepGoingHref("resume", { ...ctx, hasForgeOutput: true, savedWork: draft }), "/output");
  assert.equal(keepGoingHref("resume", { ...ctx, savedWork: null }), "/resume");
  assert.equal(keepGoingHref("resume", { ...ctx, savedWork: { artifactId: "", status: "draft" } }), "/resume");
  assert.equal(keepGoingHref("resume", { ...ctx, signedIn: false, savedWork: draft }), "/resume", "signed out has no account work");
  assert.equal(keepGoingHref("support", { ...ctx, savedWork: draft }), "/dashboard/resources#support", "other routes keep their own page");
  for (const task of ["resume", "job"] as const) assert.notEqual(keepGoingHref(task, { ...ctx, savedWork: draft }), "/resume");
  const start = read("app/(forge)/start/page.tsx");
  assert.match(start, /savedWork: accountRev,/);
  assert.match(start, /artifactId: String\(j\.revision\.artifactId/);
  assert.match(start, /disabled=\{focus\.signedIn && !revChecked\}/, "Keep going waits for the saved-work read");
});

test("L1: the lane home heading keeps the label's own casing", () => {
  const h = read("components/lanes/LaneHome.tsx");
  assert.match(h, /Today: \{TASK_COPY\[task\]\.label\}/);
  assert.doesNotMatch(h, /label\.toLowerCase\(\)/);
});

test("L2: opening a resume for Check and finish writes nothing; only the same-origin POST saves", async () => {
  const f = fakeStore([tailorArtifact()]);
  const load = await loadCheckSource(UID, TAILOR, f.store);
  assert.ok(!load.ok && load.reason === "needs_check", "nothing checked yet: the page asks R1's POST /api/forge/recheck");
  assert.equal(f.revs.length, 0, "no revision written on the read");
  assert.equal(f.updates.length, 0, "no content written on the read");
  const route = read("app/api/revisions/check/route.ts");
  const get = route.slice(route.indexOf("export async function GET"), route.indexOf("export async function POST"));
  assert.doesNotMatch(get, /saveCheckRevision|incrementUserUsage|insertRevision/);
  assert.match(route.slice(route.indexOf("export async function POST")), /isSameOriginJsonPost/);
});


// ---- Check and finish on R1's one re-check path (recheckDocs kind "artifact") ------------

/** A fake second check: flags only the invented line, never reaches a model. */
const verifyFake = async (p: { sourceText: string; output: string; kind: string }) => {
  const bad = p.output.split("\n").map((l) => l.replace(/^[-\s]+/, "").trim()).find((l) => /Managed the warehouse budget/.test(l));
  return { text: p.output, hasFabrication: !!bad, applied: false, flags: bad ? [{ claim: bad, why: "not in what the person said" }] : [], verifierRan: true };
};
let nonce = 0;
const deps = (store: RevisionStore) => ({ verify: verifyFake as never, random: () => `n${++nonce}`, store });

/** The person answers every card on the finish page (the same cards), in their own words. */
function answerAll(text: string): unknown[] {
  let answers = allAnswered(text);
  const header = text.split("\n").find((l) => /^LINE COOK \|/i.test(l) || /^Line cook \|/.test(l));
  if (header) answers = recordTitleYes(answers as never, header, "Line cook") as never;
  return answers;
}

async function checkThenAnswer(f: ReturnType<typeof fakeStore>) {
  // 1. Opening: nothing checked yet, so the page asks R1 to check it (which saves that version).
  const first = await loadCheckSource(UID, TAILOR, f.store);
  assert.ok(!first.ok && first.reason === "needs_check");
  const rc = await recheckDocs({ kind: "artifact", artifactId: TAILOR, written: { resume: "forged", letter: "" }, receipt: "wr2.forged", grounding: { verifierRan: true } }, UID, deps(f.store));
  assert.ok(rc.ok, JSON.stringify(rc));
  const load = await loadCheckSource(UID, TAILOR, f.store);
  assert.ok(load.ok);
  if (!load.ok) throw new Error("no source");
  // 2. The person answers the same cards; the page sends its state (with forged trust fields).
  const text = load.source.resumeText;
  const state = finishState({
    resumeText: text,
    coverLetterText: "",
    defendAnswers: answerAll(text),
    keptTerms: ["Inventory control"],
    written: { resume: "anything", letter: "" },
    grounding: { verifierRan: true, outcomes: [] },
    writerReceipt: "wr2.forged",
    ownWords: text,
    ownResumeText: text,
  });
  const saved = await saveCheckRevision(UID, TAILOR, state, f.store);
  return { rc, load, saved, text };
}

test("check and finish (honest Tailor copy): R1 checks it for real, the person answers the cards, and it finishes", async () => {
  const f = fakeStore([tailorArtifact()]);
  const { rc, load, saved } = await checkThenAnswer(f);
  assert.ok(rc.ok && rc.revision && rc.revision.artifactId === TAILOR, "R1's check saved a version of THAT resume");
  assert.ok(load.ok && load.source.title === "Prep Cook");
  assert.ok(saved.ok, JSON.stringify(saved));
  assert.equal(saved.ok && saved.revision.status, "finished");
  assert.equal(saved.ok && saved.revision.artifactId, TAILOR);
  // Trust came from R1's stored check, never the request.
  const ev = f.revs.at(-1)!.evidence as { written?: { resume?: string }; writerVerified?: boolean; runId?: string; ownWords?: string; writerReceipt?: string };
  assert.equal(ev.writerVerified, true);
  assert.equal(ev.runId, `artifact:${TAILOR}`);
  assert.notEqual(ev.written?.resume, "anything");
  assert.notEqual(ev.writerReceipt, "wr2.forged");
  assert.ok(!(ev.ownWords ?? "").includes("Inventory control"), "the person's words are the server's, not the page");
  // The Refinery's next export of that resume uses the finished revision (R1's marker).
  const { ensureExportRevision } = await import("../revision-current");
  const ex = await ensureExportRevision(UID, TAILOR, f.store);
  assert.ok(ex.ok && ex.revision.status === "finished" && ex.reused);
});

test("check and finish (a Tailor copy the second check BLOCKs): stays a draft, with that line as a card", async () => {
  const f = fakeStore([{ ...tailorArtifact(), content: resumeTextToDocument(RESUME + "\n- Managed the warehouse budget.") as unknown as Record<string, unknown> }]);
  const { rc, saved } = await checkThenAnswer(f);
  assert.ok(rc.ok);
  const g = (rc.ok ? rc.grounding : {}) as { hasFabrication?: boolean };
  assert.equal(g.hasFabrication, true, "the second check ran and flagged the invented line");
  assert.ok(saved.ok);
  assert.equal(saved.ok && saved.revision.status, "draft");
  assert.ok(saved.ok && saved.revision.openItems.some((i) => /Managed the warehouse budget/.test(i)), JSON.stringify(saved.ok && saved.revision.openItems));
});

test("check and finish: a save with no current R1 check is refused; this code signs nothing", async () => {
  const f = fakeStore([tailorArtifact()]);
  const r = await saveCheckRevision(UID, TAILOR, finishState({ writerReceipt: "wr2.forged", written: { resume: RESUME, letter: "" } }), f.store);
  assert.ok(!r.ok && r.reason === "needs_check");
  assert.equal(f.revs.length, 0);
  const src = read("lib/revision-check.ts");
  assert.doesNotMatch(src, /import \{[^}]*writerReceipt[^}]*\} from "\.\/writer-receipt"/);
  assert.doesNotMatch(src, /writerReceipt\(/, "no signing here");
  assert.match(read("app/(forge)/output/page.tsx"), /\/api\/forge\/recheck[\s\S]{0,200}kind: "artifact"/);
});

test("L4: a locked baseline is refused plainly on open and on save, so exports never differ from a 'finished' version", async () => {
  const f = fakeStore([{ ...tailorArtifact(), is_locked: true }]);
  const load = await loadCheckSource(UID, TAILOR, f.store);
  assert.ok(!load.ok && load.status === 409 && load.reason === "locked");
  const save = await saveCheckRevision(UID, TAILOR, finishState(), f.store);
  assert.ok(!save.ok && save.reason === "locked");
  assert.match(read("app/api/revisions/check/route.ts"), /locked as a baseline, so it can't change here/);
  // Locked between the check and the write: refused, never claimed.
  const g = fakeStore([tailorArtifact()]);
  const rc = await recheckDocs({ kind: "artifact", artifactId: TAILOR }, UID, deps(g.store));
  assert.ok(rc.ok);
  g.store.updateArtifactContent = async () => "locked";
  const load2 = await loadCheckSource(UID, TAILOR, g.store);
  assert.ok(load2.ok);
  const r = await saveCheckRevision(UID, TAILOR, finishState({ resumeText: load2.ok ? load2.source.resumeText : "", defendAnswers: answerAll(load2.ok ? load2.source.resumeText : "") }), g.store);
  assert.ok(!r.ok && r.reason === "locked");
});

test("review r2 L-b: after an edit saved through the Refinery, Check and finish asks R1 for a fresh check (never the old one)", async () => {
  const f = fakeStore([tailorArtifact()]);
  const rc = await recheckDocs({ kind: "artifact", artifactId: TAILOR }, UID, deps(f.store));
  assert.ok(rc.ok);
  assert.ok((await loadCheckSource(UID, TAILOR, f.store)).ok, "right after R1's check it opens on that check");
  // A Refinery edit: the stored resume changes and is saved as a version (R1's export path).
  const edited = RESUME.replace("- Ran the grill on the breakfast line.", "- Ran the grill and the fryer on the breakfast line.");
  f.arts[0].content = resumeTextToDocument(edited) as unknown as Record<string, unknown>;
  const { ensureExportRevision } = await import("../revision-current");
  const ex = await ensureExportRevision(UID, TAILOR, f.store);
  assert.ok(ex.ok && ex.revision.source === "refinery_edit");
  assert.equal((ex.ok ? ex.revision.evidence : {} as never as Record<string, unknown>).runId, `artifact:${TAILOR}`, "the edit carried the old check forward");
  // Opening (and saving) now asks for a fresh check.
  const load = await loadCheckSource(UID, TAILOR, f.store);
  assert.ok(!load.ok && load.reason === "needs_check");
  const save = await saveCheckRevision(UID, TAILOR, finishState({ resumeText: edited }), f.store);
  assert.ok(!save.ok && save.reason === "needs_check");
  // R1 checks the edited text, and the page opens on that.
  const again = await recheckDocs({ kind: "artifact", artifactId: TAILOR }, UID, deps(f.store));
  assert.ok(again.ok && again.written.resume.includes("the fryer"));
  const fresh = await loadCheckSource(UID, TAILOR, f.store);
  assert.ok(fresh.ok && fresh.source.written?.resume.includes("the fryer"));
});

test("review r2 L-b: on the check page itself, a change then another answer still saves (saves on top of the check)", async () => {
  const f = fakeStore([tailorArtifact()]);
  await recheckDocs({ kind: "artifact", artifactId: TAILOR }, UID, deps(f.store));
  const load = await loadCheckSource(UID, TAILOR, f.store);
  assert.ok(load.ok);
  const text = load.ok ? load.source.resumeText : "";
  const changed = text.replace("- Showed incoming culinary staff the equipment.", "- Showed new cooks the grill.");
  const one = await saveCheckRevision(UID, TAILOR, finishState({ resumeText: changed, defendAnswers: [] }), f.store);
  assert.ok(one.ok, JSON.stringify(one));
  const two = await saveCheckRevision(UID, TAILOR, finishState({ resumeText: changed, defendAnswers: answerAll(changed) }), f.store);
  assert.ok(two.ok, JSON.stringify(two));
});
