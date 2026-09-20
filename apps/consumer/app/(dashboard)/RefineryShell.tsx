"use client";

import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut, useSession } from "next-auth/react";
import { AssistantDrawer } from "@crucible/consumer-ui";
import { AssistantChat } from "@/components/AssistantChat";
import { UiPrefsApplier } from "@/components/UiPrefsApplier";
import { NavAvatar } from "@/components/NavAvatar";
import { JourneyProgressBanner } from "@/components/JourneyProgressBanner";
import { AdminTestModeBanner } from "@/components/AdminTestModeBanner";
import { GuidedTour } from "@/components/GuidedTour";
import { DevSwitcher } from "@/components/DevSwitcher";
import { ImpersonationChrome } from "@/components/ImpersonationChrome";
import { HighlightHost } from "@/components/SpotlightHighlight";
import {
  useUserTier,
  useRealTier,
  canSwitchView,
  getViewAs,
  setViewAs,
  type UserTier,
} from "@/lib/useUserTier";
import { useEffectiveRole } from "@/components/RoleProvider";
import { useOnboarding, type OnboardingState } from "@/lib/useOnboarding";
import { useUserContext } from "@/lib/use-user-context";
// Deep, runtime-pure import: the one shared gate-state ordering (no db/pg in the
// client bundle -- see @crucible/core/src/gateRank).
import { GATE_STATE_RANK } from "@crucible/core/src/gateRank";
import { previewIdForHref } from "@/lib/featurePreviews";
import { CoBrandLockup, ProductFamilyBrand, ProductBrand } from "@/components/brand/BrandMarks";
import { ExternalLink, LockKeyhole, LogOut, Menu, Sparkles, X } from "lucide-react";

/**
 * Dashboard Layout -- Authenticated area
 *
 * Desktop: sticky top bar + left sidebar with grouped tool nav.
 * Mobile: sticky top bar + hamburger → slide-in drawer.
 * Locked tools shown greyed (unlockable through normal progression).
 * Admin/partner-only tools hidden for tiers that can never reach them.
 */

interface NavItem {
  href: string;
  label: string;
  minTier: UserTier;
  minState: OnboardingState;
  requiresDisclosure?: boolean;
}

interface NavGroup {
  label?: string;
  items: NavItem[];
}

const TIER_RANK: Record<string, number> = {
  admin: 0,
  unlimited: 1,
  partner: 1,
  client: 2,
  default: 2,
  observer: 3,
};

const NAV_GROUPS: NavGroup[] = [
  {
    items: [
      { href: "/dashboard", label: "Overview", minTier: "observer", minState: "needs_profile" },
    ],
  },
  // Nav order follows the core loop: find work FIRST (job board leads), then
  // the advanced build tools. See Refinery walkthrough feedback C6/C10.
  {
    label: "Find Work",
    items: [
      { href: "/dashboard/jobs", label: "Job Board", minTier: "client", minState: "needs_resume" },
      { href: "/dashboard/applications", label: "Applications", minTier: "client", minState: "full_access" },
      { href: "/dashboard/employers", label: "Verified Employers", minTier: "client", minState: "full_access" },
      { href: "/dashboard/resources", label: "Fair-Chance Lanes", minTier: "client", minState: "needs_profile" },
    ],
  },
  {
    label: "Build",
    items: [
      { href: "/dashboard/application-tailor", label: "Application Tailor", minTier: "client", minState: "needs_resume" },
      { href: "/dashboard/disclosure", label: "Disclosure", minTier: "client", minState: "full_access" },
      { href: "/dashboard/interview", label: "Interview Prep", minTier: "client", minState: "full_access", requiresDisclosure: true },
    ],
  },
  {
    label: "My Stuff",
    items: [
      { href: "/dashboard/vault", label: "Library", minTier: "client", minState: "needs_resume" },
      { href: "/dashboard/documents", label: "Vault", minTier: "client", minState: "needs_resume" },
      { href: "/dashboard/progress", label: "Progress", minTier: "observer", minState: "full_access" },
    ],
  },
  {
    label: "Program",
    items: [
      { href: "/dashboard/partner", label: "Partner Dashboard", minTier: "partner", minState: "needs_profile" },
    ],
  },
  {
    items: [
      { href: "/dashboard/help", label: "Help & Feedback", minTier: "observer", minState: "needs_profile" },
      { href: "/dashboard/settings", label: "Settings", minTier: "observer", minState: "needs_profile" },
      { href: "/dashboard/admin", label: "Admin", minTier: "admin", minState: "needs_profile" },
    ],
  },
];

