import { test } from "node:test";
import assert from "node:assert/strict";
import { workspaceNextAction } from "../workspace-next-action";
import { workspaceContextUrl, type RefineryWorkspaceContext } from "../refinery-workspace";

const LANE = "00000000-0000-4000-8000-0000000000a1";
const APPLICATION = "00000000-0000-4000-8000-0000000000a2";
const ARTIFACT = "00000000-0000-4000-8000-0000000000a3";
const work = (change: Partial<RefineryWorkspaceContext> = {}): RefineryWorkspaceContext => ({
  lane: { id: LANE, name: "Sample trade", target: "Electrical apprentice", kind: "resume" },
  application: null,
  revision: { id: "00000000-0000-4000-8000-0000000000a4", artifactId: ARTIFACT, number: 2, status: "draft", fromWriter: true },
  selection: { laneId: LANE, artifactId: ARTIFACT },
  task: "resume",
  ...change,
});

test("a selected interviewing application keeps its identity despite a different saved lane task", () => {
  const action = workspaceNextAction({ work: work({ task: "resume", application: { id: APPLICATION, job_title: "Sample role", company: "Example Company", status: "interviewing" } }), profileFirst: true });
  assert.equal(action?.href, `/dashboard/interview?applicationId=${APPLICATION}`);
  const preparing = workspaceNextAction({ work: work({ task: "interview", application: { id: APPLICATION, job_title: "Sample role", company: "Example Company", status: "saved" } }) });
  assert.equal(preparing?.href, `/dashboard/application-tailor?job=${APPLICATION}`);
});

test("urgent practice and support stay useful before a profile; normal preparation points to profile", () => {
  for (const task of ["interview", "support"]) {
    const action = workspaceNextAction({ work: work({ task }), profileFirst: true });
    assert.equal(action?.href, task === "interview" ? "/dashboard/interview" : "/dashboard/resources#support");
  }
  for (const task of ["resume", "job", "documents", "explore"]) {
    assert.equal(workspaceNextAction({ work: work({ task }), profileFirst: true })?.href, "/dashboard#profile-setup");
  }
});

test("current resume lineage decides review, check or next hiring task without replacing the document", () => {
  const current = work();
  const finishedWriter = work({ revision: { ...current.revision!, status: "finished" } });
  assert.equal(workspaceNextAction({ work: finishedWriter })?.href, "/dashboard/jobs");
  const unknownWriter = work({ revision: { ...finishedWriter.revision!, fromWriter: undefined } });
  assert.equal(workspaceNextAction({ work: unknownWriter })?.href, `/dashboard/application-tailor?id=${ARTIFACT}`);
  const draftAction = workspaceNextAction({ work: current });
  const url = new URL(draftAction!.href, "https://example.com");
  assert.equal(url.pathname, "/output");
  assert.equal(url.searchParams.get("check"), ARTIFACT);
  assert.equal(url.searchParams.get("cards"), "1");
});

test("document tasks open the actual CV, performer or creative lane", () => {
  for (const kind of ["cv", "performer", "creative"]) {
    for (const task of ["documents", "resume"]) {
      const action = workspaceNextAction({ work: work({ task, lane: { id: LANE, name: "Sample documents", target: null, kind }, revision: null }) });
      assert.equal(action?.href, `/dashboard/${kind}?lane=${LANE}`);
    }
  }
  assert.equal(workspaceNextAction({ work: work({ task: "documents" }) })?.href, "/dashboard/vault");
});

test("global journey is reserved for no chosen task; unavailable work is not a new resume", () => {
  assert.equal(workspaceNextAction({ work: work({ task: null }) }), null);
  assert.equal(workspaceNextAction({ work: null, task: "resume" }), null);
  assert.equal(workspaceNextAction({ work: work({ task: "resume", revision: null }) })?.href, "/resume");
  assert.equal(workspaceNextAction({ work: work({ task: "explore" }) })?.href, "/dashboard/paths");
});

test("selected application and document links derive their lane instead of inheriting a stale focus", () => {
  for (const query of [`job=${APPLICATION}`, `id=${ARTIFACT}`, `revisionId=${ARTIFACT}`]) {
    const url = new URL(workspaceContextUrl("/dashboard/application-tailor", new URLSearchParams(query), LANE), "https://example.com");
    assert.equal(url.searchParams.has("laneId"), false);
  }
  const cv = new URL(workspaceContextUrl("/dashboard/cv", new URLSearchParams(`lane=${LANE}`), null), "https://example.com");
  assert.equal(cv.searchParams.get("laneId"), LANE);
});

test("a reported interview remains the next action after returning to Overview", () => {
 const priorityApplication = { id: APPLICATION, job_title: "Technician", company: "Example Company" };
 assert.equal(workspaceNextAction({ work: work({ priorityApplication }) })?.href, `/dashboard/interview?applicationId=${APPLICATION}`);
 assert.equal(workspaceNextAction({ work: work({ priorityApplication, task: "support" }) })?.href, "/dashboard/resources#support");
});
