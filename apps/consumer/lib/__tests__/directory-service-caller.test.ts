import { test } from "node:test";
import assert from "node:assert/strict";
import { directoryCaller, directoryLimitKey, DIRECTORY_PUBLIC_PER_MINUTE, DIRECTORY_SERVICE_PER_MINUTE } from "../directory-response";
const KEY = "service-key-0123456789abcdef";
const req = (headers: Record<string, string>) => new Request("https://app.test/api/directory/employers", { headers });
test("no key, wrong key, short key: an ordinary public caller limited by its own address", () => {
  const plain = directoryCaller(req({ "x-real-ip": "2001:db8::7" }), KEY);
  assert.deepEqual(plain, { kind: "public", ip: "2001:db8::7" });
  assert.deepEqual(directoryCaller(req({ "x-real-ip": "2001:db8::7", "x-smr-directory-key": "wrong" }), KEY), plain);
  assert.deepEqual(directoryCaller(req({ "x-real-ip": "2001:db8::7", "x-smr-directory-key": "short" }), "short"), plain);
  assert.deepEqual(directoryCaller(req({ "x-real-ip": "2001:db8::7", "x-smr-directory-key": KEY }), undefined), plain);
  assert.equal(directoryLimitKey(plain).maxRequests, DIRECTORY_PUBLIC_PER_MINUTE);
  assert.equal(directoryLimitKey(plain).key, "directory-public:2001:db8::7");
});
test("the right key reads under the service ceiling, or under a forwarded visitor address", () => {
  const service = directoryCaller(req({ "x-real-ip": "2001:db8::7", "x-smr-directory-key": KEY }), KEY);
  assert.deepEqual(service, { kind: "service", visitorIp: null });
  assert.deepEqual(directoryLimitKey(service), { key: "directory-service", maxRequests: DIRECTORY_SERVICE_PER_MINUTE });
  const visitor = directoryCaller(req({ "x-real-ip": "2001:db8::7", "x-smr-directory-key": KEY, "x-smr-visitor-ip": "2001:db8::9" }), KEY);
  assert.deepEqual(directoryLimitKey(visitor), { key: "directory-public:2001:db8::9", maxRequests: DIRECTORY_PUBLIC_PER_MINUTE });
  const junk = directoryCaller(req({ "x-smr-directory-key": KEY, "x-smr-visitor-ip": "not an address at all; drop table" }), KEY);
  assert.deepEqual(junk, { kind: "service", visitorIp: null });
});