// Org-oversight nav (org-oversight wave, 2026-08-07): an org admin/staff runs
// the organization -- the participant toolset (Job Board, Tailor, etc.) is NOT
// their nav; it lives behind the "Client view" toggle. These items lead the
// sidebar for org leaders instead of NAV_GROUPS.
interface OrgNavItem {
  href: string;
  label: string;
}
const ORG_ADMIN_NAV: OrgNavItem[] = [
  { href: "/dashboard", label: "Organization overview" },
  { href: "/dashboard#team", label: "Team & seats" },
  { href: "/dashboard#add", label: "Add participants" },
  // The person who has to answer for this internally should not have to ask
  // us for it, or find it in a PDF attached to an email six months ago.
  { href: "/dashboard/org-security", label: "Security & privacy" },
];
// The staff workspace (crm_v2 orgs). Grouped by the job, and every item is a
// real page: the earlier list was three entries, two of them jump-links into
// one long screen, which is why it read as thin. `admin` items need the
// organization-wide view.
interface OrgNavGroup {
  label: string;
  /** `needs`: shown only to people who hold that capability -- the nav mirrors
   *  the authorization model rather than guessing from a role name. */
  items: (OrgNavItem & { needs?: string })[];
}
const ORG_WORKSPACE_NAV: OrgNavGroup[] = [
  {
    label: "Work",
    items: [
      { href: "/dashboard", label: "Caseload" },
      { href: "/dashboard/requests", label: "Sharing requests" },
    ],
  },
  { label: "Records", items: [{ href: "/dashboard/notes", label: "Case notes" }] },
  {
    label: "Organization",
    items: [
      { href: "/dashboard/insights", label: "Insights", needs: "org.insights.view" },
      { href: "/dashboard/team", label: "Team & access", needs: "org.staff.manage" },
      { href: "/dashboard/participants", label: "Add participants", needs: "org.participant.invite" },
      { href: "/dashboard/org-security", label: "Security & privacy" },
    ],
  },
];

const ORG_STAFF_NAV: OrgNavItem[] = [
  { href: "/dashboard", label: "My clients" },
  { href: "/dashboard#add", label: "Add participants" },
  { href: "/dashboard/org-security", label: "Security & privacy" },
];

// Personal, account-scoped data cached in localStorage. Cleared on sign-out so
// the next person to use this browser can never inherit the previous user's
// Forge/resume/job data (shared-machine isolation).
const PERSONAL_LS_KEYS = [
  "forge_session",
  "forge_preload",
  "forge_audience",
  "consumer_progress",
  "saved_jobs",
  "hidden_jobs",
  "refinery_last_job_search",
  "pending_access_code",
  // Points at an approved resume artifact and is sent to the generator as the
  // tailoring base. Nothing used to clear it, so a previous person's approved
  // resume text could seed the next person's document.
  "active_baseline_id",
  "view_as",
  "forge_last_synced_run",
];

/**
 * Keys that belong to ONE Forge run and must not survive into the next.
 *
 * `forge_session` is deliberately absent: when a new run arrives, that key IS
 * the new run. Everything here is derived from a run and goes stale the moment
 * a different person's intake lands in the same browser.
 */
const RUN_SCOPED_LS_KEYS = [
  "forge_preload",
  "consumer_progress",
  "saved_jobs",
  "hidden_jobs",
  "refinery_last_job_search",
  "active_baseline_id",
];

/**
 * The last Forge run this browser synced. Deliberately NOT inside
 * `forge_session`: that blob is replaced on every fresh start, so a boundary
 * stored inside it disappears exactly when a new run begins.
 */
const LAST_SYNCED_RUN_KEY = "forge_last_synced_run";

function removeKeys(keys: readonly string[]) {
  for (const k of keys) {
    try {
      localStorage.removeItem(k);
    } catch {
      // ignore
    }
  }
}

function clearPersonalLocalStorage() {
  removeKeys(PERSONAL_LS_KEYS);
}

/** Called when a NEW Forge run arrives in a browser that already synced one. */
function clearRunScopedLocalStorage() {
  removeKeys(RUN_SCOPED_LS_KEYS);
}

