// Demo fix T2 (2026-10-28): Valjean asked his t.ROY "What should I find out
// about this job before I apply?" about Lupe's Cascade Engineering handoff and
// got six long numbered paragraphs with no day-to-day duties. The answer is
// now a short list of five checks, and never a wage or shift not in a listing.
import { it } from "node:test";
import assert from "node:assert/strict";
import { buildCaseManagerSection, BEFORE_YOU_APPLY, type CaseManagerContext } from "../staff-handoff-context";
import { readMyStaffSuggestions } from "../tools/assistant-tools";

const cascade: CaseManagerContext = {
  openCount: 1,
  handoffs: [{ id: "h1", from: "Lupe", org: "Southside Bridge (Demo)", sentOn: "2026-10-28", note: "Take a look at this one.", items: [
    { id: "i1", kind: "employer", title: "Cascade Engineering", why: "They hire people with records.", status: "open", dueOn: null, listed: true },
  ] }] as never,
  jobs: [],
};

it("the five checks, in order, with no invented wage or shift", () => {
  for (const [i, word] of ["Pay", "Duties", "Location", "Getting there", "Hours and shift"].entries()) {
    assert.ok(BEFORE_YOU_APPLY.includes(`${i + 1}. ${word}:`), word);
  }
  assert.match(BEFORE_YOU_APPLY, /what they would do day to day/);
  assert.match(BEFORE_YOU_APPLY, /Never state or guess a wage, a shift, a schedule or a duty that is not written there/);
  assert.match(BEFORE_YOU_APPLY, /short numbered list/);
  assert.ok(!/—|--/.test(BEFORE_YOU_APPLY), "no dashes");
});

it("Valjean's t.ROY carries it whenever a handoff is open, and the tool says it too", async () => {
  const lines = buildCaseManagerSection({ fromCaseManager: cascade } as never);
  assert.ok(lines.includes(BEFORE_YOU_APPLY));
  assert.deepEqual(buildCaseManagerSection({ fromCaseManager: { openCount: 0, handoffs: [], jobs: [] } } as never), []);
  const read = await readMyStaffSuggestions("u1", { load: async () => cascade, recordConsent: async () => false });
  assert.equal((read as { beforeYouApply?: string }).beforeYouApply, BEFORE_YOU_APPLY);
});
