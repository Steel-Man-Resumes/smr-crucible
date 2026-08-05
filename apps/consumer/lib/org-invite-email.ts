/**
 * Org-invite email machinery: mint a magic link the standard Auth.js resend
 * callback will accept, build the two email bodies, send via Resend.
 *
 * The link is hand-minted the same way the password-reset flow hand-mints its
 * token, but stored EXACTLY as @auth/core's email flow stores it (identifier =
 * normalized email, token = sha256 hex of `${raw}${AUTH_SECRET}`), so the
 * invitee walks through the normal /api/auth/callback/resend door -- no custom
 * acceptance route, and the login page's own magic-link emails are untouched.
 * Verified against the installed @auth/core 0.41.3 send-token/callback source;
 * re-check that pairing if next-auth gets a major bump (Next 15 upgrade).
 *
 * Invite links live 7 days (the callback honors the DB row's expires, not the
 * provider maxAge) because invitees open these on their own clock -- a 24h
 * login link is fine, a 24h invitation is a support ticket.
 */

import crypto from "crypto";
import { query } from "@crucible/core";

const INVITE_TTL_DAYS = 7;

function sha256Hex(message: string): string {
  return crypto.createHash("sha256").update(message).digest("hex");
}

/** Mint a 7-day magic link for `email` that signs them straight in. */
export async function mintInviteMagicLink(
  email: string,
  origin: string
): Promise<string> {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET missing -- cannot mint invite link");
  const raw = crypto.randomBytes(32).toString("hex");
  await query(
    `INSERT INTO verification_token (identifier, token, expires)
     VALUES ($1, $2, NOW() + ($3::text || ' days')::interval)`,
    [email, sha256Hex(`${raw}${secret}`), String(INVITE_TTL_DAYS)]
  );
  const params = new URLSearchParams({
    callbackUrl: `${origin}/dashboard`,
    token: raw,
    email,
  });
  return `${origin}/api/auth/callback/resend?${params}`;
}

function firstName(name: string | null | undefined): string {
  const n = (name || "").trim();
  return n ? n.split(/\s+/)[0] : "there";
}

interface EmailContent {
  subject: string;
  html: string;
  text: string;
}

/** The welcome for a brand-new invitee: one click and they are signed in. */
export function buildInviteEmail(opts: {
  inviteeName: string | null;
  inviterName: string | null;
  orgName: string;
  url: string;
  origin: string;
}): EmailContent {
  const hello = firstName(opts.inviteeName);
  const inviter = opts.inviterName ? `${opts.inviterName} at ${opts.orgName}` : opts.orgName;
  const loginUrl = `${opts.origin}/login`;
  const subject = `${opts.orgName} set up your Steel Man Resumes account`;
  const text =
    `Hi ${hello},\n\n` +
    `${inviter} set up a free Steel Man Resumes account for you. ` +
    `It gives you tools to build a resume that tells your story with strength, ` +
    `find real job openings, and get ready for interviews.\n\n` +
    `Open your account (no password needed):\n${opts.url}\n\n` +
    `This link works for ${INVITE_TTL_DAYS} days and signs you in directly. ` +
    `If it stops working, go to ${loginUrl}, enter this email address, and ` +
    `choose "Email me a sign-in link."\n\n` +
    `Steel Man Resumes -- Truth. Told Strong.\n` +
    `You received this because ${inviter} added you to their program.`;
  const html = `
    <div style="font-family:Arial,sans-serif;line-height:1.5;color:#1c1c1a;max-width:520px">
      <h1 style="font-size:22px;margin:0 0 12px">Your account is ready</h1>
      <p>Hi ${hello},</p>
      <p>${inviter} set up a free Steel Man Resumes account for you. It gives you
      tools to build a resume that tells your story with strength, find real job
      openings, and get ready for interviews.</p>
      <p style="margin:24px 0">
        <a href="${opts.url}" style="background:#4a6741;color:white;padding:12px 18px;border-radius:10px;text-decoration:none;font-weight:700">Open your account</a>
      </p>
      <p style="font-size:13px;color:#666">No password needed -- the button signs you in directly. If it does not work, copy and paste this link:</p>
      <p style="font-size:13px;word-break:break-all;color:#4a6741">${opts.url}</p>
      <p style="font-size:13px;color:#666">This link works for ${INVITE_TTL_DAYS} days. If it stops working, go to
      <a href="${loginUrl}" style="color:#4a6741">${loginUrl}</a>, enter this email address, and choose "Email me a sign-in link."</p>
      <p style="font-size:12px;color:#6d736d;margin-top:32px">Steel Man Resumes -- Truth. Told Strong.<br>
      You received this because ${inviter} added you to their program.</p>
    </div>
  `;
  return { subject, html, text };
}

/** The notice for someone who already had an account and got attached. */
export function buildAddedEmail(opts: {
  inviteeName: string | null;
  inviterName: string | null;
  orgName: string;
  origin: string;
}): EmailContent {
  const hello = firstName(opts.inviteeName);
  const inviter = opts.inviterName ? `${opts.inviterName} at ${opts.orgName}` : opts.orgName;
  const loginUrl = `${opts.origin}/login`;
  const subject = `You are connected to ${opts.orgName} on Steel Man Resumes`;
  const text =
    `Hi ${hello},\n\n` +
    `${inviter} connected your existing Steel Man Resumes account to their organization. ` +
    `Your account and your work are unchanged, and your privacy rules stay the same: ` +
    `they only ever see progress you choose to share from your Settings -- never your ` +
    `resume text, disclosure plans, or practice answers.\n\n` +
    `Sign in any time: ${loginUrl}\n\n` +
    `Steel Man Resumes -- Truth. Told Strong.`;
  const html = `
    <div style="font-family:Arial,sans-serif;line-height:1.5;color:#1c1c1a;max-width:520px">
      <h1 style="font-size:22px;margin:0 0 12px">You are connected to ${opts.orgName}</h1>
      <p>Hi ${hello},</p>
      <p>${inviter} connected your existing Steel Man Resumes account to their organization.
      Your account and your work are unchanged, and your privacy rules stay the same: they
      only ever see progress you choose to share from your Settings -- never your resume
      text, disclosure plans, or practice answers.</p>
      <p style="margin:24px 0">
        <a href="${loginUrl}" style="background:#4a6741;color:white;padding:12px 18px;border-radius:10px;text-decoration:none;font-weight:700">Sign in</a>
      </p>
      <p style="font-size:13px;word-break:break-all;color:#4a6741">${loginUrl}</p>
      <p style="font-size:12px;color:#6d736d;margin-top:32px">Steel Man Resumes -- Truth. Told Strong.</p>
    </div>
  `;
  return { subject, html, text };
}

/**
 * Send via Resend. Throws on any failure -- silent email failure doctrine:
 * the caller must surface it, never report success on an unsent invite.
 * Returns the Resend email id so delivery can be verified.
 */
export async function sendOrgEmail(to: string, content: EmailContent): Promise<string> {
  const resendKey = process.env.AUTH_RESEND_KEY || process.env.RESEND_API_KEY;
  if (!resendKey) throw new Error("Resend API key missing -- invite email not sent");
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
      subject: content.subject,
      html: content.html,
      text: content.text,
    }),
  });
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`Resend send failed: ${res.status} ${detail.slice(0, 300)}`);
  }
  const data = (await res.json()) as { id?: string };
  console.log(`org-invite email queued to ${to} (resend id ${data.id || "unknown"})`);
  return data.id || "";
}
