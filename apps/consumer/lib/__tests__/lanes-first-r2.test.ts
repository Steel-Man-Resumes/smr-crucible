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
import { loadCheckSource, saveCheckRevision, ownEvidence } from "../revision-check";
import { saveFinishRevision, type ArtifactLite, type RevisionStore } from "../revision-save";
import { resumeTextToDocument } from "../revision-to-doc";
import { revisionContentHash, type ArtifactRevision, type InsertRevisionResult, type NewRevision } from "@crucible/core/src/artifactRevision";
import { RESUME, SOURCE, finishState, allAnswered, OWN_WORDS } from "./fixtures/revision-run";
import { FORGE_SIGN_IN_PAGES } from "../forge-access";
import { recordTitleYes } from "../finish-gate";
import { CLIENT_PATH } from "../forge-front-door";

const root = join(import.meta.dirname, "..", "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");
const UID = "00000000-0000-4000-8000-0000000000a1";

// ---- the first screen -------------------------------------------------------------

test("first screen: 'What do you need today?', three main routes in Troy's words, a quieter Something else, a quiet help link", () => {
  assert.equal(FIRST_SCREEN_TITLE, "What do you need today?");
  assert.deepEqual(MAIN_TASKS.map((t) => TASK_COPY[t].label), ["Get a resume I can use", "Go after a job", "Get ready for an interview"]);
  assert.deepEqual([...OTHER_TASKS], ["documents", "explore", "support"]);
  assert.match(TASK_COPY.documents.label, /Creative work, a CV, or a performer page/);
  assert.equal(TASK_COPY.explore.label, "Explore a career");
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
  const home = d.indexOf("{focus.task && <LaneHome task={focus.task} />}\n      {focus.task && (");
  const tools = d.indexOf("All tools\n        </h2>");
  assert.ok(home > 0 && tools > home, "lane home first, All tools second");
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
  assert.match(read("app/(dashboard)/RefineryShell.tsx"), /<RefineryLaneHeader \/>/);
});

// ---- routes -----------------------------------------------------------------------

