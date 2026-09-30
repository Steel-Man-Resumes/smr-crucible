import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  consentGrantRecord,
  settingsTextVersionFor,
  dismissKey,
  rememberDismissed,
  shouldShowJoinPrompt,
  wasDismissed,
} from "../join-sharing-prompt";

function memoryStorage() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    size: () => m.size,
  };
}
const brokenStorage = {
  getItem: () => { throw new Error("blocked"); },
  setItem: () => { throw new Error("blocked"); },
};

describe("consentGrantRecord", () => {
  it("a Settings grant is recorded exactly as before", () => {
    assert.deepEqual(consentGrantRecord("settings", "2026-06-07-v1", null), {
      textVersion: "2026-06-07-v1",
      collectionMethod: "settings",
      context: { collected_from: "settings" },
      eventContext: undefined,
    });
  });

  it("a yes from the join prompt records the prompt's own words and which organization asked", () => {
    const r = consentGrantRecord("join_prompt", "2026-06-07-v1", "org-1");
    assert.equal(r.textVersion, "2026-09-30-join-v2");
    assert.equal(r.collectionMethod, "join_prompt");
    assert.deepEqual(r.context, { collected_from: "join_prompt", access_code_id: "org-1" });
    assert.deepEqual(r.eventContext, { access_code_id: "org-1" });
  });
});

describe("settingsTextVersionFor", () => {
  it("the sharing switch is recorded with its own wording version", () => {
    assert.equal(settingsTextVersionFor("sharing", "2026-06-07-v1"), "2026-09-30-settings-v2");
  });

  it("every other layer keeps the version it had", () => {
    for (const layer of ["enhanced", "research", "outcome_anonymous", "outcome_named"]) {
      assert.equal(settingsTextVersionFor(layer, "2026-06-07-v1"), "2026-06-07-v1");
    }
  });
});

describe("Not now: asked once, nothing sent anywhere", () => {
  it("shows when the server says ask and this browser has not been told no", () => {
    assert.equal(shouldShowJoinPrompt({ show: true, orgId: "org-1" }, "user-1", memoryStorage()), true);
  });

  it("does not show again after Not now", () => {
    const s = memoryStorage();
    rememberDismissed(s, "user-1", "org-1");
    assert.equal(wasDismissed(s, "user-1", "org-1"), true);
    assert.equal(shouldShowJoinPrompt({ show: true, orgId: "org-1" }, "user-1", s), false);
    assert.equal(s.size(), 1);
  });

  it("one person's Not now does not silence the next person on a shared computer", () => {
    const s = memoryStorage();
    rememberDismissed(s, "user-1", "org-1");
    assert.equal(shouldShowJoinPrompt({ show: true, orgId: "org-1" }, "user-2", s), true);
    assert.notEqual(dismissKey("user-1", "org-1"), dismissKey("user-2", "org-1"));
  });

  it("never shows when the server says no, or when nobody is signed in", () => {
    assert.equal(shouldShowJoinPrompt({ show: false }, "user-1", memoryStorage()), false);
    assert.equal(shouldShowJoinPrompt(null, "user-1", memoryStorage()), false);
    assert.equal(shouldShowJoinPrompt({ show: true, orgId: "org-1" }, null, memoryStorage()), false);
    assert.equal(shouldShowJoinPrompt({ show: true }, "user-1", memoryStorage()), false);
  });

  it("blocked storage never throws", () => {
    assert.doesNotThrow(() => rememberDismissed(brokenStorage, "user-1", "org-1"));
    assert.equal(wasDismissed(brokenStorage, "user-1", "org-1"), false);
    assert.equal(wasDismissed(null, "user-1", "org-1"), false);
  });
});
