/**
 * The organization structure routes' real handlers (lib/org-structure-http.ts)
 * with fake database calls: who may do what, the platform admin refusal, body
 * limits, action routing, and that refusals never reach the database.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { computeOrgCapabilities, cohortReach } from "@crucible/core/src/authz/capabilities";
import type { OrgActor } from "@crucible/core/src/authz/resolveOrgActor";
import { defaultOrgProfile } from "@crucible/core/src/orgStructureShared";
import {
  BODY_MAX, canAssign, canEnroll, canManage, handleEnrollmentsGet, handleEnrollmentsPost, handleProfileGet, handleProfilePatch,
  handleSetupPost, handleStructureGet, handleStructurePost, readJsonBody,
} from "../org-structure-http";

const ORG = "6b1f2c3a-0000-4000-8000-000000000001";
function actor(role: "owner" | "org_admin" | "staff", opts: { denies?: string[]; viaPlatformAdmin?: boolean } = {}) {
  const capabilities = computeOrgCapabilities(role, [], opts.denies ?? []);
  return { userId: `u-${role}`, orgId: ORG, orgName: "Hope House (Demo)", role, capabilities, reach: cohortReach(capabilities), viaPlatformAdmin: !!opts.viaPlatformAdmin } as unknown as OrgActor;
}
const owner = actor("owner"), admin = actor("org_admin"), staff = actor("staff");
const volunteer = actor("staff", { denies: ["org.enrollment.write", "org.outcome.write", "org.participant.invite"] });
const platform = actor("owner", { viaPlatformAdmin: true });
const req = (body: unknown, headers: Record<string, string> = {}) =>
  new Request("http://x/api/org/structure", { method: "POST", headers: { "content-type": "application/json", ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) });

/** A dependency that records it was called. */
function spy<T>(answer: T) {
  const calls: unknown[][] = [];
  const fn = async (...args: unknown[]) => { calls.push(args); return answer; };
  return Object.assign(fn, { calls });
}

describe("who may", () => {
  it("manage: the owner and org admins (Troy 2026-10-27), never staff or a platform admin acting for the org", () => {
    assert.deepEqual([canManage(owner), canManage(admin), canManage(staff), canManage(platform)], [true, true, false, false]);
  });
  it("enroll: every role except a volunteer and a platform admin", () => {
    assert.deepEqual([canEnroll(owner), canEnroll(admin), canEnroll(staff), canEnroll(volunteer), canEnroll(platform)], [true, true, true, false, false]);
  });
});

describe("profile", () => {
  it("GET says whether setup is still needed, only to someone who can run it", async () => {
    const getOrgProfile = async () => defaultOrgProfile(ORG);
    const a = await (await handleProfileGet(owner, { getOrgProfile })).json();
    const b = await (await handleProfileGet(staff, { getOrgProfile })).json();
    assert.equal(a.needsSetup, true); assert.equal(a.canManage, true);
    assert.equal(b.needsSetup, false); assert.equal(b.canManage, false);
    assert.equal(b.profile.terms.participant, "participant");
    const done = await (await handleProfileGet(owner, { getOrgProfile: async () => ({ ...defaultOrgProfile(ORG), setupCompletedAt: "2026-10-26T00:00:00Z" }) })).json();
    assert.equal(done.needsSetup, false);
  });
  it("GET is never cached", async () => {
    const r = await handleProfileGet(staff, { getOrgProfile: async () => defaultOrgProfile(ORG) });
    assert.equal(r.headers.get("cache-control"), "private, no-store");
  });
  it("PATCH refuses non-managers before touching the database, and passes only known fields", async () => {
    const updateOrgProfile = spy({ ok: true as const, profile: defaultOrgProfile(ORG) });
    for (const who of [staff, platform]) assert.equal((await handleProfilePatch(req({ terms: {} }), who, { updateOrgProfile })).status, 403);
    assert.equal(updateOrgProfile.calls.length, 0);
    const r = await handleProfilePatch(req({ terms: { site: "center" }, sneaky: 1, setupCompletedAt: "x" }), owner, { updateOrgProfile });
    assert.equal(r.status, 200);
    assert.deepEqual(Object.keys(updateOrgProfile.calls[0][1] as object), ["terms"]);
  });
  it("PATCH turns a refusal into its status and words", async () => {
    const r = await handleProfilePatch(req({ terms: { participant: "inmate" } }), owner, { updateOrgProfile: async () => ({ ok: false, error: "Pick a word that names the person, not their record.", status: 400 }) });
    assert.equal(r.status, 400);
    assert.match((await r.json()).error, /names the person/);
  });
  it("setup needs a type and refuses non-managers", async () => {
    const completeOrgSetup = spy({ ok: true as const, profile: defaultOrgProfile(ORG), unitsCreated: 3, unitsSkipped: false });
    assert.equal((await handleSetupPost(req({ terms: {} }), owner, { completeOrgSetup })).status, 400);
    assert.equal((await handleSetupPost(req({ orgType: "housing" }), staff, { completeOrgSetup })).status, 403);
    const r = await handleSetupPost(req({ orgType: "housing", units: [{ kind: "program", name: "A" }] }), owner, { completeOrgSetup });
    assert.equal(r.status, 200);
    assert.equal((await r.json()).unitsCreated, 3);
    assert.equal(completeOrgSetup.calls.length, 1);
  });
});

