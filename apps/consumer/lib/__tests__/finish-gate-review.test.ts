/**
 * Finish gate, phase 2 review fixes (B2, B4, S1-S5, S7). Each case was a way
 * to reach "finished" on a false page, or a panel that disagreed with the
 * gate. Fictional fixtures.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as gate from "../finish-gate";
import { scoreResume } from "../ats/lenses";
import { applyFix } from "../ats/apply-fix";
import { SAMPLE_POSTINGS } from "../sample-postings";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const { buildFinishView, recordAnswer, readStoredFinish, finishKey, FINISH_STATE_VERSION, downloadMode, canEmailPackage } = gate;
type Answers = Parameters<typeof buildFinishView>[0]["defendAnswers"];
// New in the fix; looked up so a missing export fails the test, not the file.
const fn = <T>(name: string) => (gate as unknown as Record<string, T>)[name];

const SOURCE = `Morgan Sample
Toledo, OH | morgan@example.com
Line cook at Harbor Street Diner from 2019 to 2023.
I ran the grill on the breakfast line, prepped vegetables before open, and closed the kitchen at night.
I took a forklift training class in 2019 at the county job center.
The owner asked me to show new cooks the grill.`;

const page = (...bullets: string[]) => `MORGAN SAMPLE
Toledo, OH | morgan@example.com

PROFESSIONAL EXPERIENCE
LINE COOK | Harbor Street Diner | 2019 - 2023
${bullets.map((b) => `- ${b}`).join("\n")}`;

const GOOD = "I did that at the diner most shifts, the owner can say so.";
function answerRest(resumeText: string, answers: Answers, skip: string[] = [], extra: Partial<Parameters<typeof buildFinishView>[0]> = {}): Answers {
  let a = answers;
  const v = buildFinishView({ resumeText, ownWords: SOURCE, defendAnswers: a, ...extra });
  for (const g of v.groups) {
    if (skip.some((s) => g.line.includes(s))) continue;
    if (g.answerable) a = recordAnswer(a, g.line, GOOD, "stands");
  }
  return a;
}
type Rewrite = (text: string, answers: Answers, line: string, rewrite: string) => { text: string; answers: Answers; changed: boolean };

// ---- B2 ------------------------------------------------------------------------

test("B2: adding ' (current)' to a course written up as a certification does not finish it", () => {
  const applyRewrite = fn<Rewrite>("applyRewrite");
  assert.equal(typeof applyRewrite, "function");
  const resume = `${page("Ran the grill on the breakfast line.", "Prepped vegetables before open and closed the kitchen at night.")}\n\nCERTIFICATIONS\nForklift Certified, 2019`;
  const r = applyRewrite(resume, answerRest(resume, [], ["Forklift"]), "Forklift Certified, 2019", "Forklift Certified, 2019 (current)");
  const v = buildFinishView({ resumeText: r.text, ownWords: SOURCE, defendAnswers: answerRest(r.text, r.answers, ["Forklift"]) });
  assert.equal(v.state, "draft");
  assert.ok(v.openItems.some((i) => i.rule === "STD-T03" && i.severity === "BLOCK"), JSON.stringify(v.openItems));
});

test("B2: changing the last period to '!' does not make the writer's words the person's", () => {
  const applyRewrite = fn<Rewrite>("applyRewrite");
  const line = "- Spearheaded kitchen operations and supervised the culinary team.";
  const resume = page("Spearheaded kitchen operations and supervised the culinary team.", "Ran the grill on the breakfast line.", "Prepped vegetables before open and closed the kitchen at night.");
  const r = applyRewrite(resume, answerRest(resume, [], ["Spearheaded"]), line, "Spearheaded kitchen operations and supervised the culinary team!");
  assert.equal(r.changed, true);
  const v = buildFinishView({ resumeText: r.text, ownWords: SOURCE, defendAnswers: answerRest(r.text, r.answers, ["Spearheaded"]) });
  assert.equal(v.state, "draft");
});

test("B2: typing the shown number back with 'each day' keeps it unsourced", () => {
  const applyRewrite = fn<Rewrite>("applyRewrite");
  const resume = page("Loaded 50 trucks a day.", "Ran the grill on the breakfast line.");
  const r = applyRewrite(resume, [], "- Loaded 50 trucks a day.", "Loaded 50 trucks each day.");
  const v = buildFinishView({ resumeText: r.text, ownWords: SOURCE, defendAnswers: answerRest(r.text, r.answers, ["Loaded"]) });
  assert.equal(v.state, "draft");
  assert.ok(v.openItems.some((i) => i.rule === "STD-T02"));
});

test("B2: a rewrite of a rewrite measures against the first written line", () => {
  const applyRewrite = fn<Rewrite>("applyRewrite");
  const resume = page("Prepped vegetables for a busy dinner rush.", "Ran the grill on the breakfast line.", "Kept the walk-in cooler stocked for 40 covers a night.");
  let r = applyRewrite(resume, [], "- Prepped vegetables for a busy dinner rush.", "Prepped vegetables for 40 covers a night");
  r = applyRewrite(r.text, r.answers, "- Prepped vegetables for 40 covers a night", "Prepped vegetables before the dinner rush");
  const v = buildFinishView({ resumeText: r.text, ownWords: SOURCE, defendAnswers: answerRest(r.text, r.answers) });
  assert.equal(v.state, "draft", "the model's '40 covers' line stays unsourced once the person took their 40 back out");
  assert.ok(v.openItems.some((i) => i.rule === "STD-T02" && /walk-in/.test(i.line)));
});

// ---- S2 ------------------------------------------------------------------------

test("S2: a stored rewrite that is not its own line, or whose line is gone, counts for nothing", () => {
  const resume = page("Spearheaded kitchen operations and supervised a team of 12 cooks.", "Managed inventory and vendor relationships for the restaurant.", "Ran the grill on the breakfast line.");
  const key = finishKey({ forgeOutput: { a: 1 }, resumeText: SOURCE }, false);
  const stored = readStoredFinish(
    {
      v: FINISH_STATE_VERSION,
      key,
      docs: { resumeText: resume, coverLetterText: "", withheldLines: [], keepInsideLines: false, grounding: null },
      defendAnswers: [
        { line: "x", answer: resume, verdict: "stands", kind: "rewrite", replaced: "y" },
        { line: "- Ran the grill on the breakfast line.", answer: "Ran the grill on the breakfast line.", verdict: "stands", kind: "rewrite" },
      ],
    },
    key
  )!;
  assert.deepEqual(stored.defendAnswers.map((a) => a.kind ?? null), [null, null]);
  const v = buildFinishView({ resumeText: resume, ownWords: SOURCE, defendAnswers: answerRest(resume, stored.defendAnswers) });
  assert.equal(v.state, "draft");
  assert.ok(v.openItems.some((i) => i.rule === "STD-T02"));
});

// ---- B4 ------------------------------------------------------------------------

test("B4: a cover letter BLOCK keeps the whole package in draft, with the letter line in the fix list", () => {
  const resume = page("Ran the grill on the breakfast line.", "Prepped vegetables before open and closed the kitchen at night.", "Asked by the owner to show new cooks the grill.");
  const letter = "Dear Hiring Manager,\n\nI ran the grill on the breakfast line and supervised a team of 8 cooks.\n\nSincerely,\nMorgan Sample";
  const a = answerRest(resume, []);
  const v = buildFinishView({ resumeText: resume, ownWords: SOURCE, defendAnswers: a, coverLetterText: letter } as Parameters<typeof buildFinishView>[0]);
  assert.equal(v.state, "draft");
  assert.deepEqual(downloadMode(v.state), { draft: true });
  assert.equal(canEmailPackage({ state: v.state, isDemo: false }), false);
  const g = v.groups.find((x) => (x as { target?: string }).target === "letter");
  assert.ok(g && /team of 8/.test(g.line), JSON.stringify(v.groups));
  assert.ok(gate.openItemsInPlainWords(v as never).some((s) => /cover letter/.test(s)));
});

// ---- S1 ------------------------------------------------------------------------

test("S1: posting words confirmed into skills are each on the keep-or-cut card; a generic answer does not settle them", () => {
  const resume = `${page("Ran the grill on the breakfast line.", "Prepped vegetables before open and closed the kitchen at night.", "Asked by the owner to show new cooks the grill.")}\n\nSKILLS\nGrill, Breakfast line, Vegetable prep, Kitchen closing`;
  const p = SAMPLE_POSTINGS.find((s) => s.id === "cna")!;
  const fixes = scoreResume(resume, p.text, SOURCE).lenses.flatMap((l) => l.findings).map((f) => f.fix).filter((f) => f?.kind === "confirm_then_add");
  const terms = fixes.map((f) => (f as { term: string }).term);
  assert.ok(!terms.some((t) => /^certif/i.test(t)), `no credential one-tap adds: ${terms}`);
  for (const stop of ["duties", "help", "take", "using"]) assert.ok(!terms.includes(stop), `${stop} is filler`);
  let r = resume;
  for (const f of fixes) r = applyFix(r, f!);
  const v = buildFinishView({ resumeText: r, ownWords: SOURCE, defendAnswers: answerRest(r, []) });
  assert.equal(v.state, "draft");
  // D3 (2026-10-07): every added term is on ONE keep-or-cut card; a generic answer settles none.
  const card = v.groups.find((g) => (g as { target?: string }).target === "skillset");
  assert.ok(card && card.blocking && !card.answerable);
  for (const t of terms) assert.ok((card as { terms?: string[] }).terms!.includes(t), t);
  // Keeping one term settles that term only.
  const term = terms[0];
  const v2 = buildFinishView({ resumeText: r, ownWords: SOURCE, defendAnswers: answerRest(r, []), keptTerms: [term] } as Parameters<typeof buildFinishView>[0]);
  const card2 = v2.groups.find((g) => (g as { target?: string }).target === "skillset") as { terms?: string[] } | undefined;
  assert.ok(card2 && !card2.terms!.includes(term) && card2.terms!.length === terms.length - 1);
});

// ---- S3 ------------------------------------------------------------------------

test("S3: the gate exposes one source for every panel, extended only by what rewrites introduced", () => {
  const gateSource = fn<(o: string, a: Answers, ...t: string[]) => string>("gateSource");
  const applyRewrite = fn<Rewrite>("applyRewrite");
  const resume = page("Ran the grill on the breakfast line.");
  const r = applyRewrite(resume, [], "- Ran the grill on the breakfast line.", "Ran the grill on the breakfast line, about 40 plates an hour on Sundays.");
  const written = { resume, letter: "" };
  const src = (gateSource as unknown as (o: string, a: Answers, p: string, w: unknown) => string)(SOURCE, r.answers, r.text, written);
  assert.match(src, /about 40 plates an hour/);
  assert.doesNotMatch(src, /breakfast line, about/, "words carried over from the written line are not added");
  const v = buildFinishView({ resumeText: r.text, ownWords: SOURCE, defendAnswers: r.answers, written } as Parameters<typeof buildFinishView>[0]);
  assert.equal((v as { source?: string }).source, src);
});

// ---- S4 ------------------------------------------------------------------------

test("S4: an item whose line is not on the page goes to the general list, never to a card with dead buttons", () => {
  const resume = page("Loaded fifty trucks a day.", "Ran the grill on the breakfast line.");
  const v = buildFinishView({ resumeText: resume, ownWords: SOURCE, defendAnswers: [] });
  const t02 = v.openItems.find((i) => i.rule === "STD-T02")!;
  assert.equal(t02.line, "- Loaded fifty trucks a day.");
  const lines = new Set(resume.split("\n").map((l) => l.trim()));
  for (const g of v.groups) if ((g as { target?: string }).target === "resume") assert.ok(lines.has(g.line), g.line);
});

// ---- S5 ------------------------------------------------------------------------

test("S5: saving an unchanged line reports no change", () => {
  const applyRewrite = fn<Rewrite>("applyRewrite");
  const resume = page("Loaded 50 trucks a day.");
  assert.equal(applyRewrite(resume, [], "- Loaded 50 trucks a day.", "Loaded 50 trucks a day.").changed, false);
});

// ---- S7 ------------------------------------------------------------------------

test("S7: what the second check flags as still there or as a credential is held by the gate", () => {
  const resume = page("Ran the grill on the breakfast line.", "Kept a clean safety record on every shift.");
  const base = answerRest(resume, [], ["safety"]);
  const grounding = {
    verifierRan: true,
    residual: 1,
    outcomes: [
      { claim: "clean safety record", doc: "resume", status: "still_there" },
      { claim: "safety record", doc: "resume", status: "removed" },
    ],
  };
  const v = buildFinishView({ resumeText: resume, ownWords: SOURCE, defendAnswers: base, grounding } as Parameters<typeof buildFinishView>[0]);
  assert.equal(v.state, "draft");
  assert.ok(v.groups.some((g) => /clean safety record/.test(g.line) && g.blocking && g.answerable));
  const settled = recordAnswer(base, "- Kept a clean safety record on every shift.", "No write-ups or injuries in four years, the owner kept the log.", "stands");
  assert.equal(buildFinishView({ resumeText: resume, ownWords: SOURCE, defendAnswers: settled, grounding } as Parameters<typeof buildFinishView>[0]).state, "finished");
  const cred = { outcomes: [{ claim: "Ran the grill", doc: "resume", status: "credential" }] };
  assert.equal(buildFinishView({ resumeText: resume, ownWords: SOURCE, defendAnswers: settled }).state, "finished", "the same page with no flags is finished");
  assert.equal(buildFinishView({ resumeText: resume, ownWords: SOURCE, defendAnswers: settled, grounding: cred } as Parameters<typeof buildFinishView>[0]).state, "draft");
});

// ---- S8 ------------------------------------------------------------------------

test("S8: next-step copy claims only what carries over today", () => {
  const src = readFileSync(join(import.meta.dirname, "../../components/forge/finish/NextStep.tsx"), "utf8");
  assert.doesNotMatch(src, /everything you built here is waiting/i);
  assert.doesNotMatch(src, /is a strong general one/i);
});
