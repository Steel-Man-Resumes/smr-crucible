// Troy 2026-11-01 (production db4c4f9, ROOM-01..08): "Find local help in Kalamazoo, Michigan." asked which
// need instead of searching. A place with no need now searches housing, food and work.
import { it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { RESOURCE_AREAS } from "@crucible/core/src/resourceDirectoryShared";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");

it("a place with no need searches shelter, food and jobs; a missing place is still asked for", () => {
  const skill = read("../skills/staff-find-help/SKILL.md");
  assert.match(skill, /If the place is missing, ask for it in one short question/);
  assert.match(skill, /If they gave a place but no need[\s\S]{0,80}do not ask: search the three most common areas, "shelter", "food" and "jobs"/);
  const tools = read("../tools/assistant-staff-tools.ts");
  assert.match(tools, /A place with no need \(Troy 11\/01\): search needs 'shelter', 'food' and 'jobs'/);
  for (const a of ["shelter", "food", "jobs"]) assert.ok((RESOURCE_AREAS as readonly string[]).includes(a), a);
});
