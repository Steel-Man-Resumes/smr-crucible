/**
 * Creative lanes in the consumer app: the Forge's optional "Do you make art,
 * perform, or freelance?" question, the screens' copy rules, the plain-text
 * limit check, and the guard that keeps creative documents out of every
 * generic write. Fictional data only.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { planForgePath, findQuestion, ANSWER_KEY } from "../forge-path";
import * as copy from "../creative";
import { LANE_ERROR_COPY } from "../lanes";

const APP = join(__dirname, "..", "..");

test("Forge: the creative question sits on the goals screen, optional, folded on the light path", () => {
  const full = planForgePath({ readinessStage: "preparation" });
  const q = findQuestion(full, "goals", "practice");
  assert.ok(q, "on the goals screen");
  assert.equal(q!.folded, false);
  const light = planForgePath({ readinessStage: "action" });
  assert.equal(findQuestion(light, "goals", "practice")?.folded, true);
  assert.equal(ANSWER_KEY.practice, "makesCreativeWork");
  // It never shows twice and never on another screen.
  for (const s of full.screens.filter((x) => x.id !== "goals")) assert.ok(!s.questions.some((x) => x.id === "practice"));
});

test("Forge: demo mode keeps its fixed walkthrough (the question is not shown in demo)", () => {
  const src = readFileSync(join(APP, "app", "(forge)", "goals", "page.tsx"), "utf8");
  assert.match(src, /!isDemo && shown\("practice"\)/);
});

test("plain-text limit: over by how much, or null", () => {
  assert.equal(copy.overLimit(605, 600), 5);
  assert.equal(copy.overLimit(600, 600), null);
  assert.equal(copy.overLimit(10, null), null);
});

/** Every user-facing string in the creative copy module and error tables. */
function allCopy(): string[] {
  const out: string[] = [];
  const walk = (v: unknown) => {
    if (typeof v === "string") out.push(v);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") Object.values(v).forEach(walk);
  };
  for (const [k, v] of Object.entries(copy)) if (typeof v !== "function" && k !== "CREATIVE_TABS") walk(v);
  walk(copy.CREATIVE_TABS.map((t) => t.label));
  walk(LANE_ERROR_COPY);
  return out;
}

test("creative copy: no en or em dashes, no label on the person, brand names exact", () => {
  for (const s of allCopy()) {
    assert.ok(!/[\u2013\u2014]/.test(s), `dash in: ${s}`);
    assert.ok(!/\b(felon|inmate|ex-offender|offender|convict)\b/i.test(s), `label in: ${s}`);
    assert.ok(!/\b(t\.roy|T\.ROY|Troy)\b/.test(s.replace(/t\.ROY/g, "")), `brand spelling in: ${s}`);
  }
});

test("creative screens: no em or en dash in any component source string", () => {
  const dir = join(APP, "components", "creative");
  for (const f of readdirSync(dir)) {
    const src = readFileSync(join(dir, f), "utf8");
    assert.ok(!/[\u2013\u2014]/.test(src), `${f} has a dash`);
  }
});

test("the statement screen has no path that inserts t.ROY's words into the statement", () => {
  const src = readFileSync(join(APP, "components", "creative", "StatementCoach.tsx"), "utf8");
  // The only calls that change the statement text: the person's typing, and one accepted spelling mark.
  const setTextCalls = src.match(/setText\(([^)]*)\)/g) ?? [];
  assert.deepEqual(setTextCalls.sort(), ["setText(e.target.value)", "setText(next)"].sort());
  assert.match(src, /const next = applySpellingMark\(saved, m\);/);
  // Questions are listed, never placed in the textarea.
  assert.ok(!/setText\([^)]*(asked|readBack|COACH_QUESTIONS|q\b)/.test(src));
});

