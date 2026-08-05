/**
 * One-time GOE Trendsetters org seed (Troy, 2026-08-05).
 *
 * Mirrors scripts/seed-5star-org.mjs / seed-expo-org.mjs, adapted to Baker's
 * pre-existing June codes. Dr. Baker already has a `users` row (tier partner)
 * and already owns two codes from June:
 *   - BAKER2026  (partner tier, "Dr. Baker / MKE Reentry")  <- STALE, retired here
 *   - BAKERCREW  (client tier,  "Dr. Baker / GOE -- cohort") <- becomes the anchor
 *
 * getOrgContext() resolves a leader's org by "code owner wins, earliest active
 * code owned." BAKER2026 (2026-06-07) would win and show "MKE Reentry" -- that
 * chapter closed 2026-08-05 -- so we deactivate it (0 redemptions, safe) and
 * make BAKERCREW the single anchor that doubles as her GOE Trendsetters
 * dashboard AND the participant cohort link (/access?code=BAKERCREW), exactly
 * like 5STARCREW does for Akyaa.
 *
 * NO invite email is sent -- account is pre-provisioned; she signs in via magic
 * link / OTP at /login (standing rule).
 *
 * Run: node scripts/seed-goe-org.mjs   (reads DATABASE_URL from consumer env)
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

const ANCHOR = "BAKERCREW";
const ORG_NAME = "GOE Trendsetters";
const ORG_LOGO = "/images/orgs/goe-trendsetters.png";
const STALE = "BAKER2026";

const ROSTER = [
  {
    email: "latonyabakergoe@gmail.com",
    name: "Dr. LaTonya Baker",
    role: "org_admin",
    title: "Founder & Executive Director",
  },
];

const c = new pg.Client({ connectionString: url });
await c.connect();

// 0. Retire the stale MKE Reentry partner code so it can't win getOrgContext.
//    Guarded: only touch it if it still looks like the old reentry code.
const staleRes = await c.query(
  `UPDATE access_code
      SET is_active = false
    WHERE code = $1 AND partner_name = 'Dr. Baker / MKE Reentry' AND times_redeemed = 0
    RETURNING id`,
  [STALE]
);
console.log(
  staleRes.rows.length
    ? `${STALE} deactivated (stale MKE Reentry code, 0 redemptions).`
    : `${STALE} left untouched (not found, renamed, or has redemptions) -- verify below.`
);

// 1. The org anchor code
const codeRes = await c.query(
  `UPDATE access_code
      SET partner_name = $2, org_logo_url = $3
    WHERE code = $1
    RETURNING id, partner_user_id, tier`,
  [ANCHOR, ORG_NAME, ORG_LOGO]
);
if (codeRes.rows.length === 0) {
  console.error(`${ANCHOR} access code not found -- aborting, nothing else changed.`);
  process.exit(1);
}
const { id: codeId, partner_user_id: currentOwner, tier: codeTier } = codeRes.rows[0];
console.log(`${ANCHOR} branded "${ORG_NAME}". code id: ${codeId}, tier: ${codeTier}, current owner: ${currentOwner}`);

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

// 3. Owner: set Baker only if the anchor is unowned
if (!currentOwner) {
  await c.query(`UPDATE access_code SET partner_user_id = $1 WHERE id = $2`, [
    ids["latonyabakergoe@gmail.com"],
    codeId,
  ]);
  console.log("Anchor owner set to Dr. Baker.");
} else {
  console.log("Anchor already has an owner -- left as is; Baker gets org_admin via org_staff.");
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

// --- verification ---
console.log("\n=== org_staff on anchor ===");
const staff = await c.query(
  `SELECT u.email, os.role, os.title FROM org_staff os JOIN users u ON u.id = os.user_id
    WHERE os.access_code_id = $1 ORDER BY os.role DESC`,
  [codeId]
);
console.table(staff.rows);

console.log("=== active codes Baker owns (getOrgContext picks the FIRST) ===");
const owned = await c.query(
  `SELECT code, partner_name, tier, is_active, created_at FROM access_code
    WHERE partner_user_id = $1 AND is_active = true ORDER BY created_at ASC`,
  [ids["latonyabakergoe@gmail.com"]]
);
console.table(owned.rows);

await c.end();
console.log("GOE Trendsetters org seed complete.");
