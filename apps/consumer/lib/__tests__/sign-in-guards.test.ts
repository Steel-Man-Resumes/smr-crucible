/**
 * Google sign-in rule (F2), tested as the claim: Google gets in only with a
 * verified address, and never auto-links into an account that has a password
 * or two-step verification unless it is already linked there.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { googleSignInVerdict, checkGoogleSignIn, SIGN_IN_REFUSED } from "../sign-in-guards";
import type { Db } from "../session-registry";

const plain = { id: "u1", hasPassword: false, twoFactor: false };
const withPassword = { id: "u2", hasPassword: true, twoFactor: false };
const with2fa = { id: "u3", hasPassword: false, twoFactor: true };

describe("googleSignInVerdict", () => {
  it("refuses any profile whose email_verified is not exactly true", () => {
    for (const v of [false, undefined, null, "true", 1]) {
      assert.equal(googleSignInVerdict({ emailVerified: v, alreadyLinked: true, existing: null }), "unverified");
    }
  });
  it("lets a new address create an account, and links into a passwordless one", () => {
    assert.equal(googleSignInVerdict({ emailVerified: true, alreadyLinked: false, existing: null }), "ok");
    assert.equal(googleSignInVerdict({ emailVerified: true, alreadyLinked: false, existing: plain }), "ok");
  });
  it("refuses to auto-link into an account with a password or two-step", () => {
    assert.equal(googleSignInVerdict({ emailVerified: true, alreadyLinked: false, existing: withPassword }), "link-blocked");
    assert.equal(googleSignInVerdict({ emailVerified: true, alreadyLinked: false, existing: with2fa }), "link-blocked");
  });
  it("lets an already-linked Google identity keep signing in", () => {
    assert.equal(googleSignInVerdict({ emailVerified: true, alreadyLinked: true, existing: withPassword }), "ok");
  });
});

describe("checkGoogleSignIn", () => {
  function db(linked: boolean, existing: { has_password: boolean; two_factor_enabled: boolean } | null): Db {
    return {
      async query(text: string) {
        if (/FROM accounts/.test(text)) return { rows: linked ? [{ "?column?": 1 }] : [], rowCount: linked ? 1 : 0 };
        if (/FROM users/.test(text)) return { rows: existing ? [{ id: "u", ...existing }] : [], rowCount: existing ? 1 : 0 };
        throw new Error("unexpected query");
      },
    };
  }
  it("sends an unverified Google address back to the login page without touching the database", async () => {
    const noDb: Db = { query: async () => { throw new Error("should not query"); } };
    assert.equal(
      await checkGoogleSignIn(noDb, { profile: { email: "a@example.org", email_verified: false }, providerAccountId: "g1" }),
      SIGN_IN_REFUSED.googleEmailUnverified
    );
  });
  it("blocks a same-email account that has a password", async () => {
    assert.equal(
      await checkGoogleSignIn(db(false, { has_password: true, two_factor_enabled: false }), {
        profile: { email: "a@example.org", email_verified: true },
        providerAccountId: "g1",
      }),
      SIGN_IN_REFUSED.googleLinkBlocked
    );
  });
  it("allows the same account once Google is already linked to it", async () => {
    assert.equal(
      await checkGoogleSignIn(db(true, { has_password: true, two_factor_enabled: true }), {
        profile: { email: "a@example.org", email_verified: true },
        providerAccountId: "g1",
      }),
      true
    );
  });
});
