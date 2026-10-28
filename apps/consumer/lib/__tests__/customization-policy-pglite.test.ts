/**
 * Real SQL for staff build S3 (migration 108): migrations 001-099 in pglite,
 * the REAL 100-106, then 108 (twice), as a NOSUPERUSER app role with RLS on.
 * Proves: 108 refuses before 104; the policy is read by the organization's
 * staff and written only by its managers (owner AND org admin), never by
 * staff, another organization or a platform admin; switches are names and
 * yes/no only; the view change log is the person's own (not a colleague's,
 * not the owner's, not another organization's, not a participant's), written
 * only as yourself in your own organization, never erased or rewritten, and
 * marked undone once; an undo names only your own change; a fresh app role
 * gets exactly 108's grants; policy changes land in the activity log in
 * fixed words. Skipped unless SMR_PGLITE_DIR points at a node_modules folder
 * holding @electric-sql/pglite (SMR_PGLITE_DIR=/tmp/smr-idea-sql/node_modules).
 * Run it alone (several pglite files in one process are flaky).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { VIEW_UNDO_SQL } from "@crucible/core/src/viewActions";
import { CUSTOM_FIELD_BATCH_SQL } from "@crucible/core/src/customFields";

const dir = process.env.SMR_PGLITE_DIR;
const skip = !dir || !existsSync(join(dir, "@electric-sql/pglite")) ? "set SMR_PGLITE_DIR to run the pglite 108 test" : false;
const MIG = new URL("../../../../packages/core/migrations/", import.meta.url).pathname;

test("108: customization policy and view change log, as database facts", { skip }, async () => {
  const { PGlite } = await import(join(dir!, "@electric-sql/pglite/dist/index.js"));
  const { pgcrypto } = await import(join(dir!, "@electric-sql/pglite/dist/contrib/pgcrypto.js"));
  const db = new PGlite({ extensions: { pgcrypto } });
  await db.exec("CREATE TABLE IF NOT EXISTS _migrations(filename text PRIMARY KEY, applied_at timestamptz DEFAULT now())");
  await db.exec(`CREATE ROLE smr_app NOSUPERUSER NOBYPASSRLS; GRANT USAGE ON SCHEMA public TO smr_app;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO smr_app;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE ON SEQUENCES TO smr_app;`);
  for (const f of readdirSync(MIG).filter((x) => /^\d{3}_.*\.sql$/.test(x) && Number(x.slice(0, 3)) <= 99).sort()) {
    try { await db.exec(`BEGIN; INSERT INTO _migrations(filename) VALUES ('${f}') ON CONFLICT DO NOTHING;` + readFileSync(MIG + f, "utf8") + ";COMMIT;"); }
    catch { await db.exec("ROLLBACK").catch(() => {}); }
  }
  const m108 = readFileSync(MIG + "108_customization_policy.sql", "utf8");
  assert.match(m108.split("\n")[0], /^-- 108_customization_policy\.sql$/, "header line names the file");
  await assert.rejects(db.exec("BEGIN;" + m108 + ";COMMIT;"), /needs migration 104/);
  await db.exec("ROLLBACK").catch(() => {});

  for (const f of readdirSync(MIG).filter((x) => /^\d{3}_.*\.sql$/.test(x) && Number(x.slice(0, 3)) >= 100 && Number(x.slice(0, 3)) <= 106).sort()) {
    await db.exec(`BEGIN; INSERT INTO _migrations(filename) VALUES ('${f}') ON CONFLICT DO NOTHING;` + readFileSync(MIG + f, "utf8") + ";COMMIT;");
  }
  await db.exec("BEGIN;" + m108 + ";COMMIT;");
  await db.exec("BEGIN;" + m108 + ";COMMIT;"); // idempotent

  const priv = async (role: string, t: string, p: string) => ((await db.query(`SELECT has_table_privilege($1, $2, $3) AS ok`, [role, t, p])).rows[0] as { ok: boolean }).ok;
  assert.equal(await priv("smr_app", "view_change_log", "DELETE"), false);
  assert.equal(await priv("smr_app", "view_change_log", "SELECT"), true);

  // A fresh app role (rls-stage1 after the migrations) gets exactly 108's grants.
  const grantsLib = await import(new URL("../../../../scripts/lib/restricted-grants.mjs", import.meta.url).href);
  await db.exec(`CREATE ROLE fresh_app NOSUPERUSER NOBYPASSRLS; GRANT USAGE ON SCHEMA public TO fresh_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO fresh_app;`);
  const runText = async (t: string) => (await db.query(t)).rows as Record<string, unknown>[];
  await grantsLib.applyRestrictedGrants(runText, "fresh_app");
  const fresh = ((await grantsLib.checkRestrictedGrants(runText, "fresh_app")) as string[]).filter((x) => /view_change_log|customization_policy/.test(x));
  assert.deepEqual(fresh, [], "a fresh app role ends up with exactly the 108 grants");
  assert.equal(await priv("fresh_app", "view_change_log", "DELETE"), false);
  assert.equal(((await db.query(`SELECT has_column_privilege('fresh_app', 'view_change_log', 'summary', 'UPDATE') AS ok`)).rows[0] as { ok: boolean }).ok, false);
  assert.equal(((await db.query(`SELECT has_column_privilege('fresh_app', 'view_change_log', 'undone_at', 'UPDATE') AS ok`)).rows[0] as { ok: boolean }).ok, true);

  const q = (t: string, p: unknown[] = []) => db.query(t, p);
  const as = async (who: { orgId?: string; userId?: string }, text: string, params: unknown[] = []) => {
    await db.exec("BEGIN; SET LOCAL ROLE smr_app;");
    try {
      if (who.orgId) await db.query(`SELECT set_config('app.org_id', $1, true)`, [who.orgId]);
      if (who.userId) await db.query(`SELECT set_config('app.user_id', $1, true)`, [who.userId]);
      const r = await db.query(text, params);
      await db.exec("COMMIT");
      return r.rows as Record<string, unknown>[];
    } catch (e) { await db.exec("ROLLBACK"); throw e; }
  };
  const refused = async (p: Promise<unknown>) => { try { const r = await p; return Array.isArray(r) && r.length === 0; } catch { return true; } };
  const err = async (p: Promise<unknown>) => { try { await p; return ""; } catch (e) { return String((e as Error).message); } };

  const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  const [owner, admin, s1, s2, p1, ownerB, platform] = [1, 2, 3, 4, 5, 6, 7].map(id);
  for (const u of [owner, admin, s1, s2, p1, ownerB, platform]) await q(`INSERT INTO users(id, email, name) VALUES ($1, $2, $3)`, [u, `${u}@example.invalid`, `Fixture ${u.slice(-2)}`]);
  const org = ((await q(`INSERT INTO access_code (code, partner_name, tier, partner_user_id, crm_v2) VALUES ('PGCP01', 'Lakeshore Works (Demo)', 'client', $1, true) RETURNING id`, [owner])).rows[0] as { id: string }).id;
  const orgB = ((await q(`INSERT INTO access_code (code, partner_name, tier, partner_user_id) VALUES ('PGCP02', 'Other Org (Demo)', 'client', $1) RETURNING id`, [ownerB])).rows[0] as { id: string }).id;
  await q(`INSERT INTO org_staff (access_code_id, user_id, role) VALUES ($1, $2, 'org_admin'), ($1, $3, 'staff'), ($1, $4, 'staff')`, [org, admin, s1, s2]);
  await q(`INSERT INTO access_code_redemption (user_id, access_code_id) VALUES ($1, $2)`, [p1, org]);
  await q(`INSERT INTO platform_admin (user_id) VALUES ($1)`, [platform]).catch(async () => q(`INSERT INTO platform_admin (user_id, note) VALUES ($1, 'test')`, [platform]));
  const A = (u: string) => ({ orgId: org, userId: u });

  // ---- the policy -----------------------------------------------------------
  const setPolicy = (who: { orgId: string; userId: string }, role: string, surface: string, allowed: string) =>
    as(who, `INSERT INTO org_customization_policy (access_code_id, role, surface, allowed, updated_by) VALUES ($1, $2, $3, $4::jsonb, $5)
             ON CONFLICT (access_code_id, role, surface) DO UPDATE SET allowed = EXCLUDED.allowed RETURNING allowed`, [who.orgId, role, surface, allowed, who.userId]);
  assert.ok(await refused(setPolicy(A(s1), "staff", "today", `{"today_order": false}`)), "staff cannot set limits");
  assert.ok(await refused(setPolicy({ orgId: org, userId: ownerB }, "staff", "today", `{"today_order": false}`)), "another org's owner, forging this org's scope, cannot");
  assert.ok(await refused(setPolicy({ orgId: org, userId: platform }, "staff", "today", `{"today_order": false}`)), "a platform admin acting on the org cannot");
  assert.equal((await setPolicy(A(admin), "staff", "today", `{"today_order": false}`)).length, 1, "an org admin can (Troy 2026-10-27)");
  assert.equal((await setPolicy(A(owner), "staff", "people", `{"grid_edit": false}`)).length, 1, "the owner can");
  assert.match(await err(setPolicy(A(owner), "staff", "people", `{"grid_edit": "no"}`)), /name and yes or no/);
  assert.match(await err(setPolicy(A(owner), "owner", "people", `{}`)), /check constraint|violates/i, "the owner is never limited: no owner rows");
  assert.equal((await as(A(s2), `SELECT role FROM org_customization_policy`)).length, 2, "staff read their organization's limits");
  assert.equal((await as({ orgId: orgB, userId: ownerB }, `SELECT role FROM org_customization_policy`)).length, 0, "another org reads none");
  assert.equal((await as({ orgId: org, userId: p1 }, `SELECT role FROM org_customization_policy`)).length, 0, "a participant session with the org scope reads none");
  assert.ok(await refused(as(A(s1), `UPDATE org_customization_policy SET allowed = '{}'::jsonb RETURNING 1`)), "staff SQL cannot loosen it");
  assert.ok(await refused(as(A(s1), `DELETE FROM org_customization_policy RETURNING 1`)), "or remove it");
  const acts = await q(`SELECT summary FROM org_activity WHERE access_code_id = $1 AND entity = 'org' ORDER BY at`, [org]);
  assert.ok(acts.rows.some((r: unknown) => (r as { summary: string }).summary === "changed what staff can change for themselves on Today"), JSON.stringify(acts.rows));

  // ---- the log ----------------------------------------------------------------
  const logIt = (who: { orgId: string; userId: string }, user: string, extra = "") =>
    as(who, `INSERT INTO view_change_log (access_code_id, user_id, surface, action, target, summary, before, after, by_ai${extra ? ", undoes" : ""})
             VALUES ($1, $2, 'today', 'today_order', 'pref:todayOrder', 'Put "Your tasks" first on Today', 'null'::jsonb, '["tasks"]'::jsonb, true${extra ? ", $3" : ""}) RETURNING id, at`,
      extra ? [who.orgId, user, extra] : [who.orgId, user]);
  const [mine] = await logIt(A(s1), s1);
  assert.ok(mine.id, "a staff member logs their own change");
  assert.match(await err(logIt(A(s1), s2)), /written by the person|row-level security/, "never into a colleague's log");
  assert.match(await err(logIt({ orgId: orgB, userId: s1 }, s1)), /only staff of this organization|row-level security/, "never in an organization they are not staff of");
  assert.match(await err(logIt({ orgId: org, userId: p1 }, p1)), /only staff of this organization/, "a participant keeps no staff view log");
  assert.match(await err(logIt({ orgId: org, userId: platform }, platform)), /only staff of this organization/, "nor a platform admin acting on the org");
  assert.equal((await as(A(s1), `SELECT id FROM view_change_log`)).length, 1, "the person reads their own");
  assert.equal((await as(A(s2), `SELECT id FROM view_change_log`)).length, 0, "a colleague reads none");
  assert.equal((await as(A(owner), `SELECT id FROM view_change_log`)).length, 0, "the owner reads none");
  assert.equal((await as(A(admin), `SELECT id FROM view_change_log`)).length, 0, "an org admin reads none");
  assert.equal((await as({ orgId: orgB, userId: ownerB }, `SELECT id FROM view_change_log`)).length, 0, "another org reads none");
  assert.match(await err(as(A(s1), `DELETE FROM view_change_log`)), /permission denied/, "the app cannot erase it");
  assert.match(await err(as(A(s1), `UPDATE view_change_log SET summary = 'x'`)), /permission denied/, "or rewrite it");
  assert.ok(await refused(as(A(s2), `UPDATE view_change_log SET undone_at = now() RETURNING id`)), "a colleague cannot mark it undone");
  const [undo] = await logIt(A(s1), s1, String(mine.id));
  assert.ok(undo.id, "an undo names the change it undid");
  const [other] = await logIt(A(s2), s2);
  assert.match(await err(logIt(A(s1), s1, String(other.id))), /one of your own changes/, "an undo never names a colleague's change");
  assert.equal((await as(A(s1), `UPDATE view_change_log SET undone_at = now() WHERE id = $1 RETURNING undone_at`, [mine.id])).length, 1, "marked undone, once");
  assert.match(await err(as(A(s1), `UPDATE view_change_log SET undone_at = now() WHERE id = $1 RETURNING 1`, [mine.id])), /already undone|row-level security|^$/);
  assert.equal((await as(A(s1), `SELECT id FROM view_change_log WHERE id = $1 AND undone_at IS NOT NULL`, [mine.id])).length, 1);
  assert.match(await err(as(A(s1), `INSERT INTO view_change_log (access_code_id, user_id, surface, action, target, summary, undone_at) VALUES ($1, $2, 'today', 'x_y', 'pref:todayOrder', 'x', now()) RETURNING 1`, [org, s1])), /starts not undone|row-level security/);
  assert.match(await err(as(A(s1), `INSERT INTO view_change_log (access_code_id, user_id, surface, action, target, summary) VALUES ($1, $2, 'today', 'x_y', 'drop table', 'x') RETURNING 1`, [org, s1])), /check constraint/i, "targets are shaped");

  // ---- the app's undo statements: mark first, all or nothing, once ---------
  const [pc] = await logIt(A(s1), s1);
  const undoPrefs = (who: string) => as(A(who), VIEW_UNDO_SQL.prefs, [who, org, pc.id, JSON.stringify({ todayOrder: [] }), "today", "pref:todayOrder", "Undid: put it first", "[\"tasks\"]", "null", false]);
  assert.equal((await undoPrefs(s1)).length, 1, "the first undo marks, writes the prefs and logs");
  assert.equal((await undoPrefs(s1)).length, 0, "a second undo of the same change does nothing");
  assert.equal(((await q(`SELECT count(*)::int AS n FROM view_change_log WHERE undoes = $1`, [pc.id])).rows[0] as { n: number }).n, 1, "exactly one undo row");
  const [vw] = await as(A(s1), `INSERT INTO saved_view (access_code_id, owner_user_id, surface, name, definition) VALUES ($1, $2, 'caseload', 'Mine', '{}'::jsonb) RETURNING id`, [org, s1]);
  const [vc] = await as(A(s1), `INSERT INTO view_change_log (access_code_id, user_id, surface, action, target, summary, after) VALUES ($1, $2, 'views', 'view_saved', $3, 'Saved your view', '{}'::jsonb) RETURNING id`, [org, s1, `view:${vw.id}`]);
  assert.equal((await as(A(s1), VIEW_UNDO_SQL.removeCreated, [s1, org, vc.id, vw.id, "Undid: saved your view", "{}", false])).length, 1, "undoing a save removes the view, once");
  assert.equal((await as(A(s1), `SELECT id FROM saved_view WHERE id = $1`, [vw.id])).length, 0);
  // Undo of a removed view whose name is taken now: the whole statement fails, the mark rolls back.
  await as(A(s1), `INSERT INTO saved_view (access_code_id, owner_user_id, surface, name, definition) VALUES ($1, $2, 'caseload', 'Taken', '{}'::jsonb)`, [org, s1]);
  const [rc] = await as(A(s1), `INSERT INTO view_change_log (access_code_id, user_id, surface, action, target, summary, before) VALUES ($1, $2, 'views', 'view_removed', $3, 'Removed your view', '{"name":"Taken"}'::jsonb) RETURNING id`, [org, s1, `view:${id(99)}`]);
  assert.notEqual(await err(as(A(s1), VIEW_UNDO_SQL.restoreRemoved, [s1, org, rc.id, "Taken", "{}", 1, "Undid", JSON.stringify({ name: "Taken" }), false])), "");
  assert.equal((await as(A(s1), `SELECT id FROM view_change_log WHERE id = $1 AND undone_at IS NULL`, [rc.id])).length, 1, "a failed undo leaves the change not undone");
  assert.equal((await as(A(s2), VIEW_UNDO_SQL.prefs, [s2, org, rc.id, "{}", "today", "pref:todayOrder", "x", "null", "null", false])).length, 0, "a colleague's undo of my change does nothing");

  // ---- the grid's batch statements, under 104's reach policy --------------
  await q(`INSERT INTO client_staff_assignment (access_code_id, client_user_id, staff_user_id, assigned_by) VALUES ($1, $2, $3, $4)`, [org, p1, s1, owner]);
  const [hrs] = await as(A(owner), `INSERT INTO custom_field_def (access_code_id, entity, key, label, type) VALUES ($1, 'participant', 'hours', 'Hours', 'number') RETURNING id`, [org]);
  const [note] = await as(A(owner), `INSERT INTO custom_field_def (access_code_id, entity, key, label, type) VALUES ($1, 'participant', 'note', 'Note', 'text') RETURNING id`, [org]);
  await as(A(s1), CUSTOM_FIELD_BATCH_SQL.upsert, [org, [hrs.id, note.id], [p1, p1], ["20", JSON.stringify("Mornings")]]);
  assert.equal((await as(A(s1), `SELECT value FROM custom_field_value WHERE entity_id = $1 ORDER BY value::text`, [p1])).length, 2, "one statement writes many cells");
  assert.notEqual(await err(as(A(s1), CUSTOM_FIELD_BATCH_SQL.upsert, [org, [hrs.id, note.id], [p1, p1], ["21", "123"]])), "", "a bad value fails the whole statement (104's shape guard)");
  assert.equal(((await as(A(s1), `SELECT value FROM custom_field_value WHERE def_id = $1`, [hrs.id]))[0] as { value: number }).value, 20, "nothing changed");
  await q(`INSERT INTO users(id, email, name) VALUES ($1, $2, 'Fixture 08')`, [id(8), `${id(8)}@example.invalid`]);
  await q(`INSERT INTO org_staff (access_code_id, user_id, role) VALUES ($1, $2, 'staff')`, [org, id(8)]);
  assert.notEqual(await err(as(A(id(8)), CUSTOM_FIELD_BATCH_SQL.upsert, [org, [hrs.id], [p1], ["5"]])), "", "an unassigned colleague's batch is refused by the reach policy");
  await as(A(id(8)), CUSTOM_FIELD_BATCH_SQL.clear, [org, [hrs.id], [p1]]);
  assert.equal((await as(A(s1), `SELECT value FROM custom_field_value WHERE def_id = $1`, [hrs.id])).length, 1, "and cannot clear anything");
  await as(A(s1), CUSTOM_FIELD_BATCH_SQL.clear, [org, [hrs.id, note.id], [p1, p1]]);
  assert.equal((await as(A(s1), `SELECT value FROM custom_field_value WHERE entity_id = $1`, [p1])).length, 0, "one statement clears many cells");

  // Account deletion takes a person's log with it (by foreign key).
  await q(`DELETE FROM users WHERE id = $1`, [s2]);
  assert.equal(((await q(`SELECT count(*)::int AS n FROM view_change_log WHERE user_id = $1`, [s2])).rows[0] as { n: number }).n, 0);
});
