/**
 * Email sign-in links go to a page with a button, not straight to the sign-in.
 *
 * WHY. An Auth.js email link is a GET to /api/auth/callback/resend that signs
 * the person in on arrival. Mail scanners (Microsoft Safe Links and similar)
 * open every link in an email as it lands. A scanner opening the link used the
 * one-time token, created a session nobody asked for, set off the new-device
 * email, and could prove the inbox for an account (F3) without the person ever
 * seeing the message. Scanners load pages; they do not press buttons.
 *
 * So every sign-in link we send (the login page's "email me a link" and org
 * invitations) points at /login/finish with the same token, email and
 * callbackUrl. That page shows one "Finish signing in" button, which goes to
 * the real callback URL. The page builds that URL itself from the validated
 * parameters (this origin, the resend callback path), so it can never be
 * pointed anywhere else.
 *
 * Fetch-only and import-free apart from the pure safe-path helper: safe in the
 * client page, in Node routes, and in auth.ts (which shares a module graph with
 * the Edge middleware).
 */
import { isSafeRelativePath } from "./safe-path";

export const EMAIL_LINK_PAGE = "/login/finish";
export const EMAIL_CALLBACK_PATH = "/api/auth/callback/resend";

const TOKEN_RE = /^[0-9a-f]{32,256}$/i;

/** Rewrite an Auth.js email callback URL to the button page on the same origin. */
export function interstitialUrlFor(callbackUrl: string): string {
  const u = new URL(callbackUrl);
  const page = new URL(EMAIL_LINK_PAGE, u.origin);
  for (const key of ["token", "email", "callbackUrl"]) {
    const v = u.searchParams.get(key);
    if (v !== null) page.searchParams.set(key, v);
  }
  return page.toString();
}

/**
 * The sign-in URL the "Finish signing in" button may go to, built from the
 * page's own parameters, or null if they are not a valid sign-in link.
 * Always this origin's /api/auth/callback/resend; only token, email and a
 * same-site callbackUrl are carried over.
 */
export function emailCallbackTarget(origin: string, params: URLSearchParams): string | null {
  const token = params.get("token") || "";
  const email = params.get("email") || "";
  if (!TOKEN_RE.test(token)) return null;
  if (!email || email.length > 254 || !email.includes("@") || /[\u0000-\u001f\u007f\s]/.test(email)) {
    return null;
  }
  const target = new URL(EMAIL_CALLBACK_PATH, origin);
  const cb = params.get("callbackUrl");
  if (cb) {
    if (isSafeRelativePath(cb)) {
      target.searchParams.set("callbackUrl", cb);
    } else {
      try {
        const parsed = new URL(cb);
        if (parsed.origin === new URL(origin).origin && isSafeRelativePath(parsed.pathname)) {
          target.searchParams.set("callbackUrl", parsed.toString());
        }
      } catch {
        // not a URL: dropped, Auth.js falls back to its default
      }
    }
  }
  target.searchParams.set("token", token);
  target.searchParams.set("email", email);
  return target.toString();
}

/** The sign-in link email. Plain words, one button, no em dashes. */
export function buildSignInLinkEmail(link: string): { subject: string; html: string; text: string } {
  const subject = "Your sign-in link for Steel Man Resumes";
  const text =
    `Hi there,\n\n` +
    `Here is your link to sign in to Steel Man Resumes:\n${link}\n\n` +
    `It works once and stops working after 24 hours. If you did not ask for it, you can ignore this email.\n\n` +
    `Steel Man Resumes`;
  const safe = link.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
  const html =
    `<div style="font-family:Arial,sans-serif;line-height:1.5;color:#1c1c1a;max-width:520px">` +
    `<p>Hi there,</p>` +
    `<p>Here is your link to sign in to Steel Man Resumes.</p>` +
    `<p style="margin:24px 0"><a href="${safe}" style="background:#4a6741;color:white;padding:12px 18px;border-radius:10px;text-decoration:none;font-weight:700">Sign in</a></p>` +
    `<p style="font-size:13px;color:#666">It works once and stops working after 24 hours. If you did not ask for it, you can ignore this email.</p>` +
    `<p>Steel Man Resumes</p>` +
    `</div>`;
  return { subject, html, text };
}

/**
 * Resend provider `sendVerificationRequest`: same Resend call Auth.js makes,
 * but the link in the email is the button page, not the callback itself.
 */
export async function sendSignInLinkEmail(params: {
  identifier: string;
  url: string;
  provider: { apiKey?: string; from?: string };
}): Promise<void> {
  const content = buildSignInLinkEmail(interstitialUrlFor(params.url));
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${params.provider.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: params.provider.from,
      to: params.identifier,
      subject: content.subject,
      html: content.html,
      text: content.text,
    }),
  });
  if (!res.ok) {
    throw new Error("Resend error: " + res.status + " " + (await res.text()).slice(0, 300));
  }
}

/**
 * LOGIN CSRF (security review 3a r1, M1). The callback signs in on arrival, so
 * a page anywhere could send a person's browser to an attacker's own email
 * link and sign them in to the attacker's account; everything they then typed
 * into the Forge would go there. Only our own "Finish signing in" button
 * (a same-origin navigation) may reach the callback. Any other GET of it (from
 * another site, a typed or pasted address, a mail scanner, a sibling host) is
 * sent to that button page with the same token, email and callbackUrl, which
 * names the address being signed in to.
 */
export function emailCallbackNeedsButton(path: string, method: string, secFetchSite: string | null): boolean {
  if (path !== EMAIL_CALLBACK_PATH) return false;
  if (method !== "GET" && method !== "HEAD") return false;
  return secFetchSite !== "same-origin";
}

/** "morgan@example.com" -> "m***@example.com", for the button page. */
export function maskEmail(email: string | null | undefined): string | null {
  if (!email) return null;
  const at = email.lastIndexOf("@");
  if (at < 1) return null;
  return `${email[0]}***${email.slice(at)}`;
}
