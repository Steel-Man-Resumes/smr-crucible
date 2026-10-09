/**
 * The record check (D11), run through its handlers with fake dependencies:
 * no network, no database, no real AI. Every person, offense and job here is
 * invented.
 *
 * Proves (round 1 + security r1): consent is required, current and revocable;
 * staff cannot consent; every route needs the tier and same-origin JSON for
 * writes; only offense, state and job reach the prompt; the model can only
 * pick ids, so a hostile model's prose is never shown, stored or logged;
 * nothing is stored unless saved, and what was typed only with its own tick;
 * revoke wins races; a stalled model falls back to the plain list; only
 * curated or typed links are shown; UNVERIFIED entries never are.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  handleBuild,
  handleConsentDelete,
  handleConsentGet,
  handleConsentPost,
  handleSavedDelete,
  handleSavedGet,
  handleSavedPost,
  picksFromReply,
  plainPicks,
  renderChecklist,
  type Picks,
  type RecordCheckDeps,
  type SavedFull,
} from "../record-check/handler";
import { RECORD_CHECK_CONSENT_VERSION, RECORD_CHECK_COPY } from "../record-check/copy";
import { MOCK_RECORD_CHECK_REPLY } from "../record-check/mock";
import { buildRecordCheckPrompt } from "../record-check/prompt";
import { findVerdict, hasLinkOrCitation, safeErrorLabel, safeJobSlot } from "../record-check/guard";
import { allCuratedSources, allShowableUrls, isShowable, showableSourcesFor, showableSourceById } from "../record-check/sources";
import { QUESTION_BANK, STEP_BANK, DEFAULT_QUESTION_IDS } from "../record-check/question-bank";
import { STATE_NAMES } from "../record-check/states";
import { isAnalyticsExcluded } from "../analytics-exclusions";

const APP = join(import.meta.dirname, "..", "..");
const UID = "00000000-0000-4000-8000-0000000000d1";

// Invented. The offense and job words are distinctive so any leak is easy to find.
const OFFENSE = "zorbin fraud felony in 2014, two counts";
const JOB = "quillwright apprentice license";
const ACCOUNT_NAME = "Pell Examplestone";
const ACCOUNT_RESUME = "Forklift lead at Corner Depot 2019-2024";

interface Row {
  id: string;
  userId: string;
  state: string;
  picks: Picks;
  typed: { job: string; offense: string } | null;
  createdAt: string;
}

interface World {
  deps: RecordCheckDeps;
  consent: { granted: boolean; version: string | null; grantedAt: string | null };
  grants: string[];
  revokes: number;
  rows: Row[];
  modelCalls: Array<{ system: string; user: string }>;
  decisions: unknown[];
  errors: string[];
}

function world(over: Partial<RecordCheckDeps> = {}, opts: { consented?: boolean; reply?: string; staff?: boolean; tier?: boolean } = {}): World {
  const w: World = {
    consent: opts.consented === false
      ? { granted: false, version: null, grantedAt: null }
      : { granted: true, version: RECORD_CHECK_CONSENT_VERSION, grantedAt: "2026-10-09T15:00:00Z" },
    grants: [],
    revokes: 0,
    rows: [],
    modelCalls: [],
    decisions: [],
    errors: [],
    deps: undefined as unknown as RecordCheckDeps,
  };
  const granted = () => w.consent.granted && w.consent.version === RECORD_CHECK_CONSENT_VERSION;
  w.deps = {
    userId: async () => UID,
    actingForSomeoneElse: async () => !!opts.staff,
    tierAllowed: async () => opts.tier !== false,
    consentStatus: async () => ({ ...w.consent }),
    grantConsent: async (_u, version) => {
      w.grants.push(version);
      w.consent = { granted: true, version, grantedAt: "2026-10-09T16:00:00Z" };
      return { grantedAt: "2026-10-09T16:00:00Z" };
    },
    revokeAndDeleteAll: async (userId) => {
      w.revokes++;
      w.consent = { granted: false, version: w.consent.version, grantedAt: null };
      const before = w.rows.length;
      w.rows = w.rows.filter((r) => r.userId !== userId);
      return { deleted: before - w.rows.length };
    },
    store: {
      // Like the real conditional insert: writes only under the current yes.
      save: async ({ userId, state, picks, typed }) => {
        if (!granted()) return { ok: false, reason: "no_consent" };
        if (w.rows.filter((r) => r.userId === userId).length >= 50) return { ok: false, reason: "cap" };
        const id = `00000000-0000-4000-8000-${String(w.rows.length + 1).padStart(12, "0")}`;
        w.rows.push({ id, userId, state, picks, typed, createdAt: "2026-10-09T16:05:00Z" });
        return { ok: true, id, createdAt: "2026-10-09T16:05:00Z" };
      },
      list: async (userId) =>
        w.rows.filter((r) => r.userId === userId).map((r) => ({ id: r.id, state: r.state, keptTyped: r.typed !== null, createdAt: r.createdAt })),
      get: async (userId, id): Promise<SavedFull | null> => {
        const r = w.rows.find((x) => x.userId === userId && x.id === id);
        return r ? { id: r.id, state: r.state, keptTyped: r.typed !== null, createdAt: r.createdAt, picks: r.picks, typed: r.typed } : null;
      },
      deleteOne: async (userId, id) => {
        const before = w.rows.length;
        w.rows = w.rows.filter((r) => !(r.userId === userId && r.id === id));
        return w.rows.length < before;
      },
    },
    callModel: async (system, user) => {
      w.modelCalls.push({ system, user });
      return opts.reply ?? MOCK_RECORD_CHECK_REPLY;
    },
    mock: false,
    mockReply: MOCK_RECORD_CHECK_REPLY,
    logDecision: async (e) => { w.decisions.push(e); },
    logError: (where, label) => { w.errors.push(`${where}: ${label}`); },
    ...over,
  };
  return w;
}

const SAME_ORIGIN = { "Content-Type": "application/json", "Sec-Fetch-Site": "same-origin" };
function req(path: string, method: string, body?: unknown, headers: Record<string, string> = SAME_ORIGIN) {
  return new Request(`http://localhost${path}`, {
    method,
    headers,
    body: body === undefined ? (method === "GET" ? undefined : "{}") : typeof body === "string" ? body : JSON.stringify(body),
  });
}
const BUILD = { offense: OFFENSE, state: "OH", job: JOB };
const build = (w: World, body: unknown = BUILD) => handleBuild(req("/api/record-check", "POST", body), w.deps);
const get = (path: string) => req(path, "GET");

/** Capture everything the console prints while fn runs. */
async function captureConsole<T>(fn: () => Promise<T>): Promise<{ out: T; printed: string }> {
  const lines: string[] = [];
  const orig = { log: console.log, warn: console.warn, error: console.error, info: console.info };
  for (const k of ["log", "warn", "error", "info"] as const) {
    console[k] = (...a: unknown[]) => { lines.push(a.map((x) => (x instanceof Error ? x.message + x.stack : typeof x === "string" ? x : JSON.stringify(x))).join(" ")); };
  }
  try {
    return { out: await fn(), printed: lines.join("\n") };
  } finally {
    Object.assign(console, orig);
  }
}

