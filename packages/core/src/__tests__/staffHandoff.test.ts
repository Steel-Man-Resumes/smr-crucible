/**
 * Handoffs and connections the client missed (migration 110, staff pass S5):
 * the pure rules, the matching, the door statements and the migration's shape.
 * The database behaviour itself is proven in apps/consumer handoff-pglite and
 * scripts/verify-org-isolation.mjs handoffChecks().
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  checkHandoff, itemColumns, firstNameOf, sendToLabel, itemTitle, parsePlace, titleTerms, matchInputs, employerMatchReason, resourceMatchReason,
  sameCompany, cleanDueOn, TAKE_WORDS, TAKEN_WORDS, ITEM_STATUS_WORDS, HANDOFF_STATUS_WORDS, HANDOFF_PROMISE, PASS_WORDS, NOTHING_SHARED_LINE, MATCH_LIMITS_LINE,
  HANDOFF_MAX_ITEMS,
} from "../staffHandoffShared";
import { HANDOFF_SQL, confirmDirectoryItems, itemsJson, sendHandoff, summarizeForCoach, canSendHandoff, type DirectoryLookups, type MyHandoff } from "../staffHandoff";
import { matchPerson, getConnectionsFor, getCaseloadConnections, foldCity, KNOWN_ITEMS_SQL, type ConnectionDeps, type KnownItems } from "../staffConnections";
import { CONNECTION_APPS_SQL, CONNECTION_RESUMES_SQL, CONNECTION_CANDIDATES_SQL, IN_REACH, type ConnectionInputs } from "../orgClientView";
import type { OrgActor } from "../authz/resolveOrgActor";

const E1 = "11111111-1111-4111-8111-111111111111";
const R1 = "22222222-2222-4222-8222-222222222222";
const P1 = "33333333-3333-4333-8333-333333333333";
const NOW = Date.parse("2026-10-27T15:00:00Z");

const actor = (caps: string[], extra: Partial<OrgActor> = {}): OrgActor => ({
  userId: "44444444-4444-4444-8444-444444444444", orgId: "55555555-5555-4555-8555-555555555555", orgName: "Lakeshore Works (Demo)",
  role: "staff", capabilities: new Set(caps) as OrgActor["capabilities"], reach: "assigned" as OrgActor["reach"], viaPlatformAdmin: false, ...extra,
});

/* ------------------------------------------------------------ checkHandoff -- */

test("a good handoff passes, keeps its order and trims words", () => {
  const r = checkHandoff({
    note: "  Alma, I found a few things.\nTake a look.  ",
    items: [
      { kind: "employer", employerId: E1.toUpperCase(), name: "Harbor Freight Docks", role: "Forklift operator", location: "Lansing, MI", why: "They hire for forklift work and carry the mark." },
      { kind: "resource", resourceId: R1, name: "Capital Area Job Center", why: "Free help with applications." },
      { kind: "next_step", step: "Bring your state ID Tuesday", dueOn: "2026-11-03", why: "So we can sign you up." },
      { kind: "job", jobTitle: "Line cook", company: "Riverside Diner", applyUrl: "https://example.org/apply", why: "Day shift." },
    ],
  }, NOW);
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.equal(r.value.note, "Alma, I found a few things.\nTake a look.");
  assert.deepEqual(r.value.items.map((i) => i.kind), ["employer", "resource", "next_step", "job"]);
  assert.equal((r.value.items[0] as { employerId: string }).employerId, E1, "ids are lower-cased");
  assert.equal(r.value.draftedByAssistant, false);
});

