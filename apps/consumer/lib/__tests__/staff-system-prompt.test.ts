import { it } from "node:test";
import assert from "node:assert/strict";
import { buildSystemPrompt } from "../assistant-prompt";

// 2026-10-30: staff get their own prompt, never the job-seeker coach's.
const org = { orgName: "Test org (Demo)", role: "staff" as const, reach: "assigned" as const, caseload: 2, stalled: 1, neverStarted: 0, hired: 0, unassigned: 0 };
const staff = (page: string) => buildSystemPrompt({ currentPage: page, audience: "org_staff", org } as never);

it("a staff prompt carries none of the participant coach frame", () => {
  for (const page of ["today", "dashboard", "clients/3f2a1b4c-1111-4222-8333-944455556666", "people", "settings"]) {
    const p = staff(page);
    assert.doesNotMatch(p, /AI career coach/, page);
    assert.doesNotMatch(p, /BEHAVIORAL RULES/, page);
    assert.doesNotMatch(p, /PAGE: FORGE|You're in The Forge|PSYCHIC AWARENESS|DEPTH ON DEMAND/i, page);
    assert.doesNotMatch(p, /Never exceed 75 words/, page);
    assert.match(p, /AUDIENCE: ORGANIZATION STAFF/, page);
    assert.match(p, /TRUTH RULES/, page);
    assert.match(p, /You never send anything\./, page);
  }
});

it("a participant id in the page path never reaches the prompt", () => {
  const p = staff("clients/3f2a1b4c-1111-4222-8333-944455556666");
  assert.doesNotMatch(p, /3f2a1b4c/);
  assert.match(p, /clients\/\(one person\)/);
});

it("a participant still gets the coach", () => {
  const p = buildSystemPrompt({ currentPage: "resume" } as never);
  assert.match(p, /AI career coach/);
  assert.match(p, /BEHAVIORAL RULES/);
});
