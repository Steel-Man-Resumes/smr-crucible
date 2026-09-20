#!/usr/bin/env node
/**
 * Grant, revoke or list platform administrators.
 *
 *   node scripts/platform-admin.mjs list
 *   node scripts/platform-admin.mjs grant someone@example.com "why"
 *   node scripts/platform-admin.mjs revoke someone@example.com
 *
 * This is the ONLY way to make an administrator, and it needs the owner
 * credential: the application role can read platform_admin and cannot write
 * it (migration 047). That is the point. A redeemed code, a tier sync or a bug
 * in a route cannot produce an admin; a person with the owner connection
 * string, running this, can.
 *
 * Reads PLATFORM_ADMIN_DATABASE_URL, else DATABASE_URL from
 * apps/consumer/.env.local. The credential is parsed here and never echoed.
 */
import { neon } from "@neondatabase/serverless";
import { readFileSync } from "node:fs";
import { assertBypassRole } from "./lib/assert-bypass-role.mjs";

function url() {
  if (process.env.PLATFORM_ADMIN_DATABASE_URL) return process.env.PLATFORM_ADMIN_DATABASE_URL;
  try {
    const line = readFileSync("apps/consumer/.env.local", "utf8")
      .split("\n").find((l) => l.trim().startsWith("DATABASE_URL="));
    if (line) return line.slice(line.indexOf("=") + 1).trim().replace(/^["']|["']$/g, "");
  } catch { /* fall through */ }
  return null;
}

const [cmd, emailArg, note] = process.argv.slice(2);
const conn = url();
if (!conn || !["list", "grant", "revoke"].includes(cmd)) {
  console.error("usage: platform-admin.mjs list | grant <email> [note] | revoke <email>");
  process.exit(2);
}
const sql = neon(conn);
const who = await assertBypassRole((q) => sql(q), "platform-admin");
console.log(`connected as ${who} @ ${new URL(conn).hostname}\n`);

if (cmd === "list") {
  const rows = await sql`
    SELECT u.email, u.name, pa.granted_by, pa.granted_at, pa.note
      FROM platform_admin pa JOIN users u ON u.id = pa.user_id ORDER BY pa.granted_at`;
  for (const r of rows) {
    console.log(`  ${r.email}  (${r.name ?? "no name"})  by ${r.granted_by}  ${new Date(r.granted_at).toISOString().slice(0, 10)}  ${r.note ?? ""}`);
  }
  console.log(`\n${rows.length} platform admin(s)`);
  process.exit(0);
}

const email = String(emailArg || "").toLowerCase().trim();
const [user] = await sql`SELECT id, email FROM users WHERE lower(email) = ${email}`;
if (!user) {
  console.error(`no user with email ${email}`);
  process.exit(1);
}

if (cmd === "grant") {
  await sql`INSERT INTO platform_admin (user_id, note) VALUES (${user.id}, ${note ?? null})
            ON CONFLICT (user_id) DO NOTHING`;
} else {
  const left = await sql`SELECT count(*)::int AS n FROM platform_admin WHERE user_id <> ${user.id}`;
  if (left[0].n === 0) {
    console.error("refusing: that would leave no platform admin at all");
    process.exit(1);
  }
  await sql`DELETE FROM platform_admin WHERE user_id = ${user.id}`;
}
const [after] = await sql`SELECT tier, EXISTS(SELECT 1 FROM platform_admin WHERE user_id = ${user.id}) AS is_admin FROM users WHERE id = ${user.id}`;
console.log(`${cmd} ${user.email}: platform_admin=${after.is_admin} tier=${after.tier}`);
