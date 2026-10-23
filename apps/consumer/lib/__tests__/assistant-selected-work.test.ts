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
  assert.equal(url.searchParams.get("applicationId"), job); assert.equal(url.searchParams.get("laneId"), laneB); assert.equal(url.searchParams.get("revisionId"), rev);
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
it("loads immutable selected application resume separately from current revision and canonical JD", async () => {
  const calls: string[] = [];
  const work = await resolveSelectedWork("owner", { applicationId: job }, store({
    application: async () => ({ id: job, job_title: "Driver", company: "Example", description: "Old listing", jd_full_text: "Full authoritative duties", jd_excerpt: "Short excerpt", jd_fetched_at: "2026-10-01", jd_truncated: true, resume_artifact_id: art }) as any,
    documents: async (uid, appId) => { calls.push(`${uid}:${appId}`); return [
      {id:"cover", document_type:"cover_letter", user_id:uid, application_id:appId, content_snapshot:{text:"Do not use this letter"}},
      {id:"snapshot",document_type:"resume", user_id:uid, application_id:appId, artifact_id:art,content_snapshot:{text:"Resume attached then"},provenance:"sent_as_is",content_hash:"hash",created_at:"2026-10-01"},
    ] as any; },
  }));
  assert.deepEqual(calls,[`owner:${job}`]);
  assert.equal(work.application?.jobDescription.text,"Full authoritative duties"); assert.equal(work.application?.jobDescription.truncated,true);
  assert.equal(work.applicationResumeSnapshot?.resumeText,"Resume attached then"); assert.equal(work.applicationResumeSnapshot?.immutable,true);
  assert.equal(work.revision?.resumeText,"Actual saved text");
});
it("never reads attachment snapshots for an unavailable application", async () => {
  let reads=0;
  await assert.rejects(resolveSelectedWork("owner",{applicationId:job},store({application:async()=>null,documents:async()=>{reads++;return[];}})));
  assert.equal(reads,0);
});

it("an application without an attachment never borrows the active lane resume", async () => {
  let reads = 0;
  const work = await resolveSelectedWork("owner", { applicationId: job }, store({
    application: async () => ({ id: job, job_title: "Driver", company: "Example", resume_artifact_id: null }) as any,
    laneResume: async () => { reads++; return { id: art, lane_id: laneA, artifact_type: "resume", is_demo: false, content: {} }; },
  }));
  assert.equal(reads, 0); assert.equal(work.revision, null); assert.equal(work.lane, null);
});

it("a moved employment resume does not replace a CV lane's visible record", async () => {
 const doc = { kind: "cv" as const, source: "current_visible_lane_document", text: "Selected CV", truncated: false, notice: "Current output" };
 const work = await resolveSelectedWork("owner", { laneId: laneB }, store({
  lane: async () => ({ id: laneB, kind: "cv", cv_type: "clinical", archived_at: null }) as any,
  laneResume: async () => ({ id: art, lane_id: laneB, artifact_type: "resume", is_demo: false, content: {} }),
  laneDocument: async () => doc,
 }));
 assert.equal(work.revision, null); assert.equal(work.laneDocument?.text, "Selected CV");
});
