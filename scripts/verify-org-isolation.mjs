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

const URL_VAR = "ISOLATION_TEST_DATABASE_URL";
const url = process.env[URL_VAR];

if (!url) {
  console.error(
    `\n${URL_VAR} is not set.\n\n` +
      `This script seeds and deletes rows, so it will not guess a database.\n` +
      `Point it at a NON-PRODUCTION database:\n\n` +
      `  ${URL_VAR}='postgres://...' node scripts/verify-org-isolation.mjs\n`
  );
  process.exit(2); // 2 = could not run, distinct from 1 = isolation failed
}

const sql = neon(url);
const P = "__isotest";

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

async function cleanup() {
  // Order matters: children before parents.
  await sql`DELETE FROM client_staff_assignment WHERE access_code_id IN
              (SELECT id FROM access_code WHERE code LIKE ${P + "%"})`;
  await sql`DELETE FROM access_code_redemption WHERE access_code_id IN
              (SELECT id FROM access_code WHERE code LIKE ${P + "%"})`;
  await sql`DELETE FROM org_staff WHERE access_code_id IN
              (SELECT id FROM access_code WHERE code LIKE ${P + "%"})`;
  await sql`DELETE FROM consumer_consent WHERE user_id IN
              (SELECT id FROM users WHERE email LIKE ${P + "%"})`;
  await sql`DELETE FROM access_code WHERE code LIKE ${P + "%"}`;
  await sql`DELETE FROM users WHERE email LIKE ${P + "%"}`;
}

async function mkUser(label) {
  const [row] = await sql`
    INSERT INTO users (name, email, tier)
    VALUES (${P + " " + label}, ${`${P}-${label}@example.invalid`}, 'client')
    RETURNING id`;
  return row.id;
}

async function mkOrg(label, ownerId) {
  const [row] = await sql`
    INSERT INTO access_code (code, partner_name, tier, partner_user_id, is_active)
    VALUES (${`${P}-${label}`}, ${`${P} ${label}`}, 'partner', ${ownerId}, true)
    RETURNING id`;
  return row.id;
}

/** Join a participant to an org AND grant sharing consent, so they are visible. */
async function joinCohort(orgId, userId) {
  await sql`INSERT INTO access_code_redemption (user_id, access_code_id)
            VALUES (${userId}, ${orgId})`;
  await sql`INSERT INTO consumer_consent (user_id, consent_layer, status)
            VALUES (${userId}, 'sharing', 'granted')
            ON CONFLICT DO NOTHING`;
}

async function main() {
  console.log("\nCross-org isolation\n");
  await cleanup(); // a crashed previous run must not poison this one

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
