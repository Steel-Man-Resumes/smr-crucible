import { test } from "node:test";
import assert from "node:assert/strict";
import { nonEmptyList } from "../mini-forge-import";

test("an empty tablet list never reaches the save as a clear", () => {
  assert.equal(nonEmptyList([]), undefined);
  assert.equal(nonEmptyList(["", "  "]), undefined);
  assert.equal(nonEmptyList(undefined), undefined);
  assert.equal(nonEmptyList(null), undefined);
  assert.equal(nonEmptyList("steady work"), undefined);
});

test("real tablet answers pass through", () => {
  assert.deepEqual(nonEmptyList(["steady work", ""]), ["steady work"]);
});
