// C4 staff t.ROY panel: the docked drawer opens on openStaffTroy, fills the
// message box and never sends; the server owns the skill and the focus; the
// participant sees the open in "Who has opened what".
import { it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { accessLogAction } from "../access-log-words";
const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");

it("the drawer opens on the staff event", () => {
  const drawer = read("../../../../packages/consumer-ui/src/AssistantDrawer.tsx");
  assert.match(drawer, /addEventListener\("staff-troy-open", open\)/, "the drawer opens on the event");
});

it("the panel fills the box and never submits; footer and About chip are there", () => {
  const chat = read("../../components/AssistantChat.tsx");
  const panel = chat.slice(chat.indexOf("// STAFF PANEL"), chat.indexOf("const clearFocus"));
  assert.match(panel, /setInput\(skillRequest\(req\.skill, next\.firstName\)\)/);
  assert.doesNotMatch(panel, /requestSubmit|handleSubmit\(/);
  assert.match(panel, /staffSkill: focus\.skill, staffClientId: focus\.clientId/);
  assert.match(chat, /t\.ROY drafts\. You decide\. Nothing is saved or sent until you do it\./);
  assert.match(chat, /About: \{focus\.firstName \?\? "this person"\}/);
  assert.match(chat, /t\.ROY, for your work with people/);
});

it("the server owns the skill and the focus: only a resolved staff member gets them", () => {
  const route = read("../../app/api/assistant/route.ts");
  assert.match(route, /const staffSkill = staffActor \? \(isStaffSkill\(context\.staffSkill\)/);
  assert.match(route, /const staffFocus = staffActor && isParticipantId\(context\.staffClientId\)/);
  assert.match(route, /if \(!staffActor\) \{ delete context\.staffSkill; delete context\.staffClientId; \}/);
  assert.match(route, /buildStaffTools\(staffActor, staffEvidence\.record, \{ focusClientId: staffFocus, namedClientIds: staffNamed \}\)/);
  // The audience is still decided only by the server (truth sheet 5, "cannot be told it is talking to staff").
  assert.match(route, /if \(context\.audience === "org_staff"\) context\.audience = undefined;/);
});

it("the participant sees a t.ROY read in Who has opened what", () => {
  const label = (s: string) => ({ applications: "Your job applications" } as Record<string, string>)[s] ?? s;
  assert.equal(accessLogAction("opened", "assistant:overview", label), "asked t.ROY to look over what you share and what their organization has on file about you");
  assert.match(accessLogAction("opened", "assistant:changes", label), /^asked t\.ROY what changed/);
  assert.equal(accessLogAction("opened", "applications", label), "opened your job applications");
  assert.equal(accessLogAction("queue", "applications", label), "had your interview and follow-up dates on their daily work list");
});

it("fix round 1: header and task reads, and a t.ROY applications open, read plainly for the participant and in the export", () => {
  const label = (s: string) => ({ applications: "Your job applications" } as Record<string, string>)[s] ?? s;
  assert.equal(accessLogAction("opened", "assistant:progress", label), "asked t.ROY to look at the progress you share with them");
  assert.equal(accessLogAction("opened", "assistant:tasks", label), "asked t.ROY to look at their tasks about you");
  assert.equal(accessLogAction("opened", "applications", label, "t.ROY"), "asked t.ROY, which opened your job applications");
  assert.equal(accessLogAction("opened", "applications", label, null), "opened your job applications");
  const exp = read("../../app/api/user/export-data/route.ts");
  assert.match(exp, /accessLogAction\(e\.kind, e\.scope, scopeLabel, e\.via\)/);
  assert.match(read("../../components/SharingControls.tsx"), /accessLogAction\(e\.kind, e\.scope, label, e\.via\)/);
});
