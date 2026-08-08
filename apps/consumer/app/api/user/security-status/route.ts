import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { Pool } from "@neondatabase/serverless";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

/** Lightweight snapshot for the Settings > Security panel. */
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const client = await pool.connect();
  try {
    const r = await client.query(
      `SELECT (password_hash IS NOT NULL) AS has_password,
              password_updated_at,
              two_factor_enabled
         FROM users WHERE id = $1`,
      [session.user.id]
    );
    const row = r.rows[0] || {};
    return NextResponse.json({
      hasPassword: !!row.has_password,
      passwordUpdatedAt: row.password_updated_at || null,
      twoFactorEnabled: !!row.two_factor_enabled,
    });
  } finally {
    client.release();
  }
}
