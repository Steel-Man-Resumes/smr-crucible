"use client";

/**
 * OrgDashboard -- the partner organization's mission control.
 *
 * Extracted from /dashboard/partner (C9, role-clear wave) so it can render
 * both as that page AND as the /dashboard landing for org leaders and staff.
 * Accepts an optional codeId (admin org override -- /dashboard/partner?codeId=).
 *
 * Two shapes on one component:
 *  - Org shape (EXPO build-out): real org branding, staff hierarchy
 *    (org admin manages staff; staff see their assigned clients), client
 *    assignment, and per-client AI cost for the sponsoring org's admins.
 *  - Legacy shape: a code owner with no org_staff rows gets the original
 *    consent-gated cohort table via /api/partner/cohort.
 *
 * Consent doctrine unchanged: progress SIGNALS only (stage, counts, activity,
 * outcome) -- never resume text, disclosure plans, or interview answers.
 * Clients who have not opted into sharing are counted but never named.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useUserTier } from "@/lib/useUserTier";
// Deep import: canonical stage vocabulary without dragging the core barrel
// (db/pg) into the client bundle.
import { JOURNEY_STAGES } from "@crucible/core/src/journeyStages";

const STAGE_LABELS = JOURNEY_STAGES.map((s) => s.long);

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
  assignedStaffId: string | null;
  assignedStaffName: string | null;
  aiCostUsd: number;
}
interface Cohort {
  clients: CohortClient[];
  pendingCount: number;
  totalJoined: number;
  summary: { consented: number; avgStage: number | null; hired: number; activeThisWeek: number };
}
interface StaffMember {
  userId: string;
  name: string | null;
  email: string | null;
  role: "org_admin" | "staff";
  title: string | null;
  clientCount: number;
}
interface OrgPayload {
  org: { name: string; code: string; logoUrl: string | null; role: string };
  staff: StaffMember[];
  cohort: Cohort;
  canManage: boolean;
  showCosts: boolean;
}

function fmtDate(s: string | null): string {
  if (!s) return "--";
  const d = new Date(s);
  if (isNaN(d.getTime())) return "--";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function usd(v: number): string {
  return `$${v.toFixed(v >= 1 ? 2 : 4)}`;
}

export function OrgDashboard({ codeId = "" }: { codeId?: string }) {
  const tier = useUserTier();
  const canView = tier === "partner" || tier === "admin";
  const [data, setData] = useState<OrgPayload | null>(null);
  const [legacyCohort, setLegacyCohort] = useState<Cohort | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "forbidden" | "error">("loading");
  const [saving, setSaving] = useState<string | null>(null);
  const [assignError, setAssignError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(
        codeId ? `/api/partner/org?codeId=${encodeURIComponent(codeId)}` : "/api/partner/org"
      );
      if (res.ok) {
        setData(await res.json());
        setStatus("ready");
        return;
      }
      // No org context -- fall back to the legacy owner cohort
      const legacy = await fetch("/api/partner/cohort");
      if (legacy.ok) {
        setLegacyCohort(await legacy.json());
        setStatus("ready");
      } else if (legacy.status === 403) {
        setStatus("forbidden");
      } else {
        setStatus("error");
      }
    } catch {
      setStatus("error");
    }
  }, [codeId]);

  useEffect(() => {
    if (!canView) {
      setStatus("forbidden");
      return;
    }
    load();
  }, [canView, load]);

  async function assign(clientUserId: string, staffUserId: string) {
    setSaving(clientUserId);
    setAssignError(null);
    try {
      const res = await fetch("/api/partner/org", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "assign",
          clientUserId,
          staffUserId: staffUserId || null,
        }),
      });
      if (!res.ok) {
        // Read-only impersonation (blue view) blocks writes at the edge --
        // surface that instead of silently reloading.
        setAssignError(
          res.status === 403
            ? "Assignment blocked: this session is read-only."
            : "Could not save that assignment. Try again."
        );
      }
      await load();
    } finally {
      setSaving(null);
    }
  }

  if (status === "forbidden") {
    return (
      <div className="max-w-2xl mx-auto px-4 py-12">
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
    return <div className="max-w-5xl mx-auto px-4 py-12 text-t-phos-dim">Loading your organization...</div>;
  }
  if (status === "error") {
    return <div className="max-w-5xl mx-auto px-4 py-12 text-t-phos-dim">Could not load the dashboard. Please try again.</div>;
  }

  const cohort = data?.cohort || legacyCohort;
  if (!cohort) {
    return <div className="max-w-5xl mx-auto px-4 py-12 text-t-phos-dim">Nothing to show yet.</div>;
  }
  const { clients, pendingCount, totalJoined, summary } = cohort;
  const canManage = data?.canManage ?? false;
  const showCosts = data?.showCosts ?? false;
  const staff = data?.staff ?? [];
  const totalAiCost = showCosts ? clients.reduce((s, c) => s + (c.aiCostUsd || 0), 0) : 0;

  return (
    <div className="max-w-6xl mx-auto px-4 py-10">
      {/* Org header */}
      <div className="flex flex-wrap items-center justify-between gap-4 mb-2">
        <div className="flex items-center gap-4">
          {data?.org.logoUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={data.org.logoUrl}
              alt={`${data.org.name} logo`}
              className="h-14 w-14 object-contain bg-white border border-t-line p-1"
            />
          )}
          <div>
            <h1 className="text-2xl font-bold text-t-white">
              {data?.org.name || "Partner Dashboard"}
            </h1>
            <p className="text-t-phos-dim mt-0.5 text-sm">
              {data
                ? data.org.role === "staff"
                  ? "Staff view -- the clients assigned to you who chose to share progress."
                  : `Your organization's mission control -- team, client progress, and program reach. Code ${data.org.code}.`
                : "Progress for the people you support who chose to share it."}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Link
            href="/dashboard/methodology"
            className="t-focus hidden sm:inline-flex items-center px-3 py-2 text-sm text-t-phos-dim hover:text-t-white min-h-touch"
          >
            How the tools work
          </Link>
          {clients.length > 0 && (
            <a
              href="/api/partner/cohort?format=csv"
              className="t-focus inline-flex items-center px-4 py-2 bg-transparent border border-t-amber text-t-amber-bright text-sm font-bold hover:bg-t-amber/10 min-h-touch"
            >
              Export CSV
            </a>
          )}
        </div>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-5 gap-3 my-6">
        {[
          { label: "Joined", value: String(totalJoined) },
          { label: "Sharing progress", value: String(summary.consented) },
          { label: "Active this week", value: String(summary.activeThisWeek) },
          { label: "Hired", value: String(summary.hired) },
          ...(showCosts ? [{ label: "AI cost (all time)", value: usd(totalAiCost) }] : []),
        ].map((s) => (
          <div key={s.label} className="bg-t-panel px-4 py-3 border border-t-line">
            <div className="text-2xl font-bold text-t-amber-bright">{s.value}</div>
            <div className="text-xs text-t-phos-dim mt-0.5">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Staff panel (org shape only) */}
      {data && staff.length > 0 && (
        <div className="bg-t-panel border border-t-line px-4 py-4 mb-6">
          <h2 className="text-sm font-semibold text-t-white mb-3">Team</h2>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {staff.map((m) => (
              <div key={m.userId} className="border border-t-line px-3 py-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-t-white">
                    {m.name || m.email}
                  </span>
                  <span
                    className={`text-[10px] px-1.5 py-0.5 border ${
                      m.role === "org_admin"
                        ? "border-t-amber text-t-amber-bright"
                        : "border-t-line text-t-phos-dim"
                    }`}
                  >
                    {m.role === "org_admin" ? "Admin" : "Staff"}
                  </span>
                </div>
                {m.title && <div className="text-xs text-t-phos-dim">{m.title}</div>}
                <div className="text-xs text-t-phos mt-1">
                  {m.clientCount} assigned {m.clientCount === 1 ? "client" : "clients"}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Privacy note */}
      <p className="text-xs text-t-phos-dim bg-t-panel border border-t-line px-4 py-3 mb-6">
        You only see clients who chose to share their progress with you. You never see their
        resume text, disclosure plans, or interview answers -- only where they are in the journey.
      </p>

      {assignError && (
        <p className="text-xs text-t-amber-bright border border-t-amber bg-t-panel px-4 py-3 mb-4">
          {assignError}
        </p>
      )}

      {/* Cohort table */}
      {clients.length === 0 ? (
        <div className="text-t-phos-dim bg-t-panel border border-t-line px-5 py-8 text-center">
          {data?.org.role === "staff"
            ? "No clients are assigned to you yet, or your assigned clients have not turned on sharing."
            : "No one is sharing progress yet."}
          {pendingCount > 0 && (
            <span>
              {" "}
              {pendingCount} {pendingCount === 1 ? "person has" : "people have"} joined with the
              code; they can turn on sharing from their own Settings.
            </span>
          )}
        </div>
      ) : (
        <div className="overflow-x-auto bg-t-panel border border-t-line">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase text-t-phos-dim border-b border-t-line">
                <th className="px-4 py-3 font-semibold">Client</th>
                <th className="px-4 py-3 font-semibold">Stage</th>
                <th className="px-4 py-3 font-semibold">Next step</th>
                <th className="px-4 py-3 font-semibold text-center">Apps</th>
                <th className="px-4 py-3 font-semibold">Last active</th>
                {data && <th className="px-4 py-3 font-semibold">Staff</th>}
                {showCosts && <th className="px-4 py-3 font-semibold text-right">AI cost</th>}
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
                  <td className="px-4 py-3 text-t-phos-dim">{fmtDate(c.lastActiveAt)}</td>
                  {data && (
                    <td className="px-4 py-3">
                      {canManage ? (
                        <select
                          value={c.assignedStaffId || ""}
                          onChange={(e) => assign(c.userId, e.target.value)}
                          disabled={saving === c.userId}
                          className="t-focus bg-t-panel border border-t-line text-xs text-t-phos px-2 py-1.5 disabled:opacity-50"
                        >
                          <option value="">Unassigned</option>
                          {staff.map((m) => (
                            <option key={m.userId} value={m.userId}>
                              {m.name || m.email}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <span className="text-xs text-t-phos-dim">
                          {c.assignedStaffName || "--"}
                        </span>
                      )}
                    </td>
                  )}
                  {showCosts && (
                    <td className="px-4 py-3 text-right text-t-phos tabular-nums">
                      {usd(c.aiCostUsd || 0)}
                    </td>
                  )}
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
          {pendingCount} more {pendingCount === 1 ? "person has" : "people have"} joined with the
          code but have not turned on sharing yet. They control that from their own Settings.
        </p>
      )}

      {showCosts && (
        <p className="text-xs text-t-phos-dim mt-2">
          AI cost is the exact provider-billed token spend for each client&apos;s use of the
          platform&apos;s AI features. Staff accounts do not see this column.
        </p>
      )}
    </div>
  );
}
