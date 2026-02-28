"use client";

import type { ReactNode } from "react";
import { useEffect } from "react";
import Link from "next/link";
import { AssistantDrawer } from "@crucible/consumer-ui";
import { AssistantChat } from "@/components/AssistantChat";

/**
 * Dashboard Layout — Authenticated area
 *
 * Persistent navigation for Refinery tools.
 * Designed for 6+ month engagement.
 * JBS-compliant: consent status visible, data export/delete available.
 */

const NAV_ITEMS = [
  { href: "/dashboard", label: "Overview" },
  { href: "/dashboard/resume-builder", label: "Resume Builder" },
  { href: "/dashboard/disclosure", label: "Disclosure Planner" },
  { href: "/dashboard/interview", label: "Interview Practice" },
  { href: "/dashboard/jobs", label: "Job Board" },
  { href: "/dashboard/resources", label: "Resources" },
  { href: "/dashboard/progress", label: "Progress" },
];

export default function DashboardLayout({
  children,
}: {
  children: ReactNode;
}) {
  // Post-auth access code redemption
  useEffect(() => {
    const pendingCode = localStorage.getItem("pending_access_code");
    if (!pendingCode) return;

    localStorage.removeItem("pending_access_code");

    fetch("/api/access-code/redeem", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: pendingCode }),
    }).catch(() => {
      // Silent — code redemption is best-effort on first login
    });
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
              Second Mile
            </Link>
            <div className="flex items-center gap-4">
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
            {NAV_ITEMS.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="px-4 py-2 text-sm font-medium text-muted hover:text-foreground hover:bg-sage-50 rounded-lg transition-colors whitespace-nowrap min-h-touch flex items-center"
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </div>
      </div>

      {/* Main content */}
      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-8">{children}</main>

      {/* AI Assistant — available on every dashboard page */}
      <AssistantDrawer>
        <AssistantChat
          context={{ currentPage: "dashboard" }}
        />
      </AssistantDrawer>
    </div>
  );
}
