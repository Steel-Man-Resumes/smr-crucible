import { test } from "node:test";
import assert from "node:assert/strict";
import { readIdea, isIdeaStage } from "../supportRequestShared";

test("legacy ideas never imply contact permission", () => {
  assert.equal(readIdea(undefined).followUp, false);
  assert.equal(readIdea({}, "closed").stage, "closed");
});
test("only an explicit boolean grants contact permission", () => {
  for (const value of ["true", 1, {}, null, undefined]) {
    assert.equal(readIdea({ idea: { followUp: value } }).followUp, false);
  }
  assert.equal(readIdea({ idea: { followUp: true } }).followUp, true);
});
test("contact permission does not create a publication state", () => {
  assert.equal(isIdeaStage("published"), false);
  assert.deepEqual(readIdea({ idea: { followUp: true, stage: "published", update: 42 } }), {
    followUp: true, stage: "received", update: "",
  });
});
test("progress and contact preference are independent", () => {
  assert.deepEqual(readIdea({ idea: { stage: "next_step", followUp: false, update: "Checking a course." } }), {
    stage: "next_step", followUp: false, update: "Checking a course.",
  });
});
