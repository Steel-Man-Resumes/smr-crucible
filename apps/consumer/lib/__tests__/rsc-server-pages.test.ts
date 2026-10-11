/**
 * Phase 5 review r2, N1: every server page and layout this lane added or
 * converted renders under React Server Components the way Next renders it on
 * a request (test/rsc/render-server-page.cts). Dynamic routes are not rendered
 * by `next build`, so without this a function handed to an element (onClick)
 * only fails on the first real request. The fixture proves the check bites.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

const CONSUMER = join(import.meta.dirname, "..", "..");
const HARNESS = "test/rsc/render-server-page.cts";

function renderRsc(file: string, env: Record<string, string> = {}) {
  const base = { ...process.env } as NodeJS.ProcessEnv;
  delete base.RECORD_CHECK_ENABLED;
  const r = spawnSync(process.execPath, ["--conditions=react-server", "-r", "tsx/cjs", HARNESS, file], {
    cwd: CONSUMER,
    env: { ...base, ...env },
    encoding: "utf8",
    timeout: 120_000,
  });
  const out = `${r.stdout}\n${r.stderr}`;
  return { status: r.status, out, last: (r.stdout.trim().split("\n").pop() ?? "").trim() };
}

describe("server pages render as React Server Components", () => {
  it("the check refuses a server page that hands a function to an element", () => {
    const r = renderRsc("test/rsc/fixtures/handler-page.tsx");
    assert.equal(r.status, 1, r.out);
    assert.match(r.out, /Event handlers cannot be passed to Client Component props/);
  });

  for (const page of ["app/(dashboard)/dashboard/security/page.tsx", "app/(forge)/security/page.tsx"]) {
    for (const sw of ["off", "on"]) {
      it(`${page} (record check ${sw})`, () => {
        const r = renderRsc(page, sw === "on" ? { RECORD_CHECK_ENABLED: "on" } : {});
        assert.equal(r.last, "RSC_OK", r.out);
      });
    }
  }

  for (const layout of [
    "app/(dashboard)/dashboard/disclosure/layout.tsx",
    "app/(dashboard)/dashboard/settings/layout.tsx",
    "app/(forge)/partner/layout.tsx",
  ]) {
    it(layout, () => {
      assert.equal(renderRsc(layout).last, "RSC_OK");
      assert.equal(renderRsc(layout, { RECORD_CHECK_ENABLED: "on" }).last, "RSC_OK");
    });
  }

  it("the record check layout: a 404 while off, the page while on", () => {
    const f = "app/(dashboard)/dashboard/record-check/layout.tsx";
    assert.equal(renderRsc(f).last, "RSC_NOT_FOUND");
    assert.equal(renderRsc(f, { RECORD_CHECK_ENABLED: "on" }).last, "RSC_OK");
  });
});
