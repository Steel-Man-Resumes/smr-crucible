/**
 * Developer impersonation sessions (Troy-only Developer Switcher).
 *
 * POST   { targetUserId, mode: "view"|"assist", reason? } -> start (admin only;
 *        assist REQUIRES a break-glass reason). Sets the signed cookie.
 * GET    -> current session status (target, mode, expiry) for the banner.
 * DELETE { notify?: boolean } -> end session; optional transparency note into
 *        the target's coach chat. Cookie cleared either way.
 *
 * Every start/end is audited in impersonation_session.
 */

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { query, getOne } from "@crucible/core";
import {
  IMPERSONATE_COOKIE,
  IMPERSONATION_MINUTES,
  mintImpersonationToken,
  readImpersonation,
} from "@/lib/impersonation";

async function requireAdmin() {
  const session = await auth();
  if (!session?.user?.id) return null;
  if ((session.user as any).tier !== "admin") return null;
  return session.user as { id: string; name?: string | null };
}

export async function POST(request: Request) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Admins only" }, { status: 403 });

  const body = await request.json().catch(() => ({}));
  const { targetUserId, mode } = body;
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";

  if (!targetUserId || (mode !== "view" && mode !== "assist")) {
    return NextResponse.json({ error: "targetUserId and mode required" }, { status: 400 });
  }
  if (mode === "assist" && reason.length < 5) {
    return NextResponse.json(
      { error: "Assist mode requires a reason (break-glass log)." },
      { status: 400 }
    );
  }
  if (targetUserId === admin.id) {
    return NextResponse.json({ error: "That's already you." }, { status: 400 });
  }

  const target = await getOne<{ id: string; name: string | null; email: string | null }>(
    `SELECT id, name, email FROM users WHERE id = $1`,
    [targetUserId]
  );
  if (!target) return NextResponse.json({ error: "User not found" }, { status: 404 });

  const minutes = IMPERSONATION_MINUTES[mode as "view" | "assist"];
  const rows = await query<{ id: string }>(
    `INSERT INTO impersonation_session (admin_user_id, target_user_id, mode, reason, expires_at)
     VALUES ($1, $2, $3, $4, NOW() + ($5 || ' minutes')::interval)
     RETURNING id`,
    [admin.id, targetUserId, mode, reason || null, String(minutes)]
  );
  const sid = rows[0].id;

  const token = await mintImpersonationToken({
    sid,
    adminId: admin.id,
    targetId: targetUserId,
    mode,
  });

  const res = NextResponse.json({
    ok: true,
    sid,
    mode,
    target: { id: target.id, name: target.name, email: target.email },
    expiresInMinutes: minutes,
  });
  res.cookies.set(IMPERSONATE_COOKIE, token, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: minutes * 60,
    ...(process.env.NODE_ENV === "production"
      ? { domain: ".steelmanresumes.com" }
      : {}),
  });
  return res;
}

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ active: false });
  }
  const imp = await readImpersonation();
  if (!imp || imp.adminId !== session.user.id) {
    return NextResponse.json({ active: false });
  }
  const target = await getOne<{ id: string; name: string | null; email: string | null }>(
    `SELECT id, name, email FROM users WHERE id = $1`,
    [imp.targetId]
  );
  return NextResponse.json({
    active: true,
    mode: imp.mode,
    target,
    expiresAt: imp.exp ? new Date(imp.exp * 1000).toISOString() : null,
  });
}

export async function DELETE(request: Request) {
  const session = await auth();
  const imp = await readImpersonation();
  const body = await request.json().catch(() => ({}));

  if (imp && session?.user?.id === imp.adminId) {
    await query(
      `UPDATE impersonation_session SET ended_at = NOW(), notified_user = $2
        WHERE id = $1 AND ended_at IS NULL`,
      [imp.sid, !!body.notify]
    );

    if (body.notify) {
      // Transparency note into the target's coach chat (walkthrough guardrail).
      const row = await getOne<{ reason: string | null }>(
        `SELECT reason FROM impersonation_session WHERE id = $1`,
        [imp.sid]
      );
      const why = row?.reason ? ` Reason: ${row.reason}.` : "";
      await query(
        `INSERT INTO coach_conversation (user_id, role, content)
         VALUES ($1, 'assistant', $2)`,
        [
          imp.targetId,
          `A quick heads-up for transparency: Troy from Steel Man Resumes accessed your account during a support session to help resolve a technical issue.${why} Every support access like this is logged. Nothing about your resume content was shared with anyone.`,
        ]
      ).catch(() => {});
    }
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set(IMPERSONATE_COOKIE, "", {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 0,
    ...(process.env.NODE_ENV === "production"
      ? { domain: ".steelmanresumes.com" }
      : {}),
  });
  return res;
}
