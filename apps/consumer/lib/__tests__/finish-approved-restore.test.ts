import { test } from "node:test";
import assert from "node:assert/strict";
import { applyAssistedRewrite, readStoredFinish, FINISH_STATE_VERSION, rewritesOf } from "../finish-gate";
import { answerStands } from "@crucible/core/src/resumeStatus";

const source = "I loaded trucks at the Harbor Street dock every Friday.";
const original = "Loaded trucks every Friday at the Harbor Street dock.";
const proposal = "Loaded trucks at the Harbor Street dock every Friday.";
function restore(answer: unknown) {
  return readStoredFinish({ v: FINISH_STATE_VERSION, key: "test", docs: {
    resumeText: proposal, coverLetterText: "", written: { resume: original, letter: "" },
  }, defendAnswers: [answer] }, "test")!.defendAnswers;
}

test("approved t.ROY wording survives the same cleaner used by server saves and browser restores", () => {
  const changed = applyAssistedRewrite(original, [], original, proposal, source);
  const answers = restore(changed.answers[0]);
  assert.equal(answers[0].kind, "assisted");
  assert.equal(answers[0].replaced, original);
  assert.equal(answerStands(answers[0], proposal, source), true);
  assert.equal(rewritesOf(answers, proposal, { resume: original, letter: "" }), "", "AI wording is never promoted into source facts");
});

test("restoring an approval does not let invented experience pass", () => {
  const line = "Supervised twelve forklift operators.";
  const [answer] = restore({ line, answer: line, replaced: original, kind: "assisted", verdict: "stands" });
  assert.equal(answerStands(answer, line, source), false);
});

test("malformed or mismatched approvals do not retain the assisted marker", () => {
  for (const invalid of [
    { line: proposal, answer: "different text", replaced: original },
    { line: proposal, answer: proposal },
    { line: proposal, answer: proposal, replaced: "" },
  ]) {
    assert.notEqual(restore({ ...invalid, kind: "assisted", verdict: "stands" })[0].kind, "assisted");
  }
});