test("every refusal is a plain sentence", () => {
  const bad = (raw: unknown) => { const r = checkHandoff(raw, NOW); assert.equal(r.ok, false); return r.ok ? "" : r.error; };
  assert.match(bad(null), /Nothing to send/);
  assert.match(bad({ note: "hi", items: [] }), /short note/);
  assert.match(bad({ note: "Here you go", items: [] }), /at least one thing/);
  const many = Array.from({ length: HANDOFF_MAX_ITEMS + 1 }, (_, i) => ({ kind: "next_step", step: `Step ${i}`, why: "Because" }));
  assert.match(bad({ note: "Here you go", items: many }), /at most 10/);
  assert.match(bad({ note: "Here you go", items: [{ kind: "next_step", step: "Call", why: "x" }] }), /Say why item 1/);
  assert.match(bad({ note: "Here you go", items: [{ kind: "employer", employerId: "nope", name: "X", role: "Y", why: "Because" }] }), /pick the employer/);
  assert.match(bad({ note: "Here you go", items: [{ kind: "employer", employerId: E1, name: "X", role: "", why: "Because" }] }), /kind of job/);
  assert.match(bad({ note: "Here you go", items: [{ kind: "employer", employerId: E1, name: "X", role: "Y", applyUrl: "http://plain", why: "Because" }] }), /https/);
  assert.match(bad({ note: "Here you go", items: [{ kind: "resource", resourceId: "x", name: "X", why: "Because" }] }), /pick the place/);
  assert.match(bad({ note: "Here you go", items: [{ kind: "next_step", step: "Call", dueOn: "2025-01-01", why: "Because" }] }), /pick a date/);
  assert.match(bad({ note: "Here you go", items: [{ kind: "nonsense", why: "Because" }] }), /not something/);
  assert.match(bad({ note: "Here you go", items: [{ kind: "resource", resourceId: R1, name: "X", why: "Because" }, { kind: "resource", resourceId: R1, name: "X", why: "Again" }] }), /already in this handoff/);
});

test("a due date is a real day from today to a year out", () => {
  assert.equal(cleanDueOn("", NOW), null);
  assert.equal(cleanDueOn("2026-10-27", NOW), "2026-10-27");
  assert.equal(cleanDueOn("2026-02-30", NOW), "bad");
  assert.equal(cleanDueOn("2026-10-26", NOW), "bad");
  assert.equal(cleanDueOn("2028-01-01", NOW), "bad");
});

test("each kind becomes exactly the columns the shape constraint wants", () => {
  const emp = itemColumns({ kind: "employer", employerId: E1, name: "Harbor", role: "Forklift operator", why: "Because" });
  assert.equal(emp.kind, "employer"); assert.equal(emp.employer_ref, E1); assert.equal(emp.company, "Harbor"); assert.equal(emp.job_title, "Forklift operator");
  assert.equal(emp.resource_ref, null); assert.equal(emp.step_title, null);
  const res = itemColumns({ kind: "resource", resourceId: R1, name: "Job Center", why: "Because" });
  assert.deepEqual([res.resource_ref, res.ref_name, res.job_title, res.company, res.apply_url], [R1, "Job Center", null, null, null]);
  const step = itemColumns({ kind: "next_step", step: "Bring ID", dueOn: "2026-11-03", why: "Because" });
  assert.deepEqual([step.step_title, step.due_on, step.job_title, step.company], ["Bring ID", "2026-11-03", null, null]);
  const items = JSON.parse(itemsJson([{ kind: "next_step", step: "A", why: "Because" }, { kind: "next_step", step: "B", why: "Because" }]));
  assert.deepEqual(items.map((x: { position: number }) => x.position), [1, 2], "positions keep the order staff chose");
});

test("words: first names, the send button, titles, and no dashes", () => {
  assert.equal(firstNameOf("Alma Reyes"), "Alma");
  assert.equal(firstNameOf(null), "them");
  assert.equal(firstNameOf("   "), "them");
  assert.equal(sendToLabel("Alma Reyes"), "Send to Alma");
  assert.equal(sendToLabel(null), "Send to this person");
  assert.equal(itemTitle({ kind: "employer", job_title: "Forklift operator", company: "Harbor" }), "Forklift operator at Harbor");
  assert.equal(itemTitle({ kind: "next_step", step_title: "Bring ID" }), "Bring ID");
  const all = [...Object.values(TAKE_WORDS), ...Object.values(TAKEN_WORDS), ...Object.values(ITEM_STATUS_WORDS), ...Object.values(HANDOFF_STATUS_WORDS),
    HANDOFF_PROMISE, PASS_WORDS, NOTHING_SHARED_LINE, MATCH_LIMITS_LINE];
  for (const w of all) assert.ok(!/[–—]| -- /.test(w), `no em or en dash: ${w}`);
  for (const w of all) assert.ok(!/\b(felon|offender|ex-con)\b/i.test(w), `never a label on a person: ${w}`);
});

