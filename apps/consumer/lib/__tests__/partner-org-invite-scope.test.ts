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

// N-21 (security review 3): offers have no route of their own. Resend and
// withdraw of an offer go through resend_invite and revoke_invite, so they sit
// behind the same Invite participants check, same-org guard and sender check.
it("offer resend and withdraw pass the invite capability, same-org and sender checks", () => {
  const guardStart = src.indexOf('if (body.action === "resend_invite" || body.action === "revoke_invite") {');
  const guardBlock = src.slice(guardStart, src.indexOf('if (body.action === "resend_invite") {'));
  assert.match(guardBlock, /requireOrgCapability\("org\.participant\.invite"/);
  assert.match(guardBlock, /inviteGuard\.actor\.orgId !== org\.accessCodeId/);
  assert.match(guardBlock, /inviteActionAllowed\(\{/);
  const resendAt = src.indexOf('if (body.action === "resend_invite") {');
  const revokeAt = src.indexOf('if (body.action === "revoke_invite") {');
  assert.ok(guardStart > 0 && resendAt > guardStart && revokeAt > guardStart, "guard runs before both actions");
  // The only offer branches are inside those two actions.
  assert.ok(src.indexOf("touched.offer") > resendAt);
  assert.doesNotMatch(src, /smr_withdraw_seat_offer|withdraw_offer|resend_offer/, "no separate offer action that could skip the guard");
});
