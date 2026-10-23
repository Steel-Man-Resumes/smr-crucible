import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveApprovedBase } from "../approved-base";
import { groundingTargetBlock } from "../grounding-target-context";
const base = { user_id: "owner", artifact_type: "resume", is_locked: true, is_current: false, content: { summary: "Real work" }, lane_id: "lane-a" };
test("an approved resume from a different lane cannot silently become the selected baseline", () => {
  assert.deepEqual(resolveApprovedBase(base, "owner", "lane-b"), { ok: false, reason: "wrong_lane" });
  assert.equal(resolveApprovedBase(base, "owner", "lane-a").ok, true);
  assert.deepEqual(resolveApprovedBase(base, "owner", null), { ok: false, reason: "wrong_lane" });
  assert.equal(resolveApprovedBase({ ...base, lane_id: null }, "owner", null).ok, true);
});
test("lane selection never grants ownership or approval", () => {
  assert.deepEqual(resolveApprovedBase(base, "someone-else", "lane-a"), { ok: false, reason: "not_owner" });
  assert.deepEqual(resolveApprovedBase({ ...base, is_locked: false }, "owner", "lane-a"), { ok: false, reason: "not_approved" });
});
test("target context is separate bounded data for letters only", () => {
  const target = { title: "Production lead", company: "Example employer", description: "Requests a credential the applicant has not supplied." };
  const block = groundingTargetBlock("cover_letter", target);
  assert.match(block, /not applicant evidence/);
  assert.match(block, /Example employer/);
  assert.equal(groundingTargetBlock("resume", target), "");
  assert.equal(groundingTargetBlock("summary", target), "");
  assert.equal(groundingTargetBlock("cover_letter", {}), "");
  assert.ok(groundingTargetBlock("cover_letter", { description: "x".repeat(20000) }).length < 6300);
});
