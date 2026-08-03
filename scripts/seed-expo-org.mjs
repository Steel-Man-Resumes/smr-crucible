/**
 * One-time EXPO of Wisconsin org seed (Troy confirmed roster 2026-08-02).
 *
 * - Brands the EXPO2026 access code (org name + real logo).
 * - Ensures user rows exist for Marianne Oleson (org admin), Miranda Olson
 *   and Kelly Mahoney (staff). NO invite emails are sent -- accounts are
 *   pre-provisioned and idle until Troy says go (standing rule).
 * - Sets the code owner to Marianne only if no owner is set.
 *
 * Run: node scripts/seed-expo-org.mjs   (reads DATABASE_URL from consumer env)
 */

import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import pg from "pg";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const env = readFileSync(join(root, "apps/consumer/.env.local"), "utf8");
const url = env
  .split("\n")
  .find((l) => l.startsWith("DATABASE_URL="))
  .slice(13)
  .replace(/"/g, "");

const ROSTER = [
  {
    email: "marianne@expowisconsin.org",
    name: "Marianne Oleson",
    role: "org_admin",
    title: "Co-Executive Director",
  },
  {
    email: "miranda@expowisconsin.org",
    name: "Miranda Olson",
    role: "staff",
    title: "Curriculum Lead, EXPO Works",
  },
  {
    email: "kellym@expowisconsin.org",
    name: "Kelly Mahoney",
    role: "staff",
    title: "Executive Assistant",
  },
];

const c = new pg.Client({ connectionString: url });
await c.connect();

// 1. The org anchor code
const codeRes = await c.query(
  `UPDATE access_code
      SET partner_name = 'EXPO of Wisconsin',
          org_logo_url = '/images/orgs/expo-wisconsin.png'
    WHERE code = 'EXPO2026'
    RETURNING id, partner_user_id`
);
if (codeRes.rows.length === 0) {
  console.error("EXPO2026 access code not found -- aborting, nothing changed.");
  process.exit(1);
}
const { id: codeId, partner_user_id: currentOwner } = codeRes.rows[0];
console.log("EXPO2026 branded. code id:", codeId, "current owner:", currentOwner);

// 2. Roster users (create-if-missing; tier partner; NO emails sent)
const ids = {};
for (const p of ROSTER) {
  const existing = await c.query(`SELECT id, tier FROM users WHERE email = $1`, [p.email]);
  if (existing.rows.length > 0) {
    ids[p.email] = existing.rows[0].id;
    if (existing.rows[0].tier !== "partner" && existing.rows[0].tier !== "admin") {
      await c.query(`UPDATE users SET tier = 'partner' WHERE id = $1`, [existing.rows[0].id]);
      console.log(`${p.email}: existing user, tier -> partner`);
    } else {
      console.log(`${p.email}: existing user, unchanged tier ${existing.rows[0].tier}`);
    }
  } else {
    const ins = await c.query(
      `INSERT INTO users (name, email, tier) VALUES ($1, $2, 'partner') RETURNING id`,
      [p.name, p.email]
    );
    ids[p.email] = ins.rows[0].id;
    console.log(`${p.email}: created (tier partner, no password, no invite sent)`);
  }
}

// 3. Owner: set Marianne only if unowned
if (!currentOwner) {
  await c.query(`UPDATE access_code SET partner_user_id = $1 WHERE id = $2`, [
    ids["marianne@expowisconsin.org"],
    codeId,
  ]);
  console.log("Code owner set to Marianne.");
} else {
  console.log("Code already has an owner -- left as is; Marianne gets org_admin via org_staff.");
}

// 4. org_staff upserts
for (const p of ROSTER) {
  await c.query(
    `INSERT INTO org_staff (access_code_id, user_id, role, title)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (access_code_id, user_id)
     DO UPDATE SET role = $3, title = $4`,
    [codeId, ids[p.email], p.role, p.title]
  );
  console.log(`org_staff: ${p.name} -> ${p.role} (${p.title})`);
}

const check = await c.query(
  `SELECT u.email, os.role, os.title FROM org_staff os JOIN users u ON u.id = os.user_id
    WHERE os.access_code_id = $1 ORDER BY os.role DESC`,
  [codeId]
);
console.table(check.rows);
await c.end();
console.log("EXPO org seed complete.");
