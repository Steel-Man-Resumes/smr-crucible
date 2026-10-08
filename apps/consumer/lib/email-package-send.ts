/**
 * The Forge package email: built and sent in one place, used by both senders.
 *
 *   /api/forge/email-package       the person types an address and asks (the
 *                                  Forge before the sign-in wall);
 *   /api/forge/email-package/auto  a FINISHED resume, signed in: sent by itself
 *                                  to the account's own proven address, unless
 *                                  the person turned it off.
 *
 * The transport is passed in, so tests use a mock and never reach a real
 * email provider. Same limits for both senders (lib/email-package-guard.ts).
 */

export const MAX_FIELD = 60_000;

export interface PackageDocs {
  resumeText: string;
  coverLetterText: string;
  headline: string;
  summary: string;
}

export interface PackageMail {
  from: string;
  to: string;
  subject: string;
  html: string;
  text: string;
}

export type MailTransport = (msg: PackageMail) => Promise<{ ok: boolean; status: number }>;

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Clip what the client sent to the sizes the email allows. */
export function clipDocs(body: Record<string, unknown>): PackageDocs {
  return {
    resumeText: String(body.resumeText || "").slice(0, MAX_FIELD),
    coverLetterText: String(body.coverLetterText || "").slice(0, MAX_FIELD),
    headline: String(body.narrativeHeadline || "").slice(0, 500),
    summary: String(body.narrativeSummary || "").slice(0, 5000),
  };
}

export function packageFrom(): string {
  return process.env.AUTH_EMAIL_FROM || "Steel Man Resumes <noreply@steelmanresumes.com>";
}

export function mailingAddress(): string {
  return (process.env.MAILING_ADDRESS || "").trim() || "Steel Man Resumes, Libby, Montana";
}

/**
 * The email. `why` decides the opening and the footer:
 *  - "asked":    the person typed their address on the finish page;
 *  - "finished": sent by itself to the account's own address.
 */
