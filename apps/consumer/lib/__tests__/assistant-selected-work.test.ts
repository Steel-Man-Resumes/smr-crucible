import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readWorkSelection, resolveSelectedWork, type WorkContextStore } from "../assistant-work-context";
import { applyExactCorrection } from "../assistant-correction";
import { selectSkills } from "../skills-loader";
import manifest from "../skills/manifest.json";
import { resolveAssistantPage } from "../tools/assistant-tool-defs";
const laneA = "11111111-1111-1111-1111-111111111111", laneB = "22222222-2222-2222-2222-222222222222", job = "33333333-3333-3333-3333-333333333333", art = "44444444-4444-4444-4444-444444444444", rev = "55555555-5555-5555-5555-555555555555";
function store(overrides: Partial<WorkContextStore> = {}): WorkContextStore {
  const revision = { id: rev, artifact_id: art, revision_number: 2, status: "draft", resume_text: "Actual saved text", open_items: ["Review"], created_at: "2026-10-15" };
  return {
    focus: async () => ({ task: "apply", laneId: laneA, target: "Driver" }),
    lane: async (_user, id) => ({ id, name: "Selected lane", target_role: "Driver", kind: "resume", archived_at: null }) as any,
    application: async () => ({ id: job, job_title: "Driver", company: "Example", description: "Posting duties", resume_artifact_id: art }) as any,
    artifact: async () => ({ id: art, lane_id: laneB, artifact_type: "resume", is_demo: false, content: {} }),
    revision: async () => revision as any, latest: async () => revision as any, ...overrides,
  };
}
describe("server selected work", () => {
  it("ignores browser authority fields and rejects malformed selectors", () => {
    assert.deepEqual(readWorkSelection({ laneId: laneA, role: "owner", status: "finished" }), { laneId: laneA });
    assert.throws(() => readWorkSelection({ applicationId: "bad" }));
  });
  it("uses selected application's actual artifact lane, not account focus", async () => {
    const work = await resolveSelectedWork("owner", { applicationId: job }, store());
    assert.equal(work.lane?.id, laneB); assert.equal(work.task, null);
    assert.equal(work.revision?.resumeText, "Actual saved text"); assert.equal(work.application?.id, job);
  });
  it("refuses cross-lane resume and job combinations", async () => {
    await assert.rejects(resolveSelectedWork("owner", { applicationId: job, laneId: laneA }, store()), /selection_mismatch/);
  });
  it("does not fall back when foreign selected application is missing", async () => {
    await assert.rejects(resolveSelectedWork("owner", { applicationId: job }, store({ application: async () => null })), /unavailable/);
  });
  it("distinguishes read failure from no saved work", async () => {
    await assert.rejects(resolveSelectedWork("owner", { applicationId: job }, store({ application: async () => { throw new Error("db down"); } })), /db down/);
  });
  it("rejects revision mismatch and archived lanes", async () => {
    await assert.rejects(resolveSelectedWork("owner", { revisionId: rev, artifactId: laneA }, store()), /selection_mismatch/);
    await assert.rejects(resolveSelectedWork("owner", { laneId: laneA }, store({ lane: async () => null })), /unavailable/);
  });
  it("reads with authenticated owner, not a browser userId", async () => {
    const seen: string[] = [];
    await assert.rejects(resolveSelectedWork("real-owner", { applicationId: job, userId: "attacker" }, store({ application: async (user) => { seen.push(user); return null; } })));
    assert.deepEqual(seen, ["real-owner"]);
  });
});
it("correction requires one exact passage and preserves literal replacement", () => {
  assert.equal(applyExactCorrection("abc abc", "abc", "def"), null);
  assert.equal(applyExactCorrection("abc", "absent", "def"), null);
  assert.equal(applyExactCorrection("abc", "abc", ""), null);
  assert.equal(applyExactCorrection("abc", "abc", "$&"), "$&");
  assert.equal(applyExactCorrection("abc", "abc", "abc"), null);
});
it("staff role excludes participant disclosure/narrative packs", () => {
  const ids = selectSkills(manifest.skills, "interview", true, "staff").map((s) => s.id);
  assert(ids.includes("staff-operations")); assert(!ids.includes("disclosure-coaching")); assert(!ids.includes("career-narrative"));
});
it("support and creative packs load by relevant page", () => {
  assert(selectSkills(manifest.skills, "resources", false).some((s) => s.id === "support-navigation"));
  assert(!selectSkills(manifest.skills, "dashboard", false).some((s) => s.id === "support-navigation"));
  assert(selectSkills(manifest.skills, "performer", false).some((s) => s.id === "creative-records"));
});
it("handoff preserves selected job/lane/revision", () => {
  const url = new URL(resolveAssistantPage("interview", job, { laneId: laneB, artifactId: art, revisionId: rev })!, "https://example.test");
  assert.equal(url.searchParams.get("job"), job); assert.equal(url.searchParams.get("laneId"), laneB); assert.equal(url.searchParams.get("revisionId"), rev);
});

import { executionBudget } from "../tools/tool-execution";
it("duplicate concurrent tool calls execute once and budget blocks extra operations", async () => {
  const run = executionBudget(1); let writes = 0;
  const action = async () => { writes++; return { saved: true }; };
  const results = await Promise.all([run("save", { a: 1, b: 2 }, action), run("save", { b: 2, a: 1 }, action)]);
  assert.equal(writes, 1); assert.deepEqual(results[0], results[1]);
  assert.equal((await run("save", { a: 2 }, action) as any).status, "blocked"); assert.equal(writes, 1);
});
import { assistantStepUsage } from "../ai/assistant-step-usage";
it("accounts cached Anthropic input separately from uncached SDK prompt tokens", () => {
  assert.deepEqual(assistantStepUsage({ promptTokens: 10, completionTokens: 5 }, { anthropic: { cacheCreationInputTokens: 20, cacheReadInputTokens: 30 } }), { inputTokens: 10, outputTokens: 5, cacheCreationInputTokens: 20, cacheReadInputTokens: 30 });
});
import { FORGE_PAGES, REFINERY_PAGES } from "../tools/assistant-tool-defs";
import { readdirSync } from "node:fs";
import path from "node:path";
it("every assistant navigation capability maps to a real shipped page", () => {
  const root = path.join(process.cwd(), "app");
  const routes = new Set<string>();
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name === "page.tsx") routes.add("/" + path.relative(root, dir).split(path.sep).filter((s) => !s.startsWith("(")).join("/"));
    }
  };
  walk(root);
  for (const href of Object.values({ ...FORGE_PAGES, ...REFINERY_PAGES })) assert(routes.has(href), `Missing route ${href}`);
});
