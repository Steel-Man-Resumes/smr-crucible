// Staff t.ROY honesty (R3 review S10): buttons say "draft", drafts are never
// saved or sent by t.ROY, and the only way into the record is the staff
// member's own save on the participant page.
import { it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");

it("the buttons say draft and who acts", () => {
  const actions = read("../../components/org/OrgAssistantActions.tsx");
  assert.match(actions, /label: "Draft a case note for your review"/);
  assert.match(actions, /label: "Draft a check-in for you to send"/);
  assert.doesNotMatch(actions, /label: "Write a case note"|label: "Draft a check-in email"/);
  const chat = read("../../components/AssistantChat.tsx");
  assert.match(chat, /"Draft a check-in for you to send",\s*"Draft a case note for your review"/);
});

it("the draft tool always reports saved: false and sent: false, and never writes", () => {
  const tools = read("../tools/assistant-staff-tools.ts");
  const draft = tools.slice(tools.indexOf("draft_staff_check_in: tool("), tools.indexOf("const executeOnce"));
  assert.match(draft, /status: "draft_only", saved: false, sent: false/);
  assert.doesNotMatch(draft, /addClientNote|INSERT|UPDATE|sendOrgEmail|resend/i);
});

it("the chat only offers to place a draft that is draft_only, unsaved and unsent, and places it unsaved", () => {
  const chat = read("../../components/AssistantChat.tsx");
  assert.match(chat, /r\?\.status !== "draft_only" \|\| r\.saved !== false \|\| r\.sent !== false/);
  assert.match(chat, /sessionStorage\.setItem\(`org-note-draft:/);
  assert.doesNotMatch(chat.slice(chat.indexOf("draftFor")), /action: "add_note"/);
});

it("the participant page marks the draft as unsaved and saves only on the staff member's click", () => {
  const page = read("../../components/org/ClientPage.tsx");
  assert.match(page, /It is not saved\. Read it, fix anything that is wrong, then save it or throw it away\./);
  assert.match(page, /Nothing was sent\./);
  assert.match(page, /draftedByAssistant: !!draft/);
});
