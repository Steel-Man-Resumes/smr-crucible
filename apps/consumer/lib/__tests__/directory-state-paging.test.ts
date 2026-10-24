import { test } from "node:test";
import assert from "node:assert/strict";
import { directoryStatePaging } from "../directory-response";
const KEY = "service-key-0123456789abcdef";
const req = (headers: Record<string, string> = {}) => new Request("https://app.test/api/directory/resources", { headers });
const q = (s: string) => new URLSearchParams(s);
test("only the trusted website reads a whole state in pages", () => {
  const trusted = req({ "x-smr-directory-key": KEY });
  assert.deepEqual(directoryStatePaging(trusted, q("state=MI&bands=ABC&scope=state&page=0"), KEY), { page: 0, limit: 200 });
  assert.deepEqual(directoryStatePaging(trusted, q("state=MI&scope=state&page=4&limit=100"), KEY), { page: 4, limit: 100 });
  // No key, a wrong key, or no configured key: the public caller keeps the capped slice.
  assert.equal(directoryStatePaging(req(), q("state=MI&scope=state&page=0"), KEY), null);
  assert.equal(directoryStatePaging(req({ "x-smr-directory-key": "wrong" }), q("state=MI&scope=state&page=0"), KEY), null);
  assert.equal(directoryStatePaging(trusted, q("state=MI&scope=state&page=0"), undefined), null);
});
test("paging needs scope=state and a valid page", () => {
  const trusted = req({ "x-smr-directory-key": KEY });
  assert.equal(directoryStatePaging(trusted, q("state=MI&page=0"), KEY), null);
  assert.equal(directoryStatePaging(trusted, q("state=MI&scope=state"), KEY), null);
  assert.equal(directoryStatePaging(trusted, q("state=MI&scope=state&page=-3"), KEY), null);
  assert.equal(directoryStatePaging(trusted, q("state=MI&scope=state&page=999"), KEY), null);
});
