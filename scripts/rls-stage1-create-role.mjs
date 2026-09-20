#!/usr/bin/env node
/**
 * RLS Stage 1: create an application role that CANNOT bypass row-level security.
 *
 * WHY THIS IS SQL AND NOT THE NEON CONSOLE. A role created through the Neon
 * console or API is handed BYPASSRLS. Build the whole system on one of those
 * and every policy is inert while looking perfectly correct. The role must be
 * created with CREATE ROLE by neondb_owner, and this script asserts
 * rolbypassrls = false afterwards rather than trusting that it worked.
 *
 * It also grants nothing by default and everything explicitly: the app touches
 * 61 tables across three separate connections (the core client, the Auth.js
 * Pool, and an edge client), so a missing grant does not degrade -- it stops
 * logins. Default privileges are set too, or any table added later is invisible
 * to the app until someone remembers.
 *
 * SAFE TO RE-RUN. Creating the role is guarded; grants are idempotent.
 *
 * REFUSES TO RUN AGAINST PRODUCTION. Stages 1 to 3 happen on a throwaway
 * branch. Production is stage 4, and stage 4 is one environment variable.
 */
import { neon } from "@neondatabase/serverless";
import { readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { applyRestrictedGrants, checkRestrictedGrants } from "./lib/restricted-grants.mjs";

const PROD_ENDPOINT = "ep-little-cloud-aphpkqbd";
const APP_ROLE = "smr_app";
const OUT_FILE = ".env.smr-app";

function readVar(file, name) {
  try {
    const line = readFileSync(file, "utf8").split("\n").find((l) => l.trim().startsWith(name + "="));
    return line ? line.slice(line.indexOf("=") + 1).trim().replace(/^["']|["']$/g, "") : null;
  } catch {
    return null;
  }
}

const conn =
  process.env.ISOLATION_TEST_DATABASE_URL || readVar(".env.isolation", "ISOLATION_TEST_DATABASE_URL");
if (!conn) {
  console.error("\nNo branch connection string. Put it in .env.isolation first.\n");
  process.exit(2);
}

const parsed = new URL(conn);
if (parsed.hostname.includes(PROD_ENDPOINT)) {
  console.error(
    `\nREFUSING: that is the PRODUCTION endpoint (${PROD_ENDPOINT}).\n` +
      `Stages 1-3 run on a branch. Production is stage 4.\n`
  );
  process.exit(2);
}

const sql = neon(conn);
console.log(`\nRLS Stage 1 -- create ${APP_ROLE}\n  host: ${parsed.hostname}\n`);

// A password we generate, so nobody types or pastes one. Written to a
// gitignored file for stage 2 and never printed.
const password = randomBytes(24).toString("base64url");

// CREATE ROLE cannot be parameterized, and the password is generated from
// crypto rather than any input, so there is nothing user-controlled here.
// Doubled single quotes guard the literal regardless.
const safePw = password.replace(/'/g, "''");

await sql(`DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${APP_ROLE}') THEN
    CREATE ROLE ${APP_ROLE} WITH LOGIN PASSWORD '${safePw}';
  ELSE
    ALTER ROLE ${APP_ROLE} WITH LOGIN PASSWORD '${safePw}';
  END IF;
END $$;`);
console.log("  role created or password rotated");

const db = parsed.pathname.slice(1);
await sql(`GRANT CONNECT ON DATABASE ${db} TO ${APP_ROLE}`);
await sql(`GRANT USAGE ON SCHEMA public TO ${APP_ROLE}`);
await sql(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${APP_ROLE}`);
await sql(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${APP_ROLE}`);
// Anything created later, so a new table is not invisible until someone remembers.
await sql(`ALTER DEFAULT PRIVILEGES IN SCHEMA public
             GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${APP_ROLE}`);
await sql(`ALTER DEFAULT PRIVILEGES IN SCHEMA public
             GRANT USAGE, SELECT ON SEQUENCES TO ${APP_ROLE}`);
console.log("  grants applied (current objects + default privileges)");

// The blanket grant above just handed back what individual migrations
// withhold (their REVOKEs are skipped on a fresh database, where this role did
// not exist yet). Re-apply the withheld list, then refuse to continue if the
// result is not what the list says.
await applyRestrictedGrants((q) => sql(q));
const grantProblems = await checkRestrictedGrants((q) => sql(q));
if (grantProblems.length) {
  console.error("\nFAILED: restricted grants are wrong:\n  " + grantProblems.join("\n  ") + "\n");
  process.exit(1);
}
console.log("  restricted tables re-locked (see scripts/lib/restricted-grants.mjs)");

// THE ASSERTION THIS WHOLE STAGE EXISTS FOR.
const [role] = await sql`
  SELECT rolbypassrls, rolsuper, rolcanlogin FROM pg_roles WHERE rolname = ${APP_ROLE}`;
console.log(`\n  ${APP_ROLE}: bypassrls=${role.rolbypassrls}  super=${role.rolsuper}  canlogin=${role.rolcanlogin}`);

if (role.rolbypassrls || role.rolsuper) {
  console.error(
    `\nFAILED: ${APP_ROLE} can still bypass RLS. Policies would be inert.\n` +
      `Do not continue to stage 2.\n`
  );
  process.exit(1);
}

const [counts] = await sql`
  SELECT COUNT(*)::int AS granted FROM information_schema.role_table_grants
   WHERE grantee = ${APP_ROLE} AND table_schema = 'public' AND privilege_type = 'SELECT'`;
const [{ n: total }] = await sql`
  SELECT COUNT(*)::int AS n FROM pg_tables WHERE schemaname = 'public'`;
console.log(`  SELECT granted on ${counts.granted} of ${total} tables`);

parsed.username = APP_ROLE;
parsed.password = password;
writeFileSync(OUT_FILE, `SMR_APP_DATABASE_URL=${parsed.toString()}\n`);
console.log(`\n  connection string for ${APP_ROLE} written to ${OUT_FILE} (gitignored)`);
console.log("  PASS -- the role exists and cannot bypass RLS.\n");
