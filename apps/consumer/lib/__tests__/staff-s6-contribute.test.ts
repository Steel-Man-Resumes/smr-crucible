/**
 * Lane S6 app side: the route rules (lib/staff-rewards-route.ts), the t.ROY
 * directory tools (lib/tools/staff/contribute-tools.ts) with a stand-in core,
 * and static checks on the new routes and screens. The SQL is proven in
 * staff-rewards-pglite.test.ts.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { mayWrite, recordWordsIn, todayUtc, RECORD_WORDS_REFUSAL } from "../staff-rewards-route";
import { buildContributeTools, listingNudgeFor, suggestionsOn, CONTRIBUTE_TOOL_NAMES } from "../tools/staff/contribute-tools";
import { LISTING_NUDGE_LINE, namesMentioned } from "@crucible/core/src/staffRewardsShared";
import type { OrgActor } from "@crucible/core/src/authz/resolveOrgActor";

const ROOT = new URL("../../", import.meta.url).pathname;
const actor: OrgActor = {
  userId: "00000000-0000-4000-8000-000000000001", orgId: "00000000-0000-4000-8000-000000000002", orgName: "Lakeshore Works (Demo)",
  role: "staff", capabilities: new Set(["org.cohort.view"]), reach: "assigned", viaPlatformAdmin: false,
};
const LISTING = "00000000-0000-4000-8000-000000000099";
const run = (t: ReturnType<typeof buildContributeTools>, name: string, args: unknown) =>
  (t[name].execute as (a: unknown, o: unknown) => Promise<Record<string, unknown>>)(args, { toolCallId: "x", messages: [] });

function stand(over: Record<string, unknown> = {}) {
  const calls: string[] = [];
  const core = {
    getStaffPrefs: async () => { calls.push("prefs"); return { effective: { suggestions: over.suggestions ?? true } }; },
    claimListingNudge: async () => { calls.push("claim"); return over.claim ?? true; },
    staffUnlocks: async () => { calls.push("unlocks"); return over.unlocks ?? ["directory_scout"]; },
    reachableParticipantNames: async () => [{ id: "p1", name: "Alma Reyes" }],
    namesMentioned,
    submitContribution: async () => { calls.push("SUBMIT"); return { ok: true, id: "x" }; },
  };
  return { core: async () => core as never, calls };
}

test("route rules: only the person themselves writes", () => {
  assert.equal(mayWrite({ viaPlatformAdmin: false, actorUserId: "a", sessionUserId: "a" }), true);
  assert.equal(mayWrite({ viewing: true, viaPlatformAdmin: false, actorUserId: "a", sessionUserId: "a" }), false, "not while viewing as them");
  assert.equal(mayWrite({ viaPlatformAdmin: true, actorUserId: "a", sessionUserId: "a" }), false, "not a platform admin acting on an org");
  assert.equal(mayWrite({ viaPlatformAdmin: false, actorUserId: "a", sessionUserId: "b" }), false, "not someone else's session");
  assert.equal(mayWrite({ viaPlatformAdmin: false, actorUserId: "a", sessionUserId: null }), false);
});

test("route rules: record words are refused in words other people read", () => {
  assert.equal(recordWordsIn(["Great catch on the bus pass deadline"]), null);
  assert.ok(recordWordsIn(["Thanks for handling her parole officer visit"]));
  assert.ok(recordWordsIn([null, "", "Court date moved, nice catch"]));
  assert.ok(!/[–—]/.test(RECORD_WORDS_REFUSAL));
  assert.equal(todayUtc(Date.parse("2026-10-27T23:30:00Z")), "2026-10-27");
});

test("the nudge: one line, only when suggestions are on, at most once a week (the claim decides)", async () => {
  const on = stand();
  const n = await listingNudgeFor(actor, { kind: "resource", id: LISTING }, { core: on.core });
  assert.equal(n?.line, LISTING_NUDGE_LINE);
  assert.equal(LISTING_NUDGE_LINE, "Did this place still check out? Called them lately?");
  assert.deepEqual(n?.flows.map((f) => f.flow), ["called_today", "correction"]);

  const off = stand({ suggestions: false });
  assert.equal(await listingNudgeFor(actor, { kind: "resource", id: LISTING }, { core: off.core }), null, "suggestions off: quiet");
  assert.ok(!off.calls.includes("claim"), "and the week is not used up");

  const already = stand({ claim: false });
  assert.equal(await listingNudgeFor(actor, { kind: "resource", id: LISTING }, { core: already.core }), null, "asked this week already: quiet");

  assert.equal(await listingNudgeFor({ ...actor, viaPlatformAdmin: true }, { kind: "resource", id: LISTING }, { core: on.core }), null);
  assert.equal(await listingNudgeFor(actor, { kind: "resource", id: LISTING }, { core: off.core, suggestionsOn: true }) !== null, true, "the registry may pass S1's switch in");
});

test("suggestionsOn defaults to on, and a failed read never nags", async () => {
  assert.equal(await suggestionsOn(actor, async () => ({ getStaffPrefs: async () => ({ effective: {} }) }) as never), true);
  assert.equal(await suggestionsOn(actor, async () => ({ getStaffPrefs: async () => ({ effective: { suggestions: false } }) }) as never), false);
  assert.equal(await suggestionsOn(actor, async () => ({ getStaffPrefs: async () => { throw new Error("down"); } }) as never), false);
});

test("the nudge tool returns the line or quiet", async () => {
  assert.deepEqual([...CONTRIBUTE_TOOL_NAMES].sort(), ["draft_directory_contribution", "listing_check_nudge"]);
  const t = buildContributeTools(actor, { core: stand().core });
  const r = await run(t, "listing_check_nudge", { kind: "employer", listingId: LISTING });
  assert.equal(r.status, "ok");
  assert.equal(r.line, LISTING_NUDGE_LINE);
  const q = await run(buildContributeTools(actor, { core: stand({ claim: false }).core }), "listing_check_nudge", { kind: "employer", listingId: LISTING });
  assert.equal(q.status, "quiet");
});

test("the draft tool drafts a card and sends nothing", async () => {
  const s = stand();
  const t = buildContributeTools(actor, { core: s.core, today: "2026-10-27" });
  const r = await run(t, "draft_directory_contribution", { flow: "called_today", targetKind: "resource", listingId: LISTING, said: "Still open Tuesdays", interactionOn: "2026-10-27", interactionMethod: "phone_call" });
  assert.equal(r.status, "draft", JSON.stringify(r));
  assert.match(String(r.note), /presses Send\. Nothing was sent\./);
  assert.ok(!s.calls.includes("SUBMIT"), "never submits");
  const missing = await run(t, "draft_directory_contribution", { flow: "called_today", targetKind: "resource", listingId: LISTING, said: "Still open", interactionMethod: "heard_from_someone", interactionOn: "2026-10-27" });
  assert.equal(missing.status, "needs_more", "hearsay is not a call, even in a draft");
});

test("red team: the draft tool refuses record words, a caseload name, and never carries who someone knows", async () => {
  const t = buildContributeTools(actor, { core: stand().core, today: "2026-10-27" });
  const rec = await run(t, "draft_directory_contribution", { flow: "correction", targetKind: "employer", listingId: LISTING, change: "They will not hire anyone on probation now" });
  assert.equal(rec.status, "refused");
  const named = await run(t, "draft_directory_contribution", { flow: "called_today", targetKind: "employer", listingId: LISTING, said: "They said Alma Reyes can start Monday", interactionOn: "2026-10-27", interactionMethod: "phone_call" });
  assert.equal(named.status, "refused");
  assert.match(String(named.error), /never a participant/);
  const ks = await run(t, "draft_directory_contribution", { flow: "knows_someone", targetKind: "employer", listingId: LISTING });
  assert.equal(ks.status, "draft");
  assert.equal((ks.card as Record<string, unknown>).privateNote, null, "t.ROY never holds a personal contact");
  assert.match(String(ks.note), /types who they know in the private box/);
});

test("the draft tool is the directory_scout unlock: before it, it points to the form", async () => {
  const t = buildContributeTools(actor, { core: stand({ unlocks: [] }).core });
  const r = await run(t, "draft_directory_contribution", { flow: "new_place", targetKind: "employer", name: "Harbor Freight Lines (Demo)", state: "MI" });
  assert.equal(r.status, "locked");
  assert.match(String(r.error), /\/dashboard\/contribute/);
  const viewing = buildContributeTools({ ...actor, viaPlatformAdmin: true }, { core: stand().core });
  assert.equal((await run(viewing, "draft_directory_contribution", { flow: "new_place", targetKind: "employer", name: "X", state: "MI" })).status, "refused");
});

function walk(p: string): string[] {
  const st = statSync(p);
  if (st.isFile()) return [p];
  return readdirSync(p).flatMap((n) => walk(join(p, n)));
}
const S6_FILES = [
  "app/api/org/rewards/route.ts", "app/api/org/kudos/route.ts", "app/api/org/recognition/route.ts",
  "app/api/org/directory-contributions/route.ts", "app/api/org/listing-nudge/route.ts", "app/api/admin/directory-contributions/route.ts",
  ...walk(join(ROOT, "components/org/rewards")).map((f) => f.slice(ROOT.length)),
  ...walk(join(ROOT, "components/org/directory")).map((f) => f.slice(ROOT.length)),
  "lib/tools/staff/contribute-tools.ts", "lib/staff-rewards-route.ts",
];

test("every S6 org route checks a capability, and every write checks it is the person themselves", () => {
  for (const f of S6_FILES.filter((x) => x.startsWith("app/api/org/"))) {
    const src = readFileSync(join(ROOT, f), "utf8");
    assert.match(src, /requireOrgCapability\(/, `${f} uses the org guard`);
    for (const verb of ["POST", "PUT", "PATCH"]) {
      if (!new RegExp(`export async function ${verb}\\b`).test(src) || f.includes("listing-nudge")) continue;
      assert.match(src, /mayWrite\(/, `${f} ${verb} refuses view-as and other sessions`);
    }
  }
  const admin = readFileSync(join(ROOT, "app/api/admin/directory-contributions/route.ts"), "utf8");
  assert.match(admin, /requirePlatformAdmin\(/);
  assert.match(admin, /isSameOriginJsonPost/);
});

test("words on the new screens: no en or em dashes, t.ROY spelled right, no labels on people", () => {
  for (const f of S6_FILES) {
    const src = readFileSync(join(ROOT, f), "utf8");
    assert.ok(!/[–—]/.test(src), `${f} has no en or em dash`);
    assert.ok(!/\bT\.ROY\b|t\.Roy\b/.test(src), `${f} spells t.ROY`);
    assert.ok(!/\b(felon|offender|ex-con)\b/i.test(src), `${f} puts no label on a person`);
  }
});

test("the contribution form has no participant field and keeps the private box private", () => {
  const form = readFileSync(join(ROOT, "components/org/directory/ContributeForm.tsx"), "utf8");
  assert.ok(!/participant|clientId|client_user_id/i.test(form.replace(/\/\*\*[\s\S]*?\*\//, "")), "no participant field in the form code");
  assert.match(form, /Never published|never publish/);
});