export function buildPackageEmail(
  docs: PackageDocs,
  opts: { why: "asked" | "finished"; unsubUrl?: string | null; address?: string }
): { subject: string; html: string; text: string } {
  const address = opts.address ?? mailingAddress();
  const unsubUrl = opts.unsubUrl ?? null;
  const sections: string[] = [];
  if (docs.headline || docs.summary) {
    sections.push(
      `<h2 style="margin:24px 0 8px;font-size:18px;color:#1c1e1b;">Your story</h2>` +
        (docs.headline ? `<p style="font-weight:bold;color:#1c1e1b;">${esc(docs.headline)}</p>` : "") +
        (docs.summary ? `<p style="color:#4f554f;line-height:1.6;">${esc(docs.summary)}</p>` : "")
    );
  }
  sections.push(
    `<h2 style="margin:24px 0 8px;font-size:18px;color:#1c1e1b;">Your resume</h2>` +
      `<pre style="white-space:pre-wrap;font-family:Georgia,serif;font-size:14px;color:#1c1e1b;background:#f5f6f4;padding:16px;border:1px solid #d3d8d1;">${esc(docs.resumeText)}</pre>`
  );
  if (docs.coverLetterText.trim()) {
    sections.push(
      `<h2 style="margin:24px 0 8px;font-size:18px;color:#1c1e1b;">Your cover letter</h2>` +
        `<p style="color:#6d736d;font-size:12px;">Edit this for every job. That is why we send it as text you can copy instead of a locked file.</p>` +
        `<pre style="white-space:pre-wrap;font-family:Georgia,serif;font-size:14px;color:#1c1e1b;background:#f5f6f4;padding:16px;border:1px solid #d3d8d1;">${esc(docs.coverLetterText)}</pre>`
    );
  }

  const intro =
    opts.why === "finished"
      ? `This is the resume you finished in The Forge. It is yours. Print it, forward it, use it. ` +
        `Your Refinery account has it too, ready to aim at real jobs at ` +
        `<a href="https://refinery.steelmanresumes.com/dashboard" style="color:#9b6d1d;">refinery.steelmanresumes.com</a>.`
      : `This is everything you built in The Forge. It is yours. Print it, ` +
        `forward it, use it. When you are ready for the next step (finding real jobs, ` +
        `tailoring this resume to them, practicing the hard questions), your free ` +
        `account in The Refinery is waiting at ` +
        `<a href="https://refinery.steelmanresumes.com/login" style="color:#9b6d1d;">refinery.steelmanresumes.com</a>.`;

  const footer =
    opts.why === "finished"
      ? `You received this because you finished your resume in The Forge with your Steel Man Resumes account. ` +
        `You can turn these emails off in Settings in The Refinery.<br>${esc(address)}`
      : unsubUrl
        ? `You received this because you asked for your Forge package at forge.steelmanresumes.com, ` +
          `and you also asked for Troy's letter, so that's coming too. Changed your mind? ` +
          `<a href="${unsubUrl}" style="color:#9b6d1d;">Unsubscribe</a> in one click.<br>${esc(address)}`
        : `You received this because you asked for your Forge package at forge.steelmanresumes.com. ` +
          `We will not email you again unless you ask. You should ask, though: we keep a fresh list of ` +
          `employers that hire people with records, real openings, and insights that move your search forward. ` +
          `Asking takes one step: create your free account at ` +
          `<a href="https://refinery.steelmanresumes.com/login" style="color:#9b6d1d;">refinery.steelmanresumes.com</a>.`;

  const html =
    `<div style="max-width:640px;margin:0 auto;font-family:'Segoe UI',Arial,sans-serif;padding:24px;">` +
    `<h1 style="font-size:22px;color:#1c1e1b;">You did the work. Here it is.</h1>` +
    `<p style="color:#4f554f;line-height:1.6;">${intro}</p>` +
    sections.join("") +
    `<p style="color:#6d736d;font-size:12px;margin-top:32px;">Steel Man Resumes<br>Truth. Told Strong.<br>${footer}</p>` +
    `</div>`;

  const text =
    `You did the work. Here it is.\n\n` +
    (docs.headline ? `${docs.headline}\n\n` : "") +
    (docs.summary ? `${docs.summary}\n\n` : "") +
    `=== YOUR RESUME ===\n\n${docs.resumeText}\n\n` +
    (docs.coverLetterText.trim() ? `=== YOUR COVER LETTER ===\n\n${docs.coverLetterText}\n\n` : "") +
    (opts.why === "finished"
      ? `Your Refinery account has this too: https://refinery.steelmanresumes.com/dashboard\n\n` +
        `You received this because you finished your resume in The Forge with your Steel Man Resumes account. ` +
        `You can turn these emails off in Settings in The Refinery.\n${address}\n`
      : `Next step: your free Refinery account at https://refinery.steelmanresumes.com/login\n\n` +
        (unsubUrl
          ? `You also asked for Troy's letter, so that's coming too. Changed your mind? Unsubscribe: ${unsubUrl}\n${address}\n`
          : `We will not email you again unless you ask. You should ask, though: we keep a fresh list of ` +
            `employers that hire people with records, real openings, and insights that move your search forward. ` +
            `Asking takes one step: create your free account at the link above.\n`));

  const subject =
    opts.why === "finished" ? "Your finished resume from The Forge" : "Your resume package from The Forge";
  return { subject, html, text };
}

/** The real transport (Resend). Only the routes create it; tests pass their own. */
export function resendTransport(key: string): MailTransport {
  return async (msg) => {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify(msg),
    });
    return { ok: res.ok, status: res.status };
  };
}

/** The key, or null when email is not configured here. */
export function resendKey(): string | null {
  return process.env.RESEND_API_KEY || process.env.AUTH_RESEND_KEY || null;
}
