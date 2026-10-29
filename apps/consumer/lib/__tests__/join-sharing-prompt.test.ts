import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  consentGrantRecord,
  settingsTextVersionFor,
  dismissKey,
  rememberDismissed,
  shouldShowJoinPrompt,
  wasDismissed,
  DISMISS_COOKIE,
  dismissCookieAssignment,
  readDismissCookie,
} from "../join-sharing-prompt";
import { readFileSync } from "node:fs";

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

describe("Not now holds on both hosts (demo review 2026-10-28, Ceci)", () => {
  const U = "0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f";
  const O = "1a1a1a1a-1a1a-4a1a-8a1a-1a1a1a1a1a1a";
  const cookieValue = (assignment: string) => assignment.split(";")[0];

  it("Not now on one host silences the prompt on the other, through the shared cookie", () => {
    const set = dismissCookieAssignment("", U, O, "refinery.steelmanresumes.com", "https:")!;
    assert.match(set, /; Domain=\.steelmanresumes\.com/);
    assert.match(set, /; Secure/);
    assert.match(set, /SameSite=Lax/);
    // The Forge host: empty localStorage of its own, but the same cookie.
    const forgeCookie = `other=1; ${cookieValue(set)}`;
    assert.equal(shouldShowJoinPrompt({ show: true, orgId: O }, U, memoryStorage(), forgeCookie), false);
    assert.equal(wasDismissed(memoryStorage(), U, O, forgeCookie), true);
  });

  it("the cookie is per person and per organization, and holds no words", () => {
    const c = cookieValue(dismissCookieAssignment("", U, O, "forge.steelmanresumes.com", "https:")!);
    assert.equal(c, `${DISMISS_COOKIE}=${U}.${O}`);
    const other = "2b2b2b2b-2b2b-4b2b-8b2b-2b2b2b2b2b2b";
    assert.equal(shouldShowJoinPrompt({ show: true, orgId: O }, other, memoryStorage(), c), true, "the next person on a shared computer is still asked");
    assert.equal(shouldShowJoinPrompt({ show: true, orgId: other }, U, memoryStorage(), c), true, "a different organization still asks");
  });

  it("host-only off steelmanresumes.com; keeps the newest eight pairs; never duplicates", () => {
    assert.doesNotMatch(dismissCookieAssignment("", U, O, "localhost", "http:")!, /Domain=|Secure/);
    let jar = "";
    for (let i = 0; i < 10; i++) jar = cookieValue(dismissCookieAssignment(jar, `u${i}`, O, "localhost", "http:")!);
    jar = cookieValue(dismissCookieAssignment(jar, "u9", O, "localhost", "http:")!);
    const pairs = readDismissCookie(jar);
    assert.equal(pairs.length, 8);
    assert.equal(new Set(pairs).size, 8);
    assert.equal(pairs.at(-1), `u9.${O}`);
  });

  it("malformed or hostile values are ignored, never trusted", () => {
    assert.equal(dismissCookieAssignment("", "a;b", O, "localhost", "http:"), null);
    assert.equal(dismissCookieAssignment("", U, "x=y", "localhost", "http:"), null);
    assert.deepEqual(readDismissCookie(`${DISMISS_COOKIE}=a.b.c,${U}.${O},.x,y.`), [`${U}.${O}`]);
    assert.deepEqual(readDismissCookie(null), []);
  });

  it("the server still decides whether to ask: the cookie can only silence, never show, and Yes still writes consent", () => {
    assert.equal(shouldShowJoinPrompt({ show: false }, U, memoryStorage(), ""), false);
    assert.equal(shouldShowJoinPrompt(null, U, memoryStorage(), `${DISMISS_COOKIE}=`), false);
    const src = readFileSync(new URL("../../components/JoinSharingPrompt.tsx", import.meta.url), "utf8");
    assert.match(src, /shouldShowJoinPrompt\(decision, decision\.viewerId, storage\(\), cookies\(\)\)/);
    assert.match(src, /body: JSON\.stringify\(\{ layer: "sharing", action: "grant", source: "join_prompt" \}\)/, "Yes is unchanged");
    // Not now still sends nothing to the server.
    const notNow = src.slice(src.indexOf("function notNow"), src.indexOf("return (", src.indexOf("function notNow")));
    assert.doesNotMatch(notNow, /fetch\(/);
  });
});
