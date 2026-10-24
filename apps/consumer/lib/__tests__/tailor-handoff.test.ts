/**
 * Arriving at the Application Tailor with a job picked must never spend an AI
 * action (walk 2026-10-24, bug 1: /dashboard/application-tailor?job=<id> ran the
 * tailor on page load). Fictional jobs only.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { boardHandoff, jobHandoffFromApplications, loadJobHandoff, singleTailorCost } from "../tailor-handoff";

const APP = "00000000-0000-4000-8000-0000000000a1";
const RES = "00000000-0000-4000-8000-0000000000b1";
const app = (over: Record<string, unknown> = {}) => ({
  id: APP, job_title: "Picker", company: "Acme Tools", status: "saved", resume_artifact_id: null,
  apply_url: "https://example.test/apply", employer_website: null, jd_full_text: "Pick orders.", source_id: "board-1", ...over,
});

test("?job= for an untailored saved job picks it and waits for a click", () => {
  const h = jobHandoffFromApplications(APP, [app()]);
  assert.equal(h.kind, "confirm");
  if (h.kind !== "confirm") return;
  assert.equal(h.pending.applicationId, APP);
  assert.equal(h.pending.job.title, "Picker");
  assert.equal(h.pending.job.company, "Acme Tools");
  assert.equal(h.pending.job.description, "Pick orders.");
  assert.deepEqual(h.applyInfo, { applyUrl: "https://example.test/apply", employerWebsite: null, applied: false });
});

test("?job= for an already tailored job opens that resume (no spend)", () => {
  const h = jobHandoffFromApplications(APP, [app({ resume_artifact_id: RES, status: "applied" })]);
  assert.deepEqual(h.kind === "open" && [h.artifactId, h.applicationId, h.applyInfo.applied], [RES, APP, true]);
});

test("?job= for a job that is not this person's does nothing", () => {
  assert.equal(jobHandoffFromApplications(APP, [app({ id: "00000000-0000-4000-8000-0000000000ff" })]).kind, "none");
  assert.equal(jobHandoffFromApplications(null, [app()]).kind, "none");
  assert.equal(jobHandoffFromApplications(APP, null).kind, "none");
});

test("loading a ?job= arrival reads the applications list and never calls the generator", async () => {
  const calls: string[] = [];
  const fetcher = async (url: string) => {
    calls.push(url);
    return new Response(JSON.stringify({ applications: [app()] }), { status: 200 });
  };
  const h = await loadJobHandoff(APP, fetcher);
  assert.equal(h.kind, "confirm");
  assert.deepEqual(calls, ["/api/applications"]);
  assert.ok(!calls.some((u) => /resume-generate|tailor-batch|career/.test(u)), "a page load must not reach the generator");
});

test("the Job Board hand-off picks the job; bad text picks nothing", () => {
  const p = boardHandoff(JSON.stringify({ title: "Loader", company: "Acme Tools", description: "Load trucks." }));
  assert.deepEqual(p && [p.from, p.applicationId, p.job.title], ["board", null, "Loader"]);
  assert.equal(boardHandoff("{not json"), null);
  assert.equal(boardHandoff(JSON.stringify({ company: "No title" })), null);
  assert.equal(boardHandoff(null), null);
});

test("the cost line says what one tailor costs, and blocks when nothing is left", () => {
  assert.deepEqual(singleTailorCost({ remaining: 33, blockedReason: null }), {
    line: "Tailoring this job uses 1 AI action from your allowance. You have 33 left today. It makes a resume and a cover letter for this job.",
    canRun: true,
  });
  assert.equal(singleTailorCost({ remaining: 0, blockedReason: null }).canRun, false);
  assert.match(singleTailorCost({ remaining: 0, blockedReason: null }).line, /no AI actions left today/);
  assert.deepEqual(singleTailorCost({ remaining: 5, blockedReason: "This tool is not open on your account yet." }), { line: "This tool is not open on your account yet.", canRun: false });
  assert.match(singleTailorCost({ remaining: null, blockedReason: null }).line, /^Tailoring this job uses 1 AI action\./);
  assert.match(singleTailorCost(undefined).line, /uses 1 AI action from your allowance/);
  assert.equal(singleTailorCost(undefined).canRun, true);
});

// ---- The workspace itself: no effect may start the generator. ----
const WS = readFileSync(join(__dirname, "..", "..", "components", "resume", "ResumeWorkspace.tsx"), "utf8");
const code = WS.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

/** Each `useEffect(` call's full argument text, by balanced parentheses. */
function effectBodies(src: string): string[] {
  const out: string[] = [];
  let i = 0;
  while ((i = src.indexOf("useEffect(", i)) !== -1) {
    let depth = 0, j = i + "useEffect".length;
    for (; j < src.length; j++) {
      if (src[j] === "(") depth++;
      else if (src[j] === ")" && --depth === 0) break;
    }
    out.push(src.slice(i, j + 1));
    i = j;
  }
  return out;
}

test("no useEffect in the workspace calls the generator (a page load never spends)", () => {
  const bodies = effectBodies(code);
  assert.ok(bodies.length > 10, "found the workspace effects");
  for (const b of bodies) {
    assert.doesNotMatch(b, /runCareerPackage\(/, `an effect starts the tailor: ${b.slice(0, 120)}`);
    assert.doesNotMatch(b, /resume-generate-full/, `an effect reaches the generator: ${b.slice(0, 120)}`);
    assert.doesNotMatch(b, /tailorPendingNow\(|tailorForJob\(/, `an effect presses the button: ${b.slice(0, 120)}`);
  }
  // The ?job= and ?from=job effects still exist, and only pick the job.
  assert.ok(bodies.some((b) => /searchParams\.get\("job"\)/.test(b) && /setPendingTailor\(handoff\.pending\)/.test(b)));
  assert.ok(bodies.some((b) => /resume_target_job/.test(b) && /setPendingTailor\(pending\)/.test(b)));
});

test("the generator runs only from the two buttons", () => {
  const calls = [...code.matchAll(/runCareerPackage\(/g)].length;
  assert.equal(calls, 2, "tailorForJob and tailorPendingNow are the only callers");
  assert.match(code, /function tailorPendingNow\(\) \{[\s\S]*?runCareerPackage\(pending\.job/);
  assert.match(code, /function tailorForJob\(\) \{[\s\S]*?runCareerPackage\(/);
  // Each is wired to a click and nothing else.
  assert.deepEqual([...code.matchAll(/tailorPendingNow\b/g)].length, 2, "declared once, used once");
  assert.match(code, /onClick=\{tailorPendingNow\}/);
  assert.match(code, /onClick=\{tailorForJob\}/);
});

test("the picked job shows the cost line and a Tailor now button", () => {
  assert.match(code, /data-testid="tailor-pending-cost"[^>]*>\{cost\.line\}/);
  assert.match(code, /data-testid="tailor-pending-run"[\s\S]{0,200}?onClick=\{tailorPendingNow\}[\s\S]{0,200}?disabled=\{!cost\.canRun/);
  assert.match(code, />\s*Tailor now\s*</);
});