/* ------------------------------------------------------------- matching -- */

test("places come from shared job locations; anything unclear is dropped", () => {
  assert.deepEqual(parsePlace("Lansing, MI"), { state: "MI", city: "Lansing", label: "Lansing, MI" });
  assert.deepEqual(parsePlace("Lansing, Michigan 48933"), { state: "MI", city: "Lansing", label: "Lansing, MI" });
  assert.deepEqual(parsePlace("WI"), { state: "WI", city: null, label: "WI" });
  assert.equal(parsePlace("Remote"), null);
  assert.equal(parsePlace("Somewhere nice"), null);
  assert.equal(parsePlace(null), null);
});

test("search terms are the distinctive words of shared titles", () => {
  assert.deepEqual(titleTerms("Warehouse Associate II"), ["warehouse"]);
  assert.deepEqual(titleTerms("Forklift Operator - 2nd Shift"), ["forklift", "operator"]);
  assert.deepEqual(titleTerms("General Labor"), ["labor"]);
  const mi = matchInputs({
    applications: [
      { jobTitle: "Warehouse Associate", company: "A", location: "Lansing, MI" },
      { jobTitle: "Forklift Operator", company: "B", location: "Lansing, MI" },
      { jobTitle: "Cook", company: "C", location: "Flint, MI" },
      { jobTitle: "Welder", company: "D", location: "Gary, IN" },
    ],
    resumeTargets: ["Shipping clerk"],
  });
  assert.deepEqual(mi.terms.map((t) => t.term), ["warehouse", "forklift", "operator", "cook"], "capped at four, in order");
  assert.deepEqual(mi.places.map((p) => p.label), ["Lansing, MI", "Flint, MI"], "the most common places first, capped at two");
  assert.equal(mi.terms[0].source, "applications");
  assert.deepEqual(matchInputs({ applications: [], resumeTargets: ["Shipping clerk"] }).terms.map((t) => [t.term, t.source]), [["shipping", "resume"], ["clerk", "resume"]]);
});

test("reasons say what matched and what the directory knows, never anything about a record", () => {
  const r = employerMatchReason({ band: "A", checkedAt: "2026-10-12T00:00:00Z", state: "MI" }, { term: "warehouse", from: "Warehouse Associate", source: "applications" }, { state: "MI", city: "Lansing", label: "Lansing, MI" });
  assert.equal(r, 'Hires for warehouse work in MI and carries the hiring mark, checked 2026-10-12. Matches "Warehouse Associate", a job they saved and shared with you.');
  const b = employerMatchReason({ band: "B", state: "MI" }, { term: "cook", from: "Cook", source: "resume" }, null);
  assert.match(b, /below the mark/); assert.match(b, /a resume they shared/);
  assert.match(resourceMatchReason({ band: "C", area_label: "Job training" }, { state: "MI", city: "Flint", label: "Flint, MI" }), /^Job training for Flint, MI \(found in a public list, unconfirmed\)/);
  for (const s of [r, b]) assert.ok(!/record|conviction|felon|eligib/i.test(s));
});

test("same company ignores case, punctuation and Inc/LLC", () => {
  assert.ok(sameCompany("Harbor Docks, Inc.", "harbor docks"));
  assert.ok(!sameCompany("Harbor Docks", "Harbor Freight"));
  assert.ok(!sameCompany("", ""));
});

test("city fold matches the directory's fold", () => {
  assert.equal(foldCity("St. Louis"), "st louis");
  assert.equal(foldCity("Saint Louis"), "st louis");
  assert.equal(foldCity(""), null);
});

/* -------------------------------------------------------- directory check -- */

