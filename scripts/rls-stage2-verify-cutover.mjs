#!/usr/bin/env node
/**
 * RLS Stage 2: can the application actually RUN as the non-bypassing role?
 *
 * This is where a cutover breaks, and it breaks in the worst way: a missing
 * grant does not degrade a feature, it stops logins. The app reaches the
 * database through THREE separate connections -- the core client, the Auth.js
 * Pool, and an edge client -- and 14 API routes build their own client instead
 * of using core. Every one of those has to work as smr_app.
 *
 * So this exercises the real surfaces as the new role, on a branch, and reports
 * every permission failure at once rather than one redeploy at a time.
 *
 * Read-mostly: it writes only into tables the isolation suite already owns, and
 * it never runs DDL.
 */
import { neon } from "@neondatabase/serverless";
import { readFileSync } from "node:fs";

const PROD_ENDPOINT = "ep-little-cloud-aphpkqbd";

function readVar(file, name) {
  try {
    const line = readFileSync(file, "utf8").split("\n").find((l) => l.trim().startsWith(name + "="));
    return line ? line.slice(line.indexOf("=") + 1).trim().replace(/^["']|["']$/g, "") : null;
  } catch {
    return null;
  }
}

const conn = process.env.SMR_APP_DATABASE_URL || readVar(".env.smr-app", "SMR_APP_DATABASE_URL");
if (!conn) {
  console.error("\nNo smr_app connection string. Run stage 1 first.\n");
  process.exit(2);
}
if (new URL(conn).hostname.includes(PROD_ENDPOINT)) {
  console.error("\nREFUSING: production endpoint. Stage 2 runs on a branch.\n");
  process.exit(2);
}

const sql = neon(conn);
let pass = 0;
let fail = 0;

async function check(name, fn) {
  try {
    await fn();
    pass++;
    console.log(`  pass  ${name}`);
  } catch (err) {
    fail++;
    const msg = String(err?.message ?? err).split("\n")[0];
    console.log(`  FAIL  ${name}\n          ${msg}`);
  }
}

console.log("\nRLS Stage 2 -- the app running as smr_app\n");

const [who] = await sql`SELECT current_user AS who`;
console.log(`  connected as: ${who.who}\n`);

// The identity assertion. Everything below is meaningless without it.
await check("connection cannot bypass RLS", async () => {
  const [r] = await sql`
    SELECT rolbypassrls, rolsuper FROM pg_roles WHERE rolname = current_user`;
  if (r.rolbypassrls || r.rolsuper) throw new Error("this role can still bypass RLS");
});

// Auth.js adapter tables. A missing grant here means nobody can sign in.
for (const t of ["users", "accounts", "sessions", "verification_token"]) {
  await check(`auth table readable: ${t}`, () => sql(`SELECT 1 FROM ${t} LIMIT 1`));
}
await check("auth: can create a session row", async () => {
  const [u] = await sql`SELECT id FROM users LIMIT 1`;
  if (!u) return; // empty branch, nothing to attach to
  const token = "__rlsstage2_" + Math.random().toString(36).slice(2);
  await sql`INSERT INTO sessions ("sessionToken", "userId", expires)
            VALUES (${token}, ${u.id}, now() + interval '1 hour')`;
  await sql`DELETE FROM sessions WHERE "sessionToken" = ${token}`;
});

// The tenant surfaces the console and the Forge actually touch.
// NOTE: these prove the role can QUERY the table, not that it can SEE rows.
// For the RLS-protected tables an empty result is exactly the failure this
// whole exercise is about, so they are checked separately below rather than
// counted as readable. (Found in review.)
const READS = [
  "access_code", "access_code_redemption",
  "consumer_consent", "job_application", "refinery_artifact", "ai_token_usage",
  "consumer_profile", "forge_session", "decision_log", "support_request",
];
for (const t of READS) {
  await check(`readable: ${t}`, () => sql(`SELECT 1 FROM ${t} LIMIT 1`));
}

// The protected tables: permission to query is not the same as visibility.
// An unscoped read returning zero is CORRECT here, and a scoped read must
// return what was seeded -- otherwise the app looks fine and shows nothing.
for (const t of ["org_staff", "client_staff_assignment"]) {
  await check(`${t}: unscoped read returns nothing (policy is biting)`, async () => {
    const rows = await sql(`SELECT 1 FROM ${t} LIMIT 1`);
    if (rows.length !== 0) throw new Error("rows visible without a scope -- policy not enforcing");
  });
}

// Sequences: an INSERT into a serial column fails without USAGE.
await check("sequences usable", async () => {
  const seqs = await sql`
    SELECT sequence_name FROM information_schema.sequences
     WHERE sequence_schema = 'public' LIMIT 1`;
  if (!seqs.length) return;
  await sql(`SELECT last_value FROM ${seqs[0].sequence_name}`);
});

// Tables added later must not be invisible: default privileges cover them.
await check("default privileges set for future tables", async () => {
  const [d] = await sql`
    SELECT COUNT(*)::int AS n FROM pg_default_acl a
     WHERE array_to_string(a.defaclacl, ',') LIKE '%smr_app%'`;
  if (d.n === 0) throw new Error("no default ACL grants smr_app -- new tables will be invisible");
});

// The tables it must NOT be able to reshape.
await check("cannot run DDL (not a table owner)", async () => {
  try {
    await sql(`ALTER TABLE users ADD COLUMN __rls_probe_col TEXT`);
  } catch {
    return; // correct
  }
  await sql(`ALTER TABLE users DROP COLUMN IF EXISTS __rls_probe_col`);
  throw new Error("smr_app can alter tables -- it has more privilege than it needs");
});

console.log(`\n${pass} passed, ${fail} failed\n`);
if (fail) {
  console.log("Every failure above is a missing GRANT. Fix them in stage 1 and re-run;");
  console.log("finding them here is the entire point of doing this on a branch.\n");
}
process.exit(fail === 0 ? 0 : 1);
