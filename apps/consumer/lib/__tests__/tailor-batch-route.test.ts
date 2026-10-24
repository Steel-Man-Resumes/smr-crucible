/**
 * The /api/tailor-batch POST handler itself (lib/tailor-batch-route.ts, the
 * code app/api/tailor-batch/route.ts serves). Each case here fails if its
 * guard is removed: account binding (B1), the generator start deadline (S1),
 * the resume-lane check (S2), the server claim (S3), impersonation and the
 * context whitelist. Fake inner handlers, fake generator, no provider.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createTailorBatchRoute, NOT_READY_LINE, type TailorBatchRouteDeps } from "../tailor-batch-route";
import { GENERATOR_START_BUDGET_MS } from "../tailor-batch-server";
import { makeAccount, type AccountOptions } from "./tailor-batch-fakes";

const A = "00000000-0000-4000-8000-0000000000a1";
const B = "00000000-0000-4000-8000-0000000000b2";
const BATCH = "11111111-2222-4333-8444-555555555555";
const LANE = "22222222-3333-4444-8555-666666666666";

function setup(opts: AccountOptions & { signedIn?: string; impersonating?: boolean; lane?: "ok" | "not_found" | "not_resume"; notReady?: boolean } = {}) {
  const acct = makeAccount(opts.signedIn ?? A, opts);
  const deps: TailorBatchRouteDeps = {
    async session() { return { userId: opts.signedIn ?? A, impersonating: !!opts.impersonating, realUserId: opts.signedIn ?? A }; },
    sameOrigin: () => true,
    async laneKind(_u, laneId) { return laneId ? opts.lane ?? "ok" : "ok"; },
    claims: () => opts.notReady ? { ...acct.claims, async claim() { throw Object.assign(new Error("relation does not exist"), { code: "42P01" }); }, async ready() { throw Object.assign(new Error("x"), { code: "42P01" }); } } : acct.claims,
    async applicationStatus(_u, id) { return acct.applications.find(a => a.id === id)?.status ?? null; },
    inner: acct.inner,
    async allowance() { return { remaining: 3, blockedReason: null, locked: false }; },
    now: () => acct.counters.clock,
  };
  return { acct, route: createTailorBatchRoute(deps) };
}

function post(body: Record<string, unknown>, expected: string | null = A) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (expected !== null) headers["x-expected-account-id"] = expected;
  return new Request("https://app.example/api/tailor-batch", { method: "POST", headers, body: JSON.stringify(body) });
}
const jobBody = (index = 0, extra: Record<string, unknown> = {}) => ({
  batchId: BATCH, index, size: 3, laneId: null,
  job: { title: `Warehouse Associate ${index}`, company: "Example Co", description: "Load trucks.", id: `job-${index}` },
  context: { forgeOutput: { skills: ["forklift"] }, contact: { name: "Dana Reyes" } }, ...extra,
});

test("B1: a batch started by A is refused once B is signed in, before any write or AI call", async () => {
  const { acct, route } = setup({ signedIn: B });
  const response = await route.POST(post(jobBody(), A));
  assert.equal(response.status, 409);
  assert.equal((await response.json()).code, "account_changed");
  assert.equal(acct.counters.generatorCalls, 0);
  assert.equal(acct.applications.length, 0);
  assert.equal(acct.artifacts.length, 0);
  assert.equal(acct.claimRows.size, 0);
});

test("B1: a POST without the expected account header is refused", async () => {
  const { acct, route } = setup();
  const response = await route.POST(post(jobBody(), null));
  assert.equal(response.status, 409);
  assert.equal(acct.counters.generatorCalls, 0);
});

test("B1: the expected account header is forwarded to the inner artifacts save", async () => {
  const { acct, route } = setup();
  const seen: Array<string | null> = [];
  const artifacts = acct.inner.artifacts;
  acct.inner.artifacts = async (request: Request) => { seen.push(request.headers.get("x-expected-account-id")); return artifacts(request); };
  const body = await (await route.POST(post(jobBody()))).json();
  assert.equal(body.ok, true);
  assert.ok(seen.length >= 1);
  assert.ok(seen.every(value => value === A), "every inner artifacts save carries the expected account");
  assert.equal(acct.artifacts.filter(a => a.type === "resume").length, 1);
});

test("S1: the generator never starts late in the request; the claim is released, nothing used", async () => {
  const { acct, route } = setup();
  const slowApplications = acct.inner.applications;
  acct.inner.applications = async (request: Request) => { acct.counters.clock += GENERATOR_START_BUDGET_MS + 1; return slowApplications(request); };
  const response = await route.POST(post(jobBody()));
  const body = await response.json();
  assert.equal(body.code, "out_of_time");
  assert.equal(body.actionUsed, false);
  assert.equal(acct.counters.generatorCalls, 0);
  assert.equal(acct.claimRows.get(`${BATCH}:0`)?.status, "failed");
});

test("S1: a run killed after its save is found on retry: no second generator call, no duplicate", async () => {
  const { acct, route } = setup();
  // First request: the resume saved, then the platform ended the request before the claim was marked saved.
  const markSaved = acct.claims.markSaved;
  acct.claims.markSaved = async () => { throw new Error("killed"); };
  await route.POST(post(jobBody()));
  acct.claims.markSaved = markSaved;
  assert.equal(acct.claimRows.get(`${BATCH}:0`)?.status, "running");
  // Within the platform limit the key stays held.
  const early = await (await route.POST(post(jobBody()))).json();
  assert.equal(early.code, "in_progress");
  // After it is stale, the retry finds the saved resume.
  acct.counters.clock += 7 * 60_000;
  const retry = await (await route.POST(post(jobBody()))).json();
  assert.equal(retry.ok, true);
  assert.equal(retry.reused, true);
  assert.equal(acct.counters.generatorCalls, 1);
  assert.equal(acct.artifacts.filter(a => a.type === "resume").length, 1);
});

test("S2: a non-resume lane is refused before the generator, with a plain line and no charge", async () => {
  const { acct, route } = setup({ lane: "not_resume" });
  const response = await route.POST(post(jobBody(0, { laneId: LANE })));
  const body = await response.json();
  assert.equal(response.status, 400);
  assert.equal(body.code, "invalid_lane");
  assert.equal(body.actionUsed, false);
  assert.match(body.error, /not resumes/);
  assert.equal(acct.counters.generatorCalls, 0);
  assert.equal(acct.applications.length, 0);
});

test("S3: two tabs on the same job: one runs the generator, the other is refused and charged nothing", async () => {
  let release!: () => void;
  const hold = new Promise<void>(resolve => { release = resolve; });
  const { acct, route } = setup({ hold });
  const first = route.POST(post(jobBody()));
  await new Promise(resolve => setImmediate(resolve));
  const second = await route.POST(post(jobBody()));
  assert.equal(second.status, 409);
  assert.equal((await second.json()).code, "in_progress");
  release();
  assert.equal((await (await first).json()).ok, true);
  assert.equal(acct.counters.generatorCalls, 1);
  assert.equal(acct.artifacts.filter(a => a.type === "resume" && a.targetContext.batchKey === `${BATCH}:0`).length, 1);
});

test("impersonation is refused before any work", async () => {
  const { acct, route } = setup({ impersonating: true });
  const response = await route.POST(post(jobBody()));
  assert.equal(response.status, 403);
  assert.equal(acct.counters.generatorCalls, 0);
});

test("the whitelist drops unknown keys (read from the generator's request)", async () => {
  const { acct, route } = setup();
  let seen: Record<string, unknown> = {};
  const generate = acct.inner.generate;
  acct.inner.generate = async (request: Request) => { seen = await request.clone().json(); return generate(request); };
  await route.POST(post(jobBody(0, { context: { forgeOutput: { a: 1 }, userId: "someone", tier: "admin" } })));
  assert.deepEqual(Object.keys(seen).sort(), ["forgeOutput", "job"]);
});

test("before migration 093 the route fails closed with a plain line and uses nothing", async () => {
  const { acct, route } = setup({ notReady: true });
  const response = await route.POST(post(jobBody()));
  assert.equal(response.status, 503);
  const body = await response.json();
  assert.equal(body.code, "not_ready");
  assert.equal(body.error, NOT_READY_LINE);
  assert.equal(acct.counters.generatorCalls, 0);
  const pre = await (await route.GET(new Request("https://app.example/api/tailor-batch"))).json();
  assert.equal(pre.remaining, 0);
  assert.equal(pre.blockedReason, NOT_READY_LINE);
});

test("GET reports a non-resume lane up front", async () => {
  const { route } = setup({ lane: "not_resume" });
  const pre = await (await route.GET(new Request(`https://app.example/api/tailor-batch?laneId=${LANE}`))).json();
  assert.equal(pre.remaining, 0);
  assert.match(pre.blockedReason, /not resumes/);
});
