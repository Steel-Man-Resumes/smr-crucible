#!/usr/bin/env node
/**
 * Mint a fresh smr_app credential for PRODUCTION and prove the application
 * works under it BEFORE anyone changes Vercel.
 *
 *   node scripts/rls-prepare-app-credential.mjs --production
 *
 * WHY THIS EXISTS. On 2026-09-20 /api/health/rls showed production connected
 * as neondb_owner -- a role that bypasses row-level security -- although the
 * 9/19 handoff recorded a cutover to smr_app. Every policy was inert. Nobody
 * held the smr_app password any more, so a new one is needed; and the older
 * rls-stage4-prod-prep.mjs must not be re-run because it re-grants write
 * access to the audit table.
 *
 * SAFE TO RUN WHILE THE APP IS ON THE OWNER ROLE: it refuses if any session is
 * currently connected as smr_app, because rotating the password under a live
 * app is an outage.
 *
 * It then connects AS smr_app and runs the same health check the app serves,
 * plus read-only probes of real production data through the application's own
 * functions. Read-only: it creates no fixtures in production.
 *
 * The credential goes to .env.smr-app-prod (gitignored) and is never printed.
 */
import { neon } from "@neondatabase/serverless";
import { readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { assertBypassRole } from "./lib/assert-bypass-role.mjs";
import { applyRestrictedGrants, checkRestrictedGrants, APP_ROLE } from "./lib/restricted-grants.mjs";

if (!process.argv.includes("--production")) {
  console.error("This rotates the production app-role password. Pass --production to confirm.");
  process.exit(2);
}
const OUT = ".env.smr-app-prod";
const line = readFileSync("apps/consumer/.env.local", "utf8").split("\n").find((l) => l.trim().startsWith("DATABASE_URL="));
const ownerUrl = line.slice(line.indexOf("=") + 1).trim().replace(/^["']|["']$/g, "");
const sql = neon(ownerUrl);
const run = (q) => sql(q);
const who = await assertBypassRole(run, "rls-prepare-app-credential");
const parsed = new URL(ownerUrl);
console.log(`\nowner connection: ${who} @ ${parsed.hostname}\n`);

const live = await sql`SELECT count(*)::int AS n FROM pg_stat_activity WHERE usename = ${APP_ROLE}`;
if (live[0].n > 0) {
  console.error(`REFUSING: ${live[0].n} live session(s) as ${APP_ROLE}. The app is using this role; rotating would lock it out.`);
  process.exit(1);
}

const [role] = await sql`SELECT rolbypassrls, rolsuper FROM pg_roles WHERE rolname = ${APP_ROLE}`;
if (!role) { console.error(`${APP_ROLE} does not exist. Run rls-stage1-create-role.mjs against this database first.`); process.exit(1); }
if (role.rolbypassrls || role.rolsuper) { console.error(`${APP_ROLE} can bypass RLS. Stop.`); process.exit(1); }

const password = randomBytes(24).toString("base64url");
await sql(`ALTER ROLE ${APP_ROLE} WITH LOGIN PASSWORD '${password.replace(/'/g, "''")}'`);
// Anything created since the role was first granted (new tables, sequences).
await sql(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${APP_ROLE}`);
await sql(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${APP_ROLE}`);
await applyRestrictedGrants(run);
const problems = await checkRestrictedGrants(run);
if (problems.length) { console.error("restricted grants wrong:\n  " + problems.join("\n  ")); process.exit(1); }
console.log("  password rotated, grants refreshed, restricted tables re-locked");

parsed.username = APP_ROLE;
parsed.password = password;
const appUrl = parsed.toString();
writeFileSync(OUT, `SMR_APP_DATABASE_URL=${appUrl}\n`, { mode: 0o600 });

// ---- prove it, as smr_app, against real production data, read-only ----
process.env.DATABASE_URL = appUrl;
const core = await import("../packages/core/dist/index.js");
let bad = 0;
const check = (name, ok, detail = "") => { console.log(`  ${ok ? "pass" : "FAIL"}  ${name}${ok || !detail ? "" : "\n          " + detail}`); if (!ok) bad++; };

const health = await core.getRlsHealth();
check("health check as smr_app: enforced, forced, unscoped reads empty, scoped reads see rows", health.ok, JSON.stringify(health.problems));

const [demo] = await sql`SELECT id, partner_user_id FROM access_code WHERE code = 'MTDEMO'`;
if (demo) {
  const [{ n: truth }] = await sql`SELECT count(*)::int AS n FROM access_code_redemption WHERE access_code_id = ${demo.id}`;
  const cohort = await core.getPartnerCohort(demo.partner_user_id, { accessCodeId: demo.id });
  check("a demo org owner's cohort, read as smr_app, matches the owner's count", cohort.totalJoined === truth && truth > 0, `app=${cohort.totalJoined} truth=${truth}`);
  const staff = await core.getOrgStaff(demo.id);
  const [{ n: staffTruth }] = await sql`SELECT count(*)::int AS n FROM org_staff WHERE access_code_id = ${demo.id}`;
  check("its staff roster matches", staff.length === staffTruth, `app=${staff.length} truth=${staffTruth}`);
  const [member] = await sql`SELECT r.user_id, ac.daily_limit FROM access_code_redemption r JOIN access_code ac ON ac.id = r.access_code_id WHERE r.access_code_id = ${demo.id} LIMIT 1`;
  check("a participant's rate limit resolves to their code's allowance", (await core.getUserDailyLimit(member.user_id)) === (member.daily_limit ?? 200));
  check("a participant can list their own code", (await core.getUserAccessCodes(member.user_id)).length >= 1);
  const actor = await core.resolveOrgActor(demo.partner_user_id);
  check("the owner resolves as an org actor", !!actor && actor.orgId === demo.id);
}
const [admin] = await sql`SELECT user_id FROM platform_admin LIMIT 1`;
if (admin) check("a platform admin is recognised", (await core.isPlatformAdmin(admin.user_id)) === true);
const report = await core.getAggregateReport().catch((e) => ({ error: String(e) }));
check("the cross-org evidence report runs", !report.error, report.error);

console.log(bad === 0
  ? `\nREADY. Credential written to ${OUT} (not printed).\n`
  : `\n${bad} check(s) FAILED. Do NOT put this credential into Vercel.\n`);
process.exit(bad === 0 ? 0 : 1);