const dir = (over: Partial<DirectoryLookups> = {}): DirectoryLookups => ({
  employer: async (id) => ({ status: "ok", data: id === E1 ? { id: E1, name: "Harbor Docks (listed)", location: null, city: "Lansing", state: "MI", applyUrl: "https://example.org/jobs" } : null }),
  resource: async (id) => ({ status: "ok", data: id === R1 ? { service_id: R1, org_name: "Capital Area", service_name: "Job Center" } : null }),
  ...over,
});

test("directory items are re-read: names and places come from the listing, not the browser", async () => {
  const r = await confirmDirectoryItems([
    { kind: "employer", employerId: E1, name: "Typed Name", role: "Forklift", location: "Typed place", why: "Because" },
    { kind: "resource", resourceId: R1, name: "Typed", why: "Because" },
  ], dir());
  assert.ok(r.ok);
  if (!r.ok) return;
  const [e, s] = r.items as [{ name: string; location: string | null; applyUrl: string | null }, { name: string }];
  assert.equal(e.name, "Harbor Docks (listed)"); assert.equal(e.location, "Lansing, MI"); assert.equal(e.applyUrl, "https://example.org/jobs");
  assert.equal(s.name, "Job Center, Capital Area");
});

test("a listed employer's link comes from the live listing too: a browser-typed link is never kept", async () => {
  const typed = await confirmDirectoryItems([{ kind: "employer", employerId: E1, name: "X", role: "Forklift", applyUrl: "https://phish.example.invalid/apply", why: "Because" }], dir());
  assert.ok(typed.ok);
  if (typed.ok) assert.equal((typed.items[0] as { applyUrl: string | null }).applyUrl, "https://example.org/jobs");
  const none = await confirmDirectoryItems([{ kind: "employer", employerId: E1, name: "X", role: "Forklift", applyUrl: "https://phish.example.invalid/apply", why: "Because" }],
    dir({ employer: async () => ({ status: "ok", data: { id: E1, name: "Harbor Docks (listed)", location: "Lansing, MI", city: null, state: null, applyUrl: null } }) }));
  assert.ok(none.ok);
  if (none.ok) assert.equal((none.items[0] as { applyUrl: string | null }).applyUrl, null, "no listed link: no link at all");
  const plain = await confirmDirectoryItems([{ kind: "employer", employerId: E1, name: "X", role: "Forklift", why: "Because" }],
    dir({ employer: async () => ({ status: "ok", data: { id: E1, name: "Harbor Docks (listed)", location: null, city: "Lansing", state: "MI", applyUrl: "http://plain.example.org" } }) }));
  if (plain.ok) assert.equal((plain.items[0] as { applyUrl: string | null }).applyUrl, null, "only an https listing link is passed on");
});

test("a listing that is gone, or a failed lookup, stops the whole send", async () => {
  const gone = await confirmDirectoryItems([{ kind: "employer", employerId: R1, name: "X", role: "Y", why: "Because" }], dir());
  assert.equal(gone.ok, false); assert.match(gone.ok ? "" : gone.error, /no longer listed/);
  const down = await confirmDirectoryItems([{ kind: "resource", resourceId: R1, name: "X", why: "Because" }], dir({ resource: async () => ({ status: "unavailable", data: null }) }));
  assert.equal(down.ok, false); assert.match(down.ok ? "" : down.error, /could not be checked/);
});

test("sending needs org.suggest.write, never under a platform admin's look, and refuses before touching the database", async () => {
  assert.equal(canSendHandoff(actor(["org.suggest.write"])), true);
  assert.equal(canSendHandoff(actor(["org.client.view_content"])), false);
  assert.equal(canSendHandoff(actor(["org.suggest.write"], { viaPlatformAdmin: true })), false);
  assert.equal(canSendHandoff(actor(["org.suggest.write"], { viewedBy: "66666666-6666-4666-8666-666666666666" })), false);
  const r = await sendHandoff(actor(["org.client.view_content"]), P1, { note: "Here you go", items: [{ kind: "next_step", step: "Call", why: "Because" }] }, dir());
  assert.deepEqual(r, { ok: false, error: "You do not have access to that." });
  const bad = await sendHandoff(actor(["org.suggest.write"]), "not-a-uuid", {}, dir());
  assert.equal(bad.ok, false);
  const invalid = await sendHandoff(actor(["org.suggest.write"]), P1, { note: "x", items: [] }, dir());
  assert.equal(invalid.ok, false);
});

