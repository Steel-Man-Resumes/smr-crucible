/**
 * Phase 5 R4.4 (Codex review A10): the record check stays off until its
 * public copy ships. RECORD_CHECK_ENABLED, a run-time server switch, off by
 * default. While off: every route of the step answers 404 before sign-in or
 * limits run, its screen is a 404, the entry card is hidden, the partner FAQ
 * and t.ROY do not describe or link to it.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { RECORD_CHECK_ENABLED_ENV, recordStepOn, serverSwitchOn, switchedOffResponse } from "../server-switch";
import { buildSystemPrompt } from "../assistant-prompt";

const CONSUMER = join(import.meta.dirname, "..", "..");
const read = (p: string) => readFileSync(join(CONSUMER, p), "utf8");
const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("the switch", () => {
  it("is off by default and on only for 'on'", () => {
    assert.equal(RECORD_CHECK_ENABLED_ENV, "RECORD_CHECK_ENABLED");
    assert.equal(recordStepOn({}), false);
    for (const v of ["", "off", "true", "1", "yes", "enabled"]) assert.equal(recordStepOn({ RECORD_CHECK_ENABLED: v }), false, v);
    for (const v of ["on", "ON", " on "]) assert.equal(recordStepOn({ RECORD_CHECK_ENABLED: v }), true, v);
    assert.equal(serverSwitchOn(undefined), false);
  });

  it("reads the environment per call (no rebuild needed)", () => {
    const saved = process.env.RECORD_CHECK_ENABLED;
    try {
      delete process.env.RECORD_CHECK_ENABLED;
      assert.equal(recordStepOn(), false);
      process.env.RECORD_CHECK_ENABLED = "on";
      assert.equal(recordStepOn(), true);
    } finally {
      if (saved === undefined) delete process.env.RECORD_CHECK_ENABLED;
      else process.env.RECORD_CHECK_ENABLED = saved;
    }
  });

  it("the switched-off answer is a plain 404, not cached", async () => {
    const r = switchedOffResponse();
    assert.equal(r.status, 404);
    assert.equal(r.headers.get("Cache-Control"), "no-store");
    assert.deepEqual(await r.json(), { error: "Not found" });
  });
});

describe("every route of the step answers 404 while off, first thing", () => {
  const ROUTES: Array<[string, string[]]> = [
    ["app/api/record-check/route.ts", ["POST"]],
    ["app/api/record-check/consent/route.ts", ["GET", "POST", "DELETE"]],
    ["app/api/record-check/saved/route.ts", ["GET", "POST", "DELETE"]],
  ];
  for (const [file, methods] of ROUTES) {
    for (const m of methods) {
      it(`${file} ${m}`, () => {
        const src = code(read(file));
        const start = src.indexOf(`export async function ${m}(request: Request) {`);
        assert.ok(start >= 0, `${m} is a function that can check the switch`);
        const body = src.slice(start, src.indexOf("\n}", start));
        const lines = body.split("\n").map((l) => l.trim()).filter(Boolean);
        assert.equal(lines[1], "if (!recordStepOn()) return switchedOffResponse();", "the switch is the first statement");
      });
    }
    it(`${file}: no handler is exported around the switch`, () => {
      assert.doesNotMatch(code(read(file)), /export const (GET|POST|DELETE|PUT|PATCH)\s*=/);
    });
  }

  it("the build route checks the switch before sign-in and limits (withRateLimit runs after)", () => {
    const src = code(read("app/api/record-check/route.ts"));
    const post = src.slice(src.indexOf("export async function POST"));
    assert.ok(post.indexOf("recordStepOn()") < post.indexOf("limited(request)"));
  });
});

describe("the screen and the entry points", () => {
  it("the record check screen is a 404 while off (a server layout, read per request)", () => {
    const src = code(read("app/(dashboard)/dashboard/record-check/layout.tsx"));
    assert.match(src, /if \(!recordStepOn\(\)\) notFound\(\);/);
    assert.match(src, /export const dynamic = "force-dynamic";/);
  });

  it("the disclosure planner's entry card shows only while on", () => {
    const page = code(read("app/(dashboard)/dashboard/disclosure/page.tsx"));
    assert.match(page, /\{isRecord && recordStep && \(\s*<div[^>]*data-testid="record-check-entry"/);
    const layout = code(read("app/(dashboard)/dashboard/disclosure/layout.tsx"));
    assert.match(layout, /value=\{\{ recordStep: recordStepOn\(\) \}\}/);
    assert.match(layout, /export const dynamic = "force-dynamic";/);
  });

  it("without the server's word, a client page sees the step as off", () => {
    const ctx = code(read("components/ServerSwitches.tsx"));
    assert.match(ctx, /const OFF: ServerSwitches = \{ recordStep: false \};/);
    assert.match(ctx, /createContext<ServerSwitches>\(OFF\)/);
  });

  it("the partner FAQ describes the step only while on", () => {
    const page = code(read("app/(forge)/partner/page.tsx"));
    assert.equal((page.match(/The record check is the only screen/g) ?? []).length, 1, "only in RECORD_LINES.on");
    assert.match(page, /recordStep \? item\.recordLines\.on : item\.recordLines\.off/);
    assert.match(code(read("app/(forge)/partner/layout.tsx")), /recordStep: recordStepOn\(\)/);
  });
});

describe("t.ROY", () => {
  it("does not point to the step while off, and does when on", () => {
    const off = buildSystemPrompt({ currentPage: "disclosure" });
    assert.ok(!off.includes("/dashboard/record-check"), "no link while off");
    assert.match(off, /licensing board or the employer directly/);
    const on = buildSystemPrompt({ currentPage: "disclosure", recordStepOn: true });
    assert.ok(on.includes("/dashboard/record-check"));
  });

  it("does not describe the step in the privacy answer while off", () => {
    const off = buildSystemPrompt({ currentPage: "story" });
    assert.ok(!off.includes("The record check in the Refinery"));
    const on = buildSystemPrompt({ currentPage: "story", recordStepOn: true });
    assert.ok(on.includes("The record check in the Refinery"));
  });

  it("the assistant route sets the flag on the server, ignoring the browser", () => {
    const src = code(read("app/api/assistant/route.ts"));
    assert.match(src, /context\.recordStepOn = recordStepOn\(\);/);
    assert.ok(src.indexOf("context.recordStepOn = recordStepOn();") < src.indexOf("buildSystemPrompt(context)"));
  });

  it("the coaching doctrine points there only when the page says it is available", () => {
    const skill = read("lib/skills/strong-background-professional/SKILL.md");
    assert.match(skill, /Only when the page instructions say the Refinery's record check is available/);
  });
});

describe("release", () => {
  it("the ship-day note says when to turn it on", () => {
    const doc = readFileSync(join(CONSUMER, "..", "..", "docs", "SHIP-DAY-GATES.md"), "utf8");
    assert.match(doc, /RECORD_CHECK_ENABLED/);
  });
});
