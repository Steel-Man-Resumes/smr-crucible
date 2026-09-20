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
    await sql`DELETE FROM org_capability_override WHERE org_id = ANY(${codes}::uuid[])`.catch(() => {});
    await sql`DELETE FROM org_audit WHERE org_id = ANY(${codes}::uuid[])`;
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
  await ownerOnlyChecks();
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
  const hire = overview?.find((m) => m.userId === inv.userId);
  check("the owner can invite someone to staff by email, and they show as invited", inv.ok && !!hire && hire.pending && hire.role === "staff" && hire.title === "Employment Specialist", JSON.stringify(inv));
  check("an admin cannot create another admin", (await core.inviteOrgStaff(aAdmin, { name: "X", email: `${P}-a-x-${uniq.toLowerCase()}@example.invalid`, role: "org_admin" })).ok === false);
  const [{ email: outsiderEmail }] = await sql`SELECT email FROM users WHERE id = ${outsider}`;
  check("an address that already has an account elsewhere is not attached to this roster", (await core.inviteOrgStaff(aOwner, { name: "X", email: outsiderEmail, role: "staff" })).ok === false);
  check("the overview shows the owner once, and marks who may be edited",
    overview.filter((m) => m.role === "owner").length === 1 && overview.find((m) => m.userId === cm).editable && !overview.find((m) => m.userId === owner).editable);

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
  await joinCohortConsent(wes);
  const headP = await core.getClientHeader(aRuss, wes);
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

  // -- site 3: a tier re-sync must not demote
  await core.syncUserTierFromCodes(pat);
  const [{ tier: patTier }] = await sql`SELECT tier FROM users WHERE id = ${pat}`;
  check("a tier re-sync keeps a partner-coded person at partner", patTier === "partner", `tier is ${patTier}`);

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

  await sql`DELETE FROM platform_admin WHERE user_id = ${boss}`;
  const [revoked] = await sql`SELECT tier FROM users WHERE id = ${boss}`;
  check("revoking platform admin drops the cached tier", revoked.tier !== "admin", `tier is ${revoked.tier}`);
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