function isNavUnlocked(
  item: NavItem,
  userTier: UserTier,
  onboardingState: OnboardingState,
  disclosureComplete: boolean,
): boolean {
  if (userTier === "admin") return true;
  if (userTier === "partner") {
    return (TIER_RANK[userTier] ?? 3) <= (TIER_RANK[item.minTier] ?? 3);
  }
  const tierRank = TIER_RANK[userTier] ?? 3;
  if (tierRank > (TIER_RANK[item.minTier] ?? 3)) return false;
  const stateRank = GATE_STATE_RANK[onboardingState] ?? 3;
  const requiredRank = GATE_STATE_RANK[item.minState] ?? 3;
  if (stateRank > requiredRank) return false;
  if (item.requiresDisclosure && !disclosureComplete) return false;
  return true;
}

// Hide items requiring a tier the user can never reach (partner-only, admin-only)
function shouldShowItem(item: NavItem, userTier: UserTier): boolean {
  if (item.minTier === "admin" && userTier !== "admin") return false;
  if (item.minTier === "partner" && userTier !== "partner" && userTier !== "admin") return false;
  return true;
}

/**
 * Role/view switch (walkthrough C7): partner and admin accounts can flip into
 * the real client experience and back. The persistent amber banner
 * (AdminTestModeBanner) marks client view; this control lives in the top nav.
 */
function ViewAsToggle() {
  const realTier = useRealTier();
  const effectiveRole = useEffectiveRole();
  const [asClient, setAsClient] = useState(false);

  useEffect(() => {
    setAsClient(getViewAs() === "client");
  }, []);

  // Admins get the full DevSwitcher instead.
  if (realTier !== "partner") return null;
  // STAFF HAVE NO RESUME WORKSPACE (Troy, 2026-09-20): "they are employed
  // already." This used to offer org members "My job search", a private
  // job-seeker space under the same login. It made a casework tool look like it
  // had confused its user for a client. Partners with no organization keep the
  // preview, which is how they see what their clients see.
  if (effectiveRole?.orgRole) return null;

  function toggle() {
    setViewAs(asClient ? null : "client");
    window.location.href = "/dashboard";
  }

  const label = asClient ? "Partner view" : "Client view";
  const title = asClient ? "Return to your partner view" : "Experience the platform exactly as a client";

  return (
    <button
      onClick={toggle}
      title={title}
      className="t-focus hidden sm:inline-flex min-h-touch items-center gap-1.5 rounded-[4px] border border-t-line px-2.5 text-xs font-medium text-t-bone-dim transition-colors hover:border-t-line-strong hover:text-t-white"
    >
      {label}
    </button>
  );
}

