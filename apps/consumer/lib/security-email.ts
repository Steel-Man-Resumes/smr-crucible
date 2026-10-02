/**
 * Security notifications (new-device sign-in, password changed). Send-only.
 * Mirrors the org-invite Resend sender. Fetch-only (no Node APIs), so it is safe
 * in the sign-in callbacks that share a module graph with the Edge middleware.
 */

export async function sendSecurityEmail(
  to: string,
  content: { subject: string; html: string; text: string }
): Promise<string> {
  const resendKey = process.env.AUTH_RESEND_KEY || process.env.RESEND_API_KEY;
  if (!resendKey) throw new Error("Resend API key missing -- security email not sent");
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
  return data.id || "";
}

/** Friendly device label from a User-Agent string. */
export function deviceLabel(ua: string | null): string {
  if (!ua) return "an unrecognized device";
  const browser =
    /Edg\//.test(ua) ? "Edge" :
    /OPR\/|Opera/.test(ua) ? "Opera" :
    /Chrome\//.test(ua) && !/Chromium/.test(ua) ? "Chrome" :
    /Firefox\//.test(ua) ? "Firefox" :
    /Safari\//.test(ua) && /Version\//.test(ua) ? "Safari" :
    "a browser";
  const os =
    /Windows NT/.test(ua) ? "Windows" :
    /iPhone|iPad|iPod/.test(ua) ? "iOS" :
    /Mac OS X/.test(ua) ? "macOS" :
    /Android/.test(ua) ? "Android" :
    /Linux/.test(ua) ? "Linux" :
    "";
  return os ? `${browser} on ${os}` : browser;
}

export function buildNewDeviceEmail(opts: {
  name: string | null;
  device: string;
  location: string | null;
  whenISO: string;
  origin: string;
}): { subject: string; html: string; text: string } {
  const hello = (opts.name || "").trim().split(/\s+/)[0] || "there";
  const when = (() => {
    const d = new Date(opts.whenISO);
    return isNaN(d.getTime()) ? opts.whenISO : d.toUTCString();
  })();
  const where = opts.location ? ` from ${opts.location}` : "";
  const settingsUrl = `${opts.origin}/dashboard/settings`;
  const subject = "New sign-in to your Steel Man Resumes account";
  const text =
    `Hi ${hello},\n\n` +
    `Your account was just signed into on a new device:\n\n` +
    `Device: ${opts.device}${where}\n` +
    `Time: ${when}\n\n` +
    `If this was you, no action is needed.\n\n` +
    `If it wasn't you, change your password right away:\n${settingsUrl}\n\n` +
    `-- Steel Man Resumes`;
  const html =
    `<p>Hi ${hello},</p>` +
    `<p>Your account was just signed into on a new device:</p>` +
    `<p><strong>Device:</strong> ${escapeHtml(opts.device + where)}<br>` +
    `<strong>Time:</strong> ${escapeHtml(when)}</p>` +
    `<p>If this was you, no action is needed.</p>` +
    `<p>If it wasn't you, <a href="${settingsUrl}">change your password right away</a>.</p>` +
    `<p>-- Steel Man Resumes</p>`;
  return { subject, html, text };
}

/**
 * "Your password changed" notice: sent when a password is created, changed, or
 * reset by email link. The person who did it already knows; this is for the
 * case where it was not them.
 */
export function buildPasswordChangedEmail(opts: {
  name: string | null;
  kind: "created" | "changed" | "reset";
  whenISO: string;
  origin: string;
}): { subject: string; html: string; text: string } {
  const hello = (opts.name || "").trim().split(/\s+/)[0] || "there";
  const when = (() => {
    const d = new Date(opts.whenISO);
    return isNaN(d.getTime()) ? opts.whenISO : d.toUTCString();
  })();
  const resetUrl = `${opts.origin}/forgot-password`;
  const subject =
    opts.kind === "created"
      ? "A password was added to your Steel Man Resumes account"
      : "Your Steel Man Resumes password was changed";
  const what =
    opts.kind === "created"
      ? "A password was added to your account"
      : opts.kind === "reset"
        ? "Your password was reset with an email link"
        : "Your password was changed";
  const text =
    `Hi ${hello},\n\n` +
    `${what} on ${when}. Your other devices were signed out.\n\n` +
    `If this was you, no action is needed.\n\n` +
    `If it wasn't you, reset your password right away:\n${resetUrl}\n\n` +
    `Steel Man Resumes`;
  const html =
    `<p>Hi ${escapeHtml(hello)},</p>` +
    `<p>${escapeHtml(what)} on ${escapeHtml(when)}. Your other devices were signed out.</p>` +
    `<p>If this was you, no action is needed.</p>` +
    `<p>If it wasn't you, <a href="${resetUrl}">reset your password right away</a>.</p>` +
    `<p>Steel Man Resumes</p>`;
  return { subject, html, text };
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (ch) =>
    ch === "&" ? "&amp;" : ch === "<" ? "&lt;" : ch === ">" ? "&gt;" : ch === '"' ? "&quot;" : "&#39;"
  );
}
