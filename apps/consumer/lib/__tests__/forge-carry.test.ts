/**
 * Shared-computer rule (hotfix 2026-10-07): a Forge run left in a browser must
 * never land in the NEXT person's new account without their explicit yes.
 * The create-account form sends it only when an unticked-by-default box is
 * ticked, and /api/auth/register saves it only with `saveForgeRun: true`.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  SAVE_FORGE_RUN_DEFAULT,
  MAX_FORGE_RUN_BYTES,
  forgeRegisterFields,
  forgeRunName,
  forgeRunToPersist,
  readStoredForgeRun,
} from "../forge-carry";
import { POST } from "../../app/api/auth/register/route";

const APP = join(__dirname, "..", "..", "app");
const RUN = {
  startedAt: "2026-10-07T10:00:00.000Z",
  forgeOutput: { contact: { name: "Person A" }, strengths: ["Forklift"] },
  criminalRecord: { hasRecord: true },
  resumeText: "Person A resume",
};

describe("register: persists a Forge run only with saveForgeRun: true", () => {
  it("ignores forge when saveForgeRun is missing", () => {
    assert.deepEqual(forgeRunToPersist({ email: "b@x.org", forge: RUN }), { ok: true, run: null });
  });
  it("ignores forge when saveForgeRun is anything but true", () => {
    for (const v of [false, "true", 1, "yes", null]) {
      assert.deepEqual(forgeRunToPersist({ forge: RUN, saveForgeRun: v }), { ok: true, run: null });
    }
  });
  it("keeps forge when saveForgeRun is true and the run has work", () => {
    assert.deepEqual(forgeRunToPersist({ forge: RUN, saveForgeRun: true }), { ok: true, run: RUN });
  });
  it("ignores a run with no work in it", () => {
    assert.deepEqual(forgeRunToPersist({ forge: { pagesVisited: ["/intro"] }, saveForgeRun: true }), { ok: true, run: null });
  });
  it("refuses a run over the cap, and the cap fits a real run", () => {
    assert.ok(MAX_FORGE_RUN_BYTES >= 200_000);
    const big = { ...RUN, resumeText: "x".repeat(MAX_FORGE_RUN_BYTES + 1) };
    assert.deepEqual(forgeRunToPersist({ forge: big, saveForgeRun: true }), { ok: false, reason: "too_large" });
  });
  it("the route wires the decision in: only forgeRunToPersist's run reaches persistForgeSession", () => {
    const src = readFileSync(join(APP, "api", "auth", "register", "route.ts"), "utf8");
    assert.match(src, /forgeRunToPersist\(body\)/);
    const calls = src.match(/persistForgeSession\([^)]*\)/g) ?? [];
    assert.deepEqual(calls, ["persistForgeSession(newUserId, forgeRun.run)"]);
  });
});

describe("register route: size limits (no database reached)", () => {
  function post(body: unknown) {
    return POST(
      new Request("http://localhost/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
    );
  }
  it("refuses an oversize consented run before anything else", async () => {
    const big = { ...RUN, resumeText: "x".repeat(MAX_FORGE_RUN_BYTES + 1) };
    const res = await post({ forge: big, saveForgeRun: true });
    assert.equal(res.status, 413);
  });
  it("refuses a body over the limit even without a content-length header", async () => {
    const res = await post({ junk: "x".repeat(1_600_000) });
    assert.equal(res.status, 413);
  });
});

describe("create-account form: the save box", () => {
  it("starts unticked", () => {
    assert.equal(SAVE_FORGE_RUN_DEFAULT, false);
    const src = readFileSync(join(APP, "(auth)", "login", "page.tsx"), "utf8");
    assert.match(src, /useState\(SAVE_FORGE_RUN_DEFAULT\)/);
  });
  it("the body has no forge unless the box is ticked", () => {
    const run = readStoredForgeRun(JSON.stringify(RUN));
    const unticked = JSON.parse(JSON.stringify({ email: "b@x.org", ...forgeRegisterFields(run, SAVE_FORGE_RUN_DEFAULT) }));
    assert.equal("forge" in unticked, false);
    assert.equal("saveForgeRun" in unticked, false);
    const ticked = JSON.parse(JSON.stringify({ email: "b@x.org", ...forgeRegisterFields(run, true) }));
    assert.deepEqual(ticked.forge, RUN);
    assert.equal(ticked.saveForgeRun, true);
  });
  it("the form builds its body from forgeRegisterFields, never the raw run", () => {
    const src = readFileSync(join(APP, "(auth)", "login", "page.tsx"), "utf8");
    assert.match(src, /forgeRegisterFields\(/);
    assert.match(src, /\.\.\.forgeFields, turnstileToken/);
    assert.doesNotMatch(src, /phone: phone\.trim\(\), forge,/);
  });
  it("offers the box only for a run with work, and names it when it can", () => {
    assert.equal(readStoredForgeRun(null), null);
    assert.equal(readStoredForgeRun("not json"), null);
    assert.equal(readStoredForgeRun(JSON.stringify({ pagesVisited: [] })), null);
    assert.equal(forgeRunName(RUN), "Person A");
    assert.equal(forgeRunName({ ...RUN, resumeDoc: { contact: { name: " Person R " } } }), "Person R");
    assert.equal(forgeRunName({ resumeText: "x" }), "");
  });
});