function leaks(text: string): string[] {
  const t = text.toLowerCase();
  return ["zorbin", "quillwright", ACCOUNT_NAME.toLowerCase(), "corner depot"].filter((s) => t.includes(s));
}

/** Every line on a checklist must be one of ours, after slot filling. */
function assertAllLinesOurs(c: ReturnType<typeof renderChecklist>) {
  const fill = (t: string, source?: string) =>
    t.replace(/\{state\}/g, c.stateName).replace(/\{job\}/g, c.jobShown).replace(/\{source\}/g, source ?? "");
  const stepTexts = new Set(Object.values(STEP_BANK).map((s) => fill(s.text)));
  for (const s of c.steps) assert.ok(stepTexts.has(s.text), `step not from the bank: ${s.text}`);
  const titles = c.sources.map((s) => s.title);
  for (const q of c.questions) {
    const bank = QUESTION_BANK.find((b) => b.id === q.id);
    assert.ok(bank, `question id not in the bank: ${q.id}`);
    const ok = bank!.text.includes("{source}") ? titles.some((t) => fill(bank!.text, t) === q.text) : fill(bank!.text) === q.text;
    assert.ok(ok, `question text not from the bank: ${q.text}`);
  }
}

// ------------------------------------------------------------------ consent --

test("consent: no yes, no checklist, and no model call", async () => {
  const w = world({}, { consented: false });
  const res = await build(w);
  assert.equal(res.status, 409);
  assert.equal((await res.json()).code, "consent_required");
  assert.equal(w.modelCalls.length, 0);
});

test("consent: a yes given to older words (v1) does not count", async () => {
  const w = world();
  w.consent = { granted: true, version: "2026-10-09-v1", grantedAt: "2026-10-09T00:00:00Z" };
  assert.equal((await build(w)).status, 409);
  assert.equal(w.modelCalls.length, 0);
  assert.equal((await (await handleConsentGet(get("/api/record-check/consent"), w.deps)).json()).granted, false);
});

test("consent: only a ticked box with the current words records a yes, with its time", async () => {
  const w = world({}, { consented: false });
  for (const bad of [{}, { ticked: false, textVersion: RECORD_CHECK_CONSENT_VERSION }, { ticked: "yes", textVersion: RECORD_CHECK_CONSENT_VERSION }]) {
    assert.equal((await handleConsentPost(req("/api/record-check/consent", "POST", bad), w.deps)).status, 400);
  }
  assert.equal((await handleConsentPost(req("/api/record-check/consent", "POST", { ticked: true, textVersion: "2026-10-09-v1" }), w.deps)).status, 409);
  assert.deepEqual(w.grants, []);
  const ok = await handleConsentPost(req("/api/record-check/consent", "POST", { ticked: true, textVersion: RECORD_CHECK_CONSENT_VERSION }), w.deps);
  assert.equal(ok.status, 200);
  assert.match((await ok.json()).grantedAt, /^2026-10-09T/);
  assert.deepEqual(w.grants, [RECORD_CHECK_CONSENT_VERSION]);
  assert.equal((await build(w)).status, 200);
});

test("consent: taking it back deletes saved checklists in one step and stops the step", async () => {
  const w = world();
  const p = plainPicks("OH");
  w.rows.push({ id: "a1", userId: UID, state: "OH", picks: p, typed: { job: JOB, offense: OFFENSE }, createdAt: "" });
  w.rows.push({ id: "a2", userId: UID, state: "MT", picks: p, typed: null, createdAt: "" });
  w.rows.push({ id: "b1", userId: "someone-else", state: "WI", picks: p, typed: null, createdAt: "" });
  const res = await handleConsentDelete(req("/api/record-check/consent", "DELETE"), w.deps);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.revoked, true);
  assert.equal(body.deleted, 2);
  assert.equal(w.revokes, 1);
  assert.deepEqual(w.rows.map((r) => r.id), ["b1"]);
  assert.equal((await build(w)).status, 409);
  const save = await handleSavedPost(req("/api/record-check/saved", "POST", { state: "OH", sourceIds: ["oh-licensing-law"], questionIds: ["q-pre-1"] }), w.deps);
  assert.equal(save.status, 409);
});

