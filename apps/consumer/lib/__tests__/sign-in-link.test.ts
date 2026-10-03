/**
 * Emailed sign-in links land on a button page (review 6, mail scanners), and
 * that page can only ever send the browser to this site's email callback.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildSignInLinkEmail, emailCallbackTarget, interstitialUrlFor } from "../sign-in-link";

const ORIGIN = "https://refinery.example.org";
const TOKEN = "a".repeat(64);

describe("interstitialUrlFor", () => {
  it("points the email at /login/finish on the same origin with the same parameters", () => {
    const cb = `${ORIGIN}/api/auth/callback/resend?callbackUrl=${encodeURIComponent(ORIGIN + "/dashboard")}&token=${TOKEN}&email=a%2Bb%40example.org`;
    const page = new URL(interstitialUrlFor(cb));
    assert.equal(page.origin, ORIGIN);
    assert.equal(page.pathname, "/login/finish");
    assert.equal(page.searchParams.get("token"), TOKEN);
    assert.equal(page.searchParams.get("email"), "a+b@example.org");
    assert.equal(page.searchParams.get("callbackUrl"), ORIGIN + "/dashboard");
  });
});

describe("emailCallbackTarget", () => {
  const params = (o: Record<string, string>) => new URLSearchParams(o);

  it("builds this origin's resend callback from a valid link", () => {
    const t = new URL(emailCallbackTarget(ORIGIN, params({ token: TOKEN, email: "a+b@example.org", callbackUrl: "/dashboard" }))!);
    assert.equal(t.origin, ORIGIN);
    assert.equal(t.pathname, "/api/auth/callback/resend");
    assert.equal(t.searchParams.get("token"), TOKEN);
    assert.equal(t.searchParams.get("email"), "a+b@example.org");
    assert.equal(t.searchParams.get("callbackUrl"), "/dashboard");
  });

  it("keeps a same-origin absolute callbackUrl (org invitations use one)", () => {
    const t = new URL(emailCallbackTarget(ORIGIN, params({ token: TOKEN, email: "a@example.org", callbackUrl: ORIGIN + "/dashboard" }))!);
    assert.equal(t.searchParams.get("callbackUrl"), ORIGIN + "/dashboard");
  });

  it("drops a callbackUrl to another site, or one a browser would turn into another site", () => {
    for (const cb of ["https://evil.example/x", "//evil.example", "/\t/evil.example", "/\\evil.example", "javascript:alert(1)"]) {
      const t = new URL(emailCallbackTarget(ORIGIN, params({ token: TOKEN, email: "a@example.org", callbackUrl: cb }))!);
      assert.equal(t.origin, ORIGIN);
      assert.equal(t.searchParams.get("callbackUrl"), null, cb);
    }
  });

  it("refuses a link without a proper token or email", () => {
    assert.equal(emailCallbackTarget(ORIGIN, params({ email: "a@example.org" })), null);
    assert.equal(emailCallbackTarget(ORIGIN, params({ token: "short", email: "a@example.org" })), null);
    assert.equal(emailCallbackTarget(ORIGIN, params({ token: TOKEN + "<x>", email: "a@example.org" })), null);
    assert.equal(emailCallbackTarget(ORIGIN, params({ token: TOKEN })), null);
    assert.equal(emailCallbackTarget(ORIGIN, params({ token: TOKEN, email: "no-at-sign" })), null);
    assert.equal(emailCallbackTarget(ORIGIN, params({ token: TOKEN, email: "a@example.org\nBcc: x@y" })), null);
  });

  it("never carries other parameters through", () => {
    const t = new URL(emailCallbackTarget(ORIGIN, params({ token: TOKEN, email: "a@example.org", next: "https://evil.example" }))!);
    assert.deepEqual([...t.searchParams.keys()].sort(), ["email", "token"]);
  });
});

describe("the email", () => {
  it("is plain, with no em dashes", () => {
    const e = buildSignInLinkEmail(`${ORIGIN}/login/finish?token=${TOKEN}&email=a%40example.org`);
    assert.ok(!/—| -- /.test(e.subject + e.text + e.html));
    assert.ok(e.html.includes("&amp;email="));
  });
});
