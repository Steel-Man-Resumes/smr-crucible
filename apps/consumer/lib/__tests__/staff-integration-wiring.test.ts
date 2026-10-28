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

it("a t.ROY handoff draft passes the route's claim check on its words, and a bad one is still held", async () => {
  // Before integration every draft_handoff was held: the checker read our labels ("Item 2 why:")
  // and an ISO date's year as names and caseload figures.
  const { checkOrgClaimsDeterministic } = await import("../org-output-verify");
  const { checkStreamedDrafts } = await import("../staff-skill-run");
  const { composeDraftBody, handoffDraftProse } = await import("../handoff-draft-body");
  const facts = { caseload: 1, stalled: 0, neverStarted: 0, hired: 0, unassigned: 0, visibleNames: ["Alma"], staffNames: [], orgName: "Lakeshore Works (Demo)" };
  const check = (b: string) => checkOrgClaimsDeterministic(b, facts);
  const card = (note: string, why: string) => {
    const { draftBody, shapes } = composeDraftBody(note, [
      { kind: "employer", employerId: UUID, name: "Lakeshore Works (Demo)", role: "Forklift operator", why },
      { kind: "resource", resourceId: UUID, name: "Example Food Shelf", why: "Food help near you while you look." },
      { kind: "next_step", step: "Bring your ID to our office", dueOn: "2026-11-05", why: "So we can start your application together." },
    ]);
    return { toolCallId: "h", toolName: "draft_handoff", args: {}, result: { status: "needs_confirmation", action: "handoff_draft", clientId: UUID, firstName: "Alma", items: shapes, draftBody, sent: false, saved: false, message: "x" } };
  };
  const good = checkStreamedDrafts([card("Alma, here are a few things that could help this week.", "They hire people with records and they are close to you.")], check);
  assert.equal(good.kept.length, 1, good.notice);
  assert.match(handoffDraftProse(String((card("Hi.", "Why.").result as { draftBody: string }).draftBody)), /By November 5\./);
  for (const [note, why] of [["Alma, a few things.", "Ask for Marcus at the front desk."], ["Alma, a few things.", "It pays $22 an hour."], ["Alma, Jordan got hired there.", "They hire people with records."]]) {
    const out = checkStreamedDrafts([card(note, why)], check);
    assert.equal(out.kept.length, 0, `${note} / ${why} is held`);
  }
});

it("round 2 (S2 merged): Inbox count in the staff sidebar only, participant link to their case manager, locked controls offer Suggest a change", async () => {
  const shell = read("../../app/(dashboard)/RefineryShell.tsx");
  assert.match(shell, /function OrgSidebarCounted[\s\S]*const unread = useInboxCount\(\);[\s\S]*counts=\{\{ "org-nav-inbox": unread \}\}/);
  assert.match(shell, /return props\.workspace \? <OrgSidebarCounted \{\.\.\.props\} \/> : <OrgSidebar \{\.\.\.props\} \/>;/, "asked only with the workspace on");
  const { STATIONS } = await import("../refinery-nav");
  const overview = STATIONS.find((s) => s.id === "overview")!;
  assert.ok(overview.children.some((c) => c.href === "/dashboard/from-your-case-manager" && c.minTier === "client"));
  for (const f of ["../../components/org/MyViewSettings.tsx", "../../components/org/StaffWorkflowSettings.tsx"]) assert.match(read(f), /<SuggestChangeLink \/>/, f);
  const link = read("../../components/staff/SuggestChange.tsx");
  assert.match(link, /if \(\(role\.capabilities \?\? \[\]\)\.includes\("org\.settings\.manage"\)\) return null;/, "never for people who can change it themselves");
  assert.match(link, /!STAFF_FEATURES\.changeRequests/);
  const sw = read("../../components/staff/TroySuggestionsSwitch.tsx");
  assert.match(sw, /typeof d\.effective\?\.troySuggestions === "boolean"/, "draws only when the pref exists");
  assert.doesNotMatch(sw + link, /[–—]| -- /);
});

