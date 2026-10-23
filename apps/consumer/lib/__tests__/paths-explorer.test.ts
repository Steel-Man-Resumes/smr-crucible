import { test } from "node:test";
import assert from "node:assert/strict";
import { EMPTY_PATH_INPUTS, explorePaths, pathJobsHref, readPathInputs, type PathContext } from "../paths/explore";
import { PATH_INTERESTS, PATH_OCCUPATIONS } from "../paths/occupations";
import { choosePathDirection } from "../paths/choose";

const context: PathContext = { savedSkills: [], target: null, laneId: null, location: "Example City, CO", savedConstraints: [] };

test("real skill labels and selected professional goal explain ranking without inventing qualifications", () => {
  const result = explorePaths({ ...context, savedSkills: ["Production management", "Scheduling"], target: "Production manager", laneId: "lane-a" }, EMPTY_PATH_INPUTS);
  assert.equal(result.candidates.length, 4);
  assert.equal(result.candidates[0].id, "production-management");
  assert.deepEqual(result.candidates[0].matches.map((m) => m.label), ["Production management", "Scheduling"]);
  assert.equal(result.candidates[0].matches[0].origin, "saved_profile");
  assert.equal(result.localOpeningsChecked, false);
  assert.ok(result.candidates[0].unknowns.some((line) => line.includes("not been checked")));
  assert.equal(result.context.laneId, "lane-a");
});

test("interests, urgency and training yield explainable comparisons with unknown entry facts", () => {
  const inputs = { ...EMPTY_PATH_INPUTS, urgency: "now" as const, training: "on_job" as const, interests: ["food" as const], schedule: "Weekdays", transport: "Bus" };
  const result = explorePaths(context, inputs);
  assert.equal(result.candidates[0].id, "cooking");
  assert.ok(result.candidates[0].interests.includes("food"));
  assert.ok(result.candidates[0].unknowns.some((line) => line.includes("Weekdays")));
  assert.ok(result.candidates[0].unknowns.some((line) => line.includes("Bus")));
  const longRoute = explorePaths(context, { ...inputs, interests: ["creative"] }).candidates.find((c) => c.id === "graphic-design");
  assert.ok(longRoute?.unknowns.some((line) => line.includes("existing experience")));
});

test("unknown history stays unproven; skipped categories are respected without filler paths", () => {
  const initial = explorePaths(context, EMPTY_PATH_INPUTS);
  assert.ok(initial.candidates.every((candidate) => candidate.matches.length === 0 && candidate.explanation.includes("do not yet have personal evidence")));
  assert.ok(initial.missing.includes("A work skill or responsibility"));
  assert.equal(explorePaths(context, { ...EMPTY_PATH_INPUTS, avoid: Object.keys(PATH_INTERESTS) as Array<keyof typeof PATH_INTERESTS> }).candidates.length, 0);
});

test("added skills retain their origin and one lane's goal cannot influence another context", () => {
  const inputs = { ...EMPTY_PATH_INPUTS, additionalSkills: ["Graphic design", "Layout"] };
  const result = explorePaths(context, inputs);
  assert.equal(result.candidates[0].id, "graphic-design");
  assert.ok(result.candidates[0].matches.every((match) => match.origin === "this_visit"));
  assert.ok(result.candidates.every((candidate) => !candidate.targetMatch));
  assert.equal(context.target, null);
});

test("path links carry the exact chosen role, location and selected lane without inventing a distance", () => {
  const url = new URL(pathJobsHref("Cook & prep", "Example City, CO", "lane-b"), "https://example.test");
  assert.equal(url.pathname, "/dashboard/jobs");
  assert.equal(url.searchParams.get("q"), "Cook & prep");
  assert.equal(url.searchParams.get("location"), "Example City, CO");
  assert.equal(url.searchParams.get("laneId"), "lane-b");
  assert.equal(url.searchParams.has("radius"), false);
});

test("input parsing bounds payloads, ignores unknown interests and never accepts client-supplied saved facts", () => {
  assert.equal(readPathInputs(null), null);
  assert.equal(readPathInputs([]), null);
  const parsed = readPathInputs({ interests: ["technology", "made-up", "technology"], additionalSkills: Array.from({ length: 40 }, (_, i) => `skill ${i}`), urgency: "guaranteed job", savedSkills: ["Invented license"] });
  assert.deepEqual(parsed?.interests, ["technology"]);
  assert.equal(parsed?.additionalSkills.length, 20);
  assert.equal(parsed?.urgency, "unknown");
  assert.equal("savedSkills" in parsed!, false);
});

test("every occupation exposes a dated primary source without local pay or opening claims", () => {
  assert.ok(PATH_OCCUPATIONS.length >= 10);
  assert.equal(new Set(PATH_OCCUPATIONS.map((c) => c.id)).size, PATH_OCCUPATIONS.length);
  for (const occupation of PATH_OCCUPATIONS) {
    assert.equal(new URL(occupation.source.url).hostname, "www.bls.gov");
    assert.equal(occupation.source.reviewedAt, "2026-10-22");
    assert.equal(occupation.source.scope, "US occupation overview");
    assert.ok(occupation.tasks && occupation.entry && occupation.check);
  }
});

const reply = (data: unknown, ok = true) => ({ ok, async json() { return data; } });
test("confirmed direction reuses an exact existing employment lane and verifies focus", async () => {
  const calls: string[] = [];
  const result = await choosePathDirection("Cook", "main", () => "main", async (url, init) => {
    calls.push(`${init?.method || "GET"} ${url}`);
    return url === "/api/lanes" ? reply({ lanes: [{ id: "saved-cook", target_role: "Cook", kind: "resume" }] }) : reply({ focus: { laneId: "saved-cook" } });
  });
  assert.deepEqual(calls, ["GET /api/lanes", "POST /api/lane-focus"]);
  assert.equal(result.laneId, "saved-cook");
});

test("a failed focus write is not selection, and retry reuses the already created lane", async () => {
  let saved = false; let creates = 0; let attempts = 0;
  const fetcher = async (url: string, init?: RequestInit) => {
    const lane = { id: "new-cook", target_role: "Cook", kind: "resume" };
    if (url === "/api/lanes" && !init?.method) return reply({ lanes: saved ? [lane] : [] });
    if (url === "/api/lanes") { saved = true; creates++; return reply({ lane }); }
    attempts++; return attempts === 1 ? reply({ error: "unavailable" }, false) : reply({ focus: { laneId: lane.id } });
  };
  await assert.rejects(choosePathDirection("Cook", "main", () => "main", fetcher), /saved, but it could not be selected/);
  assert.equal((await choosePathDirection("Cook", "main", () => "main", fetcher)).laneId, "new-cook");
  assert.equal(creates, 1);
});

test("a lane switch during the read cancels writes; a creative lane is not silently reused as employment", async () => {
  let writes = 0;
  await assert.rejects(choosePathDirection("Cook", "lane-a", () => "lane-b", async (_url, init) => {
    if (init?.method) writes++;
    return reply({ lanes: [] });
  }), /active lane changed/);
  assert.equal(writes, 0);
  const result = await choosePathDirection("Cook", "main", () => "main", async (url, init) => {
    if (url === "/api/lanes" && !init?.method) return reply({ lanes: [{ id: "artist", target_role: "Cook", kind: "creative" }] });
    if (url === "/api/lanes") { writes++; return reply({ lane: { id: "employment", target_role: "Cook" } }); }
    return reply({ focus: { laneId: "employment" } });
  });
  assert.equal(result.laneId, "employment");
  assert.equal(writes, 1);
});
