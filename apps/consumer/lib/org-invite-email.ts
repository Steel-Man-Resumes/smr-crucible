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
import { query, isUndeliverableEmail } from "@crucible/core";
import { EMAIL_LINK_PAGE } from "@/lib/sign-in-link";

const INVITE_TTL_DAYS = 7;

function sha256Hex(message: string): string {
  return crypto.createHash("sha256").update(message).digest("hex");
}

/**
 * Mint a magic link for `email` that signs them straight in. 7 days by
 * default; staff invitations pass 14 so the link lives as long as the
 * invitation does (migration 100, STAFF_INVITE_TTL_DAYS).
 */
export async function mintInviteMagicLink(
  email: string,
  origin: string,
  ttlDays: number = INVITE_TTL_DAYS,
  /** Where the link lands after sign-in (a path on this site). Staff invitations land on /dashboard/invites. */
  landingPath: string = "/dashboard"
): Promise<string> {
  const days = Number.isInteger(ttlDays) && ttlDays >= 1 && ttlDays <= 14 ? ttlDays : INVITE_TTL_DAYS;
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET missing -- cannot mint invite link");
  const raw = crypto.randomBytes(32).toString("hex");
  await query(
    `INSERT INTO verification_token (identifier, token, expires)
     VALUES ($1, $2, NOW() + ($3::text || ' days')::interval)`,
    [email, sha256Hex(`${raw}${secret}`), String(days)]
  );
  const params = new URLSearchParams({
    callbackUrl: `${origin}${/^\/dashboard(\/[a-z-]+)?$/.test(landingPath) ? landingPath : "/dashboard"}`,
    token: raw,
    email,
  });
  // The invitee lands on the "Finish signing in" page, which then goes to
  // /api/auth/callback/resend with these same parameters. A mail scanner that
  // opens the link does not use up the invitation (lib/sign-in-link.ts).
  return `${origin}${EMAIL_LINK_PAGE}?${params}`;
}

/**
 * HTML-escape a value placed in an email body or attribute (security review
 * 1, SF-3). Names and organization names are typed by people; a name like
 * <a href=...> must arrive as text, never as a link from our sender address.
 */
export function esc(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
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
    `Steel Man Resumes\nTruth. Told Strong.\n` +
    `You received this because ${inviter} added you to their program.`;
  const html = `
    <div style="font-family:Arial,sans-serif;line-height:1.5;color:#1c1c1a;max-width:520px">
      <h1 style="font-size:22px;margin:0 0 12px">Your account is ready</h1>
      <p>Hi ${esc(hello)},</p>
      <p>${esc(inviter)} set up a free Steel Man Resumes account for you. It gives you
      tools to build a resume that tells your story with strength, find real job
      openings, and get ready for interviews.</p>
      <p style="margin:24px 0">
        <a href="${esc(opts.url)}" style="background:#4a6741;color:white;padding:12px 18px;border-radius:10px;text-decoration:none;font-weight:700">Open your account</a>
      </p>
      <p style="font-size:13px;color:#666">No password needed. The button signs you in directly. If it does not work, copy and paste this link:</p>
      <p style="font-size:13px;word-break:break-all;color:#4a6741">${esc(opts.url)}</p>
      <p style="font-size:13px;color:#666">This link works for ${esc(INVITE_TTL_DAYS)} days. If it stops working, go to
      <a href="${esc(loginUrl)}" style="color:#4a6741">${esc(loginUrl)}</a>, enter this email address, and choose "Email me a sign-in link."</p>
      <p style="font-size:12px;color:#6d736d;margin-top:32px">Steel Man Resumes<br>Truth. Told Strong.<br>
      You received this because ${esc(inviter)} added you to their program.</p>
    </div>
  `;
  return { subject, html, text };
}

