import { test } from "node:test";
import assert from "node:assert/strict";
import { refreshVerifiedSession } from "../verified-session";

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
