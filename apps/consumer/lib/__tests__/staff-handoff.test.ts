/**
 * Handoffs and connections, app side (staff pass S5): the tray, the words,
 * the person's t.ROY (context and tool) with the participant record gate,
 * the staff t.ROY tools, the take-then-answer order, and the route rules.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  addToTray, readTray, removeFromTray, updateTrayItem, clearTray, putDraftInTray, itemKey, trayKey, trayKeysIn, TRAY_PREFIX,
  isHandoffDraftResult, applyHandoffDraft, draftButtonLabel, type TrayStore,
} from "../handoff-tray";
import { bandLine, dayWords, CONNECTIONS_LOG_WORDS } from "../handoff-words";
import { gateForPerson, buildCaseManagerSection, STAFF_WORDS_NOTE, type CaseManagerContext } from "../staff-handoff-context";
import { assembleFullContext, loadUserFullContext, type FullContextLoaders, type FullContextParts } from "../assistant-full-context";
import { buildAssistantTools, buildHandsSection, readMyStaffSuggestions } from "../tools/assistant-tools";
import { buildHandoffDraft, handoffToolModule, RECORD_IN_DRAFT, DRAFT_MESSAGE, type HandoffToolContext } from "../tools/staff/handoff-tools";
import { RECORD_WITHHELD } from "../staff-ai-safety";
import { composeDraftBody, parseDraftBody, noteIsComposable } from "../handoff-draft-body";
import { takeItem } from "../../components/MyHandoffs";
import { matchToItem, LOOK_LINE } from "../../components/org/ConnectionsPanel";
import { resultToItem, firstRole } from "../../components/org/HandoffPanel";
import { addedWords } from "../../components/org/SendToButton";
import type { HandoffItemInput } from "@crucible/core/src/staffHandoffShared";
import type { OrgActor } from "@crucible/core/src/authz/resolveOrgActor";

const STAFF = "44444444-4444-4444-8444-444444444444";
const P1 = "33333333-3333-4333-8333-333333333333";
const E1 = "11111111-1111-4111-8111-111111111111";
const R1 = "22222222-2222-4222-8222-222222222222";
const mem = (): TrayStore & { data: Map<string, string> } => {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v), removeItem: (k) => void data.delete(k) };
};
const step = (s: string): HandoffItemInput => ({ kind: "next_step", step: s, why: "Because it helps" });

/* ------------------------------------------------------------------ tray -- */

test("the tray collects per staff member and person, never twice, at most ten", () => {
  const s = mem();
  assert.equal(addToTray(STAFF, P1, step("Bring ID"), s), "added");
  assert.equal(addToTray(STAFF, P1, step("bring id "), s), "already", "the same step, any case or spacing");
  assert.equal(readTray("someone-else", P1, s).items.length, 0, "another staff member's tray is separate");
  for (let i = 0; i < 9; i++) addToTray(STAFF, P1, step(`Step ${i}`), s);
  assert.equal(addToTray(STAFF, P1, step("Eleventh"), s), "full");
  assert.ok(trayKey(STAFF, P1).startsWith(TRAY_PREFIX));
  assert.deepEqual(trayKeysIn([...s.data.keys(), "staff-draft:x"]), [trayKey(STAFF, P1)]);
  removeFromTray(STAFF, P1, itemKey(step("Bring ID")), s);
  assert.equal(readTray(STAFF, P1, s).items.length, 9);
  updateTrayItem(STAFF, P1, itemKey(step("Step 0")), { ...step("Step 0"), why: "Edited reason" }, s);
  assert.equal((readTray(STAFF, P1, s).items[0] as { why: string }).why, "Edited reason");
  clearTray(STAFF, P1, s);
  assert.equal(readTray(STAFF, P1, s).items.length, 0);
});

test("a tray older than a day starts fresh; a broken one never throws", () => {
  const s = mem();
  addToTray(STAFF, P1, step("Old"), s, 1_000);
  assert.equal(readTray(STAFF, P1, s, 1_000 + 25 * 3600_000).items.length, 0);
  s.setItem(trayKey(STAFF, P1), "{not json");
  assert.equal(readTray(STAFF, P1, s).items.length, 0);
});

