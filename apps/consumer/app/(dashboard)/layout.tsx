"use client";

import type { ReactNode } from "react";
import { useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import { AssistantDrawer } from "@crucible/consumer-ui";
import { AssistantChat } from "@/components/AssistantChat";
import { ContactTroyButton } from "@/components/ContactTroyButton";
import { GuidedTour } from "@/components/GuidedTour";
import { useUserTier, type UserTier } from "@/lib/useUserTier";
import { useOnboarding, type OnboardingState } from "@/lib/useOnboarding";

/**
 * Dashboard Layout — Authenticated area
 *
 * Persistent navigation for Refinery tools.
 * Nav items: always visible, locked until earned.
 * Admin tier = god mode (everything unlocked).
 */

interface NavItem {
  href: string;
  label: string;
  minTier: UserTier;
  /** Minimum onboarding state to unlock this nav item */
  minState: OnboardingState;
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

const NAV_ITEMS: NavItem[] = [
  { href: "/dashboard", label: "Overview", minTier: "observer", minState: "needs_profile" },
  { href: "/dashboard/jobs", label: "Job Board", minTier: "client", minState: "needs_resume" },
  { href: "/dashboard/resume-builder", label: "Resume Builder", minTier: "client", minState: "needs_resume" },
  { href: "/dashboard/disclosure", label: "Disclosure", minTier: "client", minState: "full_access" },
  { href: "/dashboard/interview", label: "Interview Prep", minTier: "client", minState: "full_access" },
  { href: "/dashboard/resources", label: "Fair-Chance Lanes", minTier: "client", minState: "full_access" },
  { href: "/dashboard/employers", label: "Verified Employers", minTier: "client", minState: "full_access" },
  { href: "/dashboard/applications", label: "Applications", minTier: "client", minState: "full_access" },
  { href: "/dashboard/vault", label: "My Materials", minTier: "client", minState: "needs_resume" },
  { href: "/dashboard/progress", label: "Progress", minTier: "observer", minState: "full_access" },
  { href: "/dashboard/partner", label: "Partner Dashboard", minTier: "partner", minState: "needs_profile" },
  { href: "/dashboard/settings", label: "Settings", minTier: "observer", minState: "needs_profile" },
  { href: "/dashboard/admin", label: "Admin", minTier: "admin", minState: "needs_profile" },
];

function isNavUnlocked(item: NavItem, userTier: UserTier, onboardingState: OnboardingState): boolean {
  // Admin = god mode
  if (userTier === "admin") return true;
  // Partner = all tools visible, onboarding state skipped (tier check still applies)
  if (userTier === "partner") {
    return (TIER_RANK[userTier] ?? 3) <= (TIER_RANK[item.minTier] ?? 3);
  }
  // Tier check
  const tierRank = TIER_RANK[userTier] ?? 3;
  if (tierRank > (TIER_RANK[item.minTier] ?? 3)) return false;
  // Onboarding state check
  const stateRank = STATE_RANK[onboardingState] ?? 3;
  const requiredRank = STATE_RANK[item.minState] ?? 3;
  return stateRank <= requiredRank;
}

export default function DashboardLayout({
  children,
}: {
  children: ReactNode;
}) {
  const userTier = useUserTier();
  const pathname = usePathname();
  const onboarding = useOnboarding();

  // Gate: client users who have never done the Forge get sent there first.
  // Excludes Settings so they can still manage their account.
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
    // Access code redemption
    const pendingCode = localStorage.getItem("pending_access_code");
    if (pendingCode) {
      localStorage.removeItem("pending_access_code");
      fetch("/api/access-code/redeem", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: pendingCode }),
      }).catch(() => {});
    }

    // Sync audience from Forge intro selection to user tier
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

    // Sync Forge localStorage data to DB (one-time migration)
    // Also build Forge preload for Refinery tools
    try {
      const stored = localStorage.getItem("forge_session");
      if (!stored) return;
      const forgeData = JSON.parse(stored);
      if (!forgeData.forgeOutput && !forgeData.resumeText) return;

      // Build Forge preload for Refinery deep linking
      try {
        import("@/lib/forge-preload").then(({ buildForgePreload, saveForgePreload }) => {
          const preload = buildForgePreload(forgeData);
          saveForgePreload(preload);
        }).catch(() => {});
      } catch {
        // Preload build failed — not critical
      }

      // Check if already synced — compare startedAt to detect new sessions
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
            // Mark this specific session as synced
            forgeData._synced = true;
            forgeData._syncedAt = currentStartedAt;
            localStorage.setItem("forge_session", JSON.stringify(forgeData));
            // Signal that forge data has been synced (Resume Builder listens)
            window.dispatchEvent(new Event("forge-synced"));
          }
        })
        .catch(() => {});
    } catch {
      // Silent — sync is best-effort
    }
  }, []);

  return (
    <div className="min-h-screen bg-background">
      {/* Top nav */}
      <nav className="sticky top-0 z-30 bg-white/95 backdrop-blur border-b border-border">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <div className="flex items-center justify-between h-16">
            <Link
              href="/dashboard"
              className="font-bold text-lg text-foreground"
            >
              Steel Man
            </Link>
            <div className="flex items-center gap-4">
              <a
                href="https://forge.steelmanresumes.com"
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-muted hover:text-foreground transition-colors"
              >
                The Forge
              </a>
              <a
                href="https://steelmanresumes.com"
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-muted hover:text-foreground transition-colors"
              >
                About SMR
              </a>
              <Link
                href="/dashboard/settings"
                className="text-sm text-muted hover:text-foreground transition-colors"
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

      {/* Tool navigation — all items visible, locked ones greyed out */}
      <div className="border-b border-border bg-white">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <nav
            className="flex gap-1 overflow-x-auto py-2 scrollbar-hide"
            aria-label="Refinery tools"
          >
            {NAV_ITEMS.map((item) => {
              const unlocked = isNavUnlocked(item, userTier, onboarding.state);
              const isActive = pathname === item.href;

              if (!unlocked) {
                return (
                  <span
                    key={item.href}
                    className="px-4 py-2 text-sm font-medium rounded-lg whitespace-nowrap min-h-touch flex items-center gap-1.5 text-gray-300 cursor-not-allowed select-none"
                    title={onboarding.state === "needs_profile"
                      ? "Set up your profile to unlock"
                      : "Build your first resume to unlock"}
                  >
                    {item.label}
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor" className="flex-shrink-0 opacity-50">
                      <path d="M9 5V4a3 3 0 10-6 0v1H2v5a1 1 0 001 1h6a1 1 0 001-1V5H9zM4 4a2 2 0 114 0v1H4V4z" />
                    </svg>
                  </span>
                );
              }

              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors whitespace-nowrap min-h-touch flex items-center ${
                    isActive
                      ? "text-foreground bg-sage-100"
                      : "text-muted hover:text-foreground hover:bg-sage-50"
                  }`}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </div>
      </div>

      {/* Main content — pb-32 clears floating buttons on mobile */}
      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-8 pb-32 sm:pb-8">{children}</main>

      {/* Contact Troy — always unlocked for authenticated users */}
      <ContactTroyButton isAuthenticated />

      {/* Guided orientation tour — Stage 0, one-time, DB-persisted (client tier only) */}
      <GuidedTour />

      {/* AI Assistant — available on every dashboard page */}
      <AssistantDrawer>
        <AssistantChat
          context={{
            currentPage: pathname === "/dashboard" ? "dashboard" : pathname.replace("/dashboard/", ""),
            forgeComplete: onboarding.state !== "needs_profile",
            readinessStage: undefined, // loaded by assistant from session
          }}
          coach
        />
      </AssistantDrawer>
    </div>
  );
}