/** The notice for someone who already had an account and got attached. */
/** The welcome for someone joining an organization's STAFF. Not a job seeker's email. */
export function buildStaffInviteEmail(opts: {
  inviteeName: string | null;
  inviterName: string | null;
  orgName: string;
  roleLabel: string;
  url: string;
  origin: string;
  /** How long the link works. Default 7 (the participant invite's length). */
  linkDays?: number;
  /** A staff invitation the person still has to accept (migration 100), not an owner being set. */
  invitation?: boolean;
}): EmailContent {
  const hello = firstName(opts.inviteeName);
  const inviter = opts.inviterName || opts.orgName;
  const linkDays = opts.linkDays ?? INVITE_TTL_DAYS;
  const loginUrl = `${opts.origin}/login`;
  const subject = opts.invitation
    ? `${opts.orgName} invited you to their team on Steel Man Resumes`
    : `${opts.orgName} added you to their team on Steel Man Resumes`;
  const body = opts.invitation
    ? `${inviter} invited you to join the ${opts.orgName} team as ${opts.roleLabel}. ` +
      `The link opens your account; then you say yes or no. Nothing changes unless you say yes. ` +
      `On the team you work with the people your organization serves: your caseload, ` +
      `your case notes, and anything a participant chooses to share with you.`
    : `${inviter} added you to the ${opts.orgName} team as ${opts.roleLabel}. ` +
      `This is where your organization works with the people it serves: your caseload, ` +
      `your case notes, and anything a participant chooses to share with you.`;
  const privacy =
    `One thing to know before you start: participants decide what you can see, one item at a time, ` +
    `and they can see each time you open something they shared.`;
  const text =
    `Hi ${hello},\n\n${body}\n\n${privacy}\n\n` +
    `Open your account (no password needed):\n${opts.url}\n\n` +
    `This link works for ${linkDays} days. If it stops working, go to ${loginUrl}, ` +
    `enter this email address, and choose "Email me a sign-in link."\n\n` +
    `Steel Man Resumes\nTruth. Told Strong.`;
  const html = `
    <div style="font-family:Arial,sans-serif;line-height:1.5;color:#1c1c1a;max-width:520px">
      <h1 style="font-size:22px;margin:0 0 12px">You are on the ${esc(opts.orgName)} team</h1>
      <p>Hi ${esc(hello)},</p>
      <p>${esc(body)}</p>
      <p>${esc(privacy)}</p>
      <p style="margin:24px 0">
        <a href="${esc(opts.url)}" style="background:#4a6741;color:white;padding:12px 18px;border-radius:10px;text-decoration:none;font-weight:700">Open your account</a>
      </p>
      <p style="font-size:13px;color:#666">No password needed. If the button does not work, copy and paste this link:</p>
      <p style="font-size:13px;word-break:break-all;color:#4a6741">${esc(opts.url)}</p>
      <p style="font-size:13px;color:#666">This link works for ${esc(linkDays)} days. After that, go to
      <a href="${esc(loginUrl)}" style="color:#4a6741">${esc(loginUrl)}</a>, enter this email address, and choose "Email me a sign-in link."</p>
      <p style="font-size:12px;color:#6d736d;margin-top:32px">Steel Man Resumes<br>Truth. Told Strong.</p>
    </div>
  `;
  return { subject, html, text };
}

/**
 * Someone who ALREADY has an account, invited to an organization's staff
 * (migration 100). Nothing changes until they sign in and accept, so the email
 * says exactly that. It names the organization and the inviter, nothing else.
 */
export function buildStaffInvitationEmail(opts: {
  inviteeName: string | null;
  inviterName: string | null;
  orgName: string;
  roleLabel: string;
  origin: string;
  days: number;
}): EmailContent {
  const hello = firstName(opts.inviteeName);
  const inviter = opts.inviterName ? `${opts.inviterName} at ${opts.orgName}` : opts.orgName;
  const answerUrl = `${opts.origin}/dashboard/invites`;
  const subject = `${opts.orgName} invited you to their team on Steel Man Resumes`;
  const body =
    `${inviter} invited you to join the ${opts.orgName} team as ${opts.roleLabel}. ` +
    `Nothing changes unless you say yes. If you join, you work with the people ${opts.orgName} serves: ` +
    `your caseload, your case notes, and anything a participant chooses to share with you.`;
  const text =
    `Hi ${hello},\n\n${body}\n\n` +
    `Sign in to say yes or no: ${answerUrl}\n\n` +
    `This invitation is open for ${opts.days} days.\n\n` +
    `Steel Man Resumes\nTruth. Told Strong.`;
  const html = `
    <div style="font-family:Arial,sans-serif;line-height:1.5;color:#1c1c1a;max-width:520px">
      <h1 style="font-size:22px;margin:0 0 12px">${esc(opts.orgName)} invited you to their team</h1>
      <p>Hi ${esc(hello)},</p>
      <p>${esc(body)}</p>
      <p style="margin:24px 0">
        <a href="${esc(answerUrl)}" style="background:#4a6741;color:white;padding:12px 18px;border-radius:10px;text-decoration:none;font-weight:700">Sign in to answer</a>
      </p>
      <p style="font-size:13px;word-break:break-all;color:#4a6741">${esc(answerUrl)}</p>
      <p style="font-size:13px;color:#666">This invitation is open for ${esc(opts.days)} days.</p>
      <p style="font-size:12px;color:#6d736d;margin-top:32px">Steel Man Resumes<br>Truth. Told Strong.</p>
    </div>
  `;
  return { subject, html, text };
}

