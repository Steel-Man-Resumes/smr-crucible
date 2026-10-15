import { test } from "node:test";
import assert from "node:assert/strict";
import { verifyStory, storyIsChecked, readStoryDraft } from "../story-verification";
const source = "I stocked shelves. I want to work in shipping.";
const draft = { narrative: { headline: "Stock clerk", summary: "You stocked shelves.", reflection: "You want shipping work.", strengths: [{ title: "Stocking", evidence: "You stocked shelves." }] }, skills: [{ name: "Stocking", category: "hard" }], career_paths: [{ title: "Shipping manager", match_reason: "Your stocking experience is relevant." }] };
const clean = async ({ output }: { output: string }) => ({ text: output, hasFabrication: false, applied: false, flags: [], verifierRan: true });
test("every story fact includes headline, strength title/evidence, skill and path rationale", async () => {
 const checked = await verifyStory(draft, source, clean);
 assert.ok(storyIsChecked(checked));
 assert.deepEqual(Object.keys(checked.story_verification.fields), ["narrative.headline", "narrative.summary", "narrative.reflection", "narrative.strengths.0.title", "narrative.strengths.0.evidence", "skills.0.name", "career_paths.0.match_reason"]);
});
for (const failure of ["timeout", "missing-key", "malformed"]) test(`${failure} preserves draft and never becomes checked`, async () => {
 const checked = await verifyStory(draft, source, async args => {
  if (args.output === draft.narrative.headline) {
   if (failure === "timeout") throw new Error("timeout");
   return { text: args.output, hasFabrication: false, applied: false, flags: [], verifierRan: false };
  }
  return clean(args);
 });
 assert.equal(storyIsChecked(checked), false);
 assert.equal(checked.narrative.headline, draft.narrative.headline);
 assert.equal(checked.story_verification.fields["narrative.headline"], false);
 const recovered = await verifyStory(checked, source, clean);
 assert.ok(storyIsChecked(recovered));
 assert.deepEqual(recovered.narrative, draft.narrative);
});
test("unsupported scope without an applied repair cannot be exported as checked", async () => {
 const checked = await verifyStory({ headline: "You managed the whole warehouse." }, source, async ({ output }) => ({ text: output, hasFabrication: true, applied: false, verifierRan: true, flags: [{ claim: output, why: "scope" }] }));
 assert.equal(storyIsChecked(checked), false);
});
test("saved story draft carries no claimed verification or private reflection into an email", () => {
 const stored = readStoryDraft({ ...draft, story_verification: { checked: true } });
 assert.ok(stored);
 assert.equal("story_verification" in stored, false);
 assert.equal("reflection" in stored, false);
});

test("short credential labels and barrier personal claims are verified", async () => {
 const seen: string[] = [];
 const checked = await verifyStory({ skills: [{ name: "Licensed CDL" }], barriers: [{ title: "Housing", user_narrative: "You have stable housing." }] }, source, async args => { seen.push(args.output); return clean(args); });
 assert.deepEqual(seen, ["Licensed CDL", "You have stable housing."]);
 assert.ok(storyIsChecked(checked));
});
