import { test } from "node:test";
import assert from "node:assert/strict";
import { hasChip, toggleChip, canGenerateBullet } from "../bullet-chips";

test("first tap adds the chip, second tap removes it", () => {
  const on = toggleChip("", "daily");
  assert.equal(on, "daily");
  assert.equal(hasChip(on, "daily"), true);
  const off = toggleChip(on, "daily");
  assert.equal(off, "");
  assert.equal(hasChip(off, "daily"), false);
});

test("typed text is kept when a chip is added and removed", () => {
  const added = toggleChip("every shift", "during peak season");
  assert.equal(added, "every shift, during peak season");
  assert.equal(toggleChip(added, "during peak season"), "every shift");
});

test("matching is case-insensitive and removes only that chip", () => {
  assert.equal(toggleChip("Daily, weekly", "daily"), "weekly");
  assert.equal(hasChip("Daily, weekly", "WEEKLY"), true);
});

test("a chip is not 'on' just because its text sits inside a longer phrase", () => {
  assert.equal(hasChip("did it daily for years", "daily"), false);
});

test("a trailing comma does not leave a stray separator", () => {
  assert.equal(toggleChip("forklift,", "RF scanner"), "forklift, RF scanner");
});

test("an answer to How often alone is enough to generate", () => {
  const empty = { did: "", tools: "", often: "", quantity: "", improved: "" };
  assert.equal(canGenerateBullet(empty), false);
  assert.equal(canGenerateBullet({ ...empty, often: "every shift" }), true);
  assert.equal(canGenerateBullet({ ...empty, did: "  " }), false);
});
