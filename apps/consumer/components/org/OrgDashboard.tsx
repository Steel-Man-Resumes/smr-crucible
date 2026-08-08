"use client";

/**
 * OrgDashboard -- the partner organization's mission control.
 *
 * Redesigned (org-oversight wave, 2026-08-07) from a cohort table into an
 * organization-oversight surface. An org admin/staff is here to RUN the
 * organization, not to build resumes -- the participant toolset now lives
 * behind the header "Client view" toggle (see RefineryShell), and this page
 * leads with the team.
 *
 * Three role-gated experiences on one component:
 *  - Org admin / owner: team org-chart FIRST (every staff member with a
 *    client-load + health rollup), click-to-drill into a staff member's
 *    clients, client assignment, seats + AI cost, and the full roster.
 *  - Staff: their assigned clients only + add-participant (auto-assigned to
 *    them). No team org-chart, no seat administration, no AI cost.
 *  - User (participant): never reaches this -- they get the client toolset.
 *
 * Legacy shape: a code owner with no org_staff rows gets the original
 * consent-gated cohort table via /api/partner/cohort (data === null path).
 *
 * Consent doctrine unchanged: progress SIGNALS only (stage, counts, activity,
 * outcome) -- never resume text, disclosure plans, or interview answers.
 * Clients who have not opted into sharing are counted but never named.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useUserTier } from "@/lib/useUserTier";
// Deep import: canonical stage vocabulary without dragging the core barrel
// (db/pg) into the client bundle.
import { JOURNEY_STAGES } from "@crucible/core/src/journeyStages";

const STAGE_LABELS = JOURNEY_STAGES.map((s) => s.long);

// "Behind" = mid-journey (started, not hired) with no activity in this many
// days. Starting point for the redesign; Troy can tune this one number.
const BEHIND_DAYS = 14;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const BEHIND_MS = BEHIND_DAYS * 24 * 60 * 60 * 1000;

const UNASSIGNED = "__unassigned__";

type ClientStatus = "hired" | "active" | "behind" | "steady";

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
interface PendingInvite {
  userId: string;
  name: string | null;
  email: string;
  invitedAt: string;
  lastSentAt: string;
  sendCount: number;
  invitedByName: string | null;
}
interface OrgPayload {
  org: { name: string; code: string; logoUrl: string | null; role: string; seatLimit: number | null };
  staff: StaffMember[];
  cohort: Cohort;
  invites?: PendingInvite[];
  canManage: boolean;
  canInvite?: boolean;
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

function clientStatus(c: CohortClient): ClientStatus {
  if (c.hired) return "hired";
  const last = c.lastActiveAt ? new Date(c.lastActiveAt).getTime() : 0;
  const now = Date.now();
  if (last && now - last < WEEK_MS) return "active";
  const midJourney = c.currentStage >= 1 && c.currentStage < 6;
  if (midJourney && (!last || now - last > BEHIND_MS)) return "behind";
  return "steady";
}

function StatusBadge({ status }: { status: ClientStatus }) {
  const map: Record<ClientStatus, { label: string; cls: string }> = {
    hired: { label: "Hired", cls: "border-t-phos text-t-phos" },
    active: { label: "Active", cls: "border-t-steel text-t-steel" },
    behind: { label: "Behind", cls: "border-t-amber text-t-amber-bright" },
    steady: { label: "In progress", cls: "border-t-line text-t-phos-dim" },
  };
  const { label, cls } = map[status];
  return <span className={`px-2 py-0.5 border text-xs font-medium ${cls}`}>{label}</span>;
}

export function OrgDashboard({ codeId = "" }: { codeId?: string }) {
  const tier = useUserTier();
  const canView = tier === "partner" || tier === "admin";
  const [data, setData] = useState<OrgPayload | null>(null);
  const [legacyCohort, setLegacyCohort] = useState<Cohort | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "forbidden" | "error">("loading");
  const [saving, setSaving] = useState<string | null>(null);
  const [assignError, setAssignError] = useState<string | null>(null);
  const [inviteName, setInviteName] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteBusy, setInviteBusy] = useState(false);
  const [inviteMsg, setInviteMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [inviteRowBusy, setInviteRowBusy] = useState<string | null>(null);
  // Admin drill-down: a staff userId (or the UNASSIGNED sentinel) narrows the
  // roster to that person's clients. null = team overview.
  const [drillStaffId, setDrillStaffId] = useState<string | null>(null);

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

  async function sendInvite(e: React.FormEvent) {
    e.preventDefault();
    if (inviteBusy) return;
    setInviteBusy(true);
    setInviteMsg(null);
    try {
      const res = await fetch("/api/partner/org", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "invite", name: inviteName, email: inviteEmail }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.ok) {
        setInviteMsg({ kind: data.emailFailed ? "err" : "ok", text: data.message });
        setInviteName("");
        setInviteEmail("");
        await load();
      } else {
        setInviteMsg({
          kind: "err",
          text:
            res.status === 403
              ? "Invites are blocked: this session is read-only."
              : data.error || "Could not send that invite. Try again.",
        });
      }
    } catch {
      setInviteMsg({ kind: "err", text: "Could not send that invite. Try again." });
    } finally {
      setInviteBusy(false);
    }
  }

  async function inviteRowAction(action: "resend_invite" | "revoke_invite", inv: PendingInvite) {
    if (inviteRowBusy) return;
    if (
      action === "revoke_invite" &&
      !window.confirm(
        `Remove ${inv.name || inv.email}? This cancels their invite link and frees the seat.`
      )
    ) {
      return;
    }
    setInviteRowBusy(inv.userId);
    setInviteMsg(null);
    try {
      const res = await fetch("/api/partner/org", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, userId: inv.userId }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.ok) {
        setInviteMsg({ kind: "ok", text: data.message });
        await load();
      } else {
        setInviteMsg({
          kind: "err",
          text:
            res.status === 403
              ? "That action is blocked: this session is read-only."
              : data.error || "That did not go through. Try again.",
        });
      }
    } catch {
      setInviteMsg({ kind: "err", text: "That did not go through. Try again." });
    } finally {
      setInviteRowBusy(null);
    }
  }

  const cohort = data?.cohort || legacyCohort;
  const clients = useMemo(() => cohort?.clients ?? [], [cohort]);

  // Per-staff health rollups, computed client-side from the roster the admin
  // already receives. Health reflects only sharing clients; clientCount (from
  // the API) is total assigned incl. those not sharing.
  const rollups = useMemo(() => {
    const m = new Map<string, { active: number; behind: number; hired: number; sharing: number }>();
    for (const c of clients) {
      const key = c.assignedStaffId ?? UNASSIGNED;
      const r = m.get(key) ?? { active: 0, behind: 0, hired: 0, sharing: 0 };
      r.sharing += 1;
      const s = clientStatus(c);
      if (s === "hired") r.hired += 1;
      else if (s === "active") r.active += 1;
      else if (s === "behind") r.behind += 1;
      m.set(key, r);
    }
    return m;
  }, [clients]);

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
  if (!cohort) {
    return <div className="max-w-5xl mx-auto px-4 py-12 text-t-phos-dim">Nothing to show yet.</div>;
  }

  const { pendingCount, totalJoined, summary } = cohort;
  const canManage = data?.canManage ?? false; // owner/org_admin
  const showCosts = data?.showCosts ?? false;
  const staff = data?.staff ?? [];
  const invites = data?.invites ?? [];
  const canInvite = data?.canInvite ?? false;
  const isStaffView = data?.org.role === "staff";
  const seatLimit = data?.org.seatLimit ?? null;
  // Invited-but-not-yet-active people hold a seat (they count in totalJoined
  // and, having no sharing consent, in pendingCount) but have not actually
  // joined -- split them out so both numbers stay honest.
  const joinedCount = Math.max(0, totalJoined - invites.length);
  const joinedNotSharing = Math.max(0, pendingCount - invites.length);
  const totalAiCost = showCosts ? clients.reduce((s, c) => s + (c.aiCostUsd || 0), 0) : 0;

  // Team org-chart is an admin/owner surface only.
  const showTeam = !!data && canManage;
  const unassignedCount = clients.filter((c) => !c.assignedStaffId).length;

  const drillClients = drillStaffId
    ? drillStaffId === UNASSIGNED
      ? clients.filter((c) => !c.assignedStaffId)
      : clients.filter((c) => c.assignedStaffId === drillStaffId)
    : clients;
  const drillStaffName =
    drillStaffId === UNASSIGNED
      ? "Unassigned"
      : staff.find((m) => m.userId === drillStaffId)?.name ||
        staff.find((m) => m.userId === drillStaffId)?.email ||
        "Staff member";

  function ClientTable({ rows, showAssign }: { rows: CohortClient[]; showAssign: boolean }) {
    if (rows.length === 0) {
      return (
        <div className="text-t-phos-dim bg-t-panel border border-t-line px-5 py-8 text-center">
          {isStaffView
            ? "No clients are assigned to you yet, or your assigned clients have not turned on sharing."
            : "No one is sharing progress here yet."}
          {joinedNotSharing > 0 && !drillStaffId && (
            <span>
              {" "}
              {joinedNotSharing} {joinedNotSharing === 1 ? "person has" : "people have"} joined with the
              code; they can turn on sharing from their own Settings.
            </span>
          )}
        </div>
      );
    }
    return (
      <div className="overflow-x-auto bg-t-panel border border-t-line">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase text-t-phos-dim border-b border-t-line">
              <th className="px-4 py-3 font-semibold">Client</th>
              <th className="px-4 py-3 font-semibold">Stage</th>
              <th className="px-4 py-3 font-semibold">Next step</th>
              <th className="px-4 py-3 font-semibold text-center">Apps</th>
              <th className="px-4 py-3 font-semibold">Last active</th>
              {data && showAssign && <th className="px-4 py-3 font-semibold">Staff</th>}
              {showCosts && <th className="px-4 py-3 font-semibold text-right">AI cost</th>}
              <th className="px-4 py-3 font-semibold">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => (
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
                {data && showAssign && (
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
                      <span className="text-xs text-t-phos-dim">{c.assignedStaffName || "--"}</span>
                    )}
                  </td>
                )}
                {showCosts && (
                  <td className="px-4 py-3 text-right text-t-phos tabular-nums">
                    {usd(c.aiCostUsd || 0)}
                  </td>
                )}
                <td className="px-4 py-3">
                  <StatusBadge status={clientStatus(c)} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

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
                ? isStaffView
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
          { label: "Joined", value: String(joinedCount) },
          ...(invites.length > 0 ? [{ label: "Invited", value: String(invites.length) }] : []),
          { label: "Sharing progress", value: String(summary.consented) },
          { label: "Active this week", value: String(summary.activeThisWeek) },
          { label: "Hired", value: String(summary.hired) },
          ...(canManage
            ? [{ label: "Seats used", value: seatLimit != null ? `${totalJoined}/${seatLimit}` : "Unlimited" }]
            : []),
          ...(showCosts ? [{ label: "AI cost (all time)", value: usd(totalAiCost) }] : []),
        ].map((s) => (
          <div key={s.label} className="bg-t-panel px-4 py-3 border border-t-line">
            <div className="text-2xl font-bold text-t-amber-bright">{s.value}</div>
            <div className="text-xs text-t-phos-dim mt-0.5">{s.label}</div>
          </div>
        ))}
      </div>

      {/* ── Admin drill-down: one staff member's clients ────────────────── */}
      {drillStaffId ? (
        <div>
          <button
            onClick={() => setDrillStaffId(null)}
            className="t-focus inline-flex items-center gap-1 text-sm text-t-amber-bright hover:text-t-amber mb-4"
          >
            &larr; Back to team overview
          </button>
          <div className="flex flex-wrap items-baseline justify-between gap-2 mb-3">
            <h2 className="text-lg font-bold text-t-white">{drillStaffName}</h2>
            <span className="text-xs text-t-phos-dim">
              {drillClients.length} sharing {drillClients.length === 1 ? "client" : "clients"}
            </span>
          </div>
          <ClientTable rows={drillClients} showAssign />
        </div>
      ) : (
        <>
          {/* ── Team org-chart (admin/owner only) ─────────────────────── */}
          {showTeam && (
            <div id="team" className="mb-8 scroll-mt-24">
              <div className="flex flex-wrap items-baseline justify-between gap-2 mb-3">
                <h2 className="text-lg font-bold text-t-white">Team</h2>
                <div className="flex items-center gap-3 text-xs">
                  <span className="text-t-phos-dim">
                    {staff.length} {staff.length === 1 ? "member" : "members"}
                    {seatLimit != null
                      ? ` -- ${totalJoined}/${seatLimit} seats used`
                      : " -- unlimited seats"}
                  </span>
                  <a
                    href={`mailto:troy@steelmanresumes.com?subject=${encodeURIComponent(
                      `More seats for ${data?.org.name || "our org"} (${data?.org.code || ""})`
                    )}`}
                    className="t-focus text-t-amber-bright hover:text-t-amber"
                  >
                    Request more seats
                  </a>
                </div>
              </div>
              {staff.length === 0 ? (
                <p className="text-sm text-t-phos-dim bg-t-panel border border-t-line px-4 py-4">
                  No staff yet. Add your team below, then assign clients to them.
                </p>
              ) : (
                <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {staff.map((m) => {
                    const r = rollups.get(m.userId) ?? { active: 0, behind: 0, hired: 0, sharing: 0 };
                    const notSharing = Math.max(0, m.clientCount - r.sharing);
                    return (
                      <button
                        key={m.userId}
                        onClick={() => setDrillStaffId(m.userId)}
                        className="t-focus text-left border border-t-line bg-t-panel px-3 py-3 hover:bg-t-panel-2 hover:border-t-line-strong transition-colors"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-sm font-medium text-t-white truncate">
                            {m.name || m.email}
                          </span>
                          <span
                            className={`text-[10px] px-1.5 py-0.5 border flex-shrink-0 ${
                              m.role === "org_admin"
                                ? "border-t-amber text-t-amber-bright"
                                : "border-t-line text-t-phos-dim"
                            }`}
                          >
                            {m.role === "org_admin" ? "Admin" : "Staff"}
                          </span>
                        </div>
                        {m.title && <div className="text-xs text-t-phos-dim">{m.title}</div>}
                        <div className="mt-2 text-2xl font-bold text-t-white">
                          {m.clientCount}
                          <span className="text-xs font-normal text-t-phos-dim ml-1">
                            {m.clientCount === 1 ? "client" : "clients"}
                          </span>
                        </div>
                        <div className="mt-1.5 flex flex-wrap gap-1.5 text-[11px]">
                          <span className="text-t-steel">{r.active} active</span>
                          <span className="text-t-phos-dim">&middot;</span>
                          <span className={r.behind > 0 ? "text-t-amber-bright" : "text-t-phos-dim"}>
                            {r.behind} behind
                          </span>
                          <span className="text-t-phos-dim">&middot;</span>
                          <span className="text-t-phos">{r.hired} hired</span>
                        </div>
                        {notSharing > 0 && (
                          <div className="text-[11px] text-t-phos-dim mt-1">
                            {notSharing} not sharing progress
                          </div>
                        )}
                      </button>
                    );
                  })}

                  {unassignedCount > 0 && (
                    <button
                      onClick={() => setDrillStaffId(UNASSIGNED)}
                      className="t-focus text-left border border-dashed border-t-amber bg-t-panel px-3 py-3 hover:bg-t-panel-2 transition-colors"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-medium text-t-amber-bright">Unassigned</span>
                        <span className="text-[10px] px-1.5 py-0.5 border border-t-amber text-t-amber-bright flex-shrink-0">
                          Needs a lead
                        </span>
                      </div>
                      <div className="mt-2 text-2xl font-bold text-t-white">
                        {unassignedCount}
                        <span className="text-xs font-normal text-t-phos-dim ml-1">
                          {unassignedCount === 1 ? "client" : "clients"}
                        </span>
                      </div>
                      <div className="text-[11px] text-t-phos-dim mt-1.5">
                        Not yet assigned to a staff member.
                      </div>
                    </button>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Add participant + pending invites */}
          {data && canInvite && (
            <div id="add" className="bg-t-panel border border-t-line px-4 py-4 mb-6 scroll-mt-24">
              <h2 className="text-sm font-semibold text-t-white mb-1">Add a participant</h2>
              <p className="text-xs text-t-phos-dim mb-3">
                {isStaffView
                  ? "They get an email that signs them straight in -- no code, no password, and they're assigned to you automatically."
                  : "They get an email that signs them straight in -- no code, no password. Their seat comes off your organization's allotment right away."}
              </p>
              <form onSubmit={sendInvite} className="flex flex-wrap gap-2">
                <input
                  type="text"
                  value={inviteName}
                  onChange={(e) => setInviteName(e.target.value)}
                  placeholder="Full name"
                  required
                  className="t-focus bg-t-panel border border-t-line text-sm text-t-phos px-3 py-2 flex-1 min-w-[160px]"
                />
                <input
                  type="email"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  placeholder="Email address"
                  required
                  className="t-focus bg-t-panel border border-t-line text-sm text-t-phos px-3 py-2 flex-1 min-w-[200px]"
                />
                <button
                  type="submit"
                  disabled={inviteBusy}
                  className="t-focus px-4 py-2 bg-transparent border border-t-amber text-t-amber-bright text-sm font-bold hover:bg-t-amber/10 disabled:opacity-50 min-h-touch"
                >
                  {inviteBusy ? "Sending..." : "Send invite"}
                </button>
              </form>
              {inviteMsg && (
                <p
                  className={`text-xs mt-3 ${
                    inviteMsg.kind === "ok" ? "text-t-phos" : "text-t-amber-bright"
                  }`}
                >
                  {inviteMsg.text}
                </p>
              )}

              {invites.length > 0 && (
                <div className="mt-4 border-t border-t-line pt-3">
                  <h3 className="text-xs uppercase font-semibold text-t-phos-dim mb-2">
                    Invited -- waiting to join
                  </h3>
                  <ul className="space-y-2">
                    {invites.map((inv) => (
                      <li
                        key={inv.userId}
                        className="flex flex-wrap items-center justify-between gap-2 border border-t-line px-3 py-2"
                      >
                        <div>
                          <span className="text-sm font-medium text-t-white">
                            {inv.name || inv.email}
                          </span>
                          {inv.name && (
                            <span className="text-xs text-t-phos-dim ml-2">{inv.email}</span>
                          )}
                          <div className="text-xs text-t-phos-dim">
                            Invited {fmtDate(inv.invitedAt)}
                            {inv.invitedByName ? ` by ${inv.invitedByName}` : ""}
                            {inv.sendCount > 1 ? ` -- sent ${inv.sendCount} times` : ""}
                          </div>
                        </div>
                        <div className="flex gap-2">
                          <button
                            onClick={() => inviteRowAction("resend_invite", inv)}
                            disabled={inviteRowBusy === inv.userId}
                            className="t-focus px-3 py-1.5 border border-t-line text-xs text-t-phos hover:text-t-white disabled:opacity-50"
                          >
                            Resend
                          </button>
                          <button
                            onClick={() => inviteRowAction("revoke_invite", inv)}
                            disabled={inviteRowBusy === inv.userId}
                            className="t-focus px-3 py-1.5 border border-t-line text-xs text-t-phos-dim hover:text-t-amber-bright disabled:opacity-50"
                          >
                            Remove
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
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

          {/* Full roster */}
          <div className="flex items-baseline justify-between gap-2 mb-3">
            <h2 className="text-lg font-bold text-t-white">
              {isStaffView ? "Your clients" : "All clients"}
            </h2>
            {showTeam && clients.length > 0 && (
              <span className="text-xs text-t-phos-dim">
                Tap a team member above to focus on their clients.
              </span>
            )}
          </div>
          <ClientTable rows={clients} showAssign={!!data} />

          {clients.length > 0 && joinedNotSharing > 0 && (
            <p className="text-xs text-t-phos-dim mt-4">
              {joinedNotSharing} more {joinedNotSharing === 1 ? "person has" : "people have"} joined with the
              code but have not turned on sharing yet. They control that from their own Settings.
            </p>
          )}

          {showCosts && (
            <p className="text-xs text-t-phos-dim mt-2">
              AI cost is the exact provider-billed token spend for each client&apos;s use of the
              platform&apos;s AI features. Staff accounts do not see this column.
            </p>
          )}
        </>
      )}
    </div>
  );
}
