/**
 * Phase 5 R4.1: the release check. A production build meant to require
 * accounts cannot ship with the Forge sign-in wall open, and an unreadable
 * switch value fails the build loudly instead of leaving something open.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import {
  formatReleaseCheck,
  readOnOff,
  readRequiresAccounts,
  releaseCheck,
} from "../release-check.mjs";
import { FORGE_SIGN_IN_STARTS_AT, forgeWallState, readWallSwitch } from "../forge-access";

const root = join(import.meta.dirname, "..", "..");

describe("release check: accounts required means the wall is on", () => {
  it("passes with nothing set (previews, production before ship day)", () => {
    const r = releaseCheck({});
    assert.equal(r.ok, true, r.errors.join("; "));
  });

  it("fails when accounts are required and the wall switch is unset", () => {
    const r = releaseCheck({ SMR_RELEASE_REQUIRES_ACCOUNTS: "1" });
    assert.equal(r.ok, false);
    assert.match(r.errors.join(" "), /NEXT_PUBLIC_FORGE_SIGN_IN_WALL is unset/);
  });

  it("fails when accounts are required and the wall switch is off", () => {
    const r = releaseCheck({ SMR_RELEASE_REQUIRES_ACCOUNTS: "1", NEXT_PUBLIC_FORGE_SIGN_IN_WALL: "off" });
    assert.equal(r.ok, false);
  });

  it("passes when accounts are required and the wall switch is on (any case, spaces around)", () => {
    for (const v of ["on", "ON", " on ", "On"]) {
      const r = releaseCheck({ SMR_RELEASE_REQUIRES_ACCOUNTS: "1", NEXT_PUBLIC_FORGE_SIGN_IN_WALL: v });
      assert.equal(r.ok, true, `${JSON.stringify(v)}: ${r.errors.join("; ")}`);
    }
  });

  it("the passing release really has the wall up at run time", () => {
    assert.equal(FORGE_SIGN_IN_STARTS_AT, null, "the date stays null in code; the switch raises the wall");
    assert.equal(forgeWallState({ override: "on", startsAt: FORGE_SIGN_IN_STARTS_AT }), "up");
  });

  it("an unreadable accounts flag fails, even with the wall on", () => {
    for (const v of ["true", "yes", "on", "2", "1 ", "01"]) {
      const r = releaseCheck({ SMR_RELEASE_REQUIRES_ACCOUNTS: v, NEXT_PUBLIC_FORGE_SIGN_IN_WALL: "on" });
      if (v.trim() === "1") {
        assert.equal(r.ok, true, `${JSON.stringify(v)} reads as 1`);
      } else {
        assert.equal(r.ok, false, `${JSON.stringify(v)} must fail`);
        assert.match(r.errors.join(" "), /is not 1 or 0/);
      }
    }
  });

  it("an unreadable accounts flag with the wall off fails twice over", () => {
    const r = releaseCheck({ SMR_RELEASE_REQUIRES_ACCOUNTS: "yes" });
    assert.equal(r.ok, false);
    assert.equal(r.errors.length, 2);
  });

  it("an unreadable wall switch fails the build even when accounts are not required", () => {
    for (const v of ["yes", "true", "1", "up", "o n"]) {
      const r = releaseCheck({ NEXT_PUBLIC_FORGE_SIGN_IN_WALL: v });
      assert.equal(r.ok, false, `${JSON.stringify(v)} must fail`);
      assert.match(r.errors.join(" "), /stay open/);
    }
  });

  it("accounts flag 0 is no requirement", () => {
    assert.equal(releaseCheck({ SMR_RELEASE_REQUIRES_ACCOUNTS: "0" }).ok, true);
  });
});

describe("release check: the other switches never fail silently", () => {
  it("an unreadable PREMIUM_GATE fails", () => {
    const r = releaseCheck({ PREMIUM_GATE: "true" });
    assert.equal(r.ok, false);
    assert.match(r.errors.join(" "), /PREMIUM_GATE/);
  });

  it("an unreadable RECORD_CHECK_ENABLED fails", () => {
    const r = releaseCheck({ RECORD_CHECK_ENABLED: "1" });
    assert.equal(r.ok, false);
    assert.match(r.errors.join(" "), /RECORD_CHECK_ENABLED/);
  });

  it("on and off read for both", () => {
    assert.equal(releaseCheck({ PREMIUM_GATE: "on", RECORD_CHECK_ENABLED: "off" }).ok, true);
    assert.equal(releaseCheck({ PREMIUM_GATE: "OFF", RECORD_CHECK_ENABLED: "On" }).ok, true);
  });

  it("the summary names every switch and the failure is easy to find", () => {
    const text = formatReleaseCheck(releaseCheck({ SMR_RELEASE_REQUIRES_ACCOUNTS: "1" }));
    assert.match(text, /^\[release-check\] FAILED/);
    for (const k of ["accounts required", "Forge sign-in wall", "premium gate", "record check"]) {
      assert.ok(text.includes(k), k);
    }
    assert.match(text, /ERROR:/);
  });
});

describe("release check: readers", () => {
  it("the wall reader agrees with the run-time reader (forge-access.ts)", () => {
    const inputs = ["", " ", "on", "ON", " on ", "off", "Off", "yes", "1", "true", "up", "o n"];
    for (const v of inputs) {
      assert.equal(readOnOff(v).value, readWallSwitch(v), `value for ${JSON.stringify(v)}`);
    }
    assert.equal(readOnOff(undefined).value, readWallSwitch(undefined));
  });

  it("blank is unset, never malformed", () => {
    assert.deepEqual(readOnOff("  "), { value: null, malformed: false });
    assert.deepEqual(readRequiresAccounts(""), { required: false, malformed: false });
  });
});

describe("release check: wired into the build", () => {
  it("next.config.mjs runs it in the production build phase and throws on failure", async () => {
    const mod = await import("../../next.config.mjs");
    const config = mod.default as (phase: string) => unknown;
    const saved = { ...process.env };
    const origError = console.error;
    const origLog = console.log;
    console.error = () => {};
    console.log = () => {};
    try {
      process.env.SMR_RELEASE_REQUIRES_ACCOUNTS = "1";
      delete process.env.NEXT_PUBLIC_FORGE_SIGN_IN_WALL;
      assert.throws(() => config("phase-production-build"), /Release check failed/);
      // next dev does not run it.
      assert.doesNotThrow(() => config("phase-development-server"));
      process.env.NEXT_PUBLIC_FORGE_SIGN_IN_WALL = "on";
      const out = config("phase-production-build") as { transpilePackages?: string[] };
      assert.ok(Array.isArray(out.transpilePackages), "returns the real config");
    } finally {
      console.error = origError;
      console.log = origLog;
      for (const k of ["SMR_RELEASE_REQUIRES_ACCOUNTS", "NEXT_PUBLIC_FORGE_SIGN_IN_WALL"]) {
        if (saved[k] === undefined) delete process.env[k];
        else process.env[k] = saved[k];
      }
    }
  });

  it("the CLI exits 1 on failure and 0 on pass", () => {
    const script = join(root, "scripts", "release-check.mjs");
    const base = { PATH: process.env.PATH ?? "", NODE_ENV: "test" } as NodeJS.ProcessEnv;
    const bad = spawnSync(process.execPath, [script], {
      env: { ...base, SMR_RELEASE_REQUIRES_ACCOUNTS: "1", NEXT_PUBLIC_FORGE_SIGN_IN_WALL: "off" },
      encoding: "utf8",
    });
    assert.equal(bad.status, 1);
    assert.match(bad.stderr, /FAILED/);
    const good = spawnSync(process.execPath, [script], {
      env: { ...base, SMR_RELEASE_REQUIRES_ACCOUNTS: "1", NEXT_PUBLIC_FORGE_SIGN_IN_WALL: "on" },
      encoding: "utf8",
    });
    assert.equal(good.status, 0, good.stderr);
  });

  it("package.json has release:check", () => {
    const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
    assert.equal(pkg.scripts["release:check"], "node scripts/release-check.mjs");
  });
});