it("S2 review round 2 nits: the Activity log CSV says what row 1 is in visible words", () => {
  const audit = read("../../components/org/AuditPage.tsx");
  assert.match(audit, /<span id="audit-csv-help" className="text-\[11px\] text-t-phos-dim">\{OUTBOUND_CSV_HELP\}<\/span>/);
  assert.match(audit, /aria-describedby="audit-csv-help"/);
});

it("round 3 (S6 merged): tools, cards, Wins, good catches, the listing nudge and the Directory's contribute slot", () => {
  assert.match(read("../tools/staff/index.ts"), /viewToolsModule,\s*handoffToolModule,\s*contributeTools,\s*\]/);
  const chat = read("../../components/AssistantChat.tsx");
  assert.match(chat, /inv\.toolName === "draft_directory_contribution" && \(r\.status === "draft" \|\| r\.status === "needs_more"\)/);
  assert.match(chat, /<ContributeForm initial=\{initialFromDraft\(/, "the staff member checks the card and presses Send");
  assert.match(chat, /inv\.toolName === "listing_check_nudge" && r\.status === "ok"/);
  assert.match(chat, /<ListingContributeMenu kind=\{c\.listing\.kind\} id=\{c\.listing\.id\} name="" nudgeLine=\{null\} \/>/, "the line is in the answer already");
  assert.match(read("../skills/staff-operations/SKILL.md"), /After the staff member used a directory listing for someone, call listing_check_nudge once; if it returns a line, end with it word for word\./);
  const setup = read("../../app/(dashboard)/dashboard/my-setup/page.tsx");
  assert.match(setup, /<RewardsToggle onChange=\{announceRewardsChanged\} \/>/);
  assert.doesNotMatch(read("../../../../packages/core/src/staffPrefsShared.ts"), /rewardsOn/, "no second rewards switch in staff prefs");
  const shell = read("../../app/(dashboard)/RefineryShell.tsx");
  assert.match(shell, /fetch\("\/api\/org\/rewards\?settings=1"/, "the sidebar reads only the switch, not the whole Wins page");
  assert.match(shell, /rewardsOn=\{rewardsOn\}/);
  assert.match(read("../../app/api/org/rewards/route.ts"), /searchParams\.get\("settings"\) === "1"/);
  const page = read("../../components/org/ClientPage.tsx");
  assert.match(page, /t\.owner_user_id !== viewerId && <GiveKudos toUserId=\{t\.owner_user_id\} workKind="task" workId=\{t\.id\} compact \/>/);
  assert.match(page, /n\.author_user_id !== viewerId && <div className="mt-2"><GiveKudos toUserId=\{n\.author_user_id\} workKind="note" workId=\{n\.id\} compact \/>/);
  const refs = read("../../components/org/Referrals.tsx");
  assert.match(refs, /r\.owner_staff_id !== me && r\.owner_active !== false && \(\s*<div className="mt-1"><GiveKudos toUserId=\{r\.owner_staff_id\} workKind="referral" workId=\{r\.id\} compact \/>/);
  assert.match(refs, /askListingNudge\("resource", used\.service_id\)/);
  assert.match(read("../../components/org/HandoffPanel.tsx"), /askListingNudge\(ref\.kind, ref\.id\)/);
  assert.match(read("../../components/org/DirectorySendTo.tsx"), /<StaffDirectoryPage SendTo=\{DirectorySendTo\} Contribute=\{DirectoryContribute\} \/>/);
  const admin = read("../../components/org/rewards/StaffRewardsAdmin.tsx");
  assert.match(admin, /role\.orgRole !== "owner" && role\.orgRole !== "org_admin"/, "program rewards and recognition notes: managers only");
  assert.match(read("../../app/(dashboard)/dashboard/team/page.tsx"), /<StaffRewardsAdmin \/>/);
  // Funder reports: no surface reads recognition notes except the approved-only list.
  assert.match(read("../../app/api/org/recognition/route.ts"), /forReport: notes\.filter\(\(n\) => n\.status === "approved"\)/);
  for (const f of ["../../components/org/InsightsReport.tsx", "../../components/org/InsightsPage.tsx", "../skills/staff-funder-narrative/SKILL.md"]) assert.doesNotMatch(read(f), /recognition/i, f);
});

it("final review should-fix 3: a change already made to your own view always keeps its card", async () => {
  const { checkStreamedDrafts, streamedStaffResults, APPLIED_CARD_LINE, STREAMED_MAX } = await import("../staff-skill-run");
  const { checkOrgClaimsDeterministic } = await import("../org-output-verify");
  const facts = { caseload: 1, stalled: 0, neverStarted: 0, hired: 0, unassigned: 0, visibleNames: ["Alma"], staffNames: [], orgName: "Lakeshore Works (Demo)" };
  const check = (b: string) => checkOrgClaimsDeterministic(b, facts);
  const applied = (draftBody?: unknown, extra: Record<string, unknown> = {}) => ({ toolCallId: "v", toolName: "change_my_view", args: {}, result: {
    status: "applied", changeId: UUID, onlyTheirScreen: true, summary: "Changed the columns in your view", undo: "They can press Undo on the card, or ask you to undo it.",
    ...(draftBody === undefined ? {} : { draftBody }), ...extra } });
  // A clean card streams as it is, with no extra line.
  const ok = checkStreamedDrafts([applied('Changed your view "Week 1 housing"')], check);
  assert.equal(ok.kept.length, 1); assert.equal(ok.notice, "");
  // A name the check refuses: the card still streams, without draftBody, with the fixed summary and the fixed line.
  const bad = checkStreamedDrafts([applied('Changed your view "Marcus Jones quiet ones"')], check);
  assert.equal(bad.kept.length, 1, "never held");
  const r = bad.kept[0].result as Record<string, unknown>;
  assert.equal(r.draftBody, undefined); assert.equal(r.summary, "Changed the columns in your view"); assert.equal(r.changeId, UUID);
  assert.ok(bad.notice.includes(APPLIED_CARD_LINE));
  // An undeclared key: still shown, the key is dropped.
  const odd = checkStreamedDrafts([applied(undefined, { sneaky: "words the model wrote" })], check);
  assert.equal(odd.kept.length, 1); assert.equal((odd.kept[0].result as Record<string, unknown>).sneaky, undefined);
  // A proposal (nothing applied) is still held whole.
  const proposal = checkStreamedDrafts([{ toolCallId: "p", toolName: "propose_shared_view", args: {}, result: { status: "needs_confirmation", draftBody: "Marcus Jones quiet ones" } }], check);
  assert.equal(proposal.kept.length, 0);
  // Five cards fit (the budget), and an applied change comes first so the cap never drops it.
  assert.equal(STREAMED_MAX, 5);
  const many = [1, 2, 3, 4, 5].map((i) => ({ toolCallId: `o${i}`, toolName: "open_staff_page", args: {}, result: { status: "ok", page: "today" } }));
  const picked = streamedStaffResults([...many, { ...applied(), toolCallId: "last" }]);
  assert.equal(picked.length, 5); assert.equal(picked[0].toolCallId, "last");
  assert.match(APPLIED_CARD_LINE, /^That change was made\. Undo it here or on My setup, Recent changes to my view\.$/);
});

it("final review should-fix 4: drafted with t.ROY is the server's word, from the run log", async () => {
  const route = read("../../app/api/org/clients/[id]/handoffs/route.ts");
  assert.doesNotMatch(route.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, ""), /draftedByAssistant/, "the browser's value is never read");
  const { TROY_DRAFTED_SQL, sendHandoff } = await import("@crucible/core/src/staffHandoff");
  assert.match(TROY_DRAFTED_SQL, /'draft_handoff' = ANY \(r\.tools\)/);
  assert.match(TROY_DRAFTED_SQL, /r\.actor_user_id = \$2::uuid AND r\.participant_user_id = \$3::uuid/);
  assert.match(TROY_DRAFTED_SQL, /interval '30 minutes'/);
  assert.equal(sendHandoff.length >= 3, true);
  const { createStaffEvidenceCollector } = await import("../staff-tool-evidence");
  const c = createStaffEvidenceCollector();
  c.record("draft_handoff", { status: "needs_confirmation", clientId: UUID });
  c.record("draft_handoff", { status: "refused", clientId: UUID });
  assert.deepEqual(c.calls.map((x) => x.participantId), [UUID, null], "the run log names the person a handoff was drafted for");
});
