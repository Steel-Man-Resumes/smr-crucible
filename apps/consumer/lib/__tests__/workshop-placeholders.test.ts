import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { MESSAGES } from "../../messages";
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
  // The components now look the placeholders up in the catalog (refineryResume.resume.bullet.ph.* and resume.sections.exp.firstBullet).
  // Each catalog English value must equal the shared lib constant so the two cannot drift, and each box must read its catalog key.
  const en = MESSAGES.en as any;
  for (const key of Object.keys(WORKSHOP_PLACEHOLDERS) as (keyof typeof WORKSHOP_PLACEHOLDERS)[]) {
    assert.equal(en.refineryResume.resume.bullet.ph[key], WORKSHOP_PLACEHOLDERS[key], `catalog ph.${key} matches the shared placeholder`);
    assert.match(workshop, new RegExp(`placeholder=\\{t\\("ph\\.${key}"\\)\\}`), `the workshop box for ${key} reads the catalog key`);
  }
  assert.equal(en.refineryResume.resume.sections.exp.firstBullet, FIRST_BULLET_PLACEHOLDER);
  assert.match(sections, /bi === 0\s*\? t\("exp\.firstBullet"\)/);
  assert.doesNotMatch(workshop, /placeholder="[^"]*\d/);
  assert.doesNotMatch(sections, /Example: "Trained/);
  assert.doesNotMatch(JSON.stringify(en.refineryResume.resume.bullet.ph), /\d/, "no digit in the catalog placeholders either");
  assert.doesNotMatch(en.refineryResume.resume.sections.exp.firstBullet, /\d/);
});
