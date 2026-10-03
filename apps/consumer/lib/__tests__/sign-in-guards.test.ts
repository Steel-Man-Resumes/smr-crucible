/**
 * Google sign-in rule (F2): Google gets in only with an address Google
 * verified. (Auto-linking into existing accounts stays on; protection for
 * accounts with a password or two-step comes from the step-up and the
 * first-proof choice, not from refusing Google.)
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { googleEmailVerified, SIGN_IN_REFUSED } from "../sign-in-guards";

describe("googleEmailVerified", () => {
  it("accepts only email_verified === true", () => {
    assert.equal(googleEmailVerified({ email: "a@example.org", email_verified: true }), true);
  });
  it("refuses anything else", () => {
    for (const v of [false, undefined, null, "true", 1]) {
      assert.equal(googleEmailVerified({ email: "a@example.org", email_verified: v }), false, String(v));
    }
    assert.equal(googleEmailVerified(null), false);
    assert.equal(googleEmailVerified(undefined), false);
  });
  it("sends a refused Google sign-in back to the login page with a reason", () => {
    assert.equal(SIGN_IN_REFUSED.googleEmailUnverified, "/login?error=GoogleEmailUnverified");
  });
});
