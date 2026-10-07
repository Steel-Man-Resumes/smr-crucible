/**
 * The second check route handler, called directly with fake dependencies:
 * the flag, the body shape, the daily dollar cap, account and IP limits, the
 * fallback on an outage, and what reaches the provider. No network, no DB.
 * Every person and employer here is invented.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { mockSecondCheckProvider } from "@crucible/core/src/secondCheck";
import { handleSecondCheckPost, readSecondCheckBody, secondCheckSource, type SecondCheckDeps } from "../second-check-handler";

const SOURCE = `Jordan Sample
jordan@example.com | 614-555-0142
I cooked at Corner Diner from 2019 to 2024. I helped with the weekly order under the kitchen manager.
I had a ServSafe Food Handler card that expired in 2022.`;

const PAGE = `JORDAN SAMPLE
Columbus, OH | jordan@example.com | 614-555-0142

WORK EXPERIENCE
LINE COOK | Corner Diner | 2019 - 2024
- Placed the weekly food order.

CERTIFICATIONS
- ServSafe Food Handler | Current`;

const FLAG_REPLY = JSON.stringify({
  findings: [
    { line: "- ServSafe Food Handler | Current", kind: "credential_status", severity: "BLOCK", reason: "Your words say it expired.", question: "Is this current, expired, or still in progress?" },
    { line: "Ran the whole kitchen.", kind: "invented_fact", severity: "BLOCK", reason: "x", question: "y?" },
  ],
});

interface Calls {
  account: string[];
  released: string[];
  ip: string[];
  recorded: number;
}

function deps(over: Partial<SecondCheckDeps> = {}, provider = mockSecondCheckProvider({ reply: FLAG_REPLY })) {
  const calls: Calls = { account: [], released: [], ip: [], recorded: 0 };
  const d: SecondCheckDeps = {
    env: { SECOND_CHECK_ENABLED: "true", SECOND_CHECK_DAILY_USD: "5" },
    provider: () => provider,
    userIdOf: async () => null,
    ipOf: () => "203.0.113.9",
    spentTodayUsd: async () => 0,
    estimateUsd: () => 0.02,
    reserveAccount: async (id) => { calls.account.push(id); return true; },
    releaseAccount: async (id) => { calls.released.push(id); },
    reserveIp: async (ip) => { calls.ip.push(ip); return true; },
    recordUsage: () => { calls.recorded++; },
    ...over,
  };
  return { d, calls, provider };
}

function post(body: unknown, d: SecondCheckDeps) {
  return handleSecondCheckPost(
    new Request("http://localhost/api/forge/second-check", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
    d
  );
}

const BODY = { resumeText: PAGE, sourceText: SOURCE };

test("second check: off unless the flag says true; nothing runs", async () => {
  for (const env of [{}, { SECOND_CHECK_ENABLED: "false" }, { SECOND_CHECK_ENABLED: "yes" }]) {
    const { d, calls, provider } = deps({ env });
    const res = await post(BODY, d);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { status: "off", findings: [] });
    assert.equal(provider.calls.length, 0);
    assert.deepEqual(calls.ip, []);
  }
});

test("second check: runs, validates, and returns only findings on real lines", async () => {
  const { d, calls, provider } = deps();
  const res = await post(BODY, d);
  assert.equal(res.status, 200);
  const json = await res.json();
  assert.equal(json.status, "ran");
  assert.equal(json.findings.length, 1);
  assert.equal(json.findings[0].line, "- ServSafe Food Handler | Current");
  assert.equal(json.dropped, 1);
  assert.equal(provider.calls.length, 1);
  assert.equal(calls.recorded, 1);
  assert.deepEqual(calls.ip, ["203.0.113.9"]);
});

test("second check: the body takes only the page, the person's words and defend answers", async () => {
  for (const bad of [
    { ...BODY, recordAnswers: { offense: "x" } },
    { ...BODY, disclosure: "x" },
    { resumeText: PAGE },
    { resumeText: "", sourceText: SOURCE },
    { ...BODY, defendAnswers: [{ line: "x", answer: "y", verdict: "maybe" }] },
    { ...BODY, defendAnswers: [{ line: "x", answer: "y", caseNotes: "z" }] },
    { ...BODY, resumeText: "x".repeat(30_001) },
  ]) {
    const { d, provider } = deps();
    const res = await post(bad, d);
    assert.equal(res.status, 400, JSON.stringify(Object.keys(bad)));
    assert.deepEqual(await res.json(), { status: "invalid", findings: [] });
    assert.equal(provider.calls.length, 0);
  }
  assert.ok(readSecondCheckBody({ ...BODY, defendAnswers: [{ line: "- Placed the weekly food order.", answer: "I placed it every Monday.", verdict: "stands" }] }));
});

test("second check: record talk and contact details never reach the provider; standing answers do", async () => {
  const { d, provider } = deps();
  const sourceText = `${SOURCE}\nI was convicted in 2018 and was on parole until 2020.`;
  const defendAnswers = [
    { line: "- Placed the weekly food order.", answer: "The manager let me place it on Mondays.", verdict: "stands" },
    { line: "- Placed the weekly food order.", answer: "I don't know.", verdict: "unsure" },
  ];
  await post({ resumeText: PAGE, sourceText, defendAnswers }, d);
  const sent = provider.calls[0].system + provider.calls[0].user;
  assert.doesNotMatch(sent, /convicted|parole/i);
  assert.doesNotMatch(sent, /jordan@example\.com|614-555-0142/);
  assert.match(sent, /The manager let me place it on Mondays\./);
  assert.doesNotMatch(sent, /I don't know/);
  assert.equal(secondCheckSource({ resumeText: PAGE, sourceText: "a", defendAnswers: [] }), "a");
});

test("second check: no provider, or a Claude model, means the mint check alone", async () => {
  const { d } = deps({ provider: () => null });
  const res = await post(BODY, d);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { status: "unavailable", findings: [] });
});

test("second check: the daily dollar cap holds, and a missing cap means no spend", async () => {
  for (const [over, why] of [
    [{ spentTodayUsd: async () => 4.99 }, "spend plus estimate over the cap"],
    [{ env: { SECOND_CHECK_ENABLED: "true" } }, "no cap set"],
    [{ env: { SECOND_CHECK_ENABLED: "true", SECOND_CHECK_DAILY_USD: "0" } }, "cap zero"],
    [{ spentTodayUsd: async () => { throw new Error("db down"); } }, "spend unreadable"],
  ] as Array<[Partial<SecondCheckDeps>, string]>) {
    const { d, calls, provider } = deps(over);
    const res = await post(BODY, d);
    assert.equal(res.status, 200, why);
    assert.deepEqual(await res.json(), { status: "capped", findings: [] }, why);
    assert.equal(provider.calls.length, 0, why);
    assert.deepEqual(calls.ip, [], `${why}: no slot taken`);
  }
});

test("second check: per-account and per-IP limits; a slot is given back when the call did not run", async () => {
  const signedIn = { userIdOf: async () => "user-1" };
  const acct = deps({ ...signedIn, reserveAccount: async () => false });
  const r1 = await post(BODY, acct.d);
  assert.equal(r1.status, 429);
  assert.deepEqual(await r1.json(), { status: "limited", findings: [] });
  assert.equal(acct.provider.calls.length, 0);

  const ip = deps({ ...signedIn, reserveIp: async () => false });
  const r2 = await post(BODY, ip.d);
  assert.equal(r2.status, 429);
  assert.deepEqual(ip.calls.account, ["user-1"]);
  assert.deepEqual(ip.calls.released, ["user-1"], "the account slot comes back when the IP is at its limit");

  const anon = deps();
  await post(BODY, anon.d);
  assert.deepEqual(anon.calls.account, [], "signed out: IP limit only");
});

test("second check: an outage or a bad reply falls back with no findings and never blocks", async () => {
  for (const provider of [mockSecondCheckProvider({ fail: true }), mockSecondCheckProvider({ reply: "not json" })]) {
    const { d, calls } = deps({ userIdOf: async () => "user-2" }, provider);
    const res = await post(BODY, d);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { status: "unavailable", findings: [] });
    assert.deepEqual(calls.released, ["user-2"]);
  }
});

test("second check: a body that is not JSON is refused", async () => {
  const { d } = deps();
  const res = await handleSecondCheckPost(new Request("http://localhost/x", { method: "POST", body: "{nope" }), d);
  assert.equal(res.status, 400);
});
