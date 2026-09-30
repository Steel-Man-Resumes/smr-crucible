import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  staffEmptyState,
  ownCaseloadStaff,
  seeEveryoneTargets,
  SEE_EVERYONE_CAPABILITY,
  type SeeEveryoneMember,
} from "../orgVisibilityShared";
import { capabilitiesForRole, DELEGABLE_CAPABILITIES } from "../authz/capabilities";

describe("staffEmptyState", () => {
  it("nobody assigned, people waiting: says how many and who to ask by name", () => {
    const s = staffEmptyState({ ownCaseloadOnly: true, assignedToViewer: 0, unassignedJoined: 4, adminNames: ["Dana Admin"] });
    assert.equal(s.kind, "none_assigned_some_waiting");
    assert.equal(
      s.message,
      'No one is assigned to you yet. 4 people have joined and are not assigned to anyone. Ask Dana Admin to assign people to you, or to turn on "See everyone" for you.'
    );
  });

  it("uses the singular for one person", () => {
    const s = staffEmptyState({ ownCaseloadOnly: true, assignedToViewer: 0, unassignedJoined: 1, adminNames: [] });
    assert.ok(s.message.includes("1 person has joined and is not assigned to anyone."));
    assert.ok(s.message.includes("Ask your admin"));
  });

  it("names two admins, and falls back to 'your admin' for more", () => {
    assert.ok(staffEmptyState({ ownCaseloadOnly: true, assignedToViewer: 0, unassignedJoined: 2, adminNames: ["A", "B"] }).message.includes("Ask A or B to"));
    assert.ok(staffEmptyState({ ownCaseloadOnly: true, assignedToViewer: 0, unassignedJoined: 2, adminNames: ["A", "B", "C"] }).message.includes("Ask your admin to"));
    assert.ok(staffEmptyState({ ownCaseloadOnly: true, assignedToViewer: 0, unassignedJoined: 2, adminNames: ["", "  "] }).message.includes("Ask your admin to"));
  });

  it("nobody assigned and nobody waiting: points at adding a participant", () => {
    const s = staffEmptyState({ ownCaseloadOnly: true, assignedToViewer: 0, unassignedJoined: 0, adminNames: ["Dana Admin"] });
    assert.equal(s.kind, "none_assigned");
    assert.ok(s.message.startsWith("No one is assigned to you yet."));
  });

  it("people assigned but none sharing: the fix is the participant's switch, not the admin", () => {
    const s = staffEmptyState({ ownCaseloadOnly: true, assignedToViewer: 3, unassignedJoined: 5, adminNames: ["Dana Admin"] });
    assert.equal(s.kind, "assigned_not_sharing");
    assert.ok(s.message.includes("3 people are assigned to you"));
    assert.ok(s.message.includes("Privacy & Consent"));
    assert.ok(!s.message.includes("Dana"));
  });

  it("does not guess when the counts are unknown or the viewer sees everyone", () => {
    assert.equal(staffEmptyState({ ownCaseloadOnly: true, assignedToViewer: null, unassignedJoined: null, adminNames: [] }).kind, "generic");
    assert.equal(staffEmptyState({ ownCaseloadOnly: false, assignedToViewer: 0, unassignedJoined: 9, adminNames: [] }).kind, "generic");
  });

  it("never uses an em dash", () => {
    for (const s of [
      staffEmptyState({ ownCaseloadOnly: true, assignedToViewer: 0, unassignedJoined: 4, adminNames: ["A"] }),
      staffEmptyState({ ownCaseloadOnly: true, assignedToViewer: 0, unassignedJoined: 0, adminNames: [] }),
      staffEmptyState({ ownCaseloadOnly: true, assignedToViewer: 2, unassignedJoined: 0, adminNames: [] }),
      staffEmptyState({ ownCaseloadOnly: false, assignedToViewer: null, unassignedJoined: null, adminNames: [] }),
    ]) assert.ok(!/—|--/.test(s.message));
  });
});

describe("see-everyone targets", () => {
  const m = (over: Partial<SeeEveryoneMember>): SeeEveryoneMember => ({
    userId: "u", name: "Someone", email: null, role: "staff", editable: true, seesEveryone: false, ...over,
  });
  const team = [
    m({ userId: "owner", role: "owner", editable: false, seesEveryone: true }),
    m({ userId: "admin", role: "org_admin", editable: false, seesEveryone: true }),
    m({ userId: "s1" }),
    m({ userId: "s2", seesEveryone: true }),
    m({ userId: "s3", editable: false }),
  ];

  it("lists only staff who are limited to their own caseload", () => {
    assert.deepEqual(ownCaseloadStaff(team).map((x) => x.userId), ["s1", "s3"]);
  });

  it("'let all staff see everyone' touches only staff the actor may edit, never admins or the owner", () => {
    assert.deepEqual(seeEveryoneTargets(team).map((x) => x.userId), ["s1"]);
  });

  it("is a no-op when everyone already sees everyone", () => {
    assert.deepEqual(seeEveryoneTargets([m({ seesEveryone: true })]), []);
  });
});

describe("the default is unchanged: staff do not see everyone until an admin says so", () => {
  it("the staff role does not carry the see-everyone capability", () => {
    assert.ok(!capabilitiesForRole("staff").includes(SEE_EVERYONE_CAPABILITY));
    assert.ok(capabilitiesForRole("org_admin").includes(SEE_EVERYONE_CAPABILITY));
  });

  it("the switch this panel flips is the one Team & access offers", () => {
    assert.ok(DELEGABLE_CAPABILITIES.some((c) => c.capability === SEE_EVERYONE_CAPABILITY));
  });
});
