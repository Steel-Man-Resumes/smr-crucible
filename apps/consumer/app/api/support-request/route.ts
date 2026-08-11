/**
 * POST /api/support-request -- Help & Feedback intake (Phase 8.1).
 *
 * Evolves the original "Message Troy" box into the single submit path for all
 * five Help modes (bug / confusing / help / idea / message). The DB row is the
 * source of truth; the Resend notify to Troy is best-effort and LINK-ONLY (it
 * carries no message text or excerpt -- no-sensitive-content doctrine).
 *
 * Authenticated only; capped at 5/day per user (action "support").
 *
 * OPT-IN context: when includeContext is true, the SERVER derives the debug
 * context (page + tier from the DB + the user's recent decision ids). A
 * client-supplied context blob is never trusted for anything sensitive.
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
  const includeContext = body.includeContext === true;
  // The old box sent no category; default it to "message" (Message for Troy).
  let category = String(body.category || "message");

  if (!message) {
    return NextResponse.json({ error: "Write a short message first." }, { status: 400 });
  }

  const {
    incrementUserUsage,
    createSupportRequest,
    isValidSupportCategory,
    getUserDecisions,
    getOne,
  } = await import("@crucible/core");

  if (!isValidSupportCategory(category)) category = "message";

  const count = await incrementUserUsage(userId, "support");
  if (count > DAILY_CAP) {
    return NextResponse.json(
      { error: "You've sent the maximum messages for today. Troy reads every one -- give him a day to get back to you." },
      { status: 429 }
    );
  }

  const email = session?.user?.email ?? null;

  // OPT-IN context, SERVER-derived. Never trust the client for tier/decisions.
  let context: Record<string, unknown> = {};
  if (includeContext) {
    let tier: string | null = null;
    let decisionIds: string[] = [];
    try {
      const row = await getOne<{ tier: string }>(
        `SELECT tier FROM users WHERE id = $1`,
        [userId]
      );
      tier = row?.tier ?? null;
      const decisions = await getUserDecisions(userId, 3);
      decisionIds = decisions.map((d) => d.id);
    } catch {
      // Context is a best-effort aid; never fail the submit over it.
    }
    context = {
      page: page || null,
      tier,
      decisionIds,
    };
  }

  const row = await createSupportRequest({
    userId,
    email,
    category: category as never,
    message,
    page: page || null,
    context,
    threadExcerpt: threadExcerpt || null,
  });

  // Best-effort notify -- LINK ONLY. No message text, no excerpt in the body.
  // The admin inbox is where the content is read. SUPPORT_NOTIFY_EMAIL must be
  // set in the environment (kept out of this public repo).
  const resendKey = process.env.RESEND_API_KEY || process.env.AUTH_RESEND_KEY;
  const to = process.env.SUPPORT_NOTIFY_EMAIL;
  if (!to) {
    console.warn("SUPPORT_NOTIFY_EMAIL not set -- support request stored, notify skipped");
  }
  if (resendKey && to) {
    const shortId = row.id.slice(0, 8);
    const adminUrl =
      (process.env.APP_URL || "https://steelmanresumes.com").replace(/\/$/, "") +
      "/dashboard/admin#support";
    try {
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
          subject: `New ${category} feedback (#${shortId})`,
          text:
            `New ${category} feedback (#${shortId}).\n\n` +
            `Open the admin inbox to read it: ${adminUrl}\n\n` +
            `This notice carries no message content on purpose.`,
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

  return NextResponse.json({ id: row.id, status: "received" });
}