test("routes: resume goes to intake; the job route has one small step; interview practices when a resume is on file", () => {
  const out = { signedIn: false, hasResume: false };
  assert.equal(routeHref("resume", out), "/resume");
  assert.equal(routeHref("job", out), "/start?step=job");
  assert.equal(routeHref("interview", out), "/resume");
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

test("lanes-first path (R9): resume, then build; Do more adds goals and preferences; the support step only when asked", () => {
  const ids = (s: Parameters<typeof planForgePath>[0]) => planForgePath(s).screens.map((x) => x.id);
  assert.deepEqual(ids({ laneTask: "resume", readinessStage: "preparation" }), ["resume", "processing", "output"]);
  assert.deepEqual(ids({ laneTask: "job", readinessStage: "action" }), ["resume", "processing", "output"]);
  assert.deepEqual(ids({ laneTask: "resume", pathExtras: ["goals", "preferences"] }), ["resume", "goals", "preferences", "processing", "output"]);
  assert.deepEqual(ids({ laneTask: "resume", pathExtras: ["story"] }), ["resume", "story", "processing", "output"]);
  const p = planForgePath({ laneTask: "resume" });
  assert.equal(previousPath(p, "resume", { laneTask: "resume" }), "/start");
  assert.equal(nextPath(p, "resume"), "/processing");
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

test("the first save goes through R1's save and is honestly a draft until every line is checked", async () => {
  const f = fakeStore();
  const text = firstSectionText({ name: "Morgan Sample", contact: "morgan@example.com", title: "Line cook", employer: "Harbor Street Diner", years: "2019 to 2023", duty: "I ran the grill on the breakfast line." });
  const { finishPayload } = await import("../finish-payload");
  const payload = finishPayload({ resumeText: text, originalResumeText: text }, { resumeText: text, coverLetterText: "", defendAnswers: [], keepInsideLines: false });
  const r = await saveFinishRevision(UID, payload, { source: "forge_finish" }, f.store);
  assert.ok(r.ok);
  assert.equal(r.ok && r.revision.number, 1);
  // The server decides from the gate (every line here is the person's own words); the page shows its answer.
  assert.ok(r.ok && (r.revision.status === "draft" || r.revision.status === "finished"));
  // A page with words that are not theirs is a draft.
  const notTheirs = finishPayload({ resumeText: text, originalResumeText: text }, { resumeText: text + "\n- Managed a team of 40.", coverLetterText: "", defendAnswers: [], keepInsideLines: false });
  const d = await saveFinishRevision(UID, notTheirs, { source: "forge_finish" }, f.store);
  assert.equal(d.ok && d.revision.status, "draft", "a line the person never said is never finished");
  const comp = read("components/forge/lanes/FirstSave.tsx");
  assert.match(comp, /kind: "finish"/);
  assert.match(comp, /\/api\/revisions/);
  assert.match(comp, /Saved to your account \(version/);
  assert.match(comp, /DRAFT_BADGE/);
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
      for (const st of steps) assert.ok(st.options.length >= 1 && st.options.length <= 4, `${st.question}: ${st.options.length} options`);
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
  };
  return { store, arts, revs, updates };
}

const TAILOR = "00000000-0000-4000-8000-0000000000bb";
const tailorArtifact = (): ArtifactLite => ({
  id: TAILOR,
  artifact_type: "resume",
  target_context: { source: "tailor", targetJob: "Prep Cook" },
  content: resumeTextToDocument(RESUME) as unknown as Record<string, unknown>,
});

test("check and finish: a Tailor result is DRAFT; checking it with the same cards saves a finished revision of THAT resume", async () => {
  const f = fakeStore([tailorArtifact()]);
  // The person's Forge run is on file (their own words).
  await saveFinishRevision(UID, finishState(), { source: "forge_finish" }, f.store);
  const load = await loadCheckSource(UID, TAILOR, f.store);
  assert.ok(load.ok);
  if (!load.ok) return;
  assert.equal(load.source.status, "draft", "raw text is DRAFT (R1)");
  assert.equal(load.source.title, "Prep Cook");
  assert.equal(load.source.evidence.ownWords, OWN_WORDS, "the person's words come from their own Forge revision");
  // The person answers the cards on the finish page (their own answers) and saves.
  const text = load.source.resumeText;
  // Their title card: "Yes, that was my title" (the same card the finish page shows).
  const header = text.split("\n").find((l) => /^LINE COOK \|/.test(l))!;
  const answers = recordTitleYes(allAnswered(text), header, "Line cook");
  const state = finishState({ resumeText: text, coverLetterText: "", written: { resume: text, letter: "" }, defendAnswers: answers, keptTerms: ["Inventory control"] });
  const saved = await saveCheckRevision(UID, TAILOR, state, f.store);
  assert.ok(saved.ok);
  assert.equal(saved.ok && saved.revision.status, "finished");
  assert.equal(saved.ok && saved.revision.artifactId, TAILOR, "a revision of the Tailor resume, not the Forge one");
  // The Refinery's next export of that resume uses the finished revision (R1's marker).
  const again = await loadCheckSource(UID, TAILOR, f.store);
  assert.ok(again.ok && again.source.status === "finished");
});

test("check and finish never takes the person's words from the request: a payload claiming the whole page as 'own words' stays draft", async () => {
  const f = fakeStore([tailorArtifact()]);
  // No Forge revision: the person has given us no words of their own yet.
  const forged = finishState({ resumeText: RESUME, coverLetterText: "", written: null, grounding: null, defendAnswers: [], keptTerms: [], ownWords: RESUME, ownResumeText: RESUME });
  const r = await saveCheckRevision(UID, TAILOR, forged, f.store);
  assert.ok(r.ok);
  assert.equal(r.ok && r.revision.status, "draft");
  const stored = f.revs.at(-1)!;
  assert.equal((stored.evidence as { ownWords?: string }).ownWords, "", "the server's evidence replaced the request's");
  assert.deepEqual(await ownEvidence(UID, f.store), { ownWords: "", credentialsAnswer: "", credentialRows: [], ownResumeText: "" });
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
  assert.deepEqual(laneHomeNext("resume", { status: "draft", artifactId: "x" }), { label: "Check and finish", href: "/output?check=x" });
  assert.deepEqual(laneHomeNext("job", null), { label: "Start your resume", href: "/resume" });
  const route = read("app/api/revisions/check/route.ts");
  assert.match(route, /revisionCaller/);
  assert.match(route, /isSameOriginJsonPost/);
});

// ---- Refinery names and Get support -----------------------------------------------

test("Refinery names: Get support, My resumes, Private documents; every tool still in the nav", () => {
  const shell = read("app/(dashboard)/RefineryShell.tsx");
  for (const label of ["Get support", "My resumes", "Private documents", "Job Board", "Applications", "Application Tailor", "Creative Work", "CV", "Performer", "Disclosure", "Interview Prep", "Progress"]) {
    assert.ok(shell.includes(`label: "${label}"`), label);
  }
  for (const old of ['label: "Job Paths"', 'label: "Library"', 'label: "Vault"']) assert.ok(!shell.includes(old), old);
});

test("Get support reads R3's fields: coverage line, last checked, source; older answers still render", () => {
  const r = readSupportResponse({
    resources: [
      { id: "a", title: "Ride help", provider: "County transit", checkedLine: "Last checked Oct 1, 2026.", sourceLabel: "Steel Man's checked directory", website: "javascript:alert(1)", mayBeOutOfDate: false },
      { title: "" },
    ],
    coverage: { level: "state", line: "We haven't checked local help in this county yet. These work statewide.", place: "Lincoln County, MT" },
  });
  assert.equal(r.results.length, 1);
  assert.equal(r.results[0].checkedLine, "Last checked Oct 1, 2026.");
  assert.equal(r.results[0].website, undefined, "only http(s) links");
  assert.equal(r.coverage?.line, "We haven't checked local help in this county yet. These work statewide.");
  const old = readSupportResponse({ resources: [{ id: "b", title: "Legal aid" }] });
  assert.equal(old.coverage, null);
  assert.equal(old.results[0].checkedLine, undefined);
  const page = read("app/(dashboard)/dashboard/resources/page.tsx");
  assert.match(page, /<SupportSearch /);
  assert.match(page, /id="paths"/);
});

test("the fixture is fictional", () => {
  assert.match(SOURCE, /example\.com/);
});
