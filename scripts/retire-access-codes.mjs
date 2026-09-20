#!/usr/bin/env node
/**
 * Retire access codes: stop them being redeemable, keep everything they did.
 *
 * Taking a code out of the /access page stops ADVERTISING it. It does not stop
 * it being REDEEMED -- the row is still active in the database, and the code
 * was published in a public repository, so anyone who read it can still spend a
 * seat and land in that organization's cohort.
 *
 * DEACTIVATE, NEVER DELETE. `access_code_redemption` rows point at these codes
 * and they are how real people's membership, seat accounting and cohort
 * attribution are recorded. Deleting a code would orphan or erase that history.
 * Setting is_active = false closes the door and leaves the record intact, and
 * it is reversible with one UPDATE if a code turns out to still be needed.
 *
 *   node scripts/retire-access-codes.mjs CODE1 CODE2
 *   node scripts/retire-access-codes.mjs --check CODE1     (report only)
 *
 * Reports how many people already redeemed each code BEFORE changing anything,
 * because "nobody is using it" should be a fact rather than an assumption, and
 * existing members keep their access either way -- deactivating blocks NEW
 * redemptions, it does not evict anyone.
 */

import { neon } from "@neondatabase/serverless";
import { readFileSync } from "node:fs";

/** Read DATABASE_URL without sourcing the file into a shell. */
function databaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  for (const path of ["apps/consumer/.env.local", ".env.local"]) {
    try {
      const line = readFileSync(path, "utf8")
        .split("\n")
        .find((l) => l.trim().startsWith("DATABASE_URL="));
      if (line) return line.slice(line.indexOf("=") + 1).trim().replace(/^["']|["']$/g, "");
    } catch {
      /* try the next one */
    }
  }
  return null;
}

const args = process.argv.slice(2);
const checkOnly = args.includes("--check");
const codes = args.filter((a) => !a.startsWith("--")).map((c) => c.toUpperCase());

if (!codes.length) {
  console.error("\nUsage: node scripts/retire-access-codes.mjs [--check] CODE [CODE...]\n");
  process.exit(2);
}

const url = databaseUrl();
if (!url) {
  console.error("\nNo DATABASE_URL found in the environment or .env.local.\n");
  process.exit(2);
}

const sql = neon(url);

// Fail loudly rather than report zeros. A retirement decision made on a false
// "nobody is attached" is exactly the mistake this script exists to prevent.
{
  const [role] = await sql`SELECT current_user AS who, rolbypassrls
                             FROM pg_roles WHERE rolname = current_user`;
  if (!role?.rolbypassrls) {
    console.error(
      `\nConnected as ${role?.who}, which cannot bypass row-level security.\n` +
        `org_staff counts would read 0 for every organization and this tool\n` +
        `would tell you nobody is attached to codes that have staff.\n` +
        `Use an owner connection.\n`
    );
    process.exit(2);
  }
}

const rows = await sql`
  SELECT ac.code, ac.partner_name, ac.is_active, ac.times_redeemed,
         (SELECT COUNT(*) FROM access_code_redemption r
           WHERE r.access_code_id = ac.id)::int AS people,
         -- NOTE: org_staff is row-level protected. Run this with an
         -- owner/bypass connection, or this count silently reads 0 and the
         -- "still has people attached" warning below misses every org that
         -- has staff but no redemptions. (Found in review.)
         (SELECT COUNT(*) FROM org_staff os
           WHERE os.access_code_id = ac.id)::int AS staff
    FROM access_code ac
   WHERE ac.code = ANY(${codes}::text[])`;

const found = new Set(rows.map((r) => r.code));
for (const c of codes) if (!found.has(c)) console.log(`  ${c.padEnd(16)} not in the database`);

console.log("");
for (const r of rows) {
  console.log(
    `  ${r.code.padEnd(16)} ${r.is_active ? "ACTIVE " : "retired"}  ` +
      `${r.people} redeemed, ${r.staff} staff  (${r.partner_name})`
  );
}

const live = rows.filter((r) => r.is_active);
if (!live.length) {
  console.log("\nNothing to do -- none of these are active.\n");
  process.exit(0);
}

if (checkOnly) {
  console.log(`\n--check: ${live.length} would be deactivated. Nothing changed.\n`);
  process.exit(0);
}

const inUse = live.filter((r) => r.people > 0 || r.staff > 0);
if (inUse.length) {
  // Not a refusal, a stop-and-look. Existing members keep their access when a
  // code is deactivated, but "unused" was the reason for retiring these, and a
  // code with people behind it deserves a second look before it is closed.
  console.log("\nHeads up -- these still have people attached:");
  for (const r of inUse) {
    console.log(`  ${r.code}: ${r.people} redeemed, ${r.staff} staff`);
  }
  console.log("Deactivating blocks NEW redemptions. Nobody already in loses access.\n");
}

const updated = await sql`
  UPDATE access_code SET is_active = false, updated_at = NOW()
   WHERE code = ANY(${live.map((r) => r.code)}::text[]) AND is_active = true
  RETURNING code`;

console.log(`\nRetired ${updated.length}: ${updated.map((r) => r.code).join(", ")}`);
console.log("Reversible: UPDATE access_code SET is_active = true WHERE code = '...'\n");
