/**
 * Real SQL for staff rewards (111) and directory contributions (112), staff
 * side build lane S6: migrations 001-099 in pglite, the real 100-106, then
 * 111 and 112 (each twice: idempotent), all exercised as a NOSUPERUSER app
 * role with RLS on. Proves: rewards are off until the person turns them on and
 * nobody else can; a good catch goes only between colleagues of one
 * organization, never about someone either of them cannot see, is read only
 * by the two of them, and is withdrawn (never edited or deleted) only by the
 * sender; milestones are written only by the database, from facts; the board
 * lists only givers who opted in; a recognition note reaches a report only
 * with the person's own yes; directory contributions are submitted only
 * through the intake function, never readable by staff except through the
 * read-back (which never returns the private note), decided only by the data
 * owner, a hearsay "call" is impossible, credit comes after approval and goes
 * on revert, and an approved call is recorded as an employer relationship
 * confirmation in the program's name; the listing nudge shows once a week.
 * Skipped unless SMR_PGLITE_DIR points at a node_modules folder holding
 * @electric-sql/pglite. Run it alone (several pglite files in one process are flaky).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const dir = process.env.SMR_PGLITE_DIR;
const skip = !dir || !existsSync(join(dir, "@electric-sql/pglite")) ? "set SMR_PGLITE_DIR to run the pglite staff rewards test" : false;
const MIG = new URL("../../../../packages/core/migrations/", import.meta.url).pathname;

test("111 and 112: rewards and directory contributions as database facts", { skip }, async () => {
  const { PGlite } = await import(join(dir!, "@electric-sql/pglite/dist/index.js"));
  const { pgcrypto } = await import(join(dir!, "@electric-sql/pglite/dist/contrib/pgcrypto.js"));
  const db = new PGlite({ extensions: { pgcrypto } });
  await db.exec("CREATE TABLE IF NOT EXISTS _migrations(filename text PRIMARY KEY, applied_at timestamptz DEFAULT now())");
  await db.exec(`CREATE ROLE smr_app NOSUPERUSER NOBYPASSRLS; GRANT USAGE ON SCHEMA public TO smr_app;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO smr_app;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE ON SEQUENCES TO smr_app;`);
  const failedEarly: string[] = [];
  for (const f of readdirSync(MIG).filter((x) => /^\d{3}_.*\.sql$/.test(x) && Number(x.slice(0, 3)) <= 99).sort()) {
    try { await db.exec(`BEGIN; INSERT INTO _migrations(filename) VALUES ('${f}') ON CONFLICT DO NOTHING;` + readFileSync(MIG + f, "utf8") + ";COMMIT;"); }
    catch { failedEarly.push(f); await db.exec("ROLLBACK").catch(() => {}); }
  }
  const m111 = readFileSync(MIG + "111_staff_rewards.sql", "utf8");
  const m112 = readFileSync(MIG + "112_directory_contributions.sql", "utf8");
  assert.match(m111.split("\n")[0], /^-- 111_staff_rewards\.sql$/, "header line names the file");
  assert.match(m112.split("\n")[0], /^-- 112_directory_contributions\.sql$/, "header line names the file");

  // Without 102 the rewards migration refuses rather than build an unguarded table.
  await assert.rejects(db.exec("BEGIN;" + m111 + ";COMMIT;"), /needs migration 102/);
  await db.exec("ROLLBACK").catch(() => {});
  // And 112 refuses without 111.
  await assert.rejects(db.exec("BEGIN;" + m112 + ";COMMIT;"), /needs migration 111/);
  await db.exec("ROLLBACK").catch(() => {});

  for (const f of readdirSync(MIG).filter((x) => /^\d{3}_.*\.sql$/.test(x) && Number(x.slice(0, 3)) >= 100 && Number(x.slice(0, 3)) <= 106).sort()) {
    await db.exec(`BEGIN; INSERT INTO _migrations(filename) VALUES ('${f}') ON CONFLICT DO NOTHING;` + readFileSync(MIG + f, "utf8") + ";COMMIT;");
  }
  await db.exec("BEGIN;" + m111 + ";COMMIT;");
  await db.exec("BEGIN;" + m111 + ";COMMIT;"); // idempotent
  await db.exec("BEGIN;" + m112 + ";COMMIT;");
  await db.exec("BEGIN;" + m112 + ";COMMIT;"); // idempotent

  const one = async <T,>(t: string, p: unknown[] = []) => ((await db.query(t, p)).rows[0] as T);
  const priv = async (t: string, p: string) => (await one<{ ok: boolean }>(`SELECT has_table_privilege('smr_app', $1, $2) AS ok`, [t, p])).ok;
  assert.equal(await priv("staff_milestone", "INSERT"), false, "the app never writes a milestone");
  assert.equal(await priv("staff_kudos", "DELETE"), false, "a good catch is withdrawn, never deleted");
  assert.equal(await priv("directory_contribution", "INSERT"), false, "contributions come in only through the intake function");
  assert.equal(await priv("directory_contribution", "UPDATE"), false, "and are decided only through the owner's function");
  assert.equal((await one<{ ok: boolean }>(`SELECT has_function_privilege('smr_app', 'public.staff_milestone_grant(uuid,uuid,text,uuid)', 'EXECUTE') AS ok`)).ok, false);

  // A fresh app role (rls-stage1) ends up with exactly these grants from restricted-grants.mjs.
  const grantsLib = await import(new URL("../../../../scripts/lib/restricted-grants.mjs", import.meta.url).href);
  await db.exec(`CREATE ROLE fresh_app NOSUPERUSER NOBYPASSRLS; GRANT USAGE ON SCHEMA public TO fresh_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO fresh_app;`);
  const runText = async (t: string) => (await db.query(t)).rows as Record<string, unknown>[];
  await grantsLib.applyRestrictedGrants(runText, "fresh_app");
  const fresh = ((await grantsLib.checkRestrictedGrants(runText, "fresh_app")) as string[])
    .filter((x) => /staff_rewards|staff_kudos|staff_milestone|staff_recognition|directory_contribution|staff_listing_nudge|contribution_call|my_directory/.test(x));
  assert.deepEqual(fresh, [], "a fresh app role ends up with exactly the 111 and 112 grants");
  for (const fn of ["staff_milestone_grant(uuid,uuid,text,uuid)", "staff_milestone_revoke(uuid,uuid,uuid)"]) {
    assert.equal((await one<{ ok: boolean }>(`SELECT has_function_privilege('fresh_app', 'public.${fn}', 'EXECUTE') AS ok`)).ok, false, `fresh app role cannot run ${fn}`);
  }
  assert.equal((await one<{ ok: boolean }>(`SELECT has_function_privilege('fresh_app', 'public.submit_directory_contribution(jsonb)', 'EXECUTE') AS ok`)).ok, true);

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
  const [owner, admin, s1, s2, s3, p1, p2, ownerB, staffB, pB, platform] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map(id);
  for (const u of [owner, admin, s1, s2, s3, p1, p2, ownerB, staffB, pB, platform]) await q(`INSERT INTO users(id, email, name) VALUES ($1, $2, $3)`, [u, `${u}@example.invalid`, `Alma${u.slice(-2)} Reyes`]);
  const org = ((await q(`INSERT INTO access_code (code, partner_name, tier, partner_user_id, crm_v2) VALUES ('PGSR01', 'Lakeshore Works (Demo)', 'client', $1, true) RETURNING id`, [owner])).rows[0] as { id: string }).id;
  const orgB = ((await q(`INSERT INTO access_code (code, partner_name, tier, partner_user_id) VALUES ('PGSR02', 'Other Org (Demo)', 'client', $1) RETURNING id`, [ownerB])).rows[0] as { id: string }).id;
  await q(`INSERT INTO org_staff (access_code_id, user_id, role) VALUES ($1, $2, 'org_admin'), ($1, $3, 'staff'), ($1, $4, 'staff'), ($1, $5, 'staff')`, [org, admin, s1, s2, s3]);
  await q(`INSERT INTO org_staff (access_code_id, user_id, role) VALUES ($1, $2, 'staff')`, [orgB, staffB]);
  await q(`INSERT INTO access_code_redemption (user_id, access_code_id) VALUES ($1, $3), ($2, $3), ($4, $5)`, [p1, p2, org, pB, orgB]);
  // s1 reaches p1 and p2 (assigned); s2 and s3 reach nobody; the owner and the admin reach everyone.
  await q(`INSERT INTO client_staff_assignment (access_code_id, client_user_id, staff_user_id, assigned_by) VALUES ($1, $2, $3, $4)`, [org, p1, s1, owner]);
  await q(`INSERT INTO client_staff_assignment (access_code_id, client_user_id, staff_user_id, assigned_by) VALUES ($1, $2, $3, $4)`, [org, p2, s1, owner]);
  await q(`INSERT INTO platform_admin (user_id) VALUES ($1)`, [platform]).catch(async () => q(`INSERT INTO platform_admin (user_id, note) VALUES ($1, 'test')`, [platform]));
  const A = (u: string) => ({ orgId: org, userId: u });

  // ---- the personal switch ---------------------------------------------------
  assert.equal((await as(A(s1), `SELECT rewards_on FROM staff_rewards_setting`)).length, 0, "no row means off");
  await as(A(s1), `INSERT INTO staff_rewards_setting (user_id, access_code_id, rewards_on) VALUES ($1, $2, true)`, [s1, org]);
  assert.match(await err(as(A(owner), `INSERT INTO staff_rewards_setting (user_id, access_code_id, rewards_on) VALUES ($1, $2, true)`, [s2, org])), /only you set your own rewards|row-level security/, "the owner cannot turn rewards on for someone");
  assert.equal((await as(A(owner), `SELECT * FROM staff_rewards_setting`)).length, 0, "and cannot read anyone's switch");
  assert.match(await err(as({ orgId: org, userId: staffB }, `INSERT INTO staff_rewards_setting (user_id, access_code_id, rewards_on) VALUES ($1, $2, true)`, [staffB, org])), /staff of this organization/, "not a member, not a setting");
  assert.equal((await as(A(s1), `UPDATE staff_rewards_setting SET board_ok = false WHERE user_id = $1 RETURNING board_ok`, [s1]))[0]?.board_ok, false, "your own choices change");
  await as(A(s1), `UPDATE staff_rewards_setting SET board_ok = true WHERE user_id = $1`, [s1]);

  // ---- good catches ----------------------------------------------------------
  const send = (from: string, to: string, extra: { kind?: string; work?: string | null; orgId?: string } = {}) =>
    as({ orgId: extra.orgId ?? org, userId: from }, `INSERT INTO staff_kudos (access_code_id, from_user_id, to_user_id, body, work_kind, work_id) VALUES ($1, $2, $3, 'Great catch on the bus pass deadline', $4, $5) RETURNING id, participant_user_id`,
      [extra.orgId ?? org, from, to, extra.kind ?? null, extra.work ?? null]);
  const [k1] = await send(s1, s2);
  assert.ok(k1?.id, "a staff member thanks a colleague");
  assert.match(await err(send(s1, s1)), /staff_kudos_not_self|check constraint/, "not themselves");
  assert.match(await err(send(s1, p1)), /between colleagues/, "never a participant");
  assert.match(await err(send(s1, staffB)), /between colleagues/, "never someone in another organization");
  assert.match(await err(send(s1, s2, { orgId: orgB })), /own organization|between colleagues|row-level/, "never with another organization's scope");
  assert.match(await err(as(A(s1), `INSERT INTO staff_kudos (access_code_id, from_user_id, to_user_id, body) VALUES ($1, $2, $3, 'Forged one')`, [org, s2, s3])), /sent by you|row-level/, "never in someone else's name");

  // Work about a participant: both must reach them; the participant is taken from the work, not the request.
  const task = ((await q(`INSERT INTO staff_task (access_code_id, client_user_id, owner_user_id, created_by, title) VALUES ($1, $2, $3, $3, 'Call about the class') RETURNING id`, [org, p2, s1])).rows[0] as { id: string }).id;
  assert.match(await err(send(s1, s3, { kind: "task", work: task })), /both can see/, "not about someone the receiver cannot see");
  assert.match(await err(send(s2, admin, { kind: "task", work: task })), /both can see|row-level/, "nor someone the sender cannot see");
  {
    // The admin reaches everyone; s1 reaches p1 by assignment.
    const t1 = ((await q(`INSERT INTO staff_task (access_code_id, client_user_id, owner_user_id, created_by, title) VALUES ($1, $2, $3, $3, 'Bus pass') RETURNING id`, [org, p1, s1])).rows[0] as { id: string }).id;
    const [k2] = await as(A(admin), `INSERT INTO staff_kudos (access_code_id, from_user_id, to_user_id, body, work_kind, work_id, participant_user_id) VALUES ($1, $2, $3, 'You kept the bus pass on track', 'task', $4, $5) RETURNING id, participant_user_id`, [org, admin, s1, t1, p2]);
    assert.equal(k2.participant_user_id, p1, "the participant comes from the task, not the request");
    assert.equal((await as(A(s1), `SELECT id FROM staff_kudos WHERE id = $1`, [k2.id])).length, 1, "the receiver reads it");
    await q(`UPDATE client_staff_assignment SET staff_user_id = $1 WHERE client_user_id = $2 AND access_code_id = $3`, [s2, p1, org]);
    assert.equal((await as(A(s1), `SELECT id FROM staff_kudos WHERE id = $1`, [k2.id])).length, 0, "once the receiver no longer reaches the person, the good catch about them is hidden");
    await q(`UPDATE client_staff_assignment SET staff_user_id = $1 WHERE client_user_id = $2 AND access_code_id = $3`, [s1, p1, org]);
    assert.equal((await as(A(s1), `SELECT id FROM staff_kudos WHERE id = $1`, [k2.id])).length, 1, "and shows again when they do");
  }
  const otherTask = ((await q(`INSERT INTO staff_task (access_code_id, client_user_id, owner_user_id, created_by, title) VALUES ($1, $2, $3, $3, 'Theirs') RETURNING id`, [orgB, pB, staffB])).rows[0] as { id: string }).id;
  assert.match(await err(send(s1, s2, { kind: "task", work: otherTask })), /not in your organization/, "never another organization's work");

  assert.equal((await as(A(s2), `SELECT id FROM staff_kudos WHERE id = $1`, [k1.id])).length, 1, "the receiver reads it");
  assert.equal((await as(A(s3), `SELECT id FROM staff_kudos`)).length, 0, "a third colleague reads none");
  assert.equal((await as(A(owner), `SELECT id FROM staff_kudos`)).length, 0, "nor does the owner");
  assert.equal((await as({ orgId: orgB, userId: ownerB }, `SELECT id FROM staff_kudos`)).length, 0, "nor another organization");
  assert.match(await err(as(A(s1), `UPDATE staff_kudos SET body = 'changed' WHERE id = $1`, [k1.id])), /permission denied/, "never edited");
  assert.match(await err(as(A(s1), `DELETE FROM staff_kudos WHERE id = $1`, [k1.id])), /permission denied/, "never deleted");
  assert.ok(await refused(as(A(s2), `UPDATE staff_kudos SET withdrawn_at = now() WHERE id = $1 RETURNING id`, [k1.id])), "the receiver cannot withdraw it");

  // ---- milestones from facts ------------------------------------------------
  const earned = await as(A(s1), `SELECT public.staff_rewards_refresh() AS n`);
  assert.ok(Number(earned[0].n) >= 1, "refresh earns from facts");
  const keys = (await as(A(s1), `SELECT key FROM staff_milestone ORDER BY key`)).map((r) => r.key);
  assert.ok(keys.includes("first_kudos_given"), JSON.stringify(keys));
  assert.equal(Number((await as(A(s1), `SELECT public.staff_rewards_refresh() AS n`))[0].n), 0, "each milestone once");
  assert.equal((await as(A(s2), `SELECT key FROM staff_milestone`)).length, 0, "milestones are private");
  assert.match(await err(as(A(s1), `INSERT INTO staff_milestone (user_id, access_code_id, key) VALUES ($1, $2, 'directory_anchor')`, [s1, org])), /permission denied/, "never self-awarded");
  assert.match(await err(as(A(s1), `SELECT public.staff_milestone_grant($1, $2, 'directory_anchor', NULL)`, [s1, org])), /permission denied/, "not even through the writer");
  assert.equal((await as(A(s1), `UPDATE staff_milestone SET seen_at = now() WHERE key = 'first_kudos_given' RETURNING seen_at`)).length, 1, "marking one seen is fine");
  assert.match(await err(as(A(s1), `UPDATE staff_milestone SET key = 'directory_anchor'`)), /permission denied/);

  // ---- the board shows givers who opted in -----------------------------------
  await send(s2, s1);
  const board = await as(A(s3), `SELECT giver_id, giver_name, gave FROM public.staff_kudos_giver_board(30)`);
  assert.deepEqual(board.map((r) => r.giver_id), [s1], "only the giver who turned rewards on (s2 gave too, but did not opt in)");
  assert.equal((await as({ orgId: org, userId: staffB }, `SELECT * FROM public.staff_kudos_giver_board(30)`)).length, 0, "an outsider gets no board");
  await as(A(owner), `INSERT INTO staff_rewards_org (access_code_id, team_board_on) VALUES ($1, false)`, [org]);
  assert.equal((await as(A(s3), `SELECT * FROM public.staff_kudos_giver_board(30)`)).length, 0, "the program can turn the board off");
  assert.ok(await refused(as(A(s1), `UPDATE staff_rewards_org SET team_board_on = true RETURNING access_code_id`)), "staff cannot turn it back on");

  // ---- recognition notes need the person's yes --------------------------------
  const note = (who: string, about: string) => as(A(who), `INSERT INTO staff_recognition_note (access_code_id, about_user_id, written_by, body) VALUES ($1, $2, $3, 'Built the bus pass checklist the whole team uses now') RETURNING id, status`, [org, about, who]);
  assert.match(await err(note(s1, s2)), /owner or an org admin|row-level/, "staff cannot write one");
  const [rn] = await note(admin, s1);
  assert.equal(rn.status, "asked");
  assert.equal((await as(A(s2), `SELECT id FROM staff_recognition_note`)).length, 0, "a colleague cannot read it");
  assert.match(await err(as(A(admin), `UPDATE staff_recognition_note SET status = 'approved' WHERE id = $1`, [rn.id])), /only the person a note is about/, "the manager cannot say yes for them");
  assert.equal((await as(A(s1), `UPDATE staff_recognition_note SET status = 'approved' WHERE id = $1 RETURNING status`, [rn.id]))[0].status, "approved");
  assert.match(await err(as(A(admin), `UPDATE staff_recognition_note SET body = 'Something else entirely, longer' WHERE id = $1`, [rn.id])), /before it is answered/, "an answered note is not rewritten");
  assert.equal((await as(A(s1), `UPDATE staff_recognition_note SET status = 'withdrawn' WHERE id = $1 RETURNING status`, [rn.id]))[0].status, "withdrawn", "and the person can take it back");
  assert.match(await err(as(A(admin), `DELETE FROM staff_recognition_note WHERE id = $1`, [rn.id])), /permission denied/);

  // ---- directory contributions ------------------------------------------------
  const submit = (who: string, p: Record<string, unknown>, orgId = org) => as({ orgId, userId: who }, `SELECT public.submit_directory_contribution($1::jsonb) AS id`, [JSON.stringify(p)]);
  const today = new Date().toISOString().slice(0, 10);
  const [np] = await submit(s1, { flow: "new_place", target_kind: "employer", details: { name: "Harbor Freight Lines (Demo)", state: "MI", city: "Muskegon", secret: "dropped" } });
  assert.ok(np.id, "a new place comes in");
  const [again] = await submit(s1, { flow: "new_place", target_kind: "employer", details: { name: "harbor freight lines (demo)", state: "MI" } });
  assert.equal(again.id, np.id, "the same thing twice in a day is one submission");
  assert.match(await err(submit(s1, { flow: "new_place", target_kind: "employer", details: { name: "No State" } })), /name and state/);
  assert.match(await err(submit(staffB, { flow: "new_place", target_kind: "employer", details: { name: "X", state: "MI" } })), /only staff/, "not someone outside the program");
  assert.match(await err(submit(p1, { flow: "new_place", target_kind: "employer", details: { name: "X", state: "MI" } })), /only staff/, "not a participant");

  // An employer to point at (061 may not apply in pglite; the employer flows run only when it did).
  const hasEmployers = !!(await one<{ t: string | null }>(`SELECT to_regclass('public.employer_org') AS t`)).t;
  let callId: string | null = null;
  assert.ok(hasEmployers, "061 applies in pglite, so the employer flows below really run");
  if (hasEmployers) {
    const emp = ((await q(`INSERT INTO employer_org (canonical_name, name_key) VALUES ('Lakeshore Foods (Demo)', public.directory_normalize_name('Lakeshore Foods (Demo)')) RETURNING id`)).rows[0] as { id: string }).id;
    assert.match(await err(submit(s1, { flow: "called_today", target_kind: "employer", target_id: emp, details: { said: "Still hiring" }, interaction_on: today, interaction_method: "heard_from_someone" })), /A call needs/, "hearsay is not a call");
    assert.match(await err(submit(s1, { flow: "called_today", target_kind: "employer", target_id: emp, details: { said: "Still hiring" }, interaction_method: "phone_call" })), /A call needs/, "a call needs its date");
    assert.match(await err(submit(s1, { flow: "called_today", target_kind: "employer", target_id: emp, details: { said: "Still hiring" }, interaction_on: "2020-01-01", interaction_method: "phone_call" })), /last 30 days/);
    const [call] = await submit(s1, { flow: "called_today", target_kind: "employer", target_id: emp, details: { said: "HR said they still hire people with records for the night crew" }, interaction_on: today, interaction_method: "phone_call", private_note: "Spoke with the HR lead at extension 12" });
    callId = String(call.id);
    const [ks] = await submit(s2, { flow: "knows_someone", target_kind: "employer", target_id: emp, private_note: "My cousin runs the dock there" });
    assert.ok(ks.id);

    // Staff never read the queue table; the read-back never carries the private note.
    assert.equal((await as(A(s1), `SELECT id FROM directory_contribution`)).length, 0, "staff cannot read the queue table");
    const mine = await as(A(s1), `SELECT * FROM public.my_directory_contributions()`);
    assert.ok(mine.length >= 2 && mine.every((r) => r.mine === true), "staff read back their own");
    assert.ok(!Object.keys(mine[0]).includes("private_note"), "never the private note");
    assert.equal((await as(A(s3), `SELECT * FROM public.my_directory_contributions()`)).length, 0, "a colleague reads none of mine");
    assert.ok((await as(A(owner), `SELECT * FROM public.my_directory_contributions()`)).length >= 3, "the program's owner sees the program's");
    assert.equal((await as({ orgId: orgB, userId: ownerB }, `SELECT * FROM public.my_directory_contributions()`)).length, 0, "another organization sees none");
    assert.equal((await as(A(platform), `SELECT private_note FROM directory_contribution WHERE id = $1`, [callId]))[0]?.private_note, "Spoke with the HR lead at extension 12", "the data owner reads the queue");

    // Decisions: owner only; credit after approval; hearsay can never be a verified call.
    assert.match(await err(as(A(owner), `SELECT public.decide_directory_contribution($1, 'approved', 'verified_call', 'Thanks')`, [callId])), /only the directory owner/);
    assert.match(await err(as(A(platform), `SELECT public.decide_directory_contribution($1, 'approved', 'new_row', 'Thanks')`, [callId])), /check constraint|outcome_fits/, "an outcome must fit its flow");
    assert.equal((await as(A(s1), `SELECT key FROM staff_milestone WHERE key = 'first_verified_listing'`)).length, 0, "nothing before approval");
    await as(A(platform), `SELECT public.decide_directory_contribution($1, 'approved', 'verified_call', 'Thank you, confirmed')`, [callId]);
    const after = (await as(A(s1), `SELECT key FROM staff_milestone ORDER BY key`)).map((r) => r.key);
    assert.ok(after.includes("first_verified_listing") && after.includes("research_helper"), JSON.stringify(after));
    const back = (await as(A(s1), `SELECT status, owner_answer, recheck_on FROM public.my_directory_contributions() WHERE id = $1`, [callId]))[0];
    assert.equal(back.status, "approved");
    assert.ok(back.recheck_on, "an approval carries its re-check date");

    // Recording the call writes the documented interaction in the program's name.
    assert.match(await err(as(A(s1), `SELECT public.apply_contribution_call($1, NULL, NULL)`, [callId])), /only the directory owner/);
    const wrote = await as(A(platform), `SELECT public.apply_contribution_call($1, NULL, NULL) AS w`, [callId]);
    assert.equal(wrote[0].w, "employer_confirmed");
    const conf = await one<{ method: string; confirmed_by: string }>(`SELECT method, confirmed_by FROM employer_relationship_confirmation WHERE note = $1`, [`Staff contribution ${callId}`]);
    assert.equal(conf.method, "phone_call");
    assert.equal(conf.confirmed_by, `org:${org}`, "the program is the source, never a person's name");
    const rel = await one<{ avenue: string; partner_org_id: string }>(`SELECT avenue, partner_org_id FROM employer_relationship WHERE note = $1`, [`Staff contribution ${callId}`]);
    assert.equal(rel.avenue, "partner_org");
    assert.equal(rel.partner_org_id, org);
    assert.match(await err(as(A(platform), `SELECT public.decide_directory_contribution($1, 'not_used', NULL, NULL)`, [callId])), /not after the call was recorded/);

    // Revert within 30 days takes the credit back.
    await as(A(platform), `SELECT public.decide_directory_contribution($1, 'approved', 'warm_intro', NULL)`, [ks.id]);
    assert.ok((await as(A(s2), `SELECT key FROM staff_milestone`)).some((r) => r.key === "first_warm_intro"));
    await as(A(platform), `SELECT public.decide_directory_contribution($1, 'not_used', NULL, 'Turned out to be a different company')`, [ks.id]);
    assert.ok(!(await as(A(s2), `SELECT key FROM staff_milestone`)).some((r) => r.key === "first_warm_intro"), "a reverted approval takes its milestone back");
  } else {
    console.log(`  note: employer tables did not apply in pglite (${failedEarly.filter((f) => /061|071/.test(f)).join(", ") || "unknown"}); employer flows skipped`);
  }

  // A resource call becomes the R3 event, bound to the service's live check (073).
  const hasResources = !!(await one<{ t: string | null }>(`SELECT to_regclass('public.resource_relationship_event') AS t`)).t;
  assert.ok(hasResources, "072 and 073 apply in pglite, so the resource flow below really runs");
  {
    const rorg = ((await q(`INSERT INTO resource_org (org_key, name, org_type, website) VALUES ('lakeshore-pantry-demo', 'Lakeshore Pantry (Demo)', 'nonprofit', 'https://example.org') RETURNING id`)).rows[0] as { id: string }).id;
    const svc = ((await q(`INSERT INTO resource_service (org_id, service_name, description, area_id, geo_scope, state, adult_facing, status) VALUES ($1, 'Weekly pantry', 'Free groceries every Tuesday', 'food', 'statewide', 'MI', true, 'active') RETURNING id`, [rorg])).rows[0] as { id: string }).id;
    const check = ((await q(`INSERT INTO resource_check (service_id, source_url, source_type, quote, observed_on, verify_method, confidence, ttl_days, fields_hash, review_tier, review_result, review_by, review_on)
      SELECT s.id, 'https://example.org/pantry', 'official_site', 'Open Tuesdays', current_date, 'fetch', 'high', 60, public.resource_fields_hash(s, 'Lakeshore Pantry (Demo)', 'https://example.org'), 'T4', 'PASS', 'fixture reviewer', current_date
      FROM resource_service s WHERE s.id = $1 RETURNING id`, [svc])).rows[0] as { id: string }).id;
    const [visit] = await submit(s1, { flow: "called_today", target_kind: "resource", target_id: svc, details: { name: "Weekly pantry", said: "Still open Tuesdays, no ID needed" }, interaction_on: today, interaction_method: "site_visit" });
    await as(A(platform), `SELECT public.decide_directory_contribution($1, 'approved', 'verified_call', NULL)`, [visit.id]);
    assert.match(await err(as(A(platform), `SELECT public.apply_contribution_call($1, NULL, NULL)`, [visit.id])), /live check/, "a resource call names the check it confirmed");
    assert.equal((await as(A(platform), `SELECT public.apply_contribution_call($1, $2, NULL) AS w`, [visit.id, check]))[0].w, "resource_confirmed");
    const ev = await one<{ kind: string; method: string; recorded_by: string; check_id: string }>(`SELECT kind, method, recorded_by, check_id FROM resource_relationship_event WHERE note = $1`, [`Staff contribution ${visit.id}`]);
    assert.deepEqual([ev.kind, ev.method, ev.recorded_by, ev.check_id], ["confirmed", "in_person", `org:${org}`, check], "a visit is in person; the program is the source");
    assert.match(await err(as(A(platform), `SELECT public.apply_contribution_call($1, $2, NULL)`, [visit.id, check])), /not yet recorded/, "recorded once");
  }

  // Withdraw: only the submitter, only before an answer.
  assert.equal((await as(A(s2), `SELECT public.withdraw_directory_contribution($1) AS ok`, [np.id]))[0].ok, false, "not someone else's");
  assert.equal((await as(A(s1), `SELECT public.withdraw_directory_contribution($1) AS ok`, [np.id]))[0].ok, true);
  assert.match(await err(as(A(s1), `INSERT INTO directory_contribution (access_code_id, submitted_by, flow, target_kind, details) VALUES ($1, $2, 'new_place', 'employer', '{"name":"x","state":"MI"}')`, [org, s1])), /permission denied/, "never written directly");

  // ---- the listing nudge, once a week ------------------------------------------
  const listing = id(900);
  const claim = (who: string) => as(A(who), `INSERT INTO staff_listing_nudge (user_id, access_code_id, listing_kind, listing_id) VALUES ($1, $2, 'resource', $3)
    ON CONFLICT (user_id, access_code_id, listing_kind, listing_id) DO UPDATE SET shown_at = now() WHERE staff_listing_nudge.shown_at < now() - interval '7 days' RETURNING shown_at`, [who, org, listing]);
  assert.equal((await claim(s1)).length, 1, "first time: show it");
  assert.equal((await claim(s1)).length, 0, "again this week: do not");
  assert.equal((await claim(s2)).length, 1, "a colleague has their own week");
  assert.equal((await as(A(s2), `SELECT * FROM staff_listing_nudge`)).length, 1, "and reads only their own");
  assert.match(await err(as(A(s1), `INSERT INTO staff_listing_nudge (user_id, access_code_id, listing_kind, listing_id) VALUES ($1, $2, 'resource', $3)`, [s2, org, id(901)])), /yours|row-level/);
});