export function RefineryShell({
  children,
}: {
  children: ReactNode;
}) {
  const userTier = useUserTier();
  const { data: sessionData, status: authStatus } = useSession();
  const pathname = usePathname();
  const onboarding = useOnboarding();
  const { context: userFullContext } = useUserContext();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [unlockToast, setUnlockToast] = useState<string | null>(null);
  const prevState = useRef<string>("loading");
  const prevDisclosure = useRef(false);

  // Show unlock toast when key milestones flip
  useEffect(() => {
    const prev = prevState.current;
    const cur = onboarding.state;
    if (prev !== cur) {
      if (cur === "full_access" && prev !== "loading") {
        setUnlockToast("Tools unlocked. Disclosure Planner and more are ready.");
        setTimeout(() => setUnlockToast(null), 5000);
      }
      prevState.current = cur;
    }
    if (!prevDisclosure.current && onboarding.disclosureComplete && cur === "full_access") {
      setUnlockToast("Interview Prep is now unlocked.");
      setTimeout(() => setUnlockToast(null), 5000);
    }
    prevDisclosure.current = onboarding.disclosureComplete;
  }, [onboarding.state, onboarding.disclosureComplete]);

  // Close mobile drawer on navigation
  useEffect(() => {
    setDrawerOpen(false);
  }, [pathname]);

  // Gate: client users who have never done the Forge get sent there first.
  // View-as sessions (admin/partner in client view) AND impersonation
  // sessions are exempt from the HARD redirect -- bouncing them to the Forge
  // domain would strand the operator outside the app with no way to exit.
  // They see the in-app "Start with The Forge" state instead; every other
  // gate stays real.
  const effectiveRole = useEffectiveRole();
  useEffect(() => {
    if (
      authStatus === "authenticated" &&
      userTier === "client" &&
      getViewAs() === null &&
      !effectiveRole?.impersonating &&
      onboarding.state !== "loading" &&
      !onboarding.forgeComplete &&
      pathname !== "/dashboard/settings"
    ) {
      window.location.href = "https://forge.steelmanresumes.com";
    }
  }, [authStatus, userTier, effectiveRole?.impersonating, onboarding.state, onboarding.forgeComplete, pathname]);

  // Post-auth: redeem access codes + sync Forge data + sync audience tier
  useEffect(() => {
    const pendingCode = localStorage.getItem("pending_access_code");
    if (pendingCode) {
      localStorage.removeItem("pending_access_code");
      fetch("/api/access-code/redeem", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: pendingCode }),
      }).catch(() => {});
    }

    try {
      const audience = localStorage.getItem("forge_audience");
      if (audience && ["client", "partner", "observer"].includes(audience)) {
        localStorage.removeItem("forge_audience");
        fetch("/api/user/set-tier", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tier: audience }),
        }).catch(() => {});
      }
    } catch {
      // Silent
    }

    // Forge session sync -- with hard cross-user isolation. A Forge blob in
    // localStorage belongs to exactly one account; on a shared browser it must
    // never sync to, or render for, a different user (prevents the data bleed
    // where account A's resume showed up under account B).
    try {
      const stored = localStorage.getItem("forge_session");
      if (!stored) return;
      const forgeData = JSON.parse(stored);
      const uid = sessionData?.user?.id;
      if (!uid) return; // wait until the signed-in user id is known

      if (forgeData._ownerUserId && forgeData._ownerUserId !== uid) {
        // Foreign blob: purge so it can't sync to or surface for this account.
        clearPersonalLocalStorage();
        window.dispatchEvent(new Event("forge-synced"));
        return;
      }

      if (!forgeData.forgeOutput && !forgeData.resumeText) return;

      // RUN BOUNDARY. `startedAt` identifies one Forge run; `_syncedAt` records
      // the run this browser last synced. When a DIFFERENT run arrives, every
      // key derived from the previous one is stale -- the prior persona's
      // approved baseline, saved and hidden jobs, progress counters, and the
      // last job search with its full result list. They used to survive, which
      // is how one browser ended up showing several personas' demos stacked on
      // one screen. Clear before rebuilding the preload below, not after.
      // The last run we synced is remembered OUTSIDE the intake blob, because
      // the blob is exactly what a fresh start replaces: the welcome page
      // clears forge_session before building a new run, which takes _syncedAt
      // with it. Reading the boundary from the thing being replaced meant the
      // NORMAL fresh-start path skipped this cleanup entirely, which is the
      // path that matters most. (Found in review, 2026-09-19.)
      const runId = forgeData.startedAt || "unknown";
      let priorSyncedAt: string | null = null;
      try {
        priorSyncedAt =
          localStorage.getItem(LAST_SYNCED_RUN_KEY) || forgeData._syncedAt || null;
      } catch {
        priorSyncedAt = forgeData._syncedAt || null;
      }
      if (priorSyncedAt && priorSyncedAt !== runId) {
        clearRunScopedLocalStorage();
      }

      try {
        import("@/lib/forge-preload").then(({ buildForgePreload, saveForgePreload }) => {
          const preload = buildForgePreload(forgeData);
          saveForgePreload(preload);
        }).catch(() => {});
      } catch {
        // Preload build failed — not critical
      }

      const currentStartedAt = runId;
      if (priorSyncedAt === currentStartedAt && forgeData._ownerUserId === uid) return;

      fetch("/api/forge/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: stored,
      })
        .then((res) => {
          if (res.ok) {
            forgeData._synced = true;
            forgeData._syncedAt = currentStartedAt;
            forgeData._ownerUserId = uid; // claim this blob for the current account
            localStorage.setItem("forge_session", JSON.stringify(forgeData));
            try {
              localStorage.setItem(LAST_SYNCED_RUN_KEY, currentStartedAt);
            } catch {
              // Storage unavailable: we fall back to the in-blob marker.
            }
            window.dispatchEvent(new Event("forge-synced"));
          }
        })
        .catch(() => {});
    } catch {
      // Silent
    }
  }, [authStatus, sessionData?.user?.id]);

  // New-device sign-in alert (fingerprints this device server-side; emails the
  // user if it's a new device on their account) + record this session's device
  // for the active-devices list / revoke. Fire-and-forget, once.
  useEffect(() => {
    if (authStatus === "authenticated") {
      fetch("/api/auth/signin-alert", { method: "POST" }).catch(() => {});
      fetch("/api/auth/session-ping", { method: "POST" }).catch(() => {});
    }
  }, [authStatus]);

  // Admin 2FA enforcement: an admin account without two-step verification is
  // guided (not locked) to Settings to turn it on. Only in a real admin session
  // (not view-as, so QA impersonation isn't disrupted).
  const realTier = useRealTier();
  const [adminNeeds2fa, setAdminNeeds2fa] = useState(false);
  useEffect(() => {
    if (realTier === "admin" && getViewAs() === null) {
      fetch("/api/user/security-status")
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => setAdminNeeds2fa(!!d && !d.twoFactorEnabled))
        .catch(() => {});
    } else {
      setAdminNeeds2fa(false);
    }
  }, [realTier]);
  useEffect(() => {
    if (adminNeeds2fa && pathname !== "/dashboard/settings") {
      window.location.href = "/dashboard/settings";
    }
  }, [adminNeeds2fa, pathname]);

  // Role-aware nav framing (role-clear wave): the first item names the
  // landing the user actually gets, and org leaders see the client toolset
  // labeled as what it is -- the tools their clients use.
  const orgRole = effectiveRole?.orgRole ?? null;
  // Tier from the DATABASE, not the session claim. The claim is minted at
  // sign-in and goes stale, so someone promoted to org staff would keep the
  // job-seeker nav -- Job Board, Application Tailor, Interview Prep -- until
  // they happened to sign out and back in. A case manager's nav is their
  // caseload; the client toolset lives behind the explicit "client view"
  // toggle and nowhere else.
  const resolvedTier = effectiveRole?.tier ?? userTier;
  const isOrgPartner = resolvedTier === "partner" && !!orgRole;
  const isOrgAdmin = orgRole === "owner" || orgRole === "org_admin";

  // Org leaders drop into the client experience through this one control
  // (mirrors the top-bar ViewAsToggle, but reachable from the nav on mobile).
  // Somebody on staff who used the old "My job search" switch still has that
  // choice saved in their browser, and the switch that would undo it is gone.
  // Without this they would be stranded in the client experience.
  useEffect(() => {
    if (orgRole && getViewAs()) {
      setViewAs(null);
      window.location.href = "/dashboard";
    }
  }, [orgRole]);

  function navItemLabel(item: NavItem): string {
    if (item.href !== "/dashboard") return item.label;
    if (userTier === "admin") return "Operator Home";
    if (isOrgPartner) return "My Organization";
    return item.label;
  }

  function navGroupLabel(group: NavGroup): string | undefined {
    if (userTier === "partner" && group.label === "Find Work") {
      return "Client tools -- what your clients see";
    }
    return group.label;
  }

  function renderNavItems(onItemClick?: () => void) {
    return NAV_GROUPS.map((group, gi) => {
      const visible = group.items.filter((item) => {
        // Org leaders' Overview IS the org dashboard -- hide the duplicate
        // Partner Dashboard entry for them (admins keep it: it is the entry
        // to the all-cohorts view and the ?codeId override target).
        if (item.href === "/dashboard/partner" && isOrgPartner) return false;
        return shouldShowItem(item, userTier);
      });
      if (!visible.length) return null;

      const groupLabel = navGroupLabel(group);
      return (
        <div key={gi} className={gi > 0 ? "mt-2 border-t border-t-line pt-3" : ""}>
          {groupLabel && (
            <p className="mb-1 px-3 font-term text-[9px] font-semibold uppercase text-t-bone-dim">
              {groupLabel}
            </p>
          )}
          {visible.map((item) => {
            const unlocked = isNavUnlocked(item, userTier, onboarding.state, onboarding.disclosureComplete);
            const isActive = pathname === item.href;

            // Human-readable lock reason
            const lockReason = (() => {
              if (onboarding.state === "needs_profile") return "Complete your profile to unlock";
              if (onboarding.state === "needs_resume") return "Build a targeted resume to unlock";
              if (item.requiresDisclosure && !onboarding.disclosureComplete) return "Complete the Disclosure Planner to unlock";
              return "Keep going to unlock this";
            })();

            if (!unlocked) {
              // Phase 4.1: no dead ends. A locked tool that has a preview becomes
              // a LINK to that preview (lock badge kept as the "not yet yours"
              // cue). The preview is informational only -- the real tool page
              // still enforces the gate at action depth. Tools with no preview
              // entry keep the plain locked affordance.
              const previewId = previewIdForHref(item.href);
              if (previewId) {
                return (
                  <Link
                    key={item.href}
                    href={`/dashboard/preview/${previewId}`}
                    onClick={onItemClick}
                    title={`${lockReason} -- see a preview`}
                    className="t-focus flex min-h-[40px] items-center justify-between rounded-[4px] border-l-[3px] border-transparent px-3 py-2 text-sm font-medium text-[#9ca29b] transition-colors hover:bg-t-panel-2 hover:text-t-white"
                  >
                    <span>{navItemLabel(item)}</span>
                    <LockKeyhole size={13} className="opacity-60" aria-hidden="true" />
                  </Link>
                );
              }
              return (
                <div
                  key={item.href}
                  className="flex min-h-[40px] cursor-not-allowed select-none items-center justify-between rounded-[4px] px-3 py-2 text-sm text-[#9ca29b]"
                  title={lockReason}
                >
                  <span>{navItemLabel(item)}</span>
                  <LockKeyhole size={13} className="opacity-60" aria-hidden="true" />
                </div>
              );
            }

            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={onItemClick}
                data-tour={`nav-${item.href.split("/").pop()}`}
                className={`t-focus flex min-h-[40px] items-center rounded-[4px] border-l-[3px] px-3 py-2 text-sm font-medium transition-colors ${
                  isActive
                    ? "border-[#4f6b57] bg-[#e3ede5] text-[#344b38]"
                    : "border-transparent text-t-bone-dim hover:bg-t-panel-2 hover:text-t-white"
                }`}
              >
                {navItemLabel(item)}
              </Link>
            );
          })}
        </div>
      );
    });
  }

  function renderOrgNav(onItemClick?: () => void) {
    const linkClass = (active: boolean) =>
      `t-focus flex min-h-[40px] items-center rounded-[4px] border-l-[3px] px-3 py-2 text-sm font-medium transition-colors ${
        active
          ? "border-[#4f6b57] bg-[#e3ede5] text-[#344b38]"
          : "border-transparent text-t-bone-dim hover:bg-t-panel-2 hover:text-t-white"
      }`;
    // A participant's page belongs to Caseload, so Caseload stays lit there.
    const isActive = (href: string) =>
      href === pathname || (href === "/dashboard" && pathname.startsWith("/dashboard/clients/"));

    const workspace = !!effectiveRole?.crmV2;
    const flat = isOrgAdmin ? ORG_ADMIN_NAV : ORG_STAFF_NAV;
    return (
      <>
        {workspace ? (
          ORG_WORKSPACE_NAV.map((group, gi) => {
            const caps = effectiveRole?.capabilities ?? [];
            const items = group.items.filter((i) => !i.needs || caps.includes(i.needs));
            if (items.length === 0) return null;
            return (
              <div key={group.label} className={gi > 0 ? "mt-3" : ""}>
                <p className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-t-bone-dim">
                  {group.label}
                </p>
                {items.map((item) => (
                  <Link key={item.href} href={item.href} onClick={onItemClick}
                    aria-current={isActive(item.href) ? "page" : undefined} className={linkClass(isActive(item.href))}>
                    {item.label}
                  </Link>
                ))}
              </div>
            );
          })
        ) : (
          <div>
            {flat.map((item) => (
              <Link key={item.label} href={item.href} onClick={onItemClick} className={linkClass(item.href === pathname)}>
                {item.label}
              </Link>
            ))}
          </div>
        )}

        <div className="mt-2 border-t border-t-line pt-3">
          <Link
            href="/dashboard/settings"
            onClick={onItemClick}
            className={`t-focus flex min-h-[40px] items-center rounded-[4px] border-l-[3px] px-3 py-2 text-sm font-medium transition-colors ${
              pathname === "/dashboard/settings"
                ? "border-[#4f6b57] bg-[#e3ede5] text-[#344b38]"
                : "border-transparent text-t-bone-dim hover:bg-t-panel-2 hover:text-t-white"
            }`}
          >
            Settings
          </Link>
        </div>
      </>
    );
  }

  return (
    <div className="refinery-app min-h-screen bg-t-bg font-body">
      {/* Applies the user's saved accessibility prefs app-wide (Phase 7.2). */}
      <UiPrefsApplier />
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:rounded-[4px] focus:bg-t-panel focus:px-4 focus:py-2.5 focus:text-sm focus:font-medium focus:text-t-white focus:shadow-xl"
      >
        Skip to content
      </a>
      <AdminTestModeBanner />
      <HighlightHost />
      <nav className="sticky top-0 z-30 border-b border-t-line bg-t-panel/95 backdrop-blur">
        <div className="px-4 sm:px-6">
          <div className="flex h-[72px] items-center justify-between gap-4">

            {/* Left: hamburger (mobile) + logo */}
            <div className="flex items-center gap-3">
              <button
                onClick={() => setDrawerOpen(true)}
                className="t-focus -ml-2 flex h-11 w-11 items-center justify-center rounded-[4px] text-t-bone-dim transition-colors hover:bg-t-panel-2 hover:text-t-white md:hidden"
                aria-label="Open navigation"
              >
                <Menu size={21} aria-hidden="true" />
              </button>
              <ProductFamilyBrand product="refinery" productHref="/dashboard" />
            </div>

            {/* Right: account links */}
            <div className="flex items-center gap-2 sm:gap-4">
              <DevSwitcher />
              <ViewAsToggle />
              <CoBrandLockup compact className="hidden xl:flex" />
              <a
                href="https://forge.steelmanresumes.com"
                target="_blank"
                rel="noopener noreferrer"
                className="t-focus hidden min-h-touch items-center gap-1 rounded-[4px] px-2 text-sm text-t-bone-dim transition-colors hover:bg-t-panel-2 hover:text-t-white lg:flex"
              >
                The Forge
                <ExternalLink size={14} aria-hidden="true" />
              </a>
              <Link
                href="/dashboard/settings"
                aria-label="Settings"
                className="t-focus flex min-h-touch items-center gap-2 rounded-[4px] px-2 text-sm text-t-bone-dim transition-colors hover:bg-t-panel-2 hover:text-t-white"
              >
                <NavAvatar size={28} />
                <span className="hidden sm:inline">Settings</span>
              </Link>
              <button
                onClick={() => {
                  clearPersonalLocalStorage();
                  signOut({ callbackUrl: "/login" });
                }}
                className="t-focus flex min-h-touch items-center gap-1.5 rounded-[4px] px-2 text-sm text-t-bone-dim transition-colors hover:bg-t-panel-2 hover:text-t-white"
              >
                <LogOut size={15} aria-hidden="true" />
                <span className="hidden sm:inline">Sign out</span>
              </button>
            </div>
          </div>
        </div>
      </nav>

      {/* Body: sidebar + content */}
      <div className="flex min-h-[calc(100vh-72px)]">

        {/* Left sidebar -- desktop only */}
        <aside className="hidden w-60 flex-shrink-0 border-r border-t-line bg-t-panel md:block">
          <div className="sticky top-[72px] h-[calc(100vh-72px)] space-y-1 overflow-y-auto px-3 py-5">
            <p className="mb-4 px-3 font-term text-[10px] font-semibold uppercase text-[#4f6b57]">
              {isOrgPartner ? "Organization" : "Career workspace"}
            </p>
            {isOrgPartner ? renderOrgNav() : renderNavItems()}
          </div>
        </aside>

        {/* Main content */}
        <main id="main" className="min-w-0 flex-1 px-4 py-8 pb-32 sm:px-7 sm:pb-8 lg:px-10">
          {adminNeeds2fa && (
            <div className="mb-6 border border-t-amber bg-t-panel px-4 py-3 text-sm text-t-amber-bright">
              <span className="font-semibold">Two-step verification is required for admin accounts.</span>{" "}
              Set it up under <span className="font-semibold">Security</span> below to secure your account.
            </div>
          )}
          {/* The client journey banner is participant chrome -- org leaders run
              the org, they are not working a resume journey here. */}
          {/* DEMO ORGANIZATIONS SAY SO, ON EVERY SCREEN. Their participants are
              invented, and some are paired with real local employers so the
              demonstration looks like the real world. Without this line a made-up
              placement at a named employer could be read as a claim that it happened. */}
          {isOrgPartner && /\(Demo\)\s*$/.test(effectiveRole?.orgName ?? "") && (
            <p role="note" className="border-b border-t-amber/40 bg-t-panel px-4 py-1.5 text-center text-xs text-t-amber-bright">
              Sample data. These participants are fictional. The employers and local services named are real; no application or hire shown here took place.
            </p>
          )}
          {!isOrgPartner && <JourneyProgressBanner state={onboarding.state} />}
          {children}
        </main>
      </div>

      {/* First-run orientation -- self-gating (client tier, DB-persisted) */}
      <GuidedTour />

      {/* Developer impersonation frame (blue view / red assist) */}
      <ImpersonationChrome />

      {/* Mobile drawer overlay */}
      {drawerOpen && (
        <div
          className="fixed inset-0 bg-black/60 z-40 md:hidden"
          onClick={() => setDrawerOpen(false)}
        />
      )}

      {/* Mobile drawer panel */}
      <div
        className={`fixed bottom-0 left-0 top-0 z-50 w-[min(19rem,88vw)] overflow-y-auto border-r border-t-line bg-t-panel shadow-xl transition-transform duration-200 md:hidden ${
          drawerOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex h-[72px] items-center justify-between border-b border-t-line px-4">
          <ProductBrand product="refinery" href="/dashboard" />
          <button
            onClick={() => setDrawerOpen(false)}
            className="t-focus flex h-11 w-11 items-center justify-center rounded-[4px] text-t-bone-dim transition-colors hover:bg-t-panel-2 hover:text-t-white"
            aria-label="Close navigation"
          >
            <X size={20} aria-hidden="true" />
          </button>
        </div>
        <div className="px-2 py-4 space-y-1">
          {isOrgPartner ? renderOrgNav(() => setDrawerOpen(false)) : renderNavItems(() => setDrawerOpen(false))}
          <div className="mt-3 pt-3 border-t border-t-line space-y-1">
            <a
              href="https://forge.steelmanresumes.com"
              target="_blank"
              rel="noopener noreferrer"
              className="flex min-h-touch items-center gap-1.5 rounded-[4px] px-3 py-2 text-sm text-t-bone-dim transition-colors hover:bg-t-panel-2 hover:text-t-white"
            >
              The Forge <ExternalLink size={14} aria-hidden="true" />
            </a>
            <button
              onClick={() => {
                clearPersonalLocalStorage();
                signOut({ callbackUrl: "/login" });
              }}
              className="flex min-h-touch w-full items-center gap-1.5 rounded-[4px] px-3 py-2 text-left text-sm text-t-bone-dim transition-colors hover:bg-t-panel-2 hover:text-t-white"
            >
              <LogOut size={14} aria-hidden="true" /> Sign out
            </button>
          </div>
        </div>
      </div>

      {/* AI Assistant */}
      <AssistantDrawer>
        <AssistantChat
          context={{
            currentPage: pathname === "/dashboard" ? "dashboard" : pathname.replace("/dashboard/", ""),
            forgeComplete: onboarding.state !== "needs_profile",
            readinessStage: userFullContext?.forge?.readinessStage ?? undefined,
            skills: userFullContext?.forge?.skills?.map((s) => (typeof s === "string" ? s : (s as any).name)).filter(Boolean) ?? undefined,
            barriers: userFullContext?.forge?.barriers ?? undefined,
            hasCriminalRecord: userFullContext?.forge?.hasCriminalRecord ?? undefined,
            userFullContext,
          }}
          // Org staff get t.ROY's caseload assistant (/api/assistant resolves
          // their org server-side). The Refinery coach is a job-seeker's coach
          // and answered a case manager as if they needed a resume.
          coach={!isOrgPartner}
          staff={isOrgPartner}
        />
      </AssistantDrawer>

      {/* Unlock toast */}
      {unlockToast && (
        <div className="fixed bottom-24 sm:bottom-8 left-1/2 -translate-x-1/2 z-50 pointer-events-none">
          <div className="flex items-center gap-2 rounded-[6px] border border-[#b9cdbd] bg-[#e3ede5] px-5 py-3 text-sm font-medium text-[#344b38] shadow-[0_8px_22px_rgba(22,26,21,0.14)]">
            <Sparkles size={16} aria-hidden="true" />
            {unlockToast}
          </div>
        </div>
      )}
    </div>
  );
}
