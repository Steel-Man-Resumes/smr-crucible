"use client";

import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut, useSession } from "next-auth/react";
import { AssistantDrawer } from "@crucible/consumer-ui";
import { AssistantChat } from "@/components/AssistantChat";
import { JourneyProgressBanner } from "@/components/JourneyProgressBanner";
import { AdminTestModeBanner } from "@/components/AdminTestModeBanner";
import { GuidedTour } from "@/components/GuidedTour";
import { DevSwitcher } from "@/components/DevSwitcher";
import { ImpersonationChrome } from "@/components/ImpersonationChrome";
import {
  useUserTier,
  useRealTier,
  canSwitchView,
  getViewAs,
  setViewAs,
  type UserTier,
} from "@/lib/useUserTier";
import { useOnboarding, type OnboardingState } from "@/lib/useOnboarding";
import { useUserContext } from "@/lib/use-user-context";
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

const STATE_RANK: Record<string, number> = {
  full_access: 0,
  needs_resume: 1,
  needs_profile: 2,
  loading: 3,
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
      { href: "/dashboard/vault", label: "My Materials", minTier: "client", minState: "needs_resume" },
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
      { href: "/dashboard/settings", label: "Settings", minTier: "observer", minState: "needs_profile" },
      { href: "/dashboard/admin", label: "Admin", minTier: "admin", minState: "needs_profile" },
    ],
  },
];

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
  const stateRank = STATE_RANK[onboardingState] ?? 3;
  const requiredRank = STATE_RANK[item.minState] ?? 3;
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
  const [asClient, setAsClient] = useState(false);

  useEffect(() => {
    setAsClient(getViewAs() === "client");
  }, []);

  // Admins get the full DevSwitcher instead.
  if (realTier !== "partner") return null;

  function toggle() {
    if (asClient) {
      setViewAs(null);
    } else {
      setViewAs("client");
    }
    window.location.href = "/dashboard";
  }

  const roleLabel = "Partner";

  return (
    <button
      onClick={toggle}
      title={
        asClient
          ? `Return to your ${roleLabel.toLowerCase()} view`
          : "Experience the platform exactly as a client"
      }
      className="t-focus hidden sm:inline-flex min-h-touch items-center gap-1.5 rounded-[4px] border border-t-line px-2.5 text-xs font-medium text-t-bone-dim transition-colors hover:border-t-line-strong hover:text-t-white"
    >
      {asClient ? `${roleLabel} view` : "Client view"}
    </button>
  );
}

export function RefineryShell({
  children,
}: {
  children: ReactNode;
}) {
  const userTier = useUserTier();
  const { status: authStatus } = useSession();
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
  // View-as sessions (admin/partner in client view) are exempt from the HARD
  // redirect -- bouncing them to the Forge domain would strand them outside
  // the app with no way to exit client view. They see the in-app "Start with
  // The Forge" state instead; every other gate stays real.
  useEffect(() => {
    if (
      authStatus === "authenticated" &&
      userTier === "client" &&
      getViewAs() !== "client" &&
      onboarding.state !== "loading" &&
      !onboarding.forgeComplete &&
      pathname !== "/dashboard/settings"
    ) {
      window.location.href = "https://forge.steelmanresumes.com";
    }
  }, [authStatus, userTier, onboarding.state, onboarding.forgeComplete, pathname]);

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

    try {
      const stored = localStorage.getItem("forge_session");
      if (!stored) return;
      const forgeData = JSON.parse(stored);
      if (!forgeData.forgeOutput && !forgeData.resumeText) return;

      try {
        import("@/lib/forge-preload").then(({ buildForgePreload, saveForgePreload }) => {
          const preload = buildForgePreload(forgeData);
          saveForgePreload(preload);
        }).catch(() => {});
      } catch {
        // Preload build failed — not critical
      }

      const syncedAt = forgeData._syncedAt;
      const currentStartedAt = forgeData.startedAt || "unknown";
      if (syncedAt === currentStartedAt) return;

      fetch("/api/forge/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: stored,
      })
        .then((res) => {
          if (res.ok) {
            forgeData._synced = true;
            forgeData._syncedAt = currentStartedAt;
            localStorage.setItem("forge_session", JSON.stringify(forgeData));
            window.dispatchEvent(new Event("forge-synced"));
          }
        })
        .catch(() => {});
    } catch {
      // Silent
    }
  }, []);

  function renderNavItems(onItemClick?: () => void) {
    return NAV_GROUPS.map((group, gi) => {
      const visible = group.items.filter((item) => shouldShowItem(item, userTier));
      if (!visible.length) return null;

      return (
        <div key={gi} className={gi > 0 ? "mt-2 border-t border-t-line pt-3" : ""}>
          {group.label && (
            <p className="mb-1 px-3 font-term text-[9px] font-semibold uppercase text-t-bone-dim">
              {group.label}
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
              return (
                <div
                  key={item.href}
                  className="flex min-h-[40px] cursor-not-allowed select-none items-center justify-between rounded-[4px] px-3 py-2 text-sm text-[#9ca29b]"
                  title={lockReason}
                >
                  <span>{item.label}</span>
                  <LockKeyhole size={13} className="opacity-60" aria-hidden="true" />
                </div>
              );
            }

            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={onItemClick}
                className={`t-focus flex min-h-[40px] items-center rounded-[4px] border-l-[3px] px-3 py-2 text-sm font-medium transition-colors ${
                  isActive
                    ? "border-[#4f6b57] bg-[#e3ede5] text-[#344b38]"
                    : "border-transparent text-t-bone-dim hover:bg-t-panel-2 hover:text-t-white"
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </div>
      );
    });
  }

  return (
    <div className="refinery-app min-h-screen bg-t-bg font-body">
      <AdminTestModeBanner />
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
                className="t-focus hidden min-h-touch items-center rounded-[4px] px-2 text-sm text-t-bone-dim transition-colors hover:bg-t-panel-2 hover:text-t-white sm:flex"
              >
                Settings
              </Link>
              <button
                onClick={() => signOut({ callbackUrl: "/login" })}
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
            <p className="mb-4 px-3 font-term text-[10px] font-semibold uppercase text-[#4f6b57]">Career workspace</p>
            {renderNavItems()}
          </div>
        </aside>

        {/* Main content */}
        <main className="min-w-0 flex-1 px-4 py-8 pb-32 sm:px-7 sm:pb-8 lg:px-10">
          <JourneyProgressBanner state={onboarding.state} />
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
          {renderNavItems(() => setDrawerOpen(false))}
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
              onClick={() => signOut({ callbackUrl: "/login" })}
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
          coach
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
