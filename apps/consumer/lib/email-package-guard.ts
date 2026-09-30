/**
 * Guards for /api/forge/email-package (security sweep 2026-09-30, #14).
 * Kept out of the route file so they can be unit-tested and because a Next.js
 * route file may only export HTTP handlers and route config.
 */

import { createHash } from "crypto";

/** Sends to one address per day, from anyone. A person needs one or two. */
export const EMAIL_PACKAGE_PER_RECIPIENT_PER_DAY = 3;
export const RECIPIENT_ENDPOINT = "email-package-recipient";

/**
 * Same-site check. Browsers always send Origin on a fetch POST; a missing or
 * foreign Origin is a script or another site, not our Forge page.
 */
export function originAllowed(origin: string | null, requestUrl: string): boolean {
  if (!origin) return false;
  let o: URL;
  try {
    o = new URL(origin);
  } catch {
    return false;
  }
  const host = o.hostname.toLowerCase();
  if (o.host === new URL(requestUrl).host) return true;
  if (host === "steelmanresumes.com" || host.endsWith(".steelmanresumes.com")) return o.protocol === "https:";
  const appUrl = process.env.APP_URL;
  if (appUrl) {
    try {
      if (new URL(appUrl).host === o.host) return true;
    } catch {}
  }
  return false;
}

export function recipientKey(email: string): string {
  return "rcpt:" + createHash("sha256").update(email).digest("hex").slice(0, 32);
}

