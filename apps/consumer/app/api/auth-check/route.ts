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

  // 3. Check Resend API key validity
  if (process.env.AUTH_RESEND_KEY) {
    try {
      const res = await fetch("https://api.resend.com/domains", {
        headers: { Authorization: `Bearer ${process.env.AUTH_RESEND_KEY}` },
      });
      checks.resend_api = res.ok ? "valid" : `ERROR: ${res.status} ${res.statusText}`;
    } catch (e: any) {
      checks.resend_api = `ERROR: ${e.message}`;
    }
  }

  return NextResponse.json(checks);
}