/* ------------------------------------------------------------ statements -- */

test("every staff statement carries the reach rule; person statements act only for $1", () => {
  for (const k of ["insert", "listFor"] as const) assert.ok(HANDOFF_SQL[k].includes(IN_REACH), `${k} carries IN_REACH`);
  assert.match(HANDOFF_SQL.withdraw, /\(\$3::boolean OR author_user_id = \$4::uuid\)/, "only the author or someone who sees everyone withdraws");
  assert.ok(!("withdrawItems" in HANDOFF_SQL), "closing items on withdraw is the database's job (staff_handoff_close_items)");
  assert.match(HANDOFF_SQL.answer, /h\.status <> 'withdrawn'/, "an answer needs a live handoff");
  for (const k of ["seen", "item", "answer", "seenByItem"] as const) assert.match(HANDOFF_SQL[k], /\$1::uuid/);
  assert.match(HANDOFF_SQL.answer, /kind <> 'next_step'/, "a next step is taken only through the function");
  assert.match(HANDOFF_SQL.mine, /access_code_redemption/, "only from organizations they still belong to");
  for (const s of [CONNECTION_APPS_SQL, CONNECTION_RESUMES_SQL]) {
    assert.ok(s.includes(IN_REACH), "connections reads need reach");
    assert.match(s, /sharing_grant/, "and an active grant");
    assert.ok(!/notes|salary|description|jd_|content/.test(s.replace(/target_context->>'targetJob'/, "")), "and read nothing beyond titles, employers, places and targets");
  }
  assert.match(CONNECTION_CANDIDATES_SQL, /client_staff_assignment/);
  assert.match(KNOWN_ITEMS_SQL, /smr_staff_reach|client_staff_assignment/);
});

/* ------------------------------------------------------- matchPerson -- */

const pub = (id: string, name: string, band: "A" | "B", state = "MI", roleTypes = "warehouse, forklift") => ({
  id, name, industry: null, state, city: "Lansing", location: `Lansing, ${state}`, applyUrl: null, roleTypes, evidence: null, caveats: null,
  checkedAt: "2026-10-10", expiresAt: "2027-10-10", sourceUrl: "https://example.org", relationshipTier: null, scope: "x", standing: "x", version: "1", band, band_reason: band === "A" ? "the mark" : "reported",
});
const res = (id: string, name: string, band = "A") => ({ service_id: id, org_name: name, service_name: null, band, band_reason: "checked", area_label: "Job help", last_checked: "2026-10-01" }) as never;

const cacheFrom = (emps: ReturnType<typeof pub>[], rs: unknown[], calls: string[] = []) => ({
  employers: async (q: string, state?: string) => { calls.push(`e:${q}|${state ?? ""}`); return { status: "ok", data: emps } as never; },
  resources: async (p: { state: string }) => { calls.push(`r:${p.state}`); return { status: "ok", data: rs } as never; },
});
const input = (over: Partial<ConnectionInputs> = {}): ConnectionInputs => ({
  clientId: P1, inReach: true, applicationsShared: true, resumeShared: false,
  applications: [{ jobTitle: "Warehouse Associate", company: "Old Co", location: "Lansing, MI" }], resumeTargets: [], ...over,
});

test("nothing shared means nothing read from the directory and a plain line", async () => {
  const calls: string[] = [];
  const p = await matchPerson(input({ applicationsShared: false }), "Alma Reyes", new Map(), cacheFrom([], [], calls) as never);
  assert.equal(p.status, "nothing_shared"); assert.equal(p.firstName, "Alma"); assert.deepEqual(calls, []);
  assert.equal(p.note, NOTHING_SHARED_LINE);
  const out = await matchPerson(input({ inReach: false }), null, new Map(), cacheFrom([], [], calls) as never);
  assert.equal(out.status, "not_in_reach"); assert.deepEqual(calls, []);
});

