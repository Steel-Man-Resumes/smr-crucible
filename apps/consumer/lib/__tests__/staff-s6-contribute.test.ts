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
import { contributeTools, typedByStaff, methodTypedByStaff, CONTRIBUTE_TOOL_NAMES, CONTRIBUTE_STREAMED, type ContributeToolContext } from "../tools/staff/contribute-tools";
import { listingNudgeFor, suggestionsOn } from "../staff-listing-nudge";
import { LISTING_NUDGE_LINE, namesMentioned } from "@crucible/core/src/staffRewardsShared";
import type { OrgActor } from "@crucible/core/src/authz/resolveOrgActor";

const ROOT = new URL("../../", import.meta.url).pathname;
const actor: OrgActor = {
  userId: "00000000-0000-4000-8000-000000000001", orgId: "00000000-0000-4000-8000-000000000002", orgName: "Lakeshore Works (Demo)",
  role: "staff", capabilities: new Set(["org.cohort.view"]), reach: "assigned", viaPlatformAdmin: false,
};
const LISTING = "00000000-0000-4000-8000-000000000099";
type Tools = ReturnType<typeof contributeTools.build>;
const run = (t: Tools, name: string, args: unknown) =>
  (t[name].execute as (a: unknown, o: unknown) => Promise<Record<string, unknown>>)(args, { toolCallId: "x", messages: [] });
