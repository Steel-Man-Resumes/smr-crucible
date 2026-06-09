"use client";

import { useState } from "react";
import { SessionProvider, signIn, useSession } from "next-auth/react";
import { usePathname, useRouter } from "next/navigation";

const NAV_SECTIONS = [
  {
    label: "Forge",
    routes: [
      { path: "/intro", label: "Intro" },
      { path: "/welcome", label: "Welcome" },
      { path: "/resume", label: "Resume" },
      { path: "/goals", label: "Goals" },
      { path: "/story", label: "Story" },
      { path: "/preferences", label: "Preferences" },
      { path: "/processing", label: "Processing" },
      { path: "/output", label: "Output" },
      { path: "/rush", label: "Rush" },
    ],
  },
  {
    label: "Dashboard",
    routes: [
      { path: "/dashboard", label: "Dashboard" },
      { path: "/application-tailor", label: "Application Tailor" },
      { path: "/disclosure", label: "Disclosure" },
      { path: "/interview", label: "Interview" },
      { path: "/jobs", label: "Jobs" },
      { path: "/resources", label: "Fair-Chance Lanes" },
      { path: "/progress", label: "Progress" },
      { path: "/methodology", label: "Methodology" },
      { path: "/evidence", label: "Evidence" },
      { path: "/settings", label: "Settings" },
    ],
  },
  {
    label: "Auth",
    routes: [
      { path: "/login", label: "Login" },
      { path: "/check-email", label: "Check Email" },
    ],
  },
];

function DevToolbarInner() {
  const [open, setOpen] = useState(false);
  const [loggingIn, setLoggingIn] = useState(false);
  const { data: session, status } = useSession();
  const pathname = usePathname();
  const router = useRouter();

  async function handleDevLogin() {
    setLoggingIn(true);
    try {
      await signIn("dev-login", {
        email: "dev@test.com",
        tier: "admin",
        redirect: false,
      });
      window.location.reload();
    } catch {
      setLoggingIn(false);
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-4 right-4 z-[9999] px-3 py-1.5 bg-amber-100 text-amber-800 text-xs font-bold rounded-lg border border-amber-300 hover:bg-amber-200 transition-colors shadow-lg"
      >
        DEV
      </button>
    );
  }

  return (
    <div className="fixed bottom-4 right-4 z-[9999] w-64 max-h-[80vh] overflow-y-auto bg-white border border-amber-300 rounded-xl shadow-2xl text-sm">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 bg-amber-50 border-b border-amber-200 rounded-t-xl">
        <span className="font-bold text-amber-800 text-xs">DEV TOOLBAR</span>
        <button
          onClick={() => setOpen(false)}
          className="text-amber-600 hover:text-amber-800 text-lg leading-none"
        >
          &times;
        </button>
      </div>

      {/* Auth Section */}
      <div className="px-3 py-2 border-b border-border">
        <div className="flex items-center gap-2 mb-2">
          <span
            className={`w-2 h-2 rounded-full ${status === "authenticated" ? "bg-green-500" : "bg-red-400"}`}
          />
          <span className="text-xs text-muted">
            {status === "authenticated"
              ? session?.user?.email || "Logged in"
              : "Not authenticated"}
          </span>
        </div>
        <button
          onClick={handleDevLogin}
          disabled={loggingIn}
          className="w-full px-3 py-2 bg-amber-100 text-amber-800 rounded-lg text-xs font-medium hover:bg-amber-200 disabled:opacity-50 transition-colors"
        >
          {loggingIn ? "Logging in..." : "Dev Login"}
        </button>
      </div>

      {/* Page Navigation */}
      <div className="px-3 py-2">
        {NAV_SECTIONS.map((section) => (
          <div key={section.label} className="mb-2">
            <p className="text-[10px] font-bold text-muted uppercase tracking-wider mb-1">
              {section.label}
            </p>
            <div className="flex flex-wrap gap-1">
              {section.routes.map((route) => {
                const isCurrent = pathname === route.path;
                return (
                  <button
                    key={route.path}
                    onClick={() => router.push(route.path)}
                    className={`px-2 py-1 rounded text-[11px] transition-colors ${
                      isCurrent
                        ? "bg-sage-600 text-white font-medium"
                        : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                    }`}
                  >
                    {route.label}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function DevToolbar() {
  if (process.env.NODE_ENV !== "development") return null;

  return (
    <SessionProvider>
      <DevToolbarInner />
    </SessionProvider>
  );
}
