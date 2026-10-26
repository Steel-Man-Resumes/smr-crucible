import { test } from "node:test";
import assert from "node:assert/strict";
import { deletionProofError } from "../deletion-confirmation";

test("missing password and incorrect password have different, actionable errors", async () => {
  let calls = 0;
  const mismatch = async () => { calls++; return false; };
  for (const password of [undefined, null, "", 123, {}]) {
    const error = await deletionProofError("stored-hash", { password }, mismatch);
    assert.equal(error?.code, "password_required");
  }
  assert.equal(calls, 0);
  const error = await deletionProofError("stored-hash", { password: "wrong-password" }, mismatch);
  assert.equal(error?.code, "password_incorrect");
  assert.match(error?.error || "", /didn't match/);
  assert.equal(calls, 1);
});

test("typing DELETE cannot replace a password even after email-link sign-in", async () => {
  const error = await deletionProofError("stored-hash", { typedConfirmation: "DELETE" }, async () => { throw new Error("must not compare"); });
  assert.equal(error?.code, "password_required");
});

test("password verification preserves spaces and succeeds only on a match", async () => {
  const password = " sample password 42 ";
  const error = await deletionProofError("stored-hash", { password }, async (input, hash) => {
    assert.equal(input, password);
    assert.equal(hash, "stored-hash");
    return true;
  });
  assert.equal(error, null);
});

test("an account without a password requires the exact confirmation word", async () => {
  const unused = async () => { throw new Error("no password to compare"); };
  for (const typedConfirmation of [undefined, "", "delete", " DELETE ", true]) {
    assert.equal((await deletionProofError(null, { typedConfirmation }, unused))?.code, "confirmation_required");
  }
  assert.equal(await deletionProofError(null, { typedConfirmation: "DELETE" }, unused), null);
  assert.equal((await deletionProofError(null, { password: "DELETE" }, unused))?.code, "confirmation_required");
});

test("verification failure throws before deletion can proceed", async () => {
  await assert.rejects(deletionProofError("stored-hash", { password: "sample" }, async () => { throw new Error("verification unavailable"); }), /verification unavailable/);
});
