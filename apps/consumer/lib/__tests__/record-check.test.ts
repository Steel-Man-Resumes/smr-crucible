/**
 * The record check (D11), run through its handlers with fake dependencies:
 * no network, no database, no real AI. Every person, offense and job here is
 * invented.
 *
 * Proves: consent is required, current and revocable; staff cannot consent;
 * only offense, state and job are accepted and reach the prompt; nothing is
 * stored unless saved, and the offense only with its own tick; nothing typed
 * reaches the decision log or the error log; verdict lines never reach the
 * page; only curated or typed links are shown; UNVERIFIED entries never are.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  buildChecklist,
  handleBuild,
  handleConsentDelete,
  handleConsentGet,
  handleConsentPost,
  handleSavedDelete,
  handleSavedGet,
  handleSavedPost,
  renderChecklist,
  type RecordCheckDeps,
  type SavedRow,
  type StoredChecklist,
} from "../record-check/handler";
import { RECORD_CHECK_CONSENT_VERSION, RECORD_CHECK_COPY } from "../record-check/copy";
import { MOCK_RECORD_CHECK_REPLY } from "../record-check/mock";
import { buildRecordCheckPrompt } from "../record-check/prompt";
import { findVerdict, safeErrorLabel, scrubForLog } from "../record-check/guard";
import { allCuratedSources, allShowableUrls, isShowable, showableSourcesFor, showableSourceById } from "../record-check/sources";
import { STATE_NAMES } from "../record-check/states";
import { isAnalyticsExcluded } from "../analytics-exclusions";

const APP = join(import.meta.dirname, "..", "..");

// Invented. The offense words are distinctive so any leak is easy to find.
const OFFENSE = "zorbin fraud felony in 2014, two counts";
const JOB = "quillwright apprentice license";
const ACCOUNT_NAME = "Pell Examplestone";
const ACCOUNT_RESUME = "Forklift lead at Corner Depot 2019-2024";

interface World {
  deps: RecordCheckDeps;
  consent: { granted: boolean; version: string | null; grantedAt: string | null };
  grants: string[];
  revokes: number;
  rows: Array<SavedRow & { userId: string }>;
  modelCalls: Array<{ system: string; user: string }>;
  decisions: unknown[];
  errors: string[];
}

function world(over: Partial<RecordCheckDeps> = {}, opts: { consented?: boolean; reply?: string; staff?: boolean } = {}): World {
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
  w.deps = {
    userId: async () => "00000000-0000-4000-8000-0000000000d1",
    actingForSomeoneElse: async () => !!opts.staff,
    consentStatus: async () => ({ ...w.consent }),
    grantConsent: async (_u, version) => {
      w.grants.push(version);
      w.consent = { granted: true, version, grantedAt: "2026-10-09T16:00:00Z" };
      return { grantedAt: "2026-10-09T16:00:00Z" };
    },
    revokeConsent: async () => {
      w.revokes++;
      w.consent = { granted: false, version: w.consent.version, grantedAt: null };
    },
    store: {
      save: async ({ userId, state, job, checklist, offense }) => {
        const id = `00000000-0000-4000-8000-${String(w.rows.length + 1).padStart(12, "0")}`;
        w.rows.push({ id, userId, state, job, checklist, offense, createdAt: "2026-10-09T16:05:00Z" });
        return { id, createdAt: "2026-10-09T16:05:00Z" };
      },
      list: async (userId) => w.rows.filter((r) => r.userId === userId),
      deleteOne: async (userId, id) => {
        const before = w.rows.length;
        w.rows = w.rows.filter((r) => !(r.userId === userId && r.id === id));
        return w.rows.length < before;
      },
      deleteAll: async (userId) => {
        const before = w.rows.length;
        w.rows = w.rows.filter((r) => r.userId !== userId);
        return before - w.rows.length;
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

function req(path: string, method: string, body?: unknown) {
  return new Request(`http://localhost${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
  });
}
const BUILD = { offense: OFFENSE, state: "OH", job: JOB };

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
  return ["zorbin", "quillwright", OFFENSE.toLowerCase(), ACCOUNT_NAME.toLowerCase(), "corner depot"].filter((s) => t.includes(s));
}

// ------------------------------------------------------------------ consent --

test("consent: no yes, no checklist, and no model call", async () => {
  const w = world({}, { consented: false });
  const res = await handleBuild(req("/api/record-check", "POST", BUILD), w.deps);
  assert.equal(res.status, 409);
  assert.equal((await res.json()).code, "consent_required");
  assert.equal(w.modelCalls.length, 0);
});

test("consent: a yes given to older words does not count", async () => {
  const w = world();
  w.consent = { granted: true, version: "2026-01-01-v0", grantedAt: "2026-01-01T00:00:00Z" };
  const res = await handleBuild(req("/api/record-check", "POST", BUILD), w.deps);
  assert.equal(res.status, 409);
  assert.equal(w.modelCalls.length, 0);
  const g = await (await handleConsentGet(w.deps)).json();
  assert.equal(g.granted, false);
});

test("consent: only a ticked box with the current words records a yes, with its time", async () => {
  const w = world({}, { consented: false });
  for (const bad of [{}, { ticked: false, textVersion: RECORD_CHECK_CONSENT_VERSION }, { ticked: "yes", textVersion: RECORD_CHECK_CONSENT_VERSION }]) {
    const r = await handleConsentPost(req("/api/record-check/consent", "POST", bad), w.deps);
    assert.equal(r.status, 400);
  }
  const old = await handleConsentPost(req("/api/record-check/consent", "POST", { ticked: true, textVersion: "old" }), w.deps);
  assert.equal(old.status, 409);
  assert.deepEqual(w.grants, []);
  const ok = await handleConsentPost(req("/api/record-check/consent", "POST", { ticked: true, textVersion: RECORD_CHECK_CONSENT_VERSION }), w.deps);
  assert.equal(ok.status, 200);
  const body = await ok.json();
  assert.equal(body.granted, true);
  assert.match(body.grantedAt, /^2026-10-09T/);
  assert.deepEqual(w.grants, [RECORD_CHECK_CONSENT_VERSION]);
  assert.equal((await handleBuild(req("/api/record-check", "POST", BUILD), w.deps)).status, 200);
});

test("consent: taking it back deletes saved checklists and stops the step", async () => {
  const w = world();
  // Two saved, one for someone else.
  w.rows.push({ id: "00000000-0000-4000-8000-0000000000a1", userId: "00000000-0000-4000-8000-0000000000d1", state: "OH", job: "x", checklist: {}, offense: OFFENSE, createdAt: "" });
  w.rows.push({ id: "00000000-0000-4000-8000-0000000000a2", userId: "00000000-0000-4000-8000-0000000000d1", state: "MT", job: "y", checklist: {}, offense: null, createdAt: "" });
  w.rows.push({ id: "00000000-0000-4000-8000-0000000000b1", userId: "00000000-0000-4000-8000-0000000000ee", state: "WI", job: "z", checklist: {}, offense: null, createdAt: "" });
  const res = await handleConsentDelete(w.deps);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { revoked: true, deleted: 2 });
  assert.equal(w.revokes, 1);
  assert.deepEqual(w.rows.map((r) => r.id), ["00000000-0000-4000-8000-0000000000b1"]);
  assert.equal((await handleBuild(req("/api/record-check", "POST", BUILD), w.deps)).status, 409);
  const save = await handleSavedPost(req("/api/record-check/saved", "POST", { state: "OH", job: JOB, checklist: { steps: [{ text: "Find the board.", sourceIds: [] }], questions: [] }, keepOffense: false }), w.deps);
  assert.equal(save.status, 409);
});

test("staff: a staff session acting as the person can neither say yes nor use the step", async () => {
  const w = world({}, { consented: false, staff: true });
  const post = await handleConsentPost(req("/api/record-check/consent", "POST", { ticked: true, textVersion: RECORD_CHECK_CONSENT_VERSION }), w.deps);
  assert.equal(post.status, 403);
  assert.equal((await post.json()).code, "staff_cannot_consent");
  assert.deepEqual(w.grants, []);
  // Even with the person's own yes on file, staff cannot run, save, list or revoke it.
  w.consent = { granted: true, version: RECORD_CHECK_CONSENT_VERSION, grantedAt: "x" };
  assert.equal((await handleBuild(req("/api/record-check", "POST", BUILD), w.deps)).status, 403);
  assert.equal((await handleSavedGet(w.deps)).status, 403);
  assert.equal((await handleSavedPost(req("/api/record-check/saved", "POST", {}), w.deps)).status, 403);
  assert.equal((await handleConsentDelete(w.deps)).status, 403);
  assert.equal(w.modelCalls.length, 0);
  assert.equal(w.revokes, 0);
  assert.equal((await (await handleConsentGet(w.deps)).json()).staffBlocked, true);
});

test("staff: the general consent route cannot grant the record check layer", () => {
  const src = readFileSync(join(APP, "app/api/consent/route.ts"), "utf8");
  const list = src.match(/const TOGGLEABLE: ConsentLayer\[\] = \[([^\]]*)\]/)?.[1] ?? "";
  assert.ok(list.includes('"enhanced"'), "found the toggleable list");
  assert.ok(!list.includes("record_check"));
});

test("staff: the real dependency treats any impersonation cookie as staff", () => {
  const src = readFileSync(join(APP, "lib/record-check/deps.ts"), "utf8");
  assert.match(src, /store\.get\(IMPERSONATE_COOKIE\)/);
  // The route identity is the real session (auth), never the impersonated one.
  assert.ok(!/effectiveAuth/.test(src));
});

// ---------------------------------------------------------- minimum data --

test("minimum data: any field beyond offense, state and job is refused before the model", async () => {
  for (const extra of [{ name: ACCOUNT_NAME }, { resume: ACCOUNT_RESUME }, { recordAnswers: { type: "felony" } }, { forgeContext: {} }]) {
    const w = world();
    const res = await handleBuild(req("/api/record-check", "POST", { ...BUILD, ...extra }), w.deps);
    assert.equal(res.status, 400, JSON.stringify(extra));
    assert.equal(w.modelCalls.length, 0);
  }
});

test("minimum data: the prompt carries the three typed fields and nothing else", async () => {
  const w = world();
  const res = await handleBuild(req("/api/record-check", "POST", BUILD), w.deps);
  assert.equal(res.status, 200);
  assert.equal(w.modelCalls.length, 1);
  const sent = w.modelCalls[0].system + "\n" + w.modelCalls[0].user;
  assert.ok(sent.includes(OFFENSE) && sent.includes(JOB) && sent.includes("Ohio"));
  assert.ok(!sent.includes(ACCOUNT_NAME) && !sent.includes("Corner Depot"));
  // The builder reads only its three keys, even if handed a bigger object.
  const p = buildRecordCheckPrompt({ ...BUILD, name: ACCOUNT_NAME, resume: ACCOUNT_RESUME } as never);
  assert.ok(!p.user.includes(ACCOUNT_NAME) && !p.user.includes("Corner Depot"));
  // And the prompt module imports nothing that holds account data.
  const src = readFileSync(join(APP, "lib/record-check/prompt.ts"), "utf8");
  const imports = Array.from(src.matchAll(/from "([^"]+)"/g)).map((m) => m[1]).sort();
  assert.deepEqual(imports, ["./sources", "./states", "@/lib/sanitize"]);
});

test("minimum data: the page sends exactly offense, state and job", () => {
  const src = readFileSync(join(APP, "app/(dashboard)/dashboard/record-check/page.tsx"), "utf8");
  assert.match(src, /body: JSON\.stringify\(\{ offense, state: stateCode, job \}\)/);
  assert.ok(!/localStorage|sessionStorage/.test(src.replace(/\/\*[\s\S]*?\*\//g, "")), "nothing typed goes to browser storage");
});

test("minimum data: bad or missing fields are refused", async () => {
  for (const b of [
    { ...BUILD, state: "XX" },
    { ...BUILD, offense: "" },
    { ...BUILD, job: " " },
    { ...BUILD, offense: "x".repeat(301) },
  ]) {
    const w = world();
    assert.equal((await handleBuild(req("/api/record-check", "POST", b), w.deps)).status, 400);
    assert.equal(w.modelCalls.length, 0);
  }
});

// -------------------------------------------------------------- storage --

test("storage: building a checklist stores nothing and does not echo the offense", async () => {
  const w = world();
  const res = await handleBuild(req("/api/record-check", "POST", BUILD), w.deps);
  const text = await res.text();
  assert.equal(w.rows.length, 0);
  assert.ok(!text.toLowerCase().includes("zorbin"), "offense words are not in the reply");
  assert.equal(res.headers.get("cache-control"), "no-store");
});

test("storage: save keeps the offense only when its own box is ticked", async () => {
  const w = world();
  const built = (await (await handleBuild(req("/api/record-check", "POST", BUILD), w.deps)).json()).checklist;
  const send = (keep: boolean, withOffense: boolean) =>
    handleSavedPost(
      req("/api/record-check/saved", "POST", {
        state: built.state,
        job: built.job,
        checklist: { steps: built.steps, questions: built.questions, sourceIds: built.sourceIds, generatedBy: built.generatedBy },
        keepOffense: keep,
        ...(withOffense ? { offense: OFFENSE } : {}),
      }),
      w.deps
    );
  // Not ticked, even if a client sends the text anyway: not stored.
  let r = await send(false, true);
  assert.equal(r.status, 200);
  assert.equal((await r.json()).saved.keptOffense, false);
  assert.equal(w.rows[0].offense, null);
  assert.ok(!JSON.stringify(w.rows[0].checklist).toLowerCase().includes("zorbin"));
  // Ticked: stored.
  r = await send(true, true);
  assert.equal(r.status, 200);
  assert.equal(w.rows[1].offense, OFFENSE);
  // Ticked with nothing typed: refused.
  assert.equal((await send(true, false)).status, 400);
});

test("storage: the saved list, delete one, and a saved check renders with list sources only", async () => {
  const w = world();
  const built = (await (await handleBuild(req("/api/record-check", "POST", BUILD), w.deps)).json()).checklist;
  await handleSavedPost(req("/api/record-check/saved", "POST", { state: "OH", job: JOB, checklist: built, keepOffense: false }), w.deps);
  const list = await (await handleSavedGet(w.deps)).json();
  assert.equal(list.saved.length, 1);
  assert.equal(list.saved[0].offense, null);
  assert.equal(list.saved[0].keptOffense, false);
  assert.ok(list.saved[0].checklist.sources.length > 0);
  const del = await handleSavedDelete(req(`/api/record-check/saved?id=${list.saved[0].id}`, "DELETE"), w.deps);
  assert.equal(del.status, 200);
  assert.equal(w.rows.length, 0);
  assert.equal((await handleSavedDelete(req("/api/record-check/saved?id=nope", "DELETE"), w.deps)).status, 400);
});

test("storage: export and delete-my-data both cover saved record checks", () => {
  const exp = readFileSync(join(APP, "app/api/user/export-data/route.ts"), "utf8");
  assert.match(exp, /want\("record_check"\)\)\s*\{\s*payload\.recordChecks = await exportRecordChecks\(userId\)/);
  const del = readFileSync(join(APP, "app/api/user/delete-data/route.ts"), "utf8");
  assert.match(del, /await deleteAllRecordChecks\(userId\);/);
  const settings = readFileSync(join(APP, "app/(dashboard)/dashboard/settings/page.tsx"), "utf8");
  assert.match(settings, /key: "record_check"/);
});

// ------------------------------------------------------------------ logs --

test("logs: a provider error that echoes the offense is logged as a fixed label only", async () => {
  const w = world({
    callModel: async () => {
      throw new Error(`Anthropic API error: 400 {"error":"bad input: ${OFFENSE} for ${JOB}"}`);
    },
  });
  const { out, printed } = await captureConsole(() => handleBuild(req("/api/record-check", "POST", BUILD), w.deps));
  assert.equal(out.status, 200, "falls back to the plain checklist");
  const body = await out.json();
  assert.equal(body.checklist.generatedBy, "plain");
  assert.deepEqual(w.errors, ["build: provider_error_400"]);
  assert.deepEqual(leaks(printed + w.errors.join("\n")), []);
});

test("logs: the decision log gets counts and the state code, never typed text", async () => {
  const w = world();
  await handleBuild(req("/api/record-check", "POST", BUILD), w.deps);
  assert.equal(w.decisions.length, 1);
  const d = JSON.stringify(w.decisions[0]);
  assert.deepEqual(leaks(d), []);
  assert.ok(!d.toLowerCase().includes("felony"));
  const src = readFileSync(join(APP, "lib/record-check/deps.ts"), "utf8");
  assert.match(src, /input: `record-check\|\$\{state\}`/);
  assert.match(src, /endpoint: "record-check"/);
  assert.match(src, /anthropicOnly: true/);
});

test("logs: a bad body is refused without printing it", async () => {
  const w = world();
  const { out, printed } = await captureConsole(() =>
    handleBuild(req("/api/record-check", "POST", `{"offense":"${OFFENSE}", oops`), w.deps)
  );
  assert.equal(out.status, 400);
  assert.deepEqual(leaks(printed), []);
});

test("logs: safeErrorLabel and scrubForLog keep typed words out", () => {
  assert.equal(safeErrorLabel(new Error(`Anthropic API error: 529 overloaded ${OFFENSE}`)), "provider_error_529");
  assert.equal(safeErrorLabel(new Error(`Unexpected token z, "${OFFENSE}" is not valid JSON`)), "bad_model_json");
  assert.equal(safeErrorLabel(OFFENSE), "error");
  const s = scrubForLog(`failed on ${OFFENSE} / ${JSON.stringify(OFFENSE)} / ZORBIN`, [OFFENSE]);
  assert.ok(!/zorbin/i.test(s), s);
});

test("logs: the whole happy path prints nothing typed", async () => {
  const w = world();
  const { printed } = await captureConsole(async () => {
    await handleConsentPost(req("/api/record-check/consent", "POST", { ticked: true, textVersion: RECORD_CHECK_CONSENT_VERSION }), w.deps);
    const c = (await (await handleBuild(req("/api/record-check", "POST", BUILD), w.deps)).json()).checklist;
    await handleSavedPost(req("/api/record-check/saved", "POST", { state: "OH", job: JOB, checklist: c, keepOffense: true, offense: OFFENSE }), w.deps);
    await handleSavedGet(w.deps);
    await handleConsentDelete(w.deps);
  });
  assert.deepEqual(leaks(printed), []);
});

// --------------------------------------------------- verdicts and sources --

// An independent deny-list (not the guard's own patterns), checked on the
// final output, so the test does not grade the guard with itself.
const DENY = [
  "you are barred", "you're barred", "you are disqualified", "you're disqualified", "you qualify", "you do not qualify",
  "you don't qualify", "you are eligible", "you're eligible", "you are not eligible", "will not block", "won't block",
  "will block you", "not a problem", "no problem", "guarantee", "automatically disqualified", "you will get the license",
  "you can't get", "you cannot get", "will be denied",
];
function outputText(c: unknown): string {
  return JSON.stringify(c).toLowerCase().replace(/’/g, "'");
}

test("verdicts: the mock reply passes and the page shows the not-a-verdict line", () => {
  for (const state of ["OH", "MT", "WI", "MI", "MO", "TX"]) {
    const { checklist } = buildChecklist({ offense: OFFENSE, state, job: JOB }, MOCK_RECORD_CHECK_REPLY);
    const t = outputText({ steps: checklist.steps, questions: checklist.questions });
    for (const d of DENY) assert.ok(!t.includes(d), `${state}: "${d}"`);
    assert.equal(checklist.notAVerdict, RECORD_CHECK_COPY.notAVerdict);
    assert.match(checklist.notAVerdict, /not legal advice/);
    assert.ok(checklist.steps.length >= 2 && checklist.questions.length >= 2);
  }
});

const BAD_REPLY = JSON.stringify({
  steps: [
    { text: "You are barred from this license for life.", source_ids: ["oh-licensing-law"] },
    { text: "Good news: you qualify for a barber license in Ohio.", source_ids: [] },
    { text: "Your conviction won't block you, so apply now.", source_ids: [] },
    { text: "This is no problem for a barber license.", source_ids: [] },
    { text: "You're eligible to seal it right away.", source_ids: [] },
    { text: "Read https://example.com/made-up-law first.", source_ids: [] },
    { text: "Under R.C. 4709.13 you are fine.", source_ids: [] },
    { text: "Check the board site at cosmo.ohio.gov.", source_ids: [] },
    { text: "Read 42 U.S.C. 1983 for your rights.", source_ids: [] },
    { text: "Ask the board for a review of your zorbin fraud record before training.", source_ids: ["oh-predetermination", "made-up-id", "mt-licensing-board"] },
    { text: "Write down who you talked to and when.", source_ids: [] },
  ],
  questions: [
    "Can you guarantee I will get the license?",
    "Is my zorbin fraud felony a problem for you?",
    "How do I ask for a review before I train?",
    "What papers should I bring?",
  ],
});

test("verdicts: verdict lines are dropped, never shown", () => {
  const { checklist, counts } = buildChecklist({ offense: OFFENSE, state: "OH", job: JOB }, BAD_REPLY);
  const t = outputText({ steps: checklist.steps, questions: checklist.questions });
  for (const d of DENY) assert.ok(!t.includes(d), `"${d}" reached the page`);
  assert.ok(counts.dropped_verdict >= 6, JSON.stringify(counts));
  for (const line of [...checklist.steps.map((s) => s.text), ...checklist.questions]) {
    assert.equal(findVerdict(line), null, line);
  }
});

test("verdicts: the offense words are replaced in what the model wrote", () => {
  const { checklist } = buildChecklist({ offense: OFFENSE, state: "OH", job: JOB }, BAD_REPLY);
  assert.ok(!outputText(checklist).includes("zorbin"));
  assert.ok(checklist.steps.some((s) => /review of your record/.test(s.text)));
});

test("sources: only curated or typed links are ever shown", () => {
  const allowed = allShowableUrls();
  const typed = "https://board.example.org/apply";
  for (const [job, extra] of [[JOB, null], [`${JOB} ${typed}`, typed]] as const) {
    const { checklist, counts } = buildChecklist({ offense: OFFENSE, state: "OH", job }, BAD_REPLY);
    assert.ok(counts.dropped_link_or_citation >= 3, JSON.stringify(counts));
    const urls = Array.from(JSON.stringify({ sources: checklist.sources, steps: checklist.steps, questions: checklist.questions }).matchAll(/https?:\/\/[^"\s)]+/g)).map((m) => m[0]);
    assert.ok(urls.length > 0);
    for (const u of urls) assert.ok(allowed.has(u) || u === extra, `not curated: ${u}`);
    const steps = JSON.stringify(checklist.steps);
    assert.ok(!/U\.S\.C|R\.C\.|example\.com|ohio\.gov/.test(steps));
    if (extra) assert.equal(checklist.sources.filter((s) => s.from === "you").length, 1);
    // Unknown and UNVERIFIED ids never survive.
    for (const s of checklist.steps) for (const id of s.sourceIds) assert.ok(showableSourceById(id), id);
  }
});

test("sources: UNVERIFIED entries are never shown, from the list, the model, or a saved checklist", () => {
  const unverified = allCuratedSources().filter((e) => e.status === "UNVERIFIED");
  assert.ok(unverified.length >= 5, "the list keeps its research placeholders");
  for (const e of unverified) {
    assert.equal(e.url, null, `${e.id} has no url`);
    assert.equal(showableSourceById(e.id), null);
  }
  for (const state of Object.keys(STATE_NAMES)) {
    for (const s of showableSourcesFor(state)) assert.ok(!unverified.some((u) => u.id === s.id));
  }
  // Status alone decides: an UNVERIFIED entry stays hidden even if someone
  // fills in a url and a date before research confirms it.
  for (const e of unverified) assert.equal(isShowable({ ...e, url: "https://example.gov/x", as_of: "2026-10-09" }), false, e.id);
  const stored: StoredChecklist = {
    v: 1, state: "MT", steps: [{ text: "Find the board.", sourceIds: ["mt-licensing-board", "mt-licensing-law"] }],
    questions: ["What does it cost?"], sourceIds: ["mt-licensing-board", "mt-predetermination", "mt-licensing-law"],
    typedUrl: null, generatedBy: "ai", sourceListAsOf: "2026-10-09",
  };
  const view = renderChecklist(stored, "x");
  assert.deepEqual(view.sources.map((s) => s.id), ["mt-licensing-law"]);
  assert.deepEqual(view.steps[0].sourceIds, ["mt-licensing-law"]);
});

test("sources: every shown entry is https, dated and labeled verify before relying", () => {
  const showable = allCuratedSources().filter((e) => e.status === "verify_before_relying");
  assert.ok(showable.length >= 30);
  for (const e of showable) {
    assert.match(e.url ?? "", /^https:\/\//, e.id);
    assert.match(e.as_of ?? "", /^\d{4}-\d{2}-\d{2}$/, e.id);
    assert.equal(findVerdict(e.what_it_is), null, e.id);
    assert.equal(showableSourceById(e.id)?.label, "Verify before relying");
  }
  for (const st of ["MT", "WI", "MI", "MO", "OH"]) assert.ok(showableSourcesFor(st).some((s) => !s.id.startsWith("us-")), st);
  assert.ok(showableSourcesFor("OH").some((s) => s.id.startsWith("us-")), "federal entries ride along");
  const ids = allCuratedSources().map((e) => e.id);
  assert.equal(new Set(ids).size, ids.length, "ids are unique");
});

test("plain checklist: no model reply still gives a usable checklist", () => {
  for (const reply of [null, "not json", "{}", JSON.stringify({ steps: [], questions: [] })]) {
    const { checklist } = buildChecklist({ offense: OFFENSE, state: "MT", job: JOB }, reply);
    assert.equal(checklist.generatedBy, "plain");
    assert.ok(checklist.steps.length >= 4 && checklist.questions.length >= 4);
    assert.ok(checklist.sources.some((s) => s.id === "mt-licensing-law"));
  }
});

// ----------------------------------------------------------------- misc --

test("copy: the consent says what is sent, to whom, for how long, and that it can stop", () => {
  const c = RECORD_CHECK_COPY;
  assert.match(c.whatIsSent, /Anthropic/);
  assert.match(c.whatIsSent, /Not your name, not your resume, not your other answers/);
  assert.match(c.howLong, /Only while this page is open, unless you press Save/);
  assert.match(c.yourChoice, /stop any time/);
  assert.match(c.yourChoice, /Staff who help you cannot say yes for you/);
  assert.match(c.offenseHint, /broadly/);
  for (const v of Object.values(c)) {
    assert.ok(!/—|--/.test(v), `dash in: ${v}`);
    assert.ok(!/\byou are a felon\b/i.test(v));
  }
});

test("analytics never load on the record check page", () => {
  assert.equal(isAnalyticsExcluded("/dashboard/record-check"), true);
});
