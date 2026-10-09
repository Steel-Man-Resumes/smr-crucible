/**
 * The finished package, emailed by itself (lib/email-package-auto.ts, lane 3a
 * Part 2 item 2). Every dependency is a fake: no database, and the mail
 * transport is a recorder, so no real email provider is ever reached.
 * Fictional people, example.com addresses only.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildFinishView, recordAnswer, type DefendAnswer } from "../finish-gate";
import {
  AUTO_ENDPOINT,
  autoResultLine,
  finishedVersion,
  sendFinishedPackage,
  type AutoDeps,
} from "../email-package-auto";
import { EMAIL_PACKAGE_PER_RECIPIENT_PER_DAY, RECIPIENT_ENDPOINT, recipientKey } from "../email-package-guard";
import type { PackageMail } from "../email-package-send";

const UID = "00000000-0000-4000-8000-0000000000aa";
const OWN = "morgan@example.com";

const SOURCE = `Morgan Sample
Toledo, OH | morgan@example.com
Line cook at Harbor Street Diner from 2019 to 2023.
I ran the grill on the breakfast line, prepped vegetables before open, and closed the kitchen at night.
The owner asked me to show new cooks the grill.`;

const RESUME = `MORGAN SAMPLE
Toledo, OH | morgan@example.com

Line cook

PROFESSIONAL EXPERIENCE
LINE COOK | Harbor Street Diner | 2019 - 2023
- Ran the grill on the breakfast line.
- Prepped vegetables before open and closed the kitchen at night.
- Asked by the owner to show new cooks the grill.

CORE COMPETENCIES
Grill, Breakfast line, Vegetable prep, Kitchen closing`;

function allAnswered(resume = RESUME): DefendAnswer[] {
  let answers: DefendAnswer[] = [];
  const view = buildFinishView({ resumeText: resume, ownWords: SOURCE, defendAnswers: [] });
  for (const d of view.status.defendLines) answers = recordAnswer(answers, d.line, "That is what I did, in my words.", "stands");
  return answers;
}

function finishedBody(extra: Record<string, unknown> = {}) {
  return { resumeText: RESUME, ownWords: SOURCE, defendAnswers: allAnswered(), coverLetterText: "Dear hiring manager,", ...extra };
}

/** Fake world: an account row, a durable claim table, daily counters, and a recording transport. */
function world(opts: {
  target?: { email: string | null; proven: boolean; on: boolean } | null;
  claimTable?: "ready" | "missing";
  transportOk?: boolean;
  transportThrows?: boolean;
  noTransport?: boolean;
  countThrows?: boolean;
} = {}) {
  const sent: PackageMail[] = [];
  const claims = new Set<string>();
  const counts = new Map<string, number>();
  const released: string[] = [];
  const deps: AutoDeps = {
    target: async () => (opts.target === undefined ? { email: OWN, proven: true, on: true } : opts.target),
    count: async (key, endpoint) => {
      if (opts.countThrows && endpoint === RECIPIENT_ENDPOINT) throw new Error("db down");
      const k = `${endpoint}|${key}`;
      const n = (counts.get(k) ?? 0) + 1;
      counts.set(k, n);
      return n;
    },
    claim: async (userId, version) => {
      if (opts.claimTable === "missing") return null;
      const k = `${userId}|${version}`;
      if (claims.has(k)) return false;
      claims.add(k);
      return true;
    },
    release: async (userId, version) => {
      released.push(version);
      claims.delete(`${userId}|${version}`);
    },
    transport: opts.noTransport
      ? null
      : async (msg) => {
          if (opts.transportThrows) throw new Error("network");
          sent.push(msg);
          return { ok: opts.transportOk !== false, status: opts.transportOk === false ? 500 : 200 };
        },
    from: "Steel Man Resumes <noreply@example.com>",
  };
  return { deps, sent, claims, counts, released };
}

test("the fixture really is finished (and without answers, a draft)", () => {
  assert.equal(buildFinishView({ resumeText: RESUME, ownWords: SOURCE, defendAnswers: allAnswered() }).state, "finished");
  assert.equal(buildFinishView({ resumeText: RESUME, ownWords: SOURCE, defendAnswers: [] }).state, "draft");
});

