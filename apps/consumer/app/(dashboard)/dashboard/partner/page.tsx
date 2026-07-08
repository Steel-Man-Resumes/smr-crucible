"use client";

/**
 * Partner Dashboard (W7) -- a monitoring partner sees the consent-shared progress
 * of clients who redeemed their access codes. Progress SIGNALS only (stage,
 * counts, activity, outcome) -- never resume text, disclosure plans, or interview
 * answers. Clients who have not opted into sharing are counted but never named.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { useUserTier } from "@/lib/useUserTier";

const STAGE_LABELS = [
  "Getting oriented",
  "Building foundation",
  "Finding work",
  "Tailoring resume",
  "Planning disclosure",
  "Practicing interviews",
  "Applying & tracking",
];

interface CohortClient {
  userId: string;
  name: string | null;
  email: string | null;
  currentStage: number;
  nextStepAction: string | null;
  applications: number;
  savedJobs: number;
  practiceSessions: number;
  hasResumeTailored: boolean;
  hasDisclosurePlan: boolean;
  hired: boolean;
  outcomeNamed: boolean;
  lastActiveAt: string | null;
  joinedAt: string;
}
interface Cohort {
  clients: CohortClient[];
  pendingCount: number;
  totalJoined: number;
  summary: { consented: number; avgStage: number | null; hired: number; activeThisWeek: number };
}

function fmtDate(s: string | null): string {
  if (!s) return "--";
  const d = new Date(s);
  if (isNaN(d.getTime())) return "--";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export default function PartnerDashboardPage() {
  const tier = useUserTier();
  const canView = tier === "partner" || tier === "admin";
  const [cohort, setCohort] = useState<Cohort | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "forbidden" | "error">("loading");

  useEffect(() => {
    if (!canView) {
      setStatus("forbidden");
      return;
    }
    fetch("/api/partner/cohort")
      .then((r) => {
        if (r.status === 403) {
          setStatus("forbidden");
          return null;
        }
        if (!r.ok) {
          setStatus("error");
          return null;
        }
        return r.json();
      })
      .then((data) => {
        if (data) {
          setCohort(data);
          setStatus("ready");
        }
      })
      .catch(() => setStatus("error"));
  }, [canView]);

  if (status === "forbidden") {
    return (
      <div className="max-w-2xl mx-auto px-4 py-12 font-term">
        <h1 className="text-2xl font-bold text-t-white mb-3">Partner Dashboard</h1>
        <p className="text-t-phos-dim">
          This view is for partner organizations that distribute access codes to the
          people they support. If that is you and you are seeing this, your account is
          not yet linked to a partner code -- reach out and we will connect it.
        </p>
        <Link href="/dashboard" className="inline-block mt-6 text-t-amber-bright hover:text-t-amber">
          &larr; Back to dashboard
        </Link>
      </div>
    );
  }

  if (status === "loading") {
    return <div className="max-w-5xl mx-auto px-4 py-12 text-t-phos-dim font-term">Loading your cohort...</div>;
  }
  if (status === "error" || !cohort) {
    return <div className="max-w-5xl mx-auto px-4 py-12 text-t-phos-dim font-term">Could not load the cohort. Please try again.</div>;
  }

  const { clients, pendingCount, totalJoined, summary } = cohort;

  return (
    <div className="max-w-5xl mx-auto px-4 py-10 font-term">
      <div className="flex flex-wrap items-start justify-between gap-4 mb-2">
        <div>
          <h1 className="text-2xl font-bold text-t-white">Partner Dashboard</h1>
          <p className="text-t-phos-dim mt-1">
            Progress for the people you support who chose to share it.
          </p>
        </div>
        {clients.length > 0 && (
          <a
            href="/api/partner/cohort?format=csv"
            className="t-focus inline-flex items-center px-4 py-2 bg-transparent border border-t-amber text-t-amber-bright text-sm font-bold hover:bg-t-amber/10 min-h-touch"
          >
            Export CSV
          </a>
        )}
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 my-6">
        {[
          { label: "Joined", value: totalJoined },
          { label: "Sharing progress", value: summary.consented },
          { label: "Active this week", value: summary.activeThisWeek },
          { label: "Hired", value: summary.hired },
        ].map((s) => (
          <div key={s.label} className="bg-t-panel px-4 py-3 border border-t-line">
            <div className="text-2xl font-bold text-t-amber-bright">{s.value}</div>
            <div className="text-xs text-t-phos-dim mt-0.5">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Privacy note */}
      <p className="text-xs text-t-phos-dim bg-t-panel border border-t-line px-4 py-3 mb-6">
        You only see clients who chose to share their progress with you. You never see their
        resume text, disclosure plans, or interview answers -- only where they are in the journey.
      </p>

      {/* Cohort table */}
      {clients.length === 0 ? (
        <div className="text-t-phos-dim bg-t-panel border border-t-line px-5 py-8 text-center">
          No one is sharing progress yet.
          {pendingCount > 0 && (
            <span> {pendingCount} {pendingCount === 1 ? "person has" : "people have"} joined with your code; they can turn on sharing from their own Settings.</span>
          )}
        </div>
      ) : (
        <div className="overflow-x-auto bg-t-panel border border-t-line">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-t-phos-dim border-b border-t-line">
                <th className="px-4 py-3 font-semibold">Client</th>
                <th className="px-4 py-3 font-semibold">Stage</th>
                <th className="px-4 py-3 font-semibold">Next step</th>
                <th className="px-4 py-3 font-semibold text-center">Apps</th>
                <th className="px-4 py-3 font-semibold text-center">Practice</th>
                <th className="px-4 py-3 font-semibold">Last active</th>
                <th className="px-4 py-3 font-semibold">Status</th>
              </tr>
            </thead>
            <tbody>
              {clients.map((c) => (
                <tr key={c.userId} className="border-b border-t-line last:border-0">
                  <td className="px-4 py-3">
                    <div className="font-medium text-t-white">{c.name || "Client"}</div>
                    {c.email && <div className="text-xs text-t-phos-dim">{c.email}</div>}
                  </td>
                  <td className="px-4 py-3">
                    <div className="font-medium text-t-white">{c.currentStage} / 6</div>
                    <div className="text-xs text-t-phos-dim">{STAGE_LABELS[c.currentStage] ?? ""}</div>
                  </td>
                  <td className="px-4 py-3 text-t-phos-dim max-w-[200px]">{c.nextStepAction || "--"}</td>
                  <td className="px-4 py-3 text-center text-t-white">{c.applications}</td>
                  <td className="px-4 py-3 text-center text-t-white">{c.practiceSessions}</td>
                  <td className="px-4 py-3 text-t-phos-dim">{fmtDate(c.lastActiveAt)}</td>
                  <td className="px-4 py-3">
                    {c.hired ? (
                      <span className="px-2 py-1 border border-t-phos text-t-phos text-xs font-medium">Hired</span>
                    ) : (
                      <span className="text-xs text-t-phos-dim">In progress</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {clients.length > 0 && pendingCount > 0 && (
        <p className="text-xs text-t-phos-dim mt-4">
          {pendingCount} more {pendingCount === 1 ? "person has" : "people have"} joined with your code but
          have not turned on sharing yet. They control that from their own Settings.
        </p>
      )}
    </div>
  );
}
