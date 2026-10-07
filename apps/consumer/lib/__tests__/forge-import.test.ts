/**
 * Lane 3a, part 1: saving the run in this browser to the account on sign-in,
 * and the CSRF guard on the save.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  IMPORT_FIELDS,
  afterSave,
  importDecision,
  importPayload,
  runLevel,
} from "../forge-import";
import { isSamePerson } from "../is-same-person";
import { profileUpsertParams } from "@crucible/core/src/forgeSession";
import { isSameOriginJsonPost } from "../same-origin";

const root = join(import.meta.dirname, "..", "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

const USER = { id: "user-a", name: "Morgan Sample", email: "Morgan@Example.com" };
const RESUME = "MORGAN SAMPLE\nmorgan@example.com\n\nEXPERIENCE\nLine Cook | Harbor Street Diner | 2019 - 2023\n- Ran the grill.";

const midRun = (extra: Record<string, unknown> = {}) => ({
  _v: 2,
  _savedAt: 1,
  readinessStage: "preparation",
  startedAt: "2026-10-06T12:00:00.000Z",
  resumeText: RESUME,
  originalResumeText: RESUME + "\n(as uploaded)",
  forgeFinish: { v: 1, key: "k" },
  ...extra,
});

describe("which runs are saved, asked about, or cleared", () => {
  it("nothing happens without a signed-in user or a run", () => {
    assert.deepEqual(importDecision(midRun(), null, isSamePerson), { action: "none" });
    assert.deepEqual(importDecision(null, USER, isSamePerson), { action: "none" });
    assert.deepEqual(importDecision([], USER, isSamePerson), { action: "none" });
  });

  it("a demo run (sample data) never enters an account", () => {
    assert.deepEqual(importDecision(midRun({ isDemo: true }), USER, isSamePerson), { action: "none" });
  });

  it("a run saved to another account is cleared from this browser, never imported", () => {
    assert.deepEqual(importDecision(midRun({ _ownerUserId: "user-b" }), USER, isSamePerson), { action: "clear" });
  });

  it("a run with no name, or someone else's name, is asked about, never assumed", () => {
    const d = importDecision(midRun(), USER, isSamePerson);
    assert.equal(d.action, "ask");
    const other = importDecision(
      midRun({ resumeDoc: { contact: { name: "Jordan Example" } } }),
      USER,
      isSamePerson
    );
    assert.equal(other.action, "ask");
    if (other.action === "ask") assert.equal(other.name, "Jordan Example");
    const noAccountName = importDecision(midRun({ resumeDoc: { contact: { name: "Morgan Sample" } } }), { ...USER, name: null }, isSamePerson);
    assert.equal(noAccountName.action, "ask");
  });

  it("saved without asking when the name matches, or this browser just registered with it", () => {
    assert.deepEqual(
      importDecision(midRun({ resumeDoc: { contact: { name: "Morgan Sample" } } }), USER, isSamePerson),
      { action: "save", level: 1 }
    );
    assert.deepEqual(
      importDecision(midRun({ _registeredAs: "morgan@example.com" }), USER, isSamePerson),
      { action: "save", level: 1 }
    );
    assert.equal(importDecision(midRun({ _registeredAs: "someone@example.com" }), USER, isSamePerson).action, "ask");
  });

  it("a run with no resume yet is only claimed (nothing worth saving)", () => {
    assert.deepEqual(importDecision({ audience: "client", readinessStage: "action" }, USER, isSamePerson), { action: "claim" });
  });

  it("an owned run saves again only when it moves up a level (resume, then finished)", () => {
    const owned = midRun({ _ownerUserId: "user-a", _syncedLevel: 1 });
    assert.deepEqual(importDecision(owned, USER, isSamePerson), { action: "none" });
    assert.deepEqual(
      importDecision({ ...owned, forgeOutput: { narrative: {} } }, USER, isSamePerson),
      { action: "save", level: 2 }
    );
    assert.deepEqual(importDecision(midRun({ _ownerUserId: "user-a" }), USER, isSamePerson), { action: "save", level: 1 });
  });

  it("levels", () => {
    assert.equal(runLevel({}), 0);
    assert.equal(runLevel({ resumeText: "   " }), 0);
    assert.equal(runLevel({ resumeText: "x" }), 1);
    assert.equal(runLevel({ resumeDoc: { formatVersion: 3 } }), 1);
    assert.equal(runLevel({ forgeOutput: {} }), 2);
  });
});

describe("what is sent, and what the account keeps", () => {
  it("sends only the save contract's fields; the original upload and finish state stay in the browser", () => {
    const body = importPayload(midRun({ forgeOutput: { skills: [] }, carriedIn: { code: "X" }, _ownerUserId: "user-a" }));
    for (const k of Object.keys(body)) assert.ok((IMPORT_FIELDS as readonly string[]).includes(k), k);
    assert.equal("originalResumeText" in body, false);
    assert.equal("forgeFinish" in body, false);
    assert.equal("carriedIn" in body, false);
    assert.equal("_ownerUserId" in body, false);
  });

  it("a field the run does not have is left out, never sent empty", () => {
    const body = importPayload({ readinessStage: "action", resumeText: RESUME, goals: undefined, challenges: null });
    assert.deepEqual(Object.keys(body).sort(), ["readinessStage", "resumeText"]);
    assert.equal(JSON.stringify(body).includes("null"), false);
  });

  it("through the account save, an absent field never wipes what the account holds", () => {
    // A run mid-way (no goals, no record answers, no preferences yet).
    const body = importPayload({ readinessStage: "action", resumeText: RESUME, startedAt: "t" });
    const params = profileUpsertParams("user-a", body as any);
    const profile = JSON.parse(params[2] as string);
    const narrative = JSON.parse(params[3] as string);
    const prefs = JSON.parse(params[4] as string);
    assert.equal("challenges" in profile, false);
    assert.equal("criminalRecord" in profile, false);
    assert.equal("goals" in narrative, false);
    assert.deepEqual(prefs, {});
    assert.equal(params[7], null); // forge_output: COALESCE keeps the saved one
    assert.equal(profile.resumeText, RESUME);
  });

  it("marks after a save; the finished save also tells the Refinery's sync it is done", () => {
    assert.deepEqual(afterSave(midRun(), "user-a", 1), { _ownerUserId: "user-a", _syncedLevel: 1 });
    assert.deepEqual(afterSave(midRun(), "user-a", 2), {
      _ownerUserId: "user-a",
      _syncedLevel: 2,
      _synced: true,
      _syncedAt: "2026-10-06T12:00:00.000Z",
    });
  });

  it("the login page checks the return address itself and brings Forge arrivals back", () => {
    const login = read("app/(auth)/login/page.tsx");
    assert.match(login, /const callbackUrl = safeLoginReturn\(searchParams\.get\("callbackUrl"\)\)/);
    assert.match(login, /if \(forgeReturn\) return forgeReturn;/);
  });

  it("the shell runs the import, and the register path marks the run it carried", () => {
    assert.match(read("app/(forge)/ForgeShell.tsx"), /<ForgeImport showPrompt=\{!quiet\} \/>/);
    const login = read("app/(auth)/login/page.tsx");
    assert.match(login, /run\._registeredAs = email\.trim\(\)\.toLowerCase\(\)/);
    const comp = read("components/forge/ForgeImport.tsx");
    assert.match(comp, /!sessionPending\(authUser\)/);
    assert.match(comp, /"\/api\/forge\/save"/);
    assert.match(comp, /"Content-Type": "application\/json"/);
  });
});

describe("CSRF: only this origin may post a run into the account", () => {
  const json = { "content-type": "application/json" };
  it("allows a same-origin fetch", () => {
    assert.ok(isSameOriginJsonPost(new Headers({ ...json, "sec-fetch-site": "same-origin" })));
    assert.ok(isSameOriginJsonPost(new Headers({ ...json, origin: "https://forge.example.org", host: "forge.example.org" })));
    assert.ok(isSameOriginJsonPost(new Headers({ ...json, origin: "https://forge.example.org", "x-forwarded-host": "forge.example.org", host: "internal" })));
    assert.ok(isSameOriginJsonPost(new Headers(json)));
  });

  it("refuses a sibling host on the shared cookie domain, another site, or a form post", () => {
    assert.equal(isSameOriginJsonPost(new Headers({ ...json, "sec-fetch-site": "same-site" })), false);
    assert.equal(isSameOriginJsonPost(new Headers({ ...json, "sec-fetch-site": "cross-site" })), false);
    assert.equal(isSameOriginJsonPost(new Headers({ ...json, origin: "https://www.example.org", host: "forge.example.org" })), false);
    assert.equal(isSameOriginJsonPost(new Headers({ ...json, origin: "null", host: "forge.example.org" })), false);
    assert.equal(isSameOriginJsonPost(new Headers({ "content-type": "text/plain", "sec-fetch-site": "same-origin" })), false);
    assert.equal(isSameOriginJsonPost(new Headers({ "content-type": "application/x-www-form-urlencoded" })), false);
  });

  it("the save route checks it before reading the session or the body", () => {
    const src = read("app/api/forge/save/route.ts");
    assert.ok(src.indexOf("isSameOriginJsonPost(request.headers)") < src.indexOf("await auth()"));
  });
});
