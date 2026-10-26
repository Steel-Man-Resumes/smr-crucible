/**
 * Migration 101 in real SQL (pglite): smr_redeem_code refuses platform admins
 * and the organization's own owner and staff, and every other answer is what
 * 096 gave. Also what an offer to such a person does (stays pending, nothing
 * spent), and that the app role can still call it and PUBLIC cannot.
 * Skipped unless SMR_PGLITE_DIR points at a node_modules folder holding
 * @electric-sql/pglite (SMR_PGLITE_DIR=/tmp/smr-idea-sql/node_modules).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const dir = process.env.SMR_PGLITE_DIR;
const skip = !dir || !existsSync(join(dir, "@electric-sql/pglite")) ? "set SMR_PGLITE_DIR to run the pglite 101 test" : false;
const MIG = join(__dirname, "..", "..", "..", "..", "packages", "core", "migrations") + "/";

test("101 in real SQL: admins and the org's own staff cannot join with a code; nothing else changed", { skip }, async () => {
  const { PGlite } = await import(join(dir!, "@electric-sql/pglite/dist/index.js"));
  const { pgcrypto } = await import(join(dir!, "@electric-sql/pglite/dist/contrib/pgcrypto.js"));
  const db = new PGlite({ extensions: { pgcrypto } });
  const failed: string[] = [];
  for (const f of readdirSync(MIG).filter((x) => /^\d{3}_.*\.sql$/.test(x) && Number(x.slice(0, 3)) <= 96).sort()) {
    try { await db.exec("BEGIN;" + readFileSync(MIG + f, "utf8") + ";COMMIT;"); }
    catch { await db.exec("ROLLBACK").catch(() => {}); failed.push(f); }
  }
  assert.ok(!failed.includes("096_refinery_access.sql"), `096 must apply; failed: ${failed.join(", ")}`);
  await db.exec(`CREATE ROLE smr_app NOSUPERUSER NOBYPASSRLS; GRANT USAGE ON SCHEMA public TO smr_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO smr_app;`);
  const { applyRestrictedGrants } = await import("../../../../scripts/lib/restricted-grants.mjs");
  await applyRestrictedGrants(async (t: string) => (await db.query(t)).rows);
  for (const fn of ["smr_accept_seat_offer(uuid, uuid)", "smr_leave_org(uuid, uuid)"]) {
    await db.exec(`GRANT EXECUTE ON FUNCTION public.${fn} TO smr_app`); // what 096 grants when the role exists
  }
  // 101 itself, twice: it must be re-runnable.
  for (let i = 0; i < 2; i++) await db.exec("BEGIN;" + readFileSync(MIG + "101_roles_and_codes.sql", "utf8") + ";COMMIT;");

  const q = async <T = Record<string, any>>(t: string, p: unknown[] = []) => (await db.query(t, p)).rows as T[];
  const one = async <T = Record<string, any>>(t: string, p: unknown[] = []) => (await q<T>(t, p))[0];
  const asApp = async (user: string, t: string, p: unknown[]) => {
    await db.exec("BEGIN; SET LOCAL ROLE smr_app;");
    try {
      await db.query(`SELECT set_config('app.user_id', $1, true)`, [user]);
      const r = (await db.query(t, p)).rows as Record<string, any>[];
      await db.exec("COMMIT");
      return r;
    } catch (e) { await db.exec("ROLLBACK"); throw e; }
  };
  const redeem = async (u: string, code: string) => (await asApp(u, `SELECT smr_redeem_code($1::uuid, $2) AS o`, [u, code]))[0].o as string;
  const members = async (u: string) => Number((await one(`SELECT count(*)::int AS n FROM access_code_redemption WHERE user_id = $1`, [u]))!.n);
  const seats = async (id: string) => Number((await one(`SELECT times_redeemed FROM access_code WHERE id = $1`, [id]))!.times_redeemed);

  const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  const U = { boss: id(1), owner: id(2), staff: id(3), lead: id(4), pat: id(5), otherOwner: id(6), back: id(7), late: id(8) };
  for (const u of Object.values(U)) await q(`INSERT INTO users(id, email, name, tier) VALUES ($1, $2, 'x', 'client')`, [u, `${u}@example.invalid`]);
  await q(`INSERT INTO platform_admin (user_id, note) VALUES ($1, 'test')`, [U.boss]);
  const org = (await one(`INSERT INTO access_code (code, partner_name, tier, partner_user_id, is_active, max_redemptions) VALUES ('PG101AAA', 'PG 101', 'partner', $1, true, 3) RETURNING id`, [U.owner]))!.id;
  const other = (await one(`INSERT INTO access_code (code, partner_name, tier, partner_user_id, is_active) VALUES ('PG101BBB', 'PG 101 other', 'client', $1, true) RETURNING id`, [U.otherOwner]))!.id;
  const shut = (await one(`INSERT INTO access_code (code, partner_name, tier, partner_user_id, is_active) VALUES ('PG101OFF', 'PG off', 'client', $1, false) RETURNING id`, [U.owner]))!.id;
  await q(`INSERT INTO org_staff (access_code_id, user_id, role) VALUES ($1, $2, 'staff'), ($1, $3, 'org_admin')`, [org, U.staff, U.lead]);

  // ---- the two refusals
  assert.equal(await redeem(U.boss, "PG101AAA"), "platform_admin");
  assert.equal(await redeem(U.boss, "NO-SUCH-CODE"), "platform_admin", "same answer for a code that does not exist");
  assert.equal(await redeem(U.boss, "PG101OFF"), "platform_admin", "and for a closed one");
  assert.equal(await redeem(U.owner, "PG101AAA"), "org_staff", "the owner");
  assert.equal(await redeem(U.staff, "PG101AAA"), "org_staff", "staff");
  assert.equal(await redeem(U.lead, "PG101AAA"), "org_staff", "org admin");
  assert.equal(await members(U.boss) + await members(U.owner) + await members(U.staff) + await members(U.lead), 0, "no membership written");
  assert.equal(await seats(org), 0, "no seat spent");

  // ---- the rest is 096's, in 096's order
  assert.equal(await redeem(U.staff, "PG101OFF"), "inactive", "a closed code says inactive before anything about staff");
  assert.equal(await redeem(U.staff, "PG101BBB"), "ok", "staff of one org may still join ANOTHER org");
  assert.equal(await redeem(U.pat, "PG101AAA"), "ok");
  assert.equal(await seats(org), 1);
  assert.equal(await redeem(U.pat, "PG101AAA"), "already_member");
  assert.equal(await redeem(U.pat, "NOPE"), "not_found");
  assert.equal(await redeem(U.pat, ""), "not_found");
  await q(`UPDATE access_code SET expires_at = now() - interval '1 day' WHERE id = $1`, [other]);
  assert.equal(await redeem(U.back, "PG101BBB"), "expired");
  await q(`UPDATE access_code SET expires_at = NULL WHERE id = $1`, [other]);
  // returning member re-uses their seat even when full
  assert.equal(await redeem(U.back, "PG101AAA"), "ok");
  assert.equal(await asApp(U.back, `SELECT smr_leave_org($1::uuid, $2::uuid) AS n`, [U.back, org]).then((r) => r[0].n), 1);
  await q(`UPDATE access_code SET max_redemptions = times_redeemed WHERE id = $1`, [org]);
  assert.equal(await redeem(U.late, "PG101AAA"), "full");
  assert.equal(await redeem(U.back, "PG101AAA"), "ok", "coming back takes back the seat already used");

  // ---- an offer to the org's own staff stays pending; nothing is spent
  await q(`UPDATE access_code SET max_redemptions = NULL WHERE id = $1`, [org]);
  const offer = (await one(`INSERT INTO org_seat_offer (access_code_id, user_id, offered_by) VALUES ($1, $2, $3) RETURNING id`, [org, U.lead, U.owner]))!.id;
  const before = await seats(org);
  assert.equal((await asApp(U.lead, `SELECT smr_accept_seat_offer($1::uuid, $2::uuid) AS o`, [U.lead, offer]))[0].o, "org_staff");
  assert.equal((await one(`SELECT status FROM org_seat_offer WHERE id = $1`, [offer]))!.status, "pending");
  assert.equal(await seats(org), before);
  const bossOffer = (await one(`INSERT INTO org_seat_offer (access_code_id, user_id, offered_by) VALUES ($1, $2, $3) RETURNING id`, [org, U.boss, U.owner]))!.id;
  assert.equal((await asApp(U.boss, `SELECT smr_accept_seat_offer($1::uuid, $2::uuid) AS o`, [U.boss, bossOffer]))[0].o, "platform_admin");

  // ---- grants
  const priv = await one(`SELECT has_function_privilege('public', 'public.smr_redeem_code(uuid, text)', 'EXECUTE') AS pub,
                                 has_function_privilege('smr_app', 'public.smr_redeem_code(uuid, text)', 'EXECUTE') AS app`);
  assert.equal(priv!.pub, false);
  assert.equal(priv!.app, true);
  // the app still cannot write a membership directly
  const direct = await asApp(U.late, `INSERT INTO access_code_redemption (user_id, access_code_id) VALUES ($1, $2)`, [U.late, shut]).then(() => null, (e) => String(e.message));
  assert.match(direct ?? "", /permission denied/i);

  // ---- the boss's dry run runs read-only, and the re-tier it prints does what it says
  const DRY = readFileSync(MIG + "dry-run/101_roles_and_codes.sql", "utf8");
  await q(`UPDATE users SET tier = 'partner' WHERE id = $1`, [U.pat]); // a participant made "partner" by the old code rule
  await db.exec(DRY);
  const preview = DRY.slice(DRY.indexOf("-- 3. re-tier preview"), DRY.indexOf("-- 4. the counts"));
  const counts = DRY.slice(DRY.indexOf("-- 4. the counts"), DRY.indexOf("\nROLLBACK;"));
  const rows = await q<{ user_id: string; tier_by_role: string }>(preview);
  const byUser = Object.fromEntries(rows.map((r) => [r.user_id, r.tier_by_role]));
  assert.equal(byUser[U.pat], "client", "the partner-coded participant goes to client");
  for (const u of [U.owner, U.staff, U.lead, U.otherOwner]) assert.equal(byUser[u], "partner", `staff role ${u} goes to partner`);
  assert.equal(byUser[U.boss], undefined, "platform admins are never listed");
  const c = (await q<{ partner_to_client: number; client_to_partner: number }>(counts))[0];
  assert.deepEqual([Number(c.partner_to_client), Number(c.client_to_partner)], [1, 4]);
  const block = DRY.slice(DRY.indexOf("-- BEGIN;")).split("\n").filter((l) => l.startsWith("-- ") && !/^-- (BEGIN;|-- COMMIT)/.test(l)).map((l) => l.slice(3)).join("\n");
  const guardDo = block.slice(0, block.indexOf("WITH r AS"));
  const update = block.slice(block.indexOf("WITH r AS"));
  assert.match(guardDo, /^DO \$\$[\s\S]*rolbypassrls OR rolsuper[\s\S]*END \$\$;\s*$/, "the UPDATE block starts with the BYPASSRLS guard");

  // Fix round 1: without BYPASSRLS both the dry run and the re-tier stop,
  // instead of seeing no staff and demoting everyone.
  await db.exec(`CREATE ROLE l2_nobypass NOSUPERUSER NOBYPASSRLS; GRANT USAGE ON SCHEMA public TO l2_nobypass; GRANT SELECT ON ALL TABLES IN SCHEMA public TO l2_nobypass;`);
  const asNoBypass = async (sqlText: string) => {
    await db.exec("BEGIN; SET LOCAL ROLE l2_nobypass;");
    try { await db.exec(sqlText); await db.exec("ROLLBACK"); return null; } catch (e) { await db.exec("ROLLBACK").catch(() => {}); return String((e as Error).message); }
  };
  const dryBody = DRY.slice(DRY.indexOf("\nBEGIN READ ONLY;") + "\nBEGIN READ ONLY;".length, DRY.indexOf("\nROLLBACK;"));
  assert.match((await asNoBypass(dryBody)) ?? "ran", /dry run needs a role with BYPASSRLS/);
  assert.match((await asNoBypass(guardDo)) ?? "ran", /re-tier needs a role with BYPASSRLS/);

  await db.exec(guardDo);
  const done = (await q<{ down: number; up: number }>(update))[0];
  assert.deepEqual([Number(done.down), Number(done.up)], [1, 4], "the UPDATE matches section 4");
  assert.equal((await q(preview)).length, 0, "after the re-tier nothing differs");
  assert.equal((await one(`SELECT tier FROM users WHERE id = $1`, [U.boss]))!.tier, "admin");

  // Fix round 1: the after-guard checks the function's OWNER, which CREATE OR
  // REPLACE keeps, not only current_user. An owner without BYPASSRLS stops 101.
  await db.exec(`ALTER FUNCTION public.smr_redeem_code(uuid, text) OWNER TO l2_nobypass`);
  const rerun = await db.exec("BEGIN;" + readFileSync(MIG + "101_roles_and_codes.sql", "utf8") + ";COMMIT;").then(() => null, (e: Error) => String(e.message));
  await db.exec("ROLLBACK").catch(() => {});
  assert.match(rerun ?? "applied", /owner of smr_redeem_code must have BYPASSRLS/);
  await db.exec(`ALTER FUNCTION public.smr_redeem_code(uuid, text) OWNER TO CURRENT_USER`);
  await db.exec("BEGIN;" + readFileSync(MIG + "101_roles_and_codes.sql", "utf8") + ";COMMIT;");
  await db.close();
});
