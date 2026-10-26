/**
 * Developer mode: the four modes, the banner words and the persona grouping
 * (house lane L2, 2026-10-26). Pure, so every rule is tested
 * (lib/__tests__/dev-mode.test.ts); DevSwitcher, DevModeBanner and
 * ImpersonationChrome all use it.
 *
 * The four modes, as the DEV menu labels them:
 *   Admin                                 yourself, with your admin tools
 *   View as staff of an org (read-only)   an organization's staff member
 *   View as a participant (read-only)     a participant's own screens
 *   Exit                                  end the view, back where you started
 * Viewing is the existing audited impersonation: a signed 60-minute cookie,
 * a row in impersonation_session for every start and end, and the admin's
 * second factor required (lib/effective-auth.ts). Nothing here weakens that.
 */

export type DevMode = "admin" | "staff" | "participant";

export const DEV_MODE_LABELS = {
  admin: "Admin",
  staff: "View as staff of an org (read-only)",
  participant: "View as a participant (read-only)",
  exit: "Exit",
} as const;

/** Where "Exit" returns to: the page the view was started from (A1 M8). */
export const DEV_VIEW_RETURN_KEY = "smr_dev_view_return";

/** Only same-site paths are ever returned to. */
export function safeReturnPath(raw: string | null | undefined): string {
  if (!raw || typeof raw !== "string") return "/dashboard";
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.includes("\\")) return "/dashboard";
  return raw.slice(0, 512);
}

/**
 * Which mode the admin is in, from the effective role.
 * staff = viewing someone who works in an organization; participant =
 * viewing anyone else; admin = not viewing.
 */
export function currentDevMode(role: { impersonating?: { mode: string } | null; orgRole?: string | null } | null | undefined): DevMode {
  if (!role?.impersonating) return "admin";
  return role.orgRole ? "staff" : "participant";
}

const ROLE_WORDS: Record<string, string> = {
  owner: "owner",
  org_admin: "org leader",
  staff: "staff",
};

export interface BannerInput {
  /** The person being viewed (name or email); null when unknown. */
  who: string | null;
  mode: "view" | "assist";
  orgName?: string | null;
  orgRole?: string | null;
}

/** The one sentence the banner says. Plain words, no em dashes. */
export function devBannerText(input: BannerInput): string {
  const who = input.who?.trim() || "someone";
  const where = input.orgRole && input.orgName
    ? `, ${ROLE_WORDS[input.orgRole] ?? "staff"} at ${input.orgName}`
    : input.orgName
      ? `, a participant of ${input.orgName}`
      : ", a participant";
  if (input.mode === "assist") {
    return `Assist mode: you are acting as ${who}${where}. Changes are real.`;
  }
  return `Developer mode: viewing as ${who}${where}. Read-only, changes are off.`;
}

/** The banner on the admin's read-only organization console (?codeId). */
export function orgViewBannerText(orgName: string | null | undefined): string {
  return `Viewing ${orgName?.trim() || "this organization"} as platform admin. Read-only, changes are off.`;
}

/**
 * Demo organizations carry "(Demo)" in their name (every seeded demo does).
 * Anything else is treated as a real organization: its people are hidden in
 * the DEV menu until the admin expands them on purpose (A1 defect H8).
 */
export function isDemoOrgName(name: string | null | undefined): boolean {
  return !!name && /\(demo\)/i.test(name);
}

export interface PersonaLike {
  userId: string;
  orgName: string;
  demo?: boolean;
}

/** Demo personas grouped by org, in API order; real ones counted, not named. */
export function splitPersonas<T extends PersonaLike>(personas: readonly T[]): { demo: Array<[string, T[]]>; realCount: number } {
  const groups = new Map<string, T[]>();
  let realCount = 0;
  for (const p of personas) {
    const demo = p.demo ?? isDemoOrgName(p.orgName);
    if (!demo) { realCount++; continue; }
    const key = p.orgName || "Unassigned";
    const g = groups.get(key);
    if (g) g.push(p); else groups.set(key, [p]);
  }
  return { demo: Array.from(groups.entries()), realCount };
}

/** Org-grouping for any list (used once real orgs are expanded). */
export function groupByOrg<T extends { orgName: string }>(personas: readonly T[]): Array<[string, T[]]> {
  const groups = new Map<string, T[]>();
  for (const p of personas) {
    const key = p.orgName || "Unassigned";
    const g = groups.get(key);
    if (g) g.push(p); else groups.set(key, [p]);
  }
  return Array.from(groups.entries());
}
