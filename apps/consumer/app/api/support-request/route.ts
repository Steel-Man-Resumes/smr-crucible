/**
 * POST /api/support-request -- "Message Troy" escalation (10x wave item 8).
 *
 * The DB row is the source of truth (listed on the admin panel); the Resend
 * notify to Troy is best-effort and its failure never fails the request
 * (silent-email-failure doctrine: never trust send success alone).
 * Authenticated only; capped at 5/day per user.
 */

import { NextResponse } from "next/server";
import { auth } from "@/auth";

export const maxDuration = 10;

const DAILY_CAP = 5;

export async function POST(request: Request) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const contentLength = request.headers.get("content-length");
  if (contentLength && parseInt(contentLength, 10) > 100_000) {
    return NextResponse.json({ error: "Request too large" }, { status: 413 });
  }

  const body = await request.json().catch(() => ({}));
  const message = String(body.message || "").trim().slice(0, 2000);
  const threadExcerpt = String(body.threadExcerpt || "").slice(0, 6000);
  const page = String(body.page || "").slice(0, 100);

  if (!message) {
    return NextResponse.json({ error: "Write a short message first." }, { status: 400 });
  }

  const { incrementUserUsage, insert } = await import("@crucible/core");

  const count = await incrementUserUsage(userId, "support");
  if (count > DAILY_CAP) {
    return NextResponse.json(
      { error: "You've sent the maximum messages for today. Troy reads every one -- give him a day to get back to you." },
      { status: 429 }
    );
  }

  const email = session?.user?.email ?? null;
  const name = session?.user?.name ?? "A user";

  const row = (await insert("support_request", {
    user_id: userId,
    email,
    message,
    thread_excerpt: threadExcerpt || null,
    page: page || null,
    status: "new",
  })) as { id: string };

  // Best-effort notify. The admin panel list is the reliable surface.
  const resendKey = process.env.RESEND_API_KEY || process.env.AUTH_RESEND_KEY;
  if (resendKey) {
    try {
      const to = process.env.SUPPORT_NOTIFY_EMAIL || "steelmanresumes@gmail.com";
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${resendKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from:
            process.env.AUTH_EMAIL_FROM ||
            "Steel Man Resumes <noreply@steelmanresumes.com>",
          to,
          reply_to: email || undefined,
          subject: `Support request from ${name}`,
          text:
            `${name} (${email || "no email on file"}) sent a message from the Refinery` +
            (page ? ` (page: ${page})` : "") +
            `:\n\n${message}\n\n` +
            (threadExcerpt ? `--- Recent conversation ---\n${threadExcerpt}\n\n` : "") +
            `Reply to the user by email. This request is also listed on /dashboard/admin.`,
        }),
      });
      if (!res.ok) {
        console.error("support-request notify failed:", res.status, await res.text());
      } else {
        const sent = await res.json().catch(() => null);
        console.log("support-request notify sent:", sent?.id ?? "(no id)");
      }
    } catch (err) {
      console.error("support-request notify error:", err);
    }
  }

  return NextResponse.json({ ok: true, id: row.id });
}
