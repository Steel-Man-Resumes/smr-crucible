/** Case notes (R3 review S9): no false "they can see this", and corrections keep the record. */
import { it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../orgClientView.ts", import.meta.url), "utf8");
const ui = readFileSync(new URL("../../../../apps/consumer/components/org/ClientPage.tsx", import.meta.url), "utf8");
const list = readFileSync(new URL("../../../../apps/consumer/components/org/CaseNotesPage.tsx", import.meta.url), "utf8");

it("a new note is never stored as visible to the participant", () => {
  assert.match(src, /\[\.\.\.params\(actor, clientId\), kind, body, false, !!input\.draftedByAssistant\]/);
});
it("no screen tells staff the participant can see a note", () => {
  assert.doesNotMatch(ui, /can see this note|\$\{first\} can see this` : ""\}<\/p>|visible_to_participant \?/);
  assert.doesNotMatch(list, /they can see this/);
});
it("a correction is an UPDATE limited to the author, never a DELETE, and returns the earlier wordings", () => {
  const edit = src.slice(src.indexOf("export async function editClientNote"));
  assert.match(edit, /UPDATE case_note n SET body = \$6/);
  assert.match(edit, /n\.author_user_id = \$4::uuid/);
  assert.doesNotMatch(edit.slice(0, edit.indexOf("\n}\n")), /DELETE/);
  assert.match(src, /FROM case_note_version v WHERE v\.note_id = n\.id/);
});
