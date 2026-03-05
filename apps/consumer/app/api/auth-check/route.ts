/**
 * Auth Health Check — Diagnose Configuration errors.
 * Returns which auth components are working.
 * No sensitive data exposed.
 */

import { NextResponse } from "next/server";
import { Pool } from "@neondatabase/serverless";

export async function GET() {
  const checks: Record<string, string> = {};

  // 1. Check env vars exist (not their values)
  checks.AUTH_SECRET = process.env.AUTH_SECRET ? "set" : "MISSING";
  checks.AUTH_RESEND_KEY = process.env.AUTH_RESEND_KEY ? "set" : "MISSING";
  checks.DATABASE_URL = process.env.DATABASE_URL ? "set" : "MISSING";
  checks.AUTH_EMAIL_FROM = process.env.AUTH_EMAIL_FROM || "default (onboarding@resend.dev)";

  // 2. Check database connection + auth tables
  if (process.env.DATABASE_URL) {
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    try {
      const tables = ["users", "accounts", "sessions", "verification_token"];
      for (const table of tables) {
        try {
          const r = await pool.query(`SELECT COUNT(*) FROM ${table}`);
          checks[`table_${table}`] = `ok (${r.rows[0].count} rows)`;
        } catch (e: any) {
          checks[`table_${table}`] = `ERROR: ${e.message}`;
        }
      }
    } catch (e: any) {
      checks.database = `CONNECTION ERROR: ${e.message}`;
    } finally {
      await pool.end();
    }
  }

  // 3. Check Resend API key validity + domain status
  if (process.env.AUTH_RESEND_KEY) {
    try {
      const res = await fetch("https://api.resend.com/domains", {
        headers: { Authorization: `Bearer ${process.env.AUTH_RESEND_KEY}` },
      });
      if (res.ok) {
        const data = await res.json();
        checks.resend_api = "valid";
        checks.resend_domains = JSON.stringify(
          data.data?.map((d: any) => ({ name: d.name, status: d.status })) || "none"
        );
      } else {
        checks.resend_api = `ERROR: ${res.status} ${res.statusText}`;
      }
    } catch (e: any) {
      checks.resend_api = `ERROR: ${e.message}`;
    }
  }

  // 4. Check AUTH_TRUST_HOST
  checks.AUTH_TRUST_HOST = process.env.AUTH_TRUST_HOST || "NOT SET";

  // 5. Check access_code table
  if (process.env.DATABASE_URL) {
    const pool2 = new Pool({ connectionString: process.env.DATABASE_URL });
    try {
      const r = await pool2.query(`SELECT code, partner_name, tier, is_active FROM access_code`);
      checks.access_codes = r.rows.length > 0
        ? JSON.stringify(r.rows.map((c: any) => `${c.code} (${c.tier})`))
        : "NONE — codes not seeded";
    } catch (e: any) {
      checks.access_codes = `ERROR: ${e.message}`;
    } finally {
      await pool2.end();
    }
  }

  return NextResponse.json(checks);
}
