"use client";

import type { ReactNode } from "react";
import { useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { AssistantDrawer } from "@crucible/consumer-ui";
import { AssistantChat } from "@/components/AssistantChat";
import { ContactTroyButton } from "@/components/ContactTroyButton";
import { useUserTier, type UserTier } from "@/lib/useUserTier";

/**
 * Dashboard Layout — Authenticated area
 *
 * Persistent navigation for Refinery tools.
 * Nav items filtered by user tier.
 * JBS-compliant: consent status visible, data export/delete available.
 */

interface NavItem {
  href: string;
  label: string;
  minTier: UserTier;
}

const TIER_RANK: Record<string, number> = {
  admin: 0,
  partner: 1,
  client: 2,
  observer: 3,
};

const NAV_ITEMS: NavItem[] = [
  { href: "/dashboard", label: "Overview", minTier: "observer" },
  { href: "/dashboard/resume-builder", label: "Resume Builder", minTier: "client" },
  { href: "/dashboard/disclosure", label: "Disclosure Planner", minTier: "client" },
  { href: "/dashboard/interview", label: "Interview Practice", minTier: "client" },
  { href: "/dashboard/jobs", label: "Job Board", minTier: "client" },
  { href: "/dashboard/resources", label: "Resources", minTier: "client" },
  { href: "/dashboard/applications", label: "Applications", minTier: "client" },
  { href: "/dashboard/progress", label: "Progress", minTier: "observer" },
  { href: "/dashboard/methodology", label: "Methodology", minTier: "observer" },
  { href: "/dashboard/evidence", label: "Evidence", minTier: "observer" },
  { href: "/dashboard/security", label: "Security & Privacy", minTier: "observer" },
];

function getVisibleNav(userTier: UserTier): NavItem[] {
  const rank = TIER_RANK[userTier] ?? 3;
  return NAV_ITEMS.filter((item) => rank <= (TIER_RANK[item.minTier] ?? 3));
}

export default function DashboardLayout({
  children,
}: {
  children: ReactNode;
}) {
  const userTier = useUserTier();
  const pathname = usePathname();

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

      // Check if already synced (flag prevents duplicate writes)
      if (forgeData._synced) return;

      fetch("/api/forge/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: stored,
      })
        .then((res) => {
          if (res.ok) {
            // Mark as synced so we don't re-send
            forgeData._synced = true;
            localStorage.setItem("forge_session", JSON.stringify(forgeData));
          }
        })
        .catch(() => {});
    } catch {
      // Silent — sync is best-effort
    }
  }, []);

  const visibleNav = getVisibleNav(userTier);

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
            </div>
          </div>
        </div>
      </nav>

      {/* Tool navigation — horizontal scroll on mobile */}
      <div className="border-b border-border bg-white">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <nav
            className="flex gap-1 overflow-x-auto py-2 scrollbar-hide"
            aria-label="Refinery tools"
          >
            {visibleNav.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors whitespace-nowrap min-h-touch flex items-center ${
                  pathname === item.href
                    ? "text-foreground bg-sage-100"
                    : "text-muted hover:text-foreground hover:bg-sage-50"
                }`}
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </div>
      </div>

      {/* Main content */}
      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-8">{children}</main>

      {/* Contact Troy — always unlocked for authenticated users */}
      <ContactTroyButton isAuthenticated />

      {/* AI Assistant — available on every dashboard page */}
      <AssistantDrawer>
        <AssistantChat
          context={{ currentPage: "dashboard" }}
        />
      </AssistantDrawer>
    </div>
  );
}
