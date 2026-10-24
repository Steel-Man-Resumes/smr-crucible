/**
 * Premium tools in the app (lane 3a Part 2, item 1). The rules are proven in
 * packages/core (premium.test.ts) and the row-level security in PGlite; here:
 * the switch, the server gate, which routes it guards, and that no locked
 * tool ever shows a price or sends an email.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  PREMIUM_ASK_ORG_LINE,
  PREMIUM_ASK_SENT_LINE,
  PREMIUM_ASK_SMR_LINE,
  PREMIUM_NEVER_PAY_LINE,
  PREMIUM_TOOL_IDS,
  PREMIUM_INCLUDED_LINE,
  SPONSORED_TOOL_IDS,
  TEXT_PRACTICE_SESSIONS_PER_DAY,
  isSponsoredTool,
  premiumGateOn,
  premiumUnavailableMessage,
  textPracticeAllowanceLine,
  textPracticeAllowanceMessage,
  premiumLockedLine,
  premiumLockedMessage,
  toolIsOpen,
} from "../premium";
import {
  TEXT_PRACTICE_ENDPOINT,
  TEXT_PRACTICE_TURN_ENDPOINT,
  TEXT_PRACTICE_TURNS_PER_SESSION,
  checkPremium,
  checkTextPracticeAllowance,
  cachedPremiumStorageReady,
  PREMIUM_READY_CACHE_MS,
  resetPremiumReadyCache,
  signPracticeSession,
  verifyPracticeSession,
} from "../premium-server";

const CONSUMER = join(__dirname, "..", "..");
const read = (...p: string[]) => readFileSync(join(CONSUMER, ...p), "utf8");
const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const PRICE = /\$\s?\d|\bprice|\bcost|\bfee\b|subscri|per month|\/mo\b|\bpaid\b|upgrade/i;

describe("the switch", () => {
  it("off unless explicitly set to on (a deploy never locks tools by accident)", () => {
    assert.equal(premiumGateOn(undefined), false);
    assert.equal(premiumGateOn(null), false);
    assert.equal(premiumGateOn(""), false);
    assert.equal(premiumGateOn("off"), false);
    assert.equal(premiumGateOn("true"), false);
    assert.equal(premiumGateOn("1"), false);
    assert.equal(premiumGateOn("on"), true);
    assert.equal(premiumGateOn(" ON "), true);
  });

  it("reads PREMIUM_GATE from the environment, off when unset", async () => {
    const person = "00000000-0000-4000-8000-0000000000aa";
    const saved = process.env.PREMIUM_GATE;
    try {
      delete process.env.PREMIUM_GATE;
      assert.equal(premiumGateOn(), false);
      assert.equal(await checkPremium(person, "interview_coaching", async () => ({ open: [] })), null, "unset: open");
      process.env.PREMIUM_GATE = "on";
      assert.equal(premiumGateOn(), true);
      assert.equal((await checkPremium(person, "interview_coaching", async () => ({ open: [] })))?.status, 403, "on: locked");
    } finally {
      if (saved === undefined) delete process.env.PREMIUM_GATE;
      else process.env.PREMIUM_GATE = saved;
    }
  });

  it("the status route opens everything when the gate is off", () => {
    const src = read("app", "api", "user", "premium", "route.ts");
    assert.match(src, /if \(!premiumGateOn\(\)\) return NextResponse\.json\(\{ data: ALL_OPEN\(\) \}\)/);
  });

  it("the status route reports unavailable, not all open, when 079 is missing with the gate on (A8)", () => {
    const src = code(read("app", "api", "user", "premium", "route.ts"));
    assert.match(src, /premiumNotReady\) return NextResponse\.json\(\{ data: UNAVAILABLE\(\) \}\)/);
    assert.doesNotMatch(src, /premiumNotReady\) return NextResponse\.json\(\{ data: ALL_OPEN/);
    const un = { gate: true, open: [], orgMember: false, grantEndsAt: null, openRequest: null, unavailable: true };
    assert.equal(toolIsOpen(un, "interview_coaching"), false);
    assert.equal(toolIsOpen(un, "one_click_apply"), false);
    assert.equal(toolIsOpen(un, "resources"), true, "free tools stay open");
  });
});

describe("the server gate", () => {
  const person = "00000000-0000-4000-8000-0000000000aa";

  it("a locked tool gets a 403 that says how to get it, with no price", async () => {
    const res = await checkPremium(person, "interview_coaching", async () => ({ open: [] }), "on");
    assert.ok(res);
    assert.equal(res!.status, 403);
    const body = await res!.json();
    assert.equal(body.code, "premium_locked");
    assert.match(body.error, /Ask your organization, or ask SMR for access\./);
    assert.doesNotMatch(body.error, PRICE);
  });

  it("an open tool passes", async () => {
    assert.equal(await checkPremium(person, "one_click_apply", async () => ({ open: ["one_click_apply"] }), "on"), null);
  });

  it("a grant for one tool does not open another", async () => {
    const res = await checkPremium(person, "one_click_apply", async () => ({ open: ["interview_coaching"] }), "on");
    assert.equal(res?.status, 403);
  });

  it("off (the default): everything passes without reading anything", async () => {
    let read = 0;
    assert.equal(await checkPremium(person, "interview_coaching", async () => { read++; return { open: [] }; }, "off"), null);
    assert.equal(await checkPremium(person, "one_click_apply", async () => { read++; return { open: [] }; }, null), null);
    assert.equal(await checkPremium(person, "interview_coaching", async () => { read++; return { open: [] }; }, ""), null);
    assert.equal(read, 0);
  });

  it("079 not applied with the gate on: FAILS CLOSED with 503, never open (A8); other errors are not swallowed", async () => {
    const notReady = async () => { throw Object.assign(new Error("x"), { premiumNotReady: true }); };
    for (const tool of ["interview_coaching", "one_click_apply"] as const) {
      const res = await checkPremium(person, tool, notReady, "on");
      assert.ok(res, `${tool} must not open`);
      assert.equal(res!.status, 503);
      const body = await res!.json();
      assert.equal(body.code, "premium_unavailable");
      assert.match(body.error, /isn't available right now/);
      assert.doesNotMatch(body.error, PRICE);
    }
    await assert.rejects(checkPremium(person, "interview_coaching", async () => { throw new Error("db down"); }, "on"), /db down/);
  });

  it("the split: support search is free with an account, even with the gate on and nothing granted", async () => {
    let read = 0;
    assert.equal(await checkPremium(person, "resources", async () => { read++; return { open: [] }; }, "on"), null);
    const notReady = async () => { read++; throw Object.assign(new Error("x"), { premiumNotReady: true }); };
    assert.equal(await checkPremium(person, "resources", notReady, "on"), null);
    assert.equal(read, 0, "a free tool reads nothing");
    assert.deepEqual([...SPONSORED_TOOL_IDS], ["interview_coaching", "one_click_apply"]);
    assert.equal(isSponsoredTool("resources"), false);
  });

  it("the status helper", () => {
    const s = { gate: true, open: ["resources" as const], orgMember: false, grantEndsAt: null, openRequest: null };
    assert.equal(toolIsOpen(s, "resources"), true);
    assert.equal(toolIsOpen(s, "interview_coaching"), false);
    assert.equal(toolIsOpen({ ...s, gate: false }, "interview_coaching"), true);
    assert.equal(toolIsOpen(null, "resources"), null);
  });
});

describe("which routes are guarded, and in what order", () => {
  it("every premium API route names its tool", () => {
    // Text practice is free with an account (daily allowance); voice is sponsored.
    assert.doesNotMatch(code(read("app/api/interview-practice/route.ts")), /premium: "interview_coaching"/);
    assert.match(read("app/api/interview-voice/token/route.ts"), /premium: "interview_coaching"/);
    assert.match(read("app/api/quick-apply/route.ts"), /premium: "one_click_apply"/);
    assert.match(read("app/api/resources-search/route.ts"), /premium: "resources"/);
    const hud = code(read("app/api/resources/hud-counselors/route.ts"));
    assert.ok(hud.indexOf('checkPremium(userId, "resources")') > 0 && hud.indexOf('checkPremium(userId, "resources")') < hud.indexOf("searchParams"));
  });

  it("the check runs before the call is counted", () => {
    const w = code(read("lib/withRateLimit.ts"));
    const at = w.indexOf("checkPremium(userId, opts.premium)");
    assert.ok(at > 0 && at < w.indexOf("incrementUserUsage(userId, opts.endpoint)"));
  });

  it("the page and the button use the gate", () => {
    const page = code(read("app/(dashboard)/dashboard/interview/page.tsx"));
    // Only the voice panel sits behind the gate; text practice does not.
    const gateAt = page.indexOf('<PremiumGate tool="interview_coaching" compact>');
    assert.ok(gateAt > 0);
    assert.ok(page.indexOf("<VoicePracticePanel", gateAt) > gateAt && page.indexOf("<VoicePracticePanel", gateAt) < page.indexOf("</PremiumGate>", gateAt));
    assert.ok(page.indexOf("<Suspense><InterviewPracticePage /></Suspense>") > 0);
    assert.ok(page.indexOf("Start Practice Interview") > page.indexOf("</PremiumGate>", gateAt), "the text start button is outside the gate");
    assert.match(read("components/apply/ApplyActions.tsx"), /toolIsOpen\(premium, "one_click_apply"\)/);
  });
});

describe("asking for access sends no email, and the admin side is admin only", () => {
  for (const f of ["app/api/user/premium/route.ts", "app/api/admin/premium/route.ts", "components/premium/PremiumGate.tsx", "app/(dashboard)/dashboard/admin/premium/page.tsx"]) {
    it(`${f}: no email provider, no mail call`, () => {
      assert.doesNotMatch(code(read(f)), /resend|sendEmail|nodemailer|api\.resend\.com|RESEND_API_KEY/i);
    });
  }

  it("the request is same-origin JSON, signed in, rate limited", () => {
    const r = code(read("app/api/user/premium/route.ts"));
    assert.match(r, /isSameOriginJsonPost\(request\.headers\)/);
    assert.match(r, /forgeSessionUser\(await auth\(\)\)/);
    assert.match(r, /withRateLimit\(handlePost, \{ mode: "user", endpoint: "premium-request" \}\)/);
  });

  it("the admin route checks platform admin first, in both methods", () => {
    const r = code(read("app/api/admin/premium/route.ts"));
    const get = r.slice(r.indexOf("export async function GET"), r.indexOf("export async function POST"));
    const post = r.slice(r.indexOf("export async function POST"));
    for (const body of [get, post]) {
      assert.ok(body.indexOf("requirePlatformAdmin()") > 0);
      assert.ok(body.indexOf("requirePlatformAdmin()") < body.indexOf("@crucible/core"));
    }
  });
});

describe("a locked tool's words: plain, no price, no dashes", () => {
  it("no price anywhere in the copy or the locked card", () => {
    const lines = [
      ...PREMIUM_TOOL_IDS.flatMap((t) => [premiumLockedLine(t), premiumLockedMessage(t), premiumUnavailableMessage(t)]),
      PREMIUM_INCLUDED_LINE,
      textPracticeAllowanceMessage(),
      textPracticeAllowanceLine(),
      PREMIUM_NEVER_PAY_LINE,
      PREMIUM_ASK_ORG_LINE,
      PREMIUM_ASK_SMR_LINE,
      PREMIUM_ASK_SENT_LINE,
    ];
    for (const l of lines) {
      assert.doesNotMatch(l, PRICE, l);
      assert.doesNotMatch(l, /[–—]|--/, l);
    }
    for (const f of ["components/premium/PremiumGate.tsx", "components/premium/PremiumToolsSection.tsx"]) {
      assert.doesNotMatch(code(read(f)), PRICE, f);
    }
  });
});

describe("client bundles stay clean", () => {
  it("lib/premium.ts, which client components import, never reaches @crucible/core", () => {
    const src = code(read("lib", "premium.ts"));
    assert.doesNotMatch(src, /@crucible\/core/);
    assert.doesNotMatch(src, /checkPremium/);
    for (const f of [["components", "premium", "PremiumGate.tsx"], ["components", "premium", "PremiumToolsSection.tsx"], ["components", "apply", "ApplyActions.tsx"]]) {
      assert.doesNotMatch(read(...f), /premium-server/, f.join("/"));
    }
  });
});

describe("text practice: free with an account, a daily allowance while the gate is on", () => {
  const person = "00000000-0000-4000-8000-0000000000bb";
  const other = "00000000-0000-4000-8000-0000000000cc";
  const SECRET = "test-secret-not-real";
  const NOW = Date.parse("2026-10-10T15:00:00Z");
  const first = { messages: [{ role: "assistant", content: "Tell me about yourself." }, { role: "user", content: "I run a forklift." }] };
  const padded = { messages: [...first.messages, { role: "user", content: "x" }, { role: "user", content: "y" }] };

  function counter() {
    const counts: Record<string, number> = {};
    return { counts, inc: async (_u: string, e: string) => (counts[e] = (counts[e] ?? 0) + 1) };
  }
  const base = (c: ReturnType<typeof counter>, over: Record<string, unknown> = {}) => ({
    gateRaw: "on", read: async () => ({ open: [] as string[] }), increment: c.inc, secret: SECRET, now: NOW, ...over,
  });

  it("one named allowance, a sensible number, and its counters", () => {
    assert.equal(TEXT_PRACTICE_SESSIONS_PER_DAY, 5);
    assert.equal(TEXT_PRACTICE_ENDPOINT, "interview-text-session");
    assert.equal(TEXT_PRACTICE_TURN_ENDPOINT, "interview-text-turn");
  });

  it("the first call counts a session and hands back a signed id; turns that send it back are not new sessions", async () => {
    const c = counter();
    const v = await checkTextPracticeAllowance(person, first, base(c));
    assert.equal(v.refuse, null);
    assert.ok(v.session && verifyPracticeSession(v.session, person, NOW, SECRET));
    for (let i = 0; i < 6; i++) {
      const next = await checkTextPracticeAllowance(person, { ...padded, practiceSession: v.session }, base(c));
      assert.equal(next.refuse, null);
      assert.equal(next.session, undefined, "no new id mid-session");
    }
    assert.equal(c.counts[TEXT_PRACTICE_ENDPOINT], 1);
  });

  it("review L1: padding the history or sending endInterview without the id still counts a session", async () => {
    const c = counter();
    await checkTextPracticeAllowance(person, padded, base(c));
    await checkTextPracticeAllowance(person, { ...padded, endInterview: true }, base(c));
    await checkTextPracticeAllowance(person, { endInterview: true }, base(c));
    assert.equal(c.counts[TEXT_PRACTICE_ENDPOINT], 3);
  });

  it("an id from another account, another day, or a forged one is not accepted", async () => {
    const theirs = signPracticeSession(other, NOW, SECRET);
    const yesterday = signPracticeSession(person, NOW - 86400000, SECRET);
    const forged = signPracticeSession(person, NOW, "wrong-secret");
    for (const tok of [theirs, yesterday, forged, "2026-10-10.abcdefgh.zzz", 42, ""]) {
      assert.equal(verifyPracticeSession(tok, person, NOW, SECRET), false, String(tok));
      const c = counter();
      await checkTextPracticeAllowance(person, { ...padded, practiceSession: tok }, base(c));
      assert.equal(c.counts[TEXT_PRACTICE_ENDPOINT], 1, `counted for ${String(tok)}`);
    }
  });

  it("the sixth session in a day is refused with a 429 that says when more open, no price", async () => {
    const c = counter();
    for (let i = 1; i <= TEXT_PRACTICE_SESSIONS_PER_DAY; i++) {
      assert.equal((await checkTextPracticeAllowance(person, first, base(c))).refuse, null, `session ${i}`);
    }
    const res = (await checkTextPracticeAllowance(person, first, base(c))).refuse;
    assert.equal(res?.status, 429);
    const body = await res!.json();
    assert.equal(body.code, "practice_allowance_used");
    assert.match(body.error, /5 practice interviews for today\. More open tomorrow\./);
    assert.doesNotMatch(body.error, PRICE);
  });

  it("reusing one id all day hits the daily turn ceiling", async () => {
    const c = counter();
    const v = await checkTextPracticeAllowance(person, first, base(c));
    const ceiling = TEXT_PRACTICE_SESSIONS_PER_DAY * TEXT_PRACTICE_TURNS_PER_SESSION;
    let refusedAt = 0;
    for (let i = 2; i <= ceiling + 2; i++) {
      const r = await checkTextPracticeAllowance(person, { ...padded, practiceSession: v.session }, base(c));
      if (r.refuse) { refusedAt = i; break; }
    }
    assert.equal(refusedAt, ceiling + 1);
  });

  it("without a secret every call counts as a session (fails toward counting)", async () => {
    const c = counter();
    const v = await checkTextPracticeAllowance(person, first, base(c, { secret: null }));
    assert.equal(v.session, undefined);
    await checkTextPracticeAllowance(person, { ...first, practiceSession: "anything" }, base(c, { secret: null }));
    assert.equal(c.counts[TEXT_PRACTICE_ENDPOINT], 2);
  });

  it("a sponsor (voice coaching open) removes the allowance", async () => {
    const c = counter();
    for (let i = 0; i < 10; i++) {
      assert.equal((await checkTextPracticeAllowance(person, first, base(c, { read: async () => ({ open: ["interview_coaching"] }) }))).refuse, null);
    }
    assert.deepEqual(c.counts, {});
  });

  it("gate off: no allowance, nothing read or counted", async () => {
    const c = counter();
    let read = 0;
    for (let i = 0; i < 10; i++) {
      await checkTextPracticeAllowance(person, first, base(c, { gateRaw: null, read: async () => { read++; return { open: [] as string[] }; } }));
    }
    assert.deepEqual(c.counts, {});
    assert.equal(read, 0);
  });

  it("entitlement storage missing: treated as unsponsored (the free allowance still works, nothing extra opens)", async () => {
    const c = counter();
    const notReady = async () => { throw Object.assign(new Error("x"), { premiumNotReady: true }); };
    assert.equal((await checkTextPracticeAllowance(person, first, base(c, { read: notReady, limit: 1 }))).refuse, null);
    assert.equal((await checkTextPracticeAllowance(person, first, base(c, { read: notReady, limit: 1 }))).refuse?.status, 429);
  });

  it("the route checks after the body is read and before the AI call, refunds a refused turn (I2), and returns the id", () => {
    const r = code(read("app/api/interview-practice/route.ts"));
    const at = r.indexOf("checkTextPracticeAllowance(userId, body)");
    assert.ok(at > r.indexOf("await request.json()"));
    assert.ok(at < r.indexOf("callAI("));
    const refuse = r.slice(at, r.indexOf("return verdict.refuse;", at));
    assert.match(refuse, /await refundUserUsage\(userId, "interview"\)/);
    assert.equal((r.match(/return reply\(/g) ?? []).length, 2, "the question and validated feedback replies both carry the id; malformed feedback is an error");
    const invalidFeedback = r.slice(r.indexOf("if (!parsed)"), r.indexOf("return reply(plainPunctuation"));
    assert.match(invalidFeedback, /status: 502/);
    assert.match(invalidFeedback, /practiceSession \? \{ practiceSession \} : \{\}/);
    assert.match(r, /practiceSession \? \{ \.\.\.\(payload as Record<string, unknown>\), practiceSession \} : payload/);
  });

  it("review r2 I-b: a failed AI call after a counted session still hands back the id, and the page keeps it", () => {
    const r = code(read("app/api/interview-practice/route.ts"));
    const handler = r.slice(r.indexOf("async function handlePost"));
    assert.ok(handler.indexOf("let practiceSession: string | undefined;") < handler.indexOf("try {"), "declared outside the try");
    const catchBlock = handler.slice(handler.indexOf("} catch (error: any) {"));
    assert.match(catchBlock, /\{ error: "Could not process interview", \.\.\.\(practiceSession \? \{ practiceSession \} : \{\}\) \}/);
    const page = code(read("app/(dashboard)/dashboard/interview/page.tsx"));
    const send = page.slice(page.indexOf("async function sendMessage"), page.indexOf("function buildSummaryText"));
    assert.equal((send.match(/if \(typeof data\??\.practiceSession === "string"\) practiceSessionRef\.current = data\.practiceSession;/g) ?? []).length, 2, "kept on success and on failure");
  });

  it("the page keeps the id for the interview and sends it on every turn and the wrap-up", () => {
    const page = code(read("app/(dashboard)/dashboard/interview/page.tsx"));
    assert.equal((page.match(/practiceSession: practiceSessionRef\.current \?\? undefined/g) ?? []).length, 2);
    assert.match(page, /if \(typeof data\.practiceSession === "string"\) practiceSessionRef\.current = data\.practiceSession;/);
    assert.match(page, /setExchangeCount\(0\);\s*practiceSessionRef\.current = null;/);
  });

  it("the page shows the allowance line only while it applies", () => {
    const page = code(read("app/(dashboard)/dashboard/interview/page.tsx"));
    assert.match(page, /practiceAllowanceApplies = !!premiumStatus\?\.gate && toolIsOpen\(premiumStatus, "interview_coaching"\) === false/);
    assert.match(page, /\{practiceAllowanceApplies && \(/);
  });

  it("review L2: the allowance counters are not shown as AI calls", async () => {
    const { NON_AI_USAGE_ENDPOINTS, DAILY_USAGE_SQL } = await import("@crucible/core");
    for (const e of [TEXT_PRACTICE_ENDPOINT, TEXT_PRACTICE_TURN_ENDPOINT, "headshot_upload"]) {
      assert.ok((NON_AI_USAGE_ENDPOINTS as readonly string[]).includes(e), e);
      assert.ok(DAILY_USAGE_SQL.includes(`'${e}'`), e);
    }
    assert.match(DAILY_USAGE_SQL, /endpoint NOT IN \(/);
    assert.match(DAILY_USAGE_SQL, /endpoint NOT LIKE 'vault_%'/);
  });
});

describe("readiness (A8)", () => {
  it("the verdict: gate off is always ok; gate on needs the tables", async () => {
    const { premiumReadiness } = await import("@crucible/core");
    assert.deepEqual(premiumReadiness(false, null), { ok: true, gate: false, ready: null });
    assert.equal(premiumReadiness(true, true).ok, true);
    assert.equal(premiumReadiness(true, false).ok, false);
    assert.equal(premiumReadiness(true, null).ok, false, "could not check: not ok");
  });

  it("/api/health/premium: platform admin only, before anything is read; 503 when the gate is on and storage is not ready", () => {
    const r = code(read("app/api/health/premium/route.ts"));
    const get = r.slice(r.indexOf("export async function GET"));
    assert.ok(get.indexOf("requirePlatformAdmin()") > 0);
    assert.ok(get.indexOf("if (!admin.ok) return admin.response;") < get.indexOf("premiumGateOn()"));
    assert.ok(get.indexOf("if (!admin.ok) return admin.response;") < get.indexOf("cachedPremiumStorageReady()"));
    assert.match(get, /premiumReadiness\(true, await cachedPremiumStorageReady\(\)\)/);
    assert.match(get, /status: verdict\.ok \? 200 : 503/);
    assert.doesNotMatch(get, /premiumStorageReady\(\)/, "only the cached read");
  });

  it("review L5: the table check is asked at most once a minute", async () => {
    resetPremiumReadyCache();
    let calls = 0;
    const read = async () => { calls++; return true; };
    const t0 = 1_000_000;
    assert.equal(await cachedPremiumStorageReady(read, t0), true);
    assert.equal(await cachedPremiumStorageReady(read, t0 + 30_000), true);
    assert.equal(await cachedPremiumStorageReady(read, t0 + PREMIUM_READY_CACHE_MS - 1), true);
    assert.equal(calls, 1);
    assert.equal(await cachedPremiumStorageReady(read, t0 + PREMIUM_READY_CACHE_MS), true);
    assert.equal(calls, 2);
    resetPremiumReadyCache();
    assert.equal(await cachedPremiumStorageReady(async () => { throw new Error("db down"); }, t0), null, "could not check");
    resetPremiumReadyCache();
  });
});

describe("RL4: the Refinery tour names its earned access and remaining limits", () => {
  it("guided tools and AI limits are explained before the quiz", () => {
    const tour = code(read("components/GuidedTour.tsx"));
    assert.doesNotMatch(tour, /If you qualify/);
    const lesson = read("lib/tour/beats.ts");
    assert.match(lesson, /open guided tailoring and application tools early/);
    assert.match(lesson, /AI limits still apply/);
    assert.doesNotMatch(tour, /Every tool\. For free\./);
    assert.doesNotMatch(tour, PRICE);
  });
});
