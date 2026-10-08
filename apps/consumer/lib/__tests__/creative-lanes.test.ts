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