test("staff: a staff session acting as the person can neither say yes nor use the step", async () => {
  const w = world({}, { consented: false, staff: true });
  const post = await handleConsentPost(req("/api/record-check/consent", "POST", { ticked: true, textVersion: RECORD_CHECK_CONSENT_VERSION }), w.deps);
  assert.equal(post.status, 403);
  assert.equal((await post.json()).code, "staff_cannot_consent");
  assert.deepEqual(w.grants, []);
  w.consent = { granted: true, version: RECORD_CHECK_CONSENT_VERSION, grantedAt: "x" };
  assert.equal((await build(w)).status, 403);
  assert.equal((await handleSavedGet(get("/api/record-check/saved"), w.deps)).status, 403);
  assert.equal((await handleSavedPost(req("/api/record-check/saved", "POST", {}), w.deps)).status, 403);
  assert.equal((await handleConsentDelete(req("/api/record-check/consent", "DELETE"), w.deps)).status, 403);
  assert.equal(w.modelCalls.length, 0);
  assert.equal(w.revokes, 0);
  assert.equal((await (await handleConsentGet(get("/api/record-check/consent"), w.deps)).json()).staffBlocked, true);
});

test("staff: the general consent route cannot grant the record check layer", () => {
  const src = readFileSync(join(APP, "app/api/consent/route.ts"), "utf8");
  const list = src.match(/const TOGGLEABLE: ConsentLayer\[\] = \[([^\]]*)\]/)?.[1] ?? "";
  assert.ok(list.includes('"enhanced"'), "found the toggleable list");
  assert.ok(!list.includes("record_check"));
});

test("staff: the real dependency treats any impersonation cookie as staff; identity is auth()", () => {
  const src = readFileSync(join(APP, "lib/record-check/deps.ts"), "utf8");
  assert.match(src, /store\.get\(IMPERSONATE_COOKIE\)/);
  assert.ok(!/effectiveAuth/.test(src));
});

// ---------------------------------------------------- tier and origin (F6, F11) --

test("tier: using the step needs the person's tier", async () => {
  const w = world({}, { tier: false, consented: false });
  const calls = [
    handleConsentPost(req("/api/record-check/consent", "POST", { ticked: true, textVersion: RECORD_CHECK_CONSENT_VERSION }), w.deps),
    build(w),
    handleSavedPost(req("/api/record-check/saved", "POST", { state: "OH", sourceIds: ["oh-licensing-law"] }), w.deps),
  ];
  for (const r of await Promise.all(calls)) assert.equal(r.status, 403);
  assert.equal(w.grants.length + w.modelCalls.length + w.rows.length, 0);
});

test("tier: taking back the yes, reading and deleting saved checks never depend on the tier (r2 N2)", async () => {
  const w = world({}, { tier: false });
  const p = plainPicks("OH");
  w.rows.push({ id: "00000000-0000-4000-8000-0000000000e1", userId: UID, state: "OH", picks: p, typed: null, createdAt: "" });
  w.rows.push({ id: "00000000-0000-4000-8000-0000000000e2", userId: UID, state: "OH", picks: p, typed: null, createdAt: "" });
  const status = await handleConsentGet(get("/api/record-check/consent"), w.deps);
  assert.equal(status.status, 200);
  assert.equal((await status.json()).granted, true);
  assert.equal((await handleSavedGet(get("/api/record-check/saved"), w.deps)).status, 200);
  assert.equal((await handleSavedGet(get("/api/record-check/saved?id=00000000-0000-4000-8000-0000000000e1"), w.deps)).status, 200);
  assert.equal((await handleSavedDelete(req("/api/record-check/saved?id=00000000-0000-4000-8000-0000000000e1", "DELETE"), w.deps)).status, 200);
  const rev = await handleConsentDelete(req("/api/record-check/consent", "DELETE"), w.deps);
  assert.equal(rev.status, 200);
  assert.equal((await rev.json()).deleted, 1);
  assert.equal(w.rows.length, 0);
  assert.equal(w.revokes, 1);
  // Staff and origin checks still hold on the withdrawal routes.
  const staff = world({}, { tier: false, staff: true });
  assert.equal((await handleConsentDelete(req("/api/record-check/consent", "DELETE"), staff.deps)).status, 403);
  assert.equal((await handleConsentDelete(req("/api/record-check/consent", "DELETE", "{}", { "Content-Type": "text/plain" }), world({}, { tier: false }).deps)).status, 403);
});

test("origin: every write must be same-origin JSON; a form post or a sibling site is refused", async () => {
  const bad: Array<Record<string, string>> = [
    { "Content-Type": "text/plain", "Sec-Fetch-Site": "same-origin" }, // HTML form enctype=text/plain
    { "Content-Type": "application/x-www-form-urlencoded" },
    { "Content-Type": "application/json", "Sec-Fetch-Site": "same-site" }, // another steelmanresumes.com host
    { "Content-Type": "application/json", "Sec-Fetch-Site": "cross-site" },
    { "Content-Type": "application/json", Origin: "https://evil.example" },
  ];
  for (const h of bad) {
    const w = world({}, { consented: false });
    const consent = await handleConsentPost(req("/api/record-check/consent", "POST", { ticked: true, textVersion: RECORD_CHECK_CONSENT_VERSION }, h), w.deps);
    assert.equal(consent.status, 403, JSON.stringify(h));
    w.consent = { granted: true, version: RECORD_CHECK_CONSENT_VERSION, grantedAt: "x" };
    assert.equal((await handleBuild(req("/api/record-check", "POST", BUILD, h), w.deps)).status, 403);
    assert.equal((await handleSavedPost(req("/api/record-check/saved", "POST", { state: "OH", sourceIds: ["oh-licensing-law"] }, h), w.deps)).status, 403);
    assert.equal((await handleConsentDelete(req("/api/record-check/consent", "DELETE", "{}", h), w.deps)).status, 403);
    assert.equal((await handleSavedDelete(req("/api/record-check/saved?id=00000000-0000-4000-8000-000000000001", "DELETE", "{}", h), w.deps)).status, 403);
    assert.deepEqual(w.grants, []);
    assert.equal(w.revokes + w.modelCalls.length + w.rows.length, 0);
  }
  // Reads from a sibling site are refused too.
  const w = world();
  assert.equal((await handleSavedGet(req("/api/record-check/saved", "GET", undefined, { "Sec-Fetch-Site": "same-site" }), w.deps)).status, 403);
  assert.equal((await handleConsentGet(req("/api/record-check/consent", "GET", undefined, { "Sec-Fetch-Site": "cross-site" }), w.deps)).status, 403);
});

