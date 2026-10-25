/**
 * Settings under impersonation (TOOL-REVISIONS S10, T2), pure part.
 *
 * Every Settings route resolves the account with effectiveAuth(), so a
 * platform admin viewing as a person sees that person's switches, never their
 * own switches under the person's name. What an operator may then do depends
 * on what the route holds:
 *
 * - preference: how the app looks and talks (coach, text size, hidden
 *   employers, package email, usage). Read as the person; writes refused in
 *   view mode (the same rule /api/steelman uses). Assist mode may help.
 * - consent: the person's own choices about who sees their work, joining or
 *   leaving a program, and the guided tours. Read as the person; writes
 *   refused under ANY impersonation. Nobody consents for someone else.
 * - private: security (password, two-step codes, devices, sign-in history),
 *   the person's photo, export and delete. Refused under ANY impersonation,
 *   reads included: an operator never sees or acts on these.
 *
 * Middleware already blocks writes in view mode at the edge; this is the same
 * rule again at the route, so a route never depends on the edge alone.
 */

export type SettingsKind = "preference" | "consent" | "private";
export type SettingsAccess = "read" | "write";
export interface ImpersonationLike { mode?: string | null }

export const SETTINGS_REFUSAL = {
  viewOnly: "This account view is read only.",
  consent: "Only the person can change this. It stays as they set it while you view or assist.",
  private: "This part of Settings belongs to the person. It is not shown or changed while you view or assist as them.",
} as const;

/** null when allowed; otherwise the refusal words (always a 403). */
export function settingsVerdict(impersonation: ImpersonationLike | null | undefined, kind: SettingsKind, access: SettingsAccess): string | null {
  if (!impersonation) return null;
  if (kind === "private") return SETTINGS_REFUSAL.private;
  if (access === "read") return null;
  if (kind === "consent") return SETTINGS_REFUSAL.consent;
  // preference write: view mode is read only; anything that is not a known
  // assist mode fails toward read only too.
  return impersonation.mode === "assist" ? null : SETTINGS_REFUSAL.viewOnly;
}

/** The 403 for a refused Settings call, or null to continue. */
export function settingsRefusal(session: { impersonation?: ImpersonationLike | null } | null | undefined, kind: SettingsKind, access: SettingsAccess): Response | null {
  const words = settingsVerdict(session?.impersonation ?? null, kind, access);
  return words ? Response.json({ error: words }, { status: 403, headers: { "Cache-Control": "no-store" } }) : null;
}
