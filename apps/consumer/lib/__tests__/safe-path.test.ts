/**
 * Open-redirect guard: one rule for every "where next" parameter. The step-up
 * page used to accept "/\t/evil.com", which a browser turns into //evil.com.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isSafeRelativePath } from "../safe-path";
import { safeCallbackPath } from "../session-policy";

const UNSAFE = [
  "/\t/evil.com",
  "/\n/evil.com",
  "/\r/evil.com",
  "/\\evil.com",
  "/\t\\evil.com",
  "//evil.com",
  "/ok\\..\\evil",
  "/x\u0000y",
  "/x\u007fy",
  "https://evil.com",
  "evil.com",
  "",
];

describe("isSafeRelativePath", () => {
  it("accepts a plain same-site path", () => {
    assert.equal(isSafeRelativePath("/ok"), true);
    assert.equal(isSafeRelativePath("/dashboard/settings?tab=security#two-step"), true);
  });
  it("refuses anything a browser could turn into another site", () => {
    for (const u of UNSAFE) assert.equal(isSafeRelativePath(u), false, JSON.stringify(u));
    assert.equal(isSafeRelativePath(null), false);
    assert.equal(isSafeRelativePath(undefined), false);
    assert.equal(isSafeRelativePath(42), false);
  });
});

describe("safeCallbackPath (step-up page)", () => {
  it("falls back to the dashboard for every unsafe value", () => {
    for (const u of UNSAFE) assert.equal(safeCallbackPath(u), "/dashboard", JSON.stringify(u));
  });
  it("keeps a safe path, but never loops back to the step-up page", () => {
    assert.equal(safeCallbackPath("/ok"), "/ok");
    assert.equal(safeCallbackPath("/login/verify?callbackUrl=/x"), "/dashboard");
  });
  it("resolves the attack URLs to this site, not evil.com", () => {
    for (const u of ["/\t/evil.com", "/\n/evil.com", "/\\evil.com", "//evil.com"]) {
      const resolved = new URL(safeCallbackPath(u), "https://refinery.example.org");
      assert.equal(resolved.origin, "https://refinery.example.org");
    }
  });
});
