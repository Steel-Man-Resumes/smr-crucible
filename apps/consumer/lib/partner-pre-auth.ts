/**
 * PARTNER_PRE_AUTH, read in one place (edge-safe, no imports).
 *
 * Format: PARTNER_PRE_AUTH="email:CODE,email2:CODE2". A bare email with no
 * code still elevates, it just records no attribution. Unset means nobody is
 * pre-authorized. auth.ts uses it to raise the tier at sign-in, and the
 * Refinery seat rule (lib/refinery-access.ts) counts a listed address as a
 * seat, because only the deployment environment knows this list.
 */
export interface PartnerPreAuth {
  emails: string[];
  codes: Record<string, string>;
}

export function parsePartnerPreAuth(raw: string | undefined | null): PartnerPreAuth {
  const emails: string[] = [];
  const codes: Record<string, string> = {};
  for (const entry of (raw ?? "").split(",")) {
    const [rawEmail, rawCode] = entry.split(":");
    const email = rawEmail?.trim().toLowerCase();
    if (!email) continue;
    emails.push(email);
    if (rawCode?.trim()) codes[email] = rawCode.trim();
  }
  return { emails, codes };
}

/** Is this address on the list? Exact, case-insensitive match only. */
export function isPartnerPreAuthorized(email: unknown, raw: string | undefined | null = process.env.PARTNER_PRE_AUTH): boolean {
  if (typeof email !== "string" || !email.trim()) return false;
  return parsePartnerPreAuth(raw).emails.includes(email.trim().toLowerCase());
}
