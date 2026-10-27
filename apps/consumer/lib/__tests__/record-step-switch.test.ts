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
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

// SecurityContent uses the classic JSX runtime.
(globalThis as { React?: unknown }).React = React;

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

describe("review L4: withdrawal always works, even while the step is off", () => {
  for (const [file, handler] of [
    ["app/api/record-check/consent/route.ts", "handleConsentDelete"],
    ["app/api/record-check/saved/route.ts", "handleSavedDelete"],
  ] as const) {
    it(`${file} DELETE is outside the switch and goes straight to ${handler}`, () => {
      const src = code(read(file));
      const start = src.indexOf("export async function DELETE(request: Request) {");
      assert.ok(start >= 0);
      const body = src.slice(start, src.indexOf("\n}", start));
      assert.doesNotMatch(body, /recordStepOn/);
      assert.match(body, new RegExp(`return ${handler}\\(request, realRecordCheckDeps\\(\\)\\);`));
    });
  }

  it("the handlers keep the owner, same-origin and staff checks (write gate)", () => {
    const h = code(read("lib/record-check/handler.ts"));
    for (const fn of ["handleConsentDelete", "handleSavedDelete"]) {
      const at = h.indexOf(`export async function ${fn}(`);
      const body = h.slice(at, h.indexOf("\n}", at));
      assert.match(body, /gate\(req, deps, \{ needConsent: false, write: true, tier: false \}\)/, fn);
    }
  });

  it("with the switch off, a staff session and a cross-site form are still refused on DELETE", async () => {
    // Proven end to end in record-check.test.ts (staff 403, text/plain 403,
    // sibling-site 403 on both DELETEs); this checks the switch is not consulted.
    const saved = process.env.RECORD_CHECK_ENABLED;
    try {
      delete process.env.RECORD_CHECK_ENABLED;
      assert.equal(recordStepOn(), false);
      const t = read("lib/__tests__/record-check.test.ts");
      assert.match(t, /handleConsentDelete\(req\("\/api\/record-check\/consent", "DELETE"\), staff\.deps\)\)\.status, 403/);
      assert.match(t, /handleSavedDelete\(req\("\/api\/record-check\/saved\?id=00000000-0000-4000-8000-000000000001", "DELETE", "\{\}", h\), w\.deps\)\)\.status, 403/);
    } finally {
      if (saved !== undefined) process.env.RECORD_CHECK_ENABLED = saved;
    }
  });
});

describe("every route of the step answers 404 while off, first thing", () => {
  const ROUTES: Array<[string, string[]]> = [
    ["app/api/record-check/route.ts", ["POST"]],
    ["app/api/record-check/consent/route.ts", ["GET", "POST"]],
    ["app/api/record-check/saved/route.ts", ["GET", "POST"]],
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

describe("review M1: the security page and Settings describe the step only while on", () => {
  it("SecurityContent renders no record check copy while off, and all of it while on", async () => {
    const { SecurityContent } = await import("../../components/SecurityContent");
    const off = renderToStaticMarkup(React.createElement(SecurityContent, {})).toLowerCase();
    const offExplicit = renderToStaticMarkup(React.createElement(SecurityContent, { recordStep: false })).toLowerCase();
    const on = renderToStaticMarkup(React.createElement(SecurityContent, { recordStep: true })).toLowerCase();
    for (const html of [off, offExplicit]) {
      assert.ok(!html.includes("record check"), "no record check mention while off");
      assert.ok(!html.includes("2 years"), "no retention exception while off");
      assert.ok(html.includes("if you type your record in the chat or the disclosure planner"), "the plain line stays");
    }
    assert.ok(on.includes("the record check is the only screen"));
    assert.ok(on.includes("saved record checks"));
    assert.ok(on.includes("up to 2 years for flagged content"));
  });

  it("both security pages pass the server switch, read per request", () => {
    for (const f of ["app/(forge)/security/page.tsx", "app/(dashboard)/dashboard/security/page.tsx"]) {
      const src = code(read(f));
      assert.match(src, /recordStep=\{recordStepOn\(\)\}/, f);
      assert.match(src, /export const dynamic = "force-dynamic";/, f);
      assert.doesNotMatch(src, /"use client"/, f);
    }
  });

  it("Settings shows its record check line only while on", () => {
    const page = code(read("app/(dashboard)/dashboard/settings/page.tsx"));
    const at = page.indexOf("In the record check, what you type");
    assert.ok(at > 0);
    const before = page.slice(Math.max(0, at - 400), at);
    assert.match(before, /\{recordStep && !isOrgStaff && \(\s*<li/, "staff never see the record check line (staff pass S2)");
    assert.match(page, /const \{ recordStep \} = useServerSwitches\(\);/);
    assert.match(code(read("app/(dashboard)/dashboard/settings/layout.tsx")), /recordStep: recordStepOn\(\)/);
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

  it("a browser-sent page name cannot pull the step's page block while off (review I1)", () => {
    assert.ok(!buildSystemPrompt({ currentPage: "record-check" }).includes("PAGE: RECORD CHECK"));
    assert.ok(buildSystemPrompt({ currentPage: "record-check", recordStepOn: true }).includes("PAGE: RECORD CHECK"));
  });

  it("the assistant route sets the flag on the server, ignoring the browser", () => {
    const src = code(read("app/api/assistant/route.ts"));
    assert.match(src, /context\.recordStepOn = recordStepOn\(\);/);
    assert.ok(src.indexOf("context.recordStepOn = recordStepOn();") < src.indexOf("buildSystemPrompt(context)"));
  });

  it("the coaching doctrine points there only when the page says it is available", () => {
    const skill = read("lib/skills/strong-background-professional/SKILL.md");
    assert.match(skill, /Use a dedicated record-check flow only when current capabilities say it is available and the person chooses it/);
  });
});

describe("release", () => {
  it("the ship-day note says when to turn it on", () => {
    const doc = readFileSync(join(CONSUMER, "..", "..", "docs", "SHIP-DAY-GATES.md"), "utf8");
    assert.match(doc, /RECORD_CHECK_ENABLED/);
  });
});
