/**
 * Google sign-in rules (F2, B1), tested as the claims:
 *  - Google gets in only with an address Google verified;
 *  - a browser signed in as one account cannot attach a Google identity with
 *    a different address (refused before Auth.js links, so no row is written),
 *    and if a link was written anyway it is deleted;
 *  - a matching link is fine;
 *  - a revoked or unfinished session cannot link at all;
 *  - a Google identity linked to an account with another address is refused.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  GoogleLinkRefused,
  SIGN_IN_REFUSED,
  enforceGoogleAccountMatch,
  googleEmailVerified,
  googleSignInDecision,
  googleSignInGate,
  isSessionCookieName,
  linkedAccountEmail,
  readCurrentSessionForLink,
} from "../sign-in-guards";
import type { Db } from "../session-registry";

const verified = (email: string) => ({ email, email_verified: true });
const live = (email: string) => ({ email, revoked: false, pending: false });

describe("googleEmailVerified", () => {
  it("accepts only email_verified === true", () => {
    assert.equal(googleEmailVerified({ email: "a@example.org", email_verified: true }), true);
    for (const v of [false, undefined, null, "true", 1]) {
      assert.equal(googleEmailVerified({ email: "a@example.org", email_verified: v }), false, String(v));
    }
    assert.equal(googleEmailVerified(null), false);
  });
});

describe("googleSignInDecision", () => {
  it("refuses an unverified Google address", () => {
    assert.equal(
      googleSignInDecision({ profile: { email: "a@example.org", email_verified: false }, linkedAccountEmail: null, session: null }),
      SIGN_IN_REFUSED.googleEmailUnverified
    );
  });

  it("refuses linking a Google identity with a different email into the signed-in account", () => {
    assert.equal(
      googleSignInDecision({ profile: verified("attacker@example.net"), linkedAccountEmail: null, session: live("victim@example.org") }),
      SIGN_IN_REFUSED.sessionLinkRefused
    );
  });

  it("allows a matching link from a live session (case and spaces ignored)", () => {
    assert.equal(
      googleSignInDecision({ profile: verified("Person@Example.org"), linkedAccountEmail: null, session: live(" person@example.org ") }),
      true
    );
  });

  it("refuses any Google sign-in from a revoked or unfinished session, even for the same address", () => {
    assert.equal(
      googleSignInDecision({ profile: verified("a@example.org"), linkedAccountEmail: null, session: { email: "a@example.org", revoked: true, pending: false } }),
      SIGN_IN_REFUSED.sessionNotUsable
    );
    assert.equal(
      googleSignInDecision({ profile: verified("a@example.org"), linkedAccountEmail: "a@example.org", session: { email: "a@example.org", revoked: false, pending: true } }),
      SIGN_IN_REFUSED.sessionNotUsable
    );
  });

  it("allows a signed-out sign-in that matches (new, auto-linked, or already linked)", () => {
    assert.equal(googleSignInDecision({ profile: verified("a@example.org"), linkedAccountEmail: null, session: null }), true);
    assert.equal(googleSignInDecision({ profile: verified("a@example.org"), linkedAccountEmail: "A@example.org", session: null }), true);
  });

  it("refuses a Google identity already linked to an account with another address", () => {
    assert.equal(
      googleSignInDecision({ profile: verified("new@example.org"), linkedAccountEmail: "old@example.org", session: null }),
      SIGN_IN_REFUSED.googleEmailMismatch
    );
  });
});

function fakeDb(accountEmail: string | null) {
  const calls: { text: string; params: unknown[] }[] = [];
  const db: Db = {
    async query(text: string, params: unknown[] = []) {
      calls.push({ text: text.replace(/\s+/g, " ").trim(), params });
      if (/^SELECT email FROM users/.test(text.trim())) {
        return { rows: accountEmail === null ? [] : [{ email: accountEmail }], rowCount: accountEmail === null ? 0 : 1 };
      }
      if (/FROM accounts a JOIN users/.test(text)) {
        return { rows: accountEmail === null ? [] : [{ email: accountEmail }], rowCount: accountEmail === null ? 0 : 1 };
      }
      return { rows: [], rowCount: 1 };
    },
  };
  return { db, calls };
}

describe("enforceGoogleAccountMatch (last check inside the sign-in)", () => {
  it("removes the Google link Auth.js wrote when the account email differs, and reports a mismatch", async () => {
    const { db, calls } = fakeDb("victim@example.org");
    const ok = await enforceGoogleAccountMatch(db, { userId: "u-victim", profileEmail: "attacker@example.net", providerAccountId: "g-123" });
    assert.equal(ok, false);
    const del = calls.find((c) => c.text.startsWith("DELETE FROM accounts"));
    assert.ok(del, "the link row is deleted");
    assert.match(del!.text, /provider = 'google' AND "providerAccountId" = \$1 AND "userId" = \$2/);
    assert.deepEqual(del!.params, ["g-123", "u-victim"]);
  });

  it("leaves a matching link alone", async () => {
    const { db, calls } = fakeDb("Person@example.org");
    assert.equal(await enforceGoogleAccountMatch(db, { userId: "u1", profileEmail: "person@example.org", providerAccountId: "g-1" }), true);
    assert.ok(!calls.some((c) => c.text.startsWith("DELETE")));
  });

  it("reads which account a Google identity is linked to", async () => {
    assert.equal(await linkedAccountEmail(fakeDb("a@example.org").db, "g-1"), "a@example.org");
    assert.equal(await linkedAccountEmail(fakeDb(null).db, "g-1"), null);
  });
});

describe("GoogleLinkRefused", () => {
  it("is a client-safe Auth.js sign-in error, so Auth.js sends the person to /login with an explained code", () => {
    const e = new GoogleLinkRefused();
    assert.equal(e.type, "OAuthAccountNotLinked");
    assert.equal((e as any).kind, "signIn");
  });
});

describe("reading the browser's session inside the Google sign-in (R3 G-1)", () => {
  const profile = verified("person@example.org");
  const sessionUser = (over: Record<string, unknown> = {}) => ({
    user: { id: "u1", email: "person@example.org", sid: "s1", sit: 1_790_000_000, mfa: true, claim: null, ...over },
  });
  const deps = (over: Partial<Parameters<typeof readCurrentSessionForLink>[0]> = {}) => ({
    hasSessionCookie: async () => true,
    getSession: async () => sessionUser(),
    isRevoked: async () => false,
    isPending: (u: any) => u?.mfa === false || !!u?.claim,
    ...over,
  });
  const gate = async (over: Partial<Parameters<typeof readCurrentSessionForLink>[0]> = {}) =>
    googleSignInGate({ profile, linkedAccountEmail: null, current: await readCurrentSessionForLink(deps(over)) });

  it("no session cookie: allowed through, and the session is not even read", async () => {
    let reads = 0;
    const result = await gate({
      hasSessionCookie: async () => false,
      getSession: async () => {
        reads++;
        throw new Error("would break every Google sign-in");
      },
    });
    assert.equal(result, true);
    assert.equal(reads, 0);
  });

  it("a live session with the same email: allowed", async () => {
    assert.equal(await gate(), true);
    assert.equal(await gate({ getSession: async () => sessionUser({ email: " Person@Example.org " }) }), true);
  });

  it("a session with a different email: refused", async () => {
    assert.equal(await gate({ getSession: async () => sessionUser({ email: "someone-else@example.org" }) }), SIGN_IN_REFUSED.sessionLinkRefused);
  });

  it("a revoked session: refused", async () => {
    assert.equal(await gate({ isRevoked: async () => true }), SIGN_IN_REFUSED.sessionNotUsable);
  });

  it("a session still owing a step: refused", async () => {
    assert.equal(await gate({ getSession: async () => sessionUser({ mfa: false }) }), SIGN_IN_REFUSED.sessionNotUsable);
  });

  it("a garbled cookie (reads as no session): refused, without throwing", async () => {
    const read = await readCurrentSessionForLink(deps({ getSession: async () => null }));
    assert.deepEqual(read, { state: "unreadable" });
    assert.equal(googleSignInGate({ profile, linkedAccountEmail: null, current: read }), SIGN_IN_REFUSED.sessionNotUsable);
  });

  it("a session read that throws: refused, without throwing", async () => {
    const read = await readCurrentSessionForLink(deps({ getSession: async () => { throw new Error("decrypt failed"); } }));
    assert.deepEqual(read, { state: "unreadable" });
    assert.equal(googleSignInGate({ profile, linkedAccountEmail: null, current: read }), SIGN_IN_REFUSED.sessionNotUsable);
  });

  it("a cookie check that throws falls back to reading the session", async () => {
    assert.equal(await gate({ hasSessionCookie: async () => { throw new Error("no request scope"); } }), true);
  });

  it("a failed revocation lookup counts as not revoked (same fail-open rule as the middleware)", async () => {
    assert.equal(await gate({ isRevoked: async () => { throw new Error("db down"); } }), true);
  });

  it("an unverified address is refused for that reason even with an unreadable cookie", () => {
    assert.equal(
      googleSignInGate({ profile: { email: "a@example.org", email_verified: false }, linkedAccountEmail: null, current: { state: "unreadable" } }),
      SIGN_IN_REFUSED.googleEmailUnverified
    );
  });

  it("recognizes the Auth.js session cookie names", () => {
    for (const n of ["authjs.session-token", "__Secure-authjs.session-token", "__Secure-authjs.session-token.0", "authjs.session-token.1"]) {
      assert.equal(isSessionCookieName(n), true, n);
    }
    for (const n of ["authjs.csrf-token", "__Host-authjs.csrf-token", "authjs.callback-url", "smr_impersonate", "authjs.session-tokenx"]) {
      assert.equal(isSessionCookieName(n), false, n);
    }
  });
});
