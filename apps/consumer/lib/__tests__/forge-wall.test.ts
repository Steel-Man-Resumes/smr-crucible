/**
 * Lane 3a, part 1: the Forge sign-in wall, the signed-out allowlist, the
 * return trip through sign-in, pending sessions, and the per-account limits.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  FORGE_PUBLIC_PAGES,
  FORGE_SIGN_IN_PAGES,
  FORGE_SIGN_IN_STARTS_AT,
  FORGE_SIGNED_OUT_API_ALLOWLIST,
  forgeSignInUrl,
  forgeWallDateLabel,
  forgeWallNotice,
  forgeWallStartsAt,
  forgeWallState,
  isForgeSignInPage,
  isForgeSignedOutApi,
  isMiniForgePath,
} from "../forge-access";
import {
  forgeAnonymousRequestHeaders,
  forgeApiNeedsSession,
  forgeGateVerdict,
  isForgeAnonymousApiRoute,
  pendingSessionTreatment,
  safeLoginReturn,
} from "../session-policy";
import { SIGNED_IN_IP_FLOOR_PEOPLE, overLimit, planForgeLimit } from "../forge-rate-limit";

const root = join(import.meta.dirname, "..", "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

const NOW = Date.parse("2026-10-07T12:00:00Z");
const PENDING = { mfa: false, claim: null };
const PENDING_CHOICE = { mfa: true, claim: "2fa" };
const FULL = { mfa: true, claim: null };

/** Every API route the Forge called signed out before the wall. */
const OLD_ANONYMOUS = [
  "/api/parse",
  "/api/analyze",
  "/api/rush-resume",
  "/api/forge/generate-docs",
  "/api/forge/download",
  "/api/forge/email-package",
  "/api/forge/resume-assist",
  "/api/resume/fit-check",
  "/api/resume/layout",
  "/api/assistant",
  "/api/org-listing",
];
const WALLED = OLD_ANONYMOUS.filter((p) => !["/api/resume/layout", "/api/assistant", "/api/org-listing"].includes(p));

describe("the date the wall goes up", () => {
  it("ships with no date: the owner sets it, nothing is made up", () => {
    assert.equal(FORGE_SIGN_IN_STARTS_AT, null);
    assert.equal(forgeWallState({ now: NOW, override: null }), "open");
    assert.equal(forgeWallNotice("open"), null);
  });

  it("is announced before the date, up from the date on", () => {
    const at = "2026-11-02T00:00:00-07:00";
    assert.equal(forgeWallState({ now: NOW, startsAt: at, override: null }), "announced");
    assert.equal(forgeWallState({ now: Date.parse(at) - 1, startsAt: at, override: null }), "announced");
    assert.equal(forgeWallState({ now: Date.parse(at), startsAt: at, override: null }), "up");
  });

  it("the deployment switch wins: on is up now, off is open with no notice", () => {
    const at = "2026-11-02T00:00:00-07:00";
    assert.equal(forgeWallState({ now: NOW, startsAt: null, override: "on" }), "up");
    assert.equal(forgeWallState({ now: Date.parse(at) + 1, startsAt: at, override: "off" }), "open");
    assert.equal(forgeWallState({ now: NOW, startsAt: at, override: "maybe" }), "announced");
  });

  it("refuses a date it would have to guess at (no time, no offset, nonsense)", () => {
    for (const bad of ["2026-11-02", "2026-11-02T00:00:00", "November 2", "", "  ", "2026-13-40T00:00:00Z"]) {
      assert.equal(forgeWallStartsAt(bad), null, bad);
      assert.equal(forgeWallState({ now: NOW, startsAt: bad, override: null }), "open", bad);
    }
    assert.ok(forgeWallStartsAt("2026-11-02T09:00:00Z"));
  });

  it("the notice names the typed date, in plain words, with no dash", () => {
    const at = "2026-11-02T00:00:00-07:00";
    assert.equal(forgeWallDateLabel(at), "November 2");
    const notice = forgeWallNotice("announced", at);
    assert.equal(notice, "Starting November 2, the Forge asks you to sign in. It's still free. Your saved work comes with you.");
    assert.doesNotMatch(notice!, /[–—]|--/);
    assert.equal(forgeWallNotice("up", at), null);
    assert.equal(forgeWallNotice("announced", null), null);
  });
});

