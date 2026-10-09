/** The fix panel's heading lines: nothing asked says only that every line is theirs. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { fixPanelIntro, OWN_WORDS_LINE } from "../finish-copy";

test("finished with nothing asked: only 'Every line here is in your own words.'", () => {
  const i = fixPanelIntro({ state: "finished", defendTotal: 0, allLinesInOwnWords: true });
  assert.equal(i.subline, null);
  assert.equal(i.showOwnWords, true);
  assert.equal(OWN_WORDS_LINE, "Every line here is in your own words.");
});

test("finished after answering keeps the checked line", () => {
  const i = fixPanelIntro({ state: "finished", defendTotal: 2, allLinesInOwnWords: false });
  assert.equal(i.heading, "Every line checked");
  assert.equal(i.subline, "You can explain every line we asked about. You can still change an answer.");
  assert.equal(i.showOwnWords, false);
});

test("draft says what to do", () => {
  const i = fixPanelIntro({ state: "draft", defendTotal: 2, allLinesInOwnWords: false });
  assert.equal(i.heading, "Fix these with t.ROY");
  assert.match(i.subline ?? "", /Say it's true, change it, or cut it/);
});