test("origin: the page sends JSON on every write, DELETE included", () => {
  const src = readFileSync(join(APP, "app/(dashboard)/dashboard/record-check/page.tsx"), "utf8");
  const fetches = Array.from(src.matchAll(/fetch\(([^;]*?)\)\s*;/g)).map((m) => m[1]);
  const writes = fetches.filter((f) => /method: "(POST|DELETE)"/.test(f));
  assert.ok(writes.length >= 5, `found ${writes.length} writes`);
  for (const f of writes) assert.match(f, /headers: JSON_HEADERS/, f);
});

// ---------------------------------------------------------- minimum data --

test("minimum data: any field beyond offense, state and job is refused before the model", async () => {
  for (const extra of [{ name: ACCOUNT_NAME }, { resume: ACCOUNT_RESUME }, { recordAnswers: { type: "felony" } }, { forgeContext: {} }]) {
    const w = world();
    assert.equal((await build(w, { ...BUILD, ...extra })).status, 400, JSON.stringify(extra));
    assert.equal(w.modelCalls.length, 0);
  }
});

test("minimum data: the prompt carries the three typed fields, our lists, and nothing else", async () => {
  const w = world();
  assert.equal((await build(w)).status, 200);
  assert.equal(w.modelCalls.length, 1);
  const sent = w.modelCalls[0].system + "\n" + w.modelCalls[0].user;
  assert.ok(sent.includes(OFFENSE) && sent.includes(JOB) && sent.includes("Ohio"));
  assert.ok(!sent.includes(ACCOUNT_NAME) && !sent.includes("Corner Depot"));
  const p = buildRecordCheckPrompt({ ...BUILD, name: ACCOUNT_NAME, resume: ACCOUNT_RESUME } as never);
  assert.ok(!p.user.includes(ACCOUNT_NAME) && !p.user.includes("Corner Depot"));
  const src = readFileSync(join(APP, "lib/record-check/prompt.ts"), "utf8");
  const imports = Array.from(src.matchAll(/from "([^"]+)"/g)).map((m) => m[1]).sort();
  assert.deepEqual(imports, ["./question-bank", "./sources", "./states", "@/lib/sanitize"]);
});

