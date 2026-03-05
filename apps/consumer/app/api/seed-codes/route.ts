/**
 * One-time seed endpoint — insert default access codes.
 * Idempotent: skips codes that already exist.
 * DELETE this route after seeding.
 */

import { NextResponse } from "next/server";
import { Pool } from "@neondatabase/serverless";

const SEED_CODES = [
  {
    code: "SECONDMILE",
    partner_name: "Steel Man Resumes (Admin)",
    tier: "admin",
    daily_limit: null,
    max_redemptions: null,
  },
  {
    code: "PARTNER2026",
    partner_name: "Partner Organization",
    tier: "partner",
    daily_limit: 200,
    max_redemptions: null,
  },
  {
    code: "UNLIMITED2026",
    partner_name: "Unlimited Access",
    tier: "unlimited",
    daily_limit: null,
    max_redemptions: null,
  },
];

export async function POST() {
  if (!process.env.DATABASE_URL) {
    return NextResponse.json({ error: "No DATABASE_URL" }, { status: 500 });
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const results: string[] = [];

  try {
    for (const code of SEED_CODES) {
      try {
        await pool.query(
          `INSERT INTO access_code (code, partner_name, tier, daily_limit, max_redemptions)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (code) DO NOTHING`,
          [code.code, code.partner_name, code.tier, code.daily_limit, code.max_redemptions]
        );
        results.push(`${code.code}: seeded`);
      } catch (e: any) {
        results.push(`${code.code}: ERROR — ${e.message}`);
      }
    }
  } finally {
    await pool.end();
  }

  return NextResponse.json({ results });
}
