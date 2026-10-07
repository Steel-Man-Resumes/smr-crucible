/**
 * S1 (2026-10-06): a session still owing its two-step code (or first-proof
 * choice) must not break the Forge, and must gain nothing from being half
 * signed in. On the Forge routes that work signed out it is served exactly as
 * no session; everywhere else the hold is unchanged.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { NextResponse } from "next/server";
import {
  authRouteSkipsSessionChecks,
  forgeAnonymousRequestHeaders,
  forgeSessionUser,
  forgeUserId,
  headersWithoutSessionCookie,
  isAdminPowerPath,
  isForgeAnonymousApiRoute,
  isSessionCookieName,
  mfaGateApplies,
  pendingSessionTreatment,
  revocationVerdict,
} from "../session-policy";
import { isSessionCookieName as guardsIsSessionCookieName } from "../sign-in-guards";
import { FORGE_UPLOAD_SIGN_IN_MESSAGE, forgeUploadErrorMessage } from "../forge-upload-error";

const FORGE_ROUTES = [
  "/api/parse",
  "/api/analyze",
  "/api/rush-resume",
  "/api/forge/generate-docs",
  "/api/forge/download",
  "/api/forge/email-package",
  "/api/forge/resume-assist",
  "/api/resume/fit-check",
  "/api/assistant",
  "/api/org-listing",
];

const ACCOUNT_ROUTES = [
  "/api/forge/save",
  "/api/forge/load",
  "/api/forge/summary",
  "/api/session-status",
  "/api/consent",
  "/api/sharing/join-prompt",
  "/api/support-request",
  "/api/user/context",
  "/api/user/ui-prefs",
  "/api/coach",
  "/api/coach/settings",
  "/api/dashboard/stats",
  "/api/artifacts",
  "/api/resume-generate",
  "/api/resume-generate-full",
  "/api/vault/items",
  "/api/admin/users",
  "/api/dev/impersonate",
  "/api/org/clients/1",
  "/api/partner/cohort",
  "/api/auth/set-password",
  "/api/auth/session-ping",
  "/dashboard",
  "/dashboard/settings",
];

const PENDING_CODE = { mfa: false, claim: null };
const PENDING_2FA_CHOICE = { mfa: true, claim: "2fa" };
const PENDING_PASSWORD_CHOICE = { mfa: true, claim: "password" };
const FULL = { mfa: true, claim: null };

describe("pending session on the Forge routes that work signed out", () => {
  it("is served as signed out (code owed, or either first-proof choice owed)", () => {
    for (const user of [PENDING_CODE, PENDING_2FA_CHOICE, PENDING_PASSWORD_CHOICE]) {
      for (const p of FORGE_ROUTES) {
        assert.equal(pendingSessionTreatment(p, user), "anonymous", `${p} ${JSON.stringify(user)}`);
      }
    }
  });

  it("is still held (pages to the code page, APIs 401) on every account route", () => {
    for (const user of [PENDING_CODE, PENDING_2FA_CHOICE, PENDING_PASSWORD_CHOICE]) {
      for (const p of ACCOUNT_ROUTES) {
        assert.equal(pendingSessionTreatment(p, user), "hold", `${p} ${JSON.stringify(user)}`);
      }
    }
  });

  it("matches exact paths only, never a lookalike", () => {
    for (const p of [
      "/api/parse/",
      "/api/parse/x",
      "/api/parsex",
      "/api/Parse",
      "/api/assistant/history",
      "/api/forge",
      "/api/forge/",
      "/api/resume",
      "/api/resume/fit-check/x",
      "/parse",
      "/api/org-listing/admin",
    ]) {
      assert.equal(isForgeAnonymousApiRoute(p), false, p);
      assert.equal(pendingSessionTreatment(p, PENDING_CODE), "hold", p);
    }
  });

  it("leaves the step-up and sign-in routes as they were", () => {
    for (const p of ["/api/auth/mfa-verify", "/api/auth/claim-password", "/api/auth/claim-reset", "/api/auth/session", "/api/auth/signout"]) {
      assert.equal(pendingSessionTreatment(p, PENDING_CODE), "none", p);
    }
  });

  it("changes the hold only on the Forge list: every listed path was held before", () => {
    for (const p of FORGE_ROUTES) {
      assert.equal(mfaGateApplies(p), true, p);
      assert.equal(isAdminPowerPath(p), false, p);
      assert.equal(authRouteSkipsSessionChecks(p), false, p);
    }
  });
});

describe("full session and no session are unchanged", () => {
  it("a fully signed-in session is never held or made anonymous", () => {
    for (const p of [...FORGE_ROUTES, ...ACCOUNT_ROUTES]) {
      assert.equal(pendingSessionTreatment(p, FULL), "none", p);
      assert.equal(pendingSessionTreatment(p, { mfa: true }), "none", p);
    }
  });

  it("no session is never held or made anonymous", () => {
    for (const p of [...FORGE_ROUTES, ...ACCOUNT_ROUTES]) {
      assert.equal(pendingSessionTreatment(p, null), "none", p);
      assert.equal(pendingSessionTreatment(p, undefined), "none", p);
    }
  });
});

describe("revoked session is unchanged on the Forge routes", () => {
  it("the revocation check still runs there (it is not an /api/auth skip route)", () => {
    for (const p of FORGE_ROUTES) assert.equal(authRouteSkipsSessionChecks(p), false, p);
  });

  it("a revoked row still means revoked", () => {
    assert.equal(revocationVerdict({ row: { revoked: true }, signedInAt: null, sweptSinceCutoff: null }), true);
  });
});

describe("the request a pending session's Forge call reaches the route with", () => {
  it("drops every Auth.js session cookie and keeps the rest", () => {
    const h = new Headers({
      cookie:
        "smr_access=ABC; authjs.session-token=aaa; __Secure-authjs.session-token.0=bbb;__Secure-authjs.session-token.1=ccc ;authjs.csrf-token=ddd; authjs.callback-url=eee",
      "x-real-ip": "1.2.3.4",
    });
    const out = headersWithoutSessionCookie(h);
    assert.equal(out.get("cookie"), "smr_access=ABC; authjs.csrf-token=ddd; authjs.callback-url=eee");
    assert.equal(out.get("x-real-ip"), "1.2.3.4");
    // The original request headers are not modified.
    assert.match(h.get("cookie") ?? "", /authjs\.session-token=aaa/);
  });

  it("removes the Cookie header when the session was the only cookie", () => {
    const out = headersWithoutSessionCookie(new Headers({ cookie: "__Secure-authjs.session-token=zzz" }));
    assert.equal(out.has("cookie"), false);
  });

  it("is a no-op without cookies", () => {
    const out = headersWithoutSessionCookie(new Headers({ accept: "application/json" }));
    assert.equal(out.has("cookie"), false);
    assert.equal(out.get("accept"), "application/json");
  });

  it("recognizes every name Auth.js reads as the session (prefix rule, like its SessionStore)", () => {
    for (const n of [
      "authjs.session-token",
      "__Secure-authjs.session-token",
      "authjs.session-token.0",
      "__Secure-authjs.session-token.12",
      "authjs.session-token-x",
      "authjs.session-tokenZ",
      "authjs.session-token.a",
      "authjs.session-token.0x",
      "__Secure-authjs.session-token-x",
    ]) {
      assert.equal(isSessionCookieName(n), true, n);
    }
    for (const n of ["xauthjs.session-token", "authjs.csrf-token", "__Host-authjs.csrf-token", "next-auth.session-token", "smr_impersonate", "authjs.session"]) {
      assert.equal(isSessionCookieName(n), false, n);
    }
    assert.equal(guardsIsSessionCookieName, isSessionCookieName);
  });

  it("strips renamed and repeated session cookies too", () => {
    const out = headersWithoutSessionCookie(
      new Headers({
        cookie:
          "authjs.session-token-x=a; authjs.session-tokenZ=b; authjs.session-token.a=c; authjs.session-token.0x=d; " +
          "authjs.session-token=e; authjs.session-token=f; \tauthjs.session-token.1=g; keep=1",
      })
    );
    assert.equal(out.get("cookie"), "keep=1");
  });
});

describe("lock 1: the request the middleware forwards", () => {
  const COOKIE = "smr_access=ABC; authjs.session-token=aaa; authjs.session-token-x=bbb";

  it("pending session on a Forge route: forwarded with no session cookie", () => {
    const h = forgeAnonymousRequestHeaders("/api/parse", PENDING_CODE, new Headers({ cookie: COOKIE }));
    assert.ok(h);
    // The same call the middleware makes, and what Next forwards to the route.
    const res = NextResponse.next({ request: { headers: h } });
    assert.equal(res.headers.get("x-middleware-request-cookie"), "smr_access=ABC");
    assert.match(res.headers.get("x-middleware-override-headers") ?? "", /cookie/);
  });

  it("leaves every other request as it is", () => {
    const h = new Headers({ cookie: COOKIE });
    assert.equal(forgeAnonymousRequestHeaders("/api/parse", FULL, h), null);
    assert.equal(forgeAnonymousRequestHeaders("/api/parse", null, h), null);
    assert.equal(forgeAnonymousRequestHeaders("/api/forge/save", PENDING_CODE, h), null);
    assert.equal(forgeAnonymousRequestHeaders("/api/auth/mfa-verify", PENDING_CODE, h), null);
  });

  it("middleware.ts forwards exactly those headers, and auth.ts holds only on \"hold\"", () => {
    const mw = readFileSync(join(__dirname, "..", "..", "middleware.ts"), "utf8");
    assert.match(mw, /import \{ forgeAnonymousRequestHeaders \} from "@\/lib\/session-policy"/);
    assert.match(mw, /forgeAnonymousRequestHeaders\(req\.nextUrl\.pathname, req\.auth\?\.user as any, req\.headers\)/);
    assert.match(mw, /NextResponse\.next\(\{ request: \{ headers: anonymousHeaders \} \}\)/);
    const authTs = readFileSync(join(__dirname, "..", "..", "auth.ts"), "utf8");
    assert.match(authTs, /pendingSessionTreatment\(path, session\.user as any\) === "hold"/);
    assert.doesNotMatch(authTs, /mfaGateApplies\(path\)/);
  });
});

describe("lock 2: Forge routes never credit a pending session", () => {
  it("returns no user for a pending session, the user for a full one", () => {
    for (const extra of [PENDING_CODE, PENDING_2FA_CHOICE, PENDING_PASSWORD_CHOICE]) {
      const s = { user: { id: "u1", email: "a@example.org", ...extra } };
      assert.equal(forgeUserId(s as any), undefined, JSON.stringify(extra));
      assert.equal(forgeSessionUser(s as any), null, JSON.stringify(extra));
    }
    const full = { user: { id: "u1", email: "a@example.org", ...FULL } };
    assert.equal(forgeUserId(full as any), "u1");
    assert.deepEqual(forgeSessionUser(full as any), { id: "u1", email: "a@example.org" });
    assert.equal(forgeUserId(null), undefined);
    assert.equal(forgeUserId({ user: { id: "", ...FULL } } as any), undefined);
  });

  it("every listed route that reads the session takes the user through the helper", () => {
    const root = join(__dirname, "..", "..", "app");
    for (const p of FORGE_ROUTES) {
      const src = readFileSync(join(root, p, "route.ts"), "utf8");
      const readsSession = /\bauth\(/.test(src);
      if (!readsSession) continue;
      assert.match(src, /forge(UserId|SessionUser)\(session\)/, p);
      assert.doesNotMatch(src, /session\??\.user/, p);
    }
  });
});

describe("Forge upload error message", () => {
  it("a 401 says the file is fine and names the sign-in, never the file", () => {
    assert.equal(forgeUploadErrorMessage(401, "Enter your two-step code to finish signing in."), FORGE_UPLOAD_SIGN_IN_MESSAGE);
    assert.equal(forgeUploadErrorMessage(401, "Session revoked"), FORGE_UPLOAD_SIGN_IN_MESSAGE);
    assert.match(FORGE_UPLOAD_SIGN_IN_MESSAGE, /file is fine/);
    assert.doesNotMatch(FORGE_UPLOAD_SIGN_IN_MESSAGE, /[–—]|--/);
  });

  it("other errors pass through as before", () => {
    assert.equal(forgeUploadErrorMessage(413, "File too large (max 25MB)"), "File too large (max 25MB)");
    assert.equal(forgeUploadErrorMessage(500, undefined), "Something went wrong. Try again?");
    assert.equal(forgeUploadErrorMessage(429, ""), "Something went wrong. Try again?");
  });
});