test("a shared scope that was read but turned off is never used, even if rows came back", async () => {
  const calls: string[] = [];
  const p = await matchPerson(input({ applicationsShared: false, resumeShared: true, resumeTargets: [] }), null, new Map(), cacheFrom([pub(E1, "Harbor", "A")], [], calls) as never);
  assert.equal(p.employers.length, 0, "applications rows are ignored when that scope is off");
  assert.deepEqual(calls, []);
});

test("matches: the mark first, their own employers and anything already sent left out, each with a reason", async () => {
  const known: KnownItems = new Map([[P1, { employers: new Set(["99999999-9999-4999-8999-999999999999"]), resources: new Set([R1]), companies: ["Sent Before LLC"] }]]);
  const emps = [
    pub("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "Reported Co", "B"),
    pub("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "Marked Co", "A"),
    pub("cccccccc-cccc-4ccc-8ccc-cccccccccccc", "Old Co, Inc.", "A"),
    pub("99999999-9999-4999-8999-999999999999", "Already Sent", "A"),
    pub("dddddddd-dddd-4ddd-8ddd-dddddddddddd", "Sent Before", "A"),
  ];
  const p = await matchPerson(input(), "Alma Reyes", known, cacheFrom(emps, [res(R1, "Known place"), res("eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", "New place")]) as never);
  assert.equal(p.status, "ok");
  assert.deepEqual(p.employers.map((e) => e.name), ["Marked Co", "Reported Co"]);
  assert.ok(p.employers.every((e) => e.reason.includes('"Warehouse Associate"') && e.role === "Warehouse Associate"));
  assert.deepEqual(p.resources.map((r) => r.name), ["New place"]);
  assert.match(p.note, /^Matched on the jobs they shared\./);
});

test("no place in what they shared: employers still match, local help says why it could not", async () => {
  const p = await matchPerson(input({ applications: [{ jobTitle: "Cook", company: null, location: "Remote" }] }), null, new Map(), cacheFrom([], []) as never);
  assert.match(p.note, /no place in the jobs they shared/);
});

test("a directory that cannot be read says so, never 'nothing matched'", async () => {
  const down = { employers: async () => ({ status: "unavailable", data: [] }), resources: async () => ({ status: "unavailable", data: [] }) };
  const p = await matchPerson(input(), null, new Map(), down as never);
  assert.equal(p.status, "directory_unavailable"); assert.match(p.note, /could not be read/);
});

const depsWith = (rows: ConnectionInputs[], names: { id: string; name: string | null }[] = []): ConnectionDeps => ({
  inputs: async (_a, ids) => ({ ok: true, rows: rows.filter((r) => ids.includes(r.clientId)) }),
  candidates: async () => ({ ok: true, rows: names }),
  employers: async () => ({ status: "ok", data: [pub(E1, "Harbor", "A") as never] }),
  resources: async () => ({ status: "ok", data: [] }),
  known: async () => new Map(),
});

test("one person: refused without view_content or as a platform admin", async () => {
  assert.equal(await getConnectionsFor(actor([]), P1, null, depsWith([input()])), null);
  assert.equal(await getConnectionsFor(actor(["org.client.view_content"], { viaPlatformAdmin: true }), P1, null, depsWith([input()])), null);
  const ok = await getConnectionsFor(actor(["org.client.view_content"]), P1, "Alma Reyes", depsWith([input()]));
  assert.equal(ok?.employers[0]?.name, "Harbor");
});

test("caseload: only people in reach with a match are listed; non-sharers are counted, not named", async () => {
  const P2 = "77777777-7777-4777-8777-777777777777", P3 = "88888888-8888-4888-8888-888888888888";
  const c = await getCaseloadConnections(actor(["org.client.view_content"]), depsWith(
    [input(), input({ clientId: P2, inReach: false }), input({ clientId: P3, applicationsShared: false })],
    [{ id: P1, name: "Alma Reyes" }, { id: P2, name: "Not Mine" }, { id: P3, name: "Quiet Person" }],
  ));
  assert.deepEqual(c?.people.map((p) => p.firstName), ["Alma"]);
  assert.equal(c?.notSharing, 1);
  assert.match(c?.note ?? "", /recorded for each person/);
});

/* --------------------------------------------------- the person's t.ROY -- */

test("t.ROY's summary is capped and keeps only open loose jobs", () => {
  const h: MyHandoff = {
    id: "h1", note: "n".repeat(900), status: "sent", created_at: "2026-10-27T10:00:00Z", seen_at: null, from_name: "Case Manager", org_name: "Lakeshore Works (Demo)",
    items: Array.from({ length: 12 }, (_, i) => ({ id: `i${i}`, kind: "next_step" as const, status: "open" as const, title: `Step ${i}`, why: "w", job_title: null, company: null, location: null, apply_url: null, ref_name: null, step_title: `Step ${i}`, due_on: null, employer_ref: null, resource_ref: null })),
  };
  const s = summarizeForCoach([h], [
    { id: "j1", kind: "job", job_title: "Cook", company: "Diner", body: "Day shift", status: "open", from_name: null, created_at: "2026-10-20" },
    { id: "c1", kind: "comment", job_title: null, company: null, body: "Nice", status: "open", from_name: null, created_at: "2026-10-20" },
  ]);
  assert.equal(s.handoffs[0].note.length, 600);
  assert.equal(s.handoffs[0].items.length, 10);
  assert.equal(s.handoffs[0].opened, false);
  assert.deepEqual(s.jobs.map((j) => j.id), ["j1"]);
  assert.equal(s.openCount, 11);
});

/* ------------------------------------------------------------- migration -- */

const MIG = readFileSync(new URL("../../migrations/110_staff_handoff.sql", import.meta.url), "utf8");

test("110 follows the house pattern", () => {
  assert.match(MIG, /^-- 110_staff_handoff\.sql/);
  assert.match(MIG, /needs an owner with BYPASSRLS/);
  assert.match(MIG, /ALTER TABLE staff_handoff ENABLE ROW LEVEL SECURITY;\s*ALTER TABLE staff_handoff FORCE ROW LEVEL SECURITY;/);
  assert.match(MIG, /CREATE POLICY staff_handoff_reach ON staff_handoff AS RESTRICTIVE FOR ALL/);
  assert.match(MIG, /smr_staff_reach\(access_code_id, NULLIF\(current_setting\('app.user_id', true\), ''\)::uuid, participant_user_id\)/);
  const revoke = MIG.indexOf("REVOKE ALL ON staff_handoff FROM smr_app"), grant = MIG.indexOf("GRANT SELECT, INSERT, UPDATE ON staff_handoff TO smr_app");
  assert.ok(revoke > 0 && grant > revoke, "REVOKE ALL before GRANT");
  assert.ok(!/GRANT[^;]*DELETE[^;]*staff_handoff/.test(MIG), "no DELETE grant");
  assert.match(MIG, /110 after-guard/);
  assert.match(MIG, /SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS \$\$\nDECLARE\n  v_user uuid/, "the step taker pins its search path");
});

test("110 widens org_activity without dropping any entity 102 (or another lane) allows", () => {
  const m = MIG.match(/smr_widen_list_check\('org_activity', 'entity', 'org_activity_entity_check', ARRAY\[([\s\S]*?)\]\)/);
  assert.ok(m);
  const want = [...m![1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]);
  for (const e of ["note", "task", "outcome", "retention", "enrollment", "unit", "staff", "invite", "referral", "custom_field", "view", "sharing", "org", "assignment", "suggestion", "handoff"]) {
    assert.ok(want.includes(e), `keeps ${e}`);
  }
  assert.match(MIG, /have := have \|\| ARRAY/, "values already allowed are kept, so a lane that added its own entity is not undone");
});

test("activity summaries are fixed words: no NEW.note, NEW.body or names in them", () => {
  const fns = MIG.split("CREATE OR REPLACE FUNCTION public.org_activity_").slice(1).map((f) => f.split("$$;")[0]);
  assert.equal(fns.length, 2);
  for (const f of fns) assert.ok(!/NEW\.(note|body|step_title|job_title|company|ref_name|location)/.test(f), "no typed text reaches a summary");
});

test("the person's words for a match: written to them, no staff wording, no record words", async () => {
  const { employerWhyForThem, resourceWhyForThem } = await import("../staffHandoffShared");
  const w = employerWhyForThem({ band: "A", state: "MI" }, { term: "warehouse", from: "Warehouse Associate", source: "applications" }, { state: "MI", city: "Lansing", label: "Lansing, MI" });
  assert.equal(w, 'They hire for warehouse work in MI and have the hiring mark. It fits "Warehouse Associate", a job you saved.');
  assert.equal(resourceWhyForThem({ area_label: "Job help" }, { state: "MI", city: "Lansing", label: "Lansing, MI" }), "Job help for Lansing, MI, near the jobs you saved.");
  const p = await matchPerson(input(), "Alma Reyes", new Map(), cacheFrom([pub(E1, "Harbor", "A")], [res(R1, "Place")]) as never);
  assert.ok(p.employers[0].whyForThem.startsWith("They hire for warehouse work"));
  assert.ok(!/shared with you|staff/i.test(p.employers[0].whyForThem));
  assert.equal(p.resources[0].whyForThem, "Job help for Lansing, MI, near the jobs you saved.");
});

test("review r1: the promise is true, answerSuggestion is loose-only, the search fan-out is bounded and said", async () => {
  assert.match(HANDOFF_PROMISE, /sees whether you opened it, and whether you took or passed on each one/);
  const sharing = readFileSync(new URL("../sharing.ts", import.meta.url), "utf8");
  const ans = sharing.slice(sharing.indexOf("export async function answerSuggestion"));
  assert.match(ans, /kind IN \('job', 'comment'\) AND to_jsonb\(staff_suggestion\)->>'handoff_id' IS NULL/);
  const { searchCache, SEARCH_BUDGET, CAPPED_LINE } = await import("../staffConnections");
  let calls = 0;
  const deps = { employers: async () => { calls++; return { status: "ok", data: [] }; }, resources: async () => { calls++; return { status: "ok", data: [] }; } } as never;
  const c = searchCache(deps, 2);
  await c.employers("a"); await c.employers("a"); await c.employers("b");
  assert.equal((await c.employers("c")).status, "capped");
  assert.equal(calls, 2, "a repeated question is free; past the budget nothing is asked");
  assert.ok(SEARCH_BUDGET.person >= 10 && SEARCH_BUDGET.caseload >= SEARCH_BUDGET.person);
  const many = input({ applications: Array.from({ length: 6 }, (_, i) => ({ jobTitle: `Trade${i} work`, company: null, location: i % 2 ? "Lansing, MI" : "Gary, IN" })) });
  const p = await matchPerson(many, null, new Map(), searchCache({ employers: async () => ({ status: "ok", data: [] }), resources: async () => ({ status: "ok", data: [] }) } as never, 3));
  assert.equal(p.capped, true);
  assert.ok(p.note.endsWith(CAPPED_LINE), "and the note says so");
  const mig = readFileSync(new URL("../../migrations/110_staff_handoff.sql", import.meta.url), "utf8");
  assert.match(mig, /CREATE CONSTRAINT TRIGGER staff_handoff_has_items AFTER INSERT ON staff_handoff\s+DEFERRABLE INITIALLY DEFERRED/);
  assert.match(mig, /CREATE TRIGGER staff_handoff_close_items AFTER UPDATE ON staff_handoff/);
  assert.match(mig, /OLD\.kind = 'next_step' AND NEW\.status = 'saved'/);
});

test("review r2: 110 checks every S5 definer is owned by a BYPASSRLS role", () => {
  const mig = readFileSync(new URL("../../migrations/110_staff_handoff.sql", import.meta.url), "utf8");
  assert.match(mig, /an S5 definer is owned by a role without BYPASSRLS/);
  for (const f of ["smr_accept_handoff_step", "staff_suggestion_item_guard", "staff_handoff_close_items", "staff_handoff_has_items", "org_activity_suggestion", "org_activity_handoff", "staff_handoff_answer_inbox", "staff_handoff_sent_milestone"])
    assert.ok(mig.includes(`'${f}'`), f);
});