test("a finished resume is sent once, to the account's own proven address", async () => {
  const w = world();
  const r = await sendFinishedPackage(UID, finishedBody(), w.deps);
  assert.deepEqual(r, { sent: true, to: OWN });
  assert.equal(w.sent.length, 1);
  assert.equal(w.sent[0].to, OWN);
  assert.match(w.sent[0].text, /LINE COOK \| Harbor Street Diner/);
  assert.equal(w.sent[0].subject, "Your finished resume from The Forge");
  assert.equal(autoResultLine(r), `We sent it to ${OWN}.`);
});

test("a draft sends nothing and claims nothing", async () => {
  const w = world();
  const r = await sendFinishedPackage(UID, finishedBody({ defendAnswers: [] }), w.deps);
  assert.deepEqual(r, { sent: false, reason: "draft" });
  assert.equal(w.sent.length, 0);
  assert.equal(w.claims.size, 0);
  assert.equal(w.counts.size, 0);
});

test("no resume, nothing sent", async () => {
  const w = world();
  assert.deepEqual(await sendFinishedPackage(UID, { resumeText: "   " }, w.deps), { sent: false, reason: "no_resume" });
  assert.equal(w.sent.length, 0);
});

test("an address in the request body is ignored: the email goes only to the account's address", async () => {
  const w = world();
  const r = await sendFinishedPackage(
    UID,
    finishedBody({ email: "someone.else@example.com", to: "someone.else@example.com", recipient: "x@example.com" }),
    w.deps
  );
  assert.equal(r.sent, true);
  assert.equal(w.sent.length, 1);
  assert.equal(w.sent[0].to, OWN);
  assert.ok(!JSON.stringify(w.sent[0]).includes("someone.else@example.com"));
});

test("an unproven address gets nothing", async () => {
  const w = world({ target: { email: OWN, proven: false, on: true } });
  const r = await sendFinishedPackage(UID, finishedBody(), w.deps);
  assert.deepEqual(r, { sent: false, reason: "unproven" });
  assert.equal(w.sent.length, 0);
  assert.equal(w.claims.size, 0);
});

test("turned off: nothing is sent", async () => {
  const w = world({ target: { email: OWN, proven: true, on: false } });
  const r = await sendFinishedPackage(UID, finishedBody(), w.deps);
  assert.deepEqual(r, { sent: false, reason: "off" });
  assert.equal(w.sent.length, 0);
  assert.equal(autoResultLine(r), null);
});

test("no account row or no address: nothing is sent", async () => {
  for (const target of [null, { email: null, proven: true, on: true }]) {
    const w = world({ target });
    assert.deepEqual(await sendFinishedPackage(UID, finishedBody(), w.deps), { sent: false, reason: "no_address" });
    assert.equal(w.sent.length, 0);
  }
});

test("idempotent: the same finished version is never sent twice, even days apart", async () => {
  const w = world();
  assert.equal((await sendFinishedPackage(UID, finishedBody(), w.deps)).sent, true);
  // A new day: the daily counters reset, the claim does not.
  w.counts.clear();
  const again = await sendFinishedPackage(UID, finishedBody(), w.deps);
  assert.deepEqual(again, { sent: false, reason: "already", to: OWN });
  assert.equal(w.sent.length, 1);
  assert.equal(autoResultLine(again), `We sent it to ${OWN}.`);
});

test("a changed finished resume is a new version and is sent", async () => {
  const w = world();
  await sendFinishedPackage(UID, finishedBody(), w.deps);
  const edited = RESUME.replace("Grill, Breakfast line", "Grill, Breakfast line, Food safety");
  const r = await sendFinishedPackage(UID, finishedBody({ resumeText: edited, defendAnswers: allAnswered(edited) }), w.deps);
  assert.equal(r.sent, true);
  assert.equal(w.sent.length, 2);
});

