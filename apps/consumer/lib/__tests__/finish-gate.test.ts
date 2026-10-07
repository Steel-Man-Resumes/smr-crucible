/**
 * The Forge finish page gate (lib/finish-gate.ts): draft vs finished, defend
 * answers per line, and what the page may show in each state. Fixtures are
 * fictional.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildFinishView,
  canEmailPackage,
  changeLine,
  cutLine,
  downloadMode,
  finishKey,
  FINISH_STATE_VERSION,
  mainActionLabel,
  NEWSLETTER_DEFAULT_CHECKED,
  NEWSLETTER_LINE,
  openItemsInPlainWords,
  ownWordsFor,
  PDF_WORD_EXPLAINER,
  progressLine,
  readStoredFinish,
  recordAnswer,
  applyRewrite,
  prefillRewrite,
  rewritesOf,
  REVIEW_ASK_LINE,
  shouldCelebrate,
  shouldShowReviewAsk,
  statusLine,
  GOOGLE_REVIEW_URL,
} from "../finish-gate";

const SOURCE = `Morgan Sample
Toledo, OH | morgan@example.com
Line cook at Harbor Street Diner from 2019 to 2023.
I ran the grill on the breakfast line, prepped vegetables before open, and closed the kitchen at night.
The owner asked me to show new cooks the grill.`;

const RESUME = `MORGAN SAMPLE
Toledo, OH | morgan@example.com

Line cook

PROFESSIONAL EXPERIENCE
LINE COOK | Harbor Street Diner | 2019 - 2023
- Ran the grill on the breakfast line.
- Prepped vegetables before open and closed the kitchen at night.
- Asked by the owner to show new cooks the grill.

CORE COMPETENCIES
Grill, Breakfast line, Vegetable prep, Kitchen closing`;

const fresh = () => buildFinishView({ resumeText: RESUME, ownWords: SOURCE, defendAnswers: [] });

test("before the defend step the page is a draft with one open item per defend line", () => {
  const v = fresh();
  assert.equal(v.state, "draft");
  assert.ok(v.status.defendLines.length >= 2);
  assert.equal(v.fixCount, v.status.defendLines.length);
  assert.equal(v.groups.length, v.status.defendLines.length);
  for (const g of v.groups) {
    assert.equal(g.blocking, true);
    assert.equal(g.answerable, true, "a defend question is settled by an answer");
  }
  assert.equal(progressLine(v), `0 of ${v.defendTotal} lines checked`);
  assert.doesNotMatch(progressLine(v), /%/);
});

test("answers are per line: one answer settles one line, never another", () => {
  const v = fresh();
  const [first, second] = v.status.defendLines;
  const answers = recordAnswer([], first.line, "I ran that grill every morning shift.", "stands");
  const v2 = buildFinishView({ resumeText: RESUME, ownWords: SOURCE, defendAnswers: answers });
  assert.equal(v2.state, "draft");
  assert.equal(v2.defendDone, 1);
  assert.ok(v2.groups.some((g) => g.line === second.line), "the other line is still open");
  assert.ok(!v2.groups.some((g) => g.line === first.line), "the answered line is no longer open");
  assert.ok(v2.checkedLines.some((g) => g.line === first.line && g.checked));
  assert.equal(progressLine(v2), `1 of ${v2.defendTotal} lines checked`);
});

test("answering every defend line makes the page finished", () => {
  let answers = recordAnswer([], "x", "y", "stands").slice(0, 0);
  for (const d of fresh().status.defendLines) answers = recordAnswer(answers, d.line, "I did this myself on most shifts there, the owner can tell you.", "stands");
  const v = buildFinishView({ resumeText: RESUME, ownWords: SOURCE, defendAnswers: answers });
  assert.equal(v.state, "finished");
  assert.equal(v.fixCount, 0);
  assert.equal(statusLine(v), "Your resume is ready.");
  assert.equal(mainActionLabel(v), "Download your resume package");
});

test("an 'I don't know' answer does not settle a line", () => {
  const d = fresh().status.defendLines[0];
  const v = buildFinishView({
    resumeText: RESUME,
    ownWords: SOURCE,
    defendAnswers: recordAnswer([], d.line, "I don't know", "stands"),
  });
  const g = v.groups.find((x) => x.line === d.line);
  assert.ok(g, "still open");
  assert.equal(v.state, "draft");
});

test("recording a second answer for a line replaces the first, never pools", () => {
  let a = recordAnswer([], "- Ran the grill on the breakfast line.", "first", "stands");
  a = recordAnswer(a, "- Ran the grill on the breakfast line.", "second", "stands");
  a = recordAnswer(a, "- Prepped vegetables before open and closed the kitchen at night.", "other", "stands");
  assert.equal(a.length, 2);
  assert.equal(a.find((x) => x.line.includes("grill"))!.answer, "second");
});

test("a year the person never gave is a BLOCK that an answer cannot settle", () => {
  const moved = RESUME.replace("2019 - 2023", "2018 - 2023");
  let answers = recordAnswer([], "x", "y", "stands").slice(0, 0);
  for (const d of fresh().status.defendLines) answers = recordAnswer(answers, d.line, "I did this myself on most shifts there, the owner can tell you.", "stands");
  const v = buildFinishView({ resumeText: moved, ownWords: SOURCE, defendAnswers: answers });
  assert.equal(v.state, "draft");
  const g = v.groups.find((x) => x.items.some((i) => i.rule === "STD-T05"));
  assert.ok(g);
  assert.equal(g!.answerable, false, "only changing or cutting the line settles it");
  // Changing the line back to the person's years settles it.
  const fixed = changeLine(moved, g!.line, g!.line.replace("2018", "2019"));
  const v2 = buildFinishView({ resumeText: fixed, ownWords: SOURCE, defendAnswers: answers });
  assert.equal(v2.state, "finished");
});

test("draft labels say what's left; no percentages anywhere", () => {
  const v = fresh();
  const n = v.fixCount;
  assert.equal(mainActionLabel(v), `Fix ${n} things with t.ROY`);
  assert.match(statusLine(v), /things to fix before it's ready\.$/);
  assert.equal(mainActionLabel({ state: "draft", fixCount: 1 }), "Fix 1 thing with t.ROY");
  assert.equal(statusLine({ state: "draft", fixCount: 2 }), "Two things to fix before it's ready.");
  for (const s of [mainActionLabel(v), statusLine(v), progressLine(v)]) assert.doesNotMatch(s, /%/);
});

test("draft: no confetti, no email, no review ask; downloads carry the DRAFT flag and every open item", () => {
  const v = fresh();
  assert.equal(shouldCelebrate({ state: v.state, isDemo: false, docsReady: true, alreadyCelebrated: false }), false);
  assert.equal(canEmailPackage({ state: v.state, isDemo: false }), false);
  assert.equal(
    shouldShowReviewAsk({ state: v.state, isDemo: false, finishedDownloadDone: true, shownEarlierThisVisit: false, dismissed: false }),
    false
  );
  assert.deepEqual(downloadMode(v.state), { draft: true });
  const plain = openItemsInPlainWords(v.status);
  assert.equal(plain.length, v.status.openItems.length, "never hides an item");
  for (const p of plain) assert.match(p, /^(Fix before you send|Worth checking): /);
});

test("finished: confetti once, email open, finished download, never in the demo", () => {
  assert.equal(shouldCelebrate({ state: "finished", isDemo: false, docsReady: true, alreadyCelebrated: false }), true);
  assert.equal(shouldCelebrate({ state: "finished", isDemo: false, docsReady: true, alreadyCelebrated: true }), false);
  assert.equal(shouldCelebrate({ state: "finished", isDemo: true, docsReady: true, alreadyCelebrated: false }), false);
  assert.equal(shouldCelebrate({ state: "finished", isDemo: false, docsReady: false, alreadyCelebrated: false }), false);
  assert.deepEqual(downloadMode("finished"), { draft: false });
  assert.equal(canEmailPackage({ state: "finished", isDemo: false }), true);
  assert.equal(canEmailPackage({ state: "finished", isDemo: true }), false);
});

test("review ask: only after a finished download, once per visit, never in the demo", () => {
  const base = { state: "finished" as const, isDemo: false, finishedDownloadDone: true, shownEarlierThisVisit: false, dismissed: false };
  assert.equal(shouldShowReviewAsk(base), true);
  assert.equal(shouldShowReviewAsk({ ...base, finishedDownloadDone: false }), false, "not before a download");
  assert.equal(shouldShowReviewAsk({ ...base, shownEarlierThisVisit: true }), false, "never twice in a visit");
  assert.equal(shouldShowReviewAsk({ ...base, dismissed: true }), false);
  assert.equal(shouldShowReviewAsk({ ...base, isDemo: true }), false);
  assert.equal(shouldShowReviewAsk({ ...base, state: "draft" }), false);
  assert.equal(GOOGLE_REVIEW_URL, "https://g.page/r/CXwCW8901YTuEAE/review");
});

test("newsletter starts unchecked and its line is honest and plain", () => {
  assert.equal(NEWSLETTER_DEFAULT_CHECKED, false);
  assert.match(NEWSLETTER_LINE, /Sunday and Wednesday/);
  assert.match(NEWSLETTER_LINE, /unsubscribe any time/);
});

test("user-facing copy has no em or en dashes", () => {
  const copy = [NEWSLETTER_LINE, REVIEW_ASK_LINE, PDF_WORD_EXPLAINER.heading, ...PDF_WORD_EXPLAINER.lines];
  for (const c of copy) assert.doesNotMatch(c, /[–—]|--/, c);
  const joined = PDF_WORD_EXPLAINER.lines.join(" ");
  assert.match(joined, /same words/);
  assert.match(joined, /online applications/);
  assert.match(joined, /\.docx/);
});

test("cut and change touch one line only and keep its bullet", () => {
  const cut = cutLine(RESUME, "- Ran the grill on the breakfast line.");
  assert.doesNotMatch(cut, /Ran the grill/);
  assert.match(cut, /Prepped vegetables/);
  assert.equal(cutLine(RESUME, "- not on the page"), RESUME);
  const changed = changeLine(RESUME, "- Ran the grill on the breakfast line.", "Cooked on the grill for the breakfast rush.");
  assert.match(changed, /^- Cooked on the grill for the breakfast rush\.$/m);
  assert.equal(changeLine(RESUME, "- Ran the grill on the breakfast line.", "   "), RESUME);
});

test("own words: the resume text (record lines held back) plus typed answers, never the analysis", () => {
  const words = ownWordsFor(
    { resumeText: "Cook at a diner.\nWorked in the prison kitchen 2015 - 2017.", goalNarrative: "I want kitchen work.", hookNarrative: "" },
    false
  );
  assert.match(words, /Cook at a diner/);
  assert.match(words, /I want kitchen work/);
  assert.doesNotMatch(words, /prison/);
  assert.match(ownWordsFor({ resumeText: "Worked in the prison kitchen." }, true), /prison/);
});

test("stored finish: versioned and tied to its run", () => {
  const session = { forgeOutput: { a: 1 }, resumeText: "R" };
  const key = finishKey(session, false);
  assert.notEqual(key, finishKey(session, true));
  assert.notEqual(key, finishKey({ ...session, resumeText: "R2" }, false));
  const stored = {
    v: FINISH_STATE_VERSION,
    key,
    docs: { resumeText: RESUME, coverLetterText: "L", withheldLines: [], keepInsideLines: false, grounding: null },
    defendAnswers: [{ line: "- a", answer: "b", verdict: "stands" }],
  };
  assert.equal(readStoredFinish(stored, key)!.docs.resumeText, RESUME);
  assert.equal(readStoredFinish(stored, "other"), null);
  assert.equal(readStoredFinish({ ...stored, v: FINISH_STATE_VERSION + 1 }, key), null);
  assert.equal(readStoredFinish(null, key), null);
});

test("Change it never hands over a number the person did not give", () => {
  const own = "Line Cook | Riverside Diner | 2019 - 2023\n- Prepped for about 150 plates a day";
  assert.equal(prefillRewrite("- Cut food waste by 30% across 150 plates", own), "Cut food waste by [your number] across 150 plates");
  assert.equal(prefillRewrite("- Saved $1,200 a month", own), "Saved [your number] a month");
});

test("a rewrite counts only for what the person typed new; the written number typed back is not theirs", () => {
  const resume = "Sam Delgado\nSpringfield, IL | sam@example.com\n\nEXPERIENCE\nLine Cook | Riverside Diner | 2019 - 2023\n- Cut food waste by 30% with a new prep list";
  const own = "Line Cook, Riverside Diner, 2019 - 2023. I made a new prep list.";
  const line = "- Cut food waste by 30% with a new prep list";
  // Echoing the written number in an answer leaves it open.
  const echoed = recordAnswer([], line, "yes it was 30%", "stands");
  assert.equal(buildFinishView({ resumeText: resume, ownWords: own, defendAnswers: echoed }).state, "draft");
  // Retyping the written figure through "Change it" does not source it.
  const back = applyRewrite(resume, [], line, "Cut food waste by 30% with a new prep list each week");
  assert.equal(back.changed, true);
  assert.equal(rewritesOf(back.answers, back.text), "each week");
  assert.equal(buildFinishView({ resumeText: back.text, ownWords: own, defendAnswers: back.answers }).state, "draft");
  // A number the person typed new is theirs.
  const mine = applyRewrite(resume, [], line, "Cut food waste by about 10% with a new prep list");
  assert.match(rewritesOf(mine.answers, mine.text), /about 10%/);
  const view = buildFinishView({ resumeText: mine.text, ownWords: own, defendAnswers: mine.answers });
  assert.ok(!view.openItems.some((i) => i.rule === "STD-T02"), JSON.stringify(view.openItems));
});

test("the credentials answer counts as the person's own words", () => {
  const own = ownWordsFor({ resumeText: "Line Cook", challengeNarratives: { licenses_and_training: "ServSafe food handler card, current" } }, false);
  assert.match(own, /ServSafe food handler card, current/);
});