describe("pages: walled, public, Mini Forge", () => {
  it("the Forge question and build screens are walled; public pages and the checker are not", () => {
    for (const p of FORGE_SIGN_IN_PAGES) assert.ok(isForgeSignInPage(p), p);
    for (const p of FORGE_PUBLIC_PAGES) assert.equal(isForgeSignInPage(p), false, p);
    assert.ok(FORGE_PUBLIC_PAGES.includes("/check" as any));
    assert.ok(isForgeSignInPage("/story/"));
    for (const p of ["/storybook", "/resume-builder", "/welcome-back", "/mini-forge/q/1", "/dashboard"]) {
      assert.equal(isForgeSignInPage(p), false, p);
    }
  });

  it("every Mini Forge path stays open and outside the middleware", () => {
    const mw = read("middleware.ts");
    assert.doesNotMatch(mw, /"\/mini-forge/);
    assert.ok(isMiniForgePath("/mini-forge"));
    assert.ok(isMiniForgePath("/mini-forge/results"));
    for (const p of ["/mini-forge", "/mini-forge/pin", "/mini-forge/q/2", "/mini-forge/import-complete"]) {
      assert.equal(forgeGateVerdict(p, false, true), "continue", p);
    }
  });

  it("the middleware matcher lists exactly the walled pages, and no public page", () => {
    const mw = read("middleware.ts");
    const matcher = mw.slice(mw.indexOf("matcher:"), mw.indexOf("],", mw.indexOf("matcher:")));
    for (const p of FORGE_SIGN_IN_PAGES) assert.match(matcher, new RegExp(`"${p}",`), p);
    for (const p of FORGE_PUBLIC_PAGES) assert.doesNotMatch(matcher, new RegExp(`"${p}"`), p);
  });
});

describe("signed out on a Forge screen goes to sign-in and comes straight back", () => {
  it("wall up: signed out goes to sign-in, signed in continues", () => {
    for (const p of FORGE_SIGN_IN_PAGES) {
      assert.equal(forgeGateVerdict(p, false, true), "sign-in", p);
      assert.equal(forgeGateVerdict(p, true, true), "continue", p);
    }
  });

  it("wall down: the screens are untouched, signed in or out (no hold, no redirect)", () => {
    for (const p of FORGE_SIGN_IN_PAGES) {
      assert.equal(forgeGateVerdict(p, false, false), "open", p);
      assert.equal(forgeGateVerdict(p, true, false), "open", p);
    }
  });

  it("the sign-in address carries this page and query, and the login page returns there", () => {
    const back = "/story?step=2&x=a b";
    const url = forgeSignInUrl(back);
    assert.ok(url.startsWith("/login?from=forge&callbackUrl="));
    const parsed = new URL(url, "https://forge.example.org");
    assert.equal(parsed.searchParams.get("callbackUrl"), back);
    assert.equal(safeLoginReturn(parsed.searchParams.get("callbackUrl")), back);
    assert.equal(new URL(safeLoginReturn(back), "https://forge.example.org").host, "forge.example.org");
  });

  it("the return address can never leave the site, loop, or land on an API", () => {
    const bad = [
      null,
      "",
      "https://evil.example.com/x",
      "//evil.example.com",
      "/\\evil.example.com",
      "/\t/evil.example.com",
      "/\n/evil.example.com",
      "javascript:alert(1)",
      "/login",
      "/login?callbackUrl=/story",
      "/login/verify",
      "/api/forge/save",
    ];
    for (const b of bad) {
      const r = safeLoginReturn(b as any);
      assert.equal(r, "/dashboard", JSON.stringify(b));
      assert.equal(new URL(r, "https://forge.example.org").host, "forge.example.org");
    }
  });

  it("auth.ts uses the verdict: redirect with the request's own path and query, and checks revocation on Forge screens", () => {
    const a = read("auth.ts");
    assert.match(a, /forgeGateVerdict\(path, !!session, wallUp\)/);
    assert.match(a, /if \(gate === "open"\) return true;/);
    assert.match(a, /forgeSignInUrl\(path \+ request\.nextUrl\.search\)/);
    assert.match(a, /isDashboard \|\| isForgeScreen \|\|/);
    assert.match(a, /pendingSessionTreatment\(path, session\.user as any, wallUp\)/);
  });
});

describe("the signed-out API allowlist is exact", () => {
  it("names exactly these routes, each with a reason", () => {
    assert.deepEqual(Object.keys(FORGE_SIGNED_OUT_API_ALLOWLIST).sort(), [
      "/api/assistant",
      "/api/check/extract",
      "/api/org-listing",
      "/api/resume/layout",
    ]);
    for (const [route, reason] of Object.entries(FORGE_SIGNED_OUT_API_ALLOWLIST)) {
      assert.ok(reason.length > 40, route);
      assert.doesNotMatch(reason, /[–—]/, route);
      assert.ok(existsSync(join(root, "app", route, "route.ts")), route);
    }
  });

  it("wall up: every other Forge route needs a session; wall down: none does", () => {
    for (const p of WALLED) {
      assert.equal(forgeApiNeedsSession(p, true), true, p);
      assert.equal(forgeApiNeedsSession(p, false), false, p);
      assert.equal(forgeGateVerdict(p, false, true), "refuse", p);
      assert.equal(forgeGateVerdict(p, true, true), "continue", p);
      assert.equal(forgeGateVerdict(p, false, false), "continue", p);
    }
    for (const p of Object.keys(FORGE_SIGNED_OUT_API_ALLOWLIST)) {
      assert.equal(forgeApiNeedsSession(p, true), false, p);
      assert.equal(forgeGateVerdict(p, false, true), "continue", p);
    }
  });

  it("account routes are not touched by the Forge rule (they keep their own 401)", () => {
    for (const p of ["/api/forge/save", "/api/forge/load", "/api/user/profile", "/api/dashboard/stats"]) {
      assert.equal(forgeApiNeedsSession(p, true), false, p);
      assert.equal(isForgeSignedOutApi(p), false, p);
    }
  });

  it("matches exact paths only", () => {
    for (const p of ["/api/assistant/", "/api/assistantx", "/api/check/extract/x", "/api/resume/layoutx"]) {
      assert.equal(isForgeSignedOutApi(p), false, p);
    }
  });
});

describe("pending sessions (mid second step) never reach Forge data", () => {
  it("wall up: held on every walled route and every Forge screen", () => {
    for (const user of [PENDING, PENDING_CHOICE]) {
      for (const p of [...WALLED, ...FORGE_SIGN_IN_PAGES]) {
        assert.equal(pendingSessionTreatment(p, user, true), "hold", `${p} ${JSON.stringify(user)}`);
      }
    }
  });

  it("wall up: served as signed out (cookie stripped) only on the allowlist", () => {
    const h = new Headers({ cookie: "authjs.session-token=abc; other=1" });
    for (const p of Object.keys(FORGE_SIGNED_OUT_API_ALLOWLIST)) {
      assert.ok(isForgeAnonymousApiRoute(p), p);
      assert.equal(pendingSessionTreatment(p, PENDING, true), "anonymous", p);
      assert.equal(forgeAnonymousRequestHeaders(p, PENDING, h, true)?.get("cookie"), "other=1", p);
    }
    for (const p of WALLED) assert.equal(forgeAnonymousRequestHeaders(p, PENDING, h, true), null, p);
  });

  it("wall down: the S1 rule is unchanged (every Forge route served as signed out)", () => {
    for (const p of OLD_ANONYMOUS) assert.equal(pendingSessionTreatment(p, PENDING, false), "anonymous", p);
  });

  it("a full session is never held or made anonymous", () => {
    for (const p of [...WALLED, ...FORGE_SIGN_IN_PAGES]) assert.equal(pendingSessionTreatment(p, FULL, true), "none", p);
  });

  it("the checker route is treated like the other signed-out Forge routes", () => {
    assert.ok(isForgeAnonymousApiRoute("/api/check/extract"));
    assert.equal(pendingSessionTreatment("/api/check/extract", PENDING, false), "anonymous");
  });
});

describe("limits: per account when signed in, per IP as the floor", () => {
  it("signed in: counted per account, with an IP ceiling sized for a shared network", () => {
    const plan = planForgeLimit({ userId: "u1", needsSession: true, perPerson: 5, tierLimit: 30 });
    assert.deepEqual(plan, { kind: "account", userId: "u1", perAccount: 5, ipCeiling: 5 * SIGNED_IN_IP_FLOOR_PEOPLE });
  });

  it("unlimited tiers skip the per-account count, never the IP floor", () => {
    const plan = planForgeLimit({ userId: "u1", needsSession: true, perPerson: 5, tierLimit: 0 });
    assert.equal(plan.kind, "account");
    if (plan.kind === "account") {
      assert.equal(plan.perAccount, null);
      assert.equal(plan.ipCeiling, 50);
    }
  });

  it("signed out: refused on a walled route, per IP on an open one", () => {
    assert.deepEqual(planForgeLimit({ userId: null, needsSession: true, perPerson: 5, tierLimit: 5 }), { kind: "refuse" });
    assert.deepEqual(planForgeLimit({ userId: null, needsSession: false, perPerson: 400, tierLimit: 400 }), { kind: "ip", perIp: 400 });
  });

  it("over the limit only past it", () => {
    assert.equal(overLimit(5, 5), false);
    assert.equal(overLimit(6, 5), true);
    assert.equal(overLimit(1_000, null), false);
  });

  it("every Forge route uses the forge mode; the signed-in floor has its own counter", () => {
    const routes = [
      "app/api/parse/route.ts",
      "app/api/analyze/route.ts",
      "app/api/rush-resume/route.ts",
      "app/api/forge/generate-docs/route.ts",
      "app/api/forge/download/route.ts",
      "app/api/forge/email-package/route.ts",
      "app/api/forge/resume-assist/route.ts",
      "app/api/resume/fit-check/route.ts",
      "app/api/resume/layout/route.ts",
      "app/api/check/extract/route.ts",
    ];
    for (const r of routes) {
      const src = read(r);
      assert.match(src, /mode: "forge"/, r);
      assert.doesNotMatch(src, /mode: "ip"/, r);
    }
    assert.match(read("app/api/org-listing/route.ts"), /withRateLimit\(handlePost, \{ mode: "ip", endpoint: "org-listing", poolable: false \}\)/);
    assert.match(read("lib/forge-rate-limit.ts"), /`signed-in:\$\{input\.endpoint\}`/);
  });
});
