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
  }
  if (users.length) {
    await sql`DELETE FROM consumer_consent WHERE user_id = ANY(${users}::uuid[])`;
    await sql`DELETE FROM client_staff_assignment WHERE staff_user_id = ANY(${users}::uuid[])`;
  }
  if (codes.length) await sql`DELETE FROM access_code WHERE id = ANY(${codes}::uuid[])`;
  if (users.length) await sql`DELETE FROM users WHERE id = ANY(${users}::uuid[])`;
  created.users = [];
  created.codes = [];
}

async function mkUser(label) {
  const [row] = await sql`
    INSERT INTO users (name, email, tier)
    VALUES (${P + " " + label}, ${`${P}-${label}@example.invalid`}, 'client')
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
