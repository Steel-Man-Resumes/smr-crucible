/**
 * Server-side session registry (F5), tested as the claims:
 *  - a session signed in by the registry and missing its row is refused;
 *  - an older token keeps working until its user sweeps their sessions;
 *  - a credential change revokes every OTHER session and records the sweep;
 *  - the sign-in itself writes the row before anything else.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  FRESH_SIGN_IN_SECONDS,
  SESSION_REGISTRY_CUTOFF,
  authRouteSkipsSessionChecks,
  revocationVerdict,
  sessionRowRequired,
  signedInWithin,
} from "../session-policy";
import {
  contextFromHeaders,
  registerSession,
  revokeUserSessions,
  type Db,
} from "../session-registry";

const CUTOFF_S = Date.parse(SESSION_REGISTRY_CUTOFF) / 1000;

function fakeDb() {
  const calls: { text: string; params: unknown[] }[] = [];
  const db: Db = {
    async query(text: string, params: unknown[] = []) {
      calls.push({ text, params });
      return { rows: [], rowCount: 2 };
    },
  };
  return { db, calls };
}

describe("revocation verdict", () => {
  it("lets the row decide whenever there is one", () => {
    assert.equal(revocationVerdict({ row: { revoked: true }, signedInAt: undefined, sweptSinceCutoff: null }), true);
    assert.equal(revocationVerdict({ row: { revoked: false }, signedInAt: CUTOFF_S + 60, sweptSinceCutoff: true }), false);
  });

  it("refuses a registered sign-in that has no row", () => {
    assert.equal(sessionRowRequired(CUTOFF_S + 1), true);
    assert.equal(revocationVerdict({ row: null, signedInAt: CUTOFF_S + 1, sweptSinceCutoff: null }), true);
  });

  it("keeps an older token (no sit) working, so the deploy signs nobody out", () => {
    assert.equal(sessionRowRequired(undefined), false);
    assert.equal(sessionRowRequired(null), false);
    assert.equal(sessionRowRequired(CUTOFF_S - 3600), false);
    assert.equal(sessionRowRequired("1999999999"), false);
    assert.equal(revocationVerdict({ row: null, signedInAt: undefined, sweptSinceCutoff: false }), false);
    assert.equal(revocationVerdict({ row: null, signedInAt: undefined, sweptSinceCutoff: null }), false);
  });

  it("ends an older, unregistered token once its user swept their sessions", () => {
    assert.equal(revocationVerdict({ row: null, signedInAt: undefined, sweptSinceCutoff: true }), true);
  });
});

describe("session registry writes", () => {
  it("registers the session row with the device read from the request", async () => {
    const { db, calls } = fakeDb();
    const ctx = contextFromHeaders(
      new Headers({
        "user-agent": "Mozilla/5.0 (Windows NT 10.0) Chrome/120.0",
        "x-real-ip": "203.0.113.9",
        "x-vercel-ip-city": "San%20Jose",
        "x-vercel-ip-country": "US",
        host: "refinery.example.org",
      })
    );
    assert.equal(ctx.location, "San Jose, US");
    assert.equal(ctx.origin, "https://refinery.example.org");
    await registerSession(db, { sid: "sid-1", userId: "user-1", ctx });
    assert.equal(calls.length, 1);
    assert.match(calls[0].text, /INSERT INTO user_session/);
    assert.deepEqual(calls[0].params.slice(0, 4), ["sid-1", "user-1", ctx.userAgent, "203.0.113.9"]);
  });

  it("revokes every other session, keeps the caller's, and records the sweep", async () => {
    const { db, calls } = fakeDb();
    const n = await revokeUserSessions(db, { userId: "user-1", keepSid: "mine", userAgent: "ua" });
    assert.equal(n, 2);
    // 1) the kept session is registered first, so an older one survives its own sweep
    assert.match(calls[0].text, /INSERT INTO user_session/);
    assert.deepEqual(calls[0].params, ["mine", "user-1"]);
    // 2) every other live row is revoked
    assert.match(calls[1].text, /UPDATE user_session SET revoked_at = now\(\)/);
    assert.deepEqual(calls[1].params, ["user-1", "mine"]);
    // 3) the sweep is recorded (this is what ends unregistered older tokens)
    assert.match(calls[2].text, /INSERT INTO user_login_event/);
    assert.deepEqual(calls[2].params, ["user-1", "sessions_revoked", "ua"]);
  });

  it("revokes ALL sessions when there is no current one (password reset)", async () => {
    const { db, calls } = fakeDb();
    await revokeUserSessions(db, { userId: "user-2" });
    assert.equal(calls.length, 2);
    assert.match(calls[0].text, /UPDATE user_session/);
    assert.deepEqual(calls[0].params, ["user-2", null]);
  });
});

describe("which /api/auth routes get the session checks (F6)", () => {
  it("checks set-password, session-ping, and any custom route added later", () => {
    assert.equal(authRouteSkipsSessionChecks("/api/auth/set-password"), false);
    assert.equal(authRouteSkipsSessionChecks("/api/auth/session-ping"), false);
    assert.equal(authRouteSkipsSessionChecks("/api/auth/some-new-route"), false);
  });

  it("skips NextAuth's own actions, so a revoked device can still sign out or back in", () => {
    for (const p of [
      "/api/auth/session",
      "/api/auth/csrf",
      "/api/auth/providers",
      "/api/auth/signin/resend",
      "/api/auth/callback/password-login",
      "/api/auth/callback/google",
      "/api/auth/signout",
      "/api/auth/verify-request",
      "/api/auth/error",
    ]) {
      assert.equal(authRouteSkipsSessionChecks(p), true, p);
    }
  });

  it("skips the pre-sign-in routes that never read the session", () => {
    assert.equal(authRouteSkipsSessionChecks("/api/auth/password-precheck"), true);
    assert.equal(authRouteSkipsSessionChecks("/api/auth/register"), true);
    assert.equal(authRouteSkipsSessionChecks("/api/auth/reset-password/request"), true);
    assert.equal(authRouteSkipsSessionChecks("/api/auth/reset-password/confirm"), true);
  });

  it("is not fooled by a lookalike prefix", () => {
    assert.equal(authRouteSkipsSessionChecks("/api/auth/sessionx"), false);
    assert.equal(authRouteSkipsSessionChecks("/api/auth/set-password/../session"), false);
    assert.equal(authRouteSkipsSessionChecks("/api/user/sessions"), false);
  });
});

describe("adding a first password needs a fresh sign-in (F6)", () => {
  const now = Date.parse("2026-10-03T12:00:00Z");
  const nowS = now / 1000;
  it("accepts a sign-in inside 10 minutes", () => {
    assert.equal(signedInWithin(nowS - 60, FRESH_SIGN_IN_SECONDS, now), true);
    assert.equal(signedInWithin(nowS - FRESH_SIGN_IN_SECONDS, FRESH_SIGN_IN_SECONDS, now), true);
  });
  it("refuses an older sign-in, and a session with no sign-in stamp", () => {
    assert.equal(signedInWithin(nowS - FRESH_SIGN_IN_SECONDS - 1, FRESH_SIGN_IN_SECONDS, now), false);
    assert.equal(signedInWithin(undefined, FRESH_SIGN_IN_SECONDS, now), false);
    assert.equal(signedInWithin(null, FRESH_SIGN_IN_SECONDS, now), false);
    assert.equal(signedInWithin(String(nowS), FRESH_SIGN_IN_SECONDS, now), false);
  });
});
