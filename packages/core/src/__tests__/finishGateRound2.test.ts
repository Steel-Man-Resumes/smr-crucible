/**
 * Finish gate, review round 2 (core). Fictional fixtures.
 *
 * Truth: credentials checked one at a time wherever they sit (R2-B1), header
 * lines and job titles asked about (R2-B3), numbers read the way people write
 * them (R2-B4), a credential nobody mentioned is not settled by an answer
 * (R2-B5), answers have to say something about the line (S1).
 * Burden: numbers compared by value, each credential asked once and not at
 * all when the person already gave its type and year, the two-line minimum
 * filled only with lines that differ, skills matched by real stems.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { getResumeStatus, pickDefendLines, Q_TITLE, type DefendAnswer } from "../resumeStatus";
import { runMintCheck, numbersIn } from "../resumeMintCheckShared";

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
const answerEvery = (resume: string, src = SOURCE, ans = GOOD): DefendAnswer[] =>
  pickDefendLines(resume, src).map((d) => ({ line: d.line, answer: ans, verdict: "stands" as const }));
const status = (resume: string, answers: DefendAnswer[] = [], src = SOURCE) =>
  getResumeStatus({ resumeText: resume, sourceText: src, defendAnswers: answers });

// ---- R2-B1 ---------------------------------------------------------------------------

test("R2-B1: 'Forklift Certified' inside a long skills line is its own credential, written up from a class: BLOCK", () => {
  const r = page(BASE, `\n\nCORE COMPETENCIES\nGrill cooking, Food prep, Forklift Certified, Kitchen closing, Vegetable prep, Breakfast line`);
  const s = status(r, answerEvery(r));
  assert.equal(s.state, "draft");
  const f = s.openItems.find((i) => i.rule === "STD-T03" && i.severity === "BLOCK");
  assert.equal(f?.line, "Forklift Certified");
  assert.ok(!s.openItems.some((i) => /Grill cooking/.test(i.question)), "never named by the line's first word");
});

test("R2-B1: a credential in a long summary sentence is found by name", () => {
  const r = page(BASE).replace("PROFESSIONAL EXPERIENCE", "SUMMARY\nLine cook who ran the breakfast grill and is ServSafe Manager certified, with years on the line.\n\nPROFESSIONAL EXPERIENCE");
  const s = status(r, answerEvery(r));
  assert.ok(s.openItems.some((i) => i.rule === "STD-T03" && i.severity === "BLOCK" && /ServSafe/.test(i.line)), JSON.stringify(s.openItems));
});

// ---- R2-B3 ---------------------------------------------------------------------------

test("R2-B3: a pipe headline above the first heading is a headline, asked about, and a generic answer does not settle it", () => {
  const r = `MORGAN SAMPLE
Toledo, OH | morgan@example.com
Kitchen Supervisor | Team Leader | Food Safety Manager

PROFESSIONAL EXPERIENCE
LINE COOK | Harbor Street Diner | 2019 - 2023
- ${BASE[0]}
- ${BASE[1]}`;
  const head = "Kitchen Supervisor | Team Leader | Food Safety Manager";
  assert.ok(pickDefendLines(r, SOURCE).some((d) => d.line === head));
  assert.equal(status(r, answerEvery(r)).state, "draft");
});

test("R2-B3: a job title the person never had raises STD-C03; an answer about the title settles it", () => {
  const r = page(BASE).replace("LINE COOK |", "KITCHEN MANAGER |");
  const s = status(r, answerEvery(r));
  const c03 = s.openItems.find((i) => i.rule === "STD-C03");
  assert.ok(c03 && c03.severity === "BLOCK", JSON.stringify(s.openItems));
  assert.equal(c03!.question, Q_TITLE);
  const header = "KITCHEN MANAGER | Harbor Street Diner | 2019 - 2023";
  const generic = [...answerEvery(r), { line: header, answer: GOOD, verdict: "stands" as const }];
  assert.equal(status(r, generic).state, "draft", "a generic answer is not about the title");
  const real = [...answerEvery(r), { line: header, answer: "My pay stubs from Harbor say kitchen manager for the last year.", verdict: "stands" as const }];
  // Round 5: "manager" is also a scope claim; only a rewrite or a cut settles that part.
  assert.ok(status(r, real).openItems.every((i) => i.kind === "scope_unsaid" && i.line === header), JSON.stringify(status(r, real).openItems));
  // A title with no scope word is settled by an answer about the title.
  const r2 = page(BASE).replace("LINE COOK |", "SOUS CHEF |");
  const header2 = "SOUS CHEF | Harbor Street Diner | 2019 - 2023";
  const real2 = [...answerEvery(r2), { line: header2, answer: "My pay stubs from Harbor say sous chef for the last year.", verdict: "stands" as const }];
  assert.equal(status(r2, real2).state, "finished", JSON.stringify(status(r2, real2).openItems));
});

test("R2-B3 (control): a title in the person's words in any order is not asked ('cook, line')", () => {
  const src = SOURCE.replace("Line cook at Harbor Street Diner", "Cook, line, at Harbor Street Diner");
  assert.ok(!status(page(BASE), [], src).openItems.some((i) => i.rule === "STD-C03"));
});

// ---- R2-B4 ---------------------------------------------------------------------------

for (const f of [
  "Served over a hundred customers every morning.",
  "Served a few hundred plates each weekend.",
  "Cut food waste in half by prepping to par.",
  "Doubled breakfast ticket speed on the grill.",
  "Tripled the catering orders the kitchen handled.",
  "Served ５０ tables a night on the grill.",
  "Served ٥٠ tables a night on the grill.",
  "Ranked first among the line cooks for ticket times.",
  "Ran the grill for a decade.",
]) {
  test(`R2-B4: "${f}" is a number the person never gave: BLOCK that an answer cannot settle`, () => {
    assert.ok(numbersIn(f).size > 0, f);
    const r = page([f, ...BASE]);
    const s = status(r, answerEvery(r));
    assert.equal(s.state, "draft");
    assert.ok(s.openItems.some((i) => i.rule === "STD-T02" && i.severity === "BLOCK" && i.line === `- ${f}`), JSON.stringify(s.openItems));
  });
}

test("R2-B4: numbers are compared by value, in any form", () => {
  const pairs: Array<[string, string]> = [
    ["Fed 42 people a night.", "I fed forty-two people a night."],
    ["Managed budgets totaling $400,000.", "I managed four hundred thousand dollars in budgets."],
    ["Held tolerances within .002 inch.", "I held tolerances within two thousandths of an inch."],
    ["Ten years in marketing, 10 years of campaigns.", "I have a decade in marketing."],
    ["Ran a 100,000-square-foot facility.", "I ran a hundred-thousand-square-foot facility."],
    ["Kept a 99% audit pass rate.", "I kept a ninety-nine percent audit pass rate."],
  ];
  for (const [line, said] of pairs) {
    const r = page([line, ...BASE]);
    const t02 = runMintCheck({ output: r, source: `${SOURCE}\n${said}`, kind: "resume" }).findings.filter((x) => x.rule === "STD-T02");
    assert.deepEqual(t02, [], `${line} / ${said}`);
  }
});

test("R2-B4: a spec word is not a count ('three-axis', 'two-way'); a count joined to its noun is", () => {
  assert.equal(numbersIn("Set up three-axis and four-axis CNC mills; used a two-way radio.").size, 0);
  assert.ok(numbersIn("Worked twelve-hour shifts on a three-person crew.").has("12"));
});

// ---- R2-B5 ---------------------------------------------------------------------------

test("R2-B5: a credential the person never mentioned is a BLOCK no answer settles", () => {
  for (const tail of ["\n\nCERTIFICATIONS\n- ServSafe Food Handler, current", "\n\nCERTIFICATIONS\n- ServSafe Food Handler"]) {
    const r = page(BASE, tail);
    const answers = [...answerEvery(r), { line: "- ServSafe Food Handler, current", answer: "It is a certification, it is current, I have the card at the diner.", verdict: "stands" as const }];
    const s = status(r, answers);
    assert.equal(s.state, "draft");
    assert.ok(s.openItems.some((i) => i.rule === "STD-T03" && i.severity === "BLOCK" && i.kind === "credential_unsaid"), JSON.stringify(s.openItems));
  }
});

test("R2-B5 (round 5): a credential is never a defend question; it is a memory prompt no answer settles", () => {
  const src = `${SOURCE}\nI have a food handler card.`;
  const r = page(BASE, "\n\nCERTIFICATIONS\n- Food handler card");
  const line = "- Food handler card";
  assert.ok(!pickDefendLines(r, src).some((d) => d.line === line));
  const typed = [...answerEvery(r, src), { line, answer: "It is a card from the county health office, current until next spring.", verdict: "stands" as const }];
  assert.ok(status(r, typed, src).openItems.some((i) => i.line === line && i.kind === "credential_unsaid"));
});

// ---- S1 ------------------------------------------------------------------------------

const P4 = page(["Managed inventory and vendor relationships for the kitchen.", "Coordinated catering events for corporate clients.", ...BASE]);
for (const ans of ["I did this every day at work.", "That was part of my job duties.", "I did all of this at my old job back then.", "Yes I did that one at my last place every week.", "This happened at work many times over the years."]) {
  test(`S1: "${ans}" says nothing about the line`, () => {
    assert.equal(status(P4, answerEvery(P4, SOURCE, ans)).state, "draft");
  });
}

test("S1 (control): an answer about the line, or with a concrete detail, stands", () => {
  const lines = pickDefendLines(P4, SOURCE);
  const a = lines.map((d) => ({ line: d.line, verdict: "stands" as const, answer: /inventory/.test(d.line) ? "I managed the walk-in counts and called the produce guy every Monday." : "I coordinated the catering trays for the insurance office lunches on Fridays." }));
  // Round 5: the answers settle the defend questions; only the scope claims are left, for a rewrite or a cut.
  const open = status(P4, a).openItems;
  assert.ok(open.length > 0 && open.every((i) => i.kind === "scope_unsaid"), JSON.stringify(open));
});

// ---- burden --------------------------------------------------------------------------

test("burden: a credential is asked once, by its own name, across the page", () => {
  const src = "Tasha Example\nNursing assistant at Meadowbrook from 2017 to 2024.\nI helped residents with bathing and meals. I know CPR and first aid.";
  const r = `TASHA EXAMPLE
Certified Nursing Assistant

SUMMARY
Certified nursing assistant who helped residents with bathing and meals.

PROFESSIONAL EXPERIENCE
NURSING ASSISTANT | Meadowbrook | 2017 - 2024
- Helped residents with bathing and meals.

SKILLS
Patient care, CPR, First aid

CERTIFICATIONS
- Certified Nursing Assistant
- CPR`;
  const creds = pickDefendLines(r, src).filter((d) => d.reasons.includes("credential"));
  const names = creds.map((d) => d.question.match(/"([^"]+)"/)?.[1]);
  assert.equal(new Set(names).size, names.length, JSON.stringify(names));
  assert.ok(!names.some((n) => /Patient care/.test(n ?? "")), "never named by another term on the line");
  // Round 4: "Nursing assistant" as a job is not the CNA credential, so it is one memory prompt (D4), still asked once.
  const prompts = getResumeStatus({ resumeText: r, sourceText: src }).openItems.filter((i) => i.kind === "credential_unsaid").map((i) => i.subject ?? "");
  assert.equal([...names, ...prompts].filter((n) => /nursing assistant/i.test(n ?? "")).length, 1, JSON.stringify([names, prompts]));
});

test("burden: a credential the person gave with a type and a year is not asked", () => {
  const src = `${SOURCE}\nWelding Certificate | West Michigan Technical College | 2011`;
  const r = page(BASE, "\n\nEDUCATION\nWelding Certificate\nWest Michigan Technical College | 2011");
  assert.ok(!pickDefendLines(r, src).some((d) => d.reasons.includes("credential")));
});

test("burden: the two-line minimum fills only with lines that differ from the person's words", () => {
  const own = page(BASE);
  const s = status(own);
  assert.equal(s.allLinesInOwnWords, true);
  assert.deepEqual(s.defendLines.filter((d) => d.reasons.includes("far_from_your_words")), []);
  const carried = "Tasha Example\nI helped customers locate products and carried out heavy items.";
  assert.ok(!pickDefendLines(page(["Helped customers locate products and carry out heavy items."]), carried).some((d) => d.reasons.includes("far_from_your_words")), "carry and carried are one word");
});

test("burden: skills pass only on a real stem or phrase, and never on a scope word the person never used", () => {
  const welder = "Dana Example\nWelded steel for commercial construction projects.";
  const r = `DANA EXAMPLE\n\nSKILLS\nCommunication, Commercial welding, Kitchen supervision\n\nPROFESSIONAL EXPERIENCE\nWELDER | Shop | 2019 - 2023\n- Welded steel.`;
  const terms = runMintCheck({ output: r, source: `${welder}\nI ran the kitchen at night.`, kind: "resume" }).findings.filter((f) => f.kind === "grid_term" || f.kind === "grid_scope_term").map((f) => f.line);
  assert.ok(terms.includes("Communication"), "commercial is not communication");
  assert.ok(!terms.includes("Commercial welding"));
  assert.ok(terms.includes("Kitchen supervision"), "a scope word they never used");
});
