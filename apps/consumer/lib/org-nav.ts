/**
 * The staff sidebar, as data (CRM wave 2026-10-25, lane C1).
 *
 * Grouped by the job: Work, Records, Organization. Every item is a real page,
 * and an item with `needs` shows only to people who hold that capability, so
 * the nav mirrors the authorization model rather than guessing from a role
 * name. Pure, so the grouping can be tested per role without rendering.
 */
import { matchesPreset } from "@crucible/core/src/authz/capabilities";

export interface OrgNavItem { href: string; label: string; needs?: string; navId: string }
export interface OrgNavGroup { label: string; items: OrgNavItem[] }

export const ORG_WORKSPACE_NAV: readonly OrgNavGroup[] = [
  {
    label: "Work",
    items: [
      { href: "/dashboard/today", label: "Today", navId: "org-nav-today" },
      { href: "/dashboard/people", label: "People", navId: "org-nav-people" },
      { href: "/dashboard/requests", label: "Asks", navId: "org-nav-asks" },
    ],
  },
  { label: "Records", items: [{ href: "/dashboard/notes", label: "Case notes", navId: "org-nav-notes" }] },
  {
    label: "Organization",
    items: [
      { href: "/dashboard/insights", label: "Insights", needs: "org.insights.view", navId: "org-nav-insights" },
      { href: "/dashboard/team", label: "Team & access", needs: "org.staff.manage", navId: "org-nav-team" },
      { href: "/dashboard/participants", label: "Add people", needs: "org.participant.invite", navId: "org-nav-add" },
      { href: "/dashboard/sharing-policy", label: "Sharing policy", needs: "org.staff.manage", navId: "org-nav-policy" },
      { href: "/dashboard/org-security", label: "Security & privacy", navId: "org-nav-security" },
    ],
  },
];

/** The groups this person sees: items they lack the capability for are gone, and so is a group left empty. */
export function orgNavFor(capabilities: readonly string[]): OrgNavGroup[] {
  return ORG_WORKSPACE_NAV
    .map((g) => ({ label: g.label, items: g.items.filter((i) => !i.needs || capabilities.includes(i.needs)) }))
    .filter((g) => g.items.length > 0);
}

/**
 * Which item is lit. A person's page belongs to People; `/dashboard` itself
 * redirects to Today for the workspace, so it lights Today while it does.
 */
export function orgNavActive(href: string, pathname: string): boolean {
  if (href === pathname) return true;
  if (href === "/dashboard/people" && pathname.startsWith("/dashboard/clients/")) return true;
  if (href === "/dashboard/today" && pathname === "/dashboard") return true;
  return false;
}

/** The viewer's role line under the organization's name. */
export function orgRoleLine(orgRole: "owner" | "org_admin" | "staff" | null | undefined, capabilities: readonly string[]): string {
  if (orgRole === "owner") return "Owner";
  if (orgRole === "org_admin") return "Admin";
  if (orgRole === "staff") return matchesPreset("volunteer", new Set(capabilities)) ? "Volunteer" : "Case manager";
  return "";
}

/** The organization's name as shown: "(Demo)" becomes the separate Demo chip. */
export function orgDisplayName(name: string | null | undefined): { name: string; demo: boolean } {
  const raw = (name ?? "").trim();
  const demo = /\(Demo\)\s*$/.test(raw);
  return { name: raw.replace(/\s*\(Demo\)\s*$/, "").trim() || "Your organization", demo };
}

/**
 * Where `/dashboard` sends a workspace staff member (Troy 2026-10-24: staff
 * land on Today). Plain `/dashboard` goes to Today, or to People for someone
 * who chose "Caseload" under Settings, My workflow. Old links with a Caseload
 * anchor (#invited, #team, #add) keep working by going to People with the
 * anchor. Null means stay: not a workspace member.
 */
export function orgLanding(opts: { orgRole: string | null | undefined; crmV2: boolean | undefined; hash: string; landing?: string | null }): string | null {
  if (!opts.orgRole || !opts.crmV2) return null;
  const hash = opts.hash.replace(/^#/, "");
  if (hash) return `/dashboard/people#${hash}`;
  return opts.landing === "caseload" ? "/dashboard/people" : "/dashboard/today";
}
