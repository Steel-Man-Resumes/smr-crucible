// Production 2026-10-26: "Deletion did not finish" because refinery_artifact was
// deleted while job_application still pointed at a cover letter
// (job_application_cover_letter_artifact_id_fkey, no ON DELETE action).
// Every table that references refinery_artifact without a cascade must be
// emptied before the artifacts are.
import { it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

const route = readFileSync(new URL("../../app/api/user/delete-data/route.ts", import.meta.url), "utf8");
const migrationsDir = new URL("../../../../packages/core/migrations/", import.meta.url);

function deleteIndex(table: string): number {
  const i = route.search(new RegExp(`DELETE FROM ${table}\\b`));
  assert.ok(i >= 0, `the route deletes ${table}`);
  return i;
}

it("deletes job applications before the artifacts they point at", () => {
  assert.ok(deleteIndex("job_application") < deleteIndex("refinery_artifact"));
});

it("every non-cascading reference to refinery_artifact is cleared first", () => {
  const artifact = deleteIndex("refinery_artifact");
  const tables = new Set<string>();
  for (const file of readdirSync(migrationsDir).filter((f) => f.endsWith(".sql"))) {
    const sql = readFileSync(new URL(file, migrationsDir), "utf8");
    // Statements that add a reference to refinery_artifact without ON DELETE.
    for (const stmt of sql.split(";")) {
      if (!/REFERENCES\s+refinery_artifact/i.test(stmt)) continue;
      const refs = stmt.split(/\n/).filter((l) => /REFERENCES\s+refinery_artifact/i.test(l) && !/ON DELETE/i.test(l));
      if (!refs.length) continue;
      const m = stmt.match(/(?:CREATE TABLE(?: IF NOT EXISTS)?|ALTER TABLE(?: IF EXISTS)?)\s+(?:public\.)?(\w+)/i);
      if (m && m[1].toLowerCase() !== "refinery_artifact") tables.add(m[1].toLowerCase());
    }
  }
  assert.ok(tables.has("job_application"), "the scan finds the known reference");
  for (const t of tables) assert.ok(deleteIndex(t) < artifact, `${t} is deleted before refinery_artifact`);
});
