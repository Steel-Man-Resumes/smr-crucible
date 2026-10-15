import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { WORKSHOP_PLACEHOLDERS, FIRST_BULLET_PLACEHOLDER } from "../workshop-placeholders";

test("no workshop placeholder contains a digit (no example figures to anchor on)", () => {
  for (const [key, text] of Object.entries(WORKSHOP_PLACEHOLDERS)) {
    assert.doesNotMatch(text, /\d/, `placeholder "${key}" has a digit`);
  }
  assert.doesNotMatch(FIRST_BULLET_PLACEHOLDER, /\d/);
});

test("the count question names what to count and does not give a value", () => {
  assert.match(WORKSHOP_PLACEHOLDERS.quantity, /people, orders or loads/);
  assert.match(WORKSHOP_PLACEHOLDERS.quantity, /Only if you know/);
});

test("the workshop and bullet box use the shared placeholders, not inline text", () => {
  const dir = join(__dirname, "..", "..", "components", "resume");
  const workshop = readFileSync(join(dir, "BulletWorkshop.tsx"), "utf8");
  const sections = readFileSync(join(dir, "sections.tsx"), "utf8");
  assert.match(workshop, /WORKSHOP_PLACEHOLDERS\.quantity/);
  assert.doesNotMatch(workshop, /placeholder="[^"]*\d/);
  assert.match(sections, /FIRST_BULLET_PLACEHOLDER/);
  assert.doesNotMatch(sections, /Example: "Trained/);
});
