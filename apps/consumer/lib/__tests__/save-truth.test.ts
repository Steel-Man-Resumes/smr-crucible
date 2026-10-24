// A small truth (R2): the vault does not invite a Social Security card the
// documents page says not to store. (The disclosure pop-up fix lives with the
// hurdles lane's rewrite of that page.)
import { it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");

it("the vault ID category does not suggest storing a Social Security card", () => {
  const shared = read("../../../../packages/core/src/vaultDocumentShared.ts");
  assert.doesNotMatch(shared, /Social Security card copy/);
  assert.match(read("../../app/(dashboard)/dashboard/documents/page.tsx"), /Do not put\s+passwords, your Social Security card/);
});
