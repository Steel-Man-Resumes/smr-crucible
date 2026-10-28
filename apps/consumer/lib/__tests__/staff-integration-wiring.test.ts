/**
 * Staff pass integration (2026-10-28): the WIRING NEEDED lines from lanes S1,
 * S3, S4 and S5 are in place, and the pieces that keep people safe stay
 * joined (sign-out clears handoff trays, the chat never sends a handoff, the
 * per-turn loader ships with the prompt line that shows it).
 */
import { it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { VIEW_TOOLS_SKILL_TEXT } from "../tools/staff/view-tools";
import { directoryItem } from "../../components/org/DirectorySendTo";
import { PERSON_TABS } from "../org-person-view";
import { PERSON_TAB_KEYS } from "@crucible/core/src/staffPrefsShared";
import { PERSON_TAB_LABELS } from "@crucible/core/src/viewActionsShared";
import { checkHandoff } from "@crucible/core/src/staffHandoffShared";
import { accessLogAction } from "../access-log-words";
import { REFINERY_PAGES } from "../tools/assistant-tool-defs";
import { STAFF_PAGES } from "../staff-pages";

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const UUID = "0b9d6f1e-6a43-4a7e-9d55-3f6c1d2e8a10";

it("S1: Add people reads t.ROY's prefill, and the invite still needs the staff member's press", () => {
  const src = read("../../components/org/OrgDashboard.tsx");
  assert.match(src, /const prefill = useAddPersonPrefill\(\(p\) => \{ setInviteName\(prefillFullName\(p\)\); if \(p\.email\) setInviteEmail\(p\.email\); \}\);/);
  assert.match(src, /\{prefill\.current && <AddPersonPrefillNotice prefill=\{prefill\.current\} onClose=\{prefill\.dismiss\} \/>\}\s*<form onSubmit=\{sendInvite\}/);
  assert.match(src, /<DuplicateWarning name=\{inviteName\} email=\{inviteEmail\} phone=\{prefill\.current\?\.phone \?\? undefined\} \/>/);
  assert.match(src, /setInviteEmail\(""\);\s*prefill\.sent\(\);/, "marked used only after the invite went out");
});

it("S1 + S3 + S5: the chat shows view cards and a handoff button that only fills the tray", () => {
  const chat = read("../../components/AssistantChat.tsx");
  assert.match(chat, /viewToolCards\(parts\.filter\(\(p\) => p\.type === "tool-invocation"\)/);
  assert.match(chat, /inv\?\.toolName === "draft_handoff" && inv\.state === "result" && isHandoffDraftResult\(inv\.result\)/);
  assert.match(chat, /const href = applyHandoffDraft\(handoffDraft, trayOwner\(currentOrgId, accountId \?\? null\)\);\s*if \(href\) router\.push\(href\);/);
  const branch = chat.slice(chat.indexOf("handoffDraft && ("), chat.indexOf("handoffDraft && (") + 1200);
  assert.doesNotMatch(branch, /fetch\(|\/api\/org\/clients\/[^`]*handoffs/, "the chat never sends a handoff");
});

it("S1: the staff skill carries the view tool words verbatim and the handoff rules, with no dashes", () => {
  const skill = read("../skills/staff-operations/SKILL.md");
  for (const sentence of VIEW_TOOLS_SKILL_TEXT.split(/(?<=\.) (?=[A-Z])/)) assert.ok(skill.includes(sentence.trim()), sentence);
  assert.match(skill, /draft_handoff only drafts/);
  assert.match(skill, /You have no tool that saves, sends, books, assigns, records an outcome or changes anyone's work\./, "the rule stays, with the one exception after it");
  assert.match(skill, /change-requests, connections/);
  assert.doesNotMatch(skill, /[–—]| -- /);
  for (const key of ["change-requests", "connections", "inbox"]) assert.ok(STAFF_PAGES.some((p) => p.key === key), key);
});

it("S3 + S4: the person page orders tabs by the person's own choice and has a Team talk tab", () => {
  assert.deepEqual(PERSON_TABS.map((t) => t.key), [...PERSON_TAB_KEYS], "the page and core agree on the tabs");
  assert.equal(PERSON_TAB_LABELS.team, "Team talk");
  const page = read("../../components/org/ClientPage.tsx");
  assert.match(page, /\{orderPersonTabs\(PERSON_TABS, prefs\.personTabs\)\.map\(/);
  assert.match(page, /tab === "team" \? \(\s*<TeamCommentsPanel clientId=\{clientId\} first=\{first\} \/>/);
  assert.match(page, /window\.addEventListener\(VIEW_CHANGED_EVENT, readPrefs\)/);
});

it("S4: task forms hand tasks on, and notes under review cannot be corrected from the page", () => {
  const page = read("../../components/org/ClientPage.tsx");
  assert.match(page, /<AssigneeSelect clientId=\{clientId\} value=\{ownerId\} onChange=\{setOwnerId\} \/>/);
  assert.match(page, /post\(\{ action: "add", title, dueOn: due \|\| null, clientId, shared, ownerId \}\)/);
  assert.match(page, /<HandTaskOn taskId=\{t\.id\} clientId=\{clientId\} ownerId=\{t\.owner_user_id \?\? null\} onDone=\{load\} \/>/);
  assert.match(page, /const reviews = useNoteReviews\(clientId\);/);
  assert.match(page, /\{!isEditing && mine && noteCanBeCorrected\(reviews\.data, n\.id\) && \(/, "Correct and I sent it hide while a note waits or is approved");
  assert.match(page, /<NoteReviewBar noteId=\{n\.id\} authorId=\{n\.author_user_id \?\? null\} data=\{reviews\.data\} onChange=\{reviews\.reload\} \/>/);
});

it("S5: the two handoff panels sit in the tasks tab", () => {
  const page = read("../../components/org/ClientPage.tsx");
  const tasks = page.slice(page.indexOf(') : tab === "tasks" ? ('), page.indexOf(') : tab === "outcomes" ? ('));
  assert.match(tasks, /<HandoffPanel clientId=\{clientId\} first=\{first\} viewerId=\{viewer\?\.userId \?\? null\} canSend=\{!!viewer\?\.canSuggest\} \/>/);
  assert.match(tasks, /<ConnectionsPanel clientId=\{clientId\} first=\{first\} viewerId=\{viewer\?\.userId \?\? null\} canSend=\{!!viewer\?\.canSuggest\} \/>/);
});

it("S5 MUST LAND: sign-out and account switch clear every handoff tray", () => {
  const out = read("../confirmed-sign-out.ts");
  assert.match(out, /import \{ clearHandoffTrays \} from "\.\/handoff-tray";/);
  assert.match(out, /clearStaffDraftCache\(\);\s*clearHandoffTrays\(\);/);
  const sw = read("../account-browser-state.ts");
  assert.match(sw, /import \{ clearHandoffTrays \} from "\.\/handoff-tray";/);
  assert.match(sw, /clearStaffDraftCache\(session\);\s*clearHandoffTrays\(session\);/);
});

it("S5: the person's t.ROY shows what their case manager sent, the log says why it was opened, and the page is reachable", () => {
  assert.match(read("../assistant-prompt.ts"), /lines\.push\(\.\.\.buildCaseManagerSection\(ctx\)\);\s*lines\.push\(\.\.\.buildServerPartsSection\(ctx\)\);/);
  assert.equal(accessLogAction("shared", "shared:applications", () => "Your job applications", "connections"), "opened your job applications to look for employers and job help that fit you");
  assert.equal(REFINERY_PAGES["from-your-case-manager"], "/dashboard/from-your-case-manager");
});

it("S1 D1: the Directory's Send to picks a person first, then fills that person's tray with a valid item", () => {
  const page = read("../../app/(dashboard)/dashboard/directory/page.tsx");
  assert.match(page, /<StaffDirectoryWithSlots \/>/);
  const comp = read("../../components/org/DirectorySendTo.tsx");
  assert.match(comp, /role\.capabilities\?\.includes\("org\.suggest\.write"\)/, "only for staff who may send handoffs");
  assert.match(comp, /\/api\/org\/search\?/, "the same people search as Find a person (reach-scoped on the server)");
  assert.doesNotMatch(comp, /method: "POST"/, "it sends nothing");
  for (const listing of [{ kind: "employer" as const, id: UUID, name: "Lakeshore Works (Demo)" }, { kind: "resource" as const, id: UUID, name: "Example Food Shelf" }]) {
    const res = checkHandoff({ note: "A few things for you.", items: [directoryItem(listing)] });
    assert.ok(res.ok, JSON.stringify(res));
  }
  assert.doesNotMatch(comp, /[–—]| -- /);
});

it("the registry stays browser-safe: no staff tool module imports core at run time by itself", () => {
  // A default `() => import("@crucible/core")` in view-tools.ts pulled node:crypto into the chat's
  // browser bundle and broke next build (integration 2026-10-28). Modules reach core only via ctx.loadCore().
  for (const f of ["index.ts", "navigate.ts", "directory.ts", "types.ts", "view-tools.ts", "handoff-tools.ts"]) {
    const code = read(`../tools/staff/${f}`).replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
    assert.doesNotMatch(code, /(?<!typeof )import\(\s*["']@crucible\/core["']\s*\)/, f);
  }
});