test("two tabs at once: one send", async () => {
  const w = world();
  const [a, b] = await Promise.all([
    sendFinishedPackage(UID, finishedBody(), w.deps),
    sendFinishedPackage(UID, finishedBody(), w.deps),
  ]);
  assert.equal([a, b].filter((r) => r.sent).length, 1);
  assert.equal(w.sent.length, 1);
});

test("the version is a SHA-256 hex of the person and the text, never the text", () => {
  const v = finishedVersion(UID, RESUME);
  assert.match(v, /^[0-9a-f]{64}$/);
  assert.notEqual(v, finishedVersion("00000000-0000-4000-8000-0000000000bb", RESUME), "another person, another version");
  assert.ok(!v.includes("MORGAN"));
});

test("a failed send gives the claim back, so a later visit can send it", async () => {
  const w = world({ transportOk: false });
  const r = await sendFinishedPackage(UID, finishedBody(), w.deps);
  assert.deepEqual(r, { sent: false, reason: "failed", to: OWN });
  assert.equal(w.released.length, 1);
  assert.equal(w.claims.size, 0);
});

test("a transport that throws gives the claim back too", async () => {
  const w = world({ transportThrows: true });
  assert.equal((await sendFinishedPackage(UID, finishedBody(), w.deps)).sent, false);
  assert.equal(w.claims.size, 0);
});

test("a counter error after the claim gives the claim back and is not swallowed", async () => {
  const w = world({ countThrows: true });
  await assert.rejects(sendFinishedPackage(UID, finishedBody(), w.deps));
  assert.equal(w.claims.size, 0);
  assert.equal(w.sent.length, 0);
});

test("the existing per-address daily cap applies, and a capped send is given back", async () => {
  const w = world();
  // The address already had its sends today (from the package box, say).
  for (let i = 0; i < EMAIL_PACKAGE_PER_RECIPIENT_PER_DAY; i++) await w.deps.count(recipientKey(OWN), RECIPIENT_ENDPOINT);
  const r = await sendFinishedPackage(UID, finishedBody(), w.deps);
  assert.deepEqual(r, { sent: false, reason: "limit", to: OWN });
  assert.equal(w.sent.length, 0);
  assert.equal(w.claims.size, 0, "given back: tomorrow it can still go out");
});

test("before 078 is applied: once a day by the durable counter", async () => {
  const w = world({ claimTable: "missing" });
  assert.equal((await sendFinishedPackage(UID, finishedBody(), w.deps)).sent, true);
  assert.deepEqual(await sendFinishedPackage(UID, finishedBody(), w.deps), { sent: false, reason: "already", to: OWN });
  assert.equal(w.sent.length, 1);
  assert.ok(Array.from(w.counts.keys()).some((k) => k.startsWith(`${AUTO_ENDPOINT}|auto:`)));
});

test("email not configured: nothing sent, and the line says so plainly", async () => {
  const w = world({ noTransport: true });
  const r = await sendFinishedPackage(UID, finishedBody(), w.deps);
  assert.equal(r.sent, false);
  assert.equal(r.reason, "not_configured");
  assert.match(autoResultLine(r) ?? "", /download is right here/);
});

test("the route takes no address from the request and wires the real claim", () => {
  const src = readFileSync(join(__dirname, "..", "..", "app", "api", "forge", "email-package", "auto", "route.ts"), "utf8");
  assert.doesNotMatch(src, /body\.(email|to|recipient)/);
  assert.match(src, /forgeSessionUser\(await auth\(\)\)/);
  assert.match(src, /claim: claimPackageEmailVersion/);
  assert.match(src, /release: releasePackageEmailVersion/);
  assert.match(src, /mode: "user"/);
  assert.match(src, /isSameOriginJsonPost\(request\.headers\)/);
  assert.doesNotMatch(src, /originAllowed/);
});

test("the finished email says why it came and how to turn it off, with no price", async () => {
  const w = world();
  await sendFinishedPackage(UID, finishedBody(), w.deps);
  const m = w.sent[0];
  assert.match(m.text, /You can turn these emails off in Settings/);
  assert.doesNotMatch(m.text + m.html, /\$\d|price|per month/i);
  assert.doesNotMatch(m.html, /<script/i);
});
