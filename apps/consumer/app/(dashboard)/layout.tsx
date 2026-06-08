"use client";

import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import { AssistantDrawer } from "@crucible/consumer-ui";
import { AssistantChat } from "@/components/AssistantChat";
import { JourneyProgressBanner } from "@/components/JourneyProgressBanner";
import { useUserTier, type UserTier } from "@/lib/useUserTier";
import { useOnboarding, type OnboardingState } from "@/lib/useOnboarding";
import { useUserContext } from "@/lib/use-user-context";

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
  {
    label: "Build",
    items: [
      { href: "/dashboard/resume-builder", label: "Resume Builder", minTier: "client", minState: "needs_resume" },
      { href: "/dashboard/disclosure", label: "Disclosure", minTier: "client", minState: "full_access" },
      { href: "/dashboard/interview", label: "Interview Prep", minTier: "client", minState: "full_access", requiresDisclosure: true },
    ],
  },
  {
    label: "Find Work",
    items: [
      { href: "/dashboard/jobs", label: "Job Board", minTier: "client", minState: "needs_resume" },
      { href: "/dashboard/employers", label: "Verified Employers", minTier: "client", minState: "full_access" },
      { href: "/dashboard/applications", label: "Applications", minTier: "client", minState: "full_access" },
      { href: "/dashboard/resources", label: "Fair-Chance Lanes", minTier: "client", minState: "needs_profile" },
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

export default function DashboardLayout({
  children,
}: {
  children: ReactNode;
}) {
  const userTier = useUserTier();
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
        setUnlockToast("Tools unlocked -- Disclosure Planner and more are ready.");
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
  useEffect(() => {
    if (
      userTier === "client" &&
      onboarding.state !== "loading" &&
      !onboarding.forgeComplete &&
      pathname !== "/dashboard/settings"
    ) {
      window.location.href = "https://forge.steelmanresumes.com";
    }
  }, [userTier, onboarding.state, onboarding.forgeComplete, pathname]);

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
        <div key={gi} className={gi > 0 ? "mt-1 pt-3 border-t border-border/60" : ""}>
          {group.label && (
            <p className="px-3 mb-1 text-[10px] font-bold text-muted/70 uppercase tracking-widest">
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
                  className="flex items-center justify-between px-3 py-2 text-sm text-gray-300 cursor-not-allowed select-none rounded-lg"
                  title={lockReason}
                >
                  <span>{item.label}</span>
                  <svg width="11" height="11" viewBox="0 0 12 12" fill="currentColor" className="opacity-50">
                    <path d="M9 5V4a3 3 0 10-6 0v1H2v5a1 1 0 001 1h6a1 1 0 001-1V5H9zM4 4a2 2 0 114 0v1H4V4z" />
                  </svg>
                </div>
              );
            }

            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={onItemClick}
                className={`flex items-center px-3 py-2 text-sm font-medium rounded-lg transition-colors ${
                  isActive
                    ? "bg-sage-100 text-foreground"
                    : "text-muted hover:bg-sage-50 hover:text-foreground"
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
    <div className="min-h-screen bg-background">
      {/* Top bar */}
      <nav className="sticky top-0 z-30 bg-white/95 backdrop-blur border-b border-border">
        <div className="px-4 sm:px-6">
          <div className="flex items-center justify-between h-16">

            {/* Left: hamburger (mobile) + logo */}
            <div className="flex items-center gap-3">
              <button
                onClick={() => setDrawerOpen(true)}
                className="md:hidden p-2 -ml-2 text-muted hover:text-foreground transition-colors"
                aria-label="Open navigation"
              >
                <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                  <path fillRule="evenodd" d="M3 5h14a1 1 0 010 2H3a1 1 0 010-2zm0 4h14a1 1 0 010 2H3a1 1 0 010-2zm0 4h14a1 1 0 010 2H3a1 1 0 010-2z" clipRule="evenodd" />
                </svg>
              </button>
              <Link href="/dashboard" className="font-bold text-lg text-foreground">
                Steel Man
              </Link>
            </div>

            {/* Right: account links */}
            <div className="flex items-center gap-4">
              <a
                href="https://forge.steelmanresumes.com"
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-muted hover:text-foreground transition-colors"
              >
                The Forge
              </a>
              <Link
                href="/dashboard/settings"
                className="hidden sm:block text-sm text-muted hover:text-foreground transition-colors"
              >
                Settings
              </Link>
              <button
                onClick={() => signOut({ callbackUrl: "/login" })}
                className="text-sm text-muted hover:text-foreground transition-colors"
              >
                Sign Out
              </button>
            </div>
          </div>
        </div>
      </nav>

      {/* Body: sidebar + content */}
      <div className="flex min-h-[calc(100vh-64px)]">

        {/* Left sidebar -- desktop only */}
        <aside className="hidden md:block w-52 flex-shrink-0 border-r border-border bg-white">
          <div className="sticky top-16 h-[calc(100vh-64px)] overflow-y-auto px-2 py-4 space-y-1">
            {renderNavItems()}
          </div>
        </aside>

        {/* Main content */}
        <main className="flex-1 min-w-0 px-4 sm:px-6 py-8 pb-32 sm:pb-8">
          <JourneyProgressBanner state={onboarding.state} />
          {children}
        </main>
      </div>

      {/* Mobile drawer overlay */}
      {drawerOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-40 md:hidden"
          onClick={() => setDrawerOpen(false)}
        />
      )}

      {/* Mobile drawer panel */}
      <div
        className={`fixed left-0 top-0 bottom-0 w-72 bg-white z-50 shadow-xl overflow-y-auto transition-transform duration-200 md:hidden ${
          drawerOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex items-center justify-between px-4 h-16 border-b border-border">
          <Link
            href="/dashboard"
            onClick={() => setDrawerOpen(false)}
            className="font-bold text-lg text-foreground"
          >
            Steel Man
          </Link>
          <button
            onClick={() => setDrawerOpen(false)}
            className="p-2 text-muted hover:text-foreground transition-colors"
            aria-label="Close navigation"
          >
            <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
              <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
            </svg>
          </button>
        </div>
        <div className="px-2 py-4 space-y-1">
          {renderNavItems(() => setDrawerOpen(false))}
          <div className="mt-3 pt-3 border-t border-border/60 space-y-1">
            <a
              href="https://forge.steelmanresumes.com"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center px-3 py-2 text-sm text-muted hover:text-foreground hover:bg-sage-50 rounded-lg transition-colors"
            >
              The Forge &#8599;
            </a>
            <button
              onClick={() => signOut({ callbackUrl: "/login" })}
              className="w-full flex items-center px-3 py-2 text-sm text-muted hover:text-foreground hover:bg-sage-50 rounded-lg transition-colors text-left"
            >
              Sign Out
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
          <div className="bg-sage-700 text-white text-sm font-medium px-5 py-3 rounded-full shadow-xl flex items-center gap-2">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M10 2H6a1 1 0 00-1 1v1H4a1 1 0 00-1 1v8a1 1 0 001 1h8a1 1 0 001-1V5a1 1 0 00-1-1h-1V3a1 1 0 00-1-1zM6 4h4v.5H6V4zM8 9a1.5 1.5 0 110 3 1.5 1.5 0 010-3z" fill="currentColor"/>
            </svg>
            {unlockToast}
          </div>
        </div>
      )}
    </div>
  );
}
