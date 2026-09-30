import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  decideJoinSharingPrompt,
  JOIN_SHARING_PROMPT_TEXT,
  JOIN_SHARING_TEXT_VERSION,
  SETTINGS_SHARING_TEXT,
  SETTINGS_SHARING_TEXT_VERSION,
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
    assert.equal(JOIN_SHARING_PROMPT_TEXT.title("Example Reentry Program"), "Let Example Reentry Program see your progress?");
  });

  it("says what staff see, including the name: the console shows it", () => {
    for (const word of ["name", "email", "step", "jobs applied to", "last on", "hired"]) {
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
    assert.equal(JOIN_SHARING_TEXT_VERSION, "2026-09-30-join-v2");
    assert.equal(
      all.join(" | "),
      "Let Example Reentry Program see your progress? | They'll see your name, email, step, how much you've done (like jobs applied to and practice), when you were last on, and if you got hired. | Never your resume, your record plan or your interview answers. | Change it any time in Settings. | Yes, share | Not now | Saved. Your progress is shared. | That did not save. Turn it on in Settings."
    );
  });
});

describe("Settings sharing switch wording", () => {
  const all = Object.values(SETTINGS_SHARING_TEXT);

  it("promises the same things as the join prompt, in the same words", () => {
    for (const word of ["name", "email", "step", "jobs applied to", "last on", "hired"]) {
      assert.ok(SETTINGS_SHARING_TEXT.sees.includes(word), `missing "${word}"`);
    }
    assert.equal(SETTINGS_SHARING_TEXT.never, JOIN_SHARING_PROMPT_TEXT.never);
  });

  it("has no em dashes or double hyphens", () => {
    for (const line of all) assert.ok(!/—|–|--/.test(line), line);
  });

  it("the version is pinned to these words: change one, change both", () => {
    assert.equal(SETTINGS_SHARING_TEXT_VERSION, "2026-09-30-settings-v2");
    assert.equal(
      all.join(" | "),
      "Share your progress | Let your program see your progress | If a program gave you a code, its staff will see your name, email, step, how much you've done (like jobs applied to and practice), when you were last on, and if you got hired. | Never your resume, your record plan or your interview answers. | Sharing anything more is its own choice, one item at a time, under \"Who can see what\" below, if your program offers it. | Turn this off any time. | Share my progress with my program | On. Your program can see your progress. | Off. You are not sharing your progress."
    );
  });
});
