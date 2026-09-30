import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  decideJoinSharingPrompt,
  JOIN_SHARING_PROMPT_TEXT,
  JOIN_SHARING_TEXT_VERSION,
  type JoinPromptMembership,
} from "../joinSharingPromptShared";

const org = (over: Partial<JoinPromptMembership> = {}): JoinPromptMembership => ({
  orgId: "org-1",
  orgName: "Example Reentry Program",
  hasOwner: true,
  isOwnOrg: false,
  ...over,
});

describe("decideJoinSharingPrompt", () => {
  it("asks a new member of one organization who has never chosen", () => {
    const d = decideJoinSharingPrompt({ memberships: [org()], sharingStatus: null, requiredPolicyOrgIds: [] });
    assert.deepEqual(d, { show: true, orgId: "org-1", orgName: "Example Reentry Program" });
  });

  it("does not ask someone who already said yes", () => {
    assert.deepEqual(decideJoinSharingPrompt({ memberships: [org()], sharingStatus: "granted", requiredPolicyOrgIds: [] }), { show: false });
  });

  it("does not ask someone who turned sharing off: a past no is an answer", () => {
    assert.deepEqual(decideJoinSharingPrompt({ memberships: [org()], sharingStatus: "revoked", requiredPolicyOrgIds: [] }), { show: false });
  });

  it("does not ask someone in no organization", () => {
    assert.deepEqual(decideJoinSharingPrompt({ memberships: [], sharingStatus: null, requiredPolicyOrgIds: [] }), { show: false });
  });

  it("does not ask when the code has nobody behind it to look", () => {
    assert.deepEqual(decideJoinSharingPrompt({ memberships: [org({ hasOwner: false })], sharingStatus: null, requiredPolicyOrgIds: [] }), { show: false });
  });

  it("does not ask staff or the owner about their own organization", () => {
    assert.deepEqual(decideJoinSharingPrompt({ memberships: [org({ isOwnOrg: true })], sharingStatus: null, requiredPolicyOrgIds: [] }), { show: false });
  });

  it("stays out of the way where the program requires sharing", () => {
    const d = decideJoinSharingPrompt({ memberships: [org()], sharingStatus: null, requiredPolicyOrgIds: ["org-1"] });
    assert.deepEqual(d, { show: false });
  });

  it("another organization's requirement does not block the question", () => {
    const d = decideJoinSharingPrompt({ memberships: [org()], sharingStatus: null, requiredPolicyOrgIds: ["org-9"] });
    assert.equal(d.show, true);
  });

  it("does not name one organization when the yes would reach two", () => {
    const d = decideJoinSharingPrompt({
      memberships: [org(), org({ orgId: "org-2", orgName: "Second Program" })],
      sharingStatus: null,
      requiredPolicyOrgIds: [],
    });
    assert.deepEqual(d, { show: false });
  });

  it("ignores codes that nobody can look through when counting organizations", () => {
    const d = decideJoinSharingPrompt({
      memberships: [org(), org({ orgId: "promo", orgName: "Promo", hasOwner: false })],
      sharingStatus: null,
      requiredPolicyOrgIds: [],
    });
    assert.deepEqual(d, { show: true, orgId: "org-1", orgName: "Example Reentry Program" });
  });

  it("does not ask with a blank organization name", () => {
    assert.deepEqual(decideJoinSharingPrompt({ memberships: [org({ orgName: "  " })], sharingStatus: null, requiredPolicyOrgIds: [] }), { show: false });
  });
});

describe("join sharing prompt wording", () => {
  const all = [
    JOIN_SHARING_PROMPT_TEXT.title("Example Reentry Program"),
    JOIN_SHARING_PROMPT_TEXT.sees,
    JOIN_SHARING_PROMPT_TEXT.never,
    JOIN_SHARING_PROMPT_TEXT.control,
    JOIN_SHARING_PROMPT_TEXT.yes,
    JOIN_SHARING_PROMPT_TEXT.notNow,
    JOIN_SHARING_PROMPT_TEXT.saved,
    JOIN_SHARING_PROMPT_TEXT.failed,
  ];

  it("names the organization in the question", () => {
    assert.equal(JOIN_SHARING_PROMPT_TEXT.title("Example Reentry Program"), "Want Example Reentry Program to see your progress?");
  });

  it("says what staff see, including the name: the console shows it", () => {
    for (const word of ["name", "email", "step", "jobs you applied to", "last on", "hired"]) {
      assert.ok(JOIN_SHARING_PROMPT_TEXT.sees.includes(word), `missing "${word}"`);
    }
  });

  it("says what is never shown and that it can be changed", () => {
    for (const word of ["resume", "record plan", "interview answers"]) {
      assert.ok(JOIN_SHARING_PROMPT_TEXT.never.includes(word), `missing "${word}"`);
    }
    assert.ok(JOIN_SHARING_PROMPT_TEXT.control.includes("Settings"));
  });

  it("has no em dashes or double hyphens", () => {
    for (const line of all) assert.ok(!/—|–|--/.test(line), line);
  });

  it("keeps sentences short and words plain", () => {
    for (const line of all) {
      for (const sentence of line.split(/(?<=[.?!])\s+/)) {
        assert.ok(sentence.split(/\s+/).length <= 26, `too long: ${sentence}`);
      }
    }
  });

  it("the version is pinned to these words: change one, change both", () => {
    assert.equal(JOIN_SHARING_TEXT_VERSION, "2026-09-30-join-v1");
    assert.equal(
      all.join(" | "),
      "Want Example Reentry Program to see your progress? | They'll see your name and email, your step, how many jobs you applied to, when you were last on and if you got hired. | This never shows them your resume, your record plan or your interview answers. | You can change this any time in Settings. | Yes, share my progress | Not now | Done. Your progress is shared. You can turn it off in Settings. | That did not save. You can turn it on in Settings."
    );
  });
});
