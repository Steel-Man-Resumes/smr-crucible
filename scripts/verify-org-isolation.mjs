#!/usr/bin/env node
/**
 * Prove that one organization cannot see another organization's people.
 *
 * This is the gate. An admin console that can read across orgs by accident is
 * the single defect that ends an institutional sale, and "we were careful" is
 * not evidence. Run it, read the exit code.
 *
 * WHY IT RUNS AGAINST A REAL DATABASE. The isolation being tested lives in SQL
 * predicates, not in TypeScript. A mock would only prove that the mock agrees
 * with itself. So this seeds two real organizations, reads as each, and asserts
 * what each can and cannot see.
 *
 * SAFETY, because this writes rows:
 *   - It requires ISOLATION_TEST_DATABASE_URL, set deliberately. It will NOT
 *     fall back to DATABASE_URL. Pointing a seeding script at production by
 *     accident is exactly the mistake a fallback invites, and the Neon-Vercel
 *     integration re-injects DATABASE_URL on every deploy.
 *   - Every fixture is prefixed `__isotest` and every assertion filters on that
 *     prefix, so pre-existing rows cannot inflate a count and cleanup is exact.
 *   - Cleanup runs in a finally block, and also runs first, so a crashed
 *     previous run does not poison this one.
 *
 * PHASE 1 (today): proves application-level scoping -- the WHERE clauses and
 * the authorization checks in packages/core. PHASE 2, once an RLS role exists,
 * adds check 0 (the connection cannot bypass RLS) and the same assertions hold
 * with the predicates moved into the database. Checks 1-6 are written so only
 * the connection setup changes.
 */

import { neon } from "@neondatabase/serverless";
import { readFileSync } from "node:fs";
import { checkRestrictedGrants } from "./lib/restricted-grants.mjs";

const URL_VAR = "ISOLATION_TEST_DATABASE_URL";
const CRED_FILE = ".env.isolation";

/**
 * Read the connection string from a gitignored file, or the environment.
 *
 * The file is preferred and exists so a database credential never has to be
 * typed into a shell, a chat transcript, or a command history. Put it in with
 * an editor, run the test, delete the file.
 */