/** A platform admin added an existing account to an organization's staff (support path). */
export function buildStaffAddedEmail(opts: {
  inviteeName: string | null;
  orgName: string;
  roleLabel: string;
  origin: string;
}): EmailContent {
  const hello = firstName(opts.inviteeName);
  const loginUrl = `${opts.origin}/login`;
  const subject = `You are on the ${opts.orgName} team on Steel Man Resumes`;
  const body =
    `Steel Man Resumes support added your account to the ${opts.orgName} team as ${opts.roleLabel}. ` +
    `Your own account and your own work are unchanged. Sign in and the organization's workspace is in your menu. ` +
    `If you did not expect this, reply to this email and we will take it off.`;
  const text = `Hi ${hello},\n\n${body}\n\nSign in: ${loginUrl}\n\nSteel Man Resumes\nTruth. Told Strong.`;
  const html = `
    <div style="font-family:Arial,sans-serif;line-height:1.5;color:#1c1c1a;max-width:520px">
      <h1 style="font-size:22px;margin:0 0 12px">You are on the ${esc(opts.orgName)} team</h1>
      <p>Hi ${esc(hello)},</p>
      <p>${esc(body)}</p>
      <p style="margin:24px 0">
        <a href="${esc(loginUrl)}" style="background:#4a6741;color:white;padding:12px 18px;border-radius:10px;text-decoration:none;font-weight:700">Sign in</a>
      </p>
      <p style="font-size:12px;color:#6d736d;margin-top:32px">Steel Man Resumes<br>Truth. Told Strong.</p>
    </div>
  `;
  return { subject, html, text };
}

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
    `they only ever see progress you choose to share from your Settings. They never see your ` +
    `resume text, disclosure plans, or practice answers.\n\n` +
    `Sign in any time: ${loginUrl}\n\n` +
    `Steel Man Resumes\nTruth. Told Strong.`;
  const html = `
    <div style="font-family:Arial,sans-serif;line-height:1.5;color:#1c1c1a;max-width:520px">
      <h1 style="font-size:22px;margin:0 0 12px">You are connected to ${esc(opts.orgName)}</h1>
      <p>Hi ${esc(hello)},</p>
      <p>${esc(inviter)} connected your existing Steel Man Resumes account to their organization.
      Your account and your work are unchanged, and your privacy rules stay the same: they
      only ever see progress you choose to share from your Settings. They never see your resume
      text, disclosure plans, or practice answers.</p>
      <p style="margin:24px 0">
        <a href="${esc(loginUrl)}" style="background:#4a6741;color:white;padding:12px 18px;border-radius:10px;text-decoration:none;font-weight:700">Sign in</a>
      </p>
      <p style="font-size:13px;word-break:break-all;color:#4a6741">${esc(loginUrl)}</p>
      <p style="font-size:12px;color:#6d736d;margin-top:32px">Steel Man Resumes<br>Truth. Told Strong.</p>
    </div>
  `;
  return { subject, html, text };
}

/**
 * The notice for someone who already has an account and was asked to join an
 * organization (migration 096). Nothing changes until they say yes on the seat
 * page, so the email says exactly that. Neutral on purpose: it names the
 * organization that asked and nothing about anyone else.
 */
export function buildOfferEmail(opts: {
  inviteeName: string | null;
  inviterName: string | null;
  orgName: string;
  origin: string;
}): EmailContent {
  const hello = firstName(opts.inviteeName);
  const inviter = opts.inviterName ? `${opts.inviterName} at ${opts.orgName}` : opts.orgName;
  const seatUrl = `${opts.origin}/seat`;
  const subject = `${opts.orgName} asked you to join them on Steel Man Resumes`;
  const text =
    `Hi ${hello},\n\n` +
    `${inviter} asked to add your Steel Man Resumes account to their organization. ` +
    `Nothing changes unless you say yes. If you join, they only see progress you choose to share ` +
    `from your Settings. They never see your resume text, disclosure plans, or practice answers.\n\n` +
    `Sign in to say yes or no: ${seatUrl}\n\n` +
    `Steel Man Resumes\nTruth. Told Strong.`;
  const html = `
    <div style="font-family:Arial,sans-serif;line-height:1.5;color:#1c1c1a;max-width:520px">
      <h1 style="font-size:22px;margin:0 0 12px">${esc(opts.orgName)} asked you to join</h1>
      <p>Hi ${esc(hello)},</p>
      <p>${esc(inviter)} asked to add your Steel Man Resumes account to their organization.
      Nothing changes unless you say yes. If you join, they only see progress you choose to
      share from your Settings. They never see your resume text, disclosure plans, or practice answers.</p>
      <p style="margin:24px 0">
        <a href="${esc(seatUrl)}" style="background:#4a6741;color:white;padding:12px 18px;border-radius:10px;text-decoration:none;font-weight:700">Sign in to answer</a>
      </p>
      <p style="font-size:13px;word-break:break-all;color:#4a6741">${esc(seatUrl)}</p>
      <p style="font-size:12px;color:#6d736d;margin-top:32px">Steel Man Resumes<br>Truth. Told Strong.</p>
    </div>
  `;
  return { subject, html, text };
}

/**
 * Send via Resend. Throws on any failure -- silent email failure doctrine:
 * the caller must surface it, never report success on an unsent invite.
 * Returns the Resend email id so delivery can be verified.
 */
/** Thrown instead of sending to an address that can never receive mail. */
export class UndeliverableAddressError extends Error {
  constructor() {
    super("undeliverable address: nothing sent");
    this.name = "UndeliverableAddressError";
  }
}

export async function sendOrgEmail(to: string, content: EmailContent): Promise<string> {
  // Never to a reserved test domain (.invalid, .test, .example, example.com):
  // demo and fixture accounts use them, and a send there only bounces.
  if (isUndeliverableEmail(to)) throw new UndeliverableAddressError();
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
  // No recipient address in logs (review 2, N-15): the Resend id is enough to trace a send.
  console.log(`org email queued (resend id ${data.id || "unknown"})`);
  return data.id || "";
}