describe("bodies", () => {
  it("over the limit, not JSON, or not an object: refused", async () => {
    assert.equal(await readJsonBody(req("x".repeat(BODY_MAX + 1))), null);
    assert.equal(await readJsonBody(req("{}", { "content-length": String(BODY_MAX + 1) })), null);
    assert.equal(await readJsonBody(req("not json")), null);
    assert.equal(await readJsonBody(req("[1,2]")), null);
    assert.deepEqual(await readJsonBody(req({ a: 1 })), { a: 1 });
  });
});

describe("structure", () => {
  const deps = () => ({
    createOrgUnit: spy({ ok: true as const, id: "new" }), updateOrgUnit: spy({ ok: true as const, id: "u" }), moveOrgUnit: spy({ ok: true as const, id: "u" }),
    setOrgUnitOpen: spy({ ok: true as const, id: "u" }), setUnitMember: spy({ ok: true as const }), removeUnitMember: spy({ ok: true as const }),
  });
  it("GET: the staff list to pick from goes only to someone who can change it", async () => {
    const getOrgStructure = async () => ({ units: [], members: [], staff: [{ user_id: "s", name: "Sam", role: "staff" as const }], countsArePartial: true, ready: true });
    assert.equal((await (await handleStructureGet(owner, { getOrgStructure })).json()).staff.length, 1);
    const st = await (await handleStructureGet(staff, { getOrgStructure })).json();
    assert.equal(st.staff.length, 0); assert.equal(st.canManage, false); assert.equal(st.canEnroll, true);
    assert.equal((await handleStructureGet(staff, { getOrgStructure: async () => null })).status, 403);
  });
  it("POST: every action is refused for staff and a platform admin, with no database call", async () => {
    const d = deps();
    for (const who of [staff, platform]) for (const action of ["create_unit", "close_unit", "set_member"]) {
      assert.equal((await handleStructurePost(req({ action, unitId: "u", userId: "s" }), who, d)).status, 403);
    }
    assert.equal(Object.values(d).reduce((n, f) => n + f.calls.length, 0), 0);
  });
  it("POST routes each action to its function", async () => {
    const d = deps();
    await handleStructurePost(req({ action: "create_unit", kind: "program", name: "A", parentId: null }), owner, d);
    await handleStructurePost(req({ action: "update_unit", unitId: "u1", name: "B" }), owner, d);
    await handleStructurePost(req({ action: "move_unit", unitId: "u1", parentId: "" }), owner, d);
    await handleStructurePost(req({ action: "close_unit", unitId: "u1" }), owner, d);
    await handleStructurePost(req({ action: "reopen_unit", unitId: "u1" }), owner, d);
    await handleStructurePost(req({ action: "set_member", unitId: "u1", userId: "s1", role: "lead" }), owner, d);
    await handleStructurePost(req({ action: "remove_member", unitId: "u1", userId: "s1" }), owner, d);
    assert.equal(d.createOrgUnit.calls.length, 1);
    assert.deepEqual(Object.keys(d.updateOrgUnit.calls[0][2] as object), ["name"], "an update passes only what it names");
    assert.equal(d.moveOrgUnit.calls[0][2], null, "an empty parent means the top");
    assert.deepEqual(d.setOrgUnitOpen.calls.map((c) => c[2]), [false, true]);
    assert.deepEqual(d.setUnitMember.calls[0].slice(1), ["u1", "s1", "lead"]);
    assert.equal(d.removeUnitMember.calls.length, 1);
    assert.equal((await handleStructurePost(req({ action: "drop_table" }), owner, d)).status, 400);
  });
  it("a refusal keeps its status: 409 for a name clash", async () => {
    const d = { ...deps(), createOrgUnit: async () => ({ ok: false as const, error: "There is already an open group with that name in the same place. Pick another name.", status: 409 as const }) };
    const r = await handleStructurePost(req({ action: "create_unit", kind: "program", name: "A" }), owner, d);
    assert.equal(r.status, 409);
  });
});

