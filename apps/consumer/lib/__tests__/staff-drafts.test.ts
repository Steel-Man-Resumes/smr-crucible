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

it("the chat places only the draft body offer_staff_draft returned, unsaved, never the whole reply", () => {
  const chat = read("../../components/AssistantChat.tsx");
  assert.match(chat, /inv\?\.toolName !== "offer_staff_draft" \|\| inv\.state !== "result" \|\| r\?\.status !== "draft_only" \|\| r\.saved !== false \|\| r\.sent !== false/);
  assert.match(chat, /const draftText = draftFor\?\.body \?\? "";/);
  assert.match(chat, /sessionStorage\.setItem\(/);
  assert.doesNotMatch(chat.slice(chat.indexOf("draftFor")), /action: "add_note"/);
  const tools = read("../tools/assistant-staff-tools.ts");
  const offer = tools.slice(tools.indexOf("offer_staff_draft: tool("), tools.indexOf("const executeOnce"));
  assert.match(offer, /status: "draft_only", saved: false, sent: false, participantId: clientId/);
  assert.match(offer, /logOpen\(current, clientId, "progress"\); if \(refused\) return refused;\s*const result = await \(await loadCore\(\)\)\.getClientHeader\(current, clientId\)/, "reach re-checked (and the header read logged) before a draft is offered");
  assert.doesNotMatch(offer, /addClientNote|INSERT|UPDATE|sendOrgEmail/);
});

it("a check-in draft is filed as a draft until a person marks it sent; the page saves only on a click", () => {
  const page = read("../../components/org/ClientPage.tsx");
  assert.match(page, /if \(purpose === "check_in"\) setKind\("draft"\);/);
  assert.match(page, /kind: "email" \}\) \}\);/, "I sent it corrects the kind to email");
  assert.match(page, /It is not saved\. Read it, fix anything that is wrong, then save it or throw it away\./);
  assert.match(page, /draftedByAssistant: !!draft/);
  const mig = read("../../../../packages/core/migrations/097_org_seats.sql");
  assert.match(mig, /'referral', 'draft'/);
});
