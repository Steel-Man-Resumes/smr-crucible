import { test } from "node:test";
import assert from "node:assert/strict";
import { buildForgeResumePrompts } from "../forge-resume-prompt";

test("the writer is given the person's own credentials answer, labelled as credentials", () => {
  const { user } = buildForgeResumePrompts({ skills: [{ name: "Grill", category: "kitchen" }], credentialsNote: "forklift card, expired" });
  assert.match(user, /CREDENTIALS IN THE PERSON'S OWN WORDS[^\n]*forklift card, expired/);
  const none = buildForgeResumePrompts({ skills: [{ name: "Grill", category: "kitchen" }] });
  assert.doesNotMatch(none.user, /CREDENTIALS IN THE PERSON'S OWN WORDS/);
});