function ctxFor(core: () => Promise<never>, over: Partial<ContributeToolContext> & { actorOver?: Partial<OrgActor> } = {}): ContributeToolContext {
  return {
    initial: actor, loadCore: core, actor: async () => ({ ...actor, ...(over.actorOver ?? {}) }),
    staffWords: over.staffWords ?? "", selectors: over.selectors ?? new Map(),
    safe: (fn) => async (x) => { try { return await fn(x); } catch { return { status: "unavailable" }; } },
  };
}
const build = (core: () => Promise<never>, over: Parameters<typeof ctxFor>[1] = {}) => contributeTools.build(ctxFor(core, over));
function stand(over: Record<string, unknown> = {}) {
  const calls: string[] = [];
  const core = {
    getStaffPrefs: async () => { calls.push("prefs"); return { effective: { suggestions: over.suggestions ?? true } }; },
    claimListingNudge: async () => { calls.push("claim"); return over.claim ?? true; },
    staffUnlocks: async () => { calls.push("unlocks"); return over.unlocks ?? ["directory_scout"]; },
    reachableParticipantNames: async () => [{ id: "p1", name: "Alma Reyes" }],
    // Stand-in for 111 staff_text_participant_names: only people the writer reaches ("Alma Reyes").
    participantNamesIn: async (_a: unknown, text: string) => { calls.push(`names:${text}`); return { reached: namesMentioned(text, [{ id: "p1", name: "Alma Reyes" }]) }; },
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

test("route rules: writes take application/json only", async () => {
  const { readJsonStrict, isJsonRequest } = await import("../staff-rewards-route");
  const mk = (type: string) => new Request("https://example.test/api/org/kudos", { method: "POST", headers: { "content-type": type }, body: JSON.stringify({ a: 1 }) });
  assert.equal(isJsonRequest(mk("application/json; charset=utf-8").headers), true);
  assert.deepEqual(await readJsonStrict(mk("application/json")), { a: 1 });
  assert.equal(await readJsonStrict(mk("text/plain")), null, "text/plain is refused (no beacon-style writes here)");
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
  const n = await listingNudgeFor(actor, { kind: "resource", id: LISTING }, { loadCore: on.core });
  assert.equal(n?.line, LISTING_NUDGE_LINE);
  assert.equal(LISTING_NUDGE_LINE, "Did this place still check out? Called them lately?");
  assert.deepEqual(n?.flows.map((f) => f.flow), ["called_today", "correction"]);
  const off = stand({ suggestions: false });
  assert.equal(await listingNudgeFor(actor, { kind: "resource", id: LISTING }, { loadCore: off.core }), null, "suggestions off: quiet");
  assert.ok(!off.calls.includes("claim"), "and the week is not used up");
  const already = stand({ claim: false });
  assert.equal(await listingNudgeFor(actor, { kind: "resource", id: LISTING }, { loadCore: already.core }), null, "asked this week already: quiet");
  assert.equal(await listingNudgeFor({ ...actor, viaPlatformAdmin: true }, { kind: "resource", id: LISTING }, { loadCore: on.core }), null);
  assert.notEqual(await listingNudgeFor(actor, { kind: "resource", id: LISTING }, { loadCore: off.core, suggestionsOn: true }), null, "the registry may pass S1's switch in");
});

test("suggestionsOn defaults to on, and a failed read never nags", async () => {
  assert.equal(await suggestionsOn(actor, async () => ({ getStaffPrefs: async () => ({ effective: {} }) }) as never), true);
  assert.equal(await suggestionsOn(actor, async () => ({ getStaffPrefs: async () => ({ effective: { suggestions: false } }) }) as never), false);
  assert.equal(await suggestionsOn(actor, async () => ({ getStaffPrefs: async () => { throw new Error("down"); } }) as never), false);
});

/** S1's rule (lib/staff-skill-run.ts checkStreamedDrafts): every key declared, only draftBody may be "draft". */
function assertDeclared(tool: (typeof CONTRIBUTE_TOOL_NAMES)[number], result: Record<string, unknown>) {
  const shape = CONTRIBUTE_STREAMED[tool];
  for (const k of Object.keys(result)) assert.ok(k in shape, `${tool}: undeclared key ${k}`);
}

test("the module has S1's shape: id, streamed shapes, an activity line for each", () => {
  assert.equal(contributeTools.id, "contribute");
  assert.deepEqual(Object.keys(contributeTools.streamed ?? {}).sort(), [...CONTRIBUTE_TOOL_NAMES].sort());
  const d = CONTRIBUTE_STREAMED.draft_directory_contribution;
  for (const k of ["flow", "targetKind", "listingId", "interactionMethod", "draftBodyField"]) assert.equal(d[k], "server", `${k}: validated, so server`);
  for (const k of ["fields", "interactionOn"]) assert.equal(d[k], "staff", `${k}: typed by the staff member`);
  assert.ok(!("card" in d), "no mixed card key");
  for (const [tool, shape] of Object.entries(CONTRIBUTE_STREAMED)) {
    for (const [k, src] of Object.entries(shape)) assert.ok(src !== "draft" || k === "draftBody", `${tool}.${k}: only draftBody may be draft`);
    assert.equal(shape.status, "server"); assert.equal(shape.error, "server");
  }
  for (const n of CONTRIBUTE_TOOL_NAMES) assert.ok(contributeTools.activity?.[n], n);
  const src = readFileSync(join(ROOT, "lib/tools/staff/contribute-tools.ts"), "utf8");
  assert.ok(!/^import [^;]*from "@crucible\/core";/m.test(src), "no top-level core import (browser-safe)");
});

test("the nudge tool returns the fixed line or quiet, never model words", async () => {
  const r = await run(build(stand().core), "listing_check_nudge", { kind: "employer", listingId: LISTING });
  assert.equal(r.status, "ok");
  assert.equal(r.line, LISTING_NUDGE_LINE);
  assert.deepEqual(r.listing, { kind: "employer", id: LISTING });
  assertDeclared("listing_check_nudge", r);
  assert.equal((await run(build(stand({ claim: false }).core), "listing_check_nudge", { kind: "employer", listingId: LISTING })).status, "quiet");
  assert.equal((await run(build(stand().core), "listing_check_nudge", { kind: "employer", listingId: "drop table" })).status, "quiet");
});

test("method typed by the staff member", () => {
  assert.ok(methodTypedByStaff("I called them this morning", "phone_call"));
  assert.ok(!methodTypedByStaff("They are open Tuesdays", "phone_call"));
  assert.ok(methodTypedByStaff("I stopped by on my way in", "site_visit"));
  assert.ok(!methodTypedByStaff("I called them", "site_visit"));
  assert.ok(!methodTypedByStaff("anything", null));
});

test("staff-typed check: words, phone digits, tokens", () => {
  const said = "I called Lakeshore Pantry in Muskegon MI today at (231) 555-0142, see https://example.org/pantry";
  assert.ok(typedByStaff(said, "Lakeshore Pantry", "words"));
  assert.ok(!typedByStaff(said, "Harbor Foods", "words"));
  assert.ok(typedByStaff(said, "231-555-0142", "phone"));
  assert.ok(!typedByStaff(said, "231-555-9999", "phone"));
  assert.ok(typedByStaff(said, "MI", "token"));
  assert.ok(typedByStaff(said, "https://example.org/pantry", "token"));
});

test("the draft tool: model words only in draftBody, fields only what the staff member typed, and it sends nothing", async () => {
  const s = stand();
  const today = new Date().toISOString().slice(0, 10);
  const t = build(s.core, { staffWords: "I called Lakeshore Pantry today, they are still open Tuesdays" });
  const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  const r = await run(t, "draft_directory_contribution", { flow: "called_today", targetKind: "resource", listingId: LISTING, name: "Lakeshore Pantry", city: "Grand Haven", said: "Still open Tuesdays from 9 to 1", interactionOn: today, interactionMethod: "phone_call" });
  assert.equal(r.status, "draft", JSON.stringify(r));
  assert.equal(r.draftBody, "Still open Tuesdays from 9 to 1", "the model's wording is the draft body, which the route claim-checks");
  const card = r as unknown as { fields: Record<string, unknown>; draftBodyField: string; listingId: string };
  assert.equal(card.fields.name, "Lakeshore Pantry", "typed by the staff member: kept");
  assert.equal(card.fields.city, undefined, "not typed by the staff member: left out");
  assert.deepEqual(r.leftOut, ["city"]);
  assertDeclared("draft_directory_contribution", r);
  assert.equal((card as unknown as { interactionMethod: string }).interactionMethod, "phone_call", "they said they called");
  assert.ok(!s.calls.some((c) => c.startsWith("names:") && c.includes("Lakeshore")), "the place's own name is never name-checked");
  // A date or method the staff member did not say stays blank; they pick on the card (review round 1).
  const unsaid = await run(t, "draft_directory_contribution", { flow: "called_today", targetKind: "resource", listingId: LISTING, said: "Open", interactionOn: yesterday, interactionMethod: "site_visit" });
  const uc = unsaid as { interactionOn: unknown; interactionMethod: unknown };
  assert.equal(uc.interactionOn, null);
  assert.equal(uc.interactionMethod, null);
  assert.deepEqual(unsaid.leftOut, ["date", "how"]);
  assert.equal(unsaid.status, "needs_more");
  assert.equal(card.draftBodyField, "said");
  assert.ok(!JSON.stringify({ ...r, draftBody: null }).includes("Tuesdays from 9"), "model words appear nowhere but draftBody");
  assert.match(String(r.note), /presses Send\. Nothing was sent\./);
  assert.ok(!s.calls.includes("SUBMIT"), "never submits");
  const hearsay = await run(t, "draft_directory_contribution", { flow: "called_today", targetKind: "resource", listingId: LISTING, said: "Still open", interactionMethod: "heard_from_someone", interactionOn: today });
  assert.equal(hearsay.status, "needs_more", "hearsay is not a call, even in a draft");
});

test("red team: the draft tool refuses record words, a caseload name, and never carries who someone knows", async () => {
  const t = build(stand().core, { selectors: new Map([["p9", "Marisol"]]) });
  const rec = await run(t, "draft_directory_contribution", { flow: "correction", targetKind: "employer", listingId: LISTING, change: "They will not hire anyone on probation now" });
  assert.equal(rec.status, "refused");
  const named = await run(t, "draft_directory_contribution", { flow: "called_today", targetKind: "employer", listingId: LISTING, said: "They said Alma Reyes can start Monday", interactionMethod: "phone_call" });
  assert.equal(named.status, "refused");
  assert.match(String(named.error), /never a participant/);
  const selector = await run(t, "draft_directory_contribution", { flow: "correction", targetKind: "employer", listingId: LISTING, change: "Marisol said they moved" });
  assert.equal(selector.status, "refused", "a first name from the staff member's list counts too");
  const lower = await run(t, "draft_directory_contribution", { flow: "correction", targetKind: "employer", listingId: LISTING, change: "alma reyes says they moved" });
  assert.equal(lower.status, "refused", "lower case counts");
  const place = await run(t, "draft_directory_contribution", { flow: "new_place", targetKind: "employer", name: "Reyes Bakery", state: "MI" });
  assert.notEqual(place.status, "refused", "a place's own name is never treated as a person's (review round 2)");
  const ordinary = await run(t, "draft_directory_contribution", { flow: "correction", targetKind: "employer", listingId: LISTING, change: "they are open late, it has been a long week" });
  assert.notEqual(ordinary.status, "refused", "ordinary words are not names");
  for (const x of [rec, named, selector, lower, place, ordinary]) assertDeclared("draft_directory_contribution", x);
  const ks = await run(t, "draft_directory_contribution", { flow: "knows_someone", targetKind: "employer", listingId: LISTING });
  assert.equal(ks.status, "draft", JSON.stringify(ks));
  assert.ok(!JSON.stringify(ks).includes("typed on the card"), "no private note placeholder is streamed");
  assert.match(String(ks.note), /types who they know in the private box/);
});

test("the draft tool is the directory_scout unlock: before it, it points to the form", async () => {
  const r = await run(build(stand({ unlocks: [] }).core), "draft_directory_contribution", { flow: "new_place", targetKind: "employer", name: "Harbor Freight Lines (Demo)", state: "MI" });
  assert.equal(r.status, "locked");
  assert.match(String(r.error), /\/dashboard\/contribute/);
  const viewing = build(stand().core, { actorOver: { viaPlatformAdmin: true } });
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
  "lib/tools/staff/contribute-tools.ts", "lib/staff-rewards-route.ts", "lib/staff-listing-nudge.ts",
];

test("every S6 org route checks a capability, and every write checks it is the person themselves", () => {
  for (const f of S6_FILES.filter((x) => x.startsWith("app/api/org/"))) {
    const src = readFileSync(join(ROOT, f), "utf8");
    assert.match(src, /requireOrgCapability\(/, `${f} uses the org guard`);
    for (const verb of ["POST", "PUT", "PATCH"]) {
      if (!new RegExp(`export async function ${verb}\\b`).test(src) || f.includes("listing-nudge")) continue;
      assert.match(src, /mayWrite\(/, `${f} ${verb} refuses view-as and other sessions`);
      assert.match(src, new RegExp(`export async function ${verb}\\(request: Request\\) \\{\\n  const w = await gate\\(request\\);`), `${f} ${verb}: the gate is the first await`);
    }
  }
  for (const f of S6_FILES.filter((x) => x.startsWith("app/api/org/"))) {
    const src = readFileSync(join(ROOT, f), "utf8");
    assert.match(src, /refuseCrossOrigin\(request\)/, `${f}: same-origin first`);
    assert.ok(!/request\.json\(/.test(src), `${f}: reads JSON only through readJsonStrict`);
    if (/export async function (POST|PUT|PATCH)/.test(src)) assert.match(src, /readJsonStrict\(request\)/, f);
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
