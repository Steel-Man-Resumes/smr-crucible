/**
 * Pages whose URL can carry a token, code or email address never reach analytics
 * (GA4 records the full URL, query string included).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isAnalyticsExcluded } from "../analytics-exclusions";

describe("isAnalyticsExcluded", () => {
  it("excludes pages whose URL carries a token, code or email", () => {
    for (const p of ["/login/finish", "/login/verify", "/reset-password", "/forgot-password", "/access", "/access/abc", "/mini-forge/import-complete"]) {
      assert.equal(isAnalyticsExcluded(p), true, p);
    }
  });
  it("keeps ordinary pages measured", () => {
    for (const p of ["/login", "/intro", "/dashboard", "/overview", "/reset-passwords-guide", "/accessibility"]) {
      assert.equal(isAnalyticsExcluded(p), false, p);
    }
  });
});
