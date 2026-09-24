#!/usr/bin/env node
/**
 * Check the app role's EFFECTIVE privileges on the directory objects straight
 * after migrations run, and BEFORE rls-stage1 repairs anything.
 *
 * WHY THIS ORDER. rls-stage1 blanket-grants and then re-applies the restricted
 * list, so a migration that forgot its own REVOKE/GRANT block would still end
 * green in the directory suite: the repair hides the defect (Codex review of
 * 061, finding 10). In CI the branch is a copy of production, so smr_app and
 * production's default privileges already exist when 061 runs. This is the
 * production-shaped check. The fresh-database path (role created later) is
 * checked again after repair by verify-directory.mjs.
 *
 * Read-only. Needs ISOLATION_TEST_DATABASE_URL, never DATABASE_URL.
 */
import { neon } from "@neondatabase/serverless";
import { readFileSync } from "node:fs";
import { APP_ROLE, checkEffectiveDirectoryGrants } from "./lib/restricted-grants.mjs";

const PROD_ENDPOINT = "ep-little-cloud-aphpkqbd";
function readVar(file, name) {
  if (process.env[name]) return process.env[name];
  try {
    const line = readFileSync(file, "utf8").split("\n").find((l) => l.trim().startsWith(name + "="));
    if (line) return line.slice(line.indexOf("=") + 1).trim().replace(/^["']|["']$/g, "");
  } catch { /* none */ }
  return undefined;
}
const url = readVar(".env.isolation", "ISOLATION_TEST_DATABASE_URL");
if (!url) { console.error("\nNo ISOLATION_TEST_DATABASE_URL.\n"); process.exit(2); }
if (new URL(url).hostname.includes(PROD_ENDPOINT)) { console.error("\nREFUSING: production endpoint.\n"); process.exit(2); }

const sql = neon(url);
const run = (q) => sql(q);
const [role] = await sql`SELECT 1 FROM pg_roles WHERE rolname = ${APP_ROLE}`;
console.log("\nDirectory grants, before any repair\n");
if (!role) {
  console.log(`  SKIP  ${APP_ROLE} does not exist yet (fresh database); verify-directory.mjs checks after role setup\n`);
  process.exit(0);
}
const problems = await checkEffectiveDirectoryGrants(run);
for (const p of problems) console.log("  FAIL  " + p);
console.log(problems.length ? `\nFAILED  ${problems.length}\n` : "  PASS  effective privileges match RESTRICTED_GRANTS on every directory object\n");
process.exit(problems.length ? 1 : 0);
