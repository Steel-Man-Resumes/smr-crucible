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
  linkedAccountEmail,
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
