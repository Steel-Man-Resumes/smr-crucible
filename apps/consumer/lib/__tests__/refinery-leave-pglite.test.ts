/**
 * Real SQL for leaving (security review 2, BL-4): migrations 001-096 in
 * pglite, then smr_leave_org and smr_leave_all_orgs on a member who shared
 * with the organization and acknowledged its requirement. Leaving must revoke
 * the grants, cancel the pending requests and end the acknowledgements; the
 * returning-member path of smr_redeem_code (096) must not bring any of them
 * back, and must not spend a second seat. Skipped unless SMR_PGLITE_DIR points
 * at a node_modules folder holding @electric-sql/pglite
 * (SMR_PGLITE_DIR=/tmp/smr-idea-sql/node_modules).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const dir = process.env.SMR_PGLITE_DIR;
const skip = !dir || !existsSync(join(dir, "@electric-sql/pglite")) ? "set SMR_PGLITE_DIR to run the pglite leave test" : false;
const MIG = join(__dirname, "..", "..", "..", "..", "packages", "core", "migrations") + "/";

test("leaving revokes sharing, and coming back neither restores it nor spends a seat", { skip }, async () => {
  const { PGlite } = await import(join(dir!, "@electric-sql/pglite/dist/index.js"));
  const { pgcrypto } = await import(join(dir!, "@electric-sql/pglite/dist/contrib/pgcrypto.js"));
  const db = new PGlite({ extensions: { pgcrypto } });
  await db.exec("CREATE TABLE IF NOT EXISTS _migrations(filename text PRIMARY KEY, applied_at timestamptz DEFAULT now())");
  const failed: string[] = [];
  for (const f of readdirSync(MIG).filter((x) => /^\d{3}_.*\.sql$/.test(x) && Number(x.slice(0, 3)) <= 96).sort()) {
    try { await db.exec(`BEGIN; INSERT INTO _migrations(filename) VALUES ('${f}') ON CONFLICT DO NOTHING;` + readFileSync(MIG + f, "utf8") + ";COMMIT;"); }
    catch { await db.exec("ROLLBACK").catch(() => {}); failed.push(f); }
  }
  for (const must of ["048_membership_functions.sql", "051_sharing.sql", "054_required_sharing.sql", "096_refinery_access.sql"]) {
    assert.ok(!failed.includes(must), `${must} must apply; failed: ${failed.join(", ")}`);
  }
  const q = async <T = Record<string, unknown>>(t: string, p: unknown[] = []) => (await db.query(t, p)).rows as T[];
  const one = async <T = Record<string, unknown>>(t: string, p: unknown[] = []) => (await q<T>(t, p))[0];
  const id = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, "0")}`;
  const [owner, pat] = [id(1), id(2)];
  for (const u of [owner, pat]) await q(`INSERT INTO users(id, email, name) VALUES ($1, $2, 'x')`, [u, `${u}@x.test`]);
  const org = (await one<{ id: string }>(
    `INSERT INTO access_code (code, partner_name, tier, partner_user_id, crm_v2, max_redemptions, required_sharing_enabled)
     VALUES ('PGLEAVE01', 'PG leave', 'client', $1, true, 1, true) RETURNING id`, [owner]))!.id;
  const seats = async () => Number((await one<{ t: number }>(`SELECT times_redeemed AS t FROM access_code WHERE id = $1`, [org]))!.t);
  const live = async () => (await one<{ g: number; r: number; a: number }>(
    `SELECT (SELECT count(*)::int FROM sharing_grant WHERE user_id = $1 AND access_code_id = $2 AND revoked_at IS NULL) AS g,
            (SELECT count(*)::int FROM sharing_request WHERE user_id = $1 AND access_code_id = $2 AND status = 'pending') AS r,
            (SELECT count(*)::int FROM sharing_ack WHERE user_id = $1 AND access_code_id = $2 AND ended_at IS NULL) AS a`, [pat, org]))!;
  const share = async () => {
    await q(`INSERT INTO sharing_grant (user_id, access_code_id, scope, text_version) VALUES ($1, $2, 'applications', 'pg')`, [pat, org]);
    await q(`INSERT INTO sharing_request (access_code_id, user_id, scope, requested_by, reason) VALUES ($1, $2, 'resume', $3, 'please share')`, [org, pat, owner]);
    const pol = await one<{ id: string }>(`SELECT id FROM org_sharing_policy_version WHERE access_code_id = $1 AND retired_at IS NULL`, [org]);
    const polId = pol?.id ?? (await one<{ id: string }>(
      `INSERT INTO org_sharing_policy_version (access_code_id, version_no, scopes, audience, purpose, covers_existing, text_version)
       VALUES ($1, 1, ARRAY['applications'], 'assigned_staff', 'We follow up on applications.', false, 'pg') RETURNING id`, [org]))!.id;
    await q(`INSERT INTO sharing_ack (user_id, policy_version_id, access_code_id) VALUES ($1, $2, $3)`, [pat, polId, org]);
  };

  for (const leave of ["smr_leave_org($1::uuid, $2::uuid)", "smr_leave_all_orgs($1::uuid)"]) {
    assert.equal((await one<{ o: string }>(`SELECT smr_redeem_code($1::uuid, 'PGLEAVE01') AS o`, [pat]))!.o, "ok");
    await share();
    assert.deepEqual(await live(), { g: 1, r: 1, a: 1 }, "set up: shared, asked, acknowledged");
    const before = await seats();
    const left = await one<{ n: number }>(`SELECT ${leave} AS n`, leave.includes("$2") ? [pat, org] : [pat]);
    assert.equal(Number(left!.n), 1, `${leave} ended the membership`);
    assert.deepEqual(await live(), { g: 0, r: 0, a: 0 }, `${leave}: grants revoked, requests cancelled, acknowledgements ended`);
    const reason = await one<{ r: string }>(`SELECT revoked_reason AS r FROM sharing_grant WHERE user_id = $1 ORDER BY granted_at DESC LIMIT 1`, [pat]);
    assert.equal(reason!.r, "left_organization");
    // The pool is full (max 1, one used): coming back still works, spends nothing, restores nothing.
    assert.equal((await one<{ o: string }>(`SELECT smr_redeem_code($1::uuid, 'PGLEAVE01') AS o`, [pat]))!.o, "ok", `${leave}: the returning member gets back in`);
    assert.equal(await seats(), before, `${leave}: no second seat`);
    assert.deepEqual(await live(), { g: 0, r: 0, a: 0 }, `${leave}: rejoining brings nothing back`);
    assert.equal(Number((await one<{ n: number }>(`SELECT count(*)::int AS n FROM access_code_departure WHERE user_id = $1`, [pat]))!.n), 0, "the departure is used up");
    await q(`SELECT smr_leave_org($1::uuid, $2::uuid)`, [pat, org]); // reset for the next round
    await q(`SELECT smr_redeem_code($1::uuid, 'PGLEAVE01')`, [pat]);
    await q(`SELECT smr_leave_all_orgs($1::uuid)`, [pat]);
    await q(`DELETE FROM access_code_departure WHERE user_id = $1`, [pat]);
    await q(`UPDATE access_code SET times_redeemed = 0 WHERE id = $1`, [org]);
  }
  // A person who never belonged gets nothing from smr_leave_org, and no departure.
  assert.equal(Number((await one<{ n: number }>(`SELECT smr_leave_org($1::uuid, $2::uuid) AS n`, [owner, org]))!.n), 0);
  assert.equal(Number((await one<{ n: number }>(`SELECT count(*)::int AS n FROM access_code_departure WHERE user_id = $1`, [owner]))!.n), 0);
});
