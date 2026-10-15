import { test } from "node:test";
import assert from "node:assert/strict";
import { hasOpenMintBlock } from "../mint-blocks";

const SOURCE = `Alex Rivera
Line Cook | Harbor Grill | 2021 - 2023
Cooked for 200 covers a night.`;

test("empty inputs mean nothing is open (the panel shows nothing either)", () => {
  assert.equal(hasOpenMintBlock("", SOURCE), false);
  assert.equal(hasOpenMintBlock("Alex Rivera", ""), false);
});

test("a clean resume has no open BLOCK", () => {
  assert.equal(hasOpenMintBlock(SOURCE, SOURCE), false);
});

test("a date the person never gave is an open BLOCK", () => {
  const moved = SOURCE.replace("2021 - 2023", "2019 - 2023");
  assert.equal(hasOpenMintBlock(moved, SOURCE), true);
});
