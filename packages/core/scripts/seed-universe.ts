/**
 * Seed the Steel Man universe (idempotent). Safe to re-run.
 *
 *   DATABASE_URL=... npx tsx packages/core/scripts/seed-universe.ts
 *
 * Seeds:
 *  1. The sentinel org (so consent / access-code audit events can record).
 *  2. The admin account (by email -- the PostgresAdapter matches it on sign-in).
 *  3. Dr. Baker as a partner + her access code linked to her (partner_user_id),
 *     plus the JFW pilot code.
 *  4. A clearly-labelled DEMO cohort (one sharing client with real progress) so
 *     the partner dashboard demonstrates with data. Delete the *.demo rows anytime.
 *
 * Writes NO secrets. Confirm ADMIN_EMAIL below before running against prod.
 */

import { query, getOne, insert } from "../src/db";
import { createArtifact } from "../src/refineryArtifact";
import { grantConsent } from "../src/consent";
import { getNextStep, invalidateNextStep } from "../src/computeNextStep";

const SENTINEL_ORG = "00000000-0000-0000-0000-000000000000";
const ADMIN_EMAIL = "marcusinplainsight@gmail.com"; // documented SMR admin
const BAKER_EMAIL = "latonyabakergoe@gmail.com"; // partner pre-auth (auth.ts)
const DEMO_CLIENT_EMAIL = "demo-client@steelmanresumes.demo";

async function upsertUserByEmail(email: string, name: string, tier: string): Promise<string> {
  const row = await getOne<{ id: string }>(
    `INSERT INTO users (email, name, tier) VALUES ($1, $2, $3)
     ON CONFLICT (email) DO UPDATE SET tier = EXCLUDED.tier, name = COALESCE(users.name, EXCLUDED.name)
     RETURNING id`,
    [email, name, tier]
  );
  return row!.id;
}

async function upsertCode(code: string, partnerName: string, partnerUserId: string | null) {
  await query(
    `INSERT INTO access_code (code, partner_name, tier, daily_limit, partner_user_id)
     VALUES ($1, $2, 'partner', 200, $3)
     ON CONFLICT (code) DO UPDATE SET partner_user_id = COALESCE(access_code.partner_user_id, EXCLUDED.partner_user_id)`,
    [code, partnerName, partnerUserId]
  );
  return getOne<{ id: string }>(`SELECT id FROM access_code WHERE code = $1`, [code]);
}

(async () => {
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL is required");
    process.exit(1);
  }
  const done: string[] = [];

  // 1. Sentinel org
  await query(
    `INSERT INTO org (id, name) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING`,
    [SENTINEL_ORG, "Consumer (system)"]
  );
  done.push("sentinel org");

  // 2. Admin
  const adminId = await upsertUserByEmail(ADMIN_EMAIL, "Steel Man Admin", "admin");
  done.push(`admin (${ADMIN_EMAIL})`);

  // 3. Baker partner + codes
  const bakerId = await upsertUserByEmail(BAKER_EMAIL, "Dr. Baker", "partner");
  await upsertCode("BAKER2026", "Dr. Baker / MKE Reentry", bakerId);
  const jfw = await upsertCode("JFW2026", "Justice Forward WI", null);
  const baker = await getOne<{ id: string }>(`SELECT id FROM access_code WHERE code = 'BAKER2026'`);
  done.push("codes BAKER2026 (linked to Baker) + JFW2026");

  // 4. DEMO cohort -- one sharing client with progress in Baker's cohort
  const demoId = await upsertUserByEmail(DEMO_CLIENT_EMAIL, "Demo Client (sample)", "client");
  await query(`UPDATE users SET onboarding_tour_complete = true, onboarding_tour_deferrals = 0 WHERE id = $1`, [demoId]);
  await query(
    `INSERT INTO consumer_profile (user_id, forge_output) VALUES ($1, $2)
     ON CONFLICT (user_id) DO NOTHING`,
    [demoId, JSON.stringify({ narrative: { summary: "Sample profile for the partner-dashboard demo." } })]
  );
  if (baker?.id) {
    await query(
      `INSERT INTO access_code_redemption (user_id, access_code_id) VALUES ($1, $2)
       ON CONFLICT (user_id, access_code_id) DO NOTHING`,
      [demoId, baker.id]
    );
  }
  await grantConsent(demoId, "sharing", "seed-demo");

  // Reset + rebuild the demo client's progress so re-runs give a consistent
  // mid-journey state (resume + disclosure done, practiced once -> "Practice your
  // interview", Stage 5). Safe: only ever touches the demo client's own rows.
  await query(`DELETE FROM job_application WHERE user_id = $1`, [demoId]);
  await query(`DELETE FROM refinery_artifact WHERE user_id = $1`, [demoId]);
  const app = await insert<{ id: string }>("job_application", {
    user_id: demoId,
    job_title: "Warehouse Associate",
    company: "Lakefront Logistics",
    location: "Milwaukee, WI",
    status: "applied",
    applied_at: new Date().toISOString(),
    status_updated_at: new Date().toISOString(),
  });
  const resume = await createArtifact(demoId, "resume", { applicationId: app.id, targetJob: "Warehouse Associate", targetCompany: "Lakefront Logistics" }, { formatVersion: 2, meta: { targetJob: "Warehouse Associate" } });
  await query(`UPDATE job_application SET resume_artifact_id = $1 WHERE id = $2`, [resume.id, app.id]);
  await createArtifact(demoId, "disclosure_plan", { targetJob: "Warehouse Associate" }, { script: "Sample disclosure plan (demo).", completedAt: new Date().toISOString() });
  await createArtifact(demoId, "interview_prep", { frame: "behavioral" }, { role: "Warehouse Associate", frame: "behavioral", mode: "text", feedback: { overall: "Strong, specific answers." }, completedAt: new Date().toISOString() });
  done.push("demo client + cohort progress");
  // Compute + cache the demo client's real journey stage (invalidate first so we
  // never serve a stale cache from a prior run).
  await invalidateNextStep(demoId);
  await getNextStep(demoId);

  console.log("Seeded:\n  - " + done.join("\n  - "));
  console.log("\nAdmin:", ADMIN_EMAIL, "| Partner:", BAKER_EMAIL, "| Demo client:", DEMO_CLIENT_EMAIL);
  process.exit(0);
})().catch((e) => {
  console.error("Seed failed:", e);
  process.exit(1);
});
