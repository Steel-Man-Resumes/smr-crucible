"use client";

/**
 * <OrgSidebar> -- the staff sidebar (CRM wave 2026-10-25, lane C1; rebuilt
 * around a case manager's day in the staff pass 2026-10-27, lane S2).
 *
 * Rendered by RefineryShell's renderOrgNav inside the forge-workshop scope, the
 * same skin as the participant board. Top: the identity block (OrgMark, the
 * organization's name, a Demo chip, the viewer's role), then the find-a-person
 * box (the /dashboard/search engine, compact). Then the work grouped by the
 * day, capability-gated (lib/org-nav.ts). Foot: Help, Ask t.ROY (opens the
 * t.ROY drawer in staff mode), My setup, Settings.
 */
import Link from "next/link";
import { OrgMark } from "@/components/org/OrgMark";
import { StaffSearch } from "@/components/org/StaffSearch";
import { orgNavFor, orgNavActive, orgRoleLine, orgDisplayName, orgFootFor, orgFindBoxFor } from "@/lib/org-nav";
import { STAFF_FEATURES, type StaffFeatures } from "@/lib/staff-features";

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
  /** The organization's module switches (org_profile.modules); absent means all on. */
  modules?: Readonly<Record<string, boolean>> | null;
  /** Small counts beside an item, by navId (the inbox's unread count, once S4 is merged). Zero or absent shows nothing. */
  counts?: Readonly<Record<string, number>>;
  /** The staff member's own rewards switch (S6). Wins shows only when it is on. */
  rewardsOn?: boolean;
  /** For tests: the build's feature flags (lib/staff-features.ts). */
  features?: StaffFeatures;
}

/** "3" or "9+": short, so a count never pushes the label onto two lines. */
export function navCountText(n: number | undefined): string | null {
  if (!n || n < 1 || !Number.isFinite(n)) return null;
  return n > 9 ? "9+" : String(Math.floor(n));
}

export function OrgSidebar(p: OrgSidebarProps) {
  const features = p.features ?? STAFF_FEATURES;
  const groups = p.workspace
    ? orgNavFor(p.capabilities, p.modules ?? null, undefined, features)
    : [{ label: "Organization", items: p.legacyItems.map((i) => ({ ...i, navId: "" })) }];
  const org = orgDisplayName(p.orgName);
  const roleLine = orgRoleLine(p.orgRole, p.capabilities);
  const foot = orgFootFor({ features, rewardsOn: p.rewardsOn, workspace: p.workspace });
  const link = (item: { href: string; label: string; navId?: string }, lit: boolean) => {
    const count = item.navId ? navCountText(p.counts?.[item.navId]) : null;
    return (
      <li key={item.href + item.label}>
        <Link href={item.href} onClick={p.onItemClick} data-nav-id={item.navId || undefined} data-tour={item.navId || undefined}
          aria-current={lit ? "page" : undefined} className="t-focus org-link">
          <span className="org-dot" aria-hidden="true" />
          <span className="org-link-label">{item.label}</span>
          {count && <span className="org-count" aria-label={`${count} new`}>{count}</span>}
        </Link>
      </li>
    );
  };
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
      {p.workspace && orgFindBoxFor(p.capabilities) && (
        // A picked result is a link: close the phone drawer the way a nav item does.
        <div className="org-find" data-tour="org-find-person"
          onClickCapture={(e) => { if ((e.target as HTMLElement).closest("a")) p.onItemClick?.(); }}>
          <StaffSearch compact />
        </div>
      )}
      {groups.map((group) => (
        <div key={group.label} className="org-group">
          <p className="org-eyebrow">{group.label}</p>
          <ul>{group.items.map((item) => link(item, p.workspace ? orgNavActive(item.href, p.pathname) : item.href === p.pathname))}</ul>
        </div>
      ))}
      <ul className="org-foot">
        {foot.map((item) => item.href
          ? link({ href: item.href, label: item.label, navId: item.navId }, orgNavActive(item.href, p.pathname))
          : (
            <li key={item.navId}>
              {/* Opens the t.ROY drawer (staff mode). Same event the line review uses; no text, so nothing is sent. */}
              <button type="button" data-nav-id={item.navId} data-tour={item.navId} className="t-focus org-link org-troy"
                onClick={() => { p.onItemClick?.(); window.dispatchEvent(new CustomEvent("troy-line-help")); }}>
                <span className="org-dot" aria-hidden="true" />
                {item.label}
              </button>
            </li>
          ))}
      </ul>
    </nav>
  );
}
