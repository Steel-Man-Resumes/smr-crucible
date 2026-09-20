#!/usr/bin/env node
/**
 * Stage 0 of the RLS work: establish the truth before changing anything.
 *
 * THE DANGER IN THIS WHOLE PROJECT IS THAT IT APPEARS TO WORK. A table's OWNER
 * bypasses row-level security. So policies can be written, applied, and be
 * completely correct, while enforcing nothing at all -- with no error, no log
 * line, and a schema that reads exactly like a secured one. The only way to
 * know is to ask the database who you are connected as and whether that role
 * can bypass.
 *
 * Read-only. Runs no DDL, changes nothing, and is safe against production.
 */
import { neon } from "@neondatabase/serverless";
import { readFileSync } from "node:fs";

function url() {
  for (const v of ["RLS_PROBE_DATABASE_URL", "ISOLATION_TEST_DATABASE_URL", "DATABASE_URL"]) {
    if (process.env[v]) return [process.env[v], v];
  }
  for (const f of [".env.isolation", "apps/consumer/.env.local"]) {
    try {
      const line = readFileSync(f, "utf8").split("\n").find((l) =>
        /^(RLS_PROBE_DATABASE_URL|ISOLATION_TEST_DATABASE_URL|DATABASE_URL)=/.test(l.trim())
      );
      if (line) return [line.slice(line.indexOf("=") + 1).trim().replace(/^["']|["']$/g, ""), f];
    } catch { /* next */ }
  }
  return [null, null];
}

const [conn, source] = url();
if (!conn) {
  console.error("\nNo connection string found. Set RLS_PROBE_DATABASE_URL.\n");
  process.exit(2);
}

const sql = neon(conn);
console.log(`\nRLS readiness probe   (connection from ${source})\n`);

const [me] = await sql`
  SELECT current_user AS who,
         r.rolsuper, r.rolbypassrls, r.rolcreaterole
    FROM pg_roles r WHERE r.rolname = current_user`;

console.log(`  connected as:        ${me.who}`);
console.log(`  superuser:           ${me.rolsuper}`);
console.log(`  can bypass RLS:      ${me.rolbypassrls}`);
console.log(`  can create roles:    ${me.rolcreaterole}`);

const owned = await sql`
  SELECT COUNT(*)::int AS n FROM pg_tables
   WHERE schemaname = 'public' AND tableowner = current_user`;
const [{ n: total }] = await sql`
  SELECT COUNT(*)::int AS n FROM pg_tables WHERE schemaname = 'public'`;
console.log(`  tables owned by me:  ${owned[0].n} of ${total}`);

const policies = await sql`SELECT COUNT(*)::int AS n FROM pg_policies WHERE schemaname='public'`;
const rlsOn = await sql`
  SELECT COUNT(*)::int AS n FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
   WHERE ns.nspname='public' AND c.relkind='r' AND c.relrowsecurity`;
console.log(`  policies defined:    ${policies[0].n}`);
console.log(`  tables with RLS on:  ${rlsOn[0].n}`);

const roles = await sql`
  SELECT rolname, rolbypassrls, rolsuper FROM pg_roles
   WHERE rolcanlogin AND rolname NOT LIKE 'pg\\_%' ORDER BY rolname`;
console.log(`\n  login roles on this database:`);
for (const r of roles) {
  console.log(`    ${r.rolname.padEnd(22)} bypassrls=${r.rolbypassrls}  super=${r.rolsuper}`);
}

const ownerBypass = me.rolbypassrls || owned[0].n > 0;
console.log(`\n  VERDICT: ${
  ownerBypass
    ? "any policy written today would be INERT for this connection."
    : "this connection is subject to row-level security."
}\n`);