test("the tray lives in sessionStorage only", () => {
  const src = readFileSync(new URL("../handoff-tray.ts", import.meta.url), "utf8");
  assert.ok(!/localStorage\s*[.[]/.test(src), "never localStorage");
  assert.match(src, /window\.sessionStorage/);
});

test("a t.ROY draft merges into the tray, marked as drafted, and only opens the page", () => {
  const s = mem();
  addToTray(STAFF, P1, step("Mine first"), s);
  const { draftBody, shapes } = composeDraftBody("Alma, a few things.", [step("Mine first"), step("From t.ROY")]);
  const r = { status: "needs_confirmation", action: "handoff_draft", clientId: P1, firstName: "Alma", items: shapes, draftBody };
  assert.ok(isHandoffDraftResult(r));
  assert.ok(!isHandoffDraftResult({ ...r, clientId: "../../etc" }), "only a real id");
  assert.ok(!isHandoffDraftResult({ ...r, status: "sent" }));
  assert.ok(!isHandoffDraftResult({ ...r, draftBody: "no note line" }), "a body that does not parse is not a draft");
  assert.equal(draftButtonLabel(r as never), "Put this in Alma's handoff");
  const href = applyHandoffDraft(r as never, STAFF, s);
  assert.equal(href, `/dashboard/clients/${P1}?tab=tasks#handoff`);
  const t = readTray(STAFF, P1, s);
  assert.deepEqual(t.items.map((i) => (i as { step: string }).step), ["Mine first", "From t.ROY"]);
  assert.equal(t.draftedByAssistant, true);
  assert.equal(t.note, "Alma, a few things.");
});

/* ----------------------------------------------------------------- words -- */

test("band words never call B or C checked; dates read plainly; no dashes anywhere new", () => {
  assert.equal(bandLine("employer", "A"), "Has the hiring mark");
  assert.ok(!/check/i.test(bandLine("resource", "B").replace("not yet checked", "")));
  assert.match(bandLine("resource", "C"), /unconfirmed/);
  assert.equal(dayWords("2026-10-27"), "Oct 27, 2026");
  assert.equal(dayWords(null), "");
  for (const f of ["../../components/org/HandoffPanel.tsx", "../../components/org/ConnectionsPanel.tsx", "../../components/org/SendToButton.tsx", "../../components/MyHandoffs.tsx",
    "../handoff-words.ts", "../staff-handoff-context.ts", "../tools/staff/handoff-tools.ts"]) {
    const src = readFileSync(new URL(f, import.meta.url), "utf8");
    const strings = [...src.matchAll(/"([^"\n]{12,})"|`([^`\n]{12,})`|>([^<>{}\n]{12,})</g)].map((m) => m[1] ?? m[2] ?? m[3]);
    for (const w of strings) {
      assert.ok(!/[–—]| -- /.test(w), `${f}: no em or en dash in "${w}"`);
      assert.ok(!/\b(felon|offender|ex-con|inmate)s?\b/i.test(w), `${f}: never a label on a person: "${w}"`);
    }
  }
  assert.ok(!/[–—]/.test(CONNECTIONS_LOG_WORDS + LOOK_LINE + DRAFT_MESSAGE + RECORD_IN_DRAFT));
});

test("Send to buttons and their answers", () => {
  assert.equal(addedWords("added", "Alma Reyes"), "Added to Alma's handoff.");
  assert.equal(addedWords("full", null), "Their handoff is full (ten things). Send it first.");
  assert.equal(firstRole("forklift, warehouse"), "Forklift");
  assert.equal(firstRole(null, "Cook"), "Cook");
  const e = resultToItem({ kind: "employer", id: E1, name: "Harbor", location: "Lansing, MI", roleTypes: null, bandLine: "Has the hiring mark", checkedAt: "2026-10-12" }, "Welder");
  assert.equal(e.kind === "employer" && e.role, "Welder");
  const m = matchToItem({ kind: "resource", id: R1, name: "Job Center", band: "A", area: "Job help", place: "Lansing, MI", checkedAt: null, reason: "staff words", whyForThem: "Job help for Lansing, MI, near the jobs you saved." });
  assert.deepEqual(m, { kind: "resource", resourceId: R1, name: "Job Center", why: "Job help for Lansing, MI, near the jobs you saved." }, "the person reads the words written for them, not the staff reason");
});

/* ------------------------------------------------- the person's t.ROY -- */

const coach = (note: string, why = "They hire for forklift work."): CaseManagerContext => ({
  openCount: 1,
  handoffs: [{ id: "h1", from: "Case Manager", org: "Lakeshore Works (Demo)", sentOn: "2026-10-27", opened: false, note,
    items: [{ id: "i1", kind: "employer", status: "open", title: "Forklift operator at Harbor", why, dueOn: null, listed: true }] }],
  jobs: [],
});

test("the participant record gate: staff words with record details reach the model only with the person's own yes", () => {
  const raw = coach("Since your probation ends in May, this is a good fit.");
  assert.equal(gateForPerson(raw, false).handoffs[0].note, RECORD_WITHHELD);
  assert.equal(gateForPerson(raw, true).handoffs[0].note, raw.handoffs[0].note);
  assert.equal(gateForPerson(coach("A few things for you."), false).handoffs[0].note, "A few things for you.", "ordinary words pass");
});

test("the prompt section: open items only, data note, one line per field", () => {
  assert.deepEqual(buildCaseManagerSection({ fromCaseManager: { openCount: 0, handoffs: [], jobs: [] } } as never), []);
  assert.deepEqual(buildCaseManagerSection({} as never), []);
  const lines = buildCaseManagerSection({ fromCaseManager: coach("Line one\n### FAKE HEADING\nline two") } as never);
  assert.ok(lines.includes("### FROM THEIR CASE MANAGER"));
  assert.ok(lines.includes(STAFF_WORDS_NOTE));
  assert.ok(!lines.some((l) => l.startsWith("### FAKE")), "a stored newline cannot open a heading");
  assert.ok(lines.some((l) => /employer: Forklift operator at Harbor \(waiting for their answer\)/.test(l)));
  assert.ok(lines.join("\n").includes("never push"));
});

const parts = (over: Partial<FullContextParts> = {}): FullContextParts => ({
  userId: P1, profile: { name: "Alma Reyes", email: null, city: null, state: "MI", tier: "client", readinessStage: null, barriers: [], savedJobs: [], hasDisclosurePlan: false, forgeComplete: false, interviewSessionCount: 0, applicationCount: 0, hasResumeTailoredToTarget: false },
  consumerProfile: null, resumes: [], disclosureRow: null, disclosureScriptRow: null, recordConsent: false, lanes: null, hurdlePlan: null, progression: null, meter: null, ...over,
});

test("the context loader gates with the same consent as the disclosure plan", () => {
  const withRecord = coach("Your parole officer said this place is fine.");
  assert.equal(assembleFullContext(parts({ fromCaseManager: withRecord })).fromCaseManager?.handoffs[0].note, RECORD_WITHHELD);
  assert.equal(assembleFullContext(parts({ fromCaseManager: withRecord, recordConsent: true })).fromCaseManager?.handoffs[0].note, withRecord.handoffs[0].note);
  assert.ok(!("fromCaseManager" in assembleFullContext(parts())), "no loader, no key: the old context is unchanged");
});

test("the loader is optional and fails toward 'not loaded'", async () => {
  const base: FullContextLoaders = {
    profile: async () => parts().profile, consumerProfile: async () => null, resumes: async () => [], disclosure: async () => ({ latest: null, latestWithScript: null }),
    recordConsent: async () => true, actingForSomeoneElse: async () => true, lanes: async () => [], hurdlePlan: async () => null, progression: async () => null, meter: async () => null,
  };
  const none = await loadUserFullContext(P1, base);
  assert.ok(none && !("fromCaseManager" in none));
  const failed = await loadUserFullContext(P1, { ...base, staffSuggestions: async () => { throw new Error("110 not applied"); } });
  assert.equal(failed?.fromCaseManager, null);
  const acting = await loadUserFullContext(P1, { ...base, staffSuggestions: async () => coach("On probation until May.") });
  assert.equal(acting?.fromCaseManager?.handoffs[0].note, RECORD_WITHHELD, "someone acting for them: consent never counts");
});

test("read_my_staff_suggestions: gated, read only, and honest when it cannot read", async () => {
  const r = await readMyStaffSuggestions(P1, { load: async () => coach("Your PO approved this."), recordConsent: async () => false });
  assert.equal((r as { handoffs: CaseManagerContext["handoffs"] }).handoffs[0].note, RECORD_WITHHELD);
  assert.match((r as { note: string }).note, /never answer for them/);
  assert.deepEqual((await readMyStaffSuggestions(P1, { load: async () => null, recordConsent: async () => false })).status, "none");
  const down = await readMyStaffSuggestions(P1, { load: async () => { throw new Error("x"); }, recordConsent: async () => false });
  assert.equal(down.status, "unavailable");
  const failsClosed = await readMyStaffSuggestions(P1, { load: async () => coach("On parole."), recordConsent: async () => { throw new Error("x"); } });
  assert.equal((failsClosed as { handoffs: CaseManagerContext["handoffs"] }).handoffs[0].note, RECORD_WITHHELD, "a consent read that fails counts as no");
});

test("the tool exists on the Refinery only, and the hands section says so", () => {
  const refinery = buildAssistantTools({ userId: P1, surface: "refinery" });
  const forge = buildAssistantTools({ userId: P1, surface: "forge" });
  assert.ok("read_my_staff_suggestions" in refinery);
  assert.ok(!("read_my_staff_suggestions" in forge));
  assert.ok(!("read_my_staff_suggestions" in buildAssistantTools({ userId: null, surface: "refinery" })));
  assert.match(buildHandsSection({ userId: P1, surface: "refinery" }), /read_my_staff_suggestions/);
  assert.doesNotMatch(buildHandsSection({ userId: P1, surface: "forge" }), /read_my_staff_suggestions/);
});

/* ------------------------------------------------------ taking an item -- */

const fake = (fail: string[] = []) => {
  const calls: string[] = [];
  const f = async (url: string, body: unknown) => { calls.push(`${url} ${JSON.stringify(body)}`); return new Response(JSON.stringify(fail.includes(url) ? { error: "Premium needed." } : {}), { status: fail.includes(url) ? 403 : 200 }); };
  return { calls, f };
};
const it = (over: Record<string, unknown>) => ({ id: "i1", status: "open", title: "t", why: "w", job_title: null, company: null, location: null, apply_url: null, due_on: null, resource_ref: null, ...over }) as never;

test("taking saves to their own place FIRST, then answers; a failed save records nothing", async () => {
  const a = fake();
  assert.deepEqual(await takeItem(it({ kind: "employer", job_title: "Forklift operator", company: "Harbor" }), a.f), { ok: true });
  assert.match(a.calls[0], /^\/api\/applications .*"source":"staff_handoff".*"status":"saved"/);
  assert.match(a.calls[1], /^\/api\/handoffs .*"answer":"take"/);
  const b = fake(["/api/resource-lists"]);
  const res = await takeItem(it({ kind: "resource", resource_ref: R1 }), b.f);
  assert.deepEqual(res, { ok: false, error: "Premium needed." });
  assert.equal(b.calls.length, 1, "no answer after a failed save");
  const c = fake();
  assert.equal((await takeItem(it({ kind: "resource", resource_ref: R1, listing: { stillListed: false, band: null, checkedAt: null } }), c.f)).ok, false);
  assert.equal(c.calls.length, 0, "a place no longer listed is not saved");
  const d = fake();
  await takeItem(it({ kind: "next_step" }), d.f);
  assert.equal(d.calls.length, 1, "a next step is one call: the server puts it on their list");
  assert.match(d.calls[0], /^\/api\/handoffs /);
});

/* ------------------------------------------------- staff t.ROY tools -- */

const actorOf = (caps: string[]): OrgActor => ({ userId: STAFF, orgId: "55555555-5555-4555-8555-555555555555", orgName: "Lakeshore Works (Demo)", role: "staff",
  capabilities: new Set(caps) as OrgActor["capabilities"], reach: "assigned" as OrgActor["reach"], viaPlatformAdmin: false });
const liveCore = {
  confirmDirectoryItems: async (items: HandoffItemInput[]) => ({ ok: true as const, items: items.map((i) => (i.kind === "employer" ? { ...i, name: "Harbor Docks (listed)" } : i)) }),
};

test("a draft refuses record words anywhere, checks shape, and takes names from the listing", async () => {
  const rec = await buildHandoffDraft(liveCore as never, { clientId: P1, note: "Since you got off probation, here are some places.", items: [{ kind: "next_step", step: "Call them", why: "Because" }] });
  assert.deepEqual(rec, { ok: false, error: RECORD_IN_DRAFT });
  const recWhy = await buildHandoffDraft(liveCore as never, { clientId: P1, note: "A few places.", items: [{ kind: "employer", employerId: E1, role: "Forklift", why: "They hire people on parole" }] });
  assert.equal(recWhy.ok, false);
  const ok = await buildHandoffDraft(liveCore as never, { clientId: P1, note: "A few places.", items: [{ kind: "employer", employerId: E1, role: "Forklift", why: "They hire for forklift work" }] });
  assert.ok(ok.ok && ok.items[0].kind === "employer" && ok.items[0].name === "Harbor Docks (listed)");
  const bad = await buildHandoffDraft(liveCore as never, { clientId: P1, note: "A few places.", items: [{ kind: "employer", why: "No id" }] });
  assert.equal(bad.ok, false);
});

function ctxFor(core: Record<string, unknown>, caps: string[], holdRefusal: { status: "refused"; error: string } | null = null) {
  const order: string[] = [];
  const ctx: HandoffToolContext = {
    initial: actorOf(caps),
    loadCore: async () => { order.push("core"); return core as never; },
    actor: async () => { order.push("actor"); return actorOf(caps); },
    hold: () => { order.push("hold"); return holdRefusal; },
    safe: (run) => run,
    refusal: (reason) => ({ status: "refused", error: reason }),
    dataNote: "data",
  };
  return { ctx, order };
}
const exec = (tools: ReturnType<typeof handoffToolModule.build>, name: string, args: unknown) => (tools[name] as unknown as { execute: (a: unknown, o: unknown) => Promise<any> }).execute(args, {});

test("staff tools claim the person before anything else, and a refused hold reads nothing", async () => {
  const { ctx, order } = ctxFor({}, ["org.suggest.write"], { status: "refused", error: "one person" });
  const tools = handoffToolModule.build(ctx);
  assert.deepEqual(await exec(tools, "draft_handoff", { clientId: P1, note: "Hi there", items: [] }), { status: "refused", error: "one person" });
  assert.deepEqual(await exec(tools, "find_missed_connections", { clientId: P1 }), { status: "refused", error: "one person" });
  assert.deepEqual(order, ["hold", "hold"]);
});

test("draft_handoff only drafts: needs_confirmation, never sent, refused for a role that cannot send", async () => {
  const core = { ...liveCore, canSendHandoff: (a: OrgActor) => a.capabilities.has("org.suggest.write"), getClientHeader: async () => ({ ok: true, rows: [{ name: "Alma Reyes" }] }) };
  const { ctx, order } = ctxFor(core, ["org.suggest.write", "org.client.view_content"]);
  const r = await exec(handoffToolModule.build(ctx), "draft_handoff", { clientId: P1, note: "Alma, a few things.", items: [{ kind: "next_step", step: "Bring your ID", why: "So we can start" }] });
  assert.equal(r.status, "needs_confirmation"); assert.equal(r.action, "handoff_draft"); assert.equal(r.sent, false); assert.equal(r.firstName, "Alma");
  assert.ok(!("note" in r), "no raw model text outside draftBody");
  assert.deepEqual(r.items, [{ kind: "next_step" }], "the shape carries no model words");
  assert.equal(r.draftBody, "Note: Alma, a few things.\nItem 1 step: Bring your ID\nItem 1 why: So we can start");
  assert.equal(order[0], "hold");
  assert.ok(isHandoffDraftResult(r), "the chat recognizes it");
  const noSend = ctxFor(core, ["org.client.view_content"]);
  assert.equal((await exec(handoffToolModule.build(noSend.ctx), "draft_handoff", { clientId: P1, note: "Hi there", items: [{ kind: "next_step", step: "x y", why: "Because" }] })).status, "refused");
  const outOfReach = ctxFor({ ...core, getClientHeader: async () => ({ ok: false, reason: "not_in_reach_or_not_member" }) }, ["org.suggest.write"]);
  assert.deepEqual(await exec(handoffToolModule.build(outOfReach.ctx), "draft_handoff", { clientId: P1, note: "Hi there", items: [{ kind: "next_step", step: "x y", why: "Because" }] }),
    { status: "refused", error: "not_in_reach_or_not_member" });
  assert.ok(handoffToolModule.streamed.includes("draft_handoff"));
});

test("find_missed_connections logs as t.ROY and gates every line people wrote", async () => {
  let via: unknown = null;
  const core = {
    getConnectionsFor: async (_a: OrgActor, _id: string, _n: unknown, _d: unknown, opts: { via?: string }) => {
      via = opts?.via;
      return { status: "ok", firstName: "Alma", shared: { applications: true, resume: false }, note: "Matched on the jobs they shared.", resources: [],
        employers: [{ id: E1, name: "Harbor", band: "A", location: "Lansing, MI", checkedAt: null, reason: 'Matches "Corrections officer", a job they saved', role: "Corrections officer", whyForThem: "It fits" }] };
    },
  };
  const { ctx } = ctxFor(core, ["org.client.view_content"]);
  const r = await exec(handoffToolModule.build(ctx), "find_missed_connections", { clientId: P1 });
  assert.equal(via, "t.ROY", "the person's log says t.ROY opened it");
  assert.equal(r.employers[0].reason, RECORD_WITHHELD);
  assert.equal(r.employers[0].role, RECORD_WITHHELD);
  assert.ok(r.withheldNote);
  const none = ctxFor({ getConnectionsFor: async () => ({ status: "not_in_reach" }) }, ["org.client.view_content"]);
  assert.equal((await exec(handoffToolModule.build(none.ctx), "find_missed_connections", { clientId: P1 })).status, "refused");
});

/* ---------------------------------------------------------- route rules -- */

const route = (p: string) => readFileSync(new URL(`../../app/api/${p}`, import.meta.url), "utf8");

test("routes: gates first, the right capability, same-origin writes, no stray exports", () => {
  const ho = route("org/clients/[id]/handoffs/route.ts");
  assert.match(ho, /GET[\s\S]*requireOrgCapability\("org\.client\.view_content", \{ request \}\)/);
  const post = ho.slice(ho.indexOf("export async function POST"));
  assert.ok(post.indexOf("refuseCrossOrigin") >= 0 && post.indexOf("refuseCrossOrigin") < post.indexOf("await gate(request)"), "same-origin before the session");
  assert.match(ho, /async function gate\(request: Request\) \{\n  return withCrm\(await requireOrgCapability\("org\.suggest\.write", \{ request \}\)\);/);
  assert.ok(post.indexOf("await gate(request)") > 0 && post.indexOf("await gate(request)") < post.indexOf("readJson"), "nothing is read before the gate");
  for (const p of ["org/clients/[id]/connections/route.ts", "org/connections/route.ts"]) {
    const s = route(p);
    assert.match(s, /withCrm\(await requireOrgCapability\("org\.client\.view_content", \{ request \}\)\)/, p);
    assert.doesNotMatch(s, /export async function POST/, `${p} is read only`);
  }
  assert.match(route("org/handoffs/directory/route.ts"), /requireOrgCapability\("org\.suggest\.write", \{ request \}\)/);
  const mine = route("handoffs/route.ts");
  const mpost = mine.slice(mine.indexOf("export async function POST"));
  assert.ok(mpost.indexOf("isSameOriginRequest") < mpost.indexOf("auth()"), "the person's writes are same-origin first");
  for (const p of ["org/clients/[id]/handoffs/route.ts", "org/clients/[id]/connections/route.ts", "org/connections/route.ts", "org/handoffs/directory/route.ts", "handoffs/route.ts"]) {
    const exportsOf = [...route(p).matchAll(/^export (?:async )?(?:function|const) (\w+)/gm)].map((m) => m[1]);
    assert.deepEqual(exportsOf.filter((e) => !["GET", "POST", "dynamic"].includes(e)), [], `${p} exports only route names`);
  }
});

test("draftBody: every model word in one string, and it round-trips exactly", () => {
  const items: HandoffItemInput[] = [
    { kind: "employer", employerId: E1, name: "Harbor Docks (listed)", role: "Forklift operator", location: "Lansing, MI", applyUrl: "https://example.org/jobs", why: "They hire for forklift work." },
    { kind: "resource", resourceId: R1, name: "Job Center, Capital Area", why: "Free help with applications." },
    { kind: "next_step", step: "Bring your state ID", dueOn: "2026-11-03", why: "So we can sign you up." },
  ];
  const { draftBody, shapes } = composeDraftBody("Alma,\nI found a few things.", items);
  for (const sh of shapes) for (const v of Object.values(sh)) assert.ok(!/forklift work|Free help|sign you up|Bring your|Forklift operator/.test(String(v)), "shapes hold no model words");
  assert.ok(!/Harbor Docks|Job Center/.test(draftBody), "listing names stay out of the body (the name check must not read them as people)");
  const back = parseDraftBody(draftBody, shapes, Date.parse("2026-10-27T15:00:00Z"));
  assert.deepEqual(back, { note: "Alma,\nI found a few things.", items });
  assert.equal(parseDraftBody(draftBody.replace("Item 2 why", "Item 2 wh"), shapes), null, "a broken body applies nothing");
  assert.equal(parseDraftBody(draftBody, []), null);
  assert.ok(!noteIsComposable("Hi\nItem 1 why: sneaky"));
});
