"use client";

/**
 * <OrgSidebar> -- the staff sidebar (CRM wave 2026-10-25, lane C1).
 *
 * Rendered by RefineryShell's renderOrgNav inside the forge-workshop scope, the
 * same skin as the participant board. Top: the identity block (OrgMark, the
 * organization's name, a Demo chip, the viewer's role). Then the work grouped
 * by the job, capability-gated (lib/org-nav.ts). Foot: Settings, and Ask t.ROY,
 * which opens the t.ROY drawer in staff mode.
 */
import Link from "next/link";
import { OrgMark } from "@/components/org/OrgMark";
import { orgNavFor, orgNavActive, orgRoleLine, orgDisplayName } from "@/lib/org-nav";

export interface OrgSidebarProps {
  orgName: string | null;
  orgRole: "owner" | "org_admin" | "staff" | null;
  capabilities: readonly string[];
  /** The per-participant workspace is on (crm_v2). Off: the older flat list. */
  workspace: boolean;
  /** Flat list for organizations without the workspace. */
  legacyItems: readonly { href: string; label: string }[];
  pathname: string;
  /** From the role payload once C3 adds it; until then the mark is a monogram. */
  orgId?: string | null;
  hasLogo?: boolean;
  onItemClick?: () => void;
}

export function OrgSidebar(p: OrgSidebarProps) {
  const groups = p.workspace
    ? orgNavFor(p.capabilities)
    : [{ label: "Organization", items: p.legacyItems.map((i) => ({ ...i, navId: "" })) }];
  const org = orgDisplayName(p.orgName);
  const roleLine = orgRoleLine(p.orgRole, p.capabilities);
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
    <nav aria-label="Organization workspace" className="org-nav">
      <div className="org-identity" data-tour="crm-org-mark">
        {/* C3 merge: drop the name fallback once the role payload carries orgId (review N9). */}
        <OrgMark orgId={p.orgId || p.orgName || ""} name={org.name} hasLogo={!!p.hasLogo} size={40} />
        <div className="min-w-0">
          {(org.name || org.demo) && (
            <p className="org-identity-name">
              {org.name}
              {org.demo && <span className="org-demo-chip">Demo</span>}
            </p>
          )}
          {roleLine && <p className="org-identity-role">{roleLine}</p>}
        </div>
      </div>
      {groups.map((group) => (
        <div key={group.label} className="org-group">
          <p className="org-eyebrow">{group.label}</p>
          <ul>{group.items.map((item) => link(item, p.workspace ? orgNavActive(item.href, p.pathname) : item.href === p.pathname))}</ul>
        </div>
      ))}
      <ul className="org-foot">
        {link({ href: "/dashboard/settings", label: "Settings", navId: "org-nav-settings" }, p.pathname === "/dashboard/settings")}
        <li>
          {/* Opens the t.ROY drawer (staff mode). Same event the line review uses; no text, so nothing is sent. */}
          <button type="button" data-nav-id="org-nav-troy" className="t-focus org-link org-troy"
            onClick={() => { p.onItemClick?.(); window.dispatchEvent(new CustomEvent("troy-line-help")); }}>
            <span className="org-dot" aria-hidden="true" />
            Ask t.ROY
          </button>
        </li>
      </ul>
    </nav>
  );
}
