// Two small truths (R2): the disclosure pop-up says "Saved to your materials"
// only after the save returns ok, and the vault does not invite a Social
// Security card the documents page says not to store.
import { it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");

it("the disclosure celebration waits for a saved plan", () => {
  const page = read("../../app/(dashboard)/dashboard/disclosure/page.tsx");
  assert.match(page, /if \(\(await savePlan\(\)\) && !refinementNote\) setShowCelebration\(true\);/);
  assert.equal((page.match(/setShowCelebration\(true\)/g) ?? []).length, 1);
  assert.match(page, /setPlanSave\("saved"\);\s*window\.dispatchEvent\(new Event\("disclosure-saved"\)\);\s*return true;/);
});

it("the vault ID category does not suggest storing a Social Security card", () => {
  const shared = read("../../../../packages/core/src/vaultDocumentShared.ts");
  assert.doesNotMatch(shared, /Social Security card copy/);
  assert.match(read("../../app/(dashboard)/dashboard/documents/page.tsx"), /Do not put\s+passwords, your Social Security card/);
});
