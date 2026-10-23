import { test } from "node:test";
import assert from "node:assert/strict";
import { returnToRefinery } from "../forge-return";

const returning = {
  loaded: true, signedIn: true, task: "resume", forgeComplete: false,
  change: false, step: null, fromRefinery: false,
};

test("returning account with a saved task but no finished Forge stays in Forge", () => {
  assert.equal(returnToRefinery(returning), false);
});

test("only confirmed Forge completion permits the returning-account redirect", () => {
  assert.equal(returnToRefinery({ ...returning, forgeComplete: true }), true);
});

test("explicit Forge work and the Refinery recovery path never bounce back", () => {
  for (const override of [{ change: true }, { step: "job" }, { fromRefinery: true }]) {
    assert.equal(returnToRefinery({ ...returning, forgeComplete: true, ...override }), false);
  }
});

test("loading, signed-out and new accounts remain in Forge", () => {
  for (const override of [{ loaded: false }, { signedIn: false }, { task: null }]) {
    assert.equal(returnToRefinery({ ...returning, forgeComplete: true, ...override }), false);
  }
});
