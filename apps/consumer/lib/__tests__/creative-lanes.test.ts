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
  assert.match(docs, /checkBioSave\(/);
});

test("the coach route stores fingerprints of the raw reply and returns only questions and marks", () => {
  const src = readFileSync(join(APP, "app", "api", "creative", "coach", "route.ts"), "utf8");
  assert.match(src, /modelFingerprints\(raw, text\)/);
  assert.match(src, /parseCoachOutput\(raw, text\)/);
  const ret = src.slice(src.lastIndexOf("return NextResponse.json({"));
  assert.ok(!/\braw\b/.test(ret.split("});")[0]), "the raw reply never goes back to the screen");
});
