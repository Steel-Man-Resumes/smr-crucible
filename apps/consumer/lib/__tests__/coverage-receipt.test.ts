import { test } from "node:test";
import assert from "node:assert/strict";
import { readCoverageReceipt } from "../coverage-receipt";
test("only a pending queue ID confirms a receipt; HTTP success alone or launched claims cannot", () => {
  const requestId = "00000000-0000-4000-8000-000000000001";
  assert.deepEqual(readCoverageReceipt({ requestId, status: "pending" }), { requestId, status: "pending" });
  for (const input of [null, {}, { ok: true }, { requestId, status: "launched" }, { requestId: "fake", status: "pending" }]) assert.equal(readCoverageReceipt(input), null);
});
