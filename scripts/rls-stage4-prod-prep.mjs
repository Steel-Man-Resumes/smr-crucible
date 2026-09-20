#!/usr/bin/env node
/**
 * RLS Stage 4a: prepare PRODUCTION, without changing its behaviour.
 *
 * THE PROPERTY THAT MAKES THIS SAFE. The app currently connects as
 * neondb_owner, which has BYPASSRLS -- so policies applied to production today
 * are completely inert for the running application. The weakness is, for this
 * one moment, the safety net: the schema change can land and be verified while
 * the app carries on exactly as before.
 *
 * So this does two additive things and nothing else:
 *   1. Creates smr_app (in SQL, never the console -- a console-created role is
 *      handed BYPASSRLS and would silently defeat every policy).
 *   2. Applies migration 044, the org-boundary policies.
 *
 * It does NOT touch the Vercel environment variable. That is the actual
 * cutover, it is a production credential swap, and it should be a human's
 * deliberate action rather than a side effect of running a script.
 *
 * Re-runnable. Verifies rather than assumes at every step.
 */
import { neon } from "@neondatabase/serverless";
import { readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";

const APP_ROLE = "smr_app";
const OUT = ".env.smr-app-prod";

function dbUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  for (const f of ["apps/consumer/.env.local", ".env.local"]) {
    try {
      const l = readFileSync(f, "utf8").split("\n").find((x) => x.trim().startsWith("DATABASE_URL="));
      if (l) return l.slice(l.indexOf("=") + 1).trim().replace(/^["']|["']$/g, "");
    } catch { /* next */ }
  }
  return null;
}

const url = dbUrl();
if (!url) { console.error("\nNo DATABASE_URL found.\n"); process.exit(2); }
const sql = neon(url);
const parsed = new URL(url);

console.log(`\nRLS production prep\n  host: ${parsed.hostname}\n`);

const [me] = await sql`
  SELECT current_user AS who, rolbypassrls FROM pg_roles WHERE rolname = current_user`;
console.log(`  connected as ${me.who} (bypassrls=${me.rolbypassrls})`);
if (!me.rolbypassrls) {
  console.log("\n  NOTE: this connection already obeys RLS. The cutover may already be done.\n");
}

// 1. The role.
const password = randomBytes(24).toString("base64url");
await sql(`DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${APP_ROLE}') THEN
    CREATE ROLE ${APP_ROLE} WITH LOGIN PASSWORD '${password.replace(/'/g, "''")}';
  ELSE
    ALTER ROLE ${APP_ROLE} WITH LOGIN PASSWORD '${password.replace(/'/g, "''")}';
  END IF;
END $$;`);

const db = parsed.pathname.slice(1);
await sql(`GRANT CONNECT ON DATABASE ${db} TO ${APP_ROLE}`);
await sql(`GRANT USAGE ON SCHEMA public TO ${APP_ROLE}`);
await sql(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${APP_ROLE}`);
await sql(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${APP_ROLE}`);
await sql(`ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${APP_ROLE}`);
await sql(`ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO ${APP_ROLE}`);

const [role] = await sql`SELECT rolbypassrls, rolsuper FROM pg_roles WHERE rolname = ${APP_ROLE}`;
if (role.rolbypassrls || role.rolsuper) {
  console.error(`\n  FAILED: ${APP_ROLE} can bypass RLS. Stop -- policies would be inert.\n`);
  process.exit(1);
}
console.log(`  ${APP_ROLE}: bypassrls=false, granted on all tables`);

// 2. The policies. Inert until the cutover, which is why this is safe now.
const ddl = readFileSync("packages/core/migrations/044_org_rls.sql", "utf8");
const parts = [];
let buf = "", inDollar = false;
for (const line of ddl.split("\n")) {
  if (line.includes("$$")) inDollar = !inDollar;
  buf += line + "\n";
  if (!inDollar && /;\s*$/.test(line)) { parts.push(buf); buf = ""; }
}
if (buf.trim()) parts.push(buf);
for (const stmt of parts.map((x) => x.trim()).filter((x) => x && !/^(--|\s)*$/.test(x))) {
  await sql(stmt);
}

const policies = await sql`
  SELECT tablename, policyname FROM pg_policies WHERE schemaname='public' ORDER BY tablename`;
const forced = await sql`
  SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class
   WHERE relname IN ('org_staff','client_staff_assignment')`;
console.log(`\n  policies applied:`);
for (const p of policies) console.log(`    ${p.tablename} -> ${p.policyname}`);
for (const f of forced) console.log(`    ${f.relname}: rls=${f.relrowsecurity} forced=${f.relforcerowsecurity}`);

// 3. The connection string for the cutover, written to a gitignored file.
parsed.username = APP_ROLE;
parsed.password = password;
writeFileSync(OUT, `SMR_APP_DATABASE_URL=${parsed.toString()}\n`);

console.log(`
  Production is PREPARED and BEHAVIOUR IS UNCHANGED. The app still connects as
  ${me.who}, which bypasses these policies, so nothing enforces yet and nothing
  can break yet.

  The connection string for ${APP_ROLE} is in ${OUT} (gitignored).
  The cutover is setting DATABASE_URL to that value in Vercel, and it is the
  one step this script deliberately does not take.
`);
