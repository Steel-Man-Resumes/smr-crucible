// Resend and revoke check and act in one organization (review SF1).
import { it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const src = readFileSync(new URL("../../app/api/partner/org/route.ts", import.meta.url), "utf8");

it("the invite guard's org must be the org the write runs in", () => {
  const block = src.slice(src.indexOf('body.action === "resend_invite" || body.action === "revoke_invite"'));
  const guardAt = block.indexOf("inviteGuard.actor.orgId !== org.accessCodeId");
  const senderAt = block.indexOf("getOrgInviteSender(org.accessCodeId");
  assert.ok(guardAt > 0 && senderAt > guardAt, "same-org refusal comes before the sender check, which reads the write's org");
  assert.doesNotMatch(block.slice(0, block.indexOf('if (body.action === "resend_invite") {')), /getOrgInviteSender\(inviteGuard\.actor\.orgId/);
  assert.match(src, /touchOrgInviteResend\(org\.accessCodeId, body\.userId\)/);
  assert.match(src, /revokeOrgInvite\(org\.accessCodeId, body\.userId, userId\)/);
});
