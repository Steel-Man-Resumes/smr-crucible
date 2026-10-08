/**
 * Shared-computer rule (hotfix 2026-10-07): a Forge run left in a browser is
 * never copied into, or shown inside, an account without the person's yes.
 *  - sign-up: a required yes/no with nothing preselected; "No" erases the run;
 *    register saves a run only with `saveForgeRun: true`
 *  - Refinery: no silent claim; an unowned run gets "Is it yours?"
 *  - every Refinery screen reads the run through readOwnForgeSession(uid)
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import {
  FORGE_RUN_CHOICE_DEFAULT,
  FORGE_SESSION_KEY,
  FORGE_LAST_SYNCED_RUN_KEY,
  FORGE_RUN_MAX_IDLE_MS,
  MAX_FORGE_RUN_BYTES,
  eraseLocalForgeRun,
  forgeAfterSignup,
  forgeChoiceComplete,
  forgeRegisterFields,
  forgeRunToPersist,
  forgeSyncDecision,
  markForgeRunOwned,
  forgeRunFingerprint,
  forgeRunToEraseAtSignup,
  ownForgeRunExportEntry,
  readOwnForgeSession,
  readStoredForgeRun,
} from "../forge-carry";
import { POST } from "../../app/api/auth/register/route";

const CONSUMER = join(__dirname, "..", "..");
const APP = join(CONSUMER, "app");
const read = (...p: string[]) => readFileSync(join(CONSUMER, ...p), "utf8");
const LOGIN = ["app", "(auth)", "login", "page.tsx"];
const SHELL = ["app", "(dashboard)", "RefineryShell.tsx"];
const ROUTE = ["app", "api", "auth", "register", "route.ts"];

const NOW = Date.parse("2026-10-07T12:00:00.000Z");
const RUN = {
  startedAt: "2026-10-07T10:00:00.000Z",
  _savedAt: NOW - 60_000,
  forgeOutput: { contact: { name: "Person A" }, strengths: ["Forklift"] },
  criminalRecord: { hasRecord: true },
  resumeText: "Person A resume",
};
const STALE = { ...RUN, _savedAt: NOW - FORGE_RUN_MAX_IDLE_MS - 1 };

function store(value: unknown) {
  const data = new Map<string, string>();
  if (value !== undefined) data.set(FORGE_SESSION_KEY, typeof value === "string" ? value : JSON.stringify(value));
  data.set(FORGE_LAST_SYNCED_RUN_KEY, RUN.startedAt);
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    removeItem: (k: string) => void data.delete(k),
  };
}

describe("readOwnForgeSession: the one accessor for Refinery screens", () => {
  it("returns a run marked as this user's", () => {
    const owned = { ...RUN, _ownerUserId: "user-b" };
    assert.deepEqual(readOwnForgeSession("user-b", store(owned)), owned);
  });
  it("returns null for an unowned run, even a fresh one with work in it", () => {
    assert.equal(readOwnForgeSession("user-b", store(RUN)), null);
  });
  it("returns null for another account's run", () => {
    assert.equal(readOwnForgeSession("user-b", store({ ...RUN, _ownerUserId: "user-a" })), null);
  });
  it("returns null for an expired unowned run", () => {
    assert.equal(readOwnForgeSession("user-b", store(STALE)), null);
  });
  it("still returns this account's own run after 24 hours (it is already saved to the account)", () => {
    const ownedStale = { ...STALE, _ownerUserId: "user-b" };
    assert.deepEqual(readOwnForgeSession("user-b", store(ownedStale)), ownedStale);
  });
  it("returns null before the user is known, with no run, or with junk", () => {
    assert.equal(readOwnForgeSession(undefined, store({ ...RUN, _ownerUserId: "user-b" })), null);
    assert.equal(readOwnForgeSession("user-b", store(undefined)), null);
    assert.equal(readOwnForgeSession("user-b", store("not json")), null);
    assert.equal(readOwnForgeSession("user-b", store([1, 2])), null);
  });
});

describe("Refinery sync: never claims silently", () => {
  it("asks about an unowned run even when its name matches the account", () => {
    // "Marcus" used to match "Marcus Johnson" and the run was saved silently.
    const named = { ...RUN, forgeOutput: { contact: { name: "Marcus Johnson" } } };
    assert.equal(forgeSyncDecision(JSON.stringify(named), "user-b", NOW), "ask");
  });
  it("purges another account's run, syncs only this account's run", () => {
    assert.equal(forgeSyncDecision(JSON.stringify({ ...RUN, _ownerUserId: "user-a" }), "user-b", NOW), "purge");
    assert.equal(forgeSyncDecision(JSON.stringify({ ...RUN, _ownerUserId: "user-b" }), "user-b", NOW), "owned");
  });
  it("erases an unowned run past the 24-hour idle limit instead of offering it", () => {
    assert.equal(forgeSyncDecision(JSON.stringify(STALE), "user-b", NOW), "erase");
    assert.equal(forgeSyncDecision(JSON.stringify({ ...RUN, _savedAt: undefined }), "user-b", NOW), "erase");
  });
  it("does nothing before the user is known or without a run", () => {
    assert.equal(forgeSyncDecision(JSON.stringify(RUN), undefined, NOW), "none");
    assert.equal(forgeSyncDecision(null, "user-b", NOW), "none");
    assert.equal(forgeSyncDecision(JSON.stringify({ pagesVisited: [] }), "user-b", NOW), "none");
  });
  it("the shell has no name-match claim, and saves only on an owned run or a Yes", () => {
    const src = read(...SHELL);
    assert.doesNotMatch(src, /isSamePerson/);
    assert.equal(src.match(/fetch\("\/api\/forge\/save"/g)?.length, 1, "one save call, inside saveOwnedForgeRun");
    const calls = src.match(/saveOwnedForgeRun\(/g)?.length;
    assert.equal(calls, 3, "definition + owned-run sync + the Yes answer");
    assert.match(src, /forgeSyncDecision\(stored, uid\)/);
    assert.match(src, /There&apos;s a resume in progress on this computer\. Is it yours\?/);
    assert.match(src, /`Yes, save it to \$\{sessionData\.user\.email\}`/);
    assert.match(src, />\s*No, erase it\s*</);
  });
});

describe("every Refinery reader uses the accessor", () => {
  // Every file that mentions the Forge run's storage key, by any spelling, must
  // be on this list with a reason. A new mention anywhere fails until someone
  // looks at it and either routes it through readOwnForgeSession or adds it here.
  const ALLOWED: Record<string, string> = {
    [join("lib", "forge-carry.ts")]: "the accessor itself, plus the raw read used only to ask",
    [join("lib", "forge-context.tsx")]: "the anonymous Forge's own run (the Forge pages)",
    [join("app", "(auth)", "login", "page.tsx")]: "sign-up offer (asks yes/no) and the dev reset list",
    [join("app", "(dashboard)", "RefineryShell.tsx")]: "the sync and its 'Is it yours?' card, plus the sign-out clean",
    [join("app", "api", "user", "export-data", "route.ts")]: "server SQL on the forge_session database table, not browser storage",
    [join("app", "api", "user", "delete-data", "route.ts")]: "server SQL on the forge_session database table, not browser storage",
    [join("lib", "forge-persist.ts")]: "server doc comment naming the forge_session database table",
    // fix/s3-accounts (merged 2026-10-08):
    [join("components", "forge", "ForgeAccountBar.tsx")]: "the sign-out clean's removal list (never reads the run)",
    [join("lib", "forge-import.ts")]: "doc comment only; the import's decisions take the run from ForgeProvider",
  };
  const SERVER_ONLY = Object.keys(ALLOWED).filter((k) => /api|forge-persist/.test(k));
  const MENTION = /\bforge_session\b|FORGE_SESSION_KEY|FORGE_LAST_SYNCED_RUN_KEY|forge_last_synced_run/;
  function walk(dir: string, out: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
      if (name === "node_modules" || name === "__tests__" || name === ".next") continue;
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p, out);
      else if (/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(name)) out.push(p);
    }
    return out;
  }
  it("only allow-listed files mention the Forge run's storage key", () => {
    const files = [
      ...walk(join(CONSUMER, "app")),
      ...walk(join(CONSUMER, "components")),
      ...walk(join(CONSUMER, "lib")),
      ...walk(join(CONSUMER, "..", "..", "packages", "consumer-ui", "src")),
    ];
    const mentioning = files
      .filter((f) => MENTION.test(readFileSync(f, "utf8")))
      .map((f) => relative(CONSUMER, f))
      .sort();
    assert.deepEqual(mentioning, Object.keys(ALLOWED).sort());
  });
  it("the server-side mentions never call browser storage", () => {
    for (const f of SERVER_ONLY) {
      assert.doesNotMatch(readFileSync(join(CONSUMER, f), "utf8"), /\b(localStorage|sessionStorage)\s*\.\s*\w+\(|\bgetItem\(/, f);
    }
  });
  it("the known readers call the accessor", () => {
    for (const f of [
      ["components", "resume", "ResumeWorkspace.tsx"],
      ["app", "(dashboard)", "dashboard", "page.tsx"],
      ["app", "(dashboard)", "dashboard", "resources", "page.tsx"],
      ["app", "(dashboard)", "dashboard", "applications", "page.tsx"],
    ]) {
      assert.match(read(...f), /readOwnForgeSession\(/, f.join("/"));
    }
    const settings = read("app", "(dashboard)", "dashboard", "settings", "page.tsx");
    assert.match(settings, /ownForgeRunExportEntry\(ownerUid\)/);
    assert.match(settings, /eraseLocalForgeRun\(\)/);
  });
  it("the Settings export carries the run only when it is this user's", () => {
    assert.deepEqual(ownForgeRunExportEntry("user-b", store(RUN)), {});
    assert.deepEqual(ownForgeRunExportEntry("user-b", store({ ...RUN, _ownerUserId: "user-a" })), {});
    const owned = { ...RUN, _ownerUserId: "user-b" };
    assert.deepEqual(ownForgeRunExportEntry("user-b", store(owned)), { [FORGE_SESSION_KEY]: owned });
  });
});

describe("the card saves only the run it asked about", () => {
  it("a fingerprint ignores bookkeeping but not content", () => {
    const a = JSON.stringify(RUN);
    assert.equal(forgeRunFingerprint(JSON.stringify({ ...RUN, _savedAt: NOW + 5 })), forgeRunFingerprint(a));
    assert.equal(forgeRunFingerprint(JSON.stringify({ ...RUN, _ownerUserId: "x", _synced: true })), forgeRunFingerprint(a));
    assert.notEqual(forgeRunFingerprint(JSON.stringify({ ...RUN, resumeText: "someone else" })), forgeRunFingerprint(a));
    assert.equal(forgeRunFingerprint(null), null);
  });
  it("Yes compares before it saves; a gone run closes the card; a save says so", () => {
    const src = read(...SHELL);
    const handler = src.slice(src.indexOf("async function answerForgePrompt"), src.indexOf("// Refresh this session's last-seen"));
    const compare = handler.indexOf("forgeRunFingerprint(stored) !== forgeRunFingerprint(askedRunRef.current)");
    const save = handler.indexOf("saveOwnedForgeRun(");
    assert.ok(compare > 0 && save > compare, "fingerprint check runs before the save");
    assert.match(handler, /Nothing was saved\. That resume is no longer on this computer\./);
    assert.match(handler, /Saved to your account\./);
    assert.match(src, /The resume on this computer changed since we asked\. Nothing was saved\. Is this one yours\?/);
    assert.match(read("app", "(dashboard)", "dashboard", "page.tsx"), /addEventListener\("forge-synced", loadData\)/);
  });
});

describe("create-account form: a required yes or no", () => {
  it("nothing is preselected, and Create account waits for an answer", () => {
    assert.equal(FORGE_RUN_CHOICE_DEFAULT, null);
    assert.equal(forgeChoiceComplete(true, FORGE_RUN_CHOICE_DEFAULT), false);
    assert.equal(forgeChoiceComplete(true, "yes"), true);
    assert.equal(forgeChoiceComplete(true, "no"), true);
    assert.equal(forgeChoiceComplete(false, null), true, "no run, no question");
    const src = read(...LOGIN);
    assert.match(src, /useState<ForgeRunChoice>\(FORGE_RUN_CHOICE_DEFAULT\)/);
    assert.match(src, /mode === "create" && !forgeChoiceComplete\(forgeRunOffered, forgeChoice\)/);
  });
  it("the body has no forge unless the answer is Yes", () => {
    const run = readStoredForgeRun(JSON.stringify(RUN), NOW);
    for (const choice of [null, "no"] as const) {
      const body = JSON.parse(JSON.stringify({ email: "b@x.org", ...forgeRegisterFields(run, choice) }));
      assert.equal("forge" in body, false);
      assert.equal("saveForgeRun" in body, false);
    }
    const yes = JSON.parse(JSON.stringify({ email: "b@x.org", ...forgeRegisterFields(run, "yes") }));
    assert.deepEqual(yes.forge, RUN);
    assert.equal(yes.saveForgeRun, true);
  });
  it("No erases the run and its sync mark; Yes marks it as the new account's", () => {
    assert.equal(forgeAfterSignup(true, "no"), "erase");
    assert.equal(forgeAfterSignup(true, "yes"), "mark-owned");
    assert.equal(forgeAfterSignup(false, null), "leave");
    const s = store(RUN);
    eraseLocalForgeRun(s);
    assert.equal(s.data.has(FORGE_SESSION_KEY), false);
    assert.equal(s.data.has(FORGE_LAST_SYNCED_RUN_KEY), false);
    assert.equal(markForgeRunOwned(RUN, "user-b")._ownerUserId, "user-b");
  });
  it("the page erases on No before it signs in and redirects", () => {
    const src = read(...LOGIN);
    const handler = src.slice(src.indexOf("async function handleCreate"), src.indexOf("async function handleMagicLink"));
    const erase = handler.indexOf("eraseLocalForgeRun()");
    const signInAt = handler.indexOf('signIn("password-login"');
    assert.ok(erase > 0 && signInAt > erase, "eraseLocalForgeRun() runs before signIn");
    assert.match(handler, /forgeRegisterFields\(offeredRun,/);
    assert.match(handler, /\.\.\.forgeFields, turnstileToken/);
  });
  it("the copy: two plain choices, no name, no 'tick', no missing button", () => {
    const src = read(...LOGIN);
    assert.match(src, /Yes, this is my resume\. Save it to my new account\./);
    assert.match(src, /No, this isn&apos;t mine\. Erase it from this computer\./);
    // The terms-checkbox helper's names (lib/terms-ticked.ts) are code, not copy.
    const copy = src.replace(/TERMS_TICKED_KEY|tickedMark|terms-ticked/g, "");
    assert.doesNotMatch(copy, /forgeRunName|started by|\b(un)?tick(ed)?\b|Clear this computer/i);
  });
  it("offers only a fresh run with work in it", () => {
    assert.equal(readStoredForgeRun(null, NOW), null);
    assert.equal(readStoredForgeRun("not json", NOW), null);
    assert.equal(readStoredForgeRun(JSON.stringify({ pagesVisited: [], _savedAt: NOW }), NOW), null);
    assert.equal(readStoredForgeRun(JSON.stringify(STALE), NOW), null);
    assert.deepEqual(readStoredForgeRun(JSON.stringify(RUN), NOW), RUN);
  });
  it("never offers a run already marked with an owner, and erases it at sign-up", () => {
    const owned = JSON.stringify({ ...RUN, _ownerUserId: "user-x" });
    assert.equal(readStoredForgeRun(owned, NOW), null);
    assert.equal(forgeRunToEraseAtSignup(owned, NOW), true);
    assert.equal(forgeRunToEraseAtSignup(JSON.stringify(STALE), NOW), true);
    assert.equal(forgeRunToEraseAtSignup(JSON.stringify(RUN), NOW), false);
    const src = read(...LOGIN);
    assert.match(src, /!forgeRunOffered && forgeRunToEraseAtSignup\(readLocalForgeRunRaw\(\)\)/);
  });
});

describe("register: persists a Forge run only with saveForgeRun: true", () => {
  it("ignores forge when saveForgeRun is missing or anything but true", () => {
    assert.deepEqual(forgeRunToPersist({ email: "b@x.org", forge: RUN }), { ok: true, run: null });
    for (const v of [false, "true", 1, "yes", null]) {
      assert.deepEqual(forgeRunToPersist({ forge: RUN, saveForgeRun: v }), { ok: true, run: null });
    }
  });
  it("keeps forge when saveForgeRun is true and the run has work", () => {
    assert.deepEqual(forgeRunToPersist({ forge: RUN, saveForgeRun: true }), { ok: true, run: RUN });
    assert.deepEqual(forgeRunToPersist({ forge: { pagesVisited: ["/intro"] }, saveForgeRun: true }), { ok: true, run: null });
  });
  it("refuses a run over the cap, and the cap fits a real run", () => {
    assert.ok(MAX_FORGE_RUN_BYTES >= 200_000);
    const big = { ...RUN, resumeText: "x".repeat(MAX_FORGE_RUN_BYTES + 1) };
    assert.deepEqual(forgeRunToPersist({ forge: big, saveForgeRun: true }), { ok: false, reason: "too_large" });
  });
  it("the route wires the decision in and logs no message text", () => {
    const src = read(...ROUTE);
    assert.match(src, /forgeRunToPersist\(body\)/);
    assert.deepEqual(src.match(/persistForgeSession\([^)]*\)/g) ?? [], ["persistForgeSession(newUserId, forgeRun.run)"]);
    assert.doesNotMatch(src, /console\.error\([^)]*\?\.message/);
  });
});

describe("register route: early refusals (no database reached)", () => {
  function post(body: string) {
    return POST(
      new Request("http://localhost/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
      })
    );
  }
  it("refuses an oversize consented run before anything else", async () => {
    const big = { ...RUN, resumeText: "x".repeat(MAX_FORGE_RUN_BYTES + 1) };
    const res = await post(JSON.stringify({ forge: big, saveForgeRun: true }));
    assert.equal(res.status, 413);
  });
  it("refuses a body over the limit even without a content-length header", async () => {
    const res = await post(JSON.stringify({ junk: "x".repeat(1_600_000) }));
    assert.equal(res.status, 413);
  });
  it("answers a non-object body with 400, not 500", async () => {
    assert.equal((await post("null")).status, 400);
    assert.equal((await post("[1]")).status, 400);
  });
});
