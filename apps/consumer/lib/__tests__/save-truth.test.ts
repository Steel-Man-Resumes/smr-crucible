// A small truth (R2): the vault does not invite a Social Security card the
// documents page says not to store. (The disclosure pop-up fix lives with the
// hurdles lane's rewrite of that page.)
import { it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { MESSAGES } from "./helpers/intl";
const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");

it("the vault ID category does not suggest storing a Social Security card", () => {
  const shared = read("../../../../packages/core/src/vaultDocumentShared.ts");
  assert.doesNotMatch(shared, /Social Security card copy/);
  // The documents page header reads its words from the catalog; the page must still show the line, and it must still say not to store the card.
  assert.match(read("../../app/(dashboard)/dashboard/documents/page.tsx"), /\{t\("notPasswordBody"\)\}/);
  assert.match(MESSAGES.en.refineryResume.documents.notPasswordBody, /Do not put\s+passwords, your Social Security card/);
});
