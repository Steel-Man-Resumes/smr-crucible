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
  premiumGateOn,
  premiumLockedLine,
  premiumLockedMessage,
  toolIsOpen,
} from "../premium";
import { checkPremium } from "../premium-server";

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
      assert.equal(await checkPremium(person, "resources", async () => ({ open: [] })), null, "unset: open");
      process.env.PREMIUM_GATE = "on";
      assert.equal(premiumGateOn(), true);
      assert.equal((await checkPremium(person, "resources", async () => ({ open: [] })))?.status, 403, "on: locked");
    } finally {
      if (saved === undefined) delete process.env.PREMIUM_GATE;
      else process.env.PREMIUM_GATE = saved;
    }
  });

  it("the status route opens everything when the gate is off", () => {
    const src = read("app", "api", "user", "premium", "route.ts");
    assert.match(src, /if \(!premiumGateOn\(\)\) return NextResponse\.json\(\{ data: ALL_OPEN\(\) \}\)/);
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
    assert.equal(await checkPremium(person, "resources", async () => ({ open: ["resources"] }), "on"), null);
  });

  it("a grant for one tool does not open another", async () => {
    const res = await checkPremium(person, "one_click_apply", async () => ({ open: ["interview_coaching"] }), "on");
    assert.equal(res?.status, 403);
  });

  it("off (the default): everything passes without reading anything", async () => {
    let read = 0;
    assert.equal(await checkPremium(person, "resources", async () => { read++; return { open: [] }; }, "off"), null);
    assert.equal(await checkPremium(person, "resources", async () => { read++; return { open: [] }; }, null), null);
    assert.equal(await checkPremium(person, "resources", async () => { read++; return { open: [] }; }, ""), null);
    assert.equal(read, 0);
  });

  it("078 not applied yet: open, as before; any other error is not swallowed", async () => {
    const notReady = async () => { throw Object.assign(new Error("x"), { premiumNotReady: true }); };
    assert.equal(await checkPremium(person, "resources", notReady, "on"), null);
    await assert.rejects(checkPremium(person, "resources", async () => { throw new Error("db down"); }, "on"), /db down/);
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
    assert.match(read("app/api/interview-practice/route.ts"), /premium: "interview_coaching"/);
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
    assert.match(read("app/(dashboard)/dashboard/interview/page.tsx"), /<PremiumGate tool="interview_coaching">/);
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
      ...PREMIUM_TOOL_IDS.flatMap((t) => [premiumLockedLine(t), premiumLockedMessage(t)]),
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
