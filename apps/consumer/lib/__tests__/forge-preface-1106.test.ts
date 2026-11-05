/**
 * Jean Valjean Forge run, 2026-11-05 (the Michigan demo seat): the writer put a
 * caveat above the name ("I NEED TO FLAG ONE SCOPE QUESTION BEFORE FINALIZING,
 * BUT I'LL WRITE THE STRONGEST TRUE RESUME THE FACTS SUPPORT NOW."), the parser
 * took it as the name, and the person's name slid into the headline slot.
 *
 *  - stripWriterPreface cuts everything above the person's name, or every
 *    leading line that reads as the writer talking, and never touches a reply
 *    that starts with the name;
 *  - the writer prompt says the first line is the name and the story answer
 *    is the person's own words for scope;
 *  - the card's "This is true as written" is one tap, with the sentence box
 *    as an optional link.
 *
 * Fixtures are fictional (the living cast). No model call.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { ownNameOf, splitWriterOutput, stripWriterPreface, CHANGES_START, CHANGES_END } from "../writer-changes";
import { buildForgeResumePrompts } from "../forge-resume-prompt";
import { IdleActions } from "../../components/forge/finish/DefendPanel";
import { recordAnswer, answerFor } from "../finish-gate";
import { answerStands } from "@crucible/core/src/resumeStatus";

test("the gate: a one-tap 'as written' answer stands on its exact line; a typed answer that pastes the line back still does not (DEC-46)", () => {
  const line = "- Hire, train and schedule every person on both shifts.";
  const tapped = recordAnswer([], line, line, "stands", "as_written");
  assert.equal(tapped[0].kind, "as_written");
  assert.ok(answerStands(answerFor(tapped, line), line, "source words"));
  // The tap belongs to its own line only.
  assert.ok(!answerStands(answerFor(tapped, line), "- Ran the kiln schedule.", "source words"));
  // Typed back word for word: no.
  const pasted = recordAnswer([], line, line, "stands");
  assert.equal(pasted[0].kind, undefined);
  assert.ok(!answerStands(answerFor(pasted, line), line, "source words"));
  // A later typed answer on the same line replaces the tap.
  const later = recordAnswer(tapped, line, "I hire and train every person on both shifts myself.", "stands");
  assert.equal(later.length, 1);
  assert.equal(later[0].kind, undefined);
});

const PREFACE = "I NEED TO FLAG ONE SCOPE QUESTION BEFORE FINALIZING, BUT I'LL WRITE THE STRONGEST TRUE RESUME THE FACTS SUPPORT NOW.";
const PAGE = `JEAN VALJEAN
Milwaukee, WI | (414) 555-2460 | jean@example.invalid

Production Manager with hands-on forklift experience

CAREER SUMMARY
Production Manager at Madeleine Glassworks since March 2019.

PROFESSIONAL EXPERIENCE

PRODUCTION MANAGER | Madeleine Glassworks | Milwaukee, WI | March 2019 - present
- Hire, train and schedule employees.
- Keep production records and reports.

EDUCATION
GED | 2003`;

const OWN_PAGE = `JEAN VALJEAN
Milwaukee, WI
(414) 555-2460

OBJECTIVE
Seeking a supervisor position.`;

test("the 11/05 preface above the name is cut, with the name known from the person's page", () => {
  const r = stripWriterPreface(`${PREFACE}\n${PAGE}`, ownNameOf(OWN_PAGE));
  assert.equal(r.preface, PREFACE);
  assert.equal(r.resume, PAGE);
  assert.ok(r.resume.startsWith("JEAN VALJEAN\n"));
});

test("the preface is cut without a known name: a sentence about itself is not a name", () => {
  const r = stripWriterPreface(`${PREFACE}\n\n${PAGE}`);
  assert.equal(r.preface, PREFACE);
  assert.equal(r.resume, PAGE);
  // Two lines of talk, then the name.
  const two = stripWriterPreface(`Note: one scope question stays open.\nHere is the resume.\n${PAGE}`);
  assert.equal(two.resume, PAGE);
  assert.match(two.preface, /^Note:.*\nHere is the resume\.$/);
});

test("a reply that starts with the name is never changed", () => {
  for (const name of [undefined, "Jean Valjean", "JEAN VALJEAN"]) {
    const r = stripWriterPreface(PAGE, name);
    assert.equal(r.preface, "");
    assert.equal(r.resume, PAGE);
  }
  // A name in normal capitals is still the name.
  const mixed = PAGE.replace("JEAN VALJEAN", "Jean Valjean");
  assert.equal(stripWriterPreface(mixed).resume, mixed);
  assert.equal(stripWriterPreface(mixed, "Jean Valjean").resume, mixed);
});

test("a known name that is not in the reply falls back to the talk rule; a reply with no page left is kept whole", () => {
  const r = stripWriterPreface(`${PREFACE}\n${PAGE}`, "Marqus Relly");
  assert.equal(r.resume, PAGE);
  const short = stripWriterPreface(`${PREFACE}\nJEAN VALJEAN`);
  assert.equal(short.resume, `${PREFACE}\nJEAN VALJEAN`);
  assert.equal(short.preface, "");
});

test("the preface cut runs after the CHANGES block is split off, and the block still parses", () => {
  const reply = `${PREFACE}\n${PAGE}\n\n${CHANGES_START}\n[{"old": "Seeking a supervisor position.", "new": "Production Manager with hands-on forklift experience", "why": "An objective asks; a headline says.", "rule": "objective"}]\n${CHANGES_END}`;
  const split = splitWriterOutput(reply);
  assert.ok(Array.isArray(split.changes) && (split.changes as unknown[]).length === 1);
  const r = stripWriterPreface(split.resume, "Jean Valjean");
  assert.equal(r.resume, PAGE);
});

test("ownNameOf reads the person's page: a name line yes, a heading, a contact line or a number no", () => {
  assert.equal(ownNameOf(OWN_PAGE), "JEAN VALJEAN");
  assert.equal(ownNameOf("Jean Valjean\nMilwaukee"), "Jean Valjean");
  assert.equal(ownNameOf("PROFESSIONAL EXPERIENCE\nJean"), undefined);
  assert.equal(ownNameOf("(414) 555-2460\nJean Valjean"), undefined);
  assert.equal(ownNameOf("jean@example.invalid"), undefined);
  assert.equal(ownNameOf(""), undefined);
  assert.equal(ownNameOf(undefined), undefined);
});

test("the writer prompt: first line is the name, no preface; the story answer settles scope for its job", () => {
  const { system, user } = buildForgeResumePrompts({
    narrative: { headline: "Production manager", summary: "Runs a glass shop floor." },
    strengths: [{ title: "Hiring", evidence: "Hires and trains the crew", source: "resume" }],
    skills: [{ name: "Forklift", category: "equipment" }],
    resumeText: OWN_PAGE,
    hookNarrative: "I run production at a small glass shop, about twelve people across two shifts, and I hire, train and schedule all of them.",
  });
  assert.match(system, /10\. START WITH THE NAME\. The first line of your reply is the person's full name/);
  assert.match(system, /Never a preface, a note, a question, a caveat/);
  assert.match(user, /WORK THE PERSON SAYS THE OLD RESUME MISSED \(their own words, in so many words/);
  assert.match(user, /that settles scope for that job/);
  assert.ok(user.includes("I hire, train and schedule all of them."));
  for (const t of [system, user]) assert.doesNotMatch(t, /[—]/);
});

test("the card: 'This is true as written' is one tap and the sentence box is a link", () => {
  let taps = 0;
  let words = 0;
  const html = renderToStaticMarkup(
    React.createElement(IdleActions, {
      target: "resume",
      answerable: true,
      suggesting: false,
      notice: "",
      onDraft() {},
      onAnswer() { taps++; },
      onAnswerInWords() { words++; },
      onChange() {},
      onCut() {},
    })
  );
  assert.ok(html.includes('data-testid="true-as-written"'));
  assert.ok(html.includes("This is true as written"));
  assert.ok(html.includes('data-testid="answer-in-words"') && html.includes("Or add a word in your own words"));
  // Not answerable: neither the tap nor the link.
  const no = renderToStaticMarkup(
    React.createElement(IdleActions, { target: "resume", answerable: false, suggesting: false, notice: "", onDraft() {}, onAnswer() {}, onAnswerInWords() {}, onChange() {}, onCut() {} })
  );
  assert.ok(!no.includes("true-as-written") && !no.includes("answer-in-words"));
  // Without the optional handler the link is not drawn (older callers).
  const plain = renderToStaticMarkup(
    React.createElement(IdleActions, { target: "resume", answerable: true, suggesting: false, notice: "", onDraft() {}, onAnswer() {}, onChange() {}, onCut() {} })
  );
  assert.ok(plain.includes("true-as-written") && !plain.includes("answer-in-words"));
  assert.equal(taps + words, 0);
});
