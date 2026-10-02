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

const MAX_FIELD = 60_000;

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

async function handlePost(request: Request) {
  if (!originAllowed(request.headers.get("origin"), request.url)) {
    return NextResponse.json({ error: "Invalid request" }, { status: 403 });
  }

  const resendKey = process.env.RESEND_API_KEY || process.env.AUTH_RESEND_KEY;
  if (!resendKey) {
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
  const session = await auth().catch(() => null);
  const sessionEmail = session?.user?.email?.toLowerCase().trim();
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

  const resumeText = String(body.resumeText || "").slice(0, MAX_FIELD);
  const coverLetterText = String(body.coverLetterText || "").slice(0, MAX_FIELD);
  const headline = String(body.narrativeHeadline || "").slice(0, 500);
  const summary = String(body.narrativeSummary || "").slice(0, 5000);

  if (!resumeText.trim()) {
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

  const sections: string[] = [];
  if (headline || summary) {
    sections.push(
      `<h2 style="margin:24px 0 8px;font-size:18px;color:#1c1e1b;">Your story</h2>` +
        (headline ? `<p style="font-weight:bold;color:#1c1e1b;">${esc(headline)}</p>` : "") +
        (summary ? `<p style="color:#4f554f;line-height:1.6;">${esc(summary)}</p>` : "")
    );
  }
  sections.push(
    `<h2 style="margin:24px 0 8px;font-size:18px;color:#1c1e1b;">Your resume</h2>` +
      `<pre style="white-space:pre-wrap;font-family:Georgia,serif;font-size:14px;color:#1c1e1b;background:#f5f6f4;padding:16px;border:1px solid #d3d8d1;">${esc(resumeText)}</pre>`
  );
  if (coverLetterText.trim()) {
    sections.push(
      `<h2 style="margin:24px 0 8px;font-size:18px;color:#1c1e1b;">Your cover letter</h2>` +
        `<p style="color:#6d736d;font-size:12px;">Edit this for every job. That is why we send it as text you can copy instead of a locked file.</p>` +
        `<pre style="white-space:pre-wrap;font-family:Georgia,serif;font-size:14px;color:#1c1e1b;background:#f5f6f4;padding:16px;border:1px solid #d3d8d1;">${esc(coverLetterText)}</pre>`
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
      console.error("email-package letter opt-in failed:", err);
    }
  }
  const unsubUrl = letterToken
    ? `https://www.steelmanresumes.com/unsubscribe?token=${letterToken}`
    : null;
  const mailingAddress =
    (process.env.MAILING_ADDRESS || "").trim() || "Steel Man Resumes, Libby, Montana";

  const html =
    `<div style="max-width:640px;margin:0 auto;font-family:'Segoe UI',Arial,sans-serif;padding:24px;">` +
    `<h1 style="font-size:22px;color:#1c1e1b;">You did the work. Here it is.</h1>` +
    `<p style="color:#4f554f;line-height:1.6;">This is everything you built in The Forge. It is yours. Print it, ` +
    `forward it, use it. When you are ready for the next step (finding real jobs, ` +
    `tailoring this resume to them, practicing the hard questions), your free ` +
    `account in The Refinery is waiting at ` +
    `<a href="https://refinery.steelmanresumes.com/login" style="color:#9b6d1d;">refinery.steelmanresumes.com</a>.</p>` +
    sections.join("") +
    (unsubUrl
      ? `<p style="color:#6d736d;font-size:12px;margin-top:32px;">Steel Man Resumes<br>Truth. Told Strong.<br>` +
        `You received this because you asked for your Forge package at forge.steelmanresumes.com, ` +
        `and you also asked for Troy's letter, so that's coming too. Changed your mind? ` +
        `<a href="${unsubUrl}" style="color:#9b6d1d;">Unsubscribe</a> in one click.<br>${esc(mailingAddress)}</p>`
      : `<p style="color:#6d736d;font-size:12px;margin-top:32px;">Steel Man Resumes<br>Truth. Told Strong.<br>` +
        `You received this because you asked for your Forge package at forge.steelmanresumes.com. ` +
        `We will not email you again unless you ask. You should ask, though: we keep a fresh list of ` +
        `employers that hire people with records, real openings, and insights that move your search forward. ` +
        `Asking takes one step: create your free account at ` +
        `<a href="https://refinery.steelmanresumes.com/login" style="color:#9b6d1d;">refinery.steelmanresumes.com</a>.</p>`) +
    `</div>`;

  const text =
    `You did the work. Here it is.\n\n` +
    (headline ? `${headline}\n\n` : "") +
    (summary ? `${summary}\n\n` : "") +
    `=== YOUR RESUME ===\n\n${resumeText}\n\n` +
    (coverLetterText.trim() ? `=== YOUR COVER LETTER ===\n\n${coverLetterText}\n\n` : "") +
    `Next step: your free Refinery account at https://refinery.steelmanresumes.com/login\n\n` +
    (unsubUrl
      ? `You also asked for Troy's letter, so that's coming too. Changed your mind? Unsubscribe: ${unsubUrl}\n${mailingAddress}\n`
      : `We will not email you again unless you ask. You should ask, though: we keep a fresh list of ` +
        `employers that hire people with records, real openings, and insights that move your search forward. ` +
        `Asking takes one step: create your free account at the link above.\n`);

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
        to: email,
        subject: "Your resume package from The Forge",
        html,
        text,
      }),
    });

    if (!res.ok) {
      const detail = await res.text();
      console.error("email-package send failed:", res.status, detail);
      return NextResponse.json(
        { error: "We couldn't send that email. Download your documents instead. They're right on this page." },
        { status: 502 }
      );
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("email-package error:", err);
    return NextResponse.json(
      { error: "We couldn't send that email. Download your documents instead." },
      { status: 502 }
    );
  }
}

export const POST = withRateLimit(handlePost, {
  mode: "ip",
  endpoint: "email-package",
});
