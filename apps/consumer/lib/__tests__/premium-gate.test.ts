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
import { TEXT_PRACTICE_ENDPOINT, checkPremium, checkTextPracticeAllowance, isTextPracticeStart } from "../premium-server";

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
  const first = { messages: [{ role: "assistant", content: "Tell me about yourself." }, { role: "user", content: "I run a forklift." }] };
  const later = { messages: [...first.messages, { role: "assistant", content: "Go on." }, { role: "user", content: "Five years." }] };

  function counter() {
    let n = 0;
    const calls: string[] = [];
    return { calls, get n() { return n; }, inc: async (_u: string, e: string) => { calls.push(e); return ++n; } };
  }

  it("one named allowance, a sensible number", () => {
    assert.equal(TEXT_PRACTICE_SESSIONS_PER_DAY, 5);
    assert.equal(TEXT_PRACTICE_ENDPOINT, "interview-text-session");
  });

  it("a session starts with the first answer; later turns and the wrap-up are not new sessions", () => {
    assert.equal(isTextPracticeStart(first), true);
    assert.equal(isTextPracticeStart(later), false);
    assert.equal(isTextPracticeStart({ ...later, endInterview: true }), false);
    assert.equal(isTextPracticeStart(null), true, "unreadable counts as a start");
    assert.equal(isTextPracticeStart({ messages: "x" }), true);
  });

  it("the sixth session in a day is refused with a 429 that says when more open, no price", async () => {
    const c = counter();
    const deps = { gateRaw: "on", read: async () => ({ open: [] as string[] }), increment: c.inc };
    for (let i = 1; i <= TEXT_PRACTICE_SESSIONS_PER_DAY; i++) {
      assert.equal(await checkTextPracticeAllowance(person, first, deps), null, `session ${i}`);
    }
    const res = await checkTextPracticeAllowance(person, first, deps);
    assert.equal(res?.status, 429);
    const body = await res!.json();
    assert.equal(body.code, "practice_allowance_used");
    assert.match(body.error, /5 practice interviews for today\. More open tomorrow\./);
    assert.doesNotMatch(body.error, PRICE);
    assert.ok(c.calls.every((e) => e === TEXT_PRACTICE_ENDPOINT));
  });

  it("later turns in a session are never counted or refused", async () => {
    const c = counter();
    const deps = { gateRaw: "on", read: async () => ({ open: [] as string[] }), increment: c.inc };
    for (let i = 0; i < 20; i++) assert.equal(await checkTextPracticeAllowance(person, later, deps), null);
    assert.equal(c.n, 0);
  });

  it("a sponsor (voice coaching open) removes the allowance", async () => {
    const c = counter();
    const deps = { gateRaw: "on", read: async () => ({ open: ["interview_coaching"] }), increment: c.inc };
    for (let i = 0; i < 10; i++) assert.equal(await checkTextPracticeAllowance(person, first, deps), null);
    assert.equal(c.n, 0);
  });

  it("gate off: no allowance, nothing read or counted", async () => {
    const c = counter();
    let read = 0;
    const deps = { gateRaw: null, read: async () => { read++; return { open: [] as string[] }; }, increment: c.inc };
    for (let i = 0; i < 10; i++) assert.equal(await checkTextPracticeAllowance(person, first, deps), null);
    assert.equal(c.n + read, 0);
  });

  it("entitlement storage missing: treated as unsponsored (the free allowance still works, nothing extra opens)", async () => {
    const c = counter();
    const notReady = async () => { throw Object.assign(new Error("x"), { premiumNotReady: true }); };
    const deps = { gateRaw: "on", read: notReady, increment: c.inc, limit: 1 };
    assert.equal(await checkTextPracticeAllowance(person, first, deps), null);
    assert.equal((await checkTextPracticeAllowance(person, first, deps))?.status, 429);
  });

  it("the route checks the allowance after the body is read and before the AI call", () => {
    const r = code(read("app/api/interview-practice/route.ts"));
    const at = r.indexOf("checkTextPracticeAllowance(userId, body)");
    assert.ok(at > r.indexOf("await request.json()"));
    assert.ok(at < r.indexOf("callAI("));
  });

  it("the page shows the allowance line only while it applies", () => {
    const page = code(read("app/(dashboard)/dashboard/interview/page.tsx"));
    assert.match(page, /practiceAllowanceApplies = !!premiumStatus\?\.gate && toolIsOpen\(premiumStatus, "interview_coaching"\) === false/);
    assert.match(page, /\{practiceAllowanceApplies && \(/);
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

  it("/api/health/premium answers 503 when the gate is on and storage is not ready", () => {
    const r = code(read("app/api/health/premium/route.ts"));
    assert.match(r, /premiumReadiness\(true, ready\)/);
    assert.match(r, /status: verdict\.ok \? 200 : 503/);
    assert.match(r, /if \(!gate\) return/);
  });
});
