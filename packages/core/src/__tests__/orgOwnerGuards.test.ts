/**
 * Owner-only staff writes (R3 S1) and invite resend/revoke reach (R3 S2):
 * the pure rules. The database half (the same rule in each statement's WHERE
 * clause) is asserted in scripts/verify-org-isolation.mjs accessChecks.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { staffWriteNeedsOwner } from "../orgStaffAdmin";
import { inviteActionAllowed } from "../orgInvite";
import { computeOrgCapabilities } from "../authz/capabilities";

describe("who may make, change or remove an admin", () => {
  it("adding or promoting to admin needs the owner", () => {
    assert.equal(staffWriteNeedsOwner({ action: "add", targetCurrentRole: null, newRole: "org_admin" }), true);
    assert.equal(staffWriteNeedsOwner({ action: "set_role", targetCurrentRole: "staff", newRole: "org_admin" }), true);
  });
  it("demoting or removing an admin needs the owner, including a re-role through add", () => {
    assert.equal(staffWriteNeedsOwner({ action: "set_role", targetCurrentRole: "org_admin", newRole: "staff" }), true);
    assert.equal(staffWriteNeedsOwner({ action: "remove", targetCurrentRole: "org_admin" }), true);
    assert.equal(staffWriteNeedsOwner({ action: "add", targetCurrentRole: "org_admin", newRole: "staff" }), true);
  });
  it("staff-only changes stay with admins", () => {
    assert.equal(staffWriteNeedsOwner({ action: "add", targetCurrentRole: null, newRole: "staff" }), false);
    assert.equal(staffWriteNeedsOwner({ action: "remove", targetCurrentRole: "staff" }), false);
  });
  it("the database statements carry the owner check too, read from access_code", () => {
    const src = readFileSync(new URL("../orgStaffAdmin.ts", import.meta.url), "utf8");
    // Shape only; the real proof is the pglite test (apps/consumer/lib/__tests__/org-owner-sql-pglite.test.ts).
    assert.equal((src.match(/ACTOR_IS_OWNER\("\$1", "\$5"\)/g) ?? []).length, 2, "insert and on-conflict re-role");
    assert.equal((src.match(/ownerSql\(authority, "\$1"/g) ?? []).length, 2, "update and delete");
    assert.match(src, /EXISTS \(SELECT 1 FROM platform_admin pa WHERE pa\.user_id = \$\{actor\}::uuid\)/);
    assert.match(src, /partner_user_id = \$\{actor\}::uuid/);
  });
});

describe("resending or removing a pending invite", () => {
  const owner = computeOrgCapabilities("owner");
  const staff = computeOrgCapabilities("staff");
  const staffNoInvite = computeOrgCapabilities("staff", [], ["org.participant.invite"]);
  it("needs Invite participants", () => {
    assert.equal(inviteActionAllowed({ capabilities: staffNoInvite, actorUserId: "me", invitedBy: "me" }), false);
  });
  it("someone limited to their own caseload acts only on invites they sent", () => {
    assert.equal(inviteActionAllowed({ capabilities: staff, actorUserId: "me", invitedBy: "me" }), true);
    assert.equal(inviteActionAllowed({ capabilities: staff, actorUserId: "me", invitedBy: "other" }), false);
    assert.equal(inviteActionAllowed({ capabilities: staff, actorUserId: "me", invitedBy: null }), false);
  });
  it("someone who sees everyone may act on any invite, but never on one that does not exist", () => {
    assert.equal(inviteActionAllowed({ capabilities: owner, actorUserId: "me", invitedBy: "other" }), true);
    assert.equal(inviteActionAllowed({ capabilities: owner, actorUserId: "me", invitedBy: undefined }), false);
  });
});
