"use client";

/**
 * Admin -> System Health. One readout of the live platform: DB, auth, email
 * (Resend domain), AI-key validity, integrations. Admin-tier only (the API
 * enforces it; this page also gates client-side). No secrets shown.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { useUserTier } from "@/lib/useUserTier";

type HealthStatus = "ok" | "warn" | "error" | "info";
interface HealthCheck { group: string; name: string; status: HealthStatus; detail: string; }
interface HealthReport { generatedAt: string; overall: HealthStatus; checks: HealthCheck[]; }

const DOT: Record<HealthStatus, string> = {
  ok: "bg-green-500",
  warn: "bg-amber-500",
  error: "bg-red-500",
  info: "bg-gray-300",
};
const BADGE: Record<HealthStatus, string> = {
  ok: "bg-green-100 text-green-700",
  warn: "bg-amber-100 text-amber-700",
  error: "bg-red-100 text-red-700",
  info: "bg-gray-100 text-gray-600",
};

export default function HealthPage() {
  const tier = useUserTier();
  const [report, setReport] = useState<HealthReport | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "forbidden" | "error">("loading");

  function load() {
    setStatus("loading");
    fetch("/api/admin/health")
      .then((r) => {
        if (r.status === 403 || r.status === 401) { setStatus("forbidden"); return null; }
        if (!r.ok) { setStatus("error"); return null; }
        return r.json();
      })
      .then((d) => { if (d) { setReport(d); setStatus("ready"); } })
      .catch(() => setStatus("error"));
  }
  useEffect(() => {
    if (tier !== "admin") { setStatus("forbidden"); return; }
    load();
  }, [tier]);

  if (status === "forbidden") {
    return (
      <div className="max-w-2xl mx-auto px-4 py-12">
        <h1 className="text-2xl font-bold text-foreground mb-2">System Health</h1>
        <p className="text-muted">Admin access only.</p>
        <Link href="/dashboard" className="inline-block mt-6 text-sage-600 hover:text-sage-700">&larr; Back</Link>
      </div>
    );
  }

  const groups = report
    ? report.checks.map((c) => c.group).filter((g, i, arr) => arr.indexOf(g) === i)
    : [];

  return (
    <div className="max-w-3xl mx-auto px-4 py-10">
      <div className="flex items-center justify-between gap-4 mb-2">
        <h1 className="text-2xl font-bold text-foreground">System Health</h1>
        <button onClick={load} disabled={status === "loading"} className="px-3 py-1.5 text-sm rounded-[6px] bg-white border border-border hover:bg-sage-50 disabled:opacity-50">
          {status === "loading" ? "Checking..." : "Refresh"}
        </button>
      </div>

      {report && (
        <div className="flex items-center gap-2 mb-6">
          <span className={`inline-block w-3 h-3 rounded-full ${DOT[report.overall]}`} />
          <span className="text-sm font-medium text-foreground capitalize">{report.overall}</span>
          <span className="text-xs text-muted ml-2">checked {new Date(report.generatedAt).toLocaleTimeString()}</span>
        </div>
      )}

      {status === "loading" && !report && <p className="text-muted">Running checks...</p>}
      {status === "error" && <p className="text-muted">Could not run the health check. Try Refresh.</p>}

      {report && groups.map((g) => (
        <section key={g} className="mb-6">
          <h2 className="text-sm font-semibold uppercase text-muted mb-2">{g}</h2>
          <div className="bg-white border border-border rounded-[6px] divide-y divide-border">
            {report.checks.filter((c) => c.group === g).map((c, i) => (
              <div key={i} className="flex items-start gap-3 px-4 py-3">
                <span className={`mt-1.5 inline-block w-2.5 h-2.5 rounded-full flex-shrink-0 ${DOT[c.status]}`} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-foreground text-sm">{c.name}</span>
                    <span className={`text-[10px] uppercase font-semibold px-1.5 py-0.5 rounded ${BADGE[c.status]}`}>{c.status}</span>
                  </div>
                  <p className="text-sm text-muted mt-0.5">{c.detail}</p>
                </div>
              </div>
            ))}
          </div>
        </section>
      ))}

      <Link href="/dashboard/admin" className="inline-block mt-2 text-sage-600 hover:text-sage-700 text-sm">&larr; Back to Admin</Link>
    </div>
  );
}