test("minimum data: the page sends exactly offense, state and job, and nothing to browser storage", () => {
  const src = readFileSync(join(APP, "app/(dashboard)/dashboard/record-check/page.tsx"), "utf8");
  assert.match(src, /body: JSON\.stringify\(\{ offense, state: stateCode, job \}\)/);
  assert.ok(!/localStorage|sessionStorage/.test(src.replace(/\/\*[\s\S]*?\*\//g, "")));
});

test("minimum data: bad or missing fields are refused", async () => {
  for (const b of [{ ...BUILD, state: "XX" }, { ...BUILD, offense: "" }, { ...BUILD, job: " " }, { ...BUILD, offense: "x".repeat(301) }]) {
    const w = world();
    assert.equal((await build(w, b)).status, 400);
    assert.equal(w.modelCalls.length, 0);
  }
});

// ----------------------------------------------- the model only picks (F1, F8) --

// A hostile model: verdict prose everywhere it could put it, links, statutes,
// the person's own words, and ids that do not exist.
const HOSTILE_PROSE = [
  "You are barred from this license for life.",
  "Good news: with your record you may qualify, most people like you get licensed.",
  "Drug crimes bar you from a CDL for life.",
  "This will not affect your license.",
  "You won't have any trouble getting this license.",
  "Your chances are good.",
  "Read https://example.com/made-up-law and Ohio Revised Code 4776.04.",
  "Visit bit.ly/abc123",
  "Your zorbin fraud record is no problem.",
];
const HOSTILE_REPLY = `Sure! ${HOSTILE_PROSE[0]} ${JSON.stringify({
  source_ids: ["oh-predetermination", "made-up-id", "mt-licensing-board", HOSTILE_PROSE[1], "oh-sealing-help"],
  question_ids: ["q-pre-1", HOSTILE_PROSE[2], "q-made-up", "q-appeal-1"],
  steps: HOSTILE_PROSE.map((text) => ({ text, source_ids: [] })),
  questions: HOSTILE_PROSE,
  summary: HOSTILE_PROSE.join(" "),
  verdict: "You qualify.",
})} ${HOSTILE_PROSE[3]}`;

test("hostile model: none of its prose is shown, stored or logged; only our lines appear", async () => {
  const w = world({}, { reply: HOSTILE_REPLY });
  const { out, printed } = await captureConsole(() => build(w));
  assert.equal(out.status, 200);
  const raw = await out.text();
  const c = JSON.parse(raw).checklist;
  const lower = raw.toLowerCase();
  for (const p of [...HOSTILE_PROSE, "You qualify."]) {
    assert.ok(!raw.includes(p), `shown: ${p}`);
  }
  for (const frag of ["barred", "qualify", "trouble", "chances", "example.com", "bit.ly", "4776", "zorbin", "most people like you"]) {
    assert.ok(!lower.includes(frag), `fragment reached the page: ${frag}`);
  }
  assertAllLinesOurs(c);
  assert.equal(c.generatedBy, "ai");
  assert.deepEqual(c.picks.questionIds.slice(0, 2), ["q-pre-1", "q-appeal-1"]);
  assert.ok(c.picks.sourceIds.includes("oh-predetermination") && !c.picks.sourceIds.includes("made-up-id") && !c.picks.sourceIds.includes("mt-licensing-board"));
  // Saved: the stored row holds ids and the state only.
  const saved = await handleSavedPost(req("/api/record-check/saved", "POST", { state: "OH", ...c.picks, v: undefined }), w.deps);
  assert.equal(saved.status, 200);
  assert.equal(w.rows.length, 1);
  assert.equal(w.rows[0].typed, null);
  const stored = JSON.stringify(w.rows);
  for (const frag of ["barred", "qualify", "zorbin", "quillwright", "example.com"]) assert.ok(!stored.toLowerCase().includes(frag), frag);
  // Logged: counts only.
  const logged = JSON.stringify(w.decisions) + w.errors.join("\n") + printed;
  for (const frag of ["barred", "qualify", "zorbin", "quillwright"]) assert.ok(!logged.toLowerCase().includes(frag), frag);
});

test("hostile model: pure prose, or no valid ids, gives the fixed plain checklist", () => {
  for (const reply of [HOSTILE_PROSE.join(" "), "{}", JSON.stringify({ source_ids: ["nope"], question_ids: ["You qualify"] }), "not json", null]) {
    const { picks } = picksFromReply("MT", reply);
    assert.equal(picks.generatedBy, "plain");
    assert.deepEqual(picks, plainPicks("MT"));
    const c = renderChecklist("MT", picks, { job: JOB });
    assertAllLinesOurs(c);
    assert.ok(c.steps.length >= 4 && c.questions.length >= 4);
    assert.ok(c.sources.some((s) => s.id === "mt-licensing-law"));
  }
});

test("hostile model: a model asked to pick from another state gets nothing from it", () => {
  const { picks } = picksFromReply("WI", JSON.stringify({ source_ids: ["oh-predetermination", "wi-hiring-law"], question_ids: ["q-pre-1"] }));
  assert.ok(!picks.sourceIds.includes("oh-predetermination"));
  assert.ok(picks.sourceIds.includes("wi-hiring-law"));
});

test("slots: a typed job with {source}, {state} or $ patterns renders literally (r2 N3)", async () => {
  const job = "teacher {source} {state} $& $` $' $$ x";
  const w = world();
  const c = (await (await build(w, { ...BUILD, job })).json()).checklist;
  assert.equal(c.jobShown, job);
  assert.equal(c.steps[0].text, `Find the licensing board for ${job} in Ohio. Look for its page about records.`);
  const q = c.questions.find((x: { id: string }) => x.id === "q-weigh-1");
  assert.equal(q.text, `Which parts of a record does the board look at for ${job}?`);
  // And a source title with "$" in it would also go in literally.
  const { fill } = await import("../record-check/handler");
  assert.equal(fill("Is {source} the rule?", { state: "Ohio", job: "x", source: "Code $& 9" }), "Is Code $& 9 the rule?");
  assert.equal(fill("{job} in {state}", { state: "Ohio", job: "{state}" }), "{state} in Ohio");
});

test("slot backstop: a job that reads like a verdict, a link or a statute becomes 'this work'", () => {
  for (const job of ["you qualify license", "barred barber", "bit.ly/abc job", "Ohio Revised Code 4776.04", "x".repeat(81), "", "w​ww.example.com"]) {
    assert.equal(safeJobSlot(job), "this work", job);
  }
  assert.equal(safeJobSlot("barber license"), "barber license");
  assert.equal(safeJobSlot("CDL driver https://board.example.org/x"), "CDL driver");
  // Normalization: a zero-width space or full-width letters do not slip past.
  assert.ok(findVerdict("you q​ualify".replace("​", "​")) || findVerdict("ｑｕａｌｉｆｙ"));
  assert.ok(hasLinkOrCitation("ohio․gov") && hasLinkOrCitation("hxxps://evil[.]example/claim"));
});

// ------------------------------------------------------------ the bank --

const DENY = [
  "you are barred", "you're barred", "you are disqualified", "you qualify", "you do not qualify", "you don't qualify",
  "you are eligible", "you're eligible", "not eligible", "will not block", "won't block", "will block you",
  "no problem", "guarantee", "automatically", "you will get", "you can't get", "you cannot get", "will be denied",
  "your chances", "most people", "felon",
];

test("bank: 25+ plain first-person questions on every topic, never a verdict, no links or statutes", () => {
  assert.ok(QUESTION_BANK.length >= 25, `${QUESTION_BANK.length}`);
  const topics = new Set(QUESTION_BANK.map((q) => q.topic));
  for (const t of ["predetermination", "board_weighs", "time_since", "rehabilitation", "appeal", "record_relief"]) assert.ok(topics.has(t as never), t);
  const ids = QUESTION_BANK.map((q) => q.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const q of QUESTION_BANK) {
    const t = q.text.toLowerCase().replace(/’/g, "'");
    assert.ok(q.text.trim().endsWith("?"), q.id);
    for (const d of DENY) assert.ok(!t.includes(d), `${q.id}: ${d}`);
    assert.ok(!hasLinkOrCitation(q.text.replace(/\{\w+\}/g, "")), q.id);
    assert.ok(!/—|--/.test(q.text), q.id);
    assert.ok(!/\{(?!state\}|job\}|source\})/.test(q.text), `${q.id}: unknown slot`);
  }
  for (const s of Object.values(STEP_BANK)) {
    const t = s.text.toLowerCase();
    for (const d of DENY) assert.ok(!t.includes(d), `${s.id}: ${d}`);
    assert.ok(!hasLinkOrCitation(s.text.replace(/\{\w+\}/g, "")), s.id);
  }
  for (const id of DEFAULT_QUESTION_IDS) assert.ok(QUESTION_BANK.some((q) => q.id === id), id);
});

// -------------------------------------------------------------- storage (F2) --

test("storage: building a checklist stores nothing", async () => {
  const w = world();
  const res = await build(w);
  assert.equal(w.rows.length, 0);
  assert.equal(res.headers.get("cache-control"), "no-store");
});

test("storage: a default save keeps the state and ids only; typed text only with the keep box", async () => {
  const w = world();
  const c = (await (await build(w)).json()).checklist;
  const ids = { state: "OH", sourceIds: c.picks.sourceIds, questionIds: c.picks.questionIds, generatedBy: c.picks.generatedBy };
  // Not ticked: the client may not send typed text at all.
  assert.equal((await handleSavedPost(req("/api/record-check/saved", "POST", { ...ids, job: JOB }), w.deps)).status, 400);
  assert.equal((await handleSavedPost(req("/api/record-check/saved", "POST", { ...ids, offense: OFFENSE }), w.deps)).status, 400);
  let r = await handleSavedPost(req("/api/record-check/saved", "POST", ids), w.deps);
  assert.equal(r.status, 200);
  assert.equal((await r.json()).saved.keptTyped, false);
  assert.equal(w.rows[0].typed, null);
  assert.ok(!/zorbin|quillwright/i.test(JSON.stringify(w.rows[0])), "'Did not keep what you typed' is true");
  // Ticked: kept.
  r = await handleSavedPost(req("/api/record-check/saved", "POST", { ...ids, keepTyped: true, job: JOB, offense: OFFENSE }), w.deps);
  assert.equal(r.status, 200);
  assert.deepEqual(w.rows[1].typed, { job: JOB, offense: OFFENSE });
  // Ticked with nothing typed: refused.
  assert.equal((await handleSavedPost(req("/api/record-check/saved", "POST", { ...ids, keepTyped: true }), w.deps)).status, 400);
  // Unknown ids are dropped; nothing valid left means nothing to save.
  assert.equal((await handleSavedPost(req("/api/record-check/saved", "POST", { state: "OH", sourceIds: ["evil"], questionIds: ["You qualify"] }), w.deps)).status, 400);
});

test("storage: the list never carries typed text; opening one does, only where kept", async () => {
  const w = world();
  const p = plainPicks("OH");
  const first = await handleSavedPost(req("/api/record-check/saved", "POST", { state: "OH", sourceIds: p.sourceIds, questionIds: p.questionIds, keepTyped: true, job: JOB, offense: OFFENSE }), w.deps);
  assert.equal(first.status, 200);
  await handleSavedPost(req("/api/record-check/saved", "POST", { state: "OH", sourceIds: p.sourceIds, questionIds: p.questionIds }), w.deps);
  const listRaw = await (await handleSavedGet(get("/api/record-check/saved"), w.deps)).text();
  assert.deepEqual(leaks(listRaw), []);
  const list = JSON.parse(listRaw).saved;
  assert.deepEqual(list.map((s: { keptTyped: boolean }) => s.keptTyped), [true, false]);
  const kept = await (await handleSavedGet(get(`/api/record-check/saved?id=${list[0].id}`), w.deps)).json();
  assert.equal(kept.saved.typed.offense, OFFENSE);
  assert.equal(kept.saved.checklist.jobShown, JOB);
  const notKept = await (await handleSavedGet(get(`/api/record-check/saved?id=${list[1].id}`), w.deps)).json();
  assert.equal(notKept.saved.typed, null);
  assert.equal(notKept.saved.checklist.jobShown, "this work");
  assertAllLinesOurs(notKept.saved.checklist);
  assert.equal((await handleSavedDelete(req(`/api/record-check/saved?id=${list[0].id}`, "DELETE"), w.deps)).status, 200);
  assert.equal(w.rows.length, 1);
});

test("storage: an unreadable saved check is reported, not a crash", async () => {
  const w = world({ store: { ...world().deps.store, get: async () => "unreadable" as const } });
  const r = await handleSavedGet(get("/api/record-check/saved?id=00000000-0000-4000-8000-000000000001"), w.deps);
  assert.equal(r.status, 422);
  assert.equal((await r.json()).code, "unreadable");
});

test("storage: 50 saved checks is the cap, with a friendly message (F10)", async () => {
  const w = world();
  const p = plainPicks("OH");
  for (let i = 0; i < 50; i++) w.rows.push({ id: `r${i}`, userId: UID, state: "OH", picks: p, typed: null, createdAt: "" });
  const r = await handleSavedPost(req("/api/record-check/saved", "POST", { state: "OH", sourceIds: p.sourceIds }), w.deps);
  assert.equal(r.status, 409);
  const b = await r.json();
  assert.equal(b.code, "cap");
  assert.equal(b.error, RECORD_CHECK_COPY.capReached);
});

test("storage: export and delete-my-data both cover saved record checks", () => {
  const exp = readFileSync(join(APP, "app/api/user/export-data/route.ts"), "utf8");
  assert.match(exp, /const \{ checks, unreadable \} = await exportRecordChecks\(userId\)/);
  const del = readFileSync(join(APP, "app/api/user/delete-data/route.ts"), "utf8");
  assert.match(del, /await deleteAllRecordChecks\(userId\);/);
  assert.match(readFileSync(join(APP, "app/(dashboard)/dashboard/settings/page.tsx"), "utf8"), /key: "record_check"/);
});

// ------------------------------------------------------------- races (F5) --

test("race: revoke during a build cancels it and nothing comes back", async () => {
  let started!: () => void;
  const begun = new Promise<void>((r) => (started = r));
  const w = world({
    callModel: (_s, _u, _id, signal) =>
      new Promise<string>((_resolve, reject) => {
        started();
        signal.addEventListener("abort", () => reject(new Error(`aborted ${String(signal.reason)}`)));
      }),
  });
  const pending = build(w);
  await begun;
  const rev = await handleConsentDelete(req("/api/record-check/consent", "DELETE"), w.deps);
  assert.equal((await rev.json()).cancelled, 1);
  const res = await pending;
  assert.equal(res.status, 409);
  assert.ok(!(await res.text()).includes("checklist"));
  assert.ok(w.errors.some((e) => e === "build: aborted_revoked"), w.errors.join());
});

test("race: a revoke elsewhere while the model runs discards the result", async () => {
  const w = world();
  w.deps.callModel = async () => {
    w.consent = { granted: false, version: RECORD_CHECK_CONSENT_VERSION, grantedAt: null }; // another instance revoked
    return MOCK_RECORD_CHECK_REPLY;
  };
  const res = await build(w);
  assert.equal(res.status, 409);
  assert.equal(w.decisions.length, 0);
});

test("race: the save write itself requires the current yes (no row after revoke)", async () => {
  const w = world();
  const p = plainPicks("OH");
  const realSave = w.deps.store.save;
  w.deps.store.save = async (args) => {
    await handleConsentDelete(req("/api/record-check/consent", "DELETE"), w.deps); // lands between gate and write
    return realSave(args);
  };
  const r = await handleSavedPost(req("/api/record-check/saved", "POST", { state: "OH", sourceIds: p.sourceIds }), w.deps);
  assert.equal(r.status, 409);
  assert.equal(w.rows.length, 0);
  const core = readFileSync(join(APP, "../../packages/core/src/recordCheck.ts"), "utf8");
  assert.match(core, /WHERE EXISTS \(SELECT 1 FROM consumer_consent c[\s\S]*?FOR SHARE\)/);
});

test("timeout: a stalled model falls back to the plain checklist (F11)", async () => {
  const w = world({
    timeoutMs: 30,
    callModel: (_s, _u, _id, signal) =>
      new Promise<string>((_resolve, reject) => signal.addEventListener("abort", () => reject(new Error("aborted")))),
  });
  const res = await build(w);
  assert.equal(res.status, 200);
  const c = (await res.json()).checklist;
  assert.equal(c.generatedBy, "plain");
  assert.deepEqual(w.errors, ["build: aborted_timeout"]);
});

// ------------------------------------------------------------------ logs --

test("logs: a provider error that echoes the offense is logged as a fixed label only", async () => {
  const w = world({ callModel: async () => { throw new Error(`Anthropic API error: 400 {"error":"bad input: ${OFFENSE} for ${JOB}"}`); } });
  const { out, printed } = await captureConsole(() => build(w));
  assert.equal(out.status, 200);
  assert.equal((await out.json()).checklist.generatedBy, "plain");
  assert.deepEqual(w.errors, ["build: provider_error_400"]);
  assert.deepEqual(leaks(printed + w.errors.join("\n")), []);
});

test("logs: the decision log gets counts only: no state, nothing typed (F7)", async () => {
  const w = world();
  await build(w);
  assert.equal(w.decisions.length, 1);
  const d = JSON.stringify(w.decisions[0]);
  assert.deepEqual(leaks(d), []);
  assert.ok(!/"OH"|Ohio|felony|state/.test(d), d);
  const src = readFileSync(join(APP, "lib/record-check/deps.ts"), "utf8");
  assert.match(src, /input: "record-check",/);
  assert.match(src, /anthropicOnly: true/);
  const route = readFileSync(join(APP, "app/api/record-check/route.ts"), "utf8");
  assert.match(route, /partnerUsageWithoutUser: true/);
  const rl = readFileSync(join(APP, "lib/withRateLimit.ts"), "utf8");
  assert.match(rl, /\.\.\.\(opts\.partnerUsageWithoutUser \? \{\} : \{ userId \}\)/);
});

test("logs: a bad body is refused without printing it", async () => {
  const w = world();
  const { out, printed } = await captureConsole(() => build(w, `{"offense":"${OFFENSE}", oops`));
  assert.equal(out.status, 400);
  assert.deepEqual(leaks(printed), []);
});

test("logs: safeErrorLabel keeps typed words out", () => {
  assert.equal(safeErrorLabel(new Error(`Anthropic API error: 529 overloaded ${OFFENSE}`)), "provider_error_529");
  assert.equal(safeErrorLabel(new Error(`Unexpected token z, "${OFFENSE}" is not valid JSON`)), "error");
  assert.equal(safeErrorLabel(OFFENSE), "error");
});

test("logs: the whole happy path prints nothing typed", async () => {
  const w = world({}, { consented: false });
  const { printed } = await captureConsole(async () => {
    await handleConsentPost(req("/api/record-check/consent", "POST", { ticked: true, textVersion: RECORD_CHECK_CONSENT_VERSION }), w.deps);
    const c = (await (await build(w)).json()).checklist;
    await handleSavedPost(req("/api/record-check/saved", "POST", { state: "OH", ...c.picks, v: undefined, keepTyped: true, job: JOB, offense: OFFENSE }), w.deps);
    await handleSavedGet(get("/api/record-check/saved"), w.deps);
    await handleConsentDelete(req("/api/record-check/consent", "DELETE"), w.deps);
  });
  assert.deepEqual(leaks(printed), []);
});

// --------------------------------------------------------------- sources --

test("sources: only curated or typed links are ever shown", async () => {
  const allowed = allShowableUrls();
  const typed = "https://board.example.org/apply";
  for (const [job, extra] of [[JOB, null], [`${JOB} ${typed}`, typed]] as const) {
    const w = world({}, { reply: HOSTILE_REPLY });
    const c = (await (await build(w, { ...BUILD, job })).json()).checklist;
    const urls = Array.from(JSON.stringify(c).matchAll(/https?:\/\/[^"\s)]+/g)).map((m) => m[0]);
    assert.ok(urls.length > 0);
    for (const u of urls) assert.ok(allowed.has(u) || u === extra, `not curated: ${u}`);
    if (extra) assert.equal(c.sources.filter((s: { from: string }) => s.from === "you").length, 1);
    for (const s of c.steps) for (const id of s.sourceIds) assert.ok(showableSourceById(id), id);
  }
});

test("sources: UNVERIFIED entries are never shown, from the list, the model, or a saved check", () => {
  const unverified = allCuratedSources().filter((e) => e.status === "UNVERIFIED");
  assert.ok(unverified.length >= 5);
  for (const e of unverified) {
    assert.equal(e.url, null, `${e.id} has no url`);
    assert.equal(showableSourceById(e.id), null);
    assert.equal(isShowable({ ...e, url: "https://example.gov/x", as_of: "2026-10-09" }), false, e.id);
  }
  for (const state of Object.keys(STATE_NAMES)) for (const s of showableSourcesFor(state)) assert.ok(!unverified.some((u) => u.id === s.id));
  const view = renderChecklist("MT", { v: 2, sourceIds: ["mt-licensing-board", "mt-predetermination", "mt-licensing-law"], questionIds: ["q-pre-1"], generatedBy: "ai" });
  assert.deepEqual(view.sources.map((s) => s.id), ["mt-licensing-law"]);
});

test("sources: every shown entry is https, dated and labeled; copies are tagged reference copy", () => {
  const showable = allCuratedSources().filter((e) => e.status === "verify_before_relying");
  assert.ok(showable.length >= 30);
  for (const e of showable) {
    assert.match(e.url ?? "", /^https:\/\//, e.id);
    assert.match(e.as_of ?? "", /^\d{4}-\d{2}-\d{2}$/, e.id);
    assert.equal(showableSourceById(e.id)?.label, "Verify before relying");
    if (/law\.cornell\.edu|bonds4jobs\.com/.test(e.url ?? "")) assert.equal(e.kind, "reference_copy", e.id);
  }
  for (const st of ["MT", "WI", "MI", "MO", "OH"]) assert.ok(showableSourcesFor(st).some((s) => !s.id.startsWith("us-")), st);
  const ids = allCuratedSources().map((e) => e.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.match(RECORD_CHECK_COPY.sourcesNote, /plus any link you typed/);
});

// ------------------------------------------------------------------ copy --

test("copy: the consent says what is sent, to whom, how long (provider terms), and that it can stop", () => {
  const c = RECORD_CHECK_COPY;
  assert.equal(RECORD_CHECK_CONSENT_VERSION, "2026-10-09-v2");
  assert.match(c.whatIsSent, /Anthropic/);
  assert.match(c.whatIsSent, /Not your name, not your resume, not your other answers/);
  assert.match(c.howLong, /only while this page is open/);
  assert.match(c.howLong, /What you typed is kept only if you also tick the box/);
  assert.match(c.howLong, /Anthropic deletes it within 30 days\. If their safety systems flag it, or the law requires it, they can keep it longer, up to 2 years for flagged content\./);
  assert.match(c.yourChoice, /stop any time/);
  assert.match(c.yourChoice, /Staff who help you cannot say yes for you/);
  assert.equal(c.keepOffenseLabel, "Keep what I typed (your record and the job)");
  assert.match(c.offenseHint, /broadly/);
  for (const v of Object.values(c)) {
    assert.ok(!/—|--/.test(v), `dash in: ${v}`);
    assert.ok(!/\bfelon\b/i.test(v));
  }
});

test("copy: the 'only if' lines say the record check is the only screen that asks (F9)", () => {
  const sec = readFileSync(join(APP, "components/SecurityContent.tsx"), "utf8").replace(/\s+/g, " ");
  assert.match(sec, /only screen that asks for your offense/);
  assert.match(sec, /If you type your record somewhere else, like the chat or the disclosure planner, the AI sees it there too/);
  assert.match(sec, /up to 2 years for flagged content/);
  assert.match(sec, /every line the person sees is ours, apart from the job and any link the person typed/);
  const log = readFileSync(join(APP, "../../CHANGELOG.md"), "utf8").replace(/\s+/g, " ");
  assert.match(log, /written by us, apart from the job and any link the person typed themselves/);
  assert.ok(!/goes to the AI only if you choose the record check/.test(sec));
  const tr = readFileSync(join(APP, "lib/assistant-prompt.ts"), "utf8");
  assert.match(tr, /only screen that asks for your exact offense/);
  const pa = readFileSync(join(APP, "app/(forge)/partner/page.tsx"), "utf8");
  assert.match(pa, /only screen that asks a client for their offense/);
});

test("analytics never load on the record check page", () => {
  assert.equal(isAnalyticsExcluded("/dashboard/record-check"), true);
});
