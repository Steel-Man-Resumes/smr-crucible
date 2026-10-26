import { NextResponse } from "next/server";
import { effectiveAuth as auth } from "@/lib/effective-auth";
import { settingsRefusal } from "@/lib/settings-guard";
import { Pool } from "@neondatabase/serverless";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

/** Lightweight snapshot for the Settings > Security panel. */
export async function GET() {
  const session = await auth();
  { const refused = settingsRefusal(session, "private", "read"); if (refused) return refused; }
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
    const row = r.rows[0];
    if (!row) return NextResponse.json({ error: "Sign in again." }, { status: 401 });
    return NextResponse.json({
      userId: session.user.id,
      hasPassword: !!row.has_password,
      passwordUpdatedAt: row.password_updated_at || null,
      twoFactorEnabled: !!row.two_factor_enabled,
    }, { headers: { "Cache-Control": "no-store" } });
  } finally {
    client.release();
  }
}