describe("enrollments", () => {
  it("GET passes the filters and refuses when the core read refuses", async () => {
    const listEnrollments = spy([] as never[]);
    const r = await handleEnrollmentsGet(new URL("http://x/api/org/enrollments?participant=p1&open=1"), staff, { listEnrollments });
    assert.equal(r.status, 200);
    assert.deepEqual(listEnrollments.calls[0][1], { participantId: "p1", unitId: null, includeDone: false });
    assert.equal((await handleEnrollmentsGet(new URL("http://x/api/org/enrollments"), platform, { listEnrollments: async () => null })).status, 403);
  });
  it("POST: a volunteer and a platform admin are refused before the database", async () => {
    const createEnrollment = spy({ ok: true as const, id: "e" });
    const d = { createEnrollment, changeEnrollmentStatus: spy({ ok: true as const, status: "paused" }), updateEnrollmentDetails: spy({ ok: true as const }) };
    for (const who of [volunteer, platform]) assert.equal((await handleEnrollmentsPost(req({ action: "create", participantId: "p", unitId: "u" }), who, d)).status, 403);
    assert.equal(createEnrollment.calls.length, 0);
  });
  it("creating an enrollment is the assign power: plain staff are refused before the database (B1)", async () => {
    const createEnrollment = spy({ ok: true as const, id: "e" });
    const d = { createEnrollment, changeEnrollmentStatus: spy({ ok: true as const, status: "paused" }), updateEnrollmentDetails: spy({ ok: true as const }) };
    const r = await handleEnrollmentsPost(req({ action: "create", participantId: "p", unitId: "u" }), staff, d);
    assert.equal(r.status, 403);
    assert.equal(createEnrollment.calls.length, 0);
    assert.deepEqual([canAssign(owner), canAssign(admin), canAssign(staff), canAssign(volunteer), canAssign(platform)], [true, true, false, false, false]);
    assert.equal(canAssign(actor("staff", { denies: [] }) as never), false);
    const granted = { ...staff, capabilities: computeOrgCapabilities("staff", ["org.client.assign"]) } as unknown as OrgActor;
    assert.equal(canAssign(granted), true, "a grant of org.client.assign lets plain staff enroll");
  });
  it("POST routes create, status and details", async () => {
    const d = { createEnrollment: spy({ ok: true as const, id: "e" }), changeEnrollmentStatus: spy({ ok: true as const, status: "paused" }), updateEnrollmentDetails: spy({ ok: true as const }) };
    assert.equal((await (await handleEnrollmentsPost(req({ action: "create", participantId: "p", unitId: "u", programParticipantId: "A1" }), admin, d)).json()).id, "e");
    await handleEnrollmentsPost(req({ action: "status", enrollmentId: "e", status: "paused", reason: "needs_a_pause" }), staff, d);
    await handleEnrollmentsPost(req({ action: "details", enrollmentId: "e", programParticipantId: "A2" }), staff, d);
    assert.deepEqual(d.changeEnrollmentStatus.calls[0].slice(1), ["e", "paused", "needs_a_pause"]);
    assert.deepEqual(d.updateEnrollmentDetails.calls[0][2], { programParticipantId: "A2" });
    assert.equal((await handleEnrollmentsPost(req({ action: "delete", enrollmentId: "e" }), owner, d)).status, 400, "there is no delete");
  });
});
