"use client";

/**
 * <AdminSidebar>: the platform admin's sidebar (house build 2026-10-26, L1).
 *
 * Rendered by RefineryShell when the real account is a platform admin and
 * nothing is being viewed as someone else (adminSidebarShown). Same workshop
 * skin and grammar as the staff sidebar (org-workspace.css). Groups from
 * lib/refinery-nav.ts ADMIN_NAV plus any registry entries (adminNavWith).
 *
 * "My organization": when the admin also holds a role in an organization,
 * that organization's workspace follows below, exactly as its staff see it
 * (the same capability-gated list), under its name. The participant career
 * board is never shown here.
 */
import Link from "next/link";
import { adminNavWith, adminNavActive } from "@/lib/refinery-nav";
import { orgNavFor, orgNavActive, orgRoleLine, orgDisplayName } from "@/lib/org-nav";

export interface AdminSidebarProps {
  pathname: string;
  /** The admin's own organization role, when they hold one. */
  orgRole: "owner" | "org_admin" | "staff" | null;
  orgName: string | null;
  capabilities: readonly string[];
  /** The organization runs the staff workspace (crm_v2). Off: its older flat list. */
  workspace: boolean;
  /** The flat list for an organization without the workspace. */
  legacyItems: readonly { href: string; label: string }[];
  onItemClick?: () => void;
}

/** For an admin, /dashboard is Operator home, so it never lights the organization's Today. */
export function myOrgLit(href: string, pathname: string): boolean {
  if (pathname === "/dashboard") return false;
  return orgNavActive(href, pathname);
}

export function AdminSidebar(p: AdminSidebarProps) {
  const groups = adminNavWith();
  const org = orgDisplayName(p.orgName);
  const myOrg = p.orgRole
    ? (p.workspace ? orgNavFor(p.capabilities) : [{ label: "Organization", items: p.legacyItems.map((i) => ({ ...i, navId: "" })) }])
    : [];
  const link = (item: { href: string; label: string; navId?: string }, lit: boolean) => (
    <li key={item.href + item.label}>
      <Link href={item.href} onClick={p.onItemClick} data-nav-id={item.navId || undefined} data-tour={item.navId || undefined}
        aria-current={lit ? "page" : undefined} className="t-focus org-link">
        <span className="org-dot" aria-hidden="true" />
        {item.label}
      </Link>
    </li>
  );
  return (
    <nav aria-label="Platform admin" className="org-nav" data-admin-nav="">
      <div className="org-identity">
        <div className="min-w-0">
          <p className="org-identity-name">Steel Man admin</p>
          <p className="org-identity-role">Platform admin</p>
        </div>
      </div>
      {groups.map((group) => (
        <div key={group.label} className="org-group">
          <p className="org-eyebrow">{group.label}</p>
          <ul>{group.items.map((item) => link(item, adminNavActive(item, p.pathname)))}</ul>
        </div>
      ))}
      {myOrg.length > 0 && (
        <div className="org-group" data-admin-my-org="">
          <p className="org-eyebrow">My organization</p>
          {(org.name || org.demo) && (
            <p className="org-identity-role px-3 pb-1">
              {org.name}{org.demo && <span className="org-demo-chip">Demo</span>}
              {orgRoleLine(p.orgRole, p.capabilities) ? `, ${orgRoleLine(p.orgRole, p.capabilities).toLowerCase()}` : ""}
            </p>
          )}
          {myOrg.map((group) => (
            <ul key={group.label} aria-label={group.label}>
              {group.items.map((item) => link(item, p.workspace ? myOrgLit(item.href, p.pathname) : item.href === p.pathname))}
            </ul>
          ))}
        </div>
      )}
      <ul className="org-foot">
        {link({ href: "/dashboard/settings", label: "Settings", navId: "admin-nav-settings" }, p.pathname === "/dashboard/settings")}
        {link({ href: "/dashboard/help", label: "Help", navId: "admin-nav-help" }, p.pathname === "/dashboard/help")}
      </ul>
    </nav>
  );
}
