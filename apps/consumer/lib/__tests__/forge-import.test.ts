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
  IMPORT_QUESTION,
  importYesLabel,
  runHasAnswers,
  runLevel,
  signedOutDecision,
} from "../forge-import";
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
    assert.deepEqual(importDecision(midRun(), null), { action: "none" });
    assert.deepEqual(importDecision(null, USER), { action: "none" });
    assert.deepEqual(importDecision([], USER), { action: "none" });
  });

  it("a demo run (sample data) never enters an account", () => {
    assert.deepEqual(importDecision(midRun({ isDemo: true }), USER), { action: "none" });
  });

  it("a run saved to another account is cleared from this browser, never imported", () => {
    assert.deepEqual(importDecision(midRun({ _ownerUserId: "user-b" }), USER), { action: "clear" });
    assert.deepEqual(importDecision(midRun({ _ownerUserId: "user-b" }), USER, { madeHere: true }), { action: "clear" });
  });

  it("a run with no name, or someone else's name, is asked about, never assumed", () => {
    const d = importDecision(midRun(), USER);
    assert.equal(d.action, "ask");
    const other = importDecision(midRun({ resumeDoc: { contact: { name: "Jordan Example" } } }), USER);
    assert.equal(other.action, "ask");
    if (other.action === "ask") assert.equal(other.name, "Jordan Example");
  });

  // Security review 3a r1, M1: a name match decided ownership ("Jane" matched
  // "Jane Doe"), so a login-CSRF account named like the victim got the run.
  it("M1: a matching name never saves without asking (exact, partial, or case)", () => {
    for (const accountName of ["Morgan Sample", "morgan sample", "Morgan"]) {
      const d = importDecision(midRun({ resumeDoc: { contact: { name: "Morgan Sample" } } }), { ...USER, name: accountName });
      assert.equal(d.action, "ask", accountName);
    }
  });

  // H1: the register path's mark was treated as proof of ownership.
  it("H1: a mark left by account creation is not proof; the person is asked", () => {
    assert.equal(importDecision(midRun({ _registeredAs: "morgan@example.com" }), USER).action, "ask");
  });

  it("a run this account started in this tab is this account's (no question for your own new run)", () => {
    assert.deepEqual(importDecision(midRun(), USER, { madeHere: true }), { action: "claim" });
  });

  it("an empty run is only claimed; one with answers but no resume yet is asked about", () => {
    assert.deepEqual(importDecision({ audience: "client", pagesVisited: ["intro"] }, USER), { action: "claim" });
    assert.equal(importDecision({ audience: "client", readinessStage: "action" }, USER).action, "ask");
    assert.equal(importDecision({ carriedIn: { code: "X", skills: ["a"], jobs: [] } }, USER).action, "ask");
    assert.equal(runHasAnswers({ audience: "client", pagesVisited: ["intro"], startedAt: "t" }), false);
    assert.equal(runHasAnswers({ goals: [] }), false);
    assert.equal(runHasAnswers({ goals: ["x"] }), true);
  });

  it("an owned run saves again only when it moves up a level (resume, then finished)", () => {
    const owned = midRun({ _ownerUserId: "user-a", _syncedLevel: 1 });
    assert.deepEqual(importDecision(owned, USER), { action: "none" });
    assert.deepEqual(importDecision({ ...owned, forgeOutput: { narrative: {} } }, USER), { action: "save", level: 2 });
    assert.deepEqual(importDecision(midRun({ _ownerUserId: "user-a" }), USER), { action: "save", level: 1 });
  });

  it("H1: once nobody is signed in, a run marked for an account is cleared; an unmarked one is kept", () => {
    assert.equal(signedOutDecision(midRun({ _ownerUserId: "user-a" })), "clear");
    assert.equal(signedOutDecision(midRun()), "keep");
    assert.equal(signedOutDecision(null), "keep");
  });

  it("M1 (r1, reworded r2 to the hotfix's card): the button names the account; the run's name is never shown", () => {
    assert.equal(IMPORT_QUESTION, "There's a resume in progress on this computer. Is it yours?");
    assert.equal(importYesLabel("morgan@example.com"), "Yes, save it to morgan@example.com");
    assert.doesNotMatch(IMPORT_QUESTION + importYesLabel("a@b.c"), /[\u2013\u2014]/);
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

  it("the shell runs the import; the import skips pending sessions and posts same-origin JSON", () => {
    assert.match(read("app/(forge)/ForgeShell.tsx"), /<ForgeImport showPrompt \/>/);
    const comp = read("components/forge/ForgeImport.tsx");
    assert.match(comp, /!sessionPending\(authUser\)/);
    assert.match(comp, /"\/api\/forge\/save"/);
    assert.match(comp, /"Content-Type": "application\/json"/);
    assert.match(comp, /signedOutDecision\(run\) === "clear"/);
  });
});

