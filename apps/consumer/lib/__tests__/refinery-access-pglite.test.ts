/**
 * Real SQL for the Refinery seat gate (migration 096), in pglite: the seat
 * rule, the three close statements the admin action sends (grandfather once),
 * the offer insert with its 24-hour window, accept and decline and withdraw,
 * and what the app role (smr_app, created before the migrations so their
 * grants apply) may and may not do under row-level security. Skipped unless
 * SMR_PGLITE_DIR points at a node_modules folder holding @electric-sql/pglite
 * (SMR_PGLITE_DIR=/tmp/smr-idea-sql/node_modules).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { CLOSE_STATEMENTS } from "../refinery-access-server";
import { OFFER_INSERT_SQL } from "@crucible/core/src/refineryAccess";

const dir = process.env.SMR_PGLITE_DIR;
const skip = !dir || !existsSync(join(dir, "@electric-sql/pglite")) ? "set SMR_PGLITE_DIR to run the pglite seat test" : false;
const MIG = join(__dirname, "..", "..", "..", "..", "packages", "core", "migrations") + "/";

test("096 in real SQL: seat rule, grandfather once, offers, and the app role's limits", { skip }, async () => {
  const { PGlite } = await import(join(dir!, "@electric-sql/pglite/dist/index.js"));
  const { pgcrypto } = await import(join(dir!, "@electric-sql/pglite/dist/contrib/pgcrypto.js"));
  const db = new PGlite({ extensions: { pgcrypto } });
  await db.exec("CREATE TABLE IF NOT EXISTS _migrations(filename text PRIMARY KEY, applied_at timestamptz DEFAULT now())");
  const failed: string[] = [];
  for (const f of readdirSync(MIG).filter((x) => /^\d{3}_.*\.sql$/.test(x) && Number(x.slice(0, 3)) <= 96).sort()) {
    try { await db.exec(`BEGIN; INSERT INTO _migrations(filename) VALUES ('${f}') ON CONFLICT DO NOTHING;` + readFileSync(MIG + f, "utf8") + ";COMMIT;"); }
    catch { await db.exec("ROLLBACK").catch(() => {}); failed.push(f); }
  }
  assert.ok(!failed.includes("096_refinery_access.sql"), `096 must apply; failed: ${failed.join(", ")}`);
  // The app role the way CI and a new Neon branch get it (restricted-grants.mjs):
  // created after the migrations, a blanket grant, then the restricted lists.
  await db.exec(`CREATE ROLE smr_app NOSUPERUSER NOBYPASSRLS; GRANT USAGE ON SCHEMA public TO smr_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO smr_app; GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO smr_app;`);
  const { applyRestrictedGrants } = await import("../../../../scripts/lib/restricted-grants.mjs");
  await applyRestrictedGrants(async (t: string) => (await db.query(t)).rows);
  for (const fn of ["smr_refinery_signup_open()", "smr_has_refinery_seat(uuid)", "smr_accept_seat_offer(uuid, uuid)", "smr_decline_seat_offer(uuid, uuid)",
    "smr_leave_org(uuid, uuid)", "smr_withdraw_seat_offer(uuid)", "smr_redeem_code(uuid, text)", "smr_leave_all_orgs(uuid)"]) {
    await db.exec(`GRANT EXECUTE ON FUNCTION public.${fn} TO smr_app`); // what 096 grants when the role exists
  }
  const q = async <T = Record<string, any>>(t: string, p: unknown[] = []) => (await db.query(t, p)).rows as T[];
  const one = async <T = Record<string, any>>(t: string, p: unknown[] = []) => (await q<T>(t, p))[0];
  /** One transaction as the app role with app.user_id (and app.org_id) set, like runAsUser / runScoped. */
  const asApp = async (user: string, stmts: [string, unknown[]][], org?: string) => {
    await db.exec("BEGIN; SET LOCAL ROLE smr_app;");
    try {
      await db.query(`SELECT set_config('app.user_id', $1, true), set_config('app.org_id', $2, true)`, [user, org ?? ""]);
      const out: Record<string, any>[][] = [];
      for (const [t, p] of stmts) out.push((await db.query(t, p)).rows as Record<string, any>[]);
      await db.exec("COMMIT");
      return out;
    } catch (e) { await db.exec("ROLLBACK"); throw e; }
  };
  const err = async (fn: () => Promise<unknown>) => { try { await fn(); return null; } catch (e) { return String((e as Error).message); } };
  const id = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
  const U = { owner: id(1), staff: id(2), member: id(3), nobody: id(4), boss: id(5), lapsed: id(6), asked: id(7), late: id(8), other: id(9) };
  for (const u of Object.values(U)) await q(`INSERT INTO users(id, email, name, tier) VALUES ($1, $2, 'x', 'client')`, [u, `${u}@x.test`]);
  const org = (await one(`INSERT INTO access_code (code, partner_name, tier, partner_user_id, is_active, max_redemptions) VALUES ('PGSEAT001', 'PG seats', 'client', $1, true, 5) RETURNING id`, [U.owner]))!.id;
  const old = (await one(`INSERT INTO access_code (code, partner_name, tier, is_active, expires_at) VALUES ('PGOLD0001', 'PG old', 'client', true, now() - interval '1 day') RETURNING id`))!.id;
  const otherOrg = (await one(`INSERT INTO access_code (code, partner_name, tier, is_active) VALUES ('PGOTHER01', 'PG other', 'client', true) RETURNING id`))!.id;
  await q(`INSERT INTO org_staff (access_code_id, user_id, role) VALUES ($1, $2, 'staff')`, [org, U.staff]);
  await q(`SELECT smr_redeem_code($1::uuid, 'PGSEAT001')`, [U.member]);
  await q(`SELECT smr_redeem_code($1::uuid, 'PGOLD0001')`, [U.lapsed]).catch(() => null);
  await q(`INSERT INTO access_code_redemption (user_id, access_code_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [U.lapsed, old]);
  await q(`INSERT INTO platform_admin (user_id, note) VALUES ($1, 'test')`, [U.boss]).catch(() => q(`INSERT INTO platform_admin (user_id) VALUES ($1)`, [U.boss]));
  await q(`UPDATE users SET tier = 'partner' WHERE id = $1`, [U.nobody]);

  // ---- the seat rule (as the app role, through the definer function) ----
  const seat = async (u: string) => (await asApp(u, [[`SELECT smr_has_refinery_seat($1::uuid) AS s`, [u]]]))[0][0].s;
  assert.equal(await seat(U.boss), true, "platform admin");
  assert.equal(await seat(U.owner), true, "owner");
  assert.equal(await seat(U.staff), true, "staff");
  assert.equal(await seat(U.member), true, "member of an active code");
  assert.equal(await seat(U.lapsed), false, "member of an expired code");
  assert.equal(await seat(U.nobody), false, "tier partner alone is nothing");
  assert.equal((await asApp(U.nobody, [[`SELECT smr_refinery_signup_open() AS o`, []]]))[0][0].o, true, "open when applied");

  // ---- row-level security for the app role ----
  const seen = await asApp(U.nobody, [[`SELECT (SELECT count(*)::int FROM refinery_access_policy) AS p, (SELECT count(*)::int FROM refinery_seat_legacy) AS l, (SELECT count(*)::int FROM org_seat_offer) AS o`, []]]);
  assert.deepEqual(seen[0][0], { p: 0, l: 0, o: 0 }, "a non-admin reads none of the three tables");
  assert.equal((await asApp(U.boss, [[`SELECT count(*)::int AS p FROM refinery_access_policy`, []]]))[0][0].p, 1, "an admin reads the policy row");
  assert.match((await err(() => asApp(U.nobody, [[`INSERT INTO refinery_seat_legacy (user_id) VALUES ($1)`, [U.nobody]]]))) ?? "", /row-level security/, "no self-grandfathering");
  assert.equal((await asApp(U.nobody, [[`UPDATE refinery_access_policy SET public_signup_open = false WHERE id RETURNING id`, []]]))[0].length, 0, "a non-admin cannot flip");
  assert.match((await err(() => asApp(U.boss, [[`DELETE FROM refinery_access_policy`, []]]))) ?? "", /permission denied/, "nobody deletes the policy row");

  // ---- grandfather once (the exact statements the admin action sends) ----
  const close = async () => (await asApp(U.boss, [[CLOSE_STATEMENTS.lock, []], [CLOSE_STATEMENTS.snapshot, []], [CLOSE_STATEMENTS.flip, [U.boss]]]))[2].length;
  assert.equal(await close(), 1, "the first close flips");
  assert.equal(await seat(U.nobody), true, "an account from before the close is grandfathered");
  assert.equal(await close(), 0, "a second close changes nothing");
  await q(`INSERT INTO users(id, email, name) VALUES ($1, 'late@x.test', 'x') ON CONFLICT DO NOTHING`, [id(20)]);
  await asApp(U.boss, [[`UPDATE refinery_access_policy SET public_signup_open = true WHERE id`, []]]);
  await q(`INSERT INTO users(id, email, name) VALUES ($1, 'late2@x.test', 'x')`, [id(21)]);
  assert.equal(await close(), 1, "open then close again flips");
  assert.equal(await seat(id(20)), false, "made while closed: not grandfathered");
  assert.equal(await seat(id(21)), false, "made while open again: not grandfathered");
  assert.equal((await asApp(U.nobody, [[`SELECT smr_refinery_signup_open() AS o`, []]]))[0][0].o, false);
  const removed = await asApp(U.boss, [[`DELETE FROM refinery_seat_legacy WHERE user_id = $1 RETURNING user_id`, [U.nobody]]]);
  assert.equal(removed[0].length, 1, "an admin can take a row off");
  assert.equal(await seat(U.nobody), false);
  assert.equal((await asApp(U.member, [[`DELETE FROM refinery_seat_legacy RETURNING user_id`, []]]))[0].length, 0, "nobody else can");

  // ---- offers ---- (clear the grandfather list so "an offer is not a seat" means something)
  await q(`DELETE FROM refinery_seat_legacy`);
  const offer = async (u: string) => (await asApp(U.owner, [[OFFER_INSERT_SQL, [org, u, U.owner, 24]]], org))[0].length;
  assert.equal(await offer(U.asked), 1, "an offer is written");
  assert.equal(await offer(U.asked), 0, "not twice while open");
  const t0 = Number((await one(`SELECT times_redeemed AS t FROM access_code WHERE id = $1`, [org]))!.t);
  assert.equal(await seat(U.asked), false, "an offer is not a seat");
  const offerId = (await asApp(U.asked, [[`SELECT id FROM org_seat_offer WHERE user_id = $1 AND status = 'pending'`, [U.asked]]]))[0][0].id;
  assert.equal((await asApp(U.other, [[`SELECT smr_accept_seat_offer($1::uuid, $2::uuid) AS o`, [U.other, offerId]]]))[0][0].o, "not_found", "another account cannot accept");
  assert.equal((await asApp(U.asked, [[`SELECT smr_accept_seat_offer($1::uuid, $2::uuid) AS o`, [U.asked, offerId]]]))[0][0].o, "ok");
  assert.equal(Number((await one(`SELECT times_redeemed AS t FROM access_code WHERE id = $1`, [org]))!.t), t0 + 1, "the seat is spent on yes");
  assert.equal(await seat(U.asked), true);
  assert.equal(await offer(U.asked), 0, "answered in the last day: no new offer");
  // already_member before other_org (review 2, N-12)
  await q(`UPDATE org_seat_offer SET created_at = now() - interval '2 days', decided_at = now() - interval '2 days' WHERE user_id = $1`, [U.asked]);
  await q(`SELECT smr_redeem_code($1::uuid, 'PGOTHER01')`, [U.asked]);
  assert.equal(await offer(U.asked), 1, "after the window, a new offer can be made");
  const second = (await asApp(U.asked, [[`SELECT id FROM org_seat_offer WHERE user_id = $1 AND status = 'pending'`, [U.asked]]]))[0][0].id;
  assert.equal((await asApp(U.asked, [[`SELECT smr_accept_seat_offer($1::uuid, $2::uuid) AS o`, [U.asked, second]]]))[0][0].o, "already_member");
  // other_org (review 1, N-4)
  await q(`SELECT smr_redeem_code($1::uuid, 'PGOTHER01')`, [U.other]);
  assert.equal(await offer(U.other), 1);
  const oId = (await asApp(U.other, [[`SELECT id FROM org_seat_offer WHERE user_id = $1 AND status = 'pending'`, [U.other]]]))[0][0].id;
  assert.equal((await asApp(U.other, [[`SELECT smr_accept_seat_offer($1::uuid, $2::uuid) AS o`, [U.other, oId]]]))[0][0].o, "other_org");
  // withdraw: only in the org's scope, only its own offer
  assert.match((await err(() => asApp(U.owner, [[`SELECT smr_withdraw_seat_offer($1::uuid) AS o`, [U.other]]]))) ?? "", /organization scope/);
  assert.equal((await asApp(U.owner, [[`SELECT smr_withdraw_seat_offer($1::uuid) AS o`, [U.other]]], otherOrg))[0][0].o, "not_found", "another org cannot withdraw it");
  assert.equal((await asApp(U.owner, [[`SELECT smr_withdraw_seat_offer($1::uuid) AS o`, [U.other]]], org))[0][0].o, "ok");
  assert.equal((await one(`SELECT status FROM org_seat_offer WHERE id = $1`, [oId]))!.status, "withdrawn");
  // decline spends nothing
  assert.equal(await offer(U.late), 1);
  const dId = (await asApp(U.late, [[`SELECT id FROM org_seat_offer WHERE user_id = $1 AND status = 'pending'`, [U.late]]]))[0][0].id;
  const t1 = Number((await one(`SELECT times_redeemed AS t FROM access_code WHERE id = $1`, [org]))!.t);
  assert.equal((await asApp(U.late, [[`SELECT smr_decline_seat_offer($1::uuid, $2::uuid) AS o`, [U.late, dId]]]))[0][0].o, "ok");
  assert.equal(Number((await one(`SELECT times_redeemed AS t FROM access_code WHERE id = $1`, [org]))!.t), t1);
  // The app role cannot insert a membership or an offer for another org directly.
  assert.match((await err(() => asApp(U.owner, [[`INSERT INTO access_code_redemption (user_id, access_code_id) VALUES ($1, $2)`, [U.late, org]]], org))) ?? "", /permission denied/);
  assert.equal((await err(() => asApp(U.owner, [[OFFER_INSERT_SQL, [otherOrg, U.late, U.owner, 24]]], org))) !== null, true, "an offer for another org is refused by the insert policy");
});