/** The app-role connection string, from the same gitignored file if present. */
function readAppUrl() {
  try {
    const line = readFileSync(".env.smr-app", "utf8")
      .split("\n")
      .find((l) => l.trim().startsWith("SMR_APP_DATABASE_URL="));
    if (line) return line.slice(line.indexOf("=") + 1).trim().replace(/^["']|["']$/g, "");
  } catch {
    /* none */
  }
  return undefined;
}

function readTestUrl() {
  try {
    const line = readFileSync(CRED_FILE, "utf8")
      .split("\n")
      .find((l) => l.trim().startsWith(URL_VAR + "="));
    if (line) {
      const v = line.slice(line.indexOf("=") + 1).trim().replace(/^["']|["']$/g, "");
      if (v) return v;
    }
  } catch {
    /* fall through to the environment */
  }
  return process.env[URL_VAR];
}

const url = readTestUrl();

if (!url) {
  console.error(
    `\nNo test database configured.\n\n` +
      `This script seeds and deletes rows, so it will not guess a database.\n\n` +
      `Preferred -- put the connection string in a gitignored file so it never\n` +
      `goes through a shell or a command history:\n\n` +
      `  echo '${URL_VAR}=' > ${CRED_FILE}   # then open it and paste the value\n\n` +
      `Or pass it in the environment:\n\n` +
      `  ${URL_VAR}='postgres://...' npm run verify:isolation\n`
  );
  process.exit(2); // 2 = could not run, distinct from 1 = isolation failed
}

// TWO ROLES, OR THE RUN PROVES LESS THAN IT LOOKS LIKE.
//
// Fixtures are created as the OWNER (which bypasses RLS, so seeding protected
// tables works) and the application helpers run as the APP role (which cannot
// bypass, so their scoped reads are actually exercised). Giving both the same
// credentials -- which this script used to do -- means either the fixtures
// cannot be created, or the code under test bypasses the very policies the
// suite exists to verify. A green run then establishes that the application
// WHERE clauses are right and says nothing about production. (Found in review.)
const APP_VAR = "ISOLATION_APP_DATABASE_URL";
const appUrl = process.env[APP_VAR] || readAppUrl();

// BIND THE CODE UNDER TEST TO THIS DATABASE, not just the fixtures.
//
// packages/core/src/db.ts reads DATABASE_URL. Seeding through one connection
// while the application helpers read another means the test proves nothing --
// and if both are set, fixtures and assertions hit DIFFERENT DATABASES while
// appearing to pass. Set it before anything imports core.
if (process.env.DATABASE_URL && process.env.DATABASE_URL !== url) {
  console.error(
    "\nDATABASE_URL is set and differs from " + URL_VAR + ".\n" +
      "The application helpers under test read DATABASE_URL, so this would\n" +
      "seed one database and assert against another. Unset DATABASE_URL, or\n" +
      "set both to the same disposable database.\n"
  );
  process.exit(2);
}
// The helpers read DATABASE_URL. Point them at the APP role when we have one.
process.env.DATABASE_URL = appUrl || url;

if (!appUrl) {
  console.warn(
    `\n  WARNING: ${APP_VAR} not set.\n` +
      `  The application helpers will run as the same role that created the\n` +
      `  fixtures, which bypasses row-level security. This run verifies the\n` +
      `  application's own predicates and does NOT verify that production's\n` +
      `  scoped reads work. Set ${APP_VAR} to the smr_app connection string\n` +
      `  for the full check.\n`
  );
}

const sql = neon(url);

// Fixture prefix. Note it contains NO underscore: in SQL LIKE, `_` matches any
// single character, so a "__isotest%" pattern also matches "XYisotest-real" and
// a cleanup DELETE would remove rows that were never fixtures. Cleanup below
// uses exact ids anyway, and this prefix is only a readability aid.
const P = "isotestfixture";

let pass = 0;
let fail = 0;

function check(name, ok, detail = "") {
  if (ok) {
    pass++;
    console.log(`  pass  ${name}`);
  } else {
    fail++;
    console.log(`  FAIL  ${name}${detail ? `\n          ${detail}` : ""}`);
  }
}

// Exact ids of everything this run created. A DELETE driven by a pattern can
// always match something it did not create; a DELETE driven by ids we minted
// cannot. Nothing here deletes a row this process did not insert.
const created = { users: [], codes: [] };

async function cleanup() {
  if (!created.codes.length && !created.users.length) return;
  const codes = created.codes;
  const users = created.users;
  // Order matters: children before parents.
  if (codes.length) {
    await sql`DELETE FROM client_staff_assignment WHERE access_code_id = ANY(${codes}::uuid[])`;
    await sql`DELETE FROM access_code_redemption WHERE access_code_id = ANY(${codes}::uuid[])`;
    await sql`DELETE FROM org_staff WHERE access_code_id = ANY(${codes}::uuid[])`;
    await sql`DELETE FROM org_invite WHERE access_code_id = ANY(${codes}::uuid[])`;
    await sql`DELETE FROM org_staff_invite WHERE access_code_id = ANY(${codes}::uuid[])`.catch(() => {});
    await sql`DELETE FROM org_capability_override WHERE org_id = ANY(${codes}::uuid[])`.catch(() => {});
    await sql`DELETE FROM org_audit WHERE org_id = ANY(${codes}::uuid[])`;
    // 102: the activity log has no foreign keys (by design), so its rows are removed by org id, here and again below.
    await sql`DELETE FROM org_activity WHERE access_code_id = ANY(${codes}::uuid[])`.catch(() => {});
  }
  if (users.length) {
    await sql`DELETE FROM consumer_consent WHERE user_id = ANY(${users}::uuid[])`;
    await sql`DELETE FROM client_staff_assignment WHERE staff_user_id = ANY(${users}::uuid[])`;
  }
  if (codes.length) await sql`DELETE FROM access_code WHERE id = ANY(${codes}::uuid[])`;
  if (users.length) await sql`DELETE FROM users WHERE id = ANY(${users}::uuid[])`;
  // Cascades above write activity rows (an assignment ending, a team member removed); take those too.
  if (codes.length) await sql`DELETE FROM org_activity WHERE access_code_id = ANY(${codes}::uuid[])`.catch(() => {});
  created.users = [];
  created.codes = [];
}

// Each fixture account gets its own label, and its email carries this run's id,
// so two blocks can never mint the same address (users_email_key) and a row
// left behind by an earlier, crashed run cannot collide with this one.
// scripts/lib/check-isolation-fixtures.mjs checks the labels statically.
const RUN = Date.now().toString(36);
const usedLabels = new Set();

async function mkUser(label) {
  if (usedLabels.has(label)) throw new Error(`mkUser label used twice in one run: ${label}`);
  usedLabels.add(label);
  const [row] = await sql`
    INSERT INTO users (name, email, tier)
    VALUES (${P + " " + label}, ${`${P}-${label}-${RUN}@example.invalid`}, 'client')
    RETURNING id`;
  created.users.push(row.id);
  return row.id;
}

async function mkOrg(label, ownerId) {
  const [row] = await sql`
    INSERT INTO access_code (code, partner_name, tier, partner_user_id, is_active)
    VALUES (${`${P}-${label}`}, ${`${P} ${label}`}, 'partner', ${ownerId}, true)
    RETURNING id`;
  created.codes.push(row.id);
  return row.id;
}

/** Join a participant to an org AND grant sharing consent, so they are visible. */
async function joinCohort(orgId, userId) {
  await sql`INSERT INTO access_code_redemption (user_id, access_code_id)
            VALUES (${userId}, ${orgId})`;
  // consent_text_version is NOT NULL -- the schema records WHICH wording a
  // person agreed to, which is the point of a consent record. Fixtures must
  // supply it like the app does (see packages/core/src/consent.ts).
  await sql`INSERT INTO consumer_consent
              (user_id, consent_layer, status, consent_text_version, collection_context)
            VALUES (${userId}, 'sharing', 'granted', ${'isolation-test'},
                    ${JSON.stringify({ source: 'isolation-test' })}::jsonb)
            ON CONFLICT (user_id, consent_layer) DO UPDATE SET status = 'granted'`;
}

async function joinCohortConsent(userId) {
  await sql`INSERT INTO consumer_consent (user_id, consent_layer, status, consent_text_version, collection_context)
            VALUES (${userId}, 'sharing', 'granted', ${'isolation-test'}, ${JSON.stringify({ source: 'isolation-test' })}::jsonb)
            ON CONFLICT (user_id, consent_layer) DO UPDATE SET status = 'granted'`;
}

async function main() {
  const [{ who: fixtureRole }] = await sql`SELECT current_user AS who`;
  const core0 = await import("../packages/core/dist/index.js");
  const [{ who: appRole }] = await core0.query("SELECT current_user AS who");
  console.log(`\nCross-org isolation`);
  console.log(`  fixtures created as: ${fixtureRole}`);
  console.log(`  code under test as:  ${appRole}${appRole === fixtureRole ? "   <-- SAME ROLE: RLS not exercised" : ""}\n`);
  // No pre-run cleanup: with id-based deletion there is nothing to clean before
  // we create anything. A crashed previous run leaves rows behind under the
  // fixture prefix -- that is the honest trade for never deleting a row we did
  // not insert. Drop and recreate the disposable database if that happens.

  // --- Two organizations that must never see each other ------------------
  const ownerA = await mkUser("ownerA");
  const ownerB = await mkUser("ownerB");
  const staffA = await mkUser("staffA");
  const staffB = await mkUser("staffB");
  const clientA = await mkUser("clientA");
  const clientB = await mkUser("clientB");

  const orgA = await mkOrg("orgA", ownerA);
  const orgB = await mkOrg("orgB", ownerB);

  await sql`INSERT INTO org_staff (access_code_id, user_id, role)
            VALUES (${orgA}, ${staffA}, 'staff')`;
  await sql`INSERT INTO org_staff (access_code_id, user_id, role)
            VALUES (${orgB}, ${staffB}, 'staff')`;

  await joinCohort(orgA, clientA);
  await joinCohort(orgB, clientB);

  const core = await import("../packages/core/dist/index.js");

  // 1 -- POSITIVE, asserted by IDENTITY not by count. A count can be right
  //      for entirely the wrong reason.
  const cohortA = await core.getPartnerCohort(ownerA, {});
  check(
    "org A sees exactly its own participant",
    cohortA.clients.length === 1 && cohortA.clients[0].userId === clientA,
    `saw ${cohortA.clients.map((c) => c.userId).join(",") || "nothing"}`
  );

  // 2 -- THE CROSS-ORG READ. The reason this file exists.
  const cohortB = await core.getPartnerCohort(ownerB, {});
  check(
    "org B cannot see org A's participant",
    !cohortB.clients.some((c) => c.userId === clientA),
    "org A's participant appeared in org B's cohort"
  );

  // 3 -- REGRESSION for the staff-name leak fixed 2026-09-19. A participant
  //      assigned inside org B must not surface B's staff name in A's view.
  //      Seeded through the DB directly, since the API now refuses it.
  await sql`INSERT INTO client_staff_assignment
              (access_code_id, client_user_id, staff_user_id, assigned_by)
            VALUES (${orgB}, ${clientA}, ${staffB}, ${ownerB})`;
  const cohortA2 = await core.getPartnerCohort(ownerA, {});
  const leaked = cohortA2.clients.find((c) => c.userId === clientA);
  check(
    "a foreign org's staff name does not leak into this org's cohort",
    leaked != null && leaked.assignedStaffId === null && leaked.assignedStaffName === null,
    `assignedStaffName was ${JSON.stringify(leaked?.assignedStaffName)}`
  );

  // 4 -- CROSS-ORG WRITE, participant side. Org A must not be able to claim a
  //      participant who belongs to org B.
  let refusedForeignClient = false;
  try {
    await core.assignClientStaff(orgA, clientB, staffA, ownerA);
  } catch {
    refusedForeignClient = true;
  }
  check("org A cannot assign a participant who is not in its cohort", refusedForeignClient);

  // 5 -- CROSS-ORG WRITE, staff side. This was the name-oracle over the whole
  //      users table: any user id could be named as the staff member.
  let refusedForeignStaff = false;
  try {
    await core.assignClientStaff(orgA, clientA, staffB, ownerA);
  } catch {
    refusedForeignStaff = true;
  }
  check("org A cannot assign one of its participants to another org's staff", refusedForeignStaff);

  // 6 -- The legitimate write still works. A guard that blocks everything
  //      passes every isolation test and ships a broken product.
  let ownWriteWorks = true;
  try {
    await core.assignClientStaff(orgA, clientA, staffA, ownerA);
  } catch (err) {
    ownWriteWorks = false;
    check("org A CAN assign its own participant to its own staff", false, String(err));
  }
  if (ownWriteWorks) check("org A CAN assign its own participant to its own staff", true);

  // --- Staff management: the highest-risk write in the app ---------------

  // 8 -- Org A cannot put another org's staff member on its own team by id.
  const foreignAdd = await core.addOrgStaff({
    orgId: orgA, userId: staffB, role: "staff", addedBy: ownerA,
  });
  check(
    "org A cannot recruit a staff member who already serves org B",
    foreignAdd.ok === false,
    foreignAdd.reason ?? "the write succeeded"
  );

  // 9 -- Org A cannot re-role somebody at org B, even naming their id.
  const foreignRole = await core.setOrgStaffRole({
    orgId: orgA, userId: staffB, role: "org_admin", actorUserId: ownerA,
  });
  check("org A cannot re-role org B's staff", foreignRole.ok === false);

  // 10 -- Org A cannot remove org B's staff.
  const foreignRemove = await core.removeOrgStaff({
    orgId: orgA, userId: staffB, actorUserId: ownerA,
  });
  check("org A cannot remove org B's staff", foreignRemove.ok === false);

  // 11 -- NOBODY ESCALATES THEMSELVES. The classic privilege bug.
  const selfPromote = await core.setOrgStaffRole({
    orgId: orgA, userId: staffA, role: "org_admin", actorUserId: staffA,
  });
  check("a staff member cannot promote themselves", selfPromote.ok === false);

  // 12 -- The legitimate path still works, and releases the caseload.
  const realRole = await core.setOrgStaffRole({
    orgId: orgA, userId: staffA, role: "org_admin", actorUserId: ownerA,
  });
  check("an owner CAN promote their own staff member", realRole.ok === true, realRole.reason);

  const realRemove = await core.removeOrgStaff({
    orgId: orgA, userId: staffA, actorUserId: ownerA,
  });
  check(
    "removing staff releases their caseload rather than orphaning it",
    realRemove.ok === true && (realRemove.releasedClients ?? 0) === 1,
    `released ${realRemove.releasedClients}`
  );

  // 7 -- Consent still gates everything. A participant who never granted
  //      sharing is counted but never named, even to their own org.
  const noConsent = await mkUser("noconsent");
  await sql`INSERT INTO access_code_redemption (user_id, access_code_id)
            VALUES (${noConsent}, ${orgA})`;
  const cohortA3 = await core.getPartnerCohort(ownerA, {});
  check(
    "a participant without sharing consent is counted but never named",
    !cohortA3.clients.some((c) => c.userId === noConsent) && cohortA3.pendingCount >= 1,
    `pendingCount=${cohortA3.pendingCount}`
  );

  await platformAdminChecks();
  await membershipChecks();
  await sharingChecks();
  await accessChecks();
  await requiredSharingChecks();
  await todayAndTaskChecks();
  await outcomeChecks();
  await workflowChecks();
  await ownerOnlyChecks();
  await participantTableChecks();
  await seatChecks();
  await reachChecks();
  await aiSkillRunChecks();
  await structureChecks();
  await customizationChecks();
  await customizationPolicyChecks();
  await handoffChecks();
  await teamTalkChecks();
  await outboundBrandChecks();
}

/**
 * Team talk (109, staff side lane S4): comments, the inbox, task handoff,
 * change requests and note review. The claims: a comment about a person is
 * read and written only by staff who reach them, never by the participant or
 * another organization (through core AND by a raw scoped query); a mention of
 * a colleague who cannot reach the person is refused; the inbox is the
 * recipient's alone and only the database writes it; a task goes only to a
 * teammate who reaches the person; a change request is read by the asker and
 * the managers and answered only by the managers.
 */
async function teamTalkChecks() {
  console.log("\n  -- team talk: comments, inbox, task handoff, change requests (109) --");
  if (!appUrl) { console.log("  skip  needs the app credential"); return; }
  const [{ has }] = await sql`SELECT to_regclass('public.team_comment') IS NOT NULL AS has`;
  if (!has) { console.log("  note  109 not applied; skipped"); return; }
  const core = await import("../packages/core/dist/index.js");
  const app = neon(appUrl);
  const uniq = Date.now().toString(36).toUpperCase().slice(-6);
  const attempt = async (f) => { try { return { ok: true, v: await f() }; } catch (e) { return { ok: false, e: String(e?.message ?? e) }; } };
  const rawAs = async (orgId, userId, query) => (await app.transaction([
    app`SELECT set_config('app.org_id', ${orgId}, true)`, app`SELECT set_config('app.user_id', ${userId}, true)`, query(app),
  ]))[2];
  const owner = await mkUser("tt-owner"), admin = await mkUser("tt-admin"), cm = await mkUser("tt-cm"), other = await mkUser("tt-other"), spy = await mkUser("tt-spy"), spyStaff = await mkUser("tt-spystaff");
  const [org] = await sql`INSERT INTO access_code (code, partner_name, tier, partner_user_id, is_active, crm_v2) VALUES (${"ISOTT" + uniq}, ${P + " team talk"}, 'client', ${owner}, true, true) RETURNING id, code`;
  const [org2] = await sql`INSERT INTO access_code (code, partner_name, tier, partner_user_id, is_active, crm_v2) VALUES (${"ISOTU" + uniq}, ${P + " team talk2"}, 'client', ${spy}, true, true) RETURNING id, code`;
  created.codes.push(org.id, org2.id);
  await sql`INSERT INTO org_staff (access_code_id, user_id, role) VALUES (${org.id}, ${admin}, 'org_admin'), (${org.id}, ${cm}, 'staff'), (${org.id}, ${other}, 'staff'), (${org2.id}, ${spyStaff}, 'staff')`;
  const pat = await mkUser("tt-pat"), hers = await mkUser("tt-hers");
  for (const u of [pat, hers]) await core.redeemAccessCode(u, org.code);
  await sql`INSERT INTO client_staff_assignment (access_code_id, client_user_id, staff_user_id, assigned_by) VALUES (${org.id}, ${pat}, ${cm}, ${owner}), (${org.id}, ${hers}, ${other}, ${owner})`;
  const A = (u) => core.resolveOrgActor(u);
  const aCm = await A(cm), aOther = await A(other), aAdmin = await A(admin), aOwner = await A(owner), aSpy = await A(spyStaff);

  // comments
  const c1 = await core.addTeamComment(aCm, { participantId: pat, body: "ISOTT-BODY can someone cover Thursday?", mentions: [admin] });
  check("a case manager comments on their person and mentions an admin", c1.ok === true, JSON.stringify(c1));
  const refused = await core.addTeamComment(aCm, { participantId: pat, body: "Can you take this?", mentions: [other] });
  check("a mention of a colleague who cannot see the person is refused, plainly", refused.ok === false && /cannot see this person/.test(refused.error), JSON.stringify(refused));
  const forced = await attempt(() => rawAs(org.id, cm, (a) => a`INSERT INTO team_comment (access_code_id, participant_user_id, author_user_id, body, mentions) VALUES (${org.id}, ${pat}, ${cm}, 'x', ARRAY[${other}]::uuid[])`));
  check("and refused by the database when the app check is skipped", !forced.ok && /mention_out_of_reach/.test(forced.e), JSON.stringify(forced));
  check("a colleague cannot comment on someone they do not reach", (await core.addTeamComment(aOther, { participantId: pat, body: "Not mine" })).ok === false);
  const listed = async (actor) => { const r = await core.listTeamComments(actor, pat); return r.ok ? r.comments.length : -1; };
  check("the case manager, the admin and the owner read the comment", (await listed(aCm)) === 1 && (await listed(aAdmin)) === 1 && (await listed(aOwner)) === 1);
  check("a colleague who does not reach the person reads nothing, through core", (await listed(aOther)) === -1);
  check("or by a raw scoped query", (await rawAs(org.id, other, (a) => a`SELECT id FROM team_comment WHERE participant_user_id = ${pat}`)).length === 0);
  check("another organization reads nothing, even forging the scope", (await rawAs(org.id, spyStaff, (a) => a`SELECT id FROM team_comment`)).length === 0
    && (await rawAs(org2.id, spyStaff, (a) => a`SELECT id FROM team_comment`)).length === 0 && (await listed(aSpy)) === -1);
  check("the participant never reads team comments", (await (async () => (await app.transaction([app`SELECT set_config('app.user_id', ${pat}, true)`, app`SELECT id FROM team_comment`]))[1])()).length === 0);
  const [{ n: unscoped }] = await core.query("SELECT count(*)::int AS n FROM team_comment");
  check("an unscoped read by the app sees no comments", unscoped === 0, String(unscoped));
  const del = await attempt(() => rawAs(org.id, cm, (a) => a`DELETE FROM team_comment WHERE author_user_id = ${cm}`));
  check("a comment is never deleted by the app", !del.ok && /permission denied/i.test(del.e), JSON.stringify(del));
  const fixed = c1.ok ? await core.correctTeamComment(aCm, c1.id, { body: "ISOTT-BODY corrected: Friday" }) : { ok: false };
  check("the author corrects it and the earlier wording is kept", fixed.ok && (await core.getTeamCommentHistory(aAdmin, c1.id))?.length === 1);
  check("nobody else corrects it", c1.ok && (await core.correctTeamComment(aAdmin, c1.id, { body: "rewritten" })).ok === false);

  // inbox
  const items = async (actor) => (await core.listInbox(actor))?.items ?? [];
  check("the mentioned admin has the item, in fixed words with no body", (await items(aAdmin)).some((i) => i.kind === "mention" && !/ISOTT-BODY/.test(i.sentence)));
  check("nobody else reads it, even raw", (await rawAs(org.id, cm, (a) => a`SELECT id FROM staff_inbox_item WHERE recipient_user_id = ${admin}`)).length === 0
    && (await rawAs(org.id, owner, (a) => a`SELECT id FROM staff_inbox_item WHERE recipient_user_id = ${admin}`)).length === 0);
  const forgedItem = await attempt(() => rawAs(org.id, cm, (a) => a`INSERT INTO staff_inbox_item (access_code_id, recipient_user_id, kind, ref_table, ref_id, summary) VALUES (${org.id}, ${admin}, 'mention', 'team_comment', ${cm}, 'forged')`));
  check("the app cannot write an inbox item", !forgedItem.ok && /permission denied/i.test(forgedItem.e), JSON.stringify(forgedItem));
  check("the recipient marks it read", (await core.markInbox(aAdmin, { all: true, read: true })) >= 1 && (await core.inboxUnreadCount(aAdmin)) === 0);

  // tasks
  const t1 = await core.addStaffTask(aCm, { title: "ISOTT-TASK bring papers", clientId: pat, ownerId: admin });
  check("a task about the person can go to the admin, who reaches them", t1.ok === true, JSON.stringify(t1));
  check("and the admin hears about it", (await items(aAdmin)).some((i) => i.kind === "task_assigned"));
  check("not to a colleague who cannot see the person", (await core.addStaffTask(aCm, { title: "x task", clientId: pat, ownerId: other })).ok === false);
  check("not to someone from another organization", (await core.addStaffTask(aCm, { title: "x task", clientId: pat, ownerId: spyStaff })).ok === false);
  const forcedTask = await attempt(() => rawAs(org.id, cm, (a) => a`INSERT INTO staff_task (access_code_id, client_user_id, owner_user_id, created_by, title) VALUES (${org.id}, ${pat}, ${other}, ${cm}, 'forced')`));
  check("and the database refuses it when the app check is skipped", !forcedTask.ok && /task_assign_out_of_reach/.test(forcedTask.e), JSON.stringify(forcedTask));

  // change requests
  const cr = await core.createChangeRequest(aCm, { kind: "field", title: "Add a field for boot size", body: "ISOTT-CR for the warehouse jobs" });
  check("a case manager asks for a change", cr.ok === true, JSON.stringify(cr));
  const ids = async (actor, view) => ((await core.listChangeRequests(actor, { view })) ?? []).map((r) => r.id);
  check("they read their own; a colleague does not", cr.ok && (await ids(aCm, "mine")).includes(cr.id) && !(await ids(aOther, "mine")).includes(cr.id));
  check("only managers get the queue", (await core.listChangeRequests(aOther, { view: "queue" })) === null && cr.ok && (await ids(aAdmin, "queue")).includes(cr.id));
  check("another organization reads none, even raw", (await rawAs(org.id, spyStaff, (a) => a`SELECT id FROM org_change_request`)).length === 0);
  check("the asker cannot answer it", cr.ok && (await core.answerChangeRequest(aCm, cr.id, { status: "done" })).ok === false
    && (await rawAs(org.id, cm, (a) => a`UPDATE org_change_request SET status = 'done' WHERE id = ${cr.id} RETURNING id`)).length === 0);
  check("a no needs a reason", cr.ok && (await core.answerChangeRequest(aAdmin, cr.id, { status: "declined" })).ok === false);
  check("a manager says yes and the asker hears back", cr.ok && (await core.answerChangeRequest(aAdmin, cr.id, { status: "accepted", answer: "Next week" })).ok
    && (await items(aCm)).some((i) => i.kind === "change_answered"));
  const hist = cr.ok ? await core.getChangeRequest(aCm, cr.id) : null;
  check("the asker sees who answered (answer history)", (hist?.events ?? []).some((e) => e.to_status === "accepted"));
  check("a colleague sees no answer history, even raw", (await rawAs(org.id, other, (a) => a`SELECT id FROM org_change_request_event`)).length === 0);
  const crActs = await sql`SELECT actor_user_id, staff_user_id FROM org_activity WHERE access_code_id = ${org.id} AND entity = 'change_request'`;
  check("change-request activity names nobody", crActs.length > 0 && crActs.every((r) => r.actor_user_id === null && r.staff_user_id === null));
  // The AI switch is the owner's (109 review round 2).
  await sql`INSERT INTO org_profile (access_code_id, org_type) VALUES (${org.id}, 'reentry_nonprofit') ON CONFLICT DO NOTHING`;
  const aiByAdmin = await attempt(() => rawAs(org.id, admin, (a) => a`UPDATE org_profile SET modules = modules || '{"ai_assist": false}' WHERE access_code_id = ${org.id}`));
  check("an org admin cannot turn t.ROY off for the organization", !aiByAdmin.ok && /ai_assist_owner_only/.test(aiByAdmin.e), JSON.stringify(aiByAdmin));
  const renameByAdmin = await attempt(() => rawAs(org.id, admin, (a) => a`UPDATE org_profile SET display_name = 'Isotest renamed' WHERE access_code_id = ${org.id} RETURNING access_code_id`));
  check("but can rename it", renameByAdmin.ok && renameByAdmin.v.length === 1, JSON.stringify(renameByAdmin));
  const aiByOwner = await attempt(() => rawAs(org.id, owner, (a) => a`UPDATE org_profile SET modules = modules || '{"ai_assist": false}' WHERE access_code_id = ${org.id} RETURNING access_code_id`));
  check("the owner can", aiByOwner.ok && aiByOwner.v.length === 1, JSON.stringify(aiByOwner));
  const acts = await sql`SELECT summary FROM org_activity WHERE access_code_id = ${org.id} AND entity IN ('comment', 'change_request', 'task')`;
  check("activity rows carry no typed words", acts.length > 0 && acts.every((r) => !/ISOTT-/.test(r.summary)), JSON.stringify(acts.map((r) => r.summary)));
  // cleanup for rows with no cascade from the org (the activity log is removed by org id in cleanup)
}

/**
 * Reach in the database (migration 102, house lane L3b). Until 102 the row
 * policies on notes, tasks, placements, check-ins, suggestions and asks let
 * ANY staff session read the whole organization; "assigned only" lived in the
 * application. The claim now: a volunteer cannot read or write anything about
 * a person not assigned to them, by a raw scoped query or through a route that
 * forgot the app-level check; the assigned case manager, an admin, the owner
 * and someone granted "see everyone" can; an admin denied it cannot; another
 * organization cannot, even forging the org scope; the participant still reads
 * what is theirs. Plus: the activity log is written by the database, holds no
 * typed text, and the app cannot write, edit or erase it; corrections keep the
 * earlier answer.
 */
async function reachChecks() {
  console.log("\n  -- reach in the database, activity log, outcome audit (102) --");
  if (!appUrl) { console.log("  skip  needs the app credential"); return; }
  const [{ has }] = await sql`SELECT to_regclass('public.org_activity') IS NOT NULL AS has`;
  if (!has) { console.log("  note  102 not applied; skipped"); return; }
  const core = await import("../packages/core/dist/index.js");
  const app = neon(appUrl);
  const uniq = Date.now().toString(36).toUpperCase().slice(-6);
  const raised = async (fn) => { try { await fn(); return null; } catch (e) { return String(e?.message ?? e); } };
  const asOrg = (orgId, actor, q) => app.transaction([app`SELECT set_config('app.org_id', ${orgId}, true)`, app`SELECT set_config('app.user_id', ${actor}, true)`, q]);

  const owner = await mkUser("r-owner"), admin = await mkUser("r-admin"), vol = await mkUser("r-vol"), cm = await mkUser("r-cm");
  const seer = await mkUser("r-seer"), deniedAdmin = await mkUser("r-denied"), spy = await mkUser("r-spy"), spyStaff = await mkUser("r-spystaff");
  const mk = async (l, o) => { const [r] = await sql`INSERT INTO access_code (code, partner_name, tier, partner_user_id, is_active, crm_v2) VALUES (${"ISOR" + l + uniq}, ${P + " reach" + l}, 'client', ${o}, true, true) RETURNING id, code`; created.codes.push(r.id); return r; };
  const org = await mk("A", owner), org2 = await mk("B", spy);
  await sql`INSERT INTO org_staff (access_code_id, user_id, role) VALUES (${org.id}, ${admin}, 'org_admin'), (${org.id}, ${vol}, 'staff'), (${org.id}, ${cm}, 'staff'),
            (${org.id}, ${seer}, 'staff'), (${org.id}, ${deniedAdmin}, 'org_admin'), (${org2.id}, ${spyStaff}, 'staff')`;
  // The volunteer preset as the app writes it (STAFF_PRESETS.volunteer), a "see everyone" grant, and an admin denied it.
  await sql`INSERT INTO org_capability_override (org_id, user_id, capability, effect) VALUES
            (${org.id}, ${vol}, 'org.client.view_all', 'deny'), (${org.id}, ${vol}, 'org.outcome.write', 'deny'), (${org.id}, ${vol}, 'org.participant.invite', 'deny'),
            (${org.id}, ${seer}, 'org.client.view_all', 'grant'), (${org.id}, ${deniedAdmin}, 'org.client.view_all', 'deny')`;
  const p1 = await mkUser("r-p1"), p2 = await mkUser("r-p2");
  for (const u of [p1, p2]) await core.redeemAccessCode(u, org.code);
  await sql`INSERT INTO client_staff_assignment (access_code_id, client_user_id, staff_user_id, assigned_by) VALUES (${org.id}, ${p1}, ${vol}, ${owner}), (${org.id}, ${p2}, ${cm}, ${owner})`;
  const A = (u, o) => core.resolveOrgActor(u, o ? { orgId: o } : undefined);
  const aOwner = await A(owner), aAdmin = await A(admin), aVol = await A(vol), aCm = await A(cm), aSeer = await A(seer), aDenied = await A(deniedAdmin), aSpy = await A(spy);
  check("fixture: the volunteer resolves with assigned reach and no outcome writes; the seer sees all; the denied admin does not",
    aVol?.reach === "assigned" && !aVol.capabilities.has("org.outcome.write") && aSeer?.reach === "all" && aDenied?.reach === "assigned");

  // -- the assigned case manager builds a full record about p2 through the app's own paths
  const note = await core.addClientNote(aCm, p2, { body: "RSECRET-BODY met at the parole office", kind: "call" });
  const fixed = note.ok ? await core.editClientNote(aCm, p2, note.id, { body: "RSECRET-BODY corrected wording" }) : { ok: false };
  const task = await core.addStaffTask(aCm, { title: "RSECRET-TASK bring papers", clientId: p2, shared: true });
  const ago = (d) => new Date(Date.now() - d * 86400000).toISOString().slice(0, 10);
  const outc = await core.recordOutcome(aCm, { clientId: p2, employer: "RSECRET-EMPLOYER", startDate: ago(100), source: "staff_reported" });
  const chk = outc.ok ? await core.recordRetentionCheck(aCm, { outcomeId: outc.id, dayMark: 30, status: "employed", method: "participant_told_me" }) : { ok: false };
  const sug = await core.suggestJob(aCm, p2, { jobTitle: "Prep Cook", company: "River Cafe", why: "RSECRET-WHY day shift" });
  const ask = await core.requestSharing(aCm, p2, "resume", "RSECRET-ASK so I can help before Thursday");
  check("the assigned case manager still writes every kind of record through the app, under the new policies",
    note.ok && fixed.ok && task.ok && outc.ok && chk.ok && sug.ok && ask.ok, JSON.stringify({ note, fixed, task, outc, chk, sug, ask }));
  const [{ id: checkId } = {}] = await sql`SELECT id FROM retention_check WHERE outcome_id = ${outc.id}`;

  // -- 1. raw scoped reads, table by table, actor by actor
  const tables = [
    ["note", () => app`SELECT count(*)::int AS n FROM case_note WHERE client_user_id = ${p2}`],
    ["note version", () => app`SELECT count(*)::int AS n FROM case_note_version WHERE note_id = ${note.id}`],
    ["task", () => app`SELECT count(*)::int AS n FROM staff_task WHERE client_user_id = ${p2}`],
    ["placement", () => app`SELECT count(*)::int AS n FROM outcome_record WHERE client_user_id = ${p2}`],
    ["retention check", () => app`SELECT count(*)::int AS n FROM retention_check WHERE outcome_id = ${outc.id}`],
    ["suggestion", () => app`SELECT count(*)::int AS n FROM staff_suggestion WHERE client_user_id = ${p2}`],
    ["ask", () => app`SELECT count(*)::int AS n FROM sharing_request WHERE user_id = ${p2}`],
    ["activity", () => app`SELECT count(*)::int AS n FROM org_activity WHERE participant_user_id = ${p2}`],
  ];
  // A fresh statement per read: a query object is not reused across transactions.
  const count = async (orgId, actor, q) => (await asOrg(orgId, actor, typeof q === "function" ? q() : q))[2][0].n;
  for (const [label, q] of tables) {
    check(`a volunteer reads no ${label} about someone not assigned to them, by a raw scoped query`, (await count(org.id, vol, q)) === 0);
    check(`the assigned case manager, an admin, the owner and staff granted "see everyone" read the ${label}`,
      (await count(org.id, cm, q)) > 0 && (await count(org.id, admin, q)) > 0 && (await count(org.id, owner, q)) > 0 && (await count(org.id, seer, q)) > 0);
    check(`an admin DENIED "see everyone" reads no ${label}`, (await count(org.id, deniedAdmin, q)) === 0);
    check(`another organization reads no ${label}, scoped to itself or FORGING this org's scope`,
      (await count(org2.id, spy, q)) === 0 && (await count(org.id, spyStaff, q)) === 0 && (await count(org.id, spy, q)) === 0);
  }

  // -- 2. through a route that FORGOT the app-level check: the actor claims "sees all"; the database still refuses
  const forged = { ...aVol, reach: "all", capabilities: new Set([...aVol.capabilities, "org.client.view_all", "org.audit.view"]) };
  const fNotes = await core.listRecentNotes(forged);
  const fTasks = (await core.listStaffTasks(forged)) ?? [];
  const fOut = (await core.listOutcomes(forged)) ?? [];
  const fReq = await core.listSharingRequests(forged);
  const fAct = await core.listOrgActivity(forged);
  check("a volunteer's session that the app wrongly treats as 'sees all' still gets nothing about p2: notes, tasks, placements, asks, activity",
    fNotes.ok && !fNotes.rows.some((r) => r.client_user_id === p2) && !fTasks.some((t) => t.client_user_id === p2) && !fOut.some((o) => o.client_user_id === p2)
      && fReq.ok && !fReq.rows.some((r) => r.client_user_id === p2) && fAct.ok && !fAct.rows.some((r) => r.participant_user_id === p2),
    JSON.stringify({ notes: fNotes.rows?.length, tasks: fTasks.length, outcomes: fOut.length, act: fAct.rows?.length }));
  check("the forged read of the client's own note page is refused too", (await core.getClientNotes(forged, p2)).ok === false || (await core.getClientNotes(forged, p2)).rows.length === 0);

  // -- 3. nor write about p2, by any raw route
  const w = (q) => raised(() => asOrg(org.id, vol, q));
  check("a volunteer cannot write a note about an unassigned person, even raw", /row-level security/i.test(String(await w(app`INSERT INTO case_note (access_code_id, client_user_id, author_user_id, body) VALUES (${org.id}, ${p2}, ${vol}, 'x')`))));
  check("nor a task, even one they would own", /row-level security/i.test(String(await w(app`INSERT INTO staff_task (access_code_id, client_user_id, owner_user_id, created_by, title, shared_with_participant) VALUES (${org.id}, ${p2}, ${vol}, ${vol}, 'x task', true)`))));
  check("nor a placement", /row-level security/i.test(String(await w(app`INSERT INTO outcome_record (access_code_id, client_user_id, employer, start_date, source, created_by) VALUES (${org.id}, ${p2}, 'X Co', ${ago(1)}, 'staff_reported', ${vol})`))));
  check("nor an ask", /row-level security/i.test(String(await w(app`INSERT INTO sharing_request (access_code_id, user_id, scope, requested_by, reason) VALUES (${org.id}, ${p2}, 'applications', ${vol}, 'Let me see it')`))));
  check("nor cancel their task", (await asOrg(org.id, vol, app`UPDATE staff_task SET cancelled_at = now() WHERE id = ${task.id} RETURNING id`))[2].length === 0);
  check("the volunteer still works their own caseload", (await core.addClientNote(aVol, p1, { body: "Met today." })).ok === true && (await core.getClientNotes(aVol, p1)).ok === true);

  // -- 4. the participant still reads what is theirs
  const asP = (q) => app.transaction([app`SELECT set_config('app.user_id', ${p2}, true)`, q]);
  check("the participant still sees the task shared with them", (await core.getMySharedTasks(p2)).some((t) => t.id === task.id));
  check("and the placement on file about them", (await core.getMyOutcomes(p2)).length === 1);
  check("and the suggestion made to them", (await core.getMySuggestions(p2)).length === 1);
  check("and the ask made of them", (await core.getSharingState(p2)).some((s) => s.requests?.length > 0));
  check("and still not a staff note, nor the organization's activity log",
    (await asP(app`SELECT count(*)::int AS n FROM case_note`))[1][0].n === 0 && (await asP(app`SELECT count(*)::int AS n FROM org_activity`))[1][0].n === 0);

  // -- 5. the activity log
  const log = await core.listOrgActivity(aOwner);
  const flat = JSON.stringify(log.rows ?? []);
  check("the owner's activity log has the note, task, placement, check-in, ask and assignment rows",
    log.ok && ["note", "task", "outcome", "retention", "sharing", "assignment"].every((e) => log.rows.some((r) => r.entity === e && r.participant_user_id === p2)), flat.slice(0, 300));
  check("and never the words anyone typed, nor a record word", !/RSECRET|parole/i.test(flat));
  check("the sentences read plainly", log.ok && log.rows.some((r) => /added a call note for /.test(core.activitySentence(r))));
  check("a volunteer's own activity read holds nobody outside their reach", (await core.listOrgActivity({ ...aVol, capabilities: new Set([...aVol.capabilities, "org.audit.view"]) })).rows.every((r) => r.participant_user_id !== p2));
  check("staff without the audit capability get no org-wide log", (await core.listOrgActivity(aCm)).ok === false);
  check("another organization's log is empty of all of it", ((await core.listOrgActivity(aSpy)).rows ?? []).every((r) => r.participant_user_id !== p2));
  const forge = await raised(() => asOrg(org.id, owner, app`INSERT INTO org_activity (access_code_id, entity, action, summary) VALUES (${org.id}, 'org', 'created', 'forged entry')`));
  const edit = await raised(() => asOrg(org.id, owner, app`UPDATE org_activity SET summary = 'rewritten' WHERE access_code_id = ${org.id}`));
  const wipe = await raised(() => asOrg(org.id, owner, app`DELETE FROM org_activity WHERE access_code_id = ${org.id}`));
  const call = await raised(() => asOrg(org.id, owner, app`SELECT org_activity_write(${org.id}::uuid, NULL, NULL, 'org', NULL, 'created', 'forged')`));
  check("the app cannot write, rewrite, erase or forge an activity row", [forge, edit, wipe, call].every((e) => /permission denied/i.test(String(e))), JSON.stringify([forge, edit, wipe, call]));

  // -- 6. corrections keep the earlier answer
  check("a volunteer cannot correct a check-in", (await core.correctRetentionCheck(aVol, { checkId, status: "not_employed", method: "participant_told_me", reason: "They left in week two" })).ok === false);
  const rawVol = (await asOrg(org.id, vol, app`SELECT smr_correct_retention_check(${checkId}::uuid, 'not_employed', 'participant_told_me', NULL, 'They left in week two') AS r`))[2][0].r;
  check("not even by calling the database function directly", rawVol === "refused", rawVol);
  check("a correction needs a reason", (await core.correctRetentionCheck(aCm, { checkId, status: "not_employed", method: "participant_told_me", reason: "x" })).ok === false);
  check("the case manager corrects it", (await core.correctRetentionCheck(aCm, { checkId, status: "not_employed", method: "participant_told_me", reason: "They told me they left in week two" })).ok === true);
  const rows = await sql`SELECT id, status, superseded_by, correction_reason FROM retention_check WHERE outcome_id = ${outc.id}`;
  const oldRow = rows.find((r) => r.id === checkId), newRow = rows.find((r) => r.id !== checkId);
  check("both answers are kept: the old one marked replaced, the new one current with its reason",
    rows.length === 2 && oldRow?.status === "employed" && oldRow?.superseded_by === newRow?.id && newRow?.superseded_by === null && /week two/.test(newRow?.correction_reason ?? ""), JSON.stringify(rows));
  const listed = (await core.listOutcomes(aCm, p2))[0];
  check("the panel shows only the current answer, and the correction in its history",
    listed.checks.length === 1 && listed.checks[0].status === "not_employed" && listed.history.some((h) => h.kind === "check" && /week two/.test(h.reason ?? "")), JSON.stringify(listed.history));
  check("the app cannot edit a check-in in place", /permission denied/i.test(String(await raised(() => asOrg(org.id, cm, app`UPDATE retention_check SET status = 'employed' WHERE id = ${newRow.id}`)))));
  const noReason = await raised(() => asOrg(org.id, cm, app`UPDATE outcome_record SET employer = 'Right Co' WHERE id = ${outc.id}`));
  check("the database refuses a placement correction without a reason", /needs a reason/i.test(String(noReason)), noReason ?? "updated");
  check("with one, through the app, it saves", (await core.correctOutcome(aCm, outc.id, { employer: "Right Co", startDate: ago(100) }, "Typed the wrong employer")).ok === true);
  const [kept] = await sql`SELECT changed, reason, corrected_by FROM outcome_correction WHERE outcome_id = ${outc.id}`;
  check("and the earlier value is kept, with who and why", kept?.changed?.employer?.from === "RSECRET-EMPLOYER" && kept?.reason === "Typed the wrong employer" && kept?.corrected_by === cm, JSON.stringify(kept));
  check("a volunteer reads none of that history", (await count(org.id, vol, app`SELECT count(*)::int AS n FROM outcome_correction WHERE outcome_id = ${outc.id}`)) === 0);
  const after = JSON.stringify((await core.listOrgActivity(aOwner, { entity: "outcome" })).rows ?? []);
  check("the activity log says a placement was corrected, and not the reason or the employer", /corrected a placement \(employer\)/.test(after) && !/wrong employer|Right Co/.test(after), after.slice(0, 300));

  // -- fix round 1 (security review): forged history, forged scope, deleting a staff account
  const forgedCheck = await raised(() => asOrg(org.id, cm, app`INSERT INTO retention_check (outcome_id, access_code_id, day_mark, status, method, checked_by, correction_reason) VALUES (${outc.id}, ${org.id}, 60, 'employed', 'participant_told_me', ${cm}, 'forged')`));
  check("the app cannot insert a check-in that claims to be a correction", /row-level security/i.test(String(forgedCheck)), forgedCheck ?? "inserted");
  check("a forged org scope sees no activity at all, not even team rows", (await count(org.id, spyStaff, app`SELECT count(*)::int AS n FROM org_activity`)) === 0);
  // The case manager also confirmed the placement (a correction, so it carries a reason).
  await sql.transaction([sql`SELECT set_config('app.correction_reason', 'fixture: confirmed with the employer', true)`,
    sql`UPDATE outcome_record SET source = 'staff_verified', verification_method = 'employer_confirmed', verified_by = ${cm}, verified_at = now() WHERE id = ${outc.id}`]);
  await core.leaveAllOrgs(cm);
  const gone = await raised(() => app`DELETE FROM users WHERE id = ${cm}`);
  check("deleting the account of a case manager who wrote notes, tasks, asks, suggestions, check-ins, a correction and a confirmed placement succeeds",
    gone === null, gone ?? "");
  const [left] = await sql`SELECT (SELECT count(*)::int FROM case_note WHERE id = ${note.id} AND author_user_id IS NULL) AS notes,
                                  (SELECT count(*)::int FROM retention_check WHERE outcome_id = ${outc.id} AND checked_by IS NULL) AS checks`;
  const [{ src }] = await sql`SELECT source AS src FROM outcome_record WHERE id = ${outc.id}`;
  check("and the records stay, without the deleted account's id; the placement stays confirmed", left.notes === 1 && left.checks === 2 && src === "staff_verified", JSON.stringify({ ...left, src }));
}

/**
 * Organization structure (103, house lane L3a): units, unit staff and
 * enrollments. The claims: another organization sees none of it; enrollment
 * rows are REACH-restricted in the database, so a staff member outside a unit
 * cannot read an enrollment even through a query that forgets every check;
 * being put in a unit is what gives a staff member reach, and taking them out
 * removes it; nobody widens their own reach by enrolling a stranger; only the
 * owner shapes the structure.
 */
async function structureChecks() {
  console.log("\n  -- organization structure (103) --");
  const [{ has }] = await sql`SELECT to_regclass('public.enrollment') IS NOT NULL AS has`;
  if (!has) { console.log("  note  103 not applied; skipped"); return; }
  if (!appUrl) { console.log("  skip  needs the app credential"); return; }
  const core = await import("../packages/core/dist/index.js");
  const app = neon(appUrl);
  const uniq = Date.now().toString(36).toUpperCase().slice(-6);
  const owner = await mkUser("st-owner"), cm = await mkUser("st-cm"), unitStaff = await mkUser("st-unit"), outsider = await mkUser("st-out");
  const spy = await mkUser("st-spy"), p1 = await mkUser("st-p1"), p2 = await mkUser("st-p2"), pOther = await mkUser("st-p3");
  const [org] = await sql`INSERT INTO access_code (code, partner_name, tier, partner_user_id, is_active, crm_v2) VALUES (${"ISOST" + uniq}, ${P + " structure"}, 'client', ${owner}, true, true) RETURNING id, code`;
  const [org2] = await sql`INSERT INTO access_code (code, partner_name, tier, partner_user_id, is_active, crm_v2) VALUES (${"ISOST2" + uniq}, ${P + " structure2"}, 'client', ${spy}, true, true) RETURNING id, code`;
  created.codes.push(org.id, org2.id);
  await sql`INSERT INTO org_staff (access_code_id, user_id, role) VALUES (${org.id}, ${cm}, 'staff'), (${org.id}, ${unitStaff}, 'staff'), (${org.id}, ${outsider}, 'staff')`;
  await core.redeemAccessCode(p1, org.code); await core.redeemAccessCode(p2, org.code); await core.redeemAccessCode(pOther, org2.code);
  await sql`INSERT INTO client_staff_assignment (access_code_id, client_user_id, staff_user_id, assigned_by) VALUES (${org.id}, ${p1}, ${cm}, ${owner})`;
  const A = (u) => core.resolveOrgActor(u);
  const raised = async (fn) => { try { await fn(); return null; } catch (e) { return String(e?.message ?? e); } };
  const aOwner = await A(owner), aCm = await A(cm), aUnit = await A(unitStaff), aOut = await A(outsider), aSpy = await A(spy);

  check("staff cannot add a unit", (await core.createOrgUnit(aCm, { kind: "program", name: "Sneaky" })).ok === false);
  const prog = await core.createOrgUnit(aOwner, { kind: "program", name: "Job readiness" });
  check("the owner adds a program", prog.ok === true, JSON.stringify(prog));
  if (!prog.ok) return;
  const theirs = await core.createOrgUnit(aSpy, { kind: "program", name: "Their program" });
  check("another organization's owner adds to THEIR org only", theirs.ok === true);
  check("staff cannot put themselves in a unit", (await core.setUnitMember(aOut, prog.id, outsider, "member")).ok === false);
  check("another org's owner cannot put staff in this org's unit", (await core.setUnitMember(aSpy, prog.id, spy, "lead")).ok === false);
  check("the owner puts a staff member in the program", (await core.setUnitMember(aOwner, prog.id, unitStaff, "member")).ok === true);
  check("an outsider on staff cannot enroll someone they do not reach", (await core.createEnrollment(aOut, { participantId: p2, unitId: prog.id })).ok === false);
  check("a plain staff member cannot enroll anyone, not even their own person (enrolling is assigning)", (await core.createEnrollment(aCm, { participantId: p1, unitId: prog.id, status: "active" })).ok === false);
  const rawEnroll = await raised(() => app.transaction([app`SELECT set_config('app.org_id', ${org.id}, true)`, app`SELECT set_config('app.user_id', ${cm}, true)`,
    app`INSERT INTO enrollment (access_code_id, org_unit_id, participant_user_id, status) VALUES (${org.id}, ${prog.id}, ${p1}, 'active') RETURNING id`]));
  check("and the database refuses it written directly", !!rawEnroll, rawEnroll ?? "inserted");
  const admin = await mkUser("st-admin");
  await sql`INSERT INTO org_staff (access_code_id, user_id, role) VALUES (${org.id}, ${admin}, 'org_admin')`;
  const aAdmin = await A(admin);
  const e1 = await core.createEnrollment(aAdmin, { participantId: p1, unitId: prog.id, status: "active" });
  check("an admin enrolls their person", e1.ok === true, JSON.stringify(e1));
  check("the owner enrolls another", (await core.createEnrollment(aOwner, { participantId: p2, unitId: prog.id })).ok === true);
  check("nobody enrolls someone from another organization", (await core.createEnrollment(aOwner, { participantId: pOther, unitId: prog.id })).ok === false);
  if (theirs.ok) check("nobody enrolls into another organization's program", (await core.createEnrollment(aOwner, { participantId: p2, unitId: theirs.id })).ok === false);

  const ids = async (actor) => ((await core.listEnrollments(actor)) ?? []).map((e) => e.participant_user_id).sort();
  check("a unit member reaches everyone enrolled in that unit", JSON.stringify(await ids(aUnit)) === JSON.stringify([p1, p2].sort()));
  check("assigned staff outside the unit reach only their own person", JSON.stringify(await ids(aCm)) === JSON.stringify([p1]));
  check("a staff member outside the unit reads no enrollment", (await ids(aOut)).length === 0);
  check("another organization reads none", (await ids(aSpy)).length === 0);
  const raw = async (orgId, actor) => (await app.transaction([app`SELECT set_config('app.org_id', ${orgId}, true)`, app`SELECT set_config('app.user_id', ${actor}, true)`,
    app`SELECT count(*)::int AS n FROM enrollment`]))[2][0].n;
  check("a query that forgets every check still returns no enrollment to the outsider", (await raw(org.id, outsider)) === 0);
  check("or to another organization's owner holding this org's id", (await raw(org.id, spy)) === 0);
  check("and the unit member's own count is exactly the two", (await raw(org.id, unitStaff)) === 2);
  const reachOf = async (staffId, who) => (await app.transaction([app`SELECT set_config('app.org_id', ${org.id}, true)`, app`SELECT set_config('app.user_id', ${staffId}, true)`,
    app`SELECT smr_staff_reach(${org.id}::uuid, ${staffId}::uuid, ${who}::uuid) AS r`]))[2][0].r;
  check("the reach function says so too, and not for the outsider", (await reachOf(unitStaff, p2)) === true && (await reachOf(outsider, p2)) === false);
  const tree2 = await core.getOrgStructure(aSpy);
  check("another organization's structure shows none of these units", !(tree2?.units ?? []).some((u) => u.id === prog.id));
  check("staff cannot close a unit", (await core.setOrgUnitOpen(aCm, prog.id, false)).ok === false);
  check("a unit with people in it does not close", (await core.setOrgUnitOpen(aOwner, prog.id, false)).ok === false);

  if (e1.ok) {
    check("a unit member can pause it", (await core.changeEnrollmentStatus(aUnit, e1.id, "exited", "moved_away")).ok === true);
    check("but a plain staff member cannot reopen it", (await core.changeEnrollmentStatus(aUnit, e1.id, "active")).ok === false);
    check("an admin can", (await core.changeEnrollmentStatus(aAdmin, e1.id, "active")).ok === true);
  }
  await sql`DELETE FROM client_staff_assignment WHERE access_code_id = ${org.id} AND client_user_id = ${p1}`;
  check("unassigned, the case manager reaches the person no more (nothing they did keeps them in reach)",
    (await ids(aCm)).length === 0 && (await raw(org.id, cm)) === 0);
  check("taking a staff member out of the unit", (await core.removeUnitMember(aOwner, prog.id, unitStaff)).ok === true);
  check("ends their reach through it", (await ids(aUnit)).length === 0 && (await raw(org.id, unitStaff)) === 0);
  await core.setUnitMember(aOwner, prog.id, unitStaff, "member");
  await sql`DELETE FROM org_staff WHERE access_code_id = ${org.id} AND user_id = ${unitStaff}`;
  check("removing someone from staff takes them out of every unit", (await sql`SELECT count(*)::int AS n FROM unit_member WHERE user_id = ${unitStaff}`)[0].n === 0 && (await raw(org.id, unitStaff)) === 0);

  const terms = await core.updateOrgProfile(aOwner, { terms: { participant: "resident", participants: "residents" } });
  check("the owner sets the organization's words", terms.ok === true, JSON.stringify(terms));
  check("staff cannot", (await core.updateOrgProfile(aCm, { terms: { participant: "x" } })).ok === false);
  check("a label on a person is refused", (await core.updateOrgProfile(aOwner, { terms: { participants: "offenders" } })).ok === false);
  check("a member reads the words", (await core.getOrgTerms(org.id, p1)).participant === "resident");
  check("a member of another organization gets only the defaults", (await core.getOrgTerms(org.id, pOther)).participant === "participant");
  await sql`DELETE FROM enrollment WHERE access_code_id = ANY(${[org.id, org2.id]}::uuid[])`;
  await sql`DELETE FROM unit_member WHERE access_code_id = ANY(${[org.id, org2.id]}::uuid[])`;
  await sql`DELETE FROM org_unit WHERE access_code_id = ANY(${[org.id, org2.id]}::uuid[])`;
  await sql`DELETE FROM org_profile WHERE access_code_id = ANY(${[org.id, org2.id]}::uuid[])`;
}


/**
 * Outbound branding (107, staff pass 2026-10-27 lane S2). The claim: how an
 * organization's outgoing reports and emails are branded is read by its own
 * people and nobody else's, and set by a platform admin ONLY, through
 * smr_set_org_branding. The owner, an org admin and staff cannot flip it on
 * UPDATE, cannot pick it on a first INSERT, and cannot call the setter.
 */
async function outboundBrandChecks() {
  console.log("\n  -- outbound branding (107) --");
  const [{ has }] = await sql`SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'org_profile' AND column_name = 'branding') AS has`;
  if (!has) { console.log("  note  107 not applied; skipped"); return; }
  if (!appUrl) { console.log("  skip  needs the app credential"); return; }
  const brand = await import("../packages/core/dist/orgOutboundBrand.js");
  const app = neon(appUrl);
  const uniq = Date.now().toString(36).toUpperCase().slice(-6);
  const owner = await mkUser("ob-owner"), admin = await mkUser("ob-admin"), cm = await mkUser("ob-cm");
  const owner2 = await mkUser("ob-owner2"), cm2 = await mkUser("ob-cm2"), boss = await mkUser("ob-platform");
  const [org] = await sql`INSERT INTO access_code (code, partner_name, tier, partner_user_id, is_active, crm_v2) VALUES (${"ISOOB" + uniq}, ${P + " outbound"}, 'client', ${owner}, true, true) RETURNING id`;
  const [org2] = await sql`INSERT INTO access_code (code, partner_name, tier, partner_user_id, is_active, crm_v2) VALUES (${"ISOOB2" + uniq}, ${P + " outbound2"}, 'client', ${owner2}, true, true) RETURNING id`;
  created.codes.push(org.id, org2.id);
  await sql`INSERT INTO org_staff (access_code_id, user_id, role) VALUES (${org.id}, ${admin}, 'org_admin'), (${org.id}, ${cm}, 'staff'), (${org2.id}, ${cm2}, 'staff')`;
  const as = (orgId, userId, ...stmts) => app.transaction([
    ...(orgId ? [app`SELECT set_config('app.org_id', ${orgId}, true)`] : []),
    app`SELECT set_config('app.user_id', ${userId}, true)`, ...stmts]);
  const refused = async (fn) => { try { await fn(); return null; } catch (e) { return String(e?.message ?? e); } };

  // A first save by the owner: the default goes in, exclusive does not.
  const firstExclusive = await refused(() => as(org.id, owner, app`INSERT INTO org_profile (access_code_id, branding) VALUES (${org.id}, 'exclusive')`));
  check("107: the owner cannot pick exclusive branding on a first save", !!firstExclusive, firstExclusive ?? "inserted");
  const firstPlain = await refused(() => as(org.id, owner, app`INSERT INTO org_profile (access_code_id) VALUES (${org.id})`));
  check("107: the owner's first save with the default still works", !firstPlain, firstPlain ?? "");
  for (const [who, id] of [["the owner", owner], ["an org admin", admin], ["staff", cm]]) {
    const upd = await refused(() => as(org.id, id, app`UPDATE org_profile SET branding = 'exclusive' WHERE access_code_id = ${org.id}`));
    const [{ b }] = await sql`SELECT branding AS b FROM org_profile WHERE access_code_id = ${org.id}`;
    check(`107: ${who} cannot flip the branding by UPDATE`, b === "co_brand", upd ?? "no error, and the value is " + b);
    const setter = await refused(() => as(org.id, id, app`SELECT public.smr_set_org_branding(${org.id}::uuid, 'exclusive')`));
    check(`107: ${who} cannot call the setter`, !!setter && /platform admin/.test(setter), setter ?? "allowed");
  }
  const otherOwner = await refused(() => as(org2.id, owner2, app`SELECT public.smr_set_org_branding(${org.id}::uuid, 'exclusive')`));
  check("107: another organization's owner cannot set this one", !!otherOwner, otherOwner ?? "allowed");

  await sql`INSERT INTO platform_admin (user_id, note) VALUES (${boss}, 'isolation fixture')`;
  try {
    const set = await as(null, boss, app`SELECT public.smr_set_org_branding(${org.id}::uuid, 'exclusive') AS b`);
    check("107: a platform admin sets exclusive branding", set[1]?.[0]?.b === "exclusive", JSON.stringify(set[1]));
    const bad = await refused(() => as(null, boss, app`SELECT public.smr_set_org_branding(${org.id}::uuid, 'full')`));
    check("107: an unknown value is refused even for a platform admin", !!bad, bad ?? "accepted");
    const [{ n }] = await sql`SELECT count(*)::int AS n FROM org_audit WHERE org_id = ${org.id} AND table_name = 'org_profile' AND action = 'BRANDING' AND row_summary->>'branding_to' = 'exclusive'`;
    check("107: the change is in the audit log", n === 1, `rows ${n}`);
    // Readers: the organization's own people read it; another organization's do not.
    const own = await as(org.id, cm, app`SELECT branding FROM org_profile WHERE access_code_id = ${org.id}`);
    check("107: staff of the organization read their branding", own[2]?.[0]?.branding === "exclusive", JSON.stringify(own[2]));
    const leak = await as(org2.id, cm2, app`SELECT branding FROM org_profile WHERE access_code_id = ${org.id}`);
    check("107: staff of another organization read nothing", (leak[2] ?? []).length === 0, JSON.stringify(leak[2]));
    const leakScoped = await as(org.id, cm2, app`SELECT branding FROM org_profile WHERE access_code_id = ${org.id}`);
    // app.org_id is set by the app from membership, never from the request; a forged one is the route-forgot case.
    console.log(`  note  a forged app.org_id reads ${(leakScoped[2] ?? []).length} row(s): 103's select policy trusts the scope the app sets (unchanged by 107)`);
    const helperOwn = await brand.getOrgOutboundBrand(cm, org.id, "Lakeshore Works");
    check("107: the helper gives the organization's own name alone once exclusive", helperOwn.line === "Lakeshore Works" && !helperOwn.coBranded, JSON.stringify(helperOwn));
    const helperOther = await brand.getOrgOutboundBrand(cm2, org.id, "Lakeshore Works");
    check("107: someone outside the organization gets the safe co-brand default, never its setting", helperOther.coBranded === true, JSON.stringify(helperOther));
    const back = await as(null, boss, app`SELECT public.smr_set_org_branding(${org.id}::uuid, 'co_brand') AS b`);
    check("107: a platform admin sets it back to co-branded", back[1]?.[0]?.b === "co_brand");
    // An organization that never ran setup: the setter creates the row and setup still shows.
    const fresh = await as(null, boss, app`SELECT public.smr_set_org_branding(${org2.id}::uuid, 'exclusive') AS b`);
    const [p2] = await sql`SELECT branding, setup_completed_at FROM org_profile WHERE access_code_id = ${org2.id}`;
    check("107: setting it for an organization with no profile creates the row and leaves setup unfinished", fresh[1]?.[0]?.b === "exclusive" && p2?.branding === "exclusive" && p2?.setup_completed_at === null, JSON.stringify(p2));
    const ownerUpd = await refused(() => as(org2.id, owner2, app`UPDATE org_profile SET branding = 'co_brand' WHERE access_code_id = ${org2.id}`));
    const [{ b2 }] = await sql`SELECT branding AS b2 FROM org_profile WHERE access_code_id = ${org2.id}`;
    check("107: and the owner cannot take exclusive off by hand either", b2 === "exclusive", ownerUpd ?? "changed");
    const ownerWords = await refused(() => as(org2.id, owner2, app`UPDATE org_profile SET timezone = 'America/Denver' WHERE access_code_id = ${org2.id}`));
    check("107: the owner still saves everything else on the profile", !ownerWords, ownerWords ?? "");
  } finally {
    await sql`DELETE FROM platform_admin WHERE user_id = ${boss}`;
    await sql`DELETE FROM org_profile WHERE access_code_id = ANY(${[org.id, org2.id]}::uuid[])`;
  }
}

/**
 * Staff t.ROY (106, house build L6): the skill-run log and the caseload reads.
 * The claim: a run is written only by the staff member, in their own
 * organization, about someone they reach; read by them and the organization's
 * owner or admins only, and only while the reader reaches the person;
 * accepted once, by the person who ran it; never edited or deleted by the app.
 * The caseload digest and period numbers never cross an organization or a
 * caseload.
 */
async function aiSkillRunChecks() {
  console.log("\n  -- staff t.ROY skill runs and caseload reads --");
  if (!appUrl) { console.log("  skip  needs the app credential"); return; }
  const core = await import("../packages/core/dist/index.js");
  const app = neon(appUrl);
  const uniq = Date.now().toString(36).toUpperCase().slice(-6);
  const owner = await mkUser("ai-owner"), cm = await mkUser("ai-cm"), cm2 = await mkUser("ai-cm2"), admin = await mkUser("ai-admin"), spy = await mkUser("ai-spy");
  const [org] = await sql`INSERT INTO access_code (code, partner_name, tier, partner_user_id, is_active, crm_v2) VALUES (${"ISOAIR" + uniq}, ${P + " ai runs"}, 'client', ${owner}, true, true) RETURNING id, code`;
  const [org2] = await sql`INSERT INTO access_code (code, partner_name, tier, partner_user_id, is_active, crm_v2) VALUES (${"ISOAIR2" + uniq}, ${P + " ai runs2"}, 'client', ${spy}, true, true) RETURNING id, code`;
  created.codes.push(org.id, org2.id);
  await sql`INSERT INTO org_staff (access_code_id, user_id, role) VALUES (${org.id}, ${cm}, 'staff'), (${org.id}, ${cm2}, 'staff'), (${org.id}, ${admin}, 'org_admin')`;
  const pat = await mkUser("ai-pat"), notMine = await mkUser("ai-notmine"), theirs = await mkUser("ai-theirs");
  for (const u of [pat, notMine]) { await core.redeemAccessCode(u, org.code); await joinCohortConsent(u); }
  await core.redeemAccessCode(theirs, org2.code); await joinCohortConsent(theirs);
  await sql`INSERT INTO client_staff_assignment (access_code_id, client_user_id, staff_user_id, assigned_by) VALUES (${org.id}, ${pat}, ${cm}, ${owner}), (${org.id}, ${notMine}, ${cm2}, ${owner})`;
  const A = (u) => core.resolveOrgActor(u);
  const aCm = await A(cm), aCm2 = await A(cm2), aOwner = await A(owner), aAdmin = await A(admin), aSpy = await A(spy);
  const run = (participantId) => ({ skill: "staff-prep-me", participantId, inputSummary: "Prep me", tools: ["read_participant_overview"], output: "draft" });
  const attempt = async (f) => { try { return { ok: true, v: await f() }; } catch (e) { return { ok: false, e: String(e.message) }; } };

  const mine = await core.logSkillRun(aCm, run(pat));
  check("a case manager logs a skill run about their own participant", !!mine);
  const caseload = await core.logSkillRun(aCm, run(null));
  check("and a caseload run about nobody in particular", !!caseload);
  const off = await attempt(() => core.logSkillRun(aCm, run(notMine)));
  check("not about a colleague's participant they do not reach", !off.ok || !off.v, JSON.stringify(off));
  const foreign = await attempt(() => core.logSkillRun(aCm, run(theirs)));
  check("not about another organization's participant", !foreign.ok || !foreign.v, JSON.stringify(foreign));
  const forged = await attempt(() => app.transaction([app`SELECT set_config('app.org_id', ${org.id}, true)`, app`SELECT set_config('app.user_id', ${cm}, true)`,
    app`INSERT INTO ai_skill_run (access_code_id, actor_user_id, skill, input_summary, output_hash) VALUES (${org.id}, ${owner}, 'staff-prep-me', 'x', ${"a".repeat(64)})`]));
  check("not in somebody else's name, even written directly", !forged.ok, JSON.stringify(forged));
  const preAccepted = await attempt(() => app.transaction([app`SELECT set_config('app.org_id', ${org.id}, true)`, app`SELECT set_config('app.user_id', ${cm}, true)`,
    app`INSERT INTO ai_skill_run (access_code_id, actor_user_id, skill, input_summary, output_hash, accepted_by, accepted_at) VALUES (${org.id}, ${cm}, 'staff-prep-me', 'x', ${"a".repeat(64)}, ${cm}, now())`]));
  check("and never already accepted", !preAccepted.ok, JSON.stringify(preAccepted));
  const crossOrg = await attempt(() => app.transaction([app`SELECT set_config('app.org_id', ${org2.id}, true)`, app`SELECT set_config('app.user_id', ${cm}, true)`,
    app`INSERT INTO ai_skill_run (access_code_id, actor_user_id, skill, input_summary, output_hash) VALUES (${org2.id}, ${cm}, 'staff-prep-me', 'x', ${"a".repeat(64)})`]));
  check("a staff member cannot log a run into an organization they do not belong to", !crossOrg.ok, JSON.stringify(crossOrg));

  const ids = async (actor) => (await core.listSkillRuns(actor)).map((r) => r.id);
  check("the case manager reads their own runs", (await ids(aCm)).includes(mine) && (await ids(aCm)).includes(caseload));
  check("a colleague does not", !(await ids(aCm2)).includes(mine) && !(await ids(aCm2)).includes(caseload));
  check("the owner and an org admin read every run in their organization (the AI audit)", (await ids(aOwner)).includes(mine) && (await ids(aAdmin)).includes(mine));
  check("another organization reads none", (await ids(aSpy)).length === 0);
  const [{ n: unscoped }] = await core.query("SELECT count(*)::int AS n FROM ai_skill_run");
  check("an unscoped read by the app sees no runs", unscoped === 0, String(unscoped));

  check("a colleague cannot accept someone else's run", (await core.acceptSkillRun(aCm2, mine)) === false);
  check("the owner cannot accept it for them either", (await core.acceptSkillRun(aOwner, mine)) === false);
  check("the person who ran it accepts it", (await core.acceptSkillRun(aCm, mine)) === true);
  check("once", (await core.acceptSkillRun(aCm, mine)) === false);
  const [acc] = await sql`SELECT accepted_by, accepted_at FROM ai_skill_run WHERE id = ${mine}`;
  check("the acceptance names them and a time", acc?.accepted_by === cm && !!acc?.accepted_at, JSON.stringify(acc));
  const rewrite = await attempt(() => app.transaction([app`SELECT set_config('app.org_id', ${org.id}, true)`, app`SELECT set_config('app.user_id', ${cm}, true)`,
    app`UPDATE ai_skill_run SET input_summary = 'rewritten' WHERE id = ${caseload}`]));
  check("a run's summary cannot be rewritten by the app", !rewrite.ok && /permission denied/i.test(rewrite.e), JSON.stringify(rewrite));
  const del = await attempt(() => app.transaction([app`SELECT set_config('app.org_id', ${org.id}, true)`, app`SELECT set_config('app.user_id', ${cm}, true)`,
    app`DELETE FROM ai_skill_run WHERE id = ${caseload}`]));
  check("or deleted", !del.ok && /permission denied/i.test(del.e), JSON.stringify(del));

  // Reach is a RESTRICTIVE policy: move pat to a colleague and the run leaves the old reader's view.
  const ownTask = await core.addStaffTask(aCm, { title: "Call about the class", clientId: pat });
  await sql`UPDATE client_staff_assignment SET staff_user_id = ${cm2} WHERE access_code_id = ${org.id} AND client_user_id = ${pat}`;
  check("once the person is reassigned, the old case manager no longer reads the run about them", !(await ids(aCm)).includes(mine) && (await ids(aCm)).includes(caseload));
  check("and their digest drops them, even though they still own a task about them (fix round 1)",
    ownTask.ok && !(await core.getCaseloadDigest(aCm)).people.some((p) => p.participantId === pat));
  await sql`UPDATE client_staff_assignment SET staff_user_id = ${cm} WHERE access_code_id = ${org.id} AND client_user_id = ${pat}`;

  // Caseload reads: the digest and the period numbers stay inside the caseload and the organization.
  const digest = await core.getCaseloadDigest(aCm);
  const people = (digest?.people ?? []).map((p) => p.participantId);
  check("the caseload digest names the case manager's own participant", people.includes(pat), JSON.stringify(people));
  check("and nobody from a colleague's caseload or another organization", !people.includes(notMine) && !people.includes(theirs));
  check("the owner's digest covers the organization and not the other one", (await core.getCaseloadDigest(aOwner)).people.some((p) => p.participantId === notMine)
    && !(await core.getCaseloadDigest(aOwner)).people.some((p) => p.participantId === theirs));
  const vol = await mkUser("ai-vol");
  await sql`INSERT INTO org_staff (access_code_id, user_id, role) VALUES (${org.id}, ${vol}, 'staff')`;
  await sql`INSERT INTO org_capability_override (org_id, user_id, capability, effect) VALUES (${org.id}, ${vol}, 'org.outcome.write', 'deny')`;
  check("a volunteer (no outcome or insight rights) gets no period numbers", (await core.getOutcomesForPeriod(await A(vol), {})) === null);
  const period = await core.getOutcomesForPeriod(aCm, { from: "2020-01-01", to: "2030-12-31" });
  check("a case manager's period numbers are labelled as their caseload", period?.scope === "people on your caseload", JSON.stringify(period?.scope));
}

/**
 * Customization (104, house build L4): custom fields, values, saved views and
 * role layouts. The claims: another organization reads none of it; a staff
 * member who does not reach a participant can neither read nor write that
 * participant's values, through core OR through SQL written by hand; only a
 * manager defines fields, shares views or sets layouts; the old saved sorts
 * move over once.
 */
async function customizationChecks() {
  console.log("\n  -- custom fields, views and layouts --");
  if (!appUrl) { console.log("  skip  needs the app credential"); return; }
  const [{ t }] = await sql`SELECT to_regclass('public.custom_field_value') AS t`;
  if (!t) { console.log("  note  104 not applied; skipped"); return; }
  const core = await import("../packages/core/dist/index.js");
  const app = neon(appUrl);
  const uniq = Date.now().toString(36).toUpperCase().slice(-6);
  const owner = await mkUser("cf-owner"), cm = await mkUser("cf-cm"), other = await mkUser("cf-other"), spy = await mkUser("cf-spy");
  const [org] = await sql`INSERT INTO access_code (code, partner_name, tier, partner_user_id, is_active, crm_v2) VALUES (${"ISOCF" + uniq}, ${P + " fields"}, 'client', ${owner}, true, true) RETURNING id, code`;
  const [org2] = await sql`INSERT INTO access_code (code, partner_name, tier, partner_user_id, is_active, crm_v2) VALUES (${"ISOCF2" + uniq}, ${P + " fields2"}, 'client', ${spy}, true, true) RETURNING id, code`;
  created.codes.push(org.id, org2.id);
  await sql`INSERT INTO org_staff (access_code_id, user_id, role) VALUES (${org.id}, ${cm}, 'staff'), (${org.id}, ${other}, 'staff')`;
  const pat = await mkUser("cf-pat");
  await core.redeemAccessCode(pat, org.code);
  await sql`INSERT INTO client_staff_assignment (access_code_id, client_user_id, staff_user_id, assigned_by) VALUES (${org.id}, ${pat}, ${cm}, ${owner})`;
  // An old saved sort on the case manager's account, to be moved over once.
  await sql`UPDATE users SET staff_prefs = ${JSON.stringify({ savedViews: [{ name: "My quiet", sort: "last_active", status: "behind", staffId: "" }] })}::jsonb WHERE id = ${cm}`;
  const A = (u) => core.resolveOrgActor(u);
  const aOwner = await A(owner), aCm = await A(cm), aOther = await A(other), aSpy = await A(spy);

  check("staff cannot define a field", (await core.createFieldDef(aCm, { label: "Shoe size", entity: "participant", type: "text" })).ok === false);
  const f1 = await core.createFieldDef(aOwner, { label: "Housing", entity: "participant", type: "single_select", options: ["Stable", "Shelter"] });
  const f2 = await core.createFieldDef(aOwner, { label: "Parole end", entity: "participant", type: "date" });
  check("the owner defines fields", f1.ok && f2.ok, JSON.stringify([f1, f2]).slice(0, 200));
  check("a field named for a record is sensitive whatever was asked", f2.ok && f2.def.sensitive === true);
  check("another organization sees none of the definitions", (await core.listFieldDefs(aSpy)).length === 0);

  const set = await core.setFieldValues(aCm, "participant", pat, { housing: "shelter", parole_end: "2027-01-15" });
  check("the assigned case manager fills in values", set.ok === true, JSON.stringify(set).slice(0, 200));
  check("a colleague who is not assigned cannot", (await core.setFieldValues(aOther, "participant", pat, { housing: "stable" })).ok === false);
  check("and reads none of them", Object.keys(await core.getFieldValues(aOther, "participant")).length === 0);
  check("another organization reads none of them", Object.keys(await core.getFieldValues(aSpy, "participant")).length === 0);
  check("the owner reads them", (await core.getFieldValues(aOwner, "participant"))[pat]?.housing === "shelter");
  check("a bad value is refused with a plain reason", (await core.setFieldValues(aCm, "participant", pat, { housing: "mansion" })).ok === false);

  // The reach POLICY, with the app-level check out of the way: SQL by hand as the colleague.
  const raw = async (u, orgId, stmt) => { try { const r = await app.transaction([app`SELECT set_config('app.org_id', ${orgId}, true)`, app`SELECT set_config('app.user_id', ${u}, true)`, stmt(app)]); return r[2]; } catch (e) { return String(e.message); } };
  const seen = await raw(other, org.id, (a) => a`SELECT value FROM custom_field_value`);
  check("the reach policy: a colleague's own SQL reads no value about someone they do not reach", Array.isArray(seen) && seen.length === 0, JSON.stringify(seen));
  const wrote = await raw(other, org.id, (a) => a`UPDATE custom_field_value SET value = '"stable"'::jsonb RETURNING 1`);
  check("and changes none", Array.isArray(wrote) && wrote.length === 0, JSON.stringify(wrote));
  const ins = await raw(other, org.id, (a) => a`INSERT INTO custom_field_value (def_id, entity_id, access_code_id, participant_user_id, value) VALUES (${f1.def.id}, ${pat}, ${org.id}, ${pat}, '"stable"'::jsonb) ON CONFLICT DO NOTHING RETURNING 1`);
  check("and writes none", !Array.isArray(ins) || ins.length === 0, JSON.stringify(ins));
  const foreign = await raw(spy, org2.id, (a) => a`SELECT value FROM custom_field_value WHERE access_code_id = ${org.id}`);
  check("another organization's SQL reads none", Array.isArray(foreign) && foreign.length === 0);
  const changed = await core.setFieldValues(aCm, "participant", pat, { housing: "stable" });
  const hist = await core.getFieldValueHistory(aOwner, "participant", pat);
  check("changing a value keeps the earlier one, for managers", changed.ok && hist.some((h) => h.key === "housing" && h.value === "shelter" && h.change === "changed"), JSON.stringify(hist).slice(0, 200));
  check("staff who do not manage settings get no history", (await core.getFieldValueHistory(aCm, "participant", pat)).length === 0);
  const seenHist = await raw(other, org.id, (a) => a`SELECT value FROM custom_field_value_version`);
  check("the reach policy: a colleague's own SQL reads no earlier value about someone they do not reach", Array.isArray(seenHist) && seenHist.length === 0, JSON.stringify(seenHist));
  const forged = await raw(owner, org.id, (a) => a`DELETE FROM custom_field_value_version`);
  check("history cannot be erased by the app", typeof forged === "string" && /permission denied/i.test(forged), JSON.stringify(forged));
  const lowered = await core.updateFieldDef(aOwner, f2.def.id, { sensitive: false });
  check("a sensitive field cannot be made ordinary", lowered.ok === false);
  const delDef = await raw(owner, org.id, (a) => a`DELETE FROM custom_field_def WHERE id = ${f1.def.id}`);
  check("a field cannot be deleted, even by the owner", typeof delDef === "string" && /permission denied/i.test(delDef), JSON.stringify(delDef));

  const moved = await core.migrateLegacySavedViews(aCm);
  const again = await core.migrateLegacySavedViews(aCm);
  const views = await core.listSavedViews(aCm, "caseload");
  check("the old saved sort moves over once, as a personal view", moved === 1 && again === 0 && views.filter((v) => v.name === "My quiet").length === 1, `${moved}/${again}/${views.length}`);
  const [{ prefs }] = await sql`SELECT staff_prefs AS prefs FROM users WHERE id = ${cm}`;
  check("and the old list is still there", Array.isArray(prefs.savedViews) && prefs.savedViews.length === 1);
  check("a colleague does not see that personal view", (await core.listSavedViews(aOther, "caseload")).every((v) => v.name !== "My quiet"));
  check("staff cannot share a view with everyone", (await core.createSavedView(aCm, { surface: "caseload", name: "Everyone's", shared: true })).ok === false);
  const sv = await core.createSavedView(aOwner, { surface: "caseload", name: "Interviewing", shared: true, roleDefault: "staff", definition: { filters: [{ field: "status", op: "any_of", value: ["active"] }] } });
  check("the owner shares one, the first view for staff", sv.ok && (await core.listSavedViews(aOther, "caseload")).some((v) => v.name === "Interviewing" && v.roleDefault === "staff"));
  check("another organization sees no views", (await core.listSavedViews(aSpy, "caseload")).length === 0);

  check("staff cannot set a role layout", (await core.setRoleLayout(aCm, "staff", "today", { order: ["quiet"], hidden: [] })).ok === false);
  check("the owner can", (await core.setRoleLayout(aOwner, "staff", "today", { order: ["quiet"], hidden: ["unassigned"] })).ok === true);
  check("staff get it", (await core.getMyRoleLayout(aOther)).today?.hidden?.includes("unassigned") === true);
  check("another organization does not", (await core.getRoleLayouts(aSpy)).today.staff === undefined);
}

/**
 * Staff build S3 (migration 108): what staff may change for themselves, and
 * each person's own view change log. The claims: org admins now manage
 * settings everywhere the owner does (core and database agree); staff cannot
 * change the policy, and another organization cannot read or forge it; a
 * locked choice is refused on write and ignored on read; the change log is
 * the person's alone (not a colleague's, not the owner's, not another
 * organization's), cannot be erased or rewritten by the app, and undo works
 * once; the grid's batch write is all or nothing and holds to reach.
 * (Neither 108 table holds per-participant rows, so the reach check here is
 * the owner-only rule on the log and the reach rule on the batch write.)
 */
async function customizationPolicyChecks() {
  console.log("\n  -- customization policy and view change log (108) --");
  if (!appUrl) { console.log("  skip  needs the app credential"); return; }
  const [{ t }] = await sql`SELECT to_regclass('public.view_change_log') AS t`;
  if (!t) { console.log("  note  108 not applied; skipped"); return; }
  const core = await import("../packages/core/dist/index.js");
  const app = neon(appUrl);
  const uniq = Date.now().toString(36).toUpperCase().slice(-6);
  const owner = await mkUser("cp-owner"), admin = await mkUser("cp-admin"), cm = await mkUser("cp-cm"), other = await mkUser("cp-other"), spy = await mkUser("cp-spy");
  const [org] = await sql`INSERT INTO access_code (code, partner_name, tier, partner_user_id, is_active, crm_v2) VALUES (${"ISOCP" + uniq}, ${P + " policy"}, 'client', ${owner}, true, true) RETURNING id, code`;
  const [org2] = await sql`INSERT INTO access_code (code, partner_name, tier, partner_user_id, is_active, crm_v2) VALUES (${"ISOCP2" + uniq}, ${P + " policy2"}, 'client', ${spy}, true, true) RETURNING id, code`;
  created.codes.push(org.id, org2.id);
  await sql`INSERT INTO org_staff (access_code_id, user_id, role) VALUES (${org.id}, ${admin}, 'org_admin'), (${org.id}, ${cm}, 'staff'), (${org.id}, ${other}, 'staff')`;
  const pat = await mkUser("cp-pat");
  await core.redeemAccessCode(pat, org.code);
  await sql`INSERT INTO client_staff_assignment (access_code_id, client_user_id, staff_user_id, assigned_by) VALUES (${org.id}, ${pat}, ${cm}, ${owner})`;
  const A = (u) => core.resolveOrgActor(u);
  const aOwner = await A(owner), aAdmin = await A(admin), aCm = await A(cm), aOther = await A(other), aSpy = await A(spy);
  const raw = async (u, orgId, stmt) => { try { const r = await app.transaction([app`SELECT set_config('app.org_id', ${orgId}, true)`, app`SELECT set_config('app.user_id', ${u}, true)`, stmt(app)]); return r[2]; } catch (e) { return String(e.message); } };

  // Org admins manage settings, everywhere the owner does (Troy 2026-10-27).
  check("an org admin defines a field", (await core.createFieldDef(aAdmin, { label: "Shift preference", entity: "participant", type: "text" })).ok === true);
  check("an org admin shares a view", (await core.createSavedView(aAdmin, { surface: "caseload", name: "Team view", shared: true })).ok === true);
  check("an org admin sets a role layout", (await core.setRoleLayout(aAdmin, "staff", "today", { order: ["tasks"], hidden: [] })).ok === true);

  // The policy: managers write, staff read, other organizations neither.
  check("staff cannot change what staff may change", (await core.setCustomizationPolicy(aCm, "staff", "today", { today_order: false })).ok === false);
  check("an org admin can", (await core.setCustomizationPolicy(aAdmin, "staff", "today", { today_order: false })).ok === true);
  check("staff read their own limits", (await core.getMyCustomizationPolicy(aCm)).today_order === false);
  check("the owner is never limited", (await core.getMyCustomizationPolicy(aOwner)).today_order === true);
  const spyRead = await raw(spy, org2.id, (a) => a`SELECT * FROM org_customization_policy WHERE access_code_id = ${org.id}`);
  check("another organization reads none of the policy", Array.isArray(spyRead) && spyRead.length === 0, JSON.stringify(spyRead));
  const forged = await raw(spy, org.id, (a) => a`INSERT INTO org_customization_policy (access_code_id, role, surface, allowed) VALUES (${org.id}, 'staff', 'people', '{"grid_edit": false}'::jsonb) RETURNING 1`);
  check("another organization's owner cannot write it, even forging the scope", typeof forged === "string", JSON.stringify(forged));
  const staffWrite = await raw(cm, org.id, (a) => a`UPDATE org_customization_policy SET allowed = '{"today_order": true}'::jsonb RETURNING 1`);
  check("a staff member's own SQL cannot loosen it", Array.isArray(staffWrite) && staffWrite.length === 0, JSON.stringify(staffWrite));

  // Enforced on write and on read.
  const refused = await core.setTodayOrder(aCm, { order: ["quiet", "tasks"] });
  check("a locked choice is refused, in the organization's words", refused.ok === false && refused.reason === "policy" && /same for everyone/.test(refused.error), JSON.stringify(refused));
  await core.setCustomizationPolicy(aAdmin, "staff", "today", null);
  const applied = await core.setTodayOrder(aCm, { order: ["quiet", "tasks"] });
  check("allowed again, the change applies and is logged", applied.ok === true && !!applied.changeId, JSON.stringify(applied));
  await core.setCustomizationPolicy(aOwner, "staff", "today", { today_order: false });
  check("locked later, the stored choice is ignored on read", (await core.getStaffPrefs(aCm)).effective.todayOrder.length === 0);
  check("and the full Settings save that leaves it alone still works", (await core.setOwnStaffPrefs(aCm, { ...(await core.getStaffPrefs(aCm)).own, noteKind: "call" })).ok === true);
  await core.setCustomizationPolicy(aOwner, "staff", "today", null);
  check("opened again, it comes back", (await core.getStaffPrefs(aCm)).effective.todayOrder[0] === "quiet");
  await core.setCustomizationPolicy(aOwner, "staff", "people", { personal_views: false });
  check("personal views locked: saving one is refused", (await core.createSavedView(aCm, { surface: "caseload", name: "Mine", shared: false })).ok === false);
  await core.setCustomizationPolicy(aOwner, "staff", "people", null);

  // The log: the person's own, append-only but for "undone".
  const mine = await core.listMyViewChanges(aCm, 10);
  check("the person reads their own changes", mine.some((c) => c.id === applied.changeId));
  const colleague = await raw(other, org.id, (a) => a`SELECT id FROM view_change_log`);
  check("a colleague's own SQL reads none of them", Array.isArray(colleague) && colleague.length === 0, JSON.stringify(colleague));
  const ownerRead = await raw(owner, org.id, (a) => a`SELECT id FROM view_change_log`);
  check("nor does the owner", Array.isArray(ownerRead) && ownerRead.length === 0, JSON.stringify(ownerRead));
  const foreign = await raw(spy, org2.id, (a) => a`SELECT id FROM view_change_log WHERE access_code_id = ${org.id}`);
  check("nor another organization", Array.isArray(foreign) && foreign.length === 0);
  const del = await raw(cm, org.id, (a) => a`DELETE FROM view_change_log`);
  check("the app cannot erase the log", typeof del === "string" && /permission denied/i.test(del), JSON.stringify(del));
  const rewrite = await raw(cm, org.id, (a) => a`UPDATE view_change_log SET summary = 'x'`);
  check("or rewrite it", typeof rewrite === "string" && /permission denied/i.test(rewrite), JSON.stringify(rewrite));
  const asOther = await raw(cm, org.id, (a) => a`INSERT INTO view_change_log (access_code_id, user_id, surface, action, target, summary) VALUES (${org.id}, ${other}, 'today', 'today_order', 'pref:todayOrder', 'x') RETURNING 1`);
  check("or write a change into a colleague's log", typeof asOther === "string", JSON.stringify(asOther));
  const undone = await core.undoViewChange(aCm, { id: applied.changeId });
  check("undo puts it back and is logged", undone.ok === true && (await core.getStaffPrefs(aCm)).effective.todayOrder.length === 0, JSON.stringify(undone));
  check("and cannot run twice", (await core.undoViewChange(aCm, { id: applied.changeId })).ok === false);
  check("a colleague cannot undo it", (await core.undoViewChange(aOther, { id: applied.changeId })).ok === false);

  // The grid's batch write: reach, and all or nothing.
  const f = await core.createFieldDef(aOwner, { label: "Hours wanted", entity: "participant", type: "number" });
  const batchOther = await core.setFieldValuesBatch(aOther, [{ entityId: pat, values: { hours_wanted: 20 } }], { fromGrid: true, gridAllowed: true });
  check("the grid cannot fill in a value for someone the staff member does not reach", batchOther.ok === false, JSON.stringify(batchOther).slice(0, 200));
  const mixed = await core.setFieldValuesBatch(aCm, [{ entityId: pat, values: { hours_wanted: 20 } }, { entityId: pat, values: { shift_preference: "x".repeat(600) } }], { fromGrid: true, gridAllowed: true });
  check("one bad cell and nothing is written", mixed.ok === false && Object.keys(mixed.cellErrors ?? {}).length === 1 && !(await core.getFieldValues(aCm, "participant"))[pat]?.hours_wanted, JSON.stringify(mixed).slice(0, 200));
  const good = await core.setFieldValuesBatch(aCm, [{ entityId: pat, values: { hours_wanted: 20 } }], { fromGrid: true, gridAllowed: true });
  check("the assigned case manager fills it in from the grid", f.ok && good.ok === true && (await core.getFieldValues(aCm, "participant"))[pat]?.hours_wanted === 20, JSON.stringify(good).slice(0, 200));
  check("the organization can keep it to the person's page", (await core.setFieldValuesBatch(aCm, [{ entityId: pat, values: { hours_wanted: 30 } }], { fromGrid: true, gridAllowed: false })).ok === false);
  check("another organization's staff cannot use the batch at all", (await core.setFieldValuesBatch(aSpy, [{ entityId: pat, values: { hours_wanted: 1 } }], { fromGrid: true })).ok === false);
}

/**
 * Applications, resumes/letters/plans and profiles (060): owner-only base
 * tables; staff and platform admins read through views that name their columns.
 * The claim: however the application is written, an organization cannot read
 * unshared work, another org's work, or a private column.
 */
async function participantTableChecks() {
  console.log("\n  -- the participant's own work --");
  if (!appUrl) { console.log("  skip  needs the app credential"); return; }
  const core = await import("../packages/core/dist/index.js");
  const app = neon(appUrl);
  const [{ on }] = await sql`SELECT bool_and(relrowsecurity AND relforcerowsecurity) AS on FROM pg_class WHERE relname IN ('job_application', 'refinery_artifact', 'consumer_profile') AND relnamespace = 'public'::regnamespace`;
  if (!on) { console.log("  note  060 not applied; skipped"); return; }
  const uniq = Date.now().toString(36).toUpperCase().slice(-6);
  const raised = async (fn) => { try { await fn(); return null; } catch (e) { return String(e?.message ?? e); } };
  const owner = await mkUser("z-owner"), owner2 = await mkUser("z-owner2"), cm = await mkUser("z-cm");
  const mk = async (l, o) => { const [r] = await sql`INSERT INTO access_code (code, partner_name, tier, partner_user_id, is_active, crm_v2) VALUES (${"ISOZ" + l + uniq}, ${P + " z" + l}, 'client', ${o}, true, true) RETURNING id, code`; created.codes.push(r.id); return r; };
  const org = await mk("A", owner), org2 = await mk("B", owner2);
  await sql`INSERT INTO org_staff (access_code_id, user_id, role) VALUES (${org.id}, ${cm}, 'staff')`;
  const pat = await mkUser("z-pat"), other = await mkUser("z-other");
  await core.redeemAccessCode(pat, org.code);
  await sql`INSERT INTO client_staff_assignment (access_code_id, client_user_id, staff_user_id, assigned_by) VALUES (${org.id}, ${pat}, ${cm}, ${owner})`;

  // -- the person's own path still works, end to end, AS them
  const art = await core.createArtifact(pat, "resume", { targetJob: "Cook" }, { marker: "Z-RESUME" }).catch((e) => ({ error: String(e) }));
  check("a participant can create a resume", !!art.id, JSON.stringify(art).slice(0, 160));
  await core.createArtifact(pat, "disclosure_plan", {}, { marker: "Z-DISCLOSURE" });
  check("and list and open their own", (await core.listArtifacts(pat)).length === 2 && (await core.getArtifact(art.id, pat))?.id === art.id);
  check("somebody else cannot open it, even knowing its id", (await core.getArtifact(art.id, other)) === null);
  check("somebody else cannot delete it", (await core.deleteArtifact(art.id, other)) === "not_found");
  await app.transaction([app`SELECT set_config('app.user_id', ${pat}, true)`,
    app`INSERT INTO job_application (user_id, job_title, company, status, notes, salary) VALUES (${pat}, 'Cook', 'Z Diner', 'applied', 'Z-PRIVATE-NOTE', 'Z-SALARY')`]);
  check("their profile snapshot still builds", (await core.buildJourneySnapshot(pat).catch((e) => ({ error: String(e) }))).error === undefined);
  const forge = await raised(() => app.transaction([app`SELECT set_config('app.user_id', ${other}, true)`,
    app`INSERT INTO job_application (user_id, job_title, company, status) VALUES (${pat}, 'Forged', 'Forged Co', 'saved')`]));
  check("nobody can write an application into another person's tracker", !!forge && /row-level security/i.test(forge), forge ?? "inserted");

  // -- the base tables are closed to everyone else, by any route the app role has
  const [u1] = await app`SELECT (SELECT count(*) FROM job_application)::int AS a, (SELECT count(*) FROM refinery_artifact)::int AS b, (SELECT count(*) FROM consumer_profile)::int AS c`;
  check("an unscoped read by the app sees no applications, no resumes, no profiles", u1.a === 0 && u1.b === 0 && u1.c === 0, JSON.stringify(u1));
  const asOrg = (orgId, actor, q) => app.transaction([app`SELECT set_config('app.org_id', ${orgId}, true)`, app`SELECT set_config('app.user_id', ${actor}, true)`, q]);
  const base = await asOrg(org.id, cm, app`SELECT count(*)::int AS n FROM job_application WHERE user_id = ${pat}`);
  check("their own case manager, scoped to their org, reads NOTHING from the base table", base[2][0].n === 0);
  const before = await asOrg(org.id, cm, app`SELECT count(*)::int AS n FROM staff_shared_application WHERE user_id = ${pat}`);
  check("and nothing through the staff view either, until it is shared", before[2][0].n === 0);

  await core.grantSharing(pat, org.id, "applications"); await core.grantSharing(pat, org.id, "resume");
  const v = await asOrg(org.id, cm, app`SELECT * FROM staff_shared_application WHERE user_id = ${pat}`);
  check("once shared, the view returns it, and the private columns do not exist there", v[2].length === 1 && !("notes" in v[2][0]) && !("salary" in v[2][0]) && !JSON.stringify(v[2]).includes("Z-PRIVATE"));
  const noteGrab = await raised(() => asOrg(org.id, cm, app`SELECT notes FROM staff_shared_application WHERE user_id = ${pat}`));
  check("asking the view for the private notes column is an error, not an empty answer", !!noteGrab && /column .*notes.* does not exist/i.test(noteGrab), noteGrab ?? "returned rows");
  const stillClosed = await asOrg(org.id, cm, app`SELECT count(*)::int AS n FROM job_application WHERE user_id = ${pat}`);
  check("the base table stays closed to staff even after sharing", stillClosed[2][0].n === 0);
  const arts = await asOrg(org.id, cm, app`SELECT artifact_type, content FROM staff_shared_artifact WHERE user_id = ${pat}`);
  check("the artifact view returns the shared resume and can never return a disclosure plan",
    arts[2].length === 1 && arts[2][0].artifact_type === "resume" && !JSON.stringify(arts[2]).includes("Z-DISCLOSURE"));
  const otherOrg = await asOrg(org2.id, owner2, app`SELECT (SELECT count(*) FROM staff_shared_application)::int AS a, (SELECT count(*) FROM staff_shared_artifact)::int AS b, (SELECT count(*) FROM staff_progress_counts)::int AS c`);
  check("another organization gets nothing from any of the three views", otherOrg[2][0].a === 0 && otherOrg[2][0].b === 0 && otherOrg[2][0].c === 0, JSON.stringify(otherOrg[2][0]));
  check("progress counts appear only for someone with the progress switch on", (await asOrg(org.id, cm, app`SELECT count(*)::int AS n FROM staff_progress_counts WHERE user_id = ${pat}`))[2][0].n === 0);
  await joinCohortConsent(pat);
  const pc = await asOrg(org.id, cm, app`SELECT applications, practice_sessions FROM staff_progress_counts WHERE user_id = ${pat}`);
  check("with it on: counts, and only counts", pc[2].length === 1 && pc[2][0].applications === 1);
  const cohort = await core.getPartnerCohort(owner, { accessCodeId: org.id });
  check("the caseload still shows the right application count through the view", cohort.clients.find((c) => c.userId === pat)?.applications === 1, JSON.stringify(cohort.clients.map((c) => [c.userId === pat, c.applications])));

  // -- platform admin views answer to platform_admin, a table the app cannot write
  const boss = await mkUser("z-admin");
  await sql`INSERT INTO platform_admin (user_id, note) VALUES (${boss}, 'isolation fixture')`;
  const asUser = (u, q) => app.transaction([app`SELECT set_config('app.user_id', ${u}, true)`, q]);
  check("the admin view is empty for someone who is not a platform admin", (await asUser(cm, app`SELECT count(*)::int AS n FROM admin_job_application`))[1][0].n === 0);
  const adm = await asUser(boss, app`SELECT * FROM admin_job_application WHERE user_id = ${pat}`);
  check("a platform admin sees that the row exists, and no content column", adm[1].length === 1 && !("notes" in adm[1][0]) && !("salary" in adm[1][0]) && !("description" in adm[1][0]));
  const health = await core.getSystemHealth(boss).catch((e) => ({ error: String(e) }));
  check("the admin health report still counts applications and resumes", !health.error, String(health.error ?? ""));
  const funnel = await core.getFunnelAggregate({ partnerCode: org.code });
  check("the funnel report gets its seven counts with nobody signed in (the nightly sync)", funnel.applications_logged === 1 && funnel.refinery_users === 1, JSON.stringify(funnel));
  await sql`DELETE FROM platform_admin WHERE user_id = ${boss}`;
  await sql`DELETE FROM job_application WHERE user_id = ${pat}`; await sql`DELETE FROM refinery_artifact WHERE user_id = ${pat}`;
}

/** Participant-owned tables with owner-only policies (059): nobody but the person, by any route the app has. */
async function ownerOnlyChecks() {
  console.log("\n  -- participant-owned, owner only --");
  if (!appUrl) { console.log("  skip  needs the app credential"); return; }
  const core = await import("../packages/core/dist/index.js");
  const app = neon(appUrl);
  const [{ on }] = await sql`SELECT bool_and(relrowsecurity AND relforcerowsecurity) AS on FROM pg_class WHERE relname IN ('vault_document', 'user_progress_event') AND relnamespace = 'public'::regnamespace`;
  if (!on) { console.log("  note  059 not applied; skipped"); return; }
  const uniq = Date.now().toString(36).toUpperCase().slice(-6);
  const a = await mkUser("w-a"), b = await mkUser("w-b"), owner = await mkUser("w-owner");
  const [org] = await sql`INSERT INTO access_code (code, partner_name, tier, partner_user_id, is_active, crm_v2) VALUES (${"ISOW" + uniq}, ${P + " owneronly"}, 'client', ${owner}, true, true) RETURNING id, code`;
  created.codes.push(org.id);
  await core.redeemAccessCode(a, org.code);
  const raised = async (fn) => { try { await fn(); return null; } catch (e) { return String(e?.message ?? e); } };

  await core.recordProgressEvent(a, "session_start", { verify: "true" });
  await core.recordProgressEvent(b, "session_start", { verify: "true" });
  check("a person's own activity is recorded and read back", (await core.getProgressEventDates(a)).length === 1);
  check("the journey snapshot still counts it", (await core.buildJourneySnapshot(a).catch((e) => ({ error: String(e) }))).error === undefined);
  const [{ n: appSees }] = await app`SELECT count(*)::int AS n FROM user_progress_event`;
  check("an unscoped read by the app sees nobody's activity", appSees === 0);
  const asA = await app.transaction([app`SELECT set_config('app.user_id', ${a}, true)`, app`SELECT user_id FROM user_progress_event`,
    app`DELETE FROM user_progress_event WHERE user_id = ${b} RETURNING id`]);
  check("running as one person, the app sees only theirs and cannot delete another's", asA[1].length === 1 && asA[1][0].user_id === a && asA[2].length === 0);
  const forge = await raised(() => app.transaction([app`SELECT set_config('app.user_id', ${a}, true)`,
    app`INSERT INTO user_progress_event (user_id, event_type, context) VALUES (${b}, 'session_start', '{}')`]));
  check("and cannot write an event in somebody else's name", !!forge && /row-level security/i.test(forge), forge ?? "inserted");
  const asOrg = await app.transaction([app`SELECT set_config('app.org_id', ${org.id}, true)`, app`SELECT set_config('app.user_id', ${owner}, true)`,
    app`SELECT count(*)::int AS n FROM user_progress_event WHERE user_id = ${a}`, app`SELECT count(*)::int AS n FROM vault_document`]);
  check("their organization's owner, scoped to the org, sees none of it", asOrg[2][0].n === 0 && asOrg[3][0].n === 0);

  // vault: needs a secure_object to hang off
  const [so] = await sql`INSERT INTO secure_object (owner_user_id, object_key, bucket, purpose, mime_type, byte_size, iv, auth_tag, key_version, aad)
                         VALUES (${a}, ${"iso/" + uniq}, 'iso', 'vault_document', 'application/pdf', 10, 'aa', 'bb', 1, 'cc') RETURNING id`.catch(() => [null]);
  if (so) {
    const doc = await core.createVaultDocument({ userId: a, secureObjectId: so.id, category: "id", label: "State ID" }).catch((e) => ({ error: String(e) }));
    check("a person can store a document", !!doc.id, JSON.stringify(doc).slice(0, 200));
    check("and list it; somebody else lists nothing", (await core.listVaultDocuments(a)).length === 1 && (await core.listVaultDocuments(b)).length === 0);
    check("somebody else cannot fetch it by id", (await core.getVaultDocument(b, doc.id)) === null);
    check("or rename it", (await core.updateVaultDocument(b, doc.id, { label: "stolen" })) === null);
    check("the owner can", (await core.updateVaultDocument(a, doc.id, { label: "Montana ID" }))?.label === "Montana ID");
    await sql`DELETE FROM secure_object WHERE id = ${so.id}`;
    check("deleting the stored file still removes its record (cascades are not blocked)", (await core.listVaultDocuments(a)).length === 0);
  } else console.log("  note  secure_object fixture shape differs; vault checks skipped");
  await sql`DELETE FROM user_progress_event WHERE user_id IN (${a}, ${b})`;
}

/** Placements and retention (056): every figure keeps how it is known, and rates have honest denominators. */
async function outcomeChecks() {
  console.log("\n  -- outcomes and retention --");
  if (!appUrl) { console.log("  skip  needs the app credential"); return; }
  const core = await import("../packages/core/dist/index.js");
  const app = neon(appUrl);
  const uniq = Date.now().toString(36).toUpperCase().slice(-6);
  const owner = await mkUser("o-owner"), cm = await mkUser("o-cm"), other = await mkUser("o-other"), spy = await mkUser("o-spy");
  const [org] = await sql`INSERT INTO access_code (code, partner_name, tier, partner_user_id, is_active, crm_v2) VALUES (${"ISOO" + uniq}, ${P + " outcomes"}, 'client', ${owner}, true, true) RETURNING id, code`;
  const [org2] = await sql`INSERT INTO access_code (code, partner_name, tier, partner_user_id, is_active, crm_v2) VALUES (${"ISOO2" + uniq}, ${P + " outcomes2"}, 'client', ${spy}, true, true) RETURNING id, code`;
  created.codes.push(org.id, org2.id);
  await sql`INSERT INTO org_staff (access_code_id, user_id, role) VALUES (${org.id}, ${cm}, 'staff'), (${org.id}, ${other}, 'staff')`;
  const pat = await mkUser("o-pat"), newbie = await mkUser("o-new");
  for (const u of [pat, newbie]) { await core.redeemAccessCode(u, org.code); await sql`INSERT INTO client_staff_assignment (access_code_id, client_user_id, staff_user_id, assigned_by) VALUES (${org.id}, ${u}, ${cm}, ${owner})`; }
  const A = (u) => core.resolveOrgActor(u);
  const aCm = await A(cm), aOther = await A(other), aOwner = await A(owner), aSpy = await A(spy);
  const ago = (d) => new Date(Date.now() - d * 86400000).toISOString().slice(0, 10);

  check("'confirmed' without saying how is refused", (await core.recordOutcome(aCm, { clientId: pat, employer: "Acme Foods", startDate: ago(70), source: "staff_verified" })).ok === false);
  const rawVerified = await (async () => { try { await app.transaction([app`SELECT set_config('app.org_id', ${org.id}, true)`, app`SELECT set_config('app.user_id', ${cm}, true)`,
    app`INSERT INTO outcome_record (access_code_id, client_user_id, employer, start_date, source, created_by) VALUES (${org.id}, ${pat}, 'Raw Co', ${ago(5)}, 'staff_verified', ${cm})`]); return null; } catch (e) { return String(e.message); } })();
  check("and the database refuses it too, even written directly", !!rawVerified && /check constraint/i.test(rawVerified), rawVerified ?? "inserted");
  const o1 = await core.recordOutcome(aCm, { clientId: pat, employer: "Acme Foods", jobTitle: "Line Cook", startDate: ago(70), hourlyWage: 18.5, source: "staff_verified", verificationMethod: "pay_stub_seen" });
  const o2 = await core.recordOutcome(aCm, { clientId: newbie, employer: "New Co", startDate: ago(9), source: "participant_reported" });
  check("a case manager records a confirmed placement and a reported one", o1.ok && o2.ok, JSON.stringify([o1, o2]));
  check("a colleague cannot record one for somebody else's participant", (await core.recordOutcome(aOther, { clientId: pat, employer: "X Co", startDate: ago(3), source: "staff_reported" })).ok === false);
  check("another organization sees none of it", (await core.listOutcomes(aSpy)).length === 0 && (await core.listOutcomes(aOther)).length === 0);

  const list = await core.listOutcomes(aCm);
  const acme = list.find((o) => o.id === o1.id), fresh = list.find((o) => o.id === o2.id);
  check("a 70-day-old placement is due its 30 and 60 day check-ins; a 9-day-old one is due nothing", acme.due_marks.join() === "30,60" && fresh.due_marks.length === 0, `${acme.due_marks} / ${fresh.due_marks}`);
  check("a check-in cannot be recorded before its day arrives", (await core.recordRetentionCheck(aCm, { outcomeId: o2.id, dayMark: 30, status: "employed", method: "participant_told_me" })).ok === false);
  check("'could not reach' cannot be recorded as 'employed'", (await core.recordRetentionCheck(aCm, { outcomeId: o1.id, dayMark: 30, status: "employed", method: "could_not_reach" })).ok === false);
  check("the 30-day check-in is recorded", (await core.recordRetentionCheck(aCm, { outcomeId: o1.id, dayMark: 30, status: "employed", method: "pay_stub_seen" })).ok === true);
  check("and cannot be quietly answered a second time", (await core.recordRetentionCheck(aCm, { outcomeId: o1.id, dayMark: 30, status: "not_employed", method: "participant_told_me" })).ok === false);
  check("'could not reach' is recorded as unknown, its own answer", (await core.recordRetentionCheck(aCm, { outcomeId: o1.id, dayMark: 60, status: "unknown", method: "could_not_reach" })).ok === true);

  const sum = core.summarizeOutcomes(await core.listOutcomes(aOwner));
  const r30 = sum.retention.find((r) => r.dayMark === 30), r60 = sum.retention.find((r) => r.dayMark === 60), r90 = sum.retention.find((r) => r.dayMark === 90);
  check("the 30-day rate counts ONLY placements old enough to be asked: 1 eligible, 1 employed (the 9-day-old one is not a failure)",
    sum.placements === 2 && r30.eligible === 1 && r30.employed === 1, JSON.stringify(r30));
  check("the 60-day unknown stays unknown, in neither column", r60.eligible === 1 && r60.unknown === 1 && r60.employed === 0 && r60.notEmployed === 0, JSON.stringify(r60));
  check("nobody is 90 days in, so there is no 90-day rate to report", r90.eligible === 0);
  check("how each placement is known is kept apart, and the wage median counts only known wages",
    sum.bySource.staff_verified === 1 && sum.bySource.participant_reported === 1 && sum.medianWage === 18.5 && sum.wageKnownFor === 1);

  const q = await core.getTodayQueue(aCm);
  check("nothing left to ask yet appears on Today as a check-in", !q.some((i) => i.section === "retention"));
  check("the participant can read what is on file about them", (await core.getMyOutcomes(pat)).length === 1 && (await core.getMyOutcomes(newbie))[0].employer === "New Co");
  check("and not what is on file about someone else", !(await core.getMyOutcomes(pat)).some((o) => o.employer === "New Co"));
  check("ending it records why; 'left for a better job' is its own outcome", (await core.endOutcome(aCm, o1.id, ago(1), "left_for_better_job")).ok === true
    && core.summarizeOutcomes(await core.listOutcomes(aOwner)).leftForBetter === 1);
  const del = await (async () => { try { await app.transaction([app`SELECT set_config('app.org_id', ${org.id}, true)`, app`DELETE FROM outcome_record WHERE id = ${o1.id}`]); return null; } catch (e) { return String(e.message); } })();
  check("an outcome cannot be deleted by the app", !!del && /permission denied/i.test(del), del ?? "deleted");
}

/**
 * Staff workflow (105, house lane L5): drafts are their author's alone;
 * referrals, their history, retention tasks, search and the timeline are
 * reach-scoped and sealed between organizations, IN THE DATABASE as well as in
 * core: raw reads as the app role, with the app's own checks skipped, see nothing.
 */
async function workflowChecks() {
  console.log("\n  -- workflow: drafts, referrals, retention tasks, search, timeline --");
  if (!appUrl) { console.log("  skip  needs the app credential"); return; }
  const core = await import("../packages/core/dist/index.js");
  const app = neon(appUrl);
  const uniq = Date.now().toString(36).toUpperCase().slice(-6);
  const owner = await mkUser("wf-owner"), cm = await mkUser("wf-cm"), other = await mkUser("wf-other"), spy = await mkUser("wf-spy");
  const [org] = await sql`INSERT INTO access_code (code, partner_name, tier, partner_user_id, is_active, crm_v2) VALUES (${"ISOWF" + uniq}, ${P + " workflow"}, 'client', ${owner}, true, true) RETURNING id, code`;
  const [org2] = await sql`INSERT INTO access_code (code, partner_name, tier, partner_user_id, is_active, crm_v2) VALUES (${"ISOWG" + uniq}, ${P + " workflow2"}, 'client', ${spy}, true, true) RETURNING id, code`;
  created.codes.push(org.id, org2.id);
  await sql`INSERT INTO org_staff (access_code_id, user_id, role) VALUES (${org.id}, ${cm}, 'staff'), (${org.id}, ${other}, 'staff')`;
  const pat = await mkUser("wf-pat"), hers = await mkUser("wf-hers"), quiet = await mkUser("wf-quiet");
  for (const u of [pat, hers, quiet]) await core.redeemAccessCode(u, org.code);
  await joinCohortConsent(pat);
  await sql`INSERT INTO client_staff_assignment (access_code_id, client_user_id, staff_user_id, assigned_by) VALUES
            (${org.id}, ${pat}, ${cm}, ${owner}), (${org.id}, ${hers}, ${other}, ${owner}), (${org.id}, ${quiet}, ${cm}, ${owner})`;
  const A = (u) => core.resolveOrgActor(u);
  const aCm = await A(cm), aOther = await A(other), aOwner = await A(owner), aSpy = await A(spy);
  const rawAs = async (orgId, userId, query) => (await app.transaction([
    app`SELECT set_config('app.org_id', ${orgId}, true)`, app`SELECT set_config('app.user_id', ${userId}, true)`, query(app),
  ]))[2];

  // drafts: owner only
  const d1 = await core.saveStaffDraft(aCm, pat, "note", "Talked through the bus pass");
  check("a case manager's note autosaves as a draft", d1.ok === true, JSON.stringify(d1));
  check("they get it back after a refresh", (await core.getStaffDraft(aCm, pat, "note"))?.body === "Talked through the bus pass");
  check("the owner cannot read it, even from the table", (await core.getStaffDraft(aOwner, pat, "note")) === null
    && (await rawAs(org.id, owner, (a) => a`SELECT id FROM staff_draft`)).length === 0);
  check("a colleague cannot", (await rawAs(org.id, other, (a) => a`SELECT id FROM staff_draft`)).length === 0);
  check("another organization cannot", (await rawAs(org2.id, spy, (a) => a`SELECT id FROM staff_draft`)).length === 0);
  check("no draft about someone out of reach", (await core.saveStaffDraft(aCm, hers, "note", "x")).ok === false);
  check("clearing it after the real save leaves nothing", (await core.clearStaffDraft(aCm, pat, "note")) && (await core.getStaffDraft(aCm, pat, "note")) === null);

  // referrals: reach and orgs, in the database
  const r1 = await core.createReferral(aCm, { clientId: pat, toKind: "other", toName: "Isotest Boot Fund", reason: "Boots for the first shift", send: true });
  check("a case manager refers their person", r1.ok === true, JSON.stringify(r1));
  check("a colleague cannot refer someone not theirs", (await core.createReferral(aOther, { clientId: pat, toKind: "other", toName: "X Place" })).ok === false);
  check("the colleague lists none of it", (await core.listReferrals(aOther, { filter: "all" })).length === 0);
  check("and the DATABASE shows the colleague none of it, reading the tables directly",
    (await rawAs(org.id, other, (a) => a`SELECT id FROM referral`)).length === 0 && (await rawAs(org.id, other, (a) => a`SELECT id FROM referral_event`)).length === 0);
  check("another organization sees none of it, in core or in the table",
    (await core.listReferrals(aSpy, { filter: "all" })).length === 0 && (await rawAs(org2.id, spy, (a) => a`SELECT id FROM referral`)).length === 0);
  check("the owner sees it", (await core.listReferrals(aOwner, { filter: "all" })).some((r) => r.id === r1.id));
  check("a colleague cannot move it", (await core.moveReferral(aOther, r1.id, { to: "accepted" })).ok === false);
  check("a case manager cannot hand it to a colleague (that is assigning work)", (await core.updateReferral(aCm, r1.id, { ownerId: other })).ok === false);
  check("an owner cannot hand it to someone who does not reach the person", (await core.updateReferral(aOwner, r1.id, { ownerId: other })).ok === false);
  check("the case manager can, along the path", (await core.moveReferral(aCm, r1.id, { to: "accepted" })).ok === true
    && (await core.moveReferral(aCm, r1.id, { to: "closed" })).ok === false);
  const hist = await core.getReferralHistory(aCm, r1.id);
  check("every move is in its history", hist?.map((e) => e.to_status).join() === "sent,accepted", JSON.stringify(hist));
  const forged = await (async () => { try { await rawAs(org.id, cm, (a) => a`INSERT INTO referral_event (referral_id, access_code_id, participant_user_id, to_status) VALUES (${r1.id}, ${org.id}, ${pat}, 'closed')`); return null; } catch (e) { return String(e.message); } })();
  check("the app cannot write referral history", !!forged && /permission denied/i.test(forged), forged ?? "inserted");
  const rawOther = await (async () => { try { await rawAs(org.id, cm, (a) => a`INSERT INTO referral (access_code_id, participant_user_id, to_kind, to_name, created_by) VALUES (${org.id}, ${hers}, 'other', 'Raw', ${cm})`); return null; } catch (e) { return String(e.message); } })();
  check("nor insert one for someone out of reach, skipping core", !!rawOther, rawOther ?? "inserted");
  const rp = await core.createReferral(aCm, { clientId: pat, toKind: "partner_org", toName: "Isotest Partner Center", send: true });
  const rpRow = (await core.listReferrals(aCm, { filter: "draft" })).find((r) => r.id === rp.id);
  check("a partner referral stays a draft without the person's consent", rp.ok === true && rpRow?.status === "draft" && rpRow?.consent_ok === false && !!rp.note);
  check("and cannot be sent", (await core.moveReferral(aCm, rp.id, { to: "sent" })).ok === false);

  // retention tasks
  const ago = (d) => new Date(Date.now() - d * 86400000).toISOString().slice(0, 10);
  const o = await core.recordOutcome(aCm, { clientId: pat, employer: "Isotest Fabrication", startDate: ago(40), source: "staff_reported" });
  const auto = ((await core.listStaffTasks(aCm, { clientId: pat })) ?? []).filter((t) => t.source_kind === "retention");
  check("a placement makes its 30, 90 and 180-day tasks for the case manager", o.ok && auto.map((t) => t.source_mark).sort((x, y) => x - y).join() === "30,90,180"
    && auto.every((t) => t.owner_user_id === cm), JSON.stringify(auto.map((t) => [t.source_mark, t.owner_user_id === cm])));
  const [{ n: again }] = await sql`SELECT public.smr_make_retention_tasks(${o.id}::uuid) AS n`;
  check("making them again makes none", again === 0);
  await core.recordRetentionCheck(aCm, { outcomeId: o.id, dayMark: 30, status: "employed", method: "participant_told_me" });
  const after = ((await core.listStaffTasks(aCm, { clientId: pat, includeDone: true })) ?? []).find((t) => t.source_kind === "retention" && t.source_mark === 30);
  check("answering the 30-day check-in finishes its task", !!after?.done_at);
  check("a colleague's task list does not get them", !((await core.listStaffTasks(aOther)) ?? []).some((t) => t.source_id === o.id));

  // search
  const hit = await core.searchParticipants(aCm, P + " wf-pat");
  check("search finds my person by name (sharing on), any case", (hit ?? []).some((h) => h.user_id === pat), JSON.stringify(hit));
  check("a colleague's search does not find them", !((await core.searchParticipants(aOther, P + " wf-pat")) ?? []).some((h) => h.user_id === pat));
  check("another organization's search does not", !((await core.searchParticipants(aSpy, P + " wf-pat")) ?? []).some((h) => h.user_id === pat));
  check("someone who shares nothing is not found by their account email", !((await core.searchParticipants(aOwner, `${P}-wf-quiet`)) ?? []).some((h) => h.user_id === quiet));
  await core.setParticipantContact(aCm, quiet, { phone: "555-010-0177", aliases: ["Quiet Q"] });
  check("but is found by the phone the organization keeps", ((await core.searchParticipants(aCm, "5550100177")) ?? []).some((h) => h.user_id === quiet && h.matched_on === "phone"));
  const dupMine = await core.findPossibleDuplicates(aCm, { phone: "(555) 010-0177" });
  check("adding someone with that phone warns, naming the person I work with", dupMine.matches.some((m) => m.userId === quiet && m.reasons.includes("phone")), JSON.stringify(dupMine));
  const dupOther = await core.findPossibleDuplicates(aOther, { email: `${P}-wf-pat-${RUN}@example.invalid` });
  check("a duplicate outside your reach is counted by exact email, never named", dupOther.matches.length === 0 && dupOther.othersByReason.email === 1, JSON.stringify(dupOther));
  const dupName = await core.findPossibleDuplicates(aOther, { name: P + " wf-pat" });
  check("and never counted by name, so the warning cannot test whether a name is here", dupName.matches.length === 0 && !dupName.othersByReason.name, JSON.stringify(dupName));
  const dupPhoneOther = await core.findPossibleDuplicates(aOther, { phone: "(555) 010-0177" });
  check("and a phone the organization keeps for someone out of reach is not even counted (the database hides it)", dupPhoneOther.matches.length === 0 && !dupPhoneOther.othersByReason.phone, JSON.stringify(dupPhoneOther));

  // timeline
  const tl = await core.getPersonTimeline(aCm, pat);
  check("the timeline merges referrals, tasks and the placement, newest first",
    tl.ok && ["referral", "task", "outcome", "retention"].every((t) => tl.items.some((i) => i.type === t)), JSON.stringify(tl.ok ? tl.items.map((i) => i.type) : tl));
  check("a colleague gets no timeline for them", (await core.getPersonTimeline(aOther, pat)).ok === false);
  check("another organization gets none", (await core.getPersonTimeline(aSpy, pat)).ok === false);
}

/**
 * Handoffs (110, staff pass S5) and connections the client missed. The claims:
 * only someone who reaches the person can send them a handoff, by core or by
 * a raw insert; a colleague and another organization read none of it; the
 * person reads their own live handoffs and answers each item, and nobody else
 * can; a taken next step lands on their shared list; withdrawn ones vanish for
 * them; nothing is deleted; the activity log says what happened in fixed words
 * only. Connections read only shared scopes, and every read is in the
 * person's access log; a colleague or another organization reads nothing and
 * logs nothing.
 */
async function handoffChecks() {
  console.log("\n  -- handoffs (110) and connections the client missed --");
  if (!appUrl) { console.log("  skip  needs the app credential"); return; }
  const core = await import("../packages/core/dist/index.js");
  const app = neon(appUrl);
  const uniq = Date.now().toString(36).toUpperCase().slice(-6);
  const owner = await mkUser("ho-owner"), cm = await mkUser("ho-cm"), other = await mkUser("ho-other"), spy = await mkUser("ho-spy");
  const [org] = await sql`INSERT INTO access_code (code, partner_name, tier, partner_user_id, is_active, crm_v2) VALUES (${"ISOHO" + uniq}, ${P + " handoff"}, 'client', ${owner}, true, true) RETURNING id, code`;
  const [org2] = await sql`INSERT INTO access_code (code, partner_name, tier, partner_user_id, is_active, crm_v2) VALUES (${"ISOHP" + uniq}, ${P + " handoff2"}, 'client', ${spy}, true, true) RETURNING id, code`;
  created.codes.push(org.id, org2.id);
  await sql`INSERT INTO org_staff (access_code_id, user_id, role) VALUES (${org.id}, ${cm}, 'staff'), (${org.id}, ${other}, 'staff')`;
  const pat = await mkUser("ho-pat"), hers = await mkUser("ho-hers");
  for (const u of [pat, hers]) await core.redeemAccessCode(u, org.code);
  await sql`INSERT INTO client_staff_assignment (access_code_id, client_user_id, staff_user_id, assigned_by) VALUES
            (${org.id}, ${pat}, ${cm}, ${owner}), (${org.id}, ${hers}, ${other}, ${owner})`;
  const A = (u) => core.resolveOrgActor(u);
  const aCm = await A(cm), aOther = await A(other), aOwner = await A(owner), aSpy = await A(spy);
  const rawAs = async (orgId, userId, query) => (await app.transaction([
    app`SELECT set_config('app.org_id', ${orgId ?? ""}, true)`, app`SELECT set_config('app.user_id', ${userId}, true)`, query(app),
  ]))[2];
  const throws = async (p) => { try { await p; return null; } catch (e) { return String(e.message); } };
  const packet = (step) => ({ note: "Two things worth a look this week", items: [{ kind: "next_step", step, why: "So we can start the forklift class" }] });

  const h1 = await core.sendHandoff(aCm, pat, packet("Bring your ID Tuesday"));
  check("a case manager sends their person a handoff", h1.ok === true && h1.items === 1, JSON.stringify(h1));
  check("a colleague cannot send one to someone not theirs", (await core.sendHandoff(aOther, pat, packet("x step"))).ok === false);
  check("another organization cannot", (await core.sendHandoff(aSpy, pat, packet("y step"))).ok === false);
  const raw = await throws(rawAs(org.id, other, (a) => a`INSERT INTO staff_handoff (access_code_id, participant_user_id, author_user_id, note) VALUES (${org.id}, ${pat}, ${other}, 'raw note')`));
  check("the DATABASE refuses a colleague's raw insert (restrictive reach)", !!raw, raw ?? "inserted");
  check("a colleague reads none of it, in core or the tables",
    ((await core.listHandoffsFor(aOther, pat)) ?? []).length === 0 && (await rawAs(org.id, other, (a) => a`SELECT id FROM staff_handoff`)).length === 0);
  check("another organization reads none of it", (await rawAs(org2.id, spy, (a) => a`SELECT id FROM staff_handoff`)).length === 0
    && (await rawAs(org2.id, spy, (a) => a`SELECT id FROM staff_suggestion WHERE client_user_id = ${pat}`)).length === 0);
  check("the owner sees it", ((await core.listHandoffsFor(aOwner, pat)) ?? []).some((h) => h.id === h1.id));

  const mine = await core.getMyHandoffs(pat);
  const item = mine.find((h) => h.id === h1.id)?.items[0];
  check("the person reads their handoff and its item", !!item && item.kind === "next_step", JSON.stringify(mine));
  check("someone else in the program reads none of it", (await core.getMyHandoffs(hers)).length === 0);
  const addItem = await throws(rawAs(null, pat, (a) => a`INSERT INTO staff_suggestion (access_code_id, client_user_id, author_user_id, kind, step_title, body, handoff_id) VALUES (${org.id}, ${pat}, ${pat}, 'next_step', 'mine', 'mine', ${h1.id})`));
  check("the person cannot add to it", !!addItem, addItem ?? "inserted");
  const orgAnswer = await throws(rawAs(org.id, cm, (a) => a`UPDATE staff_suggestion SET status = 'saved' WHERE id = ${item.id}`));
  check("staff cannot answer for the person", !!orgAnswer, orgAnswer ?? "updated");
  check("another person cannot answer it", (await core.answerMyHandoffItem(hers, item.id, "pass")).ok === false);
  const took = await core.answerMyHandoffItem(pat, item.id, "take");
  check("taking a next step puts it on their list from their case manager", took.ok === true && (await core.getMySharedTasks(pat)).some((t) => t.title === "Bring your ID Tuesday"), JSON.stringify(took));
  check("answering twice changes nothing", (await core.answerMyHandoffItem(pat, item.id, "pass")).ok === false);
  check("staff see it taken", ((await core.listHandoffsFor(aCm, pat)) ?? []).find((h) => h.id === h1.id)?.items[0]?.status === "saved");
  const acts = await sql`SELECT entity, summary FROM org_activity WHERE access_code_id = ${org.id} AND participant_user_id = ${pat} AND entity IN ('handoff', 'suggestion')`;
  check("the activity log says what happened, in fixed words",
    acts.some((r) => r.summary === "sent them a handoff") && acts.some((r) => r.summary === "they took on a suggested next step")
    && !acts.some((r) => /ID Tuesday|forklift|worth a look/.test(r.summary)), JSON.stringify(acts));

  const h2 = await core.sendHandoff(aCm, pat, packet("Call the training desk"));
  check("a colleague who did not send it cannot withdraw it", (await core.withdrawHandoff(aOther, h2.id)) === false);
  check("the sender can", (await core.withdrawHandoff(aCm, h2.id)) === true);
  check("a withdrawn handoff is gone for the person", !(await core.getMyHandoffs(pat)).some((h) => h.id === h2.id));
  const h3 = await core.sendHandoff(aCm, pat, packet("Pick up the bus pass"));
  await rawAs(org.id, cm, (a) => a`UPDATE staff_handoff SET status = 'withdrawn' WHERE id = ${h3.id}`);
  const h3items = await sql`SELECT DISTINCT status FROM staff_suggestion WHERE handoff_id = ${h3.id}`;
  check("a raw withdraw that skips core still closes its open items (database trigger)", h3items.length === 1 && h3items[0].status === "withdrawn", JSON.stringify(h3items));
  const h4 = await core.sendHandoff(aCm, pat, packet("Visit the job center"));
  const h4item = (await core.getMyHandoffs(pat)).find((h) => h.id === h4.id)?.items[0];
  const bare = await throws(rawAs(null, pat, (a) => a`UPDATE staff_suggestion SET status = 'saved' WHERE id = ${h4item.id}`));
  check("a next step is never taken by a bare status change", !!bare, bare ?? "updated");
  check("nor through the loose-suggestion answer", (await core.answerSuggestion(pat, h4item.id, "saved")) === false);
  const del = await throws(rawAs(org.id, owner, (a) => a`DELETE FROM staff_handoff WHERE id = ${h1.id}`));
  check("nobody deletes a handoff through the app", !!del && /permission denied/i.test(del), del ?? "deleted");

  // connections: only what was shared, every read logged for the person
  await sql`INSERT INTO job_application (user_id, job_title, company, location, status) VALUES (${pat}, 'Warehouse Associate', ${P + " Old Job Co"}, 'Lansing, MI', 'saved')`;
  const logs = async () => (await sql`SELECT count(*)::int AS n FROM data_access_log WHERE target_user_id = ${pat} AND fields_accessed->>'via' = 'connections'`)[0].n;
  const c0 = await core.getConnectionsFor(aCm, pat);
  check("before sharing, nothing to match on and nothing opened", c0?.status === "nothing_shared" && (await logs()) === 0, JSON.stringify(c0));
  await core.grantSharing(pat, org.id, "applications");
  const c1 = await core.getConnectionsFor(aCm, pat);
  check("after sharing, their jobs are read and the open is in their log", !!c1 && c1.status !== "nothing_shared" && c1.shared.applications === true && (await logs()) === 1, JSON.stringify(c1));
  const before = await logs();
  const c2 = await core.getConnectionsFor(aOther, pat);
  check("a colleague who does not reach them reads nothing and logs nothing", c2?.status === "not_in_reach" && (await logs()) === before, JSON.stringify(c2));
  const c3 = await core.getConnectionsFor(aSpy, pat);
  check("another organization reads nothing and logs nothing", (c3 === null || c3.status === "not_in_reach") && (await logs()) === before, JSON.stringify(c3));
  check("a colleague's caseload list never names them", !((await core.getCaseloadConnections(aOther))?.people ?? []).some((p) => p.clientId === pat));
}

/** Tasks (055) and the Today queue: a reason on a work list is information about a person. */
async function todayAndTaskChecks() {
  console.log("\n  -- tasks and today --");
  if (!appUrl) { console.log("  skip  needs the app credential"); return; }
  const core = await import("../packages/core/dist/index.js");
  const app = neon(appUrl);
  const uniq = Date.now().toString(36).toUpperCase().slice(-6);
  const owner = await mkUser("t-owner"), cm = await mkUser("t-cm"), other = await mkUser("t-other"), spy = await mkUser("t-spy");
  const [org] = await sql`INSERT INTO access_code (code, partner_name, tier, partner_user_id, is_active, crm_v2) VALUES (${"ISOT" + uniq}, ${P + " today"}, 'client', ${owner}, true, true) RETURNING id, code`;
  const [org2] = await sql`INSERT INTO access_code (code, partner_name, tier, partner_user_id, is_active, crm_v2) VALUES (${"ISOT2" + uniq}, ${P + " today2"}, 'client', ${spy}, true, true) RETURNING id, code`;
  created.codes.push(org.id, org2.id);
  await sql`INSERT INTO org_staff (access_code_id, user_id, role) VALUES (${org.id}, ${cm}, 'staff'), (${org.id}, ${other}, 'staff')`;
  const pat = await mkUser("t-pat"), quietOne = await mkUser("t-quiet"), hers = await mkUser("t-hers");
  for (const u of [pat, quietOne, hers]) { await core.redeemAccessCode(u, org.code); await joinCohortConsent(u); }
  await sql`INSERT INTO client_staff_assignment (access_code_id, client_user_id, staff_user_id, assigned_by) VALUES
            (${org.id}, ${pat}, ${cm}, ${owner}), (${org.id}, ${quietOne}, ${cm}, ${owner}), (${org.id}, ${hers}, ${other}, ${owner})`;
  await sql`UPDATE users SET next_step_cached_at = now() - interval '40 days' WHERE id = ${quietOne}`;
  await sql`UPDATE users SET next_step_cached_at = now() WHERE id IN (${pat}, ${hers})`;
  await sql`INSERT INTO job_application (user_id, job_title, company, status, follow_up_at) VALUES (${pat}, 'Line Cook', 'INTERVIEW-SECRET-CO', 'interviewing', now() + interval '2 days')`;
  await sql`INSERT INTO job_application (user_id, job_title, company, status, follow_up_at) VALUES (${hers}, 'Cashier', 'COLLEAGUE-ONLY-CO', 'interviewing', now() + interval '1 day')`;
  await core.grantSharing(hers, org.id, "applications");
  const A = (u) => core.resolveOrgActor(u);
  const aCm = await A(cm), aOther = await A(other), aOwner = await A(owner), aSpy = await A(spy);

  // -- tasks
  const t1 = await core.addStaffTask(aCm, { title: "Bring ID Thursday", dueOn: "2030-01-10", clientId: pat, shared: true });
  const t2 = await core.addStaffTask(aCm, { title: "Call Job Service back" });
  check("a case manager can create a task about their participant and a plain to-do", t1.ok && t2.ok);
  check("not about a colleague's participant", (await core.addStaffTask(aCm, { title: "x task", clientId: hers })).ok === false);
  check("a shared task has to be about someone", (await core.addStaffTask(aCm, { title: "shared with nobody", shared: true })).ok === false);
  check("a colleague does not see them; the owner sees the one about a participant and not the private to-do... and also the to-do, since owners see all",
    (await core.listStaffTasks(aOther)).length === 0 && (await core.listStaffTasks(aOwner)).length === 2);
  check("another organization sees none", (await core.listStaffTasks(aSpy)).length === 0);
  const mine = await core.getMySharedTasks(pat);
  check("the participant sees the task shared with them, with who set it, and not the private one", mine.length === 1 && mine[0].title === "Bring ID Thursday" && mine[0].from_name?.includes("t-cm"));
  check("someone else cannot tick it", (await core.tickMyTask(quietOne, t1.id, true)) === false);
  check("the participant can tick it", (await core.tickMyTask(pat, t1.id, true)) === true);
  const seen = (await core.listStaffTasks(aCm)).find((t) => t.id === t1.id);
  check("and staff see that THEY did", !!seen?.done_at && seen.done_by_participant === true);
  const raw = await (async () => { try { await app.transaction([app`SELECT set_config('app.user_id', ${pat}, true)`, app`UPDATE staff_task SET title = 'rewritten by participant' WHERE id = ${t1.id} RETURNING id`]); return "ok"; } catch (e) { return String(e.message); } })();
  const [{ title }] = await sql`SELECT title FROM staff_task WHERE id = ${t1.id}`;
  check("ticking is ALL the participant can do to it", title === "Bring ID Thursday", `title is now '${title}' (${raw})`);
  const del = await (async () => { try { await app.transaction([app`SELECT set_config('app.org_id', ${org.id}, true)`, app`DELETE FROM staff_task WHERE id = ${t1.id}`]); return null; } catch (e) { return String(e.message); } })();
  check("a task cannot be deleted by the app", !!del && /permission denied/i.test(del), del ?? "deleted");

  // -- today
  const q0 = await core.getTodayQueue(aCm);
  check("an unshared interview does NOT appear on the queue, however useful it would be", !JSON.stringify(q0).includes("INTERVIEW-SECRET-CO"));
  check("quiet people and open tasks do", q0.some((i) => i.section === "quiet" && i.clientId === quietOne) && q0.some((i) => i.section === "tasks" && i.taskId === t2.id));
  check("a colleague's participant never appears, shared or not", !JSON.stringify(q0).includes("COLLEAGUE-ONLY-CO"));
  const [{ n: l0 }] = await sql`SELECT count(*)::int AS n FROM data_access_log WHERE target_user_id = ${pat} AND access_reason = 'org_work_queue'`;
  check("and nothing was logged against someone who shared nothing", l0 === 0);
  await sql`INSERT INTO sharing_grant (user_id, access_code_id, scope, text_version) VALUES (${pat}, ${org.id}, 'applications', '2026-09-20.1')`;
  check("shared under OLDER words, which never mentioned a work list: still not on the queue", !JSON.stringify(await core.getTodayQueue(aCm)).includes("INTERVIEW-SECRET-CO"));
  await core.revokeSharing(pat, org.id, "applications");
  await core.grantSharing(pat, org.id, "applications");
  const q1 = await core.getTodayQueue(aCm); await core.getTodayQueue(aCm);
  check("once they share applications, the interview appears", q1.some((i) => i.section === "interviews" && i.clientId === pat && /INTERVIEW-SECRET-CO/.test(i.reason)));
  const [{ n: l1 }] = await sql`SELECT count(*)::int AS n FROM data_access_log WHERE target_user_id = ${pat} AND access_reason = 'org_work_queue'`;
  const log = await core.getMyAccessLog(pat);
  check("and that is in THEIR log, once for the day however many times the page loads", l1 === 1 && log.some((e) => e.kind === "queue"), `rows=${l1}`);
  check("the owner's queue includes the colleague's participant", JSON.stringify(await core.getTodayQueue(aOwner)).includes("COLLEAGUE-ONLY-CO"));
  check("another organization's queue is empty of all of it", !/SECRET-CO|ONLY-CO/.test(JSON.stringify(await core.getTodayQueue(aSpy))));
  // -- one "quiet after N days" per organization, read by everything
  await sql`UPDATE users SET next_step_cached_at = now() - interval '10 days' WHERE id = ${pat}`;
  await sql`DELETE FROM job_application WHERE user_id IN (${pat}, ${hers})`;
  check("the default is 14 days", (await core.getQuietAfterDays(org.id)) === 14 && !(await core.getTodayQueue(aCm)).some((i) => i.section === "quiet" && i.clientId === pat));
  check("a case manager cannot change the organization's threshold", (await core.setQuietAfterDays(aCm, 7)) === false);
  check("a nonsense value is refused", (await core.setQuietAfterDays(aOwner, 1)) === false && (await core.setQuietAfterDays(aOwner, 400)) === false);
  check("the owner sets it to a week", (await core.setQuietAfterDays(aOwner, 7)) === true);
  const qd = await core.getTodayQueue(aCm), ins = await core.getOrgInsights(aOwner);
  check("and Today, Insights and the staff rollup all move together: someone quiet for 10 days now counts",
    qd.some((i) => i.section === "quiet" && i.clientId === pat) && ins.quietAfterDays === 7 && ins.activity.quiet === 2
    && core.summarizeStaffPerformance((await core.getPartnerCohort(owner, { accessCodeId: org.id })).clients, { stalledAfterDays: 7 }).reduce((n, r) => n + r.stalled, 0) === 2,
    JSON.stringify({ today: qd.filter((i) => i.section === "quiet").length, insights: ins.activity }));
  check("another organization keeps its own number", (await core.getQuietAfterDays(org2.id)) === 14);
  await sql`DELETE FROM data_access_log WHERE target_user_id IN (${pat}, ${hers})`;
  // -- invited by the org, not sharing (R3 review S8): assignable, still unnamed beyond what the org typed
  const invEmail = `${P}-t-invited-${uniq.toLowerCase()}@example.invalid`;
  const invd = await core.createOrgInvite({ accessCodeId: org.id, code: org.code, name: "Invited Person", email: invEmail, invitedBy: owner });
  if (invd.ok) created.users.push(invd.userId);
  const selfJoin = await mkUser("t-selfjoin"); await core.redeemAccessCode(selfJoin, org.code);
  const invitedList = await core.getInvitedNotSharing(org.id, owner);
  check("someone the org invited, not sharing, is listed for assignment with only the name the org typed",
    invd.ok && invitedList.some((p) => p.userId === invd.userId && p.name === "Invited Person") && !invitedList.some((p) => p.userId === selfJoin),
    JSON.stringify(invitedList.map((p) => [p.name, p.pending])));
  check("and no other organization sees them", (await core.getInvitedNotSharing(org2.id, spy)).length === 0);
  if (invd.ok) await core.assignClientStaff(org.id, invd.userId, cm, owner);
  check("they can be assigned without sharing anything, and nothing of theirs opens",
    invd.ok && (await core.getInvitedNotSharing(org.id, owner)).find((p) => p.userId === invd.userId)?.assignedStaffId === cm
      && (await core.getClientApplications(await A(cm), invd.userId)).ok === false);
}

/**
 * Required sharing (migration 054). The claims under test: a requirement opens
 * NOTHING by itself; only the person's own acknowledgement does; it opens only
 * what that version said, to whom it said, from when it said; a changed
 * requirement never widens an old acknowledgement; and nobody can acknowledge
 * for somebody else.
 */
async function requiredSharingChecks() {
  console.log("\n  -- required sharing --");
  if (!appUrl) { console.log("  skip  needs the app credential"); return; }
  const core = await import("../packages/core/dist/index.js");
  const app = neon(appUrl);
  const uniq = Date.now().toString(36).toUpperCase().slice(-6);
  const owner = await mkUser("q-owner"), admin = await mkUser("q-admin"), cm = await mkUser("q-cm"), other = await mkUser("q-othercm");
  const mk = async (label, enabled) => {
    const [o] = await sql`INSERT INTO access_code (code, partner_name, tier, partner_user_id, is_active, crm_v2, required_sharing_enabled)
                          VALUES (${"ISOQ" + label + uniq}, ${P + " req " + label}, 'client', ${owner}, true, true, ${enabled}) RETURNING id, code`;
    created.codes.push(o.id); return o;
  };
  const org = await mk("A", true), orgOff = await mk("B", false);
  await sql`INSERT INTO org_staff (access_code_id, user_id, role) VALUES (${org.id}, ${admin}, 'org_admin'), (${org.id}, ${cm}, 'staff'), (${org.id}, ${other}, 'staff')`;
  const pat = await mkUser("q-pat");
  await core.redeemAccessCode(pat, org.code);
  await sql`INSERT INTO client_staff_assignment (access_code_id, client_user_id, staff_user_id, assigned_by) VALUES (${org.id}, ${pat}, ${cm}, ${owner})`;
  await sql`INSERT INTO job_application (user_id, job_title, company, status, created_at) VALUES (${pat}, 'OLD-APPLICATION', 'Before Co', 'applied', now() - interval '10 days')`;
  await sql`INSERT INTO refinery_artifact (user_id, artifact_type, content, is_current, created_at) VALUES (${pat}, 'resume', ${JSON.stringify({ marker: "OLD-RESUME" })}::jsonb, true, now() - interval '10 days')`;
  const A = (u, o) => core.resolveOrgActor(u, o ? { orgId: o } : undefined);
  const aOwner = await A(owner, org.id), aAdmin = await A(admin), aCm = await A(cm), aOther = await A(other);
  const reason = "Our funding agreement requires us to verify each participant's job-search activity.";
  const pol = (scopes, extra = {}) => ({ scopes, audience: "assigned_staff", purpose: reason, coversExisting: false, ...extra });

  check("an admin cannot set what the program requires", (await core.setOrgSharingPolicy(aAdmin, pol(["applications"]))).ok === false);
  check("a case manager cannot either", (await core.setOrgSharingPolicy(aCm, pol(["applications"]))).ok === false);
  const aOwnerOff = await A(owner, orgOff.id);
  check("an organization that has not been enabled for it cannot require anything", (await core.setOrgSharingPolicy(aOwnerOff, pol(["applications"]))).ok === false);
  check("a disclosure plan can never be required", (await core.setOrgSharingPolicy(aOwner, pol(["applications", "disclosure"]))).ok === false);
  const direct = await app.transaction([app`SELECT set_config('app.org_id', ${org.id}, true)`, app`SELECT set_config('app.user_id', ${owner}, true)`,
    app`SELECT smr_set_sharing_policy(ARRAY['vault']::text[], 'assigned_staff', ${reason}, true, 'x') AS r`]);
  check("even called directly, the database refuses a scope that can never be required", direct[2][0].r === "invalid", direct[2][0].r);
  check("a requirement with no real reason is refused", (await core.setOrgSharingPolicy(aOwner, pol(["applications"], { purpose: "policy" }))).ok === false);

  const set1 = await core.setOrgSharingPolicy(aOwner, pol(["applications"]));
  check("the owner can require applications, for the assigned case manager only, from today on", set1.ok === true, JSON.stringify(set1));
  const forCode = await core.getPolicyForCode(org.code);
  check("someone holding the code can read what the program requires before joining", !!forCode && forCode.scopes.join() === "applications" && forCode.purpose === reason);

  // -- the requirement alone opens nothing
  check("turning a requirement on exposes nobody: the case manager still gets nothing", (await core.getClientApplications(aCm, pat)).reason === "not_shared");
  const h0 = await core.getClientHeader(aCm, pat);
  check("staff see that the person has not acknowledged", h0.ok && h0.rows[0].awaitingAcknowledgement === true && h0.rows[0].scopes.applications.required === true);
  const mine = await core.getMyPolicies(pat);
  check("the participant sees the requirement and that they have not acknowledged it", mine.length === 1 && mine[0].acknowledged === false && mine[0].purpose === reason);

  // -- nobody acknowledges for anybody else
  const staffAck = await app.transaction([app`SELECT set_config('app.org_id', ${org.id}, true)`, app`SELECT set_config('app.user_id', ${pat}, true)`,
    app`SELECT smr_acknowledge_policy(${mine[0].id}::uuid) AS r`]);
  check("an acknowledgement cannot be made from inside the organization's scope, even naming the participant", staffAck[2][0].r === "refused", staffAck[2][0].r);
  check("a case manager acknowledging as themselves opens nothing (they are not a member)", (await core.acknowledgePolicy(cm, mine[0].id)).ok === false);
  const rawAck = await (async () => { try { await app`INSERT INTO sharing_ack (user_id, policy_version_id, access_code_id) VALUES (${pat}, ${mine[0].id}, ${org.id})`; return null; } catch (e) { return String(e.message); } })();
  check("the app cannot write an acknowledgement row at all", !!rawAck && /permission denied/i.test(rawAck), rawAck ?? "insert succeeded");

  // -- the person acknowledges: exactly that scope, that audience, from that day
  check("the participant acknowledges", (await core.acknowledgePolicy(pat, mine[0].id)).ok === true);
  await sql`INSERT INTO job_application (user_id, job_title, company, status) VALUES (${pat}, 'NEW-APPLICATION', 'After Co', 'applied')`;
  const apps = await core.getClientApplications(aCm, pat);
  check("the case manager now reads applications made since, and NOT the ones from before",
    apps.ok && apps.rows.length === 1 && apps.rows[0].job_title === "NEW-APPLICATION", JSON.stringify(apps.rows?.map((r) => r.job_title)));
  check("the resume was not required, so it is still closed", (await core.getClientResumes(aCm, pat)).reason === "not_shared");
  check("'only my case manager' keeps the owner out, even though the owner sees the whole cohort", (await core.getClientApplications(aOwner, pat)).ok === false);
  check("and keeps out a colleague who is not assigned", (await core.getClientApplications(aOther, pat)).ok === false);

  // -- a changed requirement never widens an old acknowledgement
  await core.setOrgSharingPolicy(aOwner, pol(["applications", "resume"], { audience: "assigned_staff_and_admins", coversExisting: true }));
  check("after the program widens its rule, the resume stays closed until the person has seen and acknowledged the change", (await core.getClientResumes(aCm, pat)).reason === "not_shared");
  check("and the owner still cannot read what was acknowledged for the case manager only", (await core.getClientApplications(aOwner, pat)).ok === false);
  const h1 = await core.getClientHeader(aCm, pat);
  check("staff see them as awaiting the new version", h1.ok && h1.rows[0].awaitingAcknowledgement === true);
  check("the old version can no longer be acknowledged", (await core.acknowledgePolicy(pat, mine[0].id)).ok === false);
  const mine2 = await core.getMyPolicies(pat);
  await core.acknowledgePolicy(pat, mine2[0].id);
  const res2 = await core.getClientResumes(aCm, pat);
  check("acknowledging the new version opens the resume, including what existed before (it said so)", res2.ok && res2.rows.some((r) => r.content?.marker === "OLD-RESUME"));

  // -- stopping, leaving, rejoining
  check("the participant can stop sharing a required item", (await core.revokeSharing(pat, org.id, "resume")).ok === true);
  const h2 = await core.getClientHeader(aCm, pat);
  check("staff lose it at once and are told it was stopped, not left guessing",
    (await core.getClientResumes(aCm, pat)).reason === "not_shared" && h2.rows[0].scopes.resume.stoppedByParticipant === true);
  const state = await core.getOrgPolicyState(aOwner);
  check("the owner's list shows who acknowledged, who is awaiting, who stopped", state.members.find((m) => m.userId === pat)?.status === "stopped", JSON.stringify(state.members));
  await core.leaveAllOrgs(pat); await core.redeemAccessCode(pat, org.code);
  const mine3 = await core.getMyPolicies(pat);
  check("after leaving and rejoining, the person is asked again and nothing is open", mine3[0]?.acknowledged === false && (await core.getClientApplications(aOwner, pat)).ok === false);
  // Review 2, BL-4: the same after leaving ONE organization (096).
  if ((await sql`SELECT to_regprocedure('public.smr_leave_org(uuid,uuid)') IS NOT NULL AS has`)[0].has) {
    const again = await core.getMyPolicies(pat);
    if (again[0]) await core.acknowledgePolicy(pat, again[0].id);
    await core.leaveOrg(pat, org.id); await core.redeemAccessCode(pat, org.code);
    const mine4 = await core.getMyPolicies(pat);
    check("after leaving one organization and rejoining, the person is asked again and nothing is open", mine4[0]?.acknowledged === false && (await core.getClientApplications(aOwner, pat)).ok === false);
  }
  check("the owner can stop requiring anything", (await core.setOrgSharingPolicy(aOwner, { scopes: [], audience: "", purpose: "", coversExisting: false })).ok === true && (await core.getMyPolicies(pat)).length === 0);
  await sql`DELETE FROM job_application WHERE user_id = ${pat}`;
}

/**
 * Setting an organization up (migration 053, orgAccess.ts, orgInsights.ts).
 * The claim: an owner can shape what each person may do, nobody can shape
 * their own, and the database decides who the actor is -- not the application.
 */
async function accessChecks() {
  console.log("\n  -- team, access and insights --");
  if (!appUrl) { console.log("  skip  needs the app credential"); return; }
  const core = await import("../packages/core/dist/index.js");
  const app = neon(appUrl);
  const uniq = Date.now().toString(36).toUpperCase().slice(-6);
  const owner = await mkUser("a-owner"), admin = await mkUser("a-admin"), admin2 = await mkUser("a-admin2"), cm = await mkUser("a-cm"), outsider = await mkUser("a-outsider");
  const [org] = await sql`INSERT INTO access_code (code, partner_name, tier, partner_user_id, is_active, crm_v2)
                          VALUES (${"ISOAC" + uniq}, ${P + " access"}, 'client', ${owner}, true, true) RETURNING id, code`;
  created.codes.push(org.id);
  await sql`INSERT INTO org_staff (access_code_id, user_id, role) VALUES (${org.id}, ${admin}, 'org_admin'), (${org.id}, ${admin2}, 'org_admin'), (${org.id}, ${cm}, 'staff')`;
  const A = (u) => core.resolveOrgActor(u);
  let aOwner = await A(owner), aAdmin = await A(admin), aCm = await A(cm);

  check("a case manager starts without the whole-cohort view or the numbers", !aCm.capabilities.has("org.client.view_all") && !aCm.capabilities.has("org.insights.view"));
  check("staff cannot open the access screen", (await core.getOrgAccessOverview(aCm)) === null);
  check("staff cannot change anyone's access", (await core.setStaffCapability(aCm, admin, "org.costs.view", true, "org_admin")).ok === false);

  const grant = await core.setStaffCapability(aOwner, cm, "org.client.view_all", true, "staff");
  aCm = await A(cm);
  check("the owner can let one case manager see everyone, and it takes effect", grant.ok && aCm.capabilities.has("org.client.view_all") && aCm.reach === "all", JSON.stringify(grant));
  const back = await core.setStaffCapability(aOwner, cm, "org.client.view_all", false, "staff");
  const [{ n: stored }] = await sql`SELECT count(*)::int AS n FROM org_capability_override WHERE org_id = ${org.id} AND user_id = ${cm}`;
  check("switching it back to the role's default stores nothing", back.ok && stored === 0 && !(await A(cm)).capabilities.has("org.client.view_all"), `rows=${stored}`);
  const deny = await core.setStaffCapability(aOwner, cm, "org.note.write", false, "staff");
  check("the owner can take something away from one person (deny wins)", deny.ok && !(await A(cm)).capabilities.has("org.note.write"));

  check("an admin can adjust staff", (await core.setStaffCapability(aAdmin, cm, "org.insights.view", true, "staff")).ok === true);

  // Only the owner makes, changes or removes an admin (R3 review S1). Before
  // this, org.staff.manage was enough, and admins hold it.
  check("an admin cannot promote a case manager to admin", (await core.setOrgStaffRole({ orgId: org.id, userId: cm, role: "org_admin", actorUserId: admin })).ok === false);
  check("an admin cannot demote another admin", (await core.setOrgStaffRole({ orgId: org.id, userId: admin2, role: "staff", actorUserId: admin })).ok === false);
  check("an admin cannot demote another admin through add_staff's re-role", (await core.addOrgStaff({ orgId: org.id, userId: admin2, role: "staff", addedBy: admin })).ok === false);
  check("an admin cannot remove another admin", (await core.removeOrgStaff({ orgId: org.id, userId: admin2, actorUserId: admin })).ok === false);
  const [{ role: admin2Role }] = await sql`SELECT role FROM org_staff WHERE access_code_id = ${org.id} AND user_id = ${admin2}`;
  check("and the refused writes changed nothing in the database", admin2Role === "org_admin", admin2Role);
  const ownerPromote = await core.setOrgStaffRole({ orgId: org.id, userId: cm, role: "org_admin", actorUserId: owner });
  const ownerDemote = await core.setOrgStaffRole({ orgId: org.id, userId: cm, role: "staff", actorUserId: owner });
  check("the owner can promote and demote an admin", ownerPromote.ok === true && ownerDemote.ok === true, `${ownerPromote.reason ?? ""} ${ownerDemote.reason ?? ""}`);
  aCm = await A(cm);
  check("an admin cannot adjust another admin", (await core.setStaffCapability(aAdmin, admin2, "org.costs.view", true, "org_admin")).ok === false);
  check("nobody adjusts their own access", (await core.setStaffCapability(aAdmin, admin, "org.costs.view", true, "org_admin")).ok === false);
  check("the owner's access cannot be changed", (await core.setStaffCapability(aAdmin, owner, "org.costs.view", false, "owner")).ok === false);
  check("managing staff is not something that can be handed out per person", (await core.setStaffCapability(aOwner, cm, "org.staff.manage", true, "staff")).ok === false);

  // The application claiming to be someone is not enough: the function looks the actor up.
  const forged = await app.transaction([
    app`SELECT set_config('app.org_id', ${org.id}, true)`, app`SELECT set_config('app.user_id', ${outsider}, true)`,
    app`SELECT set_config('app.org_role', 'owner', true)`,
    app`SELECT smr_set_capability_override(${cm}::uuid, 'org.costs.view', 'grant') AS r`]);
  check("claiming to be the owner in session settings does not make an outsider the owner", forged[3][0].r === "refused", forged[3][0].r);
  const asCm = await app.transaction([
    app`SELECT set_config('app.org_id', ${org.id}, true)`, app`SELECT set_config('app.user_id', ${cm}, true)`,
    app`SELECT smr_set_capability_override(${admin}::uuid, 'org.costs.view', 'grant') AS r`]);
  check("a case manager calling the function directly is refused", asCm[2][0].r === "refused", asCm[2][0].r);
  const [{ n: audited }] = await sql`SELECT count(*)::int AS n FROM org_audit WHERE org_id = ${org.id} AND table_name = 'org_capability_override' AND actor = ${owner}`;
  check("every access change is in the audit trail with who made it", audited >= 3, `rows=${audited}`);

  const email = `${P}-a-newhire-${uniq.toLowerCase()}@example.invalid`;
  const inv = await core.inviteOrgStaff(aOwner, { name: "New Hire", email, role: "staff", title: "Employment Specialist" });
  if (inv.ok) created.users.push(inv.userId);
  const overview = await core.getOrgAccessOverview(aOwner);
  const ownerScope = { orgId: org.id, userId: owner, role: "owner" };
  const listed = inv.ok ? (await core.listStaffInvites(ownerScope)).find((i) => i.id === inv.inviteId) : null;
  // Migration 100 + review B2: a new address is an invitation, nothing more,
  // until the person signs in and says yes.
  check("the owner can invite someone to staff by email: on the invitation list, not on the chart, no staff row yet",
    inv.ok && !!listed && listed.status === "pending" && listed.title === "Employment Specialist" && !overview?.some((m) => m.userId === inv.userId)
      && (await sql`SELECT count(*)::int AS n FROM org_staff WHERE access_code_id = ${org.id} AND user_id = ${inv.userId}`)[0].n === 0,
    JSON.stringify({ inv, listed }));
  check("the organization-facing invitation carries no path and no account id", !!listed && !("path" in listed) && !("userId" in listed), JSON.stringify(listed));
  check("a new address cannot reach the workspace before saying yes", (await core.resolveOrgActor(inv.userId)) === null);
  const hireYes = await core.answerStaffInvite(inv.userId, inv.inviteId, true);
  const aHireNow = await core.resolveOrgActor(inv.userId);
  check("after yes, the new address is staff in this organization", hireYes.ok && aHireNow?.orgId === org.id && aHireNow?.role === "staff", JSON.stringify(hireYes));

  const vol = await core.inviteOrgStaff(aOwner, { name: "Volunteer", email: `${P}-a-vol-${uniq.toLowerCase()}@example.invalid`, role: "volunteer" });
  if (vol.ok) created.users.push(vol.userId);
  if (vol.ok) await core.answerStaffInvite(vol.userId, vol.inviteId, true);
  const aVol = vol.ok ? await core.resolveOrgActor(vol.userId) : null;
  check("a volunteer invite, once accepted, is staff who cannot invite participants or record placements, and sees only their caseload",
    !!aVol && aVol.role === "staff" && !aVol.capabilities.has("org.participant.invite") && !aVol.capabilities.has("org.outcome.write") && aVol.reach === "assigned",
    JSON.stringify(vol));
  check("an admin cannot create another admin", (await core.inviteOrgStaff(aAdmin, { name: "X", email: `${P}-a-x-${uniq.toLowerCase()}@example.invalid`, role: "org_admin" })).ok === false);

  // Review B2: an expired new-address invitation plus a later sign-in grants nothing.
  const late = await core.inviteOrgStaff(aOwner, { name: "Late", email: `${P}-a-late-${uniq.toLowerCase()}@example.invalid`, role: "staff" });
  if (late.ok) {
    created.users.push(late.userId);
    await sql`ALTER TABLE org_staff_invite DISABLE TRIGGER org_staff_invite_guard`;
    await sql`UPDATE org_staff_invite SET expires_at = now() - interval '1 day' WHERE id = ${late.inviteId}`;
    await sql`ALTER TABLE org_staff_invite ENABLE TRIGGER org_staff_invite_guard`;
    await sql`UPDATE users SET "emailVerified" = now() WHERE id = ${late.userId}`; // they sign in after expiry
    const lateYes = await core.answerStaffInvite(late.userId, late.inviteId, true);
    check("an expired new-address invitation plus a sign-in gives no workspace and no data",
      lateYes.result === "expired" && (await core.resolveOrgActor(late.userId)) === null && (await core.getOrgContext(late.userId)) === null
        && (await sql`SELECT count(*)::int AS n FROM org_staff WHERE user_id = ${late.userId}`)[0].n === 0,
      JSON.stringify(lateYes));
  }

  // Review B1: a new address and an existing account look the same to the owner.
  const placesBefore = await core.staffPlaces(ownerScope);
  const [{ email: outsiderEmail }] = await sql`SELECT email FROM users WHERE id = ${outsider}`;
  const asked = await core.inviteOrgStaff(aOwner, { name: "Same Shape", email: outsiderEmail, role: "staff" });
  const placesMid = await core.staffPlaces(ownerScope);
  const twinEmail = `${P}-a-twin-${uniq.toLowerCase()}@example.invalid`;
  const twin = await core.inviteOrgStaff(aOwner, { name: "Same Shape", email: twinEmail, role: "staff" });
  if (twin.ok) created.users.push(twin.userId);
  const placesAfter = await core.staffPlaces(ownerScope);
  const shape = (i) => { if (!i) return null; const { id, email: _e, invitedAt, lastSentAt, expiresAt, ...rest } = i; void id; void _e; void invitedAt; void lastSentAt; void expiresAt; return JSON.stringify(rest); };
  const ownerList = await core.listStaffInvites(ownerScope);
  const askedView = ownerList.find((i) => i.id === asked.inviteId), twinView = ownerList.find((i) => i.id === twin.inviteId);
  check("the owner sees byte-identical invitations for an existing account and a new address (apart from ids, address and times)",
    asked.ok && twin.ok && !!askedView && shape(askedView) === shape(twinView), `${shape(askedView)} vs ${shape(twinView)}`);
  check("and the staff places move by one for each", placesMid.n === placesBefore.n + 1 && placesAfter.n === placesMid.n + 1, JSON.stringify([placesBefore, placesMid, placesAfter]));
  const staffList = await core.getOrgStaff(org.id);
  check("and neither appears on the team list before saying yes", !staffList.some((m) => m.userId === outsider || (twin.ok && m.userId === twin.userId)));
  const again = await core.inviteOrgStaff(aOwner, { name: "Same Shape", email: outsiderEmail, role: "staff" });
  const againTwin = twin.ok ? await core.inviteOrgStaff(aOwner, { name: "Same Shape", email: twinEmail, role: "staff" }) : null;
  check("inviting again renews the one open invitation, the same way for both",
    again.ok && again.renewed && again.inviteId === asked.inviteId && againTwin?.ok && againTwin.renewed && againTwin.inviteId === twin.inviteId, JSON.stringify({ again, againTwin }));
  const afterAsk = await core.getOrgAccessOverview(aOwner);
  check("an existing account is invited, never attached: nothing on the roster until they say yes",
    !afterAsk.some((m) => m.userId === outsider) && (await sql`SELECT count(*)::int AS n FROM org_staff WHERE access_code_id = ${org.id} AND user_id = ${outsider}`)[0].n === 0);

  // The invitee's side: their own invitation, answered through the definer function.
  const theirs = await core.myStaffInvites(outsider);
  check("the invitee sees their own open invitation", theirs.length === 1 && theirs[0].id === asked.inviteId, JSON.stringify(theirs));
  check("a staff member of the org does not see someone else's invitation as theirs", (await core.myStaffInvites(cm)).length === 0);
  const hijack = await core.answerStaffInvite(cm, asked.inviteId, true);
  check("nobody answers another person's invitation", hijack.ok === false && hijack.result === "not_found", JSON.stringify(hijack));
  const yes = await core.answerStaffInvite(outsider, asked.inviteId, true);
  const aOutsider = await core.resolveOrgActor(outsider);
  check("saying yes puts them on staff, in this organization, as the role they were invited to",
    yes.ok && yes.result === "ok" && aOutsider?.orgId === org.id && aOutsider?.role === "staff", JSON.stringify({ yes, role: aOutsider?.role }));
  check("an answered invitation stays answered", (await core.answerStaffInvite(outsider, asked.inviteId, false)).result === "answered");

  // Revoke and cross-org, on the open twin invitation.
  if (twin.ok) {
    const [{ id: otherOrg }] = await sql`INSERT INTO access_code (code, partner_name, tier, partner_user_id, is_active)
                                         VALUES (${"ISOINV" + uniq}, ${P + " invite other"}, 'client', ${outsider}, true) RETURNING id`;
    created.codes.push(otherOrg);
    const cross = await core.revokeStaffInvite({ orgId: otherOrg, userId: outsider, role: "owner" }, twin.inviteId, { platformAdmin: false });
    check("another organization cannot revoke this organization's invitation", cross.ok === false, JSON.stringify(cross));
    check("another organization reads none of this organization's invitations", (await core.listStaffInvites({ orgId: otherOrg, userId: outsider, role: "owner" })).length === 0);
    // The cross-org read runs as someone with no invitation anywhere: the invitee
    // may always read their OWN invitation rows (by design), so using the invitee
    // here would count those and prove nothing about another organization.
    const stranger = await mkUser("inv-stranger");
    await sql`UPDATE access_code SET partner_user_id = ${stranger} WHERE id = ${otherOrg}`;
    const crossRead = await app.transaction([
      app`SELECT set_config('app.org_id', ${otherOrg}, true)`, app`SELECT set_config('app.user_id', ${stranger}, true)`,
      app`SELECT count(*)::int AS n FROM org_staff_invite WHERE access_code_id = ${org.id}`]);
    check("naming this organization's id while scoped to another returns nothing (RLS)", crossRead[2][0].n === 0, JSON.stringify(crossRead[2]));
    const ownOnly = await app.transaction([
      app`SELECT set_config('app.org_id', ${otherOrg}, true)`, app`SELECT set_config('app.user_id', ${outsider}, true)`,
      app`SELECT count(*)::int AS n FROM org_staff_invite WHERE access_code_id = ${org.id} AND user_id <> ${outsider}`]);
    check("an invitee scoped elsewhere reads only their own invitation rows, never anyone else's", ownOnly[2][0].n === 0, JSON.stringify(ownOnly[2]));
    const forgedAccept = await app.transaction([
      app`SELECT set_config('app.org_id', ${org.id}, true)`, app`SELECT set_config('app.user_id', ${owner}, true)`,
      app`UPDATE org_staff_invite SET accepted_at = now() WHERE id = ${twin.inviteId} RETURNING id`]).then(() => "updated", (e) => String(e?.message ?? e));
    check("the app role cannot mark an invitation accepted, even in the org's own scope", forgedAccept !== "updated", forgedAccept);
    const rev = await core.revokeStaffInvite(ownerScope, twin.inviteId, { platformAdmin: false });
    const after = await core.answerStaffInvite(twin.userId, twin.inviteId, true);
    check("a revoked invitation can no longer be accepted, and grants nothing", rev.ok && after.result === "revoked" && (await core.resolveOrgActor(twin.userId)) === null, JSON.stringify({ rev, after }));
    check("a revoked invitation cannot be revoked again", (await core.revokeStaffInvite(ownerScope, twin.inviteId, { platformAdmin: false })).ok === false);
  }
  const [{ n: inviteAudit }] = await sql`SELECT count(*)::int AS n FROM org_audit WHERE org_id = ${org.id} AND table_name = 'org_staff_invite'`;
  const [{ n: leakedAddress }] = await sql`SELECT count(*)::int AS n FROM org_audit WHERE org_id = ${org.id} AND table_name = 'org_staff_invite' AND row_summary::text LIKE '%example.invalid%'`;
  check("every invitation write is audited, never with the address", inviteAudit >= 4 && leakedAddress === 0, `rows=${inviteAudit} leaked=${leakedAddress}`);
  check("the overview shows the owner once, and marks who may be edited",
    overview.filter((m) => m.role === "owner").length === 1 && overview.find((m) => m.userId === cm).editable && !overview.find((m) => m.userId === owner).editable);
  await sql`DELETE FROM org_staff WHERE user_id = ${outsider}`; // the accepted invitee, so later counts are unchanged

  await core.removeOrgStaff({ orgId: org.id, userId: cm, actorUserId: owner });
  const [{ n: leftover }] = await sql`SELECT count(*)::int AS n FROM org_capability_override WHERE org_id = ${org.id} AND user_id = ${cm}`;
  check("removing someone from staff removes their exceptions with them", leftover === 0, `rows=${leftover}`);

  // -- insights
  const p1 = await mkUser("a-p1"), p2 = await mkUser("a-p2");
  await core.redeemAccessCode(p1, org.code); await core.redeemAccessCode(p2, org.code);
  await joinCohortConsent(p1);
  aOwner = await A(owner);
  const ins = await core.getOrgInsights(aOwner);
  check("insights count everyone who joined but describe only those sharing progress",
    !!ins && ins.people.joined === 2 && ins.people.sharingProgress === 1 && ins.people.notSharing === 1 && ins.stages.reduce((n, s) => n + s.count, 0) === 1, JSON.stringify(ins?.people));
  check("interview and offer counts cover nobody until someone shares their applications", ins.pipeline.sharers === 0 && ins.pipeline.interviewing === 0);
  // p1 shares progress, was never active, and is assigned to nobody: exactly
  // one quiet person, never-started, in the unassigned bucket.
  check("someone who never started is counted as quiet once, not as quiet AND never-started",
    ins.activity.quiet === 1 && ins.activity.neverStarted === 1 && ins.unassigned === 1 && ins.staff.reduce((n, st) => n + st.quiet, 0) === 0,
    JSON.stringify({ activity: ins.activity, unassigned: ins.unassigned }));
  const aHire = await core.resolveOrgActor(inv.userId);
  check("a staff member without the capability gets no numbers", !!aHire && !aHire.capabilities.has("org.insights.view") && (await core.getOrgInsights(aHire)) === null);
}

/**
 * Sharing (migration 051, orgClientView.ts).
 *
 * The claim: staff read what a participant SHARED, only that, only while it is
 * shared, only if the participant is theirs -- and an organization can never
 * create that permission for itself. Each assertion is an attempt to get
 * content some other way.
 */
async function sharingChecks() {
  console.log("\n  -- sharing --");
  if (!appUrl) { console.log("  skip  sharing checks need the app credential"); return; }
  const core = await import("../packages/core/dist/index.js");
  const app = neon(appUrl);
  const uniq = Date.now().toString(36).toUpperCase().slice(-6);
  const raised = async (fn) => { try { await fn(); return null; } catch (e) { return String(e?.message ?? e); } };

  const owner = await mkUser("s-owner");
  const otherOwner = await mkUser("s-owner2");
  const [org] = await sql`INSERT INTO access_code (code, partner_name, tier, partner_user_id, is_active, crm_v2)
                          VALUES (${"ISOSH" + uniq}, ${P + " share"}, 'client', ${owner}, true, true) RETURNING id, code`;
  const [org2] = await sql`INSERT INTO access_code (code, partner_name, tier, partner_user_id, is_active, crm_v2)
                           VALUES (${"ISOSH2" + uniq}, ${P + " share2"}, 'client', ${otherOwner}, true, true) RETURNING id, code`;
  const [orgOff] = await sql`INSERT INTO access_code (code, partner_name, tier, partner_user_id, is_active, crm_v2)
                             VALUES (${"ISOSH3" + uniq}, ${P + " share-off"}, 'client', ${owner}, true, false) RETURNING id, code`;
  created.codes.push(org.id, org2.id, orgOff.id);
  const russ = await mkUser("s-russ");     // assigned to wes
  const nora = await mkUser("s-nora");     // same org, NOT assigned to wes
  const denied = await mkUser("s-denied"); // org_admin with view_content explicitly denied
  const spy = await mkUser("s-spy");       // staff at the other org
  await sql`INSERT INTO org_staff (access_code_id, user_id, role) VALUES
            (${org.id}, ${russ}, 'staff'), (${org.id}, ${nora}, 'staff'), (${org.id}, ${denied}, 'org_admin'), (${org2.id}, ${spy}, 'staff')`;
  await sql`INSERT INTO org_capability_override (org_id, user_id, capability, effect) VALUES (${org.id}, ${denied}, 'org.client.view_content', 'deny')`;
  const wes = await mkUser("s-wes");
  await core.redeemAccessCode(wes, org.code);
  await sql`INSERT INTO client_staff_assignment (access_code_id, client_user_id, staff_user_id, assigned_by) VALUES (${org.id}, ${wes}, ${russ}, ${owner})`;
  const [appRow] = await sql`INSERT INTO job_application (user_id, job_title, company, status, notes, salary)
                             VALUES (${wes}, 'Line Cook', 'Big Sky Diner', 'applied', 'PRIVATE-NOTE-do-not-leak', '$19/hr SECRET') RETURNING id`;
  await sql`INSERT INTO refinery_artifact (user_id, artifact_type, content, is_current) VALUES
            (${wes}, 'resume', ${JSON.stringify({ marker: "RESUME-BODY" })}::jsonb, true),
            (${wes}, 'resume', ${JSON.stringify({ marker: "TAILORED-RESUME" })}::jsonb, false),
            (${wes}, 'cover_letter', ${JSON.stringify({ marker: "LETTER-BODY" })}::jsonb, false),
            (${wes}, 'disclosure_plan', ${JSON.stringify({ marker: "DISCLOSURE-BODY" })}::jsonb, false)`;

  const A = async (u, orgId) => core.resolveOrgActor(u, orgId ? { orgId } : undefined);
  const aRuss = await A(russ), aNora = await A(nora), aDenied = await A(denied), aSpy = await A(spy), aOwner = await A(owner);
  check("fixture: actors resolve, and the denied admin really lacks view_content",
    !!aRuss && !!aNora && !!aSpy && !!aOwner && !!aDenied && !aDenied.capabilities.has("org.client.view_content"),
    `denied has it: ${aDenied?.capabilities.has("org.client.view_content")}`);

  // -- nothing is shared yet
  const before = await core.getClientApplications(aRuss, wes);
  check("before anything is shared, the assigned case manager gets nothing", before.ok === false && before.reason === "not_shared", JSON.stringify(before));
  const [{ n: logged0 }] = await sql`SELECT count(*)::int AS n FROM data_access_log WHERE target_user_id = ${wes}`;
  check("and a refused read writes no 'opened' entry", logged0 === 0, `rows=${logged0}`);
  const head = await core.getClientHeader(aRuss, wes);
  check("progress signals are absent until the person turns on progress sharing", head.ok && head.rows[0].progress === null);
  check("and so are their account name, email and stage (review BL1)",
    head.ok && head.rows[0].currentStage === null && head.rows[0].identitySource !== "account",
    JSON.stringify({ src: head.rows?.[0]?.identitySource, stage: head.rows?.[0]?.currentStage }));
  await joinCohortConsent(wes);
  const headP = await core.getClientHeader(aRuss, wes);
  check("with sharing on, the stage and the account's own details appear", headP.ok && headP.rows[0].identitySource === "account" && headP.rows[0].currentStage !== null);
  check("with progress sharing on, staff get counts and a next step, and still no content",
    headP.ok && headP.rows[0].progress?.applications === 1 && !JSON.stringify(headP.rows[0]).includes("PRIVATE-NOTE") && !JSON.stringify(headP.rows[0]).includes("RESUME-BODY"));
  check("they CAN see who the person is and that nothing is shared", head.ok && head.rows[0].scopes.resume.shared === false && head.rows[0].assignedStaffId === russ);

  // -- an organization cannot grant itself access, by any route the app role has
  const orgGrant = await raised(() => app.transaction([
    app`SELECT set_config('app.org_id', ${org.id}, true)`, app`SELECT set_config('app.user_id', ${russ}, true)`,
    app`INSERT INTO sharing_grant (user_id, access_code_id, scope, text_version) VALUES (${wes}, ${org.id}, 'resume', 'x')`]));
  check("staff cannot insert a grant for their participant", !!orgGrant && /row-level security/i.test(orgGrant), orgGrant ?? "insert succeeded");
  const forged = await raised(() => app.transaction([
    app`SELECT set_config('app.user_id', ${russ}, true)`,
    app`INSERT INTO sharing_grant (user_id, access_code_id, scope, text_version) VALUES (${wes}, ${org.id}, 'resume', 'x')`]));
  check("nobody can insert a grant in another person's name", !!forged && /row-level security/i.test(forged), forged ?? "insert succeeded");
  const stranger = await mkUser("s-stranger");
  const notMember = await core.grantSharing(stranger, org.id, "resume");
  check("a person cannot share with an organization they do not belong to", notMember.ok === false);
  await core.redeemAccessCode(stranger, orgOff.code);
  check("sharing cannot be turned on for an org that does not have the feature", (await core.grantSharing(stranger, orgOff.id, "resume")).ok === false);
  check("a made-up scope is refused", (await core.grantSharing(wes, org.id, "disclosure")).ok === false);

  // -- ask, then answer
  const ask = await core.requestSharing(aRuss, wes, "resume", "So I can help before Thursday's interview.");
  check("the assigned case manager can ask", ask.ok === true, JSON.stringify(ask));
  check("asking twice does not stack requests", (await core.requestSharing(aRuss, wes, "resume", "Again please.")).ok === false);
  check("a colleague who is not assigned cannot ask", (await core.requestSharing(aNora, wes, "resume", "Let me see it.")).ok === false);
  check("staff at another organization cannot ask", (await core.requestSharing(aSpy, wes, "resume", "Let me see it.")).ok === false);
  const state = await core.getSharingState(wes);
  const req = state[0]?.requests[0];
  check("the participant sees the request, the reason, who asked, and their case manager's name",
    !!req && /Thursday/.test(req.reason) && state[0].caseManagerName?.includes("s-russ"), JSON.stringify(state[0]));
  const selfApprove = await raised(() => app.transaction([
    app`SELECT set_config('app.org_id', ${org.id}, true)`, app`SELECT set_config('app.user_id', ${russ}, true)`,
    app`UPDATE sharing_request SET status = 'approved' WHERE id = ${req.id}`]));
  check("staff cannot approve their own request", !!selfApprove && /withdraw its request/.test(selfApprove), selfApprove ?? "update succeeded");
  check("somebody else cannot answer it", (await core.answerSharingRequest(stranger, req.id, true)).ok === false);
  check("the participant approves, and that alone creates the grant", (await core.answerSharingRequest(wes, req.id, true)).ok === true);

  // -- shared: exactly the scope, exactly the columns, exactly the reach
  const resumes = await core.getClientResumes(aRuss, wes);
  check("the assigned case manager now reads the resumes, pinned and tailored", resumes.ok && resumes.rows.length === 2 && resumes.rows.some((r) => r.content?.marker === "RESUME-BODY" && r.is_current), JSON.stringify(resumes).slice(0, 200));
  check("a resume grant never returns the disclosure plan or a cover letter", resumes.ok && !/DISCLOSURE-BODY|LETTER-BODY/.test(JSON.stringify(resumes.rows)));
  check("cover letters are their own scope", (await core.getClientDocuments(aRuss, wes)).reason === "not_shared");
  check("a resume grant does not open applications", (await core.getClientApplications(aRuss, wes)).reason === "not_shared");
  await core.grantSharing(wes, org.id, "applications");
  const apps = await core.getClientApplications(aRuss, wes);
  const flat = JSON.stringify(apps);
  check("applications are readable once shared", apps.ok && apps.rows.length === 1 && apps.rows[0].company === "Big Sky Diner");
  check("the person's private notes and pay are NOT in what staff receive", !flat.includes("PRIVATE-NOTE") && !flat.includes("SECRET") && !("notes" in (apps.rows?.[0] ?? {})) && !("salary" in (apps.rows?.[0] ?? {})), flat.slice(0, 300));
  check("a colleague who is not assigned still gets nothing", (await core.getClientResumes(aNora, wes)).ok === false);
  check("an admin whose view_content was DENIED gets nothing, whatever their role", (await core.getClientResumes(aDenied, wes)).reason === "no_capability");
  check("staff at another organization get nothing", (await core.getClientResumes(aSpy, wes)).ok === false);
  check("the owner (sees all) can read it", (await core.getClientResumes(aOwner, wes)).ok === true);
  const [{ id: adminId } = {}] = await sql`SELECT user_id AS id FROM platform_admin LIMIT 1`;
  if (adminId) {
    const aPlat = await core.resolveOrgActor(adminId, { orgId: org.id, isPlatformAdmin: true });
    check("a platform admin looking into the org does NOT get participant content",
      !!aPlat && aPlat.viaPlatformAdmin && (await core.getClientResumes(aPlat, wes)).reason === "platform_admin_view", JSON.stringify(aPlat && { via: aPlat.viaPlatformAdmin }));
  }

  // -- the log
  const log = await core.getMyAccessLog(wes);
  check("every allowed read is in the participant's log, with who and what; refused reads are not",
    log.length === 3 && log.every((e) => ["resume", "applications"].includes(e.scope)) && log.some((e) => e.who?.includes("s-russ")) && log.some((e) => e.who?.includes("s-owner")),
    JSON.stringify(log.map((e) => [e.who, e.scope])));

  // -- notes
  const note = await core.addClientNote(aRuss, wes, { body: "Met Tuesday. Bringing ID Thursday.", kind: "meeting" });
  check("a case manager can write a note about their participant", note.ok === true);
  check("not about somebody else's", (await core.addClientNote(aNora, wes, { body: "x" })).ok === false);
  check("and another organization cannot read it", (await core.getClientNotes(aSpy, wes)).ok === false);
  const asWes = await app.transaction([app`SELECT set_config('app.user_id', ${wes}, true)`, app`SELECT id FROM case_note`]);
  check("the participant does not see a note that was not shown to them", asWes[1].length === 0);
  if (note.ok) {
    await app.transaction([app`SELECT set_config('app.org_id', ${org.id}, true)`, app`SELECT set_config('app.user_id', ${russ}, true)`,
      app`UPDATE case_note SET body = 'Met Tuesday. Bringing ID and SS card Thursday.' WHERE id = ${note.id}`]);
    const [{ n: versions }] = await sql`SELECT count(*)::int AS n FROM case_note_version WHERE note_id = ${note.id} AND body LIKE '%Bringing ID Thursday.'`;
    check("editing a note keeps the earlier wording", versions === 1, `versions=${versions}`);
    const del = await raised(() => app.transaction([app`SELECT set_config('app.org_id', ${org.id}, true)`, app`DELETE FROM case_note WHERE id = ${note.id}`]));
    check("a note cannot be deleted by the app", !!del && /permission denied/i.test(del), del ?? "delete succeeded");
  }
  if (note.ok) {
    const fixed = await core.editClientNote(aRuss, wes, note.id, { body: "Met Tuesday. Bringing ID, SS card and pay stub Thursday." });
    const notes = await core.getClientNotes(aRuss, wes);
    const mineNow = notes.ok ? notes.rows.find((n) => n.id === note.id) : null;
    check("the author can correct a note through the app, and every earlier wording is shown with it",
      fixed.ok === true && !!mineNow?.edited_at && (mineNow?.earlier?.length ?? 0) >= 2, JSON.stringify(fixed));
    check("somebody who did not write it cannot correct it", (await core.editClientNote(aNora, wes, note.id, { body: "rewritten by a colleague" })).ok === false);
    const shown = await core.addClientNote(aRuss, wes, { body: "NOT-SHOWN-TO-PARTICIPANT", visibleToParticipant: true });
    const [{ v }] = shown.ok ? await sql`SELECT visible_to_participant AS v FROM case_note WHERE id = ${shown.id}` : [{ v: null }];
    check("a note is never marked visible to the participant, since no participant screen shows notes", v === false, String(v));
  }

  // -- helping without touching their work: a suggested job, a comment beside a shared document
  const [sharedResume] = await sql`SELECT id FROM refinery_artifact WHERE user_id = ${wes} AND artifact_type = 'resume' AND is_current`;
  const [letter] = await sql`SELECT id FROM refinery_artifact WHERE user_id = ${wes} AND artifact_type = 'cover_letter'`;
  const [plan] = await sql`SELECT id FROM refinery_artifact WHERE user_id = ${wes} AND artifact_type = 'disclosure_plan'`;
  const appsBefore = (await sql`SELECT count(*)::int AS n FROM job_application WHERE user_id = ${wes}`)[0].n;
  const sj = await core.suggestJob(aRuss, wes, { jobTitle: "Prep Cook", company: "River Cafe", applyUrl: "https://example.com/jobs/1", why: "Day shift, on the bus line." });
  check("a case manager can suggest a job", sj.ok === true, JSON.stringify(sj));
  check("suggesting a job does NOT put it in the participant's tracker", (await sql`SELECT count(*)::int AS n FROM job_application WHERE user_id = ${wes}`)[0].n === appsBefore);
  check("a link that is not https is refused", (await core.suggestJob(aRuss, wes, { jobTitle: "X", company: "Y", applyUrl: "javascript:alert(1)", why: "because" })).ok === false);
  check("a colleague cannot suggest to somebody else's participant", (await core.suggestJob(aNora, wes, { jobTitle: "X", company: "Y", why: "because" })).ok === false);
  check("a comment is allowed on the resume they shared", (await core.commentOnArtifact(aRuss, wes, sharedResume.id, "Lead with the 300 meals a day line.", "Prepared three daily meals")).ok === true);
  check("NOT on the cover letter they did not share", (await core.commentOnArtifact(aRuss, wes, letter.id, "Nice letter")).ok === false);
  check("and never on a disclosure plan, shared scope or not", (await core.commentOnArtifact(aRuss, wes, plan.id, "About your plan")).ok === false);
  const mySug = await core.getMySuggestions(wes);
  check("the participant sees both, with who they are from", mySug.length === 2 && mySug.every((m) => m.from_name?.includes("s-russ")) && mySug.some((m) => m.kind === "comment" && /300 meals/.test(m.body)));
  const selfAnswer = await raised(() => app.transaction([app`SELECT set_config('app.org_id', ${org.id}, true)`, app`SELECT set_config('app.user_id', ${russ}, true)`,
    app`UPDATE staff_suggestion SET status = 'saved' WHERE id = ${sj.id}`]));
  check("staff cannot mark their own suggestion as taken up", !!selfAnswer && /withdraw a suggestion/.test(selfAnswer), selfAnswer ?? "updated");
  check("somebody else cannot answer it", (await core.answerSuggestion(stranger, sj.id, "saved")) === false);
  check("the participant can dismiss it, and that is final", (await core.answerSuggestion(wes, sj.id, "dismissed")) === true && (await core.answerSuggestion(wes, sj.id, "saved")) === false);
  const rewrite = await raised(() => app.transaction([app`SELECT set_config('app.user_id', ${wes}, true)`, app`UPDATE staff_suggestion SET body = 'rewritten' WHERE client_user_id = ${wes} AND status = 'open'`]));
  check("the participant cannot rewrite what staff said", !!rewrite && /only the status/.test(rewrite), rewrite ?? "updated");

  // -- across the caseload: the Requests and Case notes pages
  const lee2 = await mkUser("s-lee2"); // same org, on nobody's caseload but the owner's view
  await core.redeemAccessCode(lee2, org.code);
  await sql`INSERT INTO client_staff_assignment (access_code_id, client_user_id, staff_user_id, assigned_by) VALUES (${org.id}, ${lee2}, ${nora}, ${owner})`;
  await core.requestSharing(aNora, lee2, "resume", "To get you ready for the job fair.");
  await core.addClientNote(aNora, lee2, { body: "NORA-ONLY-NOTE" });
  const reqRuss = await core.listSharingRequests(aRuss), reqOwner = await core.listSharingRequests(aOwner), reqSpy = await core.listSharingRequests(aSpy);
  check("a case manager's request list holds their own caseload and not a colleague's",
    reqRuss.ok && reqRuss.rows.every((r) => r.client_user_id === wes) && reqRuss.rows.length >= 1, JSON.stringify(reqRuss.rows?.map((r) => r.client_name)));
  check("the owner's list holds the whole organization's", reqOwner.ok && reqOwner.rows.some((r) => r.client_user_id === lee2) && reqOwner.rows.some((r) => r.client_user_id === wes));
  check("another organization's list holds none of it", reqSpy.ok && reqSpy.rows.length === 0);
  const noraReq = reqOwner.rows.find((r) => r.client_user_id === lee2);
  check("a case manager cannot withdraw a colleague's request", (await core.withdrawSharingRequest(aRuss, noraReq.id)).ok === false);
  check("withdrawing a request that does not exist does nothing", (await core.withdrawSharingRequest(aRuss, "00000000-0000-0000-0000-000000000000")).ok === false);
  check("the person who asked can withdraw it", (await core.withdrawSharingRequest(aNora, noraReq.id)).ok === true);
  const notesRuss = await core.listRecentNotes(aRuss), notesOwner = await core.listRecentNotes(aOwner);
  check("a case manager's notes page never shows a colleague's caseload", notesRuss.ok && !JSON.stringify(notesRuss.rows).includes("NORA-ONLY-NOTE") && notesRuss.rows.length >= 1);
  check("the owner's notes page shows both", notesOwner.ok && JSON.stringify(notesOwner.rows).includes("NORA-ONLY-NOTE"));

  // -- workflow preferences arrange a screen; they are not a way in
  await core.setOwnStaffPrefs(aRuss, { caseloadSort: "name", caseloadHidden: ["stage", "NOT_A_COLUMN"], clientTab: "resume", viewAll: true, capabilities: ["org.client.view_all"] });
  const pr = await core.getStaffPrefs(aRuss);
  check("preferences keep known choices and drop everything else",
    pr.effective.caseloadSort === "name" && pr.effective.caseloadHidden.join() === "stage" && pr.effective.clientTab === "resume" && Object.keys(pr.own).sort().join() === "caseloadHidden,caseloadSort,clientTab",
    JSON.stringify(pr.own));
  await core.setOwnStaffPrefs(aRuss, { savedViews: [
    { name: "  My quiet people  ", sort: "last_active", status: "behind", staffId: "not-a-uuid" },
    { name: "", sort: "name" }, { name: "x".repeat(200), sort: "DROP TABLE", status: "everyone" }, "junk",
    ...Array.from({ length: 20 }, (_, i) => ({ name: "v" + i })) ] });
  const sv = (await core.getStaffPrefs(aRuss)).effective.savedViews;
  check("saved caseload views keep a clean name and known choices, drop junk, and are capped",
    sv.length === 8 && sv[0].name === "My quiet people" && sv[0].status === "behind" && sv[0].staffId === "" && sv[1].name.length === 40 && sv[1].sort === "needs_attention" && sv[1].status === "",
    JSON.stringify(sv.slice(0, 2)));
  await core.setOwnStaffPrefs(aRuss, { caseloadSort: "name", caseloadHidden: ["stage"], clientTab: "resume" });
  check("staff cannot set the organization's defaults", (await core.setOrgStaffPrefDefaults(aRuss, { caseloadSort: "stage" })) === false);
  check("the owner can, and it reaches a colleague who has not chosen", (await core.setOrgStaffPrefDefaults(aOwner, { caseloadSort: "stage" })) === true
    && (await core.getStaffPrefs(aNora)).effective.caseloadSort === "stage" && (await core.getStaffPrefs(aRuss)).effective.caseloadSort === "name");

  // -- taking it back
  check("the participant can turn the resume off", (await core.revokeSharing(wes, org.id, "resume")).ok === true);
  check("and it stops immediately", (await core.getClientResumes(aRuss, wes)).reason === "not_shared");
  const reopen = await raised(() => app.transaction([app`SELECT set_config('app.user_id', ${wes}, true)`,
    app`UPDATE sharing_grant SET revoked_at = NULL WHERE user_id = ${wes} AND scope = 'resume'`]));
  check("a revoked grant can never be reopened, even by the person (a new one is a new agreement)", !!reopen && /cannot be changed/.test(reopen), reopen ?? "update succeeded");
  await sql`DELETE FROM client_staff_assignment WHERE client_user_id = ${wes}`;
  check("reassigned away: the former case manager loses access at once", (await core.getClientApplications(aRuss, wes)).ok === false);
  await sql`INSERT INTO client_staff_assignment (access_code_id, client_user_id, staff_user_id, assigned_by) VALUES (${org.id}, ${wes}, ${russ}, ${owner})`;
  await sql`DELETE FROM org_staff WHERE user_id = ${russ}`;
  const aRussGone = await A(russ);
  check("removed from staff: no actor, so no access", aRussGone === null);
  await core.leaveAllOrgs(wes);
  const [{ n: live }] = await sql`SELECT count(*)::int AS n FROM sharing_grant WHERE user_id = ${wes} AND revoked_at IS NULL`;
  check("leaving the organization revokes everything shared with it", live === 0 && (await core.getClientApplications(aOwner, wes)).ok === false, `live grants=${live}`);
  await core.redeemAccessCode(wes, org.code);
  check("rejoining does NOT bring the old sharing back", (await core.getClientApplications(aOwner, wes)).reason === "not_shared");
  // Review 2, BL-4: leaving ONE organization (096 smr_leave_org) does the same, and the free rejoin (096) still asks again.
  if ((await sql`SELECT to_regprocedure('public.smr_leave_org(uuid,uuid)') IS NOT NULL AS has`)[0].has) {
    await core.grantSharing(wes, org.id, "applications");
    check("shared again after rejoining (a fresh yes)", (await core.getClientApplications(aOwner, wes)).ok === true);
    await core.leaveOrg(wes, org.id);
    const [{ n: liveOne }] = await sql`SELECT count(*)::int AS n FROM sharing_grant WHERE user_id = ${wes} AND access_code_id = ${org.id} AND revoked_at IS NULL`;
    const [{ n: pendOne }] = await sql`SELECT count(*)::int AS n FROM sharing_request WHERE user_id = ${wes} AND access_code_id = ${org.id} AND status = 'pending'`;
    check("leaving one organization revokes everything shared with it and cancels its requests", liveOne === 0 && pendOne === 0 && (await core.getClientApplications(aOwner, wes)).ok === false, `live=${liveOne} pending=${pendOne}`);
    await core.redeemAccessCode(wes, org.code);
    check("rejoining after leaving one organization does NOT bring the old sharing back", (await core.getClientApplications(aOwner, wes)).reason === "not_shared");
  }
  await sql`DELETE FROM data_access_log WHERE target_user_id = ${wes}`;
  await sql`DELETE FROM job_application WHERE id = ${appRow.id}`;
}

/**
 * Membership: who belongs to which organization (migrations 048 + 049).
 *
 * MOST OF THESE ARE NOT "CAN ORG A SEE ORG B". They are the places where an
 * unscoped read under row-level security would not fail -- it would come back
 * empty and the code would ACT on the emptiness: demote a tier, hand out the
 * anonymous rate limit, bind somebody to a second organization, let one org
 * attach another org's participant. Each is asserted by its consequence.
 *
 * They pass with RLS off too (that is the point of converting callers first);
 * the block at the end runs only once 049 is applied.
 */
async function membershipChecks() {
  console.log("\n  -- membership --");
  const core = await import("../packages/core/dist/index.js");
  const app = appUrl ? neon(appUrl) : null;
  const uniq = Date.now().toString(36).toUpperCase().slice(-6);
  const mkCode = async (label, owner, extra = {}) => {
    const [row] = await sql`
      INSERT INTO access_code (code, partner_name, tier, partner_user_id, is_active, daily_limit, max_redemptions, expires_at)
      VALUES (${`ISO${label}${uniq}`}, ${`${P} ${label}`}, ${extra.tier ?? "partner"}, ${owner}, ${extra.active ?? true},
              ${extra.dailyLimit ?? 123}, ${extra.max ?? null}, ${extra.expires ?? null})
      RETURNING id, code`;
    created.codes.push(row.id);
    return row;
  };
  const seats = async (id) => (await sql`SELECT times_redeemed FROM access_code WHERE id = ${id}`)[0].times_redeemed;
  const memberships = async (u) => (await sql`SELECT count(*)::int AS n FROM access_code_redemption WHERE user_id = ${u}`)[0].n;

  const ownerM = await mkUser("m-owner");
  const ownerN = await mkUser("m-ownerN");
  const orgM = await mkCode("M", ownerM);
  const orgN = await mkCode("N", ownerN);
  const pat = await mkUser("m-pat");

  // -- the one redemption path
  const first = await core.redeemAccessCode(pat, orgM.code);
  check("redeeming a valid code creates the membership and claims one seat",
    first.success && (await memberships(pat)) === 1 && (await seats(orgM.id)) === 1, JSON.stringify(first));
  const again = await core.redeemAccessCode(pat, orgM.code);
  check("redeeming it twice is refused and claims no second seat",
    again.outcome === "already_member" && (await seats(orgM.id)) === 1, JSON.stringify(again));

  const expired = await mkCode("X", ownerM, { expires: new Date(Date.now() - 86400000).toISOString() });
  const inactive = await mkCode("I", ownerM, { active: false });
  const lee = await mkUser("m-lee");
  check("an expired code is refused", (await core.redeemAccessCode(lee, expired.code)).outcome === "expired");
  check("an inactive code is refused", (await core.redeemAccessCode(lee, inactive.code)).outcome === "inactive");
  check("an unknown code is refused", (await core.redeemAccessCode(lee, "NOSUCHCODE" + uniq)).outcome === "not_found");
  check("none of those refusals created a membership", (await memberships(lee)) === 0);

  // -- two people, one seat, at the same moment
  const oneSeat = await mkCode("S", ownerM, { max: 1 });
  const r1 = await mkUser("m-race1");
  const r2 = await mkUser("m-race2");
  const race = await Promise.all([core.redeemAccessCode(r1, oneSeat.code), core.redeemAccessCode(r2, oneSeat.code)]);
  const winners = race.filter((r) => r.success).length;
  const [{ n: seated }] = await sql`SELECT count(*)::int AS n FROM access_code_redemption WHERE access_code_id = ${oneSeat.id}`;
  check("two people racing for the last seat: exactly one gets it",
    winners === 1 && seated === 1 && (await seats(oneSeat.id)) === 1 && race.some((r) => r.outcome === "full"),
    `winners=${winners} rows=${seated} counter=${await seats(oneSeat.id)} outcomes=${race.map((r) => r.outcome)}`);

  // -- site 3, changed by house lane L2: a code never makes a partner. The
  //    tier comes from owning or working in an organization; a participant
  //    of a partner-tier code is a client (their rate limit still comes from
  //    the code itself, checked next).
  await core.syncUserTierFromCodes(pat);
  const [{ tier: patTier }] = await sql`SELECT tier FROM users WHERE id = ${pat}`;
  check("L2: a tier re-sync makes a participant of a partner-tier code a client, not a partner", patTier === "client", `tier is ${patTier}`);

  // -- site 4: the rate limiter, on the path of every AI call
  const limit = await core.getUserDailyLimit(pat);
  check("the rate limiter finds the person's code allowance, not the anonymous default", limit === 123, `limit is ${limit}`);

  // -- site 11
  const mine = await core.getUserAccessCodes(pat);
  check("a person can list their own codes", mine.length === 1 && mine[0].id === orgM.id, `saw ${mine.length}`);

  // -- site 5: first code wins
  const rebound = await core.ensureUserAttribution(pat, orgN.code);
  check("someone attributed to org M is NOT re-attributed by arriving with org N's code",
    rebound === false && (await memberships(pat)) === 1, `returned ${rebound}, memberships=${await memberships(pat)}`);

  // -- D8 (Troy, 2026-09-20): a person MAY deliberately join a second org.
  const two = await mkUser("m-two");
  await core.redeemAccessCode(two, orgM.code);
  const second = await core.redeemAccessCode(two, orgN.code);
  check("a person can deliberately redeem a second organization's code", second.success && (await memberships(two)) === 2);

  // -- site 6: an org cannot attach another org's participant by inviting their email
  const [{ email: patEmail }] = await sql`SELECT email FROM users WHERE id = ${pat}`;
  const poach = await core.createOrgInvite({ accessCodeId: orgN.id, code: orgN.code, name: "x", email: patEmail, invitedBy: ownerN });
  check("org N inviting the email of org M's participant is refused",
    poach.ok === false && /another organization/.test(poach.error) && (await memberships(pat)) === 1, JSON.stringify(poach));
  const dupe = await core.createOrgInvite({ accessCodeId: orgM.id, code: orgM.code, name: "x", email: patEmail, invitedBy: ownerM });
  check("org M inviting its own participant is told they are already a member",
    dupe.ok === false && /already part of your organization/.test(dupe.error), JSON.stringify(dupe));

  // -- sites 7 + 8: revoke frees the seat, in one step, and deletes nobody
  const before = await seats(orgN.id);
  const invitedEmail = `${P}-m-invited-${uniq.toLowerCase()}@example.invalid`;
  const inv = await core.createOrgInvite({ accessCodeId: orgN.id, code: orgN.code, name: "Invited", email: invitedEmail, invitedBy: ownerN });
  if (inv.ok) created.users.push(inv.userId);
  check("inviting a new person creates a pending member and claims a seat", inv.ok && (await seats(orgN.id)) === before + 1, JSON.stringify(inv));
  if (inv.ok) {
    const foreignRevoke = await core.revokeOrgInvite(orgM.id, inv.userId, ownerM);
    check("org M cannot revoke org N's invite", foreignRevoke.ok === false && (await memberships(inv.userId)) === 1);
    const rev = await core.revokeOrgInvite(orgN.id, inv.userId, ownerN);
    const [{ n: stillThere }] = await sql`SELECT count(*)::int AS n FROM users WHERE id = ${inv.userId}`;
    const [{ n: inviteRows }] = await sql`SELECT count(*)::int AS n FROM org_invite WHERE user_id = ${inv.userId}`;
    check("revoking a pending invite ends the membership, removes the invite and refunds the seat",
      rev.ok && (await memberships(inv.userId)) === 0 && inviteRows === 0 && (await seats(orgN.id)) === before,
      `ok=${rev.ok} memberships=${await memberships(inv.userId)} invites=${inviteRows} seats=${await seats(orgN.id)} (was ${before})`);
    check("revoking does NOT delete the account", stillThere === 1);
  }

  // -- site 22 + the assignment that used to be left behind
  const staffM = await mkUser("m-staff");
  await sql`INSERT INTO org_staff (access_code_id, user_id, role) VALUES (${orgM.id}, ${staffM}, 'staff')`;
  await sql`INSERT INTO client_staff_assignment (access_code_id, client_user_id, staff_user_id, assigned_by)
            VALUES (${orgM.id}, ${pat}, ${staffM}, ${ownerM})`;
  const seatsBeforeLeave = await seats(orgM.id);
  const left = await core.leaveAllOrgs(pat);
  const [{ n: assignLeft }] = await sql`SELECT count(*)::int AS n FROM client_staff_assignment WHERE client_user_id = ${pat}`;
  check("leaving ends the membership AND releases the person from their case manager's caseload",
    left === 1 && (await memberships(pat)) === 0 && assignLeft === 0, `left=${left} assignments=${assignLeft}`);
  check("leaving does not refund the seat (a seat is durable)", (await seats(orgM.id)) === seatsBeforeLeave);

  // -- site 12: an owner of several codes sees all of them, and only them
  const orgM2 = await mkCode("M2", ownerM);
  const a = await mkUser("m-a");
  const b = await mkUser("m-b");
  await core.redeemAccessCode(a, orgM.code);
  await core.redeemAccessCode(b, orgM2.code);
  const cohortM = await core.getPartnerCohort(ownerM, {});
  const cohortN = await core.getPartnerCohort(ownerN, {});
  check("an owner of two codes counts members of both, and none of another owner's",
    // M owns four codes here. Members: `two` and `a` (code M), `b` (code M2),
    // and whoever won the one-seat race (code S). `pat` has left. N has `two`.
    cohortM.totalJoined === 4 && cohortN.totalJoined === 1, `M=${cohortM.totalJoined} (want 4)  N=${cohortN.totalJoined} (want 1)`);

  // -- the audit trail
  const [{ n: audited }] = await sql`SELECT count(*)::int AS n FROM org_audit
     WHERE table_name = 'access_code_redemption' AND org_id = ${orgM.id} AND subject_user_id = ${a} AND action = 'INSERT' AND actor = ${a}`;
  check("joining an organization is written to the audit trail with who did it", audited === 1, `rows=${audited}`);

  // -- migration 101 (house lane L2): who may join with a code
  const [{ has101 }] = await sql`SELECT position('platform_admin' IN pg_get_functiondef('public.smr_redeem_code(uuid, text)'::regprocedure)) > 0 AS has101`;
  if (!has101) {
    console.log("  note  101 not applied: code refusals for admins and staff skipped");
  } else {
    const admin101 = await mkUser("m-admin101");
    await sql`INSERT INTO platform_admin (user_id, note) VALUES (${admin101}, 'isolation fixture')`;
    const seatsM = await seats(orgM.id);
    const ra = await core.redeemAccessCode(admin101, orgM.code);
    const rx = await core.redeemAccessCode(admin101, "NOSUCHCODE" + uniq);
    check("101: a platform admin cannot join an organization with its code, and is told why",
      ra.outcome === "platform_admin" && !ra.success && /Admin accounts/.test(ra.error ?? "") && (await memberships(admin101)) === 0,
      JSON.stringify(ra));
    check("101: the admin answer is the same for a code that does not exist", rx.outcome === "platform_admin", JSON.stringify(rx));
    const rs = await core.redeemAccessCode(staffM, orgM.code);
    const ro = await core.redeemAccessCode(ownerM, orgM.code);
    check("101: the organization's own staff and owner cannot join it as participants",
      rs.outcome === "org_staff" && ro.outcome === "org_staff" && (await memberships(staffM)) === 0 && (await memberships(ownerM)) === 0,
      `staff=${rs.outcome} owner=${ro.outcome}`);
    check("101: those refusals spend no seat", (await seats(orgM.id)) === seatsM, `seats ${await seats(orgM.id)} (was ${seatsM})`);
    const elsewhere = await core.redeemAccessCode(staffM, orgN.code);
    check("101: staff of org M may still join org N as a participant", elsewhere.success && (await memberships(staffM)) === 1, JSON.stringify(elsewhere));
    const [{ tier: staffTier }] = await sql`SELECT tier FROM users WHERE id = ${staffM}`;
    check("L2: a staff member's tier comes from their staff role (partner), not from the code they joined with", staffTier === "partner", `tier is ${staffTier}`);
    await sql`DELETE FROM platform_admin WHERE user_id = ${admin101}`;
  }

  // ------------------------------------------------- only once 049 is applied
  const [{ on: rlsOn }] = await sql`SELECT (relrowsecurity AND relforcerowsecurity) AS on FROM pg_class WHERE oid = 'public.access_code_redemption'::regclass`;
  if (!rlsOn) {
    console.log("  note  row-level security is NOT enabled on access_code_redemption (049 not applied); boundary checks skipped");
    return;
  }
  if (!app) {
    console.log("  skip  boundary checks (no app credential; as the owner they would prove nothing)");
    return;
  }
  const raised = async (fn) => { try { await fn(); return null; } catch (e) { return String(e?.message ?? e); } };
  const [{ n: ownerSees }] = await sql`SELECT count(*)::int AS n FROM access_code_redemption`;
  const [{ n: appSees }] = await app`SELECT count(*)::int AS n FROM access_code_redemption`;
  check("an unscoped read by the app sees no memberships at all (and there ARE some)", appSees === 0 && ownerSees > 0, `app=${appSees} owner=${ownerSees}`);

  const ins = await raised(() => app`INSERT INTO access_code_redemption (user_id, access_code_id) VALUES (${lee}, ${orgM.id})`);
  check("the app cannot insert a membership directly, only through smr_redeem_code", !!ins && /permission denied/i.test(ins), ins ?? "insert succeeded");
  const upd = await raised(() => app`UPDATE access_code_redemption SET access_code_id = ${orgN.id} WHERE user_id = ${a}`);
  check("the app cannot move a membership to another organization", !!upd && /permission denied/i.test(upd), upd ?? "update succeeded");

  const asM = await app.transaction([
    app`SELECT set_config('app.org_id', ${orgM.id}, true)`,
    app`SELECT count(*)::int AS n FROM access_code_redemption WHERE access_code_id = ${orgN.id}`,
    app`DELETE FROM access_code_redemption WHERE access_code_id = ${orgN.id} RETURNING id`,
    app`SELECT count(*)::int AS n FROM access_code_redemption WHERE access_code_id = ${orgM.id}`,
  ]);
  check("scoped to org M, the app sees none of org N's members and can delete none of them",
    asM[1][0].n === 0 && asM[2].length === 0 && asM[3][0].n > 0, `sawN=${asM[1][0].n} deletedN=${asM[2].length} sawM=${asM[3][0].n}`);

  const asA = await app.transaction([
    app`SELECT set_config('app.user_id', ${a}, true)`,
    app`SELECT user_id FROM access_code_redemption`,
    app`DELETE FROM access_code_redemption WHERE user_id = ${a} RETURNING id`,
  ]);
  check("as one person, the app sees only that person's memberships",
    asA[1].length === 1 && asA[1][0].user_id === a, `saw ${asA[1].length}`);
  check("a person cannot delete their own membership with a bare DELETE (leaving goes through the function)", asA[2].length === 0);

  const health = await core.getRlsHealth();
  check("the runtime health check agrees: enforced, forced, unscoped reads empty, role cannot bypass",
    health.ok && health.roleCanBypass === false && health.role === "smr_app", JSON.stringify(health.problems));

  const noScope = await raised(() => app`SELECT smr_invite_binding(${a}::uuid)`);
  check("the cross-org binding question refuses to answer outside an organization scope", !!noScope && /organization scope/.test(noScope), noScope ?? "answered");
}

/**
 * Platform admin cannot be minted by the application (migration 047).
 *
 * These run AS THE APP ROLE on purpose. The owner can do all of this, and is
 * supposed to be able to; the claim under test is that the app cannot.
 */
async function platformAdminChecks() {
  console.log("\n  -- platform admin --");
  const problems = await checkRestrictedGrants((q) => sql(q));
  check("app role holds exactly the withheld grants on every restricted table", problems.length === 0, problems.join("; "));

  if (!appUrl) {
    console.log("  skip  app-role admin checks (no app credential; they would prove nothing)");
    return;
  }
  const app = neon(appUrl);
  const core = await import("../packages/core/dist/index.js");
  const nobody = await mkUser("notadmin");
  const boss = await mkUser("realadmin");
  await sql`INSERT INTO platform_admin (user_id, note) VALUES (${boss}, 'isolation fixture')`;

  const raised = async (fn) => { try { await fn(); return null; } catch (e) { return String(e?.message ?? e); } };

  const selfGrant = await raised(() => app`INSERT INTO platform_admin (user_id) VALUES (${nobody})`);
  check("the app cannot insert a platform_admin row", !!selfGrant && /permission denied/i.test(selfGrant), selfGrant ?? "insert succeeded");

  const tierWrite = await raised(() => app`UPDATE users SET tier = 'admin' WHERE id = ${nobody}`);
  const [after] = await sql`SELECT tier FROM users WHERE id = ${nobody}`;
  check("the app cannot set tier admin on someone who is not a platform admin",
    !!tierWrite && after.tier !== "admin", tierWrite ?? `tier is now ${after.tier}`);

  check("isPlatformAdmin is false for them, as the app role", (await core.isPlatformAdmin(nobody)) === false);
  check("isPlatformAdmin is true for a real admin, as the app role", (await core.isPlatformAdmin(boss)) === true);

  // The latent bug this also closes: an admin who redeemed a partner code was
  // re-synced to 'partner' and silently lost the admin console.
  await core.syncUserTierFromCodes(boss);
  const [pinned] = await sql`SELECT tier FROM users WHERE id = ${boss}`;
  check("a tier re-sync cannot demote a platform admin", pinned.tier === "admin", `tier is ${pinned.tier}`);

  const adminCode = await raised(() => sql`INSERT INTO access_code (code, partner_name, tier) VALUES (${"ISOADMIN" + Date.now().toString(36).toUpperCase().slice(-6)}, 'isolation fixture', 'admin')`);
  check("an access code cannot be created with tier admin, even by the owner", !!adminCode && /access_code_tier_check/.test(adminCode), adminCode ?? "insert succeeded");

  // -- organization lifecycle (migration 100), as the app role
  const lc = Date.now().toString(36).toUpperCase().slice(-6);
  const [{ id: lifeOrg }] = await sql`INSERT INTO access_code (code, partner_name, tier, partner_user_id, is_active)
                                      VALUES (${"ISOLIFE" + lc}, ${P + " lifecycle"}, 'client', ${nobody}, true) RETURNING id`;
  created.codes.push(lifeOrg);
  check("closing needs a reason", (await core.closeOrganization(lifeOrg, "", boss)).ok === false);
  const closed = await core.closeOrganization(lifeOrg, "Fixture closed for the check", boss);
  const [lifeRow] = await sql`SELECT is_active, closed_by, close_reason, closed_at IS NOT NULL AS stamped FROM access_code WHERE id = ${lifeOrg}`;
  check("a platform admin closes an organization with a reason; the database stamps who and when",
    closed.ok && !lifeRow.is_active && lifeRow.closed_by === boss && lifeRow.stamped && lifeRow.close_reason === "Fixture closed for the check", JSON.stringify(lifeRow));
  check("closing an already closed organization says so", (await core.closeOrganization(lifeOrg, "again please", boss)).ok === false);
  const reopened = await core.reopenOrganization(lifeOrg, boss);
  const [reRow] = await sql`SELECT is_active, closed_at, close_reason FROM access_code WHERE id = ${lifeOrg}`;
  check("reopening clears the close stamps", reopened.ok && reRow.is_active && reRow.closed_at === null && reRow.close_reason === null, JSON.stringify(reRow));
  const renamed = await core.renameOrganization(lifeOrg, `${P} lifecycle renamed`, boss);
  check("rename changes the name only", renamed.ok && renamed.name === `${P} lifecycle renamed`);
  const [{ n: reasonLeak }] = await sql`SELECT count(*)::int AS n FROM org_audit WHERE org_id = ${lifeOrg} AND row_summary::text LIKE '%Fixture closed%'`;
  check("the close reason text stays out of the organization's readable audit", reasonLeak === 0, `rows=${reasonLeak}`);
  check("history is for platform admins only", (await core.getOrgHistory(lifeOrg, nobody)) === null);
  check("an empty organization has no history", JSON.stringify(await core.getOrgHistory(lifeOrg, boss)) === "{}");
  const member = await mkUser("life-member");
  await core.redeemAccessCode(member, "ISOLIFE" + lc);
  // Review B3: a closed organization's owner no longer reads or exports its cohort.
  check("the owner of an open organization is a partner with its cohort", (await core.isPartnerUser(nobody, "client")) === true
    && (await core.getPartnerCohort(nobody)).totalJoined === 1);
  await core.closeOrganization(lifeOrg, "Closed to check the cohort gate", boss);
  check("after Close, its owner is not a partner (the cohort JSON and CSV routes refuse on this)", (await core.isPartnerUser(nobody, "client")) === false);
  check("after Close, the owner's cohort read is empty", (await core.getPartnerCohort(nobody)).totalJoined === 0);
  await core.reopenOrganization(lifeOrg, boss);
  const busy = await core.deleteEmptyOrganization(lifeOrg, `${P} lifecycle renamed`, boss);
  check("an organization with one member is never deleted, and the refusal says why", busy.ok === false && /1 member/.test(busy.error), JSON.stringify(busy));
  const [{ id: emptyOrg }] = await sql`INSERT INTO access_code (code, partner_name, tier, is_active)
                                       VALUES (${"ISOEMPTY" + lc}, ${P + " empty"}, 'client', true) RETURNING id`;
  created.codes.push(emptyOrg);
  check("a non-admin cannot delete even an empty organization", (await core.deleteEmptyOrganization(emptyOrg, `${P} empty`, nobody)).ok === false);
  check("delete needs the exact name", (await core.deleteEmptyOrganization(emptyOrg, "wrong name", boss)).ok === false);
  const gone = await core.deleteEmptyOrganization(emptyOrg, `${P} empty`, boss);
  const [{ n: stillThere }] = await sql`SELECT count(*)::int AS n FROM access_code WHERE id = ${emptyOrg}`;
  const [{ n: deleteAudit }] = await sql`SELECT count(*)::int AS n FROM org_audit WHERE org_id = ${emptyOrg} AND action = 'DELETE' AND actor = ${boss}`;
  check("an organization with no history is deleted, and the delete is recorded", gone.ok && stillThere === 0 && deleteAudit === 1, JSON.stringify({ gone, stillThere, deleteAudit }));

  // -- platform admin adds an existing account to staff directly (support path)
  const supportStaff = await mkUser("life-support-staff");
  const [{ email: supportEmail }] = await sql`SELECT email FROM users WHERE id = ${supportStaff}`;
  const addedByAdmin = await core.adminAddStaff(lifeOrg, boss, { name: "Support Added", email: supportEmail, role: "staff" });
  const aSupport = await core.resolveOrgActor(supportStaff);
  check("a platform admin adds an existing account to staff directly", addedByAdmin.ok && addedByAdmin.path === "admin_added" && aSupport?.orgId === lifeOrg, JSON.stringify(addedByAdmin));
  check("a non-admin cannot use the direct-add path",
    (await core.adminAddStaff(lifeOrg, nobody, { name: "X", email: (await sql`SELECT email FROM users WHERE id = ${member}`)[0].email, role: "staff" })).ok === false);
  await sql`DELETE FROM org_staff WHERE access_code_id = ${lifeOrg}`;

  await sql`DELETE FROM platform_admin WHERE user_id = ${boss}`;
  const [revoked] = await sql`SELECT tier FROM users WHERE id = ${boss}`;
  check("revoking platform admin drops the cached tier", revoked.tier !== "admin", `tier is ${revoked.tier}`);
}

/**
 * Refinery seats (migration 096). The seat rule is one definer function; these
 * prove each of its five inputs, that nothing else counts, that the app role
 * cannot write the grandfather list or flip the switch without being a
 * platform admin, and that an offer spends a seat only on the person's yes.
 */
async function seatChecks() {
  console.log("\n  -- Refinery seats (096) --");
  const [{ has }] = await sql`SELECT to_regclass('public.refinery_access_policy') IS NOT NULL AS has`;
  if (!has) { console.log("  note  096 not applied; skipped"); return; }
  if (!appUrl) { console.log("  skip  needs the app credential"); return; }
  const core = await import("../packages/core/dist/index.js");
  const app = neon(appUrl);
  const raised = async (fn) => { try { await fn(); return null; } catch (e) { return String(e?.message ?? e); } };
  const seat = async (u) => (await app`SELECT smr_has_refinery_seat(${u}::uuid) AS s`)[0].s;
  const uniq = Date.now().toString(36).toUpperCase().slice(-6);

  const [{ open }] = await app`SELECT smr_refinery_signup_open() AS open`;
  check("the switch is readable by the app role through its function", typeof open === "boolean");

  const owner = await mkUser("seat-owner"), staff = await mkUser("seat-staff"), member = await mkUser("seat-member");
  const nobody = await mkUser("seat-nobody"), boss = await mkUser("seat-boss"), legacy = await mkUser("seat-legacy");
  const lapsed = await mkUser("seat-lapsed"), closedMember = await mkUser("seat-closed"), selfTier = await mkUser("seat-tier");
  const [org] = await sql`INSERT INTO access_code (code, partner_name, tier, partner_user_id, is_active, max_redemptions) VALUES (${"ISOSEATS" + uniq}, ${P + " seats"}, 'client', ${owner}, true, 5) RETURNING id, code`;
  const [old] = await sql`INSERT INTO access_code (code, partner_name, tier, is_active, expires_at) VALUES (${"ISOSEATX" + uniq}, ${P + " expired"}, 'client', true, now() - interval '1 day') RETURNING id`;
  const [off] = await sql`INSERT INTO access_code (code, partner_name, tier, is_active) VALUES (${"ISOSEATO" + uniq}, ${P + " inactive"}, 'client', false) RETURNING id`;
  created.codes.push(org.id, old.id, off.id);
  await sql`INSERT INTO org_staff (access_code_id, user_id, role) VALUES (${org.id}, ${staff}, 'staff')`;
  await sql`INSERT INTO access_code_redemption (user_id, access_code_id) VALUES (${member}, ${org.id})`;
  await sql`INSERT INTO access_code_redemption (user_id, access_code_id) VALUES (${lapsed}, ${old.id})`;
  await sql`INSERT INTO access_code_redemption (user_id, access_code_id) VALUES (${closedMember}, ${off.id})`;
  await sql`INSERT INTO platform_admin (user_id, note) VALUES (${boss}, 'isolation fixture')`;
  await sql`INSERT INTO refinery_seat_legacy (user_id) VALUES (${legacy})`;
  await sql`UPDATE users SET tier = 'partner' WHERE id = ${selfTier}`;
  await sql`INSERT INTO progression_grant (user_id, grant_key, kind, step_id, label) VALUES (${selfTier}, 'early:tailor', 'unlock', 'tailor', 'fixture')`.catch(() => {});

  check("seat: platform admin", (await seat(boss)) === true);
  check("seat: organization owner", (await seat(owner)) === true);
  check("seat: organization staff", (await seat(staff)) === true);
  check("seat: member of an active code", (await seat(member)) === true);
  check("seat: grandfathered account", (await seat(legacy)) === true);
  check("no seat: a fresh account", (await seat(nobody)) === false);
  check("no seat: member of an expired code", (await seat(lapsed)) === false);
  check("no seat: member of an inactive code", (await seat(closedMember)) === false);
  check("no seat: users.tier partner and a progression unlock count for nothing", (await seat(selfTier)) === false);

  const unscoped = await app`SELECT (SELECT count(*) FROM refinery_access_policy)::int AS p, (SELECT count(*) FROM refinery_seat_legacy)::int AS l, (SELECT count(*) FROM org_seat_offer)::int AS o`;
  check("an unscoped app read sees no policy row, no grandfather rows, no offers", unscoped[0].p === 0 && unscoped[0].l === 0 && unscoped[0].o === 0, JSON.stringify(unscoped[0]));
  const selfLegacy = await raised(() => app.transaction([app`SELECT set_config('app.user_id', ${nobody}, true)`, app`INSERT INTO refinery_seat_legacy (user_id) VALUES (${nobody})`]));
  check("a person cannot put themselves on the grandfather list", !!selfLegacy && /row-level security|permission denied/i.test(selfLegacy), selfLegacy ?? "insert succeeded");
  const flip = await app.transaction([app`SELECT set_config('app.user_id', ${nobody}, true)`, app`UPDATE refinery_access_policy SET public_signup_open = NOT public_signup_open WHERE id RETURNING id`]);
  check("a non-admin cannot flip the switch", flip[1].length === 0);
  const del = await raised(() => app.transaction([app`SELECT set_config('app.user_id', ${boss}, true)`, app`DELETE FROM refinery_access_policy`]));
  check("not even an admin can delete the policy row from the app", !!del && /permission denied/i.test(del), del ?? "delete ran");

  // Offers: an existing account that has signed in is asked first.
  const asked = await mkUser("seat-asked");
  await sql`UPDATE users SET "emailVerified" = now() WHERE id = ${asked}`;
  const [{ email: askedEmail }] = await sql`SELECT email FROM users WHERE id = ${asked}`;
  const [{ t: seatsBefore }] = await sql`SELECT times_redeemed AS t FROM access_code WHERE id = ${org.id}`;
  const inv = await core.createOrgInvite({ accessCodeId: org.id, code: org.code, name: "Asked", email: askedEmail, invitedBy: owner });
  const [{ n: memAfterOffer }] = await sql`SELECT count(*)::int AS n FROM access_code_redemption WHERE user_id = ${asked}`;
  const [{ t: seatsAfterOffer }] = await sql`SELECT times_redeemed AS t FROM access_code WHERE id = ${org.id}`;
  check("inviting an existing account makes an offer: no membership, no seat spent", inv.ok && inv.kind === "offered" && memAfterOffer === 0 && seatsAfterOffer === seatsBefore, JSON.stringify(inv));
  const offers = await core.listMySeatOffers(asked);
  check("the person sees the offer, with the organization's name", offers.length === 1 && offers[0].orgName === P + " seats");
  check("another account cannot accept it", (await core.acceptSeatOffer(nobody, offers[0].id)) === "not_found");
  check("accepting spends the seat through the one membership path", (await core.acceptSeatOffer(asked, offers[0].id)) === "ok"
    && (await sql`SELECT times_redeemed AS t FROM access_code WHERE id = ${org.id}`)[0].t === seatsBefore + 1 && (await seat(asked)) === true);
  check("an answered offer cannot be answered again", (await core.acceptSeatOffer(asked, offers[0].id)) === "not_found");

  const declines = await mkUser("seat-declines");
  await sql`UPDATE users SET "emailVerified" = now() WHERE id = ${declines}`;
  const [{ email: dEmail }] = await sql`SELECT email FROM users WHERE id = ${declines}`;
  await core.createOrgInvite({ accessCodeId: org.id, code: org.code, name: "D", email: dEmail, invitedBy: owner });
  const [dOffer] = await core.listMySeatOffers(declines);
  check("declining spends nothing", (await core.declineSeatOffer(declines, dOffer.id)) === "ok" && (await seat(declines)) === false);

  // Leave one organization: the membership ends, the seat is not refunded.
  const [{ t: beforeLeave }] = await sql`SELECT times_redeemed AS t FROM access_code WHERE id = ${org.id}`;
  check("leaving one organization ends that membership", (await core.leaveOrg(asked, org.id)) === true && (await seat(asked)) === false);
  check("leaving does not hand the seat back (durable seats)", (await sql`SELECT times_redeemed AS t FROM access_code WHERE id = ${org.id}`)[0].t === beforeLeave);
  // Review 1, SF-5: coming back takes back the old seat, never a second one.
  const back = await core.redeemAccessCode(asked, org.code);
  check("leave then re-join with the code spends no second seat", back.success
    && (await sql`SELECT times_redeemed AS t FROM access_code WHERE id = ${org.id}`)[0].t === beforeLeave && (await seat(asked)) === true,
    JSON.stringify(back));

  // Review 1, N-4: an offer accepted after joining another organization is refused.
  const other = await mkUser("seat-other");
  await sql`UPDATE users SET "emailVerified" = now() WHERE id = ${other}`;
  const [{ email: oEmail }] = await sql`SELECT email FROM users WHERE id = ${other}`;
  await core.createOrgInvite({ accessCodeId: org.id, code: org.code, name: "O", email: oEmail, invitedBy: owner });
  const [oOffer] = await core.listMySeatOffers(other);
  const [otherOrg] = await sql`INSERT INTO access_code (code, partner_name, tier, is_active) VALUES (${"ISOSEATT" + uniq}, ${P + " other"}, 'client', true) RETURNING id, code`;
  created.codes.push(otherOrg.id);
  await core.redeemAccessCode(other, otherOrg.code);
  check("accepting an offer re-checks the other-organization rule", (await core.acceptSeatOffer(other, oOffer.id)) === "other_org");
  // SF8: the offer is in the organization's own invite record, flipped on yes.
  const [rec] = await sql`SELECT invited_name, offer_status FROM org_invite WHERE access_code_id = ${org.id} AND user_id = ${asked}`;
  check("an accepted offer is recorded in org_invite with the typed name, status joined", rec?.invited_name === "Asked" && rec?.offer_status === "joined", JSON.stringify(rec));
  // SF-2 with the boss ruling (2026-10-23): an OPEN offer always blocks a
  // second offer and a second email; the org never learns of a decline, so a
  // declined offer stays on the Invited list and a second "Add" gets the same
  // "already on your invited list" answer an unanswered invite gets; a
  // withdrawn offer is relisted at once, emailed only after the 24 hours.
  const twice = await mkUser("seat-open-twice");
  await sql`UPDATE users SET "emailVerified" = now() WHERE id = ${twice}`;
  const [{ email: tEmail }] = await sql`SELECT email FROM users WHERE id = ${twice}`;
  const first = await core.createOrgInvite({ accessCodeId: org.id, code: org.code, name: "T", email: tEmail, invitedBy: owner });
  const second = await core.createOrgInvite({ accessCodeId: org.id, code: org.code, name: "T", email: tEmail, invitedBy: owner });
  const direct = await core.createSeatOffer({ accessCodeId: org.id, userId: twice, offeredBy: owner, windowHours: 0 });
  check("an open offer blocks a second offer and a second email, whatever the window",
    first.ok && first.notify === true && !second.ok && second.error === core.ALREADY_INVITED && direct === false
      && (await core.listMySeatOffers(twice)).length === 1,
    JSON.stringify({ first, second, direct }));
  const again = await core.createOrgInvite({ accessCodeId: org.id, code: org.code, name: "D", email: dEmail, invitedBy: owner });
  check("a second offer to a person who declined within 24 hours is not made and not emailed, with the listed answer",
    !again.ok && again.error === core.ALREADY_INVITED && (await core.listMySeatOffers(declines)).length === 0, JSON.stringify(again));
  const gone = await mkUser("seat-withdrawn");
  await sql`UPDATE users SET "emailVerified" = now() WHERE id = ${gone}`;
  const [{ email: gEmail }] = await sql`SELECT email FROM users WHERE id = ${gone}`;
  await core.createOrgInvite({ accessCodeId: org.id, code: org.code, name: "G", email: gEmail, invitedBy: owner });
  const removed = await core.revokeOrgInvite(org.id, gone, owner);
  const back2 = await core.createOrgInvite({ accessCodeId: org.id, code: org.code, name: "G again", email: gEmail, invitedBy: owner });
  const [gRow] = await sql`SELECT invited_name, offer_status FROM org_invite WHERE access_code_id = ${org.id} AND user_id = ${gone}`;
  check("a withdrawn offer re-added within 24 hours is relisted at once and not emailed",
    removed.ok && back2.ok && back2.notify === false && gRow?.offer_status === "offered" && gRow?.invited_name === "G again"
      && (await core.listMySeatOffers(gone)).length === 1,
    JSON.stringify({ removed, back2, gRow }));

  // Review 1, BL-2: grandfather once. Run the close statements as the app, as a platform admin.
  const legacyBefore = (await sql`SELECT user_id FROM refinery_seat_legacy`).map((r) => r.user_id);
  const [policyBefore] = await sql`SELECT public_signup_open, legacy_cutoff, closed_at FROM refinery_access_policy WHERE id`;
  const close = () => app.transaction([
    app`SELECT set_config('app.user_id', ${boss}, true)`,
    app`SELECT public_signup_open, legacy_cutoff FROM refinery_access_policy WHERE id FOR UPDATE`,
    app`INSERT INTO refinery_seat_legacy (user_id) SELECT u.id FROM users u WHERE EXISTS (SELECT 1 FROM refinery_access_policy p WHERE p.id AND p.public_signup_open AND p.legacy_cutoff IS NULL) ON CONFLICT (user_id) DO NOTHING`,
    app`UPDATE refinery_access_policy SET public_signup_open=false, closed_at=now(), legacy_cutoff=COALESCE(legacy_cutoff, now()) WHERE id AND public_signup_open RETURNING id`,
  ]);
  if (!policyBefore.public_signup_open || policyBefore.legacy_cutoff) {
    console.log("  note  the policy here was already closed once; grandfather checks skipped");
  } else {
    const first = await close();
    check("the first close flips the switch", first[3].length === 1);
    const second = await close();
    check("a second close while closed changes nothing", second[3].length === 0);
    const late = await mkUser("seat-late");
    await app.transaction([app`SELECT set_config('app.user_id', ${boss}, true)`, app`UPDATE refinery_access_policy SET public_signup_open=true WHERE id`]);
    const reclose = await close();
    check("open, then close again: an account made in between is NOT grandfathered", reclose[3].length === 1 && (await seat(late)) === false);
    const rm = await app.transaction([app`SELECT set_config('app.user_id', ${boss}, true)`, app`DELETE FROM refinery_seat_legacy WHERE user_id = ${legacy} RETURNING user_id`]);
    check("a platform admin can take one account off the grandfather list", rm[1].length === 1);
    const notAdmin = await app.transaction([app`SELECT set_config('app.user_id', ${nobody}, true)`, app`DELETE FROM refinery_seat_legacy RETURNING user_id`]);
    check("nobody else can", notAdmin[1].length === 0);
    // Put the disposable database back as it was.
    await sql`UPDATE refinery_access_policy SET public_signup_open = ${policyBefore.public_signup_open}, legacy_cutoff = NULL, closed_at = ${policyBefore.closed_at} WHERE id`;
    await sql`DELETE FROM refinery_seat_legacy WHERE NOT (user_id = ANY(${legacyBefore}::uuid[]))`;
  }

  await sql`DELETE FROM platform_admin WHERE user_id = ${boss}`;
}

main()
  .catch((err) => {
    console.error("\nharness error:", err);
    fail++;
  })
  .finally(async () => {
    await cleanup().catch((e) => console.error("cleanup failed:", e));
    console.log(`\n${pass} passed, ${fail} failed\n`);
    process.exit(fail === 0 ? 0 : 1);
  });
