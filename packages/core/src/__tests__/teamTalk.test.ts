/**
 * Team talk rules (migration 109, staff side lane S4), without a database:
 * mentions and bodies, inbox sentences and links, change-request paths, note
 * review reasons, the task handoff refusals, and static checks that the
 * migration and the TypeScript say the same thing. The real SQL runs in
 * apps/consumer/lib/__tests__/team-talk-pglite.test.ts. Fictional people only.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  normalizeMentions, checkCommentBody, mentionRefusedLine, MENTION_MAX, COMMENT_MAX, COMMENT_CARE_LINE,
  INBOX_KINDS, INBOX_FILTERS, INBOX_KIND_LABELS, inboxHref, inboxSentence, inboxPerson,
  CHANGE_REQUEST_KINDS, CHANGE_REQUEST_STATUSES, CHANGE_REQUEST_TRANSITIONS, CHANGE_REQUEST_KIND_LABELS, CHANGE_REQUEST_STATUS_LABELS,
  CHANGE_REQUEST_ACTION_LABELS, CHANGE_REQUEST_CARE_LINE, checkChangeMove, checkChangeRequestDraft, changeRequestTarget,
  NOTE_REVIEW_REASONS, NOTE_REVIEW_STATUSES, NOTE_REVIEW_STATUS_LABELS, teamTalkErrorLine, TEAM_THREAD_CARE_LINE,
} from "../teamTalkShared";
import { refuseMentions, LIST_COMMENTS_SQL, COLLEAGUES_SQL } from "../teamComments";
import { LIST_INBOX_SQL, UNREAD_COUNT_SQL, MARK_INBOX_SQL, inboxFilterKinds } from "../staffInbox";
import { LIST_CHANGE_REQUESTS_SQL, isOrgManager } from "../orgChangeRequests";
import { NOTE_REVIEWS_SQL, REVIEW_QUEUE_SQL } from "../noteReview";
import { storedOrgModules, DEFAULT_ORG_MODULES, ORG_MODULES } from "../orgStructureShared";
import { ACTIVITY_ENTITIES, ACTIVITY_ENTITY_LABELS } from "../orgActivityShared";
import { RLS_PROTECTED_TABLES } from "../rlsHealth";
import type { OrgActor } from "../authz/resolveOrgActor";

const MIG = readFileSync(join(import.meta.dirname, "..", "..", "migrations", "109_team_talk.sql"), "utf8");
const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const C = "33333333-3333-4333-8333-333333333333";
const sqlList = (anchor: string) => {
  const i = MIG.indexOf(anchor);
  assert.ok(i >= 0, anchor);
  const open = MIG.indexOf("(", MIG.indexOf("IN", i + anchor.length - 3));
  const close = MIG.indexOf(")", open);
  return Array.from(MIG.slice(open, close).matchAll(/'([a-z_]+)'/g)).map((m) => m[1]);
};

describe("comments: bodies and mentions", () => {
  it("mentions are ids, each once, never the author, at most ten", () => {
    assert.deepEqual(normalizeMentions([A, A.toUpperCase(), "nope", 7, null, B, C], C), [A, B]);
    assert.deepEqual(normalizeMentions("not a list"), []);
    const many = Array.from({ length: 15 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`);
    assert.equal(normalizeMentions(many).length, MENTION_MAX);
  });
  it("a body is trimmed, not empty, and not too long", () => {
    assert.deepEqual(checkCommentBody("  Can you cover Thursday?  "), { ok: true, body: "Can you cover Thursday?" });
    assert.equal(checkCommentBody("   ").ok, false);
    assert.equal(checkCommentBody(42).ok, false);
    assert.equal(checkCommentBody("x".repeat(COMMENT_MAX + 1)).ok, false);
  });
  it("a refused mention names the colleague and says what to do, plainly", () => {
    const colleagues = [{ user_id: A, name: "Alma Reyes", role: "staff", reaches: true }, { user_id: B, name: "Dana Lee", role: "staff", reaches: false }];
    assert.equal(refuseMentions([A], colleagues), null);
    assert.equal(refuseMentions([A, B], colleagues), "Dana Lee cannot see this person, so they cannot be mentioned here. Ask an admin to add them first.");
    assert.equal(refuseMentions([C], colleagues), "That team member is not on your team here.");
    assert.equal(mentionRefusedLine("  ", "out_of_reach").startsWith("That team member cannot see"), true);
  });
  it("the list statement carries the reader's reach, and the colleague list asks the database's rule", () => {
    assert.match(LIST_COMMENTS_SQL, /client_staff_assignment/);
    assert.match(LIST_COMMENTS_SQL, /c\.participant_user_id IS NULL/, "a team thread is read only as a team thread");
    assert.match(COLLEAGUES_SQL, /smr_staff_reach\(\$1::uuid, t\.user_id, \$4::uuid\)/);
    assert.match(COLLEAGUES_SQL, /t\.user_id <> \$3::uuid/, "never offered to yourself");
  });
});

describe("inbox: what an item says and where it goes", () => {
  const row = (over: Record<string, unknown> = {}) => ({
    id: A, kind: "mention", ref_table: "team_comment", ref_id: B, summary: "mentioned you in a comment about them", created_at: "2026-10-27T15:00:00Z",
    read_at: null, actor_user_id: C, actor_name: "Alma Reyes", participant_user_id: A, participant_name: "Jordan", ...over,
  });
  it("one plain sentence, the person by consent", () => {
    assert.equal(inboxSentence(row()), "Alma Reyes mentioned you in a comment about Jordan.");
    assert.equal(inboxSentence(row({ participant_name: null })), "Alma Reyes mentioned you in a comment about a person who has not shared their name.");
    assert.equal(inboxSentence(row({ participant_user_id: null, summary: "asked for a change to the fields" })), "Alma Reyes asked for a change to the fields.");
    assert.equal(inboxSentence(row({ actor_user_id: null })).startsWith("Someone who has left the team"), true);
    // Items with no actor by design (integration 2026-10-28) never read as "someone who has left".
    assert.equal(inboxSentence({ ...row({ actor_user_id: null, summary: "took on something from your handoff" }), ref_table: "staff_handoff" }), "Jordan took on something from your handoff.");
    assert.equal(inboxSentence({ ...row({ actor_user_id: null, participant_name: null, summary: "passed on something in your handoff" }), ref_table: "staff_handoff" }), "A person who has not shared their name passed on something in your handoff.");
    assert.equal(inboxSentence({ ...row({ actor_user_id: null, participant_user_id: null, summary: "your update to the directory was approved" }), ref_table: "directory_contribution" }), "Your update to the directory was approved.");
    assert.equal(inboxPerson(row({ participant_user_id: null })), null);
  });
  it("each item links to where its source lives (which checks reach again)", () => {
    assert.equal(inboxHref(row()), `/dashboard/clients/${A}?tab=team#comment-${B}`);
    assert.equal(inboxHref(row({ participant_user_id: null })), `/dashboard/inbox?view=team#comment-${B}`);
    assert.equal(inboxHref(row({ ref_table: "staff_task" })), `/dashboard/clients/${A}?tab=tasks#task-${B}`);
    assert.equal(inboxHref(row({ ref_table: "staff_task", participant_user_id: null })), "/dashboard/today");
    assert.equal(inboxHref(row({ ref_table: "org_change_request", participant_user_id: null })), `/dashboard/change-requests#cr-${B}`);
    assert.equal(inboxHref(row({ ref_table: "case_note" })), `/dashboard/clients/${A}?tab=notes#note-${B}`);
    // Integration 2026-10-28: S6's sources go to Wins and Contribute, S5's handoff answers to the person's tasks tab.
    assert.equal(inboxHref(row({ ref_table: "staff_kudos" })), "/dashboard/wins");
    assert.equal(inboxHref(row({ ref_table: "staff_recognition_note" })), "/dashboard/wins");
    assert.equal(inboxHref(row({ ref_table: "directory_contribution" })), "/dashboard/contribute");
    assert.equal(inboxHref(row({ ref_table: "nothing_known" })), "/dashboard/inbox");
    assert.equal(inboxHref(row({ participant_user_id: "../../admin", ref_id: "x" })), "/dashboard/inbox?view=team#comment-", "nothing odd gets into a link");
  });
  it("filters cover only known kinds, and every kind has a label", () => {
    for (const f of INBOX_FILTERS) for (const k of f.kinds) assert.ok((INBOX_KINDS as readonly string[]).includes(k));
    for (const k of INBOX_KINDS) assert.ok(INBOX_KIND_LABELS[k]);
    assert.deepEqual(inboxFilterKinds("bogus"), [...INBOX_KINDS]);
    assert.deepEqual(inboxFilterKinds("tasks"), ["task_assigned"]);
  });
  it("the statements read only the actor's own items", () => {
    assert.match(LIST_INBOX_SQL, /i\.recipient_user_id = \$2::uuid/);
    assert.match(UNREAD_COUNT_SQL, /i\.recipient_user_id = \$2::uuid AND i\.read_at IS NULL/);
    assert.match(MARK_INBOX_SQL, /i\.recipient_user_id = \$2::uuid/);
    assert.match(MARK_INBOX_SQL, /\$4::boolean OR NOT EXISTS/, "marking unread never collides with a newer unread item");
    assert.match(MARK_INBOX_SQL, /o\.id = ANY \(\$5::uuid\[\]\)[\s\S]*\(o\.created_at, o\.id\) > \(i\.created_at, i\.id\)/, "only the newest of several named in one request");
  });
});

describe("change requests", () => {
  it("a draft needs a first line; the rest is optional", () => {
    assert.deepEqual(checkChangeRequestDraft({ kind: "field", title: "  Add shoe size  ", body: "" }), { ok: true, kind: "field", title: "Add shoe size", body: null });
    assert.equal(checkChangeRequestDraft({ kind: "bogus", title: "Rename Retention" }).ok && (checkChangeRequestDraft({ kind: "bogus", title: "Rename Retention" }) as { kind: string }).kind, "other");
    assert.equal(checkChangeRequestDraft({ title: "x" }).ok, false);
    assert.equal(checkChangeRequestDraft({ title: "x".repeat(141) }).ok, false);
    assert.equal(checkChangeRequestDraft({ title: "Fine", body: "x".repeat(2001) }).ok, false);
  });
  it("the page it came from is kept only as a plain /dashboard path", () => {
    assert.equal(changeRequestTarget("/dashboard/today?x=1#y"), "/dashboard/today");
    assert.equal(changeRequestTarget("/dashboard/clients/abc-123/"), "/dashboard/clients/abc-123");
    for (const bad of ["https://example.com", "/admin", "/dashboard/<script>", "/dashboard/a/b/c/d/e/f", 7]) assert.equal(changeRequestTarget(bad), null, String(bad));
  });
  it("the moves match the database guard, and a no needs a reason", () => {
    const body = MIG.slice(MIG.indexOf("FUNCTION public.org_change_request_guard"), MIG.indexOf("REVOKE ALL ON FUNCTION public.org_change_request_guard"));
    assert.match(body, /OLD\.status = 'open' AND NEW\.status IN \('accepted', 'declined', 'done'\)/);
    assert.match(body, /OLD\.status = 'accepted' AND NEW\.status IN \('done', 'declined'\)/);
    assert.deepEqual([...CHANGE_REQUEST_TRANSITIONS.open], ["accepted", "declined", "done"]);
    assert.deepEqual([...CHANGE_REQUEST_TRANSITIONS.accepted], ["done", "declined"]);
    assert.equal(checkChangeMove("open", "declined", " "), "Say why, so they know what to do next.");
    assert.equal(checkChangeMove("open", "declined", "We track that elsewhere"), null);
    assert.ok(checkChangeMove("done", "open", null));
    assert.equal(checkChangeMove("open", "open", null), null);
    // Review N4: a no needs words written for it, not an answer left from an earlier yes.
    assert.equal(checkChangeMove("accepted", "declined", "Yes, next week", false), "Say why, so they know what to do next.");
    assert.match(MIG, /change_request_needs_reason/);
    assert.match(MIG, /status <> 'declined' OR length\(btrim\(COALESCE\(answer, ''\)\)\) >= 3/);
  });
  it("kinds and statuses match the database CHECKs", () => {
    assert.deepEqual(sqlList("kind             TEXT NOT NULL CHECK (kind IN"), [...CHANGE_REQUEST_KINDS]);
    assert.deepEqual(sqlList("status           TEXT NOT NULL DEFAULT 'open' CHECK (status IN"), [...CHANGE_REQUEST_STATUSES]);
    for (const k of CHANGE_REQUEST_KINDS) assert.ok(CHANGE_REQUEST_KIND_LABELS[k]);
    for (const s of CHANGE_REQUEST_STATUSES) assert.ok(CHANGE_REQUEST_STATUS_LABELS[s] && CHANGE_REQUEST_ACTION_LABELS[s]);
  });
  it("a manager is the owner or an org admin acting as themselves (smr_org_manager)", () => {
    const actor = (role: OrgActor["role"], viaPlatformAdmin = false) => ({ role, viaPlatformAdmin } as OrgActor);
    assert.equal(isOrgManager(actor("owner")), true);
    assert.equal(isOrgManager(actor("org_admin")), true);
    assert.equal(isOrgManager(actor("staff")), false);
    assert.equal(isOrgManager(actor("owner", true)), false);
  });
  it("only the asker or the queue reads them", () => {
    assert.match(LIST_CHANGE_REQUESTS_SQL, /\(\$3::boolean OR q\.requested_by = \$2::uuid\)/);
  });
});

describe("note review", () => {
  it("every word the database answers has a sentence", () => {
    const words = new Set<string>();
    for (const fn of ["smr_note_review_submit", "smr_note_review_decide"]) {
      const body = MIG.slice(MIG.indexOf(`FUNCTION public.${fn}`), MIG.indexOf(`REVOKE ALL ON FUNCTION public.${fn}`));
      for (const m of body.matchAll(/RETURN '([a-z_]+)'/g)) words.add(m[1]);
    }
    words.delete("ok");
    assert.ok(words.size >= 8);
    for (const w of words) assert.ok(NOTE_REVIEW_REASONS[w], w);
  });
  it("statuses match the CHECK, and each has a label", () => {
    assert.deepEqual(sqlList("status              TEXT NOT NULL CHECK (status IN"), [...NOTE_REVIEW_STATUSES]);
    for (const s of [...NOTE_REVIEW_STATUSES, "draft" as const]) assert.ok(NOTE_REVIEW_STATUS_LABELS[s]);
  });
  it("reads carry reach, and the queue never shows your own notes", () => {
    assert.match(NOTE_REVIEWS_SQL, /client_staff_assignment/);
    assert.match(REVIEW_QUEUE_SQL, /n\.author_user_id IS DISTINCT FROM \$3::uuid/);
    assert.match(REVIEW_QUEUE_SQL, /client_staff_assignment/);
  });
  it("the module is off by default and an older database never sees an unknown off switch", () => {
    assert.equal(DEFAULT_ORG_MODULES.note_review, false);
    assert.ok(ORG_MODULES.includes("note_review"));
    assert.equal("note_review" in storedOrgModules({ ...DEFAULT_ORG_MODULES }), false);
    assert.equal(storedOrgModules({ ...DEFAULT_ORG_MODULES, note_review: true }).note_review, true);
    assert.equal(storedOrgModules({ ...DEFAULT_ORG_MODULES }).referrals, true);
  });
});

describe("database messages", () => {
  it("every token the migration raises has its own plain line", () => {
    const tokens = new Set(Array.from(MIG.matchAll(/RAISE EXCEPTION '([a-z_]+): /g)).map((m) => m[1]));
    assert.ok(tokens.size >= 9);
    const generic = teamTalkErrorLine("something else");
    for (const t of tokens) assert.notEqual(teamTalkErrorLine(`ERROR: ${t}: details`), generic, t);
    assert.match(teamTalkErrorLine('new row violates row-level security policy for table "team_comment"'), /caseload/);
  });
  it("no UI line uses an em or en dash or a double hyphen", () => {
    const lines = [COMMENT_CARE_LINE, TEAM_THREAD_CARE_LINE, CHANGE_REQUEST_CARE_LINE, ...Object.values(INBOX_KIND_LABELS), ...Object.values(CHANGE_REQUEST_KIND_LABELS),
      ...Object.values(CHANGE_REQUEST_STATUS_LABELS), ...Object.values(CHANGE_REQUEST_ACTION_LABELS), ...Object.values(NOTE_REVIEW_REASONS),
      ...Object.values(NOTE_REVIEW_STATUS_LABELS), ...Array.from(MIG.matchAll(/RAISE EXCEPTION '[a-z_]+: ([^']+)'/g)).map((m) => m[1])];
    for (const l of lines) assert.doesNotMatch(l, /[–—]| -- /, l);
  });
});

describe("migration 109, statically", () => {
  const NEW_TABLES = ["team_comment", "team_comment_version", "staff_inbox_item", "org_change_request", "org_change_reply", "org_change_request_event", "note_review", "note_review_event"];
  it("every new table is forced RLS, listed for the health check and the lint", () => {
    for (const t of NEW_TABLES) {
      assert.match(MIG, new RegExp(`ALTER TABLE ${t} ENABLE ROW LEVEL SECURITY`), t);
      assert.match(MIG, new RegExp(`ALTER TABLE ${t} FORCE ROW LEVEL SECURITY`), t);
      assert.ok((RLS_PROTECTED_TABLES as readonly string[]).includes(t), t);
    }
  });
  it("per-participant tables get a RESTRICTIVE reach policy", () => {
    for (const t of ["team_comment", "staff_inbox_item"]) assert.match(MIG, new RegExp(`CREATE POLICY ${t}_reach ON ${t} AS RESTRICTIVE FOR ALL`), t);
    assert.match(MIG, /FOREACH t IN ARRAY ARRAY\['note_review', 'note_review_event'\][\s\S]*AS RESTRICTIVE FOR ALL/);
  });
  it("REVOKE ALL comes before any GRANT, and the app gets no delete and no inbox insert", () => {
    const grants = MIG.slice(MIG.indexOf("-- ================================================================ grants =="));
    assert.ok(grants.indexOf("REVOKE ALL ON team_comment") < grants.indexOf("GRANT SELECT, INSERT ON team_comment"));
    assert.doesNotMatch(grants, /GRANT[^;]*DELETE/);
    assert.doesNotMatch(grants, /GRANT[^;]*INSERT[^;]*staff_inbox_item/);
  });
  it("every new function has PUBLIC revoked", () => {
    const fns = Array.from(MIG.matchAll(/CREATE OR REPLACE FUNCTION (public\.[a-z_]+)\(/g)).map((m) => m[1]);
    assert.ok(fns.length >= 20);
    for (const f of fns) assert.match(MIG, new RegExp(`REVOKE ALL ON FUNCTION ${f.replace(".", "\\.")}\\(`), f);
  });
  it("summaries are fixed words: no typed column is ever concatenated into one", () => {
    for (const col of ["body", "title", "answer", "comment", "target", "summary"]) {
      assert.ok(!new RegExp(`\\|\\|\\s*(NEW|OLD|n|r)\\.${col}\\b`).test(MIG), `a summary concatenates ${col}`);
    }
    assert.doesNotMatch(MIG, /\|\|\s*p_comment|\|\|\s*v_say/);
    for (const word of ["parole", "probation", "offense", "conviction", "felon", "inmate"]) assert.ok(!MIG.toLowerCase().includes(`'${word}`), word);
  });
  it("review round 1: the note lock covers every field, the activity list is widened quote-safe, a deny wins, change requests name nobody", () => {
    const lock = MIG.slice(MIG.indexOf("FUNCTION public.case_note_review_lock"), MIG.indexOf("REVOKE ALL ON FUNCTION public.case_note_review_lock"));
    // Round 2: the whole row, less only the column a deleted account clears.
    assert.ok(lock.includes("IF (to_jsonb(NEW) - 'author_user_id') = (to_jsonb(OLD) - 'author_user_id') THEN"));
    assert.ok(MIG.includes("regexp_matches(v_def, '''((?:[^'']|'''''')*)''', 'g')"));
    const assigner = MIG.slice(MIG.indexOf("FUNCTION public.smr_task_assigner"), MIG.indexOf("REVOKE ALL ON FUNCTION public.smr_task_assigner"));
    assert.match(assigner, /\)\)\)\n\s+-- A deny wins for EVERY role[^\n]*\n\s+AND NOT EXISTS/);
    const after = MIG.slice(MIG.indexOf("FUNCTION public.org_change_request_after"), MIG.indexOf("REVOKE ALL ON FUNCTION public.org_change_reply_after"));
    assert.doesNotMatch(after, /org_activity_write/, "change-request activity goes through the actor-free writer");
  });
  it("review round 2: fresh answers compare trimmed, definer-only helpers are asserted, the AI switch is the owner's", () => {
    assert.ok(MIG.includes("btrim(COALESCE(NEW.answer, '')) = btrim(COALESCE(OLD.answer, ''))"));
    for (const fn of ["smr_activity_without_actor(uuid, text, text, text, text)", "smr_org_managers(uuid)", "smr_comment_mentions(uuid, uuid, uuid, uuid[], uuid[])"]) {
      assert.ok(MIG.includes(`has_function_privilege('smr_app', 'public.${fn}', 'EXECUTE')`), fn);
    }
    const ai = MIG.slice(MIG.indexOf("FUNCTION public.org_profile_ai_owner_only"), MIG.indexOf("REVOKE ALL ON FUNCTION public.org_profile_ai_owner_only"));
    assert.match(ai, /a\.partner_user_id = v_actor/);
    assert.doesNotMatch(ai, /SECURITY DEFINER/);
    assert.match(ai, /TG_OP = 'INSERT' AND EXISTS \(SELECT 1 FROM public\.org_profile p WHERE p\.access_code_id = NEW\.access_code_id\)/, "round 3: the upsert's insert step defers to the update trigger");
    assert.match(teamTalkErrorLine("ERROR: ai_assist_owner_only: x"), /Only the owner/);
  });
  it("the activity log takes the two new entities, and the code knows them", () => {
    assert.match(MIG, /v_new text\[\] := ARRAY\['comment', 'change_request'\]/);
    for (const e of ["comment", "change_request"] as const) {
      assert.ok((ACTIVITY_ENTITIES as readonly string[]).includes(e));
      assert.ok(ACTIVITY_ENTITY_LABELS[e]);
    }
  });
  it("inbox kinds and source tables match the CHECKs", () => {
    // 109's list, then 111 (S6) widens it from the live CHECK with recognition and contribution_answered.
    const m111 = readFileSync(join(import.meta.dirname, "..", "..", "migrations", "111_staff_rewards.sql"), "utf8");
    const s6 = (m111.match(/'kind', 'staff_inbox_item_kind_check', ARRAY\[([^\]]*)\]/)?.[1] ?? "").match(/'([a-z_]+)'/g)?.map((x) => x.slice(1, -1)) ?? [];
    assert.deepEqual([...sqlList("kind                TEXT NOT NULL CHECK (kind IN"), ...s6], [...INBOX_KINDS]);
  });
  it("the task handoff guard skips definer paths and checks the new owner's reach", () => {
    const body = MIG.slice(MIG.indexOf("FUNCTION public.staff_task_assign_guard"), MIG.indexOf("REVOKE ALL ON FUNCTION public.staff_task_assign_guard"));
    assert.match(body, /rolbypassrls OR r\.rolsuper/);
    assert.match(body, /smr_staff_reach\(NEW\.access_code_id, NEW\.owner_user_id, NEW\.client_user_id\)/);
    assert.doesNotMatch(body, /SECURITY DEFINER/, "invoker, so definer paths are recognized");
  });
  it("102's task activity is kept word for word apart from the handoff branches", () => {
    const m102 = readFileSync(join(import.meta.dirname, "..", "..", "migrations", "102_reach_activity_audit.sql"), "utf8");
    for (const phrase of ["'cancelled a task'", "'ticked off a task shared with them'", "'marked a task done'", "'reopened a task'", "'changed a task'"]) {
      assert.ok(m102.includes(phrase) && MIG.includes(phrase), phrase);
    }
  });
});
