#!/usr/bin/env node
/**
 * Seed clearly-labelled DEMO organizations, for showing scope to stakeholders.
 *
 * WHY EVERY ONE OF THESE SAYS "(Demo)" IN ITS NAME. They live in the same
 * database as real customers. Without a visible marker, "how many active
 * organizations do you have" stops having a true answer -- and that is a
 * question a state agency asks. A demo org that cannot be told apart from a
 * customer is a number we would end up quoting by accident.
 *
 * So, three rules this script enforces on itself:
 *   1. Every org name ends in "(Demo)". Asserted before any write.
 *   2. Every email is @example.invalid -- a reserved, non-routable TLD. No
 *      fabricated person can ever receive mail, and no real address can be
 *      typo'd into this file.
 *   3. Every person is fictional. No real staff member's name appears here,
 *      which is also what keeps this file safe in a public repository.
 *
 * Idempotent: re-running updates rather than duplicating.
 *
 *   node scripts/seed-demo-orgs.mjs --check    report what would change
 *   node scripts/seed-demo-orgs.mjs            apply
 */
import { readFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";
import { assertBypassRole } from "./lib/assert-bypass-role.mjs";

const DEMO_SUFFIX = "(Demo)";
const EMAIL_DOMAIN = "example.invalid";
const checkOnly = process.argv.includes("--check");

function databaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  for (const f of ["apps/consumer/.env.local", ".env.local"]) {
    try {
      const line = readFileSync(f, "utf8").split("\n").find((l) => l.trim().startsWith("DATABASE_URL="));
      if (line) return line.slice(line.indexOf("=") + 1).trim().replace(/^["']|["']$/g, "");
    } catch { /* next */ }
  }
  return null;
}

/**
 * Three demo organizations, one per geography we are in conversation with.
 * Names are deliberately generic-fictional so they cannot be mistaken for, or
 * collide with, a real agency or nonprofit in those states.
 */
const ORGS = [
  {
    code: "MTDEMO",
    name: `Big Sky Reentry Services ${DEMO_SUFFIX}`,
    state: "MT",
    admin: { name: "Dana Whitcomb", title: "Program Director" },
    staff: [
      { name: "Russ Feeney", title: "Reentry Case Manager" },
      { name: "Alma Trejo", title: "Employment Specialist" },
    ],
    // Spread deliberately: one stalled, one never started, one hired, two
    // active. That is what makes the console's "where to start today" strip
    // show something real instead of an empty state.
    clients: [
      { name: "Wes Duvall", stage: 4, lastActiveDays: 2 },
      { name: "Priya Raines", stage: 3, lastActiveDays: 1 },
      { name: "Colton Reese", stage: 2, lastActiveDays: 31 },
      { name: "Nadia Brooks", stage: 1, lastActiveDays: null },
      { name: "Terrell Judd", stage: 6, lastActiveDays: 5, hired: true },
    ],
  },
  {
    code: "MIDEMO",
    name: `Great Lakes Workforce Collaborative ${DEMO_SUFFIX}`,
    state: "MI",
    admin: { name: "Yvonne Carrasco", title: "Executive Director" },
    staff: [{ name: "Deon Hartwell", title: "Career Navigator" }],
    clients: [
      { name: "Marcus Pruitt", stage: 3, lastActiveDays: 3 },
      { name: "Sheree Blanton", stage: 5, lastActiveDays: 1 },
      { name: "Ivan Kozlow", stage: 2, lastActiveDays: 22 },
    ],
  },
  {
    code: "MODEMO",
    name: `Gateway Second Chance Network ${DEMO_SUFFIX}`,
    state: "MO",
    admin: { name: "Lorraine Petty", title: "Director of Programs" },
    staff: [{ name: "Curtis Nwosu", title: "Employment Coach" }],
    clients: [
      { name: "Jolene Radcliffe", stage: 4, lastActiveDays: 6 },
      { name: "Andre Sifuentes", stage: 1, lastActiveDays: 18 },
    ],
  },
];

// ---- guard rails, checked before a single write -------------------------
for (const o of ORGS) {
  if (!o.name.endsWith(DEMO_SUFFIX)) {
    console.error(`\nREFUSING: "${o.name}" does not end in ${DEMO_SUFFIX}.\n`);
    process.exit(2);
  }
}

const url = databaseUrl();
if (!url) { console.error("\nNo DATABASE_URL found.\n"); process.exit(2); }
const sql = neon(url);
await assertBypassRole((q) => sql.query(q), "seed-demo-orgs");

const emailFor = (name, org) =>
  `${name.toLowerCase().replace(/[^a-z]+/g, ".")}@${org.code.toLowerCase()}.${EMAIL_DOMAIN}`;

async function upsertUser(person, org, tier) {
  const email = emailFor(person.name, org);
  if (!email.endsWith(EMAIL_DOMAIN)) throw new Error(`refusing non-demo email: ${email}`);
  const [row] = await sql`
    INSERT INTO users (name, email, tier, current_stage)
    VALUES (${person.name}, ${email}, ${tier}, ${person.stage ?? 0})
    ON CONFLICT (email) DO UPDATE
      SET name = EXCLUDED.name, tier = EXCLUDED.tier,
          current_stage = COALESCE(EXCLUDED.current_stage, users.current_stage)
    RETURNING id`;
  return row.id;
}

console.log(`\nDemo organizations${checkOnly ? "  (--check, nothing will be written)" : ""}\n`);

for (const org of ORGS) {
  const people = 1 + org.staff.length + org.clients.length;
  console.log(`  ${org.code.padEnd(8)} ${org.name}`);
  console.log(`           ${org.state} -- 1 admin, ${org.staff.length} staff, ${org.clients.length} participants (${people} accounts)`);
  if (checkOnly) continue;

  const adminId = await upsertUser(org.admin, org, "partner");

  const [code] = await sql`
    INSERT INTO access_code (code, partner_name, tier, partner_user_id, is_active, daily_limit, max_redemptions)
    VALUES (${org.code}, ${org.name}, 'partner', ${adminId}, true, 200, 50)
    ON CONFLICT (code) DO UPDATE
      SET partner_name = EXCLUDED.partner_name, partner_user_id = EXCLUDED.partner_user_id,
          is_active = true
    RETURNING id`;

  await sql`INSERT INTO org_staff (access_code_id, user_id, role, title)
            VALUES (${code.id}, ${adminId}, 'org_admin', ${org.admin.title})
            ON CONFLICT (access_code_id, user_id)
            DO UPDATE SET role = 'org_admin', title = EXCLUDED.title`;

  const staffIds = [];
  for (const s of org.staff) {
    const id = await upsertUser(s, org, "partner");
    staffIds.push(id);
    await sql`INSERT INTO org_staff (access_code_id, user_id, role, title)
              VALUES (${code.id}, ${id}, 'staff', ${s.title})
              ON CONFLICT (access_code_id, user_id)
              DO UPDATE SET role = 'staff', title = EXCLUDED.title`;
  }

  for (const [i, c] of org.clients.entries()) {
    const id = await upsertUser(c, org, "client");

    await sql`INSERT INTO access_code_redemption (user_id, access_code_id)
              VALUES (${id}, ${code.id}) ON CONFLICT (user_id, access_code_id) DO NOTHING`;

    // Sharing consent, or they are counted but never named -- which is correct
    // behaviour and makes for a poor demo, so demo participants consent.
    await sql`INSERT INTO consumer_consent
                (user_id, consent_layer, status, consent_text_version, collection_context)
              VALUES (${id}, 'sharing', 'granted', 'demo-seed',
                      ${JSON.stringify({ source: "demo-seed" })}::jsonb)
              ON CONFLICT (user_id, consent_layer) DO UPDATE SET status = 'granted'`;

    // Assign to a staff member, round robin. One client is left unassigned on
    // purpose in the Montana org, so the "nobody assigned" row is visible too.
    const assignTo = staffIds.length && !(org.code === "MTDEMO" && i === 3)
      ? staffIds[i % staffIds.length]
      : null;
    if (assignTo) {
      await sql`INSERT INTO client_staff_assignment
                  (access_code_id, client_user_id, staff_user_id, assigned_by)
                VALUES (${code.id}, ${id}, ${assignTo}, ${adminId})
                ON CONFLICT (access_code_id, client_user_id)
                DO UPDATE SET staff_user_id = EXCLUDED.staff_user_id`;
    }

    // Activity recency drives the console's stalled / active split.
    if (c.lastActiveDays !== null) {
      await sql`UPDATE users
                   SET next_step_cached_at = now() - (${c.lastActiveDays} || ' days')::interval
                 WHERE id = ${id}`;
    }

    // Plausible AI spend, so the admin's "you see exactly what you fund"
    // column shows something. Every demo participant reading $0.00 makes a
    // working feature look broken, which is worse than not showing it.
    await sql`DELETE FROM ai_token_usage WHERE user_id = ${id} AND endpoint LIKE ${"demo-%"}`;
    const runs = Math.max(1, Math.round((c.stage ?? 1) * 1.6));
    for (let r = 0; r < runs; r++) {
      const inTok = 2400 + ((i + r) * 317) % 5200;
      const outTok = 700 + ((i + r) * 211) % 1900;
      await sql`INSERT INTO ai_token_usage
                  (user_id, endpoint, provider, model, input_tokens, output_tokens, cost_usd, created_at)
                VALUES (${id}, ${"demo-" + ["analyze","generate-docs","fit-check","interview"][r % 4]},
                        'anthropic', 'claude-sonnet-5', ${inTok}, ${outTok},
                        ${Number(((inTok * 3 + outTok * 15) / 1_000_000).toFixed(6))},
                        now() - ((${r} * 3) || ' days')::interval)`;
    }

    if (c.hired) {
      await sql`INSERT INTO job_application (user_id, job_title, company, status, hired_at)
                VALUES (${id}, 'Warehouse Associate', 'Demo Logistics Co', 'hired', now() - interval '9 days')
                ON CONFLICT DO NOTHING`;
    }
  }
  console.log(`           seeded`);
}

if (checkOnly) {
  console.log(`\n--check only. Nothing written.\n`);
} else {
  const [{ n }] = await sql`
    SELECT COUNT(*)::int AS n FROM access_code WHERE partner_name LIKE ${"%" + DEMO_SUFFIX}`;
  console.log(`\n  ${n} demo organizations now present, all marked ${DEMO_SUFFIX}.`);
  console.log(`  Real-vs-demo: partner_name LIKE '%${DEMO_SUFFIX}' identifies every one.\n`);
}
