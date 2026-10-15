import { test } from "node:test";
import assert from "node:assert/strict";
import { sourceConfidence, confidenceLines, scopeYesResult, buildFinishView } from "../finish-gate";
import { runMintCheck } from "@crucible/core/src/resumeMintCheckShared";

test("confidence: approved AI wording and skipped numbers lower it; confirmed titles and typed answers do not", () => {
  const none = sourceConfidence([{ line: "a", answer: "Shift lead", kind: "title_yes" }, { line: "b", answer: "my crew", kind: "scope_yes", family: "manage" }] as never);
  assert.equal(none.level, "high");
  assert.deepEqual(confidenceLines(none), []);
  const two = sourceConfidence([
    { line: "- Ran the line.", answer: "Ran the production line.", verdict: "stands", kind: "assisted" },
    { line: "- Ran the line.", answer: "Ran the production line.", verdict: "stands", kind: "assisted" },
  ] as never, ["Loaded trucks."]);
  assert.equal(two.level, "medium");
  assert.equal(two.notes.length, 2, "one note per line, duplicates folded");
  assert.match(confidenceLines(two)[0], /Source confidence: Medium/);
  const low = sourceConfidence([1, 2, 3].map((i) => ({ line: `l${i}`, answer: `x${i}`, verdict: "stands", kind: "assisted" })) as never);
  assert.equal(low.level, "low");
});

test("a year in the person's story is not a number the page owes back", () => {
  const src = "I started in 1862 at the yard. Loaded 40 trucks a day.";
  const out = "NAME\nWORK\nYard hand | The Yard | 2001 - 2003\nLoaded 40 trucks a day.";
  const dropped = runMintCheck({ output: out, source: src, kind: "resume" }).findings.filter((f) => f.kind === "dropped_number");
  assert.deepEqual(dropped, []);
  const src2 = "Loaded 40 trucks a day with a crew of 16.";
  const out2 = "NAME\nWORK\nYard hand | The Yard | 2001 - 2003\nLoaded 40 trucks a day.";
  assert.equal(runMintCheck({ output: out2, source: src2, kind: "resume" }).findings.filter((f) => f.kind === "dropped_number").length, 1, "a real work number is still owed");
});

test("a typed who-or-what answer settles the claim; a denial is sent to Take it off", () => {
  const source = "I ran the floor at Northline. In charge of production every day.";
  const resume = "SAM EXAMPLE\nWORK HISTORY\nPRODUCTION LEAD | Northline | Kalispell, MT | 2020 - 2024\n- Managed day-to-day production operations.";
  const v = buildFinishView({ resumeText: resume, ownWords: source, defendAnswers: [], written: { resume, letter: "" }, grounding: null });
  const g = v.groups.find((x) => x.scope);
  assert.ok(g, "the managed line asks who or what");
  const doc = { target: "resume" as const, text: resume };
  assert.equal(scopeYesResult(doc, g!.line, g!.scope!.families, "Everyone in the crew.", source, []), "ok");
  assert.equal(scopeYesResult(doc, g!.line, g!.scope!.families, "no, never", source, []), "denies");
  assert.equal(scopeYesResult(doc, g!.line, g!.scope!.families, "", source, []), "empty");
});
