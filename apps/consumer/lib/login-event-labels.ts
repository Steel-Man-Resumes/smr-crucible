/**
 * Plain names for user_login_event.event values.
 *
 * These rows are the account's security timeline (sign-ins, 2FA changes,
 * password changes). This module turns the machine event key into a short,
 * calm sentence a person can read.
 *
 * Pure: no DB, no network, no React. Safe to unit-test.
 */

export const LOGIN_EVENT_LABELS: Record<string, string> = {
  sign_in: "Signed in",
  two_factor_enabled: "Two-step verification turned on",
  two_factor_disabled: "Two-step verification turned off",
  password_created: "Password created",
  password_changed: "Password changed",
};

/** Plain name for a login event key. Falls back to a readable Title Case. */
export function labelForLoginEvent(event: string | null | undefined): string {
  if (event == null) return "Account activity";
  const key = String(event).trim();
  if (LOGIN_EVENT_LABELS[key]) return LOGIN_EVENT_LABELS[key];
  const titled = key
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
  return titled || "Account activity";
}