test("creative documents save only through the creative routes", () => {
  const artifactsRoute = readFileSync(join(APP, "app", "api", "artifacts", "route.ts"), "utf8");
  for (const t of ["artist_resume", "artist_bio", "artist_statement", "work_sample_list"]) {
    assert.ok(!artifactsRoute.includes(`"${t}"`), `generic artifact POST must not allow ${t}`);
  }
  const idRoute = readFileSync(join(APP, "app", "api", "artifacts", "[id]", "route.ts"), "utf8");
  assert.match(idRoute, /creative_doc/);
  const docs = readFileSync(join(APP, "app", "api", "creative", "[laneId]", "docs", "route.ts"), "utf8");
  assert.match(docs, /checkStatementSave\(/);
  assert.match(docs, /validMark: isValidSpellingMark/);
  // Bio origin is decided on the server from the record; the request's labels are ignored.
  assert.match(docs, /classifyBio\(body\.bio, c\.entries, c\.settings\)/);
  // Owner-only writes: never under an assist session.
  assert.equal((docs.match(/if \(g\.impersonating\) return ownerOnly\(\);/g) ?? []).length, 2);
});

test("generic paths refuse creative documents: fork, fine-tune, lane move (review M3)", () => {
  const fork = readFileSync(join(APP, "app", "api", "artifacts", "[id]", "fork", "route.ts"), "utf8");
  assert.match(fork, /result\.status === "creative_doc"/);
  const ft = readFileSync(join(APP, "app", "api", "resume-fine-tune", "route.ts"), "utf8");
  assert.match(ft, /isCreativeType\(source\.artifact_type\)/);
  assert.match(ft, /write\.status !== "updated"/);
  const idRoute = readFileSync(join(APP, "app", "api", "artifacts", "[id]", "route.ts"), "utf8");
  assert.match(idRoute, /Creative documents stay in their own lane/);
});

test("v1 creative tools call no model: coach and bio-draft never import the AI client", () => {
  for (const r of [["coach", "route.ts"], ["bio-draft", "route.ts"]]) {
    const src = readFileSync(join(APP, "app", "api", "creative", ...r), "utf8");
    assert.ok(!/ai-call|callAI|anthropic|openai/i.test(src), `${r[0]} must not call a model`);
  }
  const coach = readFileSync(join(APP, "app", "api", "creative", "coach", "route.ts"), "utf8");
  assert.ok(!/saveCreativeDoc|queryAsUser/.test(coach), "the coach writes nothing");
});

test("exports and copy boxes honour the lane's facility choices and DRAFT (review H3, M5)", () => {
  const exp = readFileSync(join(APP, "app", "api", "creative", "[laneId]", "export", "route.ts"), "utf8");
  assert.match(exp, /bioTextForLane\(/);
  assert.match(exp, /DRAFT: open items remain on this list/);
  const plain = readFileSync(join(APP, "components", "creative", "PlainTextPanel.tsx"), "utf8");
  assert.match(plain, /bioTextForLane\(/);
  assert.match(plain, /plain-draft-/);
});

test("review r2: exports print only safe to-do lines; settings and choices need a revision; owner-only record; refusals", () => {
  const rd = (...p: string[]) => readFileSync(join(APP, ...p), "utf8");
  const exp = rd("app", "api", "creative", "[laneId]", "export", "route.ts");
  assert.match(exp, /exportOpenItemLines\(/);
  assert.ok(!/creativeOpenItemLines\(/.test(exp), "the export never uses the unfiltered lines");
  const lane = rd("app", "api", "creative", "[laneId]", "route.ts");
  assert.match(lane, /typeof body\.rev !== "number" \|\| body\.rev !== settingsRev\(current\)/);
  assert.match(lane, /applyTitleMode\(current, entry\.id, tm\.mode\)/);
  assert.match(lane, /if \(g\.impersonating\) return ownerOnly\(\);/);
  const docs = rd("app", "api", "creative", "[laneId]", "docs", "route.ts");
  assert.match(docs, /rev === "missing" && body\.type !== "artist_resume"/);
  for (const p of [["app", "api", "practice", "route.ts"], ["app", "api", "practice", "[id]", "route.ts"]]) {
    assert.match(rd(...p), /if \(g\.impersonating\) return ownerOnlyRecord\(\);/);
  }
  for (const p of [["app", "api", "quick-apply", "route.ts"], ["app", "api", "fit-check", "route.ts"]]) assert.match(rd(...p), /isCreativeType\(artifact\.artifact_type\)/);
  assert.match(rd("app", "api", "creative", "coach", "route.ts"), /export const maxDuration = 10;/);
  const fc = rd("components", "creative", "FacilityChoices.tsx");
  assert.match(fc, /onTitleMode\(e\.id, m\)/);
  assert.ok(!/titleModes: \{ \.\.\./.test(fc), "the screen never sends a whole map");
});

test("review r3: the on-screen preview prints the same safe to-do lines as the download; the bio list highlights by id", () => {
  const ar = readFileSync(join(APP, "components", "creative", "ArtistResumePanel.tsx"), "utf8");
  // Only what the artist resume prints makes a hidden name public (review s2r3 N3-M1).
  assert.match(ar, /exportOpenItemLines\(status, entries, settings, "artist_resume", shownEntryIds\(model\)\)/);
  assert.ok(!/creativeOpenItemLines/.test(ar));
  const bio = readFileSync(join(APP, "components", "creative", "BioPanel.tsx"), "utf8");
  assert.match(bio, /it\.sentenceId/);
});

test("CV lanes: the export route builds the CV from the database with safe to-do lines; the screen shows no personal fields", () => {
  const rd = (...p: string[]) => readFileSync(join(APP, ...p), "utf8");
  const exp = rd("app", "api", "creative", "[laneId]", "export", "route.ts");
  assert.match(exp, /if \(laneKindOf\(lane\) === "cv"\) return exportCv\(/);
  // Only what the CV prints makes a hidden name public (review s2r2 N-M1).
  assert.match(exp, /exportOpenItemLines\(v\.status, v\.entries, v\.settings, "cv", shownEntryIds\(v\.model\)\)/);
  const view = rd("components", "creative", "CvLaneView.tsx");
  assert.ok(!/birth|photo upload|headshot|marital|nationality/i.test(view.replace(/No photo, birth date, age, family status or nationality\. A CV here never asks for them\./, "")));
  assert.match(view, /exportOpenItemLines\(status, ctx\.entries, ctx\.settings, "cv", shownEntryIds\(model\)\)/);
});

test("slice 2 review LOWs: creative lanes refuse doc=cv; file names use the printed name; assist can't write the person's own words; GET counts pages; resume work stays in resume lanes", () => {
  const rd = (...p: string[]) => readFileSync(join(APP, ...p), "utf8");
  const exp = rd("app", "api", "creative", "[laneId]", "export", "route.ts");
  const docs = exp.match(/const DOCS = \[([^\]]*)\]/)![1];
  assert.ok(!/"cv"/.test(docs), "a creative lane never answers doc=cv");
  assert.match(exp, /const name = v\.model\.header\.name/);
  assert.match(exp, /const name = c\.model\.header\.name/);
  assert.ok(!/settings\.displayName/.test(exp), "never the raw typed name");
  const lane = rd("app", "api", "creative", "[laneId]", "route.ts");
  assert.match(lane, /OWNER_ONLY_FIELDS = \["interests", "languages", "leadReference", "skills"\]/);
  assert.match(lane, /if \(g\.impersonating && OWNER_ONLY_FIELDS\.some/);
  assert.match(lane, /buildCreative\(\{ doc: "cv", model: v\.model \}\)\.layout\.pages\.length/);
  assert.match(lane, /loadCvContext\(g\.userId, lane, pages\)/);
  for (const p of [["app", "api", "artifacts", "route.ts"], ["app", "api", "artifacts", "[id]", "fork", "route.ts"]]) {
    assert.match(rd(...p), /if \(!target \|\| laneKindOf\(target\) !== "resume"\)/);
  }
  const view = rd("components", "creative", "CvLaneView.tsx");
  assert.match(view, /data-testid="cv-lead-reference"/);
  assert.match(view, /settings: \{ leadReference: r\.entryId \}/);
});

test("performer lanes: the export builds the page from the database (8x10 or Letter), counts pages at 8x10, and the screen never takes a photo", () => {
  const rd = (...p: string[]) => readFileSync(join(APP, ...p), "utf8");
  const exp = rd("app", "api", "creative", "[laneId]", "export", "route.ts");
  assert.match(exp, /if \(laneKindOf\(lane\) === "performer"\) return exportPerformer\(/);
  assert.match(exp, /\["8x10", "letter"\]\.includes\(size\)/);
  assert.match(exp, /exportOpenItemLines\(v\.status, v\.entries, v\.settings, "performer", performerShownIds\(v\.model\)\)/);
  assert.match(exp, /buildCreative\(\{ doc: "performer", model: v\.model, trim: "8x10" \}\)/);
  const lane = rd("app", "api", "creative", "[laneId]", "route.ts");
  assert.match(lane, /buildCreative\(\{ doc: "performer", model: p\.model, trim: "8x10" \}\)\.layout\.pages\.length/);
  const view = rd("components", "creative", "PerformerLaneView.tsx");
  assert.ok(!/<img|type="file"|upload|weight/i.test(view.replace(/No weight, no birth date, no age/, "")), "no photo, upload or weight field");
  assert.match(view, /if \(trim === "8x10"\) setPages\(n\)/);
  assert.match(view, /exportOpenItemLines\(status, ctx\.entries, ctx\.settings, "performer", shownIds\)/);
  assert.match(rd("app", "(dashboard)", "RefineryShell.tsx"), /href: "\/dashboard\/performer", label: "Performer"/);
  // The coach and bio routes stay creative-only, so a performer lane is never sent to a model.
  for (const p of [["app", "api", "creative", "coach", "route.ts"], ["app", "api", "creative", "bio-draft", "route.ts"], ["app", "api", "creative", "[laneId]", "docs", "route.ts"]]) {
    assert.match(rd(...p), /await creativeLane\(g\.userId/, p.join("/"));
  }
  assert.match(rd("lib", "creative-server.ts"), /return docLane\(userId, laneId, \["creative"\]\);/);
});

test("review s2r3: the export passes each document's printed ids; one-tap answers are the person's alone; the record form takes other names", () => {
  const rd = (...p: string[]) => readFileSync(join(APP, ...p), "utf8");
  const exp = rd("app", "api", "creative", "[laneId]", "export", "route.ts");
  assert.match(exp, /exportOpenItemLines\(\{ \.\.\.c\.status, openItems: items \}, c\.entries, c\.settings, checkDoc, shown\)/);
  const lane = rd("app", "api", "creative", "[laneId]", "route.ts");
  assert.match(lane, /body\.phraseAnswer[\s\S]*?if \(g\.impersonating\) return ownerOnly\(\);[\s\S]*?applyPhraseAnswer\(current, pa\.phrase, pa\.answer\)/);
  const items = rd("components", "creative", "OpenItems.tsx");
  assert.match(items, /FACILITY_ASK_YES, FACILITY_ASK_NO/);
  for (const v of ["CvLaneView.tsx", "CreativeLaneView.tsx", "PerformerLaneView.tsx"]) assert.match(rd("components", "creative", v), /OpenItemAnswersContext\.Provider value=\{answers\}/);
  // The performer screen answers through the same PUT, one phrase at a time.
  assert.match(rd("components", "creative", "PerformerLaneView.tsx"), /put\(\{ phraseAnswer: \{ phrase, answer: yes \? "yes" : "no" \} \}, \(s\) => applyPhraseAnswer\(s, phrase, yes \? "yes" : "no"\) \?\? s\)/);
  assert.match(rd("components", "creative", "PracticeRecordPanel.tsx"), /Other names people use for it \(optional\)/);
});
