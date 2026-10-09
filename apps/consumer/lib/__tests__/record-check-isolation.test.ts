/**
 * No reuse (D11): what a person types into the record check, and any record
 * check they save, can reach no prompt but the record check's own.
 *
 * Static proof over the source tree: the only files that name the saved table,
 * the core functions that read it, the record check modules or the consent
 * layer are the ones listed here. Every other prompt builder (the Forge and
 * resume writer, t.ROY chat and the coach, interview practice, the tailor,
 * the disclosure planner, the user context t.ROY reads) is checked by name.
 * Plus: callAI's Claude-only option really has no OpenAI fallback.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, relative } from "node:path";

const REPO = join(import.meta.dirname, "..", "..", "..", "..");
const ROOTS = ["apps/consumer/app", "apps/consumer/lib", "apps/consumer/components", "packages/core/src", "packages/consumer-ui/src"];
const TOUCH = /record-check\/|record_check_saved|RecordCheck|recordCheck|["']record_check["']/;

function* walk(p: string): Generator<string> {
  if (!existsSync(p)) return;
  const st = statSync(p);
  if (st.isFile()) {
    if (/\.(ts|tsx|mts|js|mjs)$/.test(p) && !/\.d\.ts$/.test(p)) yield p;
    return;
  }
  for (const name of readdirSync(p)) {
    if (["node_modules", "__tests__", ".next", "dist"].includes(name)) continue;
    yield* walk(join(p, name));
  }
}

// Each allowed file and why it may touch the record check.
const ALLOWED: Record<string, string> = {
  "apps/consumer/lib/record-check/handler.ts": "the step itself",
  "apps/consumer/lib/record-check/deps.ts": "the step's database, consent and AI wiring",
  "apps/consumer/lib/record-check/prompt.ts": "the step's own prompt",
  "apps/consumer/app/api/record-check/route.ts": "the step's own route",
  "apps/consumer/app/api/record-check/consent/route.ts": "the step's own yes",
  "apps/consumer/app/api/record-check/saved/route.ts": "the step's saved list",
  "apps/consumer/app/(dashboard)/dashboard/record-check/page.tsx": "the step's screen",
  "apps/consumer/app/api/user/export-data/route.ts": "data rights: export to the owner",
  "apps/consumer/app/api/user/delete-data/route.ts": "data rights: delete my data",
  "apps/consumer/app/(dashboard)/dashboard/settings/page.tsx": "the export checkbox label",
  "packages/core/src/recordCheck.ts": "the only reader and writer of the table",
  "packages/core/src/index.ts": "re-export",
  "packages/core/src/consent.ts": "the consent layer name",
  "packages/core/src/rlsHealth.ts": "the protected-table list",
};

const touching = (() => {
  const out: string[] = [];
  for (const root of ROOTS) {
    for (const f of walk(join(REPO, root))) {
      if (TOUCH.test(readFileSync(f, "utf8"))) out.push(relative(REPO, f));
    }
  }
  return out.sort();
})();

test("no reuse: only the listed files touch the record check", () => {
  const unexpected = touching.filter((f) => !(f in ALLOWED));
  assert.deepEqual(unexpected, [], `new file touches the record check: ${unexpected.join(", ")}`);
  // The scan is real: it finds the step's own files.
  assert.ok(touching.includes("apps/consumer/lib/record-check/handler.ts"));
  assert.ok(touching.includes("packages/core/src/recordCheck.ts"));
});

// The prompt builders and context loaders that must never see it, by name.
const PROMPT_BUILDERS = [
  "apps/consumer/lib/forge-resume-prompt.ts",
  "apps/consumer/lib/rush-prompt.ts",
  "apps/consumer/lib/assistant-prompt.ts",
  "apps/consumer/lib/ai/troy-chat.ts",
  "apps/consumer/lib/context-library.ts",
  "apps/consumer/lib/research-context.ts",
  "apps/consumer/lib/intake-engine.ts",
  "apps/consumer/lib/mini-forge-ai.ts",
  "apps/consumer/lib/grounding-verify.ts",
  "apps/consumer/lib/interview-jd.ts",
  "apps/consumer/lib/use-user-context.ts",
  "packages/core/src/coachPrompt.ts",
  "packages/core/src/coachMemory.ts",
  "packages/core/src/getUserProfile.ts",
  "packages/core/src/secondCheck.ts",
  "apps/consumer/app/api/assistant/route.ts",
  "apps/consumer/app/api/coach/route.ts",
  "apps/consumer/app/api/interview-practice/route.ts",
  "apps/consumer/app/api/resume-generate/route.ts",
  "apps/consumer/app/api/resume-generate-full/route.ts",
  "apps/consumer/app/api/resume-fine-tune/route.ts",
  "apps/consumer/app/api/rush-resume/route.ts",
  "apps/consumer/app/api/disclosure-guide/route.ts",
  "apps/consumer/app/api/analyze/route.ts",
  "apps/consumer/app/api/user/context/route.ts",
];

test("no reuse: the writer, t.ROY chat, coach, interview, tailor and planner cannot read it", () => {
  let found = 0;
  for (const f of PROMPT_BUILDERS) {
    const p = join(REPO, f);
    if (!existsSync(p)) continue;
    found++;
    assert.ok(!touching.includes(f), `${f} touches the record check`);
  }
  // The tailor's routes, wherever they live.
  for (const f of touching) assert.ok(!/tailor|interview|assistant|coach|resume-|rush|forge\//.test(f), f);
  assert.ok(found >= 20, `checked ${found} prompt builders (paths moved?)`);
});

test("no reuse: the shell sends t.ROY only the page name on this screen", () => {
  const page = readFileSync(join(REPO, "apps/consumer/app/(dashboard)/dashboard/record-check/page.tsx"), "utf8");
  assert.ok(!/AssistantChat|highlight-bus|use-assistant|useUserContext|forge-context/.test(page));
});

test("no reuse: only core's recordCheck.ts names the table in SQL", () => {
  const sqlFiles = touching.filter((f) => /record_check_saved/.test(readFileSync(join(REPO, f), "utf8")));
  assert.deepEqual(sqlFiles.sort(), ["packages/core/src/recordCheck.ts", "packages/core/src/rlsHealth.ts"]);
});

// ------------------------------------------------------- Claude only, really --

test("callAI anthropicOnly: no OpenAI fallback, no provider text in the console", async () => {
  const { callAI } = await import("../ai-call");
  const saved = { a: process.env.ANTHROPIC_API_KEY, o: process.env.OPENAI_API_KEY, f: globalThis.fetch, e: console.error };
  const calls: string[] = [];
  const printed: string[] = [];
  globalThis.fetch = (async (url: string) => {
    calls.push(String(url));
    return new Response("echo: zorbin fraud", { status: 500 });
  }) as typeof fetch;
  console.error = (...a: unknown[]) => { printed.push(a.join(" ")); };
  try {
    // Only an OpenAI key: refused, nothing sent anywhere.
    delete process.env.ANTHROPIC_API_KEY;
    process.env.OPENAI_API_KEY = "test-not-a-key";
    await assert.rejects(callAI("s", [{ role: "user", content: "zorbin fraud" }], 10, "m", { endpoint: "record-check", anthropicOnly: true }));
    assert.deepEqual(calls, []);
    // Both keys, Anthropic fails: still no OpenAI call.
    process.env.ANTHROPIC_API_KEY = "test-not-a-key";
    await assert.rejects(callAI("s", [{ role: "user", content: "zorbin fraud" }], 10, "m", { endpoint: "record-check", anthropicOnly: true }));
    assert.equal(calls.length, 1);
    assert.match(calls[0], /api\.anthropic\.com/);
    assert.ok(!printed.join("\n").includes("zorbin"));
    // Without the flag the old fallback still happens (proves the test bites).
    calls.length = 0;
    await assert.rejects(callAI("s", [{ role: "user", content: "x" }], 10, "m", { endpoint: "other" }));
    assert.ok(calls.some((u) => /openai\.com/.test(u)));
  } finally {
    if (saved.a === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = saved.a;
    if (saved.o === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = saved.o;
    globalThis.fetch = saved.f;
    console.error = saved.e;
  }
});
