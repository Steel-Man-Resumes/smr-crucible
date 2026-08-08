import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { Pool } from "@neondatabase/serverless";
import { deviceLabel } from "@/lib/security-email";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

/** GET: the caller's active devices (this one marked current). */
export async function GET() {
  const session = await auth();
  const userId = session?.user?.id;
  const currentJti = (session?.user as any)?.sid as string | undefined;
  if (!userId) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const client = await pool.connect();
  try {
    const r = await client.query(
      `SELECT jti, user_agent, approx_location, created_at, last_seen_at
         FROM user_session
        WHERE user_id = $1 AND revoked_at IS NULL
        ORDER BY last_seen_at DESC`,
      [userId]
    );
    const sessions = r.rows.map((row) => ({
      jti: row.jti,
      device: deviceLabel(row.user_agent),
      location: row.approx_location || null,
      lastSeenAt: row.last_seen_at,
      createdAt: row.created_at,
      current: row.jti === currentJti,
    }));
    return NextResponse.json({ sessions });
  } finally {
    client.release();
  }
}

/** POST { action: "revoke", jti } | { action: "revoke_others" }. */
export async function POST(req: Request) {
  const session = await auth();
  const userId = session?.user?.id;
  const currentJti = (session?.user as any)?.sid as string | undefined;
  if (!userId) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const action = body?.action;

  const client = await pool.connect();
  try {
    if (action === "revoke_others") {
      await client.query(
        `UPDATE user_session SET revoked_at = now()
          WHERE user_id = $1 AND revoked_at IS NULL AND jti <> $2`,
        [userId, currentJti || ""]
      );
      return NextResponse.json({ ok: true });
    }
    if (action === "revoke") {
      const jti = String(body?.jti || "");
      if (!jti) return NextResponse.json({ error: "jti required" }, { status: 400 });
      // Scoped to the caller: you can only revoke your own sessions.
      await client.query(
        `UPDATE user_session SET revoked_at = now()
          WHERE user_id = $1 AND jti = $2 AND revoked_at IS NULL`,
        [userId, jti]
      );
      return NextResponse.json({ ok: true, selfRevoked: jti === currentJti });
    }
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } finally {
    client.release();
  }
}
