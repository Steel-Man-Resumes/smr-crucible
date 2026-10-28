/**
 * The staff sidebar, as data (CRM wave 2026-10-25, lane C1; rebuilt around a
 * case manager's day in the staff pass 2026-10-27, lane S2).
 *
 * Staff: MY DAY (Today, People, Referrals, Sharing asks), RECORDS (Case
 * notes), CONNECT (Directory), BRING SOMEONE IN (Add people). Owners and org
 * admins also get REPORTS (Insights, Activity log), TEAM (Team & access,
 * Sharing policy) and SET UP (Structure, Fields, Layouts, Set up, Security &
 * privacy). Find a person is the box at the top of the sidebar, not a page in
 * the list. The foot (Help, Ask t.ROY, My setup, Settings) is ORG_FOOT_NAV.
 *
 * Every item is a real page, an item with `needs` shows only to people who
 * hold that capability (so the nav mirrors the authorization model rather
 * than guessing from a role name), and an item with `feature` shows only once
 * the lane that builds its page is merged (lib/staff-features.ts). Pure, so
 * the grouping is tested per role without rendering. The navIds are stable:
 * the staff tour lights items by them.
 */
import { matchesPreset } from "@crucible/core/src/authz/capabilities";
import { mergeNavExtensions, orgNavExtensionsFor, NAV_EXTENSIONS, type NavExtension } from "./refinery-nav";
import { STAFF_FEATURES, staffFeatureOn, type StaffFeature, type StaffFeatures } from "./staff-features";

export interface OrgNavItem { href: string; label: string; needs?: string; navId: string; feature?: StaffFeature }
export interface OrgNavGroup { label: string; items: OrgNavItem[] }

/** Group labels, in order. Extensions name these. */
export const ORG_NAV_GROUPS = {
  day: "My day",
  records: "Records",
  connect: "Connect",
  bring: "Bring someone in",
  reports: "Reports",
  team: "Team",
  setup: "Set up",
} as const;

export const ORG_WORKSPACE_NAV: readonly OrgNavGroup[] = [
  {
    label: ORG_NAV_GROUPS.day,
    items: [
      { href: "/dashboard/today", label: "Today", needs: "org.client.view_content", navId: "org-nav-today" },
      { href: "/dashboard/people", label: "People", navId: "org-nav-people" },
      { href: "/dashboard/requests", label: "Sharing asks", needs: "org.client.request_sharing", navId: "org-nav-asks" },
    ],
  },
  { label: ORG_NAV_GROUPS.records, items: [{ href: "/dashboard/notes", label: "Case notes", navId: "org-nav-notes" }] },
  {
    label: ORG_NAV_GROUPS.connect,
    items: [
      { href: "/dashboard/directory", label: "Directory", needs: "org.client.view_content", navId: "org-nav-directory", feature: "directory" },
      // S5: employers and help that fit what each person shared (same gate as /api/org/connections).
      { href: "/dashboard/connections", label: "Connections", needs: "org.client.view_content", navId: "org-nav-connections" },
      // S6: add a missing place, or see what you sent and the answers (same gate as /api/org/directory-contributions).
      { href: "/dashboard/contribute", label: "Help the directory", needs: "org.cohort.view", navId: "org-nav-contribute" },
    ],
  },
  {
    label: ORG_NAV_GROUPS.bring,
    items: [{ href: "/dashboard/participants", label: "Add people", needs: "org.participant.invite", navId: "org-nav-add" }],
  },
  { label: ORG_NAV_GROUPS.reports, items: [{ href: "/dashboard/insights", label: "Insights", needs: "org.insights.view", navId: "org-nav-insights" }] },
  {
    label: ORG_NAV_GROUPS.team,
    items: [
      { href: "/dashboard/team", label: "Team & access", needs: "org.staff.manage", navId: "org-nav-team" },
      { href: "/dashboard/sharing-policy", label: "Sharing policy", needs: "org.staff.manage", navId: "org-nav-policy" },
    ],
  },
  // Filled from NAV_EXTENSIONS (Structure, Fields, Layouts, Set up, Security & privacy); kept here so the group keeps its place.
  { label: ORG_NAV_GROUPS.setup, items: [] },
];

/**
 * The sidebar foot, in order: Help, Ask t.ROY (a button that opens the
 * drawer, drawn by OrgSidebar where `href` is null), My setup, Wins (once the
 * rewards lane is merged and only for people who turned rewards on), Settings.
 */