// Security review 3a r1, H1: account creation carried any run in the browser
// (someone else's, already saved to their account) into the new account.
describe("H1: no run enters an account except through the Forge's question", () => {
  const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  it("the create-account form sends no run and leaves no ownership mark", () => {
    const login = code(read("app/(auth)/login/page.tsx"));
    const body = login.slice(login.indexOf('fetch("/api/auth/register"'), login.indexOf('fetch("/api/auth/register"') + 400);
    assert.doesNotMatch(body, /\bforge\b/);
    assert.doesNotMatch(login, /_registeredAs/);
  });

  it("register ignores any run it is sent and never saves one", () => {
    const reg = code(read("app/api/auth/register/route.ts"));
    assert.doesNotMatch(reg, /persistForgeSession|saveForgeSession|forge-persist/);
    assert.doesNotMatch(reg, /\bforge\b\s*[,}]/);
  });

  it("the save route refuses a run marked for another account, before saving", () => {
    const src = read("app/api/forge/save/route.ts");
    assert.match(src, /typeof marked === "string" && marked !== userId/);
    assert.ok(src.indexOf("marked !== userId") < src.indexOf("await persistForgeSession"));
  });

  it("the Refinery's sync never claims an unmarked run (no name match)", () => {
    const shell = code(read("app/(dashboard)/RefineryShell.tsx"));
    assert.doesNotMatch(shell, /isSamePerson/);
    // Round 2: the Refinery asks as the live hotfix does (lib/forge-carry.ts).
    assert.match(shell, /forgeSyncDecision\(stored, uid\)/);
    assert.match(shell, /decision === "ask"/);
  });

  it("signing out from the Forge clears the run first", () => {
    const bar = read("components/forge/ForgeAccountBar.tsx");
    assert.ok(bar.indexOf('localStorage.removeItem(k)') < bar.indexOf("await signOut("));
    assert.match(bar, /"forge_session"/);
  });
});

describe("CSRF: only this app's origins may post a run into the account", () => {
  const json = { "content-type": "application/json" };
  const env = { NODE_ENV: "production", AUTH_URL: "https://forge.example.org" };
  it("allows a same-origin fetch, or a configured origin when Sec-Fetch-Site is absent", () => {
    assert.ok(isSameOriginJsonPost(new Headers({ ...json, "sec-fetch-site": "same-origin" }), env));
    assert.ok(isSameOriginJsonPost(new Headers({ ...json, origin: "https://forge.example.org" }), env));
    assert.ok(isSameOriginJsonPost(new Headers({ ...json, origin: "https://refinery.steelmanresumes.com" }), env));
    assert.ok(isSameOriginJsonPost(new Headers(json), env));
  });

  it("refuses a sibling host on the shared cookie domain, another site, or a form post", () => {
    assert.equal(isSameOriginJsonPost(new Headers({ ...json, "sec-fetch-site": "same-site" }), env), false);
    assert.equal(isSameOriginJsonPost(new Headers({ ...json, "sec-fetch-site": "cross-site" }), env), false);
    assert.equal(isSameOriginJsonPost(new Headers({ ...json, origin: "https://www.steelmanresumes.com" }), env), false);
    assert.equal(isSameOriginJsonPost(new Headers({ ...json, origin: "null" }), env), false);
    assert.equal(isSameOriginJsonPost(new Headers({ "content-type": "text/plain", "sec-fetch-site": "same-origin" }), env), false);
    assert.equal(isSameOriginJsonPost(new Headers({ "content-type": "application/x-www-form-urlencoded" }), env), false);
  });

  // L3: the sender controls Host and X-Forwarded-Host; they are never trusted.
  it("L3: an origin that matches only the request's own Host or X-Forwarded-Host is refused", () => {
    assert.equal(
      isSameOriginJsonPost(new Headers({ ...json, origin: "https://evil.example", "x-forwarded-host": "evil.example" }), env),
      false
    );
    assert.equal(isSameOriginJsonPost(new Headers({ ...json, origin: "https://evil.example", host: "evil.example" }), env), false);
    assert.equal(isSameOriginJsonPost(new Headers({ ...json, origin: "http://localhost:3117" }), env), false);
    assert.ok(isSameOriginJsonPost(new Headers({ ...json, origin: "http://localhost:3117" }), { NODE_ENV: "development" }));
  });

  it("the save route checks it before reading the session or the body", () => {
    const src = read("app/api/forge/save/route.ts");
    assert.ok(src.indexOf("isSameOriginJsonPost(request.headers)") < src.indexOf("await auth()"));
  });
});
