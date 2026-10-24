/**
 * The org authorization rules, tested exhaustively while they are still pure.
 *
 * Every authorization decision the admin console makes reduces to
 * computeOrgCapabilities, which touches no database, no session and no clock.
 * That is the point of the design: the rules that decide whether one
 * organization can see another organization's people can be proven here, in
 * milliseconds, with nothing stood up.
 *
 * The fail-closed cases matter more than the happy path. An unknown role must
 * yield NOTHING rather than everything, and a capability string that is not in
 * the vocabulary must be dropped no matter where it came from.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  ORG_CAPABILITIES,
  ORG_STAFF_ROLES,
  capabilitiesForRole,
  cohortReach,
  computeOrgCapabilities,
  isOrgCapability,
  type OrgStaffRole,
} from "../authz/capabilities";

describe("org role bundles", () => {
  it("gives staff their assigned clients, never the whole cohort", () => {
    const caps = computeOrgCapabilities("staff");
    assert.equal(caps.has("org.client.view_assigned"), true);
    assert.equal(caps.has("org.client.view_all"), false);
    assert.equal(cohortReach(caps), "assigned");
  });

  it("lets an org admin see the whole cohort", () => {
    assert.equal(cohortReach(computeOrgCapabilities("org_admin")), "all");
  });

  it("reserves money and settings for the owner", () => {
    for (const cap of ["org.costs.view", "org.settings.manage"] as const) {
      assert.equal(computeOrgCapabilities("staff").has(cap), false);
      assert.equal(computeOrgCapabilities("org_admin").has(cap), false);
      assert.equal(computeOrgCapabilities("owner").has(cap), true);
    }
  });

  it("grants impersonation to nobody by default", () => {
    for (const role of ORG_STAFF_ROLES) {
      assert.equal(
        computeOrgCapabilities(role).has("org.impersonate.view_as"),
        false,
        `${role} should not impersonate without an explicit grant`
      );
    }
  });

  it("nests the bundles, so a promotion never removes a power", () => {
    const admin = capabilitiesForRole("org_admin");
    const owner = capabilitiesForRole("owner");
    for (const cap of capabilitiesForRole("staff")) {
      assert.ok(admin.includes(cap), `org_admin is missing ${cap}`);
    }
    for (const cap of admin) {
      assert.ok(owner.includes(cap), `owner is missing ${cap}`);
    }
  });

  it("bundles only reference capabilities that exist", () => {
    for (const role of ORG_STAFF_ROLES) {
      for (const cap of capabilitiesForRole(role)) {
        assert.ok(isOrgCapability(cap), `${role} references unknown ${cap}`);
      }
    }
  });
});

describe("deny always wins", () => {
  it("beats the role bundle", () => {
    const caps = computeOrgCapabilities("owner", [], ["org.costs.view"]);
    assert.equal(caps.has("org.costs.view"), false);
  });

  it("beats an explicit grant of the same capability", () => {
    const caps = computeOrgCapabilities(
      "staff",
      ["org.client.view_all"],
      ["org.client.view_all"]
    );
    assert.equal(caps.has("org.client.view_all"), false);
  });

  it("is independent of the order the lists arrive in", () => {
    const a = computeOrgCapabilities("staff", ["org.export"], ["org.export"]);
    const b = computeOrgCapabilities("staff", ["org.export", "org.export"], ["org.export"]);
    assert.equal(a.has("org.export"), false);
    assert.equal(b.has("org.export"), false);
  });
});

describe("the allowlist holds", () => {
  it("drops grants that are not in the vocabulary", () => {
    const base = computeOrgCapabilities("staff");
    const tampered = computeOrgCapabilities("staff", [
      "org.everything",
      "admin",
      "*",
      "org.client.view_ALL",
    ]);
    assert.equal(tampered.size, base.size);
  });

  it("ignores denies that are not in the vocabulary", () => {
    const base = computeOrgCapabilities("owner");
    assert.equal(computeOrgCapabilities("owner", [], ["nonsense"]).size, base.size);
  });

  it("rejects a near-miss capability string", () => {
    assert.equal(isOrgCapability("org.client.view_All"), false);
    assert.equal(isOrgCapability("org.client.view_all"), true);
  });
});

describe("fail closed", () => {
  it("gives an unknown role nothing at all", () => {
    const caps = computeOrgCapabilities("superuser" as OrgStaffRole);
    assert.equal(caps.size, 0);
    assert.equal(cohortReach(caps), "none");
  });

  it("gives an unknown role NO BUNDLE, and honours only explicit grants", () => {
    // The name of this test used to say "nothing even with grants attached"
    // while asserting the grant WAS honoured -- a contradiction caught in
    // review. The behaviour is intentional and the old name was wrong: a grant
    // is a deliberate per-user row, so it stands on its own, but it brings no
    // bundle with it. An unrecognised role contributes exactly zero.
    const caps = computeOrgCapabilities("superuser" as OrgStaffRole, ["org.client.view_all"]);
    assert.equal(caps.size, 1, "an unknown role must contribute no bundle");
    assert.equal(caps.has("org.client.view_all"), true, "an explicit grant still stands");
    assert.equal(caps.has("org.costs.view"), false);
  });

  it("has no duplicate capability strings in the vocabulary", () => {
    assert.equal(new Set(ORG_CAPABILITIES).size, ORG_CAPABILITIES.length);
  });
});

import { STAFF_PRESETS, presetOverrideWrites, matchesPreset, DELEGABLE_CAPABILITIES } from "../authz/capabilities";

describe("volunteer preset", () => {
  it("is staff with no invites, no placements, own caseload only", () => {
    const writes = presetOverrideWrites("volunteer");
    const denies = writes.filter((w) => w.effect === "deny").map((w) => w.capability).sort();
    assert.deepEqual(denies, ["org.outcome.write", "org.participant.invite"]);
    const caps = computeOrgCapabilities("staff", [], denies);
    assert.equal(caps.has("org.participant.invite"), false);
    assert.equal(caps.has("org.outcome.write"), false);
    assert.equal(cohortReach(caps), "assigned");
    assert.equal(caps.has("org.seats.view"), false, "seats, and with them the code, stay out of sight");
    assert.equal(caps.has("org.note.write"), true, "still does casework");
    assert.equal(matchesPreset("volunteer", caps), true);
  });
  it("clears any old grant of the other preset capabilities, so it cannot be outlived", () => {
    const clears = presetOverrideWrites("volunteer").filter((w) => w.effect === "clear").map((w) => w.capability);
    for (const c of ["org.client.view_all", "org.seats.view", "org.costs.view", "org.export"]) assert.ok(clears.includes(c as never), c);
    assert.equal(matchesPreset("volunteer", computeOrgCapabilities("staff", ["org.client.view_all"], [])), false);
  });
  it("only writes capabilities the database will accept per person", () => {
    const delegable = new Set(DELEGABLE_CAPABILITIES.map((d) => d.capability));
    for (const w of presetOverrideWrites("volunteer")) assert.ok(delegable.has(w.capability), w.capability);
    assert.equal(STAFF_PRESETS.volunteer.role, "staff");
  });
  it("a plain staff member does not match", () => {
    assert.equal(matchesPreset("volunteer", computeOrgCapabilities("staff")), false);
  });
});