export interface OrgFootItem { href: string | null; label: string; navId: string; feature?: StaffFeature; /** Only for organizations with the per-person workspace (crm_v2). */ workspaceOnly?: boolean }
export const ORG_FOOT_NAV: readonly OrgFootItem[] = [
  { href: "/dashboard/help", label: "Help", navId: "org-nav-help" },
  { href: null, label: "Ask t.ROY", navId: "org-nav-troy" },
  { href: "/dashboard/my-setup", label: "My setup", navId: "org-nav-my-setup", workspaceOnly: true },
  { href: "/dashboard/wins", label: "Wins", navId: "org-nav-wins", feature: "rewards" },
  { href: "/dashboard/settings", label: "Settings", navId: "org-nav-settings" },
];

/** The foot items this build shows. `rewardsOn` is the staff member's own switch (S6); Wins needs both. */
export function orgFootFor(opts: { features?: StaffFeatures; rewardsOn?: boolean; workspace?: boolean } = {}): OrgFootItem[] {
  const features = opts.features ?? STAFF_FEATURES;
  return ORG_FOOT_NAV.filter((i) => staffFeatureOn(i.feature, features) && (i.feature !== "rewards" || opts.rewardsOn === true)
    && (!i.workspaceOnly || opts.workspace !== false));
}

/** The find-a-person box at the top of the sidebar: only for people who may open what others shared (the search route's own gate). */
export function orgFindBoxFor(capabilities: readonly string[]): boolean {
  return capabilities.includes("org.client.view_content");
}

/**
 * The groups this person sees: items they lack the capability for are gone,
 * and so is a group left empty. Screens wired through the nav registry
 * (NAV_EXTENSIONS in lib/refinery-nav.ts, surface "org") join their group
 * under the same capability rule, plus the org's module switches and the
 * build's feature flags.
 */
export function orgNavFor(capabilities: readonly string[], modules?: Readonly<Record<string, boolean>> | null,
  extensions: readonly NavExtension[] = NAV_EXTENSIONS, features: StaffFeatures = STAFF_FEATURES): OrgNavGroup[] {
  const base = ORG_WORKSPACE_NAV
    .map((g) => ({ label: g.label, items: g.items.filter((i) => (!i.needs || capabilities.includes(i.needs)) && staffFeatureOn(i.feature, features)) }));
  return mergeNavExtensions(base, orgNavExtensionsFor(capabilities, modules, extensions, features),
    (e) => ({ href: e.href, label: e.label, needs: e.needs, navId: e.navId }))
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
  // A page below a nav page lights its parent (a referral, a field, a unit).
  if (href !== "/dashboard" && pathname.startsWith(`${href}/`)) return true;
  return false;
}

/** The viewer's role line under the organization's name. */
export function orgRoleLine(orgRole: "owner" | "org_admin" | "staff" | null | undefined, capabilities: readonly string[]): string {
  if (orgRole === "owner") return "Owner";
  if (orgRole === "org_admin") return "Admin";
  if (orgRole === "staff") return matchesPreset("volunteer", new Set(capabilities)) ? "Volunteer" : "Case manager";
  return "";
}

/** The organization's name as shown: "(Demo)" becomes the separate Demo chip. Empty when unknown: no stand-in name. */
export function orgDisplayName(name: string | null | undefined): { name: string; demo: boolean } {
  const raw = (name ?? "").trim();
  const demo = /\(Demo\)\s*$/.test(raw);
  return { name: raw.replace(/\s*\(Demo\)\s*$/, "").trim(), demo };
}

/**
 * Where `/dashboard` sends a workspace staff member (Troy 2026-10-24: staff
 * land on Today). Plain `/dashboard` goes to Today, or to People for someone
 * who chose "Caseload" under Settings, My workflow. Old links with a Caseload
 * anchor (#invited, #team, #add) keep working by going to People with the
 * anchor. Null means stay: not a workspace member.
 */
export function orgLanding(opts: { orgRole: string | null | undefined; crmV2: boolean | undefined; hash: string; landing?: string | null; capabilities: readonly string[] }): string | null {
  if (!opts.orgRole || !opts.crmV2) return null;
  const hash = opts.hash.replace(/^#/, "");
  if (hash) return `/dashboard/people#${hash}`;
  // Today is built from what people shared; without the switch to open it the
  // page can only refuse, so those staff land on People (C1 review S1).
  if (!opts.capabilities.includes("org.client.view_content")) return "/dashboard/people";
  return opts.landing === "caseload" ? "/dashboard/people" : "/dashboard/today";
}
