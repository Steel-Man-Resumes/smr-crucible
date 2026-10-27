/**
 * Team talk in the app (staff side lane S4, migration 109): the routes gate
 * and hand every rule to core; writes check same-origin first; the inbox
 * cannot be pointed at someone else; comment text reaches a model only
 * through the record gate; the @ and review helpers; plain words on screen.
 * Read as source, like the other route checks in this folder. Fictional
 * people only. The real SQL is in team-talk-pglite.test.ts.
 */
import { it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { teamTalkForModel } from "../team-talk-safety";
import { RECORD_WITHHELD } from "../staff-ai-safety";
import { mentionQuery } from "../../components/org/TeamComments";
import { reviewStep } from "../../components/org/NoteReview";

const read = (p: string) => readFileSync(new URL(`../../${p}`, import.meta.url), "utf8");
const ROUTES = ["app/api/org/comments/route.ts", "app/api/org/inbox/route.ts", "app/api/org/change-requests/route.ts", "app/api/org/note-review/route.ts"];

it("every team-talk route goes through the gate with its request and never runs SQL itself", () => {
  for (const r of ROUTES) {
    const src = read(r);
    assert.match(src, /async function gate\(request: Request\) \{\n\s+return withCrm\(await requireOrgCapability\("[a-z_.]+", \{ request \}\)\);/, `${r} gates with its request`);
    assert.match(src, /if \(!g\.ok\) return g\.response;/, `${r} stops on a refusal`);
    assert.doesNotMatch(src, /\b(query|getOne|runScoped|queryAsUser|runAsUser)\(/, `${r} has no SQL of its own`);
    assert.match(src, /export const dynamic = "force-dynamic"/);
  }
});

it("every write starts with the same-origin check", () => {
  for (const r of ROUTES) {
    const src = read(r);
    const handlers = [...src.matchAll(/export async function (?:POST|PUT|DELETE)\(/g)].length;
    const checked = [...src.matchAll(/export async function (?:POST|PUT|DELETE)\([^)]*\) \{\n\s+const cross = refuseCrossOrigin\(request\);/g)].length;
    assert.ok(handlers > 0, r);
    assert.equal(checked, handlers, `${r}: every write handler starts with the same-origin check`);
  }
});

it("the inbox cannot be pointed at anyone else: no recipient or user parameter exists", () => {
  const code = read("app/api/org/inbox/route.ts").replace(/\/\*[\s\S]*?\*\//g, "");
  assert.doesNotMatch(code, /recipient|userId|user_id/);
  assert.match(read("../../packages/core/src/staffInbox.ts"), /\[actor\.orgId, actor\.userId,/, "core names the session as the recipient");
});

it("comments offer only teammates who can see the person, and talk needs view_content", () => {
  const src = read("app/api/org/comments/route.ts");
  assert.match(src, /colleagues\.filter\(\(c\) => c\.reaches\)/);
  assert.match(src, /requireOrgCapability\("org\.client\.view_content"/);
  assert.match(src, /canWrite: !g\.actor\.viaPlatformAdmin && !g\.actor\.viewedBy/, "an admin viewing as staff reads, never writes");
});

it("tasks: a new owner id is checked and handing on goes through core", () => {
  const src = read("app/api/org/tasks/route.ts");
  assert.match(src, /body\.ownerId && !UUID\.test\(String\(body\.ownerId\)\)/);
  assert.match(src, /assignStaffTask\(g\.actor, String\(body\.taskId\), String\(body\.ownerId\)\)/);
  assert.match(src, /listTaskAssignees\(g\.actor, clientId \|\| null\)/);
});

it("comment text reaches a model only through the record gate, withheld whole", () => {
  const out = teamTalkForModel([
    { author_name: "Alma Reyes", created_at: "2026-10-27T15:00:00Z", body: "Can you cover Thursday? He has a PO visit at 2." },
    { author_name: null, created_at: "2026-10-27T16:00:00Z", body: "Yes, I will take the boots run." },
  ]);
  assert.equal(out.comments[0].body, RECORD_WITHHELD);
  assert.equal(out.comments[1].body, "Yes, I will take the boots run.");
  assert.equal(out.comments[1].author, "A teammate");
  assert.equal(out.withheld, 1);
  assert.ok(out.note && /withheld/.test(out.note));
  assert.equal(teamTalkForModel([{ author_name: "Dana Lee", created_at: "x", body: "Lunch at noon" }]).note, null);
});

it("@ suggestions start at an @ word right before the caret, and only there", () => {
  assert.deepEqual(mentionQuery("Thanks @Da", 10), { start: 7, query: "Da" });
  assert.deepEqual(mentionQuery("@", 1), { start: 0, query: "" });
  assert.equal(mentionQuery("email me at name@example.org", 28), null, "an email address is not a mention");
  assert.equal(mentionQuery("Thanks @Dana Lee for", 20), null, "past the name, no suggestion");
  assert.equal(mentionQuery("no at sign", 10), null);
});

it("review: the right next step for each viewer", () => {
  const me = "me", other = "other";
  assert.equal(reviewStep({ status: null, authorId: me, me, reviewer: false }), "send");
  assert.equal(reviewStep({ status: "sent_back", authorId: me, me, reviewer: true }), "resend");
  assert.equal(reviewStep({ status: "pending", authorId: me, me, reviewer: true }), "wait", "never review your own note");
  assert.equal(reviewStep({ status: "pending", authorId: other, me, reviewer: true }), "decide");
  assert.equal(reviewStep({ status: "pending", authorId: other, me, reviewer: false }), "wait");
  assert.equal(reviewStep({ status: "approved", authorId: me, me, reviewer: true }), "none");
});

it("the Inbox and Change requests pages exist", () => {
  assert.ok(existsSync(new URL("../../app/(dashboard)/dashboard/inbox/page.tsx", import.meta.url)));
  assert.ok(existsSync(new URL("../../app/(dashboard)/dashboard/change-requests/page.tsx", import.meta.url)));
});

it("UI copy: no em or en dashes, no double hyphen in text, never a label on a person, and nothing is sent outside the app", () => {
  for (const f of ["components/org/TeamComments.tsx", "components/org/InboxPage.tsx", "components/org/InboxCount.tsx", "components/org/ChangeRequests.tsx",
    "components/org/TaskAssign.tsx", "components/org/NoteReview.tsx", ...ROUTES]) {
    const src = read(f);
    assert.doesNotMatch(src, /[–—]/, `${f}: no em or en dash`);
    assert.doesNotMatch(src, /\b(felon|offender|ex-con|inmate)\b/i, `${f}: no labels`);
    assert.doesNotMatch(src, /sendEmail|from "resend"|twilio|\bsms\b|\/api\/(?:email|sms|text)/i, `${f}: in-app only`);
  }
});
