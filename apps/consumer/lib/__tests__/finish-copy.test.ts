/** The fix panel's heading lines distinguish source-checked rewrites from exact own words. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { fixPanelIntro, OWN_WORDS_LINE } from "../finish-copy";

test("finished with nothing asked: only 'Every line here is in your own words.'", () => {
  const i = fixPanelIntro({ state: "finished", defendTotal: 0, allLinesInOwnWords: true });
  assert.equal(i.heading, "Checks passed");
  assert.equal(i.subline, null);
  assert.equal(i.showOwnWords, true);
  assert.equal(OWN_WORDS_LINE, "Every line here is in your own words.");
});

test("a source-checked rewrite does not claim to use the person's exact words", () => {
  const i = fixPanelIntro({ state: "finished", defendTotal: 0, allLinesInOwnWords: false });
  assert.equal(i.heading, "Checks passed");
  assert.equal(i.showOwnWords, false);
  assert.match(i.subline ?? "", /checked the page against what you gave us/);
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
  assert.match(i.subline ?? "", /We fixed what we could from your page\. These still need your answer/);
});
