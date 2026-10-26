import { test } from "node:test";
import assert from "node:assert/strict";
import { refreshConsentSession, refreshVerifiedSession } from "../verified-session";
import { TERMS_VERSION } from "../terms";

test("verification explicitly triggers Auth.js JWT refresh rather than a stale session GET", async () => {
  let payload: unknown;
  const ok = await refreshVerifiedSession(async (data) => { payload = data; return { user: { claim: null, mfa: true } }; });
  assert.deepEqual(payload, {});
  assert.equal(ok, true);
});
test("missing or pending sessions never finish sign-in", async () => {
  assert.equal(await refreshVerifiedSession(async () => null), false);
  assert.equal(await refreshVerifiedSession(async () => ({})), false);
  assert.equal(await refreshVerifiedSession(async () => ({ user: { claim: "password" } })), false);
  assert.equal(await refreshVerifiedSession(async () => ({ user: { mfa: false } })), false);
});

test("consent refresh requests a server update with no client consent claims", async () => {
  let payload: unknown;
  const ready = await refreshConsentSession(async (data) => {
    payload = data;
    // Reproduce Auth.js: a payload triggers the JWT update; no payload keeps
    // the old false claim even though acceptance was saved in the database.
    return { user: { terms: data !== undefined, termsVersion: TERMS_VERSION, mfa: true } };
  });
  assert.deepEqual(payload, {});
  assert.equal(ready, true);
});

test("consent refresh refuses stale, missing, or incomplete sign-in results", async () => {
  for (const session of [
    null,
    {},
    { user: {} },
    { user: { terms: false, termsVersion: TERMS_VERSION } },
    { user: { terms: true, termsVersion: "old-version" } },
    { user: { terms: "true", termsVersion: TERMS_VERSION } },
    { user: { terms: true, termsVersion: TERMS_VERSION, mfa: false } },
    { user: { terms: true, termsVersion: TERMS_VERSION, claim: "password" } },
  ]) {
    assert.equal(await refreshConsentSession(async () => session), false);
  }
});

test("consent refresh propagates transport errors to the page's retry handler", async () => {
  await assert.rejects(refreshConsentSession(async () => { throw new Error("offline"); }), /offline/);
});
