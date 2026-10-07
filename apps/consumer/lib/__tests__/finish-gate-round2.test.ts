/**
 * Finish gate, review round 2 (consumer). Fictional fixtures.
 *
 * R2-B2: the writer's documents are kept unchanged, and nothing in them ever
 * becomes the person's through a rewrite, on any line. R2-B6: the cover
 * letter's sentences, scope words and credentials are checked. S3: the claim
 * trace settles only when the claim is gone. N1: a forged rewrite is not
 * trusted. Burden: the person's own number in another form is theirs.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as gate from "../finish-gate";

const { buildFinishView, recordAnswer, applyRewrite, cutLine, prefillRewrite, readStoredFinish } = gate;
type Input = Parameters<typeof buildFinishView>[0];
type Answers = Input["defendAnswers"];

const SOURCE = `Morgan Sample
Toledo, OH | morgan@example.com
Line cook at Harbor Street Diner from 2019 to 2023.
I ran the grill on the breakfast line, prepped vegetables before open, and closed the kitchen at night.
I took a forklift training class in 2019 at the county job center.
The owner asked me to show new cooks the grill.`;
const HEAD = `MORGAN SAMPLE
Toledo, OH | morgan@example.com

PROFESSIONAL EXPERIENCE
LINE COOK | Harbor Street Diner | 2019 - 2023`;
const BASE = ["Ran the grill on the breakfast line.", "Prepped vegetables before open and closed the kitchen at night."];
const page = (bullets: string[], tail = "") => `${HEAD}\n${bullets.map((b) => `- ${b}`).join("\n")}${tail}`;
const GOOD = "I did that at the diner most shifts, the owner can say so.";

function answerAll(resumeText: string, answers: Answers, extra: Partial<Input> = {}): ReturnType<typeof buildFinishView> {
  let a = answers;
  for (let k = 0; k < 4; k++) {
    const v = buildFinishView({ resumeText, ownWords: SOURCE, defendAnswers: a, ...extra } as Input);
    for (const g of v.groups) if (g.answerable && g.blocking) a = recordAnswer(a, g.line, g.target === "skill" ? `I used ${g.line} at the diner every week.` : GOOD, "stands");
  }
  return buildFinishView({ resumeText, ownWords: SOURCE, defendAnswers: a, ...extra } as Input);
}

// ---- R2-B2 ---------------------------------------------------------------------------

test("R2-B2: the writer's number typed into another line never becomes the person's", () => {
  const r = page(["Supervised a crew of 6 on the night shift.", ...BASE]);
  const written = { resume: r, letter: "" };
  const rw = applyRewrite(r, [], "- Ran the grill on the breakfast line.", "Ran the grill on the breakfast line with a crew of 6.");
  const v = answerAll(rw.text, rw.answers, { written } as Partial<Input>);
  assert.equal(v.state, "draft");
  assert.doesNotMatch(v.source.slice(SOURCE.length), /6/);
  // Even after the writer's line is cut.
  const cut = cutLine(rw.text, "- Supervised a crew of 6 on the night shift.");
  assert.equal(answerAll(cut, rw.answers, { written } as Partial<Input>).state, "draft");
});

test("R2-B2: a resume rewrite cannot clear a number the writer put in the letter", () => {
  const r = page(BASE);
  const letter = "Dear Hiring Manager,\n\nI cooked at Harbor Street Diner and supervised a team of 8 cooks on the night shift.\n\nThank you,\nMorgan Sample";
  const written = { resume: r, letter };
  const rw = applyRewrite(r, [], "- Ran the grill on the breakfast line.", "Ran the grill on the breakfast line with 8 cooks.");
  assert.equal(answerAll(rw.text, rw.answers, { coverLetterText: letter, written } as Partial<Input>).state, "draft");
});

test("R2-B2 / N1: a stored rewrite whose replaced line is empty or not the writer's is not trusted", () => {
  const r = page(["Managed inventory and vendor relationships for the kitchen.", ...BASE]);
  const line = "- Managed inventory and vendor relationships for the kitchen.";
  const base = { v: 1, key: "k", docs: { resumeText: r, coverLetterText: "", withheldLines: [], keepInsideLines: false, grounding: null, written: { resume: r, letter: "" } } };
  for (const replaced of ["", "- A line the writer never wrote."]) {
    const stored = readStoredFinish({ ...base, defendAnswers: [{ line, answer: line.slice(2), verdict: "stands", kind: "rewrite", replaced }] }, "k")!;
    assert.equal(stored.defendAnswers[0].kind, undefined, JSON.stringify(replaced));
  }
  const ok = readStoredFinish({ ...base, defendAnswers: [{ line, answer: line.slice(2), verdict: "stands", kind: "rewrite", replaced: "- Ran the grill on the breakfast line." }] }, "k")!;
  assert.equal(ok.defendAnswers[0].kind, "rewrite");
  assert.equal(ok.docs.written?.resume, r, "the written documents are kept");
});

// ---- R2-B6 ---------------------------------------------------------------------------

for (const claim of [
  "I hold my forklift certification and can run any lift on day one.",
  "I supervised the kitchen staff and trained every new hire.",
  "I managed vendor relationships and ordering for the whole diner.",
]) {
  test(`R2-B6: the letter claim "${claim}" holds the package in draft`, () => {
    const letter = `Dear Hiring Manager,\n\nI cooked at Harbor Street Diner. ${claim}\n\nThank you,\nMorgan Sample`;
    const v = answerAll(page(BASE), [], { coverLetterText: letter } as Partial<Input>);
    assert.equal(v.state, "draft");
    assert.ok(v.groups.some((g) => g.target === "letter" && g.blocking), JSON.stringify(v.openItems));
  });
}

test("R2-B6 (control): a letter in the person's words, with a courtesy close, raises nothing", () => {
  const letter = "Dear Hiring Manager,\n\nI ran the grill on the breakfast line at Harbor Street Diner and closed the kitchen at night. The owner asked me to show new cooks the grill.\n\nI would welcome the chance to talk.\n\nMorgan Sample";
  const v = buildFinishView({ resumeText: page(BASE), ownWords: SOURCE, defendAnswers: [], coverLetterText: letter });
  assert.deepEqual(v.openItems.filter((i) => i.target === "letter"), []);
});

test("R2-B6: a scope sentence in the letter is settled only by an answer about that scope", () => {
  const letter = "Dear Hiring Manager,\n\nI cooked at Harbor Street Diner. I supervised the kitchen staff on weekends.\n\nMorgan Sample";
  const line = "I cooked at Harbor Street Diner. I supervised the kitchen staff on weekends.";
  const r = page(BASE);
  const generic = buildFinishView({ resumeText: r, ownWords: SOURCE, defendAnswers: recordAnswer([], line, GOOD, "stands"), coverLetterText: letter });
  assert.ok(generic.groups.some((g) => g.target === "letter"));
  const real = buildFinishView({ resumeText: r, ownWords: SOURCE, defendAnswers: recordAnswer([], line, "On Sundays I supervised the two dishwashers when the owner was out.", "stands"), coverLetterText: letter });
  assert.ok(!real.groups.some((g) => g.target === "letter"), JSON.stringify(real.openItems));
});

test("R2-B6: a credential is asked once across the resume and the letter", () => {
  const src = `${SOURCE}\nI have a food handler card.`;
  const r = page(BASE, "\n\nCERTIFICATIONS\n- Food handler card");
  const letter = "Dear Hiring Manager,\n\nI ran the grill at Harbor Street Diner and I have my food handler card.\n\nI also hold my forklift certification.\n\nMorgan Sample";
  const v = buildFinishView({ resumeText: r, ownWords: src, defendAnswers: [], coverLetterText: letter });
  const cards = v.groups.filter((g) => /food handler/i.test(g.line));
  assert.equal(cards.length, 1, JSON.stringify(cards.map((g) => [g.target, g.line])));
  assert.equal(cards[0].target, "resume");
  assert.equal(new Set(cards[0].items.map((i) => i.question)).size, 1, "one question on the card");
  // A credential only the letter names is checked in the letter.
  assert.ok(v.groups.some((g) => g.target === "letter" && /forklift certification/.test(g.line) && g.blocking));
});

// ---- S3 ------------------------------------------------------------------------------

test("S3: a claim-trace credential is not cleared by reordering its words", () => {
  const r = page(BASE, "\n\nCERTIFICATIONS\n- ServSafe Food Handler, current");
  const written = { resume: r, letter: "" };
  const grounding = { outcomes: [{ claim: "ServSafe Food Handler", doc: "resume", status: "credential" }] };
  const rw = applyRewrite(r, [], "- ServSafe Food Handler, current", "Food Handler ServSafe, current");
  const v = answerAll(rw.text, rw.answers, { grounding, written } as Partial<Input>);
  assert.equal(v.state, "draft");
  assert.ok(v.openItems.some((i) => i.trace), "the claim trace still holds it");
});

test("S3: a claim found with a number word, across lines, or reworded is still held", () => {
  const r = page(["Supervised the night crew of five cooks.", ...BASE]);
  const src = `${SOURCE}\nI supervised the night crew of five cooks.`;
  const at = (claim: string, status = "still_there") =>
    buildFinishView({ resumeText: r, ownWords: src, defendAnswers: [], grounding: { outcomes: [{ claim, doc: "resume", status }] } }).openItems.filter((i) => i.trace);
  assert.equal(at("supervised the night crew of 5 cooks").length, 1);
  assert.equal(at("Harbor Street Diner | 2019 - 2023 - Supervised").length, 1);
  assert.equal(at("Ran the grill", "changed").length, 1);
});

// ---- burden --------------------------------------------------------------------------

test("burden: the person's own number in another form is theirs: no number card, and the prefill keeps it", () => {
  const src = `${SOURCE}\nI fed about forty-two people a night.`;
  const r = page(["Fed about 42 people a night on the grill.", ...BASE]);
  const v = buildFinishView({ resumeText: r, ownWords: src, defendAnswers: [] });
  assert.ok(!v.openItems.some((i) => i.rule === "STD-T02"), JSON.stringify(v.openItems));
  assert.equal(prefillRewrite("- Fed about 42 people a night on the grill.", src), "Fed about 42 people a night on the grill.");
});

test("burden: a page in the person's own words says so and asks nothing to fill a minimum", () => {
  const v = buildFinishView({ resumeText: page(BASE), ownWords: SOURCE, defendAnswers: [] });
  assert.equal(v.allLinesInOwnWords, true);
  assert.equal(v.state, "finished");
});

test("burden: an answer about a skill needs a real stem match, not a shared four-letter start", () => {
  const ok = gate.skillAnswerStands({ line: "Communication", answer: "I handled communication with the night crew every Friday.", verdict: "stands" }, "Communication", SOURCE);
  const no = gate.skillAnswerStands({ line: "Communication", answer: "I did commercial welding at the shop every Friday.", verdict: "stands" }, "Communication", SOURCE);
  assert.equal(ok, true);
  assert.equal(no, false);
});
