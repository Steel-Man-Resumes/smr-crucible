"use client";

/**
 * Admin user directory -- search any account; open a blue read-only view or a
 * red assist session (break-glass reason required). The impersonation itself
 * is server-side; this page just starts it.
 */

import { useCallback, useEffect, useState } from "react";
import { useRealTier } from "@/lib/useUserTier";

function usd(v: unknown): string {
  const n = Number(v || 0);
  return `$${n.toFixed(n >= 1 ? 2 : 4)}`;
}

export default function AdminUsersPage() {
  const realTier = useRealTier();
  const [q, setQ] = useState("");
  const [users, setUsers] = useState<any[] | null>(null);
  const [error, setError] = useState("");
  const [assistFor, setAssistFor] = useState<any | null>(null);
  const [reason, setReason] = useState("");
  const [starting, setStarting] = useState(false);

  const load = useCallback(async (search: string) => {
    try {
      const res = await fetch(`/api/dev/users?q=${encodeURIComponent(search)}`);
      if (!res.ok) throw new Error();
      const d = await res.json();
      setUsers(d.users);
    } catch {
      setError("Could not load users.");
    }
  }, []);

  useEffect(() => {
    load("");
  }, [load]);

  async function start(targetUserId: string, mode: "view" | "assist", why?: string) {
    setStarting(true);
    try {
      const res = await fetch("/api/dev/impersonate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetUserId, mode, reason: why }),
      });
      const d = await res.json();
      if (!res.ok) {
        alert(d.error || "Could not start session.");
        return;
      }
      window.location.href = "/dashboard";
    } finally {
      setStarting(false);
    }
  }

  if (realTier !== "admin") {
    return <div className="max-w-4xl mx-auto px-4 py-12 text-t-phos-dim">Admins only.</div>;
  }

  return (
    <div className="max-w-6xl mx-auto px-4 py-10">
      <h1 className="text-2xl font-bold text-t-white mb-1">User accounts</h1>
      <p className="text-t-phos-dim text-sm mb-4">
        <span className="text-[#2d5a85] font-medium">View</span> = blue, read-only,
        writes blocked at the edge. <span className="text-t-red font-medium">Assist</span>{" "}
        = red, real changes, requires a logged reason, expires in 30 minutes.
      </p>

      <input
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          load(e.target.value);
        }}
        placeholder="Search by name or email..."
        className="w-full max-w-md px-4 py-2.5 border border-t-line text-sm bg-t-panel text-t-white focus:border-t-amber focus:outline-none mb-4"
      />

      {error && <p className="text-sm text-t-red">{error}</p>}
      {!users && !error && <p className="text-t-phos-dim text-sm">Loading...</p>}
      {users && (
        <div className="overflow-x-auto bg-t-panel border border-t-line">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase text-t-phos-dim border-b border-t-line">
                <th className="px-4 py-3 font-semibold">User</th>
                <th className="px-4 py-3 font-semibold">Tier</th>
                <th className="px-4 py-3 font-semibold">Via</th>
                <th className="px-4 py-3 font-semibold text-center">Apps</th>
                <th className="px-4 py-3 font-semibold text-right">AI cost</th>
                <th className="px-4 py-3 font-semibold"></th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className="border-b border-t-line last:border-0">
                  <td className="px-4 py-3">
                    <div className="font-medium text-t-white">{u.name || "--"}</div>
                    <div className="text-xs text-t-phos-dim">{u.email}</div>
                  </td>
                  <td className="px-4 py-3 text-xs text-t-phos">{u.tier}</td>
                  <td className="px-4 py-3 font-mono text-xs text-t-phos-dim">{u.joined_via || "--"}</td>
                  <td className="px-4 py-3 text-center text-t-white">{u.applications}</td>
                  <td className="px-4 py-3 text-right text-t-phos tabular-nums">{usd(u.ai_cost_usd)}</td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    <button
                      onClick={() => start(u.id, "view")}
                      disabled={starting}
                      className="t-focus px-3 py-1.5 text-xs font-bold border border-[#2d5a85] text-[#2d5a85] hover:bg-[#e9f0f7] mr-2 disabled:opacity-50"
                    >
                      View
                    </button>
                    <button
                      onClick={() => {
                        setAssistFor(u);
                        setReason("");
                      }}
                      disabled={starting}
                      className="t-focus px-3 py-1.5 text-xs font-bold border border-t-red text-t-red hover:bg-[#fbeae8] disabled:opacity-50"
                    >
                      Assist
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Break-glass reason modal */}
      {assistFor && (
        <div
          className="fixed inset-0 z-[80] bg-black/60 flex items-center justify-center p-4"
          onClick={() => setAssistFor(null)}
        >
          <div
            className="bg-t-panel border-2 border-t-red w-full max-w-md p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-bold text-t-red mb-1">
              Assist {assistFor.name || assistFor.email}
            </h3>
            <p className="text-xs text-t-phos-dim mb-3">
              This session can make REAL changes to their account. Why are you
              going in? One sentence -- it is stored in the audit log forever.
            </p>
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder='e.g. "Fixing her stuck resume save from support email"'
              autoFocus
              className="w-full px-3 py-2.5 border border-t-line text-sm bg-t-panel text-t-white focus:border-t-red focus:outline-none mb-3"
            />
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setAssistFor(null)}
                className="t-focus px-3 py-2 text-sm text-t-phos-dim hover:text-t-white"
              >
                Cancel
              </button>
              <button
                onClick={() => start(assistFor.id, "assist", reason)}
                disabled={reason.trim().length < 5 || starting}
                className="t-focus px-4 py-2 bg-t-red text-white text-sm font-bold hover:opacity-90 disabled:opacity-40"
              >
                Start assist session (30 min)
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
