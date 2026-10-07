/**
 * The writer never asks for a dateless functional resume.
 *
 * The standard (STD-F01) makes an undated functional page a BLOCK. The Forge
 * writer's prompt is built from two blocks in its route plus the shared user
 * level directive, and an old "functional format" rule lived in more than one
 * of them. This test reads every piece the writer sends and fails if any of
 * them still invites a functional page instead of a dated one.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildFullContext } from "../context-library";

const ROUTE = readFileSync(join(__dirname, "..", "..", "app", "api", "forge", "generate-docs", "route.ts"), "utf8");

// Every mention of "functional" must be the negative rule.
function functionalMentions(text: string): string[] {
  return text.split("\n").filter((l) => /functional/i.test(l));
}

describe("no functional resume instruction", () => {
  it("the shared foundation directive asks for a dated page", () => {
    const ctx = buildFullContext("resume", { level: "foundation" });
    assert.doesNotMatch(ctx, /functional format acceptable/i);
    for (const l of functionalMentions(ctx)) assert.match(l, /never a dateless functional page/i, l);
    assert.match(ctx, /each with the years the person gave/i);
  });

  it("the Forge writer route only mentions a functional page to forbid it", () => {
    assert.doesNotMatch(ROUTE, /build a functional resume/i);
    assert.doesNotMatch(ROUTE, /skill-area sections/i);
    const mentions = functionalMentions(ROUTE);
    assert.ok(mentions.length >= 2, "the no-history rule should appear in both prompt blocks");
    for (const l of mentions) assert.match(l, /never a dateless functional (page|one)/i, l);
  });

  it("the no-history rule appears in both prompt blocks and forbids guessing a year", () => {
    const rules = ROUTE.split("\n").filter((l) => /no work history/i.test(l));
    assert.ok(rules.length >= 2, rules.join("\n"));
    for (const l of rules) assert.match(l, /never guess a year/i, l);
  });
});
