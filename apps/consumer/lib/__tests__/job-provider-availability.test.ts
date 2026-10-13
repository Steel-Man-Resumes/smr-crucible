import { test } from "node:test";
import assert from "node:assert/strict";
import { fetchAdzunaJobs, fetchUsaJobs } from "../job-providers";

test("a skipped provider cannot be counted as a successful zero-match search", async () => {
  // This test process uses no credentials and must never contact a provider.
  delete process.env.ADZUNA_APP_ID;
  delete process.env.ADZUNA_APP_KEY;
  delete process.env.USAJOBS_API_KEY;
  delete process.env.USAJOBS_USER_AGENT;
  const oldFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("Unexpected provider call"); };
  try {
    assert.equal((await fetchAdzunaJobs("warehouse", "Madison, WI", 25, 100)).failed, true);
    assert.equal((await fetchUsaJobs("warehouse", "Wisconsin", 100)).failed, true);
  } finally { globalThis.fetch = oldFetch; }
});
