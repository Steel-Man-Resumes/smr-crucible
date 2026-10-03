/**
 * Pages analytics never sees (GA4 opt-out flag and Vercel events). GA4 records
 * the full page URL, query string included, so any page whose URL can carry a
 * code, a token or an email address belongs here.
 */
export const EXCLUDED_PREFIXES = [
  "/mini-forge",
  "/dashboard/disclosure",
  "/dashboard/interview",
  "/dashboard/vault",
  "/dashboard/documents",
  "/access",
  // 2026-10-02: sign-in and reset links carry a one-time token and the email.
  "/login/finish",
  "/login/verify",
  "/reset-password",
  "/forgot-password",
];

export function isAnalyticsExcluded(pathname: string): boolean {
  return EXCLUDED_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(p + "/") || pathname.startsWith(p + "?")
  );
}
