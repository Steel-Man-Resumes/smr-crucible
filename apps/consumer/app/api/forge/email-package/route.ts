/**
 * POST /api/forge/email-package
 *
 * "Email me my package" -- delivers the user's Forge output (narrative,
 * resume, cover letter) to their inbox at the moment they finish. Two jobs:
 * the user walks away with their work even if they never sign up, and we
 * hold a real address to nurture them back toward the Refinery.
 *
 * Pre-auth by design (Forge doctrine). Because it sends mail from SMR's
 * domain to an address the caller types, it is guarded (security sweep
 * 2026-09-30, #14):
 * - same-site Origin required (no cross-site or header-less scripted posts);
 * - a signed-in person can only send to their own account email;
 * - per IP per day (withRateLimit, durable ai_usage counter) AND per
 *   recipient per day (same counter, keyed by a hash of the address, never
 *   the address itself);
 * - Cloudflare Turnstile when TURNSTILE_SECRET_KEY is set (enforced for a
 *   missing token only with TURNSTILE_ENFORCE=1, same as signup).
 */

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { forgeSessionUser } from "@/lib/session-policy";
import { incrementIpUsage, getOne } from "@crucible/core";
import { withRateLimit } from "@/lib/withRateLimit";
import { getClientIp } from "@/lib/auth-rate-limit";
import { checkTurnstile, turnstileBlocks } from "@/lib/turnstile";
import {
  EMAIL_PACKAGE_PER_RECIPIENT_PER_DAY,
  RECIPIENT_ENDPOINT,
  originAllowed,
  recipientKey,
} from "@/lib/email-package-guard";
import { buildPackageEmail, clipDocs, packageFrom, resendKey, resendTransport } from "@/lib/email-package-send";

async function handlePost(request: Request) {
  if (!originAllowed(request.headers.get("origin"), request.url)) {
    return NextResponse.json({ error: "Invalid request" }, { status: 403 });
  }

  const key = resendKey();
  if (!key) {
    return NextResponse.json(
      { error: "Email is not configured right now. Download your documents instead." },
      { status: 503 }
    );
  }

  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const email = String(body.email || "").toLowerCase().trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json(
      { error: "Please enter a valid email address." },
      { status: 400 }
    );
  }

  // Signed in: your package goes to your own account address, nobody else's.
  // A session that still owes its two-step code counts as signed out here.
  const session = await auth().catch(() => null);
  const sessionEmail = forgeSessionUser(session)?.email?.toLowerCase().trim();
  if (sessionEmail && email !== sessionEmail) {
    return NextResponse.json(
      { error: "While you're signed in, we can only send this to your account email." },
      { status: 403 }
    );
  }

  const turnstile = await checkTurnstile(body.turnstileToken, getClientIp(request));
  if (turnstileBlocks(turnstile)) {
    return NextResponse.json(
      { error: "Please complete the verification check and try again." },
      { status: 400 }
    );
  }
  if (turnstile === "missing") console.error("email-package: Turnstile token missing (not enforced)");

  const docs = clipDocs(body);
  if (!docs.resumeText.trim()) {
    return NextResponse.json(
      { error: "No resume to send yet. Finish the Forge first." },
      { status: 400 }
    );
  }

  // Durable per-recipient cap, counted before the send so a burst cannot race it.
  const sentToday = await incrementIpUsage(recipientKey(email), RECIPIENT_ENDPOINT);
  if (sentToday > EMAIL_PACKAGE_PER_RECIPIENT_PER_DAY) {
    return NextResponse.json(
      { error: "That address already got its package today. Download your documents instead. They're right on this page." },
      { status: 429 }
    );
  }

  // Troy's letter opt-in (unchecked by default in the UI). Same list as the
  // steelmanresumes.com signup: newsletter_subscriber, source 'forge'. Ticking
  // the box again re-subscribes someone who had unsubscribed. A failure here
  // never blocks the package.
  let letterToken: string | null = null;
  if (body.letter === true) {
    try {
      const row = await getOne<{ unsubscribe_token: string }>(
        `INSERT INTO newsletter_subscriber (email, source) VALUES ($1, 'forge')
         ON CONFLICT (email) DO UPDATE SET unsubscribed_at = NULL,
           source = CASE WHEN newsletter_subscriber.unsubscribed_at IS NULL
                         THEN newsletter_subscriber.source ELSE 'forge' END
         RETURNING unsubscribe_token`,
        [email]
      );
      letterToken = row?.unsubscribe_token ?? null;
    } catch (err) {
      console.error("email-package letter opt-in failed:", (err as { code?: string })?.code || "error");
    }
  }
  const unsubUrl = letterToken
    ? `https://www.steelmanresumes.com/unsubscribe?token=${letterToken}`
    : null;

  const mail = buildPackageEmail(docs, { why: "asked", unsubUrl });
  try {
    const res = await resendTransport(key)({ from: packageFrom(), to: email, ...mail });
    if (!res.ok) {
      // The status only: a provider's error text can quote the address.
      console.error("email-package send failed:", res.status);
      return NextResponse.json(
        { error: "We couldn't send that email. Download your documents instead. They're right on this page." },
        { status: 502 }
      );
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("email-package error:", (err as { name?: string })?.name || "error");
    return NextResponse.json(
      { error: "We couldn't send that email. Download your documents instead." },
      { status: 502 }
    );
  }
}

export const POST = withRateLimit(handlePost, {
  mode: "forge",
  endpoint: "email-package",
});
