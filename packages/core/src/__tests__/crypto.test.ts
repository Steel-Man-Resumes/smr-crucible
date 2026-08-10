/**
 * Phase 1C crypto.ts tests -- pure, no DB, no R2.
 *
 * Run: npm test  (node --import tsx --test, no extra deps)
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { encryptString, decryptString, currentKeyVersion } from "../crypto";

const TEST_KEY = Buffer.alloc(32, 3).toString("base64");

test("encryptString -> decryptString round-trips the plaintext", () => {
  process.env.DOCUMENT_ENCRYPTION_KEY = TEST_KEY;
  const aad = "user-1:totp";
  const enc = encryptString("hello world", aad);
  assert.equal(decryptString(enc, aad), "hello world");
});

test("encrypt uses a fresh random IV per call", () => {
  process.env.DOCUMENT_ENCRYPTION_KEY = TEST_KEY;
  const a = encryptString("same", "aad");
  const b = encryptString("same", "aad");
  assert.notEqual(a.iv, b.iv);
  assert.notEqual(a.ciphertext, b.ciphertext);
});

test("decryptString throws when AAD does not match", () => {
  process.env.DOCUMENT_ENCRYPTION_KEY = TEST_KEY;
  const enc = encryptString("secret", "user-1:totp");
  assert.throws(() => decryptString(enc, "user-2:totp"));
});

test("decryptString throws when ciphertext has been tampered with", () => {
  process.env.DOCUMENT_ENCRYPTION_KEY = TEST_KEY;
  const enc = encryptString("secret", "aad");
  const bytes = Buffer.from(enc.ciphertext, "base64");
  bytes[0] ^= 0xff;
  const tampered = { ...enc, ciphertext: bytes.toString("base64") };
  assert.throws(() => decryptString(tampered, "aad"));
});

test("a wrong-length key throws a clear error", () => {
  process.env.DOCUMENT_ENCRYPTION_KEY = Buffer.alloc(16, 1).toString("base64");
  assert.throws(() => encryptString("x", "aad"), /32 bytes/);
});

test("a missing key throws only at call time, not at import time", () => {
  delete process.env.DOCUMENT_ENCRYPTION_KEY;
  assert.throws(() => encryptString("x", "aad"), /DOCUMENT_ENCRYPTION_KEY is not set/);
});

test("currentKeyVersion defaults to v1 for a bare (unprefixed) key", () => {
  process.env.DOCUMENT_ENCRYPTION_KEY = TEST_KEY;
  assert.equal(currentKeyVersion(), "v1");
});

test("currentKeyVersion parses an explicit v1: prefix", () => {
  process.env.DOCUMENT_ENCRYPTION_KEY = `v1:${TEST_KEY}`;
  assert.equal(currentKeyVersion(), "v1");
  const enc = encryptString("x", "aad");
  assert.equal(decryptString(enc, "aad"), "x");
  delete process.env.DOCUMENT_ENCRYPTION_KEY;
});
