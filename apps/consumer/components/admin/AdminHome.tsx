"use client";

/**
 * AdminHome -- the operator's landing (role-clear wave, C11).
 *
 * Troy operates as four identities: platform admin, his own job-seeker
 * journey, org previews, and user assistance. This landing makes "what do I
 * do here" obvious and puts every identity one click away. Replaces the old
 * behavior where admin landed on the client god-mode view.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { setViewAs } from "@/lib/useUserTier";

interface FunnelCounts {
  forge_sessions_started: number;
  forge_sessions_completed: number;
  refinery_users: number;
  applications_logged: number;
  interviews: number;
  offers: number;
  hires: number;
}

export function AdminHome() {
  const [funnel, setFunnel] = useState<FunnelCounts | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/admin/evidence")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!cancelled && j?.report?.platform_funnel) {
          setFunnel(j.report.platform_funnel as FunnelCounts);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  function enterView(view: "client" | "observer") {
    setViewAs(view);
    // Full reload so every session-derived branch re-resolves in the new view
    window.location.assign("/dashboard");
  }

  const stats = funnel
    ? [
        { label: "Forge started", value: funnel.forge_sessions_started },
        { label: "Forge completed", value: funnel.forge_sessions_completed },
        { label: "Refinery users", value: funnel.refinery_users },
        { label: "Applications", value: funnel.applications_logged },
        { label: "Hires", value: funnel.hires },
      ]
    : null;

  return (
    <div className="space-y-8">
      {/* Purpose header */}
      <section>
        <h1 className="text-2xl font-bold text-t-white">Operator home</h1>
        <p className="text-t-phos-dim mt-1">
          Platform status, your organizations, and every identity you operate as.
        </p>
      </section>

      {/* Platform pulse */}
      <section className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        {(stats ?? Array.from({ length: 5 }, () => null)).map((s, i) => (
          <div key={s?.label ?? i} className="bg-t-panel px-4 py-3 border border-t-line">
            <div className="text-2xl font-bold text-t-amber-bright">
              {s ? s.value : "--"}
            </div>
            <div className="text-xs text-t-phos-dim mt-0.5">{s?.label ?? "Loading"}</div>
          </div>
        ))}
      </section>

      {/* Operate as */}
      <section>
        <h2 className="text-lg font-bold text-t-white mb-3">Operate as</h2>
        <div className="grid sm:grid-cols-2 gap-4">
          <button
            onClick={() => enterView("client")}
            className="t-focus block text-left bg-t-panel border border-t-phos p-5 hover:bg-t-panel-2 transition-colors"
          >
            <h3 className="font-semibold text-t-white mb-1">My job search</h3>
            <p className="text-sm text-t-phos-dim">
              Your own client journey -- jobs, applications, t.ROY. The real thing,
              not a preview. A banner marks the view; switch back from the top bar.
            </p>
          </button>
          <button
            onClick={() => enterView("observer")}
            className="t-focus block text-left bg-t-panel border border-t-steel p-5 hover:bg-t-panel-2 transition-colors"
          >
            <h3 className="font-semibold text-t-white mb-1">Observer view</h3>
            <p className="text-sm text-t-phos-dim">
              The evidence-and-citations landing a researcher or funder sees.
            </p>
          </button>
          <Link
            href="/dashboard/admin/orgs"
            className="block bg-t-panel border border-t-amber p-5 hover:bg-t-panel-2 transition-colors"
          >
            <h3 className="font-semibold text-t-white mb-1">View an organization</h3>
            <p className="text-sm text-t-phos-dim">
              Open any org&apos;s mission control, or impersonate its people (blue
              view = read-only) to see their exact experience.
            </p>
          </Link>
          <Link
            href="/dashboard/admin/users"
            className="block bg-t-panel border border-t-amber p-5 hover:bg-t-panel-2 transition-colors"
          >
            <h3 className="font-semibold text-t-white mb-1">View or assist a user</h3>
            <p className="text-sm text-t-phos-dim">
              Find any account. View is read-only; assist requires a reason and is
              audited.
            </p>
          </Link>
        </div>
      </section>

      {/* Admin surfaces */}
      <section>
        <h2 className="text-lg font-bold text-t-white mb-3">Admin surfaces</h2>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {[
            {
              href: "/dashboard/admin",
              title: "Evidence Dashboard",
              desc: "Funnel, partners, case studies, AI costs, support requests, code minting.",
            },
            {
              href: "/dashboard/admin/health",
              title: "System Health",
              desc: "DB, auth, email, AI keys, integrations.",
            },
            {
              href: "/dashboard/admin/orgs",
              title: "Organizations",
              desc: "Every partner code, owner, and team.",
            },
            {
              href: "/dashboard/admin/users",
              title: "Users",
              desc: "Search, view, assist.",
            },
          ].map((s) => (
            <Link
              key={s.href}
              href={s.href}
              className="block bg-t-panel border border-t-line p-4 hover:border-t-phos-dim transition-colors"
            >
              <h3 className="font-semibold text-t-white text-sm mb-1">{s.title}</h3>
              <p className="text-xs text-t-phos-dim">{s.desc}</p>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
