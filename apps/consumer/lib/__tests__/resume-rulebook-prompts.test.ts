/**
 * One rulebook, every writer.
 *
 * The Forge writer, Rush and the shared context library must carry the
 * rulebook's text at its current version, each rule once, and none of them
 * may still carry an old rule that contradicts it (a prompt can carry a rule
 * twice; the old copies are hunted by text here). Mini Forge must not share
 * these prompts at all.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { RESUME_RULES_VERSION, resumeRulesBlock, rulesFor } from "@crucible/core/src/resumeRules";
import { buildForgeResumePrompts } from "../forge-resume-prompt";
import { RUSH_SYSTEM_PROMPT } from "../rush-prompt";
import { buildFullContext } from "../context-library";

const APP = join(__dirname, "..", "..");
const read = (...p: string[]) => readFileSync(join(APP, ...p), "utf8");
const count = (hay: string, needle: string) => hay.split(needle).length - 1;

const INPUT = {
  narrative: { headline: "Maintenance helper", summary: "Boiler room rounds." },
  skills: [{ name: "Boiler water testing", category: "hard" }],
  resumeText: "Maintenance helper | Lakeside Apartments | 2018 - 2022\nTested boiler water and helped with blowdown under the operator.",
};

const OLD_RULES: Array<[string, RegExp]> = [
  ["outright ban on helped/assisted", /never[^\n]*"helped with"|never[^\n]*"assisted in"/i],
  ["three-column skills grid", /3 columns|three columns|columns separated by|Term 1 \| Term 2 \| Term 3/i],
  ["skills grid wording", /Core Competencies grid/i],
  ["upgrade verbs as doctrine", /"Led" not "was assigned to/],
  ["metrics-heavy push", /metrics-heavy|real metrics, achievement-dense/i],
  ["duties into achievements", /transform (?:every one|duties) into (?:CAR )?achievement/i],
];

describe("resume rulebook in every writer", () => {
  const { system, user } = buildForgeResumePrompts(INPUT);
  const forge = `${system}\n${user}`;

  it("the Forge writer carries every truth rule and every page rule exactly once, at the rulebook version", () => {
    assert.ok(system.includes(RESUME_RULES_VERSION));
    for (const r of [...rulesFor("truth"), ...rulesFor("page")]) {
      assert.equal(count(forge, r.text), 1, `${r.id} appears ${count(forge, r.text)} times`);
    }
    assert.ok(system.includes(resumeRulesBlock("truth")));
    assert.ok(system.includes(resumeRulesBlock("page")));
  });

  it("the Forge writer keeps shared and supervised work at its true scope", () => {
    assert.match(forge, /"helped with X under the operator" stays/);
    assert.match(user, /Helped with X under the lead/);
    assert.match(forge, /never make shared or supervised work sound like the person did it alone/i);
  });

  it("the Forge writer asks for one-column skills, never three columns", () => {
    assert.doesNotMatch(forge, /3 columns|columns separated by|Term 1 \| Term 2/i);
    assert.match(user, /CORE COMPETENCIES\nTerm, Term, Term/);
    assert.match(system, /one column/i);
  });

  it("the Forge writer keeps every other truth rule", () => {
    assert.match(forge, /Never invent a number/);
    assert.match(forge, /never a dateless functional page/);
    assert.match(forge, /NEVER mention incarceration/);
    const kept = buildForgeResumePrompts({ ...INPUT, keepInsideLines: true }).system;
    assert.match(kept, /THE PERSON CHOSE TO KEEP THEIR OWN LINES/);
    assert.doesNotMatch(kept, /NEVER mention incarceration/);
  });

  it("Rush carries the truth rules once, at the rulebook version, and no page rules", () => {
    assert.ok(RUSH_SYSTEM_PROMPT.includes(RESUME_RULES_VERSION));
    for (const r of rulesFor("truth")) assert.equal(count(RUSH_SYSTEM_PROMPT, r.text), 1, r.id);
    for (const r of rulesFor("page")) assert.equal(count(RUSH_SYSTEM_PROMPT, r.text), 0, r.id);
    assert.match(RUSH_SYSTEM_PROMPT, /keep it exactly as they framed it/);
    assert.match(RUSH_SYSTEM_PROMPT, /Output JSON only/);
  });

  it("the context library's resume block carries the truth rules once", () => {
    const ctx = buildFullContext("resume", { level: "professional" });
    for (const r of rulesFor("truth")) assert.equal(count(ctx, r.text), 1, r.id);
    assert.ok(ctx.includes(RESUME_RULES_VERSION));
  });

  it("no writer file or shared prompt piece still carries an old rule", () => {
    const files: Array<[string, string]> = [
      ["forge-resume-prompt.ts", read("lib", "forge-resume-prompt.ts")],
      ["rush-prompt.ts", read("lib", "rush-prompt.ts")],
      ["context-library.ts", read("lib", "context-library.ts")],
      ["generate-docs route", read("app", "api", "forge", "generate-docs", "route.ts")],
      ["rush-resume route", read("app", "api", "rush-resume", "route.ts")],
      ["built Forge prompt", forge],
      ["built Rush prompt", RUSH_SYSTEM_PROMPT],
      ["built resume context", buildFullContext("resume", { level: "executive" })],
    ];
    for (const [name, text] of files) {
      for (const [label, re] of OLD_RULES) assert.doesNotMatch(text, re, `${name}: ${label}`);
    }
  });

  it("the routes use the rulebook-built prompts", () => {
    assert.match(read("app", "api", "forge", "generate-docs", "route.ts"), /buildForgeResumePrompts\(input\)/);
    assert.match(read("app", "api", "rush-resume", "route.ts"), /const SYSTEM_PROMPT = RUSH_SYSTEM_PROMPT;/);
  });
});

describe("Mini Forge does not share the writer prompts", () => {
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((f) => {
      const p = join(dir, f);
      return statSync(p).isDirectory() ? walk(p) : /\.(ts|tsx)$/.test(f) ? [p] : [];
    });

  it("no tablet file imports the context library, the writer prompts or the rulebook", () => {
    const files = [...walk(join(APP, "app", "(mini-forge)")), join(APP, "lib", "mini-forge-ai.ts"), join(APP, "lib", "tablet-session.ts")];
    for (const f of files) {
      const text = readFileSync(f, "utf8");
      assert.doesNotMatch(text, /context-library|forge-resume-prompt|rush-prompt|resumeRules|generate-docs|rush-resume/, f);
    }
  });
});
