import { test } from "node:test";
import assert from "node:assert/strict";
import { originAllowed, recipientKey } from "../email-package-guard";

const URL_FORGE = "https://forge.steelmanresumes.com/api/forge/email-package";

test("originAllowed: same host passes", () => {
  assert.equal(originAllowed("https://forge.steelmanresumes.com", URL_FORGE), true);
});

test("originAllowed: sibling steelmanresumes.com subdomain over https passes", () => {
  assert.equal(originAllowed("https://refinery.steelmanresumes.com", URL_FORGE), true);
});

test("originAllowed: missing, foreign, look-alike or plain-http origin fails", () => {
  assert.equal(originAllowed(null, URL_FORGE), false);
  assert.equal(originAllowed("", URL_FORGE), false);
  assert.equal(originAllowed("https://evil.example", URL_FORGE), false);
  assert.equal(originAllowed("https://steelmanresumes.com.evil.example", URL_FORGE), false);
  assert.equal(originAllowed("https://evilsteelmanresumes.com", URL_FORGE), false);
  assert.equal(originAllowed("http://forge2.steelmanresumes.com", URL_FORGE), false);
  assert.equal(originAllowed("null", URL_FORGE), false);
});

test("originAllowed: local dev same host passes", () => {
  assert.equal(originAllowed("http://localhost:3002", "http://localhost:3002/api/forge/email-package"), true);
});

test("recipientKey: stable, hashed, never the address", () => {
  const k = recipientKey("person@example.com");
  assert.equal(k, recipientKey("person@example.com"));
  assert.notEqual(k, recipientKey("other@example.com"));
  assert.ok(k.startsWith("rcpt:"));
  assert.ok(!k.includes("person"));
});
