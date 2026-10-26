/**
 * Real SQL for customization (migration 104, house build L4): migrations
 * 001-099 in pglite, then the REAL 100-103 (smr_staff_reach, org_activity,
 * org_activity_write; org units, unit staff, enrollments), then 104 itself,
 * all as a
 * NOSUPERUSER app role with RLS on. Proves: fields are org-scoped and written
 * only by managers; values obey reach for reads AND writes (a staff member
 * who is not assigned sees and writes nothing, even writing SQL directly);
 * values are shape-checked by type; key and type are fixed; choices are
 * retired, never removed; a retired field takes no new values but keeps its
 * old ones; personal views are private, shared ones are managers' only;
 * layouts are managers' only; every change lands in the activity log without
 * a value or a typed name; 104 runs twice without harm; the app's
 * unit-reach predicate (L3a's, imported) agrees with the real 103 tables.
 * Skipped unless SMR_PGLITE_DIR points at a node_modules folder holding
 * @electric-sql/pglite (SMR_PGLITE_DIR=/tmp/smr-idea-sql/node_modules).
 * Run it alone (several pglite files in one process are flaky).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { reachSql } from "@crucible/core/src/customFields";

const dir = process.env.SMR_PGLITE_DIR;
const skip = !dir || !existsSync(join(dir, "@electric-sql/pglite")) ? "set SMR_PGLITE_DIR to run the pglite customization test" : false;
const MIG = new URL("../../../../packages/core/migrations/", import.meta.url).pathname;


test("104: fields, values under reach, views and layouts, as database facts", { skip }, async () => {
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
  const m104 = readFileSync(MIG + "104_custom_fields_views.sql", "utf8");
  assert.match(m104.split("\n")[0], /^-- 104_custom_fields_views\.sql$/, "header line names the file");

  // Without 102's reach function, 104 refuses rather than create an unguarded table.
  await assert.rejects(db.exec("BEGIN;" + m104 + ";COMMIT;"), /needs migration 102/);
  await db.exec("ROLLBACK").catch(() => {});
  assert.equal(((await db.query(`SELECT to_regclass('public.custom_field_value') AS t`)).rows[0] as { t: string | null }).t, null);

  // The real 100-103 (house/integration), in order; each must apply.
  for (const f of readdirSync(MIG).filter((x) => /^\d{3}_.*\.sql$/.test(x) && Number(x.slice(0, 3)) >= 100 && Number(x.slice(0, 3)) <= 103).sort()) {
    await db.exec(`BEGIN; INSERT INTO _migrations(filename) VALUES ('${f}') ON CONFLICT DO NOTHING;` + readFileSync(MIG + f, "utf8") + ";COMMIT;");
  }
  await db.exec("BEGIN;" + m104 + ";COMMIT;");
  await db.exec("BEGIN;" + m104 + ";COMMIT;"); // idempotent: a second run changes nothing and does not fail

  const priv = async (t: string, p: string) => ((await db.query(`SELECT has_table_privilege('smr_app', $1, $2) AS ok`, [t, p])).rows[0] as { ok: boolean }).ok;
  assert.equal(await priv("custom_field_def", "DELETE"), false, "a field is retired, never deleted");
  assert.equal(await priv("custom_field_value", "DELETE"), true, "clearing a value deletes its row (the activity log keeps that it happened)");

  // A FRESH database: the app role made after the migrations (rls-stage1) gets
  // 104's grants from restricted-grants.mjs: no DELETE on field definitions,
  // EXECUTE on the manager check the policies call, never the activity writers.
  const grantsLib = await import(new URL("../../../../scripts/lib/restricted-grants.mjs", import.meta.url).href);
  await db.exec(`CREATE ROLE fresh_app NOSUPERUSER NOBYPASSRLS; GRANT USAGE ON SCHEMA public TO fresh_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO fresh_app;`);
  const runText = async (t: string) => (await db.query(t)).rows as Record<string, unknown>[];
  await grantsLib.applyRestrictedGrants(runText, "fresh_app");
  const fresh = ((await grantsLib.checkRestrictedGrants(runText, "fresh_app")) as string[]).filter((x) => /custom_field|smr_org_manager|smr_org_staff_session|customization|keep_version/.test(x));
  assert.deepEqual(fresh, [], "a fresh app role ends up with exactly the 104 grants");
  assert.equal(((await db.query(`SELECT has_function_privilege('fresh_app', 'public.smr_org_manager(uuid)', 'EXECUTE') AS ok`)).rows[0] as { ok: boolean }).ok, true);
  assert.equal(((await db.query(`SELECT has_table_privilege('fresh_app', 'custom_field_def', 'DELETE') AS ok`)).rows[0] as { ok: boolean }).ok, false);
  assert.equal(((await db.query(`SELECT has_function_privilege('fresh_app', 'public.smr_org_staff_session(uuid)', 'EXECUTE') AS ok`)).rows[0] as { ok: boolean }).ok, true);
  for (const p of ["INSERT", "UPDATE", "DELETE"]) {
    assert.equal(((await db.query(`SELECT has_table_privilege('fresh_app', 'custom_field_value_version', $1) AS ok`, [p])).rows[0] as { ok: boolean }).ok, false, `fresh app role: no ${p} on value history`);
  }

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
  const [owner, admin, s1, s2, p1, p2, ownerB, pB, platform] = [1, 2, 3, 4, 5, 6, 7, 8, 9].map(id);
  for (const u of [owner, admin, s1, s2, p1, p2, ownerB, pB, platform]) await q(`INSERT INTO users(id, email, name) VALUES ($1, $2, $3)`, [u, `${u}@example.invalid`, `Fixture ${u.slice(-2)}`]);
  const org = ((await q(`INSERT INTO access_code (code, partner_name, tier, partner_user_id, crm_v2) VALUES ('PGCF01', 'Riverside Works (Demo)', 'client', $1, true) RETURNING id`, [owner])).rows[0] as { id: string }).id;
  const orgB = ((await q(`INSERT INTO access_code (code, partner_name, tier, partner_user_id) VALUES ('PGCF02', 'Other Org (Demo)', 'client', $1) RETURNING id`, [ownerB])).rows[0] as { id: string }).id;
  await q(`INSERT INTO org_staff (access_code_id, user_id, role) VALUES ($1, $2, 'org_admin'), ($1, $3, 'staff'), ($1, $4, 'staff')`, [org, admin, s1, s2]);
  await q(`INSERT INTO access_code_redemption (user_id, access_code_id) VALUES ($1, $3), ($2, $3), ($4, $5)`, [p1, p2, org, pB, orgB]);
  await q(`INSERT INTO client_staff_assignment (access_code_id, client_user_id, staff_user_id, assigned_by) VALUES ($1, $2, $3, $4)`, [org, p1, s1, owner]);
  await q(`INSERT INTO platform_admin (user_id) VALUES ($1)`, [platform]).catch(async () => q(`INSERT INTO platform_admin (user_id, note) VALUES ($1, 'test')`, [platform]));

  // 103: a site with a program under it (people enroll in programs).
  const site = ((await q(`INSERT INTO org_unit (access_code_id, kind, name) VALUES ($1, 'site', 'North site') RETURNING id`, [org])).rows[0] as { id: string }).id;
  const prog = ((await q(`INSERT INTO org_unit (access_code_id, parent_id, kind, name) VALUES ($1, $2, 'program', 'Job readiness') RETURNING id`, [org, site])).rows[0] as { id: string }).id;
  const A = (u: string) => ({ orgId: org, userId: u });
  const mkDef = (who: { orgId: string; userId: string }, key: string, type: string, extra: { options?: unknown; sensitive?: boolean; entity?: string; label?: string } = {}) =>
    as(who, `INSERT INTO custom_field_def (access_code_id, entity, key, label, type, options, sensitive) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7) RETURNING id, created_by`,
      [who.orgId, extra.entity ?? "participant", key, extra.label ?? key, type, JSON.stringify(extra.options ?? []), !!extra.sensitive]);

  // ---- definitions: managers write, the org reads ---------------------------
  assert.ok(await refused(mkDef(A(s1), "x_staff", "text")), "staff cannot add a field");
  assert.ok(await refused(mkDef({ orgId: org, userId: ownerB }, "x_foreign", "text")), "another org's owner, with this org in scope, cannot");
  assert.ok(await refused(mkDef({ orgId: org, userId: platform }, "x_platform", "text")), "a platform admin acting on the org cannot");
  const [housing] = await mkDef(A(owner), "housing", "single_select", { options: [{ id: "stable", label: "Stable" }, { id: "shelter", label: "Shelter" }] });
  assert.equal(housing.created_by, owner, "created_by comes from the session, not the caller");
  const [hours] = await mkDef(A(admin), "hours", "number");
  const [po] = await mkDef(A(owner), "po_name", "text", { sensitive: true, label: "Parole officer" });
  const [start] = await mkDef(A(owner), "start", "date");
  const [link] = await mkDef(A(owner), "link", "url");
  const [cm] = await mkDef(A(owner), "cm", "staff_member");
  const [skills] = await mkDef(A(owner), "skills", "multi_select", { options: [{ id: "fork", label: "Forklift" }, { id: "cook", label: "Cooking" }] });
  const [cohortNote] = await mkDef(A(owner), "cohort_note", "text", { entity: "enrollment" });
  assert.ok(await refused(mkDef(A(owner), "bad_select", "single_select")), "a choice field needs choices");
  assert.ok(await refused(mkDef(A(owner), "bad_opts", "text", { options: [{ id: "a", label: "A" }] })), "only choice fields have choices");
  assert.ok(await refused(mkDef(A(owner), "Bad Key", "text")), "keys are slugs");
  assert.equal((await as(A(s2), `SELECT key FROM custom_field_def ORDER BY key`)).length, 8, "staff read every definition of their org");
  assert.equal((await as({ orgId: orgB, userId: ownerB }, `SELECT key FROM custom_field_def`)).length, 0, "another org reads none");
  assert.equal((await as({ userId: p1 }, `SELECT key FROM custom_field_def`)).length, 0, "a participant reads none");

  assert.match(await err(as(A(owner), `UPDATE custom_field_def SET type = 'text' WHERE id = $1`, [hours.id])), /keeps its organization, record, key and type/);
  assert.match(await err(as(A(owner), `UPDATE custom_field_def SET key = 'other' WHERE id = $1`, [hours.id])), /keeps its organization/);
  assert.match(await err(as(A(owner), `UPDATE custom_field_def SET options = '[{"id":"stable","label":"Stable"}]' WHERE id = $1`, [housing.id])), /retired, not removed/);
  assert.equal((await as(A(owner), `UPDATE custom_field_def SET label = 'Housing now', options = '[{"id":"stable","label":"Stable housing"},{"id":"shelter","label":"Shelter","retired":true}]' WHERE id = $1 RETURNING label`, [housing.id])).length, 1, "rename and retire a choice");
  assert.ok(await refused(as(A(s1), `UPDATE custom_field_def SET label = 'Mine' WHERE id = $1 RETURNING id`, [hours.id])), "staff cannot rename");
  assert.match(await err(as(A(owner), `DELETE FROM custom_field_def WHERE id = $1`, [hours.id])), /permission denied/);
  // Sensitive is one way: never quietly lowered, even by the owner writing SQL.
  assert.match(await err(as(A(owner), `UPDATE custom_field_def SET sensitive = false WHERE id = $1`, [po.id])), /stays sensitive/);
  assert.equal((await as(A(owner), `UPDATE custom_field_def SET sensitive = true WHERE id = $1 RETURNING id`, [start.id])).length, 1, "raising it is fine");
  // A participant's session that somehow carries the org scope reads no field names.
  assert.equal((await as({ orgId: org, userId: p1 }, `SELECT key FROM custom_field_def`)).length, 0, "a participant session with the org scope reads no definitions");

  // ---- values: reach, for reads AND writes -----------------------------------
  const setVal = (who: { orgId: string; userId: string }, defId: string, entityId: string, value: unknown, claimedPerson = entityId) =>
    as(who, `INSERT INTO custom_field_value (def_id, entity_id, access_code_id, participant_user_id, value) VALUES ($1, $2, $3, $4, $5::jsonb)
             ON CONFLICT (def_id, entity_id) DO UPDATE SET value = EXCLUDED.value RETURNING participant_user_id, updated_by`,
      [defId, entityId, who.orgId, claimedPerson, JSON.stringify(value)]);
  const [v1] = await setVal(A(s1), housing.id as string, p1, "stable");
  assert.deepEqual([v1.participant_user_id, v1.updated_by], [p1, s1], "the assigned case manager fills in a value; who and whom come from the database");
  assert.ok(await refused(setVal(A(s2), hours.id as string, p1, 40)), "a colleague not assigned to them cannot write one");
  assert.equal((await as(A(s2), `SELECT * FROM custom_field_value`)).length, 0, "nor read one");
  assert.ok(await refused(as(A(s2), `UPDATE custom_field_value SET value = '"shelter"' RETURNING 1`)), "nor change one");
  assert.ok(await refused(as(A(s2), `DELETE FROM custom_field_value RETURNING 1`)), "nor clear one");
  assert.equal((await as(A(s1), `SELECT value FROM custom_field_value WHERE entity_id = $1`, [p1])).length, 1, "the assigned case manager reads it");
  assert.equal((await as(A(owner), `SELECT value FROM custom_field_value`)).length, 1, "the owner reads it");
  assert.equal((await as(A(admin), `SELECT value FROM custom_field_value`)).length, 1, "an org admin reads it");
  assert.equal((await as({ orgId: orgB, userId: ownerB }, `SELECT value FROM custom_field_value`)).length, 0, "another org reads nothing");
  assert.equal((await as({ userId: p1 }, `SELECT value FROM custom_field_value`)).length, 0, "the participant does not see org records here");
  assert.ok(await refused(setVal(A(owner), hours.id as string, pB, 10)), "a value about someone in another org is refused");
  assert.ok(await refused(setVal({ orgId: orgB, userId: ownerB }, hours.id as string, pB, 10)), "another org cannot use this org's field");
  // The claimed participant is ignored: the trigger sets it from the record.
  const [lie] = await setVal(A(owner), hours.id as string, p2, 12, p1);
  assert.equal(lie.participant_user_id, p2, "a caller cannot point the reach column at someone else");
  assert.ok(await refused(setVal(A(s1), hours.id as string, p2, 12)), "and s1, assigned to p1 only, cannot write p2's value by claiming p1");

  // ---- values: shape by type --------------------------------------------------
  const shape = async (defId: unknown, value: unknown) => err(setVal(A(owner), defId as string, p1, value));
  assert.match(await shape(hours.id, "forty"), /expected a number/);
  assert.equal(await shape(hours.id, 40), "");
  assert.match(await shape(start.id, "2026-13-40"), /date|out of range/i);
  assert.equal(await shape(start.id, "2026-10-29"), "");
  assert.match(await shape(link.id, "javascript:alert(1)"), /web address/);
  assert.equal(await shape(link.id, "https://example.org/p"), "");
  assert.match(await shape(housing.id, "mansion"), /choices/);
  assert.equal(await shape(housing.id, "shelter"), "", "a retired choice is still a choice to the database (the app offers only live ones)");
  assert.match(await shape(skills.id, ["fork", "fork"]), /each choice once/);
  assert.match(await shape(skills.id, ["fly"]), /only the field's choices/);
  assert.equal(await shape(skills.id, ["fork", "cook"]), "");
  assert.match(await shape(cm.id, ownerB), /on this organization's staff/, "a staff_member field cannot name another org's person");
  assert.equal(await shape(cm.id, s2), "");
  assert.match(await shape(po.id, 7), /short text/);
  assert.equal(await shape(po.id, "Officer Example"), "");

  // ---- retire: old values stay and read; new ones refused ---------------------
  await as(A(owner), `UPDATE custom_field_def SET retired_at = now() WHERE id = $1`, [hours.id]);
  assert.match(await shape(hours.id, 41), /retired/);
  assert.equal((await as(A(owner), `SELECT value FROM custom_field_value WHERE def_id = $1`, [hours.id])).length, 2, "retired values are still there");

  // ---- value history: overwriting or clearing keeps the earlier answer --------
  // s1 set "stable", the owner changed it to "shelter" (shape checks above), now s1 sets "stable" again.
  await setVal(A(s1), housing.id as string, p1, "stable");
  await as(A(owner), `DELETE FROM custom_field_value WHERE def_id = $1 AND entity_id = $2`, [link.id, p1]); // cleared
  const hist = await as(A(owner), `SELECT def_id, value, change, set_by, replaced_by FROM custom_field_value_version WHERE participant_user_id = $1 ORDER BY id`, [p1]);
  const hHousing = hist.filter((h) => h.def_id === housing.id);
  assert.ok(hHousing.some((h) => h.value === "stable" && h.change === "changed" && h.set_by === s1 && h.replaced_by === owner), JSON.stringify(hHousing));
  assert.ok(hHousing.some((h) => h.value === "shelter" && h.change === "changed" && h.set_by === owner && h.replaced_by === s1), "who set it and who replaced it, both kept");
  assert.ok(hist.some((h) => h.def_id === link.id && h.value === "https://example.org/p" && h.change === "cleared" && h.replaced_by === owner), "a cleared value is kept");
  const nHist = hist.length;
  await setVal(A(s1), housing.id as string, p1, "stable"); // same value again: not a change
  assert.equal((await as(A(owner), `SELECT id FROM custom_field_value_version WHERE participant_user_id = $1`, [p1])).length, nHist, "writing the same value keeps no copy");
  assert.equal((await as(A(s1), `SELECT id FROM custom_field_value_version WHERE participant_user_id = $1`, [p1])).length, nHist, "the assigned case manager reads the history");
  assert.equal((await as(A(s2), `SELECT id FROM custom_field_value_version`)).length, 0, "a colleague who does not reach them reads none of it");
  assert.equal((await as({ orgId: orgB, userId: ownerB }, `SELECT id FROM custom_field_value_version`)).length, 0, "another org reads none");
  assert.equal((await as({ userId: p1 }, `SELECT id FROM custom_field_value_version`)).length, 0, "the participant reads none");
  assert.match(await err(as(A(owner), `INSERT INTO custom_field_value_version (def_id, entity_id, access_code_id, participant_user_id, value, change) VALUES ($1, $2, $3, $2, '"x"', 'changed')`, [housing.id, p1, org])), /permission denied/, "history cannot be forged");
  assert.match(await err(as(A(owner), `DELETE FROM custom_field_value_version`)), /permission denied/, "or erased");
  assert.match(await err(as(A(owner), `UPDATE custom_field_value_version SET value = '"x"'`)), /permission denied/, "or edited");

  // ---- enrollment values: the person behind the enrollment decides reach ------
  const enr = ((await q(`INSERT INTO enrollment (access_code_id, org_unit_id, participant_user_id) VALUES ($1, $2, $3) RETURNING id`, [org, prog, p1])).rows[0] as { id: string }).id;
  const [ev] = await setVal(A(s1), cohortNote.id as string, enr, "spring cohort", s2);
  assert.equal(ev.participant_user_id, p1, "an enrollment value is about the enrolled person");
  assert.ok(await refused(setVal(A(s2), cohortNote.id as string, enr, "x")), "a colleague who cannot reach them cannot write it");
  assert.ok(await refused(setVal(A(s1), cohortNote.id as string, p1, "x")), "an enrollment field does not take a person id");
  assert.ok(await refused(setVal(A(s1), housing.id as string, enr, "stable")), "a participant field does not take an enrollment id");

  // ---- the app's second wall: reach through a unit, in app SQL (103 shape) -----
  // Site > Program; Cy (p2) enrolled in the program. Run as the table owner, so
  // this is the app predicate alone, not the policies.
  const enr2 = ((await q(`INSERT INTO enrollment (access_code_id, org_unit_id, participant_user_id, status) VALUES ($1, $2, $3, 'enrolled') RETURNING id`, [org, prog, p2])).rows[0] as { id: string }).id;
  const reaches = async (actor: string, units = true) => ((await q(`SELECT (${reachSql("$4::uuid", units)}) AS ok`, [org, false, actor, p2])).rows[0] as { ok: boolean }).ok;
  assert.equal(await reaches(s2), false, "nobody reaches through a unit they are not in");
  await q(`INSERT INTO unit_member (org_unit_id, user_id, access_code_id, role_in_unit) VALUES ($1, $2, $3, 'member')`, [prog, s2, org]);
  assert.equal(await reaches(s2), true, "a member of the person's program reaches them");
  assert.equal(await reaches(s2, false), false, "without 103's tables the predicate is assignment only");
  await q(`INSERT INTO unit_member (org_unit_id, user_id, access_code_id, role_in_unit) VALUES ($1, $2, $3, 'lead')`, [site, s1, org]);
  assert.equal(await reaches(s1), true, "a lead of the site reaches people in the programs below it");
  await q(`INSERT INTO unit_member (org_unit_id, user_id, access_code_id, role_in_unit) VALUES ($1, $2, $3, 'member')`, [site, admin, org]);
  assert.equal(await reaches(admin), false, "a member (not a lead) of the site does not reach the program below");
  await q(`UPDATE unit_member SET role_in_unit = 'viewer' WHERE org_unit_id = $1 AND user_id = $2`, [prog, s2]);
  assert.equal(await reaches(s2), false, "a viewer reaches nobody");
  await q(`UPDATE unit_member SET role_in_unit = 'member' WHERE org_unit_id = $1 AND user_id = $2`, [prog, s2]);
  await q(`INSERT INTO org_capability_override (org_id, user_id, capability, effect, set_by) VALUES ($1, $2, 'org.participant.invite', 'deny', 'test'), ($1, $2, 'org.outcome.write', 'deny', 'test')`, [org, s2]);
  assert.equal(await reaches(s2), false, "a volunteer never reaches through a unit");
  await q(`DELETE FROM org_capability_override WHERE org_id = $1 AND user_id = $2`, [org, s2]);
  await q(`UPDATE enrollment SET status = 'paused' WHERE id = $1`, [enr2]);
  assert.equal(await reaches(s2), true, "a paused enrollment in an active unit still does");
  await q(`UPDATE enrollment SET status = 'exited', exited_on = CURRENT_DATE, exit_reason = 'found_work' WHERE id = $1`, [enr2]);
  assert.equal(await reaches(s2), false, "an exited enrollment gives no reach");
  await q(`DELETE FROM unit_member WHERE access_code_id = $1`, [org]);

  // ---- activity: every change, never a value ----------------------------------
  const acts = (await q(`SELECT entity, action, summary, actor_user_id, participant_user_id FROM org_activity WHERE access_code_id = $1 ORDER BY id`, [org])).rows as Record<string, string>[];
  assert.ok(acts.some((a) => a.entity === "custom_field" && a.action === "created" && a.summary === "added a custom field"));
  assert.ok(acts.some((a) => a.summary === "filled in a custom field" && a.actor_user_id === s1 && a.participant_user_id === p1), "written through 102's writer with the real actor and person");
  assert.ok(acts.some((a) => a.summary === "added a sensitive custom field"));
  assert.ok(acts.some((a) => a.summary === "filled in a sensitive custom field"));
  assert.ok(acts.some((a) => a.summary === "retired a custom field" && a.action === "closed"));
  assert.ok(acts.some((a) => a.summary === "marked a custom field sensitive"), "raising sensitivity is on the record in fixed words");
  assert.ok(acts.some((a) => a.summary === "added a custom field for enrollments"));
  assert.ok(acts.some((a) => a.summary === "filled in a custom field on an enrollment" && a.participant_user_id === p1));
  const all = JSON.stringify(acts);
  for (const secret of ["Officer Example", "spring cohort", "2026-10-29", "example.org", "Parole", "housing", "Housing now", "hours", "cohort_note"]) {
    assert.doesNotMatch(all, new RegExp(secret, "i"), `no value or typed name in the log: ${secret}`);
  }
  const before = acts.length;
  await as(A(owner), `UPDATE custom_field_def SET position = 5 WHERE id = $1`, [link.id]);
  assert.equal(((await q(`SELECT count(*)::int AS n FROM org_activity WHERE access_code_id = $1`, [org])).rows[0] as { n: number }).n, before, "reordering alone is not news");
  assert.match(await err(as(A(owner), `INSERT INTO org_activity (access_code_id, entity, action, summary) VALUES ($1, 'org', 'created', 'forged')`, [org])), /permission denied|row-level/);

  // ---- saved views: personal is private; shared is managers' ------------------
  const mkView = (who: { orgId: string; userId: string }, ownerId: string | null, name: string, roleDefault: string | null = null) =>
    as(who, `INSERT INTO saved_view (access_code_id, owner_user_id, surface, name, definition, role_default) VALUES ($1, $2, 'caseload', $3, '{"filters":[]}', $4) RETURNING id`, [who.orgId, ownerId, name, roleDefault]);
  const [mine] = await mkView(A(s1), s1, "My quiet people");
  assert.ok(await refused(mkView(A(s1), s2, "For s2")), "nobody makes a view for someone else");
  assert.ok(await refused(mkView(A(s1), null, "Everyone's")), "staff cannot share a view with the org");
  assert.match(await err(mkView(A(s1), s1, "my quiet people ")), /duplicate key|unique/i, "one name per person per list");
  assert.match(await err(mkView(A(owner), owner, "Mine with default", "staff")), /check/i, "a personal view never carries a role default");
  const [shared] = await mkView(A(owner), null, "Interviewing this week", "staff");
  assert.deepEqual((await as(A(s2), `SELECT name FROM saved_view ORDER BY name`)).map((r) => r.name), ["Interviewing this week"], "s2 sees the shared view, not s1's personal one");
  assert.equal((await as({ orgId: org, userId: p1 }, `SELECT name FROM saved_view`)).length, 0, "a participant session with the org scope reads no view names");
  assert.ok(await refused(as(A(s2), `UPDATE saved_view SET name = 'mine now' WHERE id = $1 RETURNING id`, [mine.id])), "nor change it");
  assert.ok(await refused(as(A(s2), `DELETE FROM saved_view WHERE id = $1 RETURNING id`, [shared.id])), "staff cannot remove a shared view");
  assert.ok(await refused(as(A(s1), `UPDATE saved_view SET owner_user_id = NULL WHERE id = $1 RETURNING id`, [mine.id])), "staff cannot turn a personal view into a shared one");
  assert.equal((await as(A(s1), `DELETE FROM saved_view WHERE id = $1 RETURNING id`, [mine.id])).length, 1, "s1 removes their own");
  assert.equal((await as({ orgId: orgB, userId: ownerB }, `SELECT id FROM saved_view`)).length, 0, "another org sees none");
  const viewLog = ((await q(`SELECT summary FROM org_activity WHERE entity = 'view' ORDER BY id`)).rows as { summary: string }[]).map((r) => r.summary);
  assert.deepEqual(viewLog, ["added a shared view"], "only shared views are logged, and never by name");

  // ---- layouts: managers write, the org reads ---------------------------------
  const setLayout = (who: { orgId: string; userId: string }) =>
    as(who, `INSERT INTO org_role_layout (access_code_id, role, surface, layout) VALUES ($1, 'staff', 'today', '{"order":["quiet"],"hidden":["unassigned"]}')
             ON CONFLICT (access_code_id, role, surface) DO UPDATE SET layout = EXCLUDED.layout RETURNING role`, [who.orgId]);
  assert.ok(await refused(setLayout(A(s1))), "staff cannot set a role layout");
  assert.equal((await setLayout(A(owner))).length, 1, "the owner can");
  assert.equal((await as(A(s1), `SELECT layout FROM org_role_layout`)).length, 1, "staff read their org's layout");
  assert.equal((await as({ orgId: org, userId: p1 }, `SELECT layout FROM org_role_layout`)).length, 0, "a participant session with the org scope reads no layout");
  assert.ok(((await q(`SELECT summary FROM org_activity WHERE entity = 'org'`)).rows as { summary: string }[]).some((r) => r.summary === "changed the Today layout for staff"));
  assert.equal((await as({ orgId: orgB, userId: ownerB }, `SELECT layout FROM org_role_layout`)).length, 0, "another org reads none");

  // ---- deleting an organization takes everything with it, cleanly -------------
  // (the same order the isolation suite's cleanup uses: membership rows first)
  for (const t of ["client_staff_assignment", "access_code_redemption", "org_staff"]) await q(`DELETE FROM ${t} WHERE access_code_id = $1`, [org]);
  await q(`DELETE FROM access_code WHERE id = $1`, [org]);
  for (const t of ["custom_field_def", "custom_field_value", "custom_field_value_version", "saved_view", "org_role_layout"]) {
    assert.equal(((await q(`SELECT count(*)::int AS n FROM ${t}`)).rows[0] as { n: number }).n, 0, `${t} emptied by cascade`);
  }
});
