/**
 * SupportRequestsSection -- admin list of "Message Troy" escalations.
 * Embedded on the Evidence Dashboard. The DB rows are the source of truth
 * (the email notify is best-effort); this list is where nothing gets lost.
 */

"use client";

import { useCallback, useEffect, useState } from "react";

interface SupportRequest {
  id: string;
  email: string | null;
  message: string;
  thread_excerpt: string | null;
  page: string | null;
  status: "new" | "read" | "replied" | "closed";
  created_at: string;
  user_name: string | null;
}

const STATUS_ORDER: SupportRequest["status"][] = ["new", "read", "replied", "closed"];

export function SupportRequestsSection() {
  const [requests, setRequests] = useState<SupportRequest[] | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = useCallback(() => {
    fetch("/api/admin/support-requests")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => setRequests(j?.data ?? []))
      .catch(() => setRequests([]));
  }, []);

  useEffect(load, [load]);

  async function setStatus(id: string, status: SupportRequest["status"]) {
    setRequests((rs) =>
      rs ? rs.map((r) => (r.id === id ? { ...r, status } : r)) : rs
    );
    await fetch("/api/admin/support-requests", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, status }),
    }).catch(() => {});
  }

  const newCount = requests?.filter((r) => r.status === "new").length ?? 0;

  return (
    <div className="mt-10">
      <h2 className="text-lg font-semibold text-t-white mb-1">
        Support requests
        {newCount > 0 && (
          <span className="ml-2 rounded-[4px] bg-t-amber px-2 py-0.5 text-xs font-bold text-white">
            {newCount} new
          </span>
        )}
      </h2>
      <p className="text-sm text-t-phos-dim mb-4">
        Messages users sent to Troy from the assistant. Reply by email, then mark them here.
      </p>

      {requests === null && (
        <p className="text-sm text-t-phos-dim">Loading...</p>
      )}
      {requests?.length === 0 && (
        <p className="text-sm text-t-phos-dim border border-t-line bg-t-panel p-4">
          No support requests yet.
        </p>
      )}

      <div className="space-y-2">
        {requests?.map((r) => (
          <div key={r.id} className="border border-t-line bg-t-panel p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <span className="text-sm font-medium text-t-white">
                  {r.user_name || "Unknown user"}
                </span>
                <span className="ml-2 text-xs text-t-phos-dim">
                  {r.email || "no email"}
                  {r.page ? ` -- from ${r.page}` : ""}
                  {" -- "}
                  {new Date(r.created_at).toLocaleString()}
                </span>
              </div>
              <div className="flex gap-1">
                {STATUS_ORDER.map((s) => (
                  <button
                    key={s}
                    onClick={() => setStatus(r.id, s)}
                    className={`px-2 py-1 text-xs border transition-colors ${
                      r.status === s
                        ? "border-t-amber bg-t-amber text-white font-bold"
                        : "border-t-line text-t-phos-dim hover:border-t-phos-dim"
                    }`}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
            <p className="mt-2 whitespace-pre-wrap text-sm text-t-phos">{r.message}</p>
            {r.thread_excerpt && (
              <button
                onClick={() => setExpanded(expanded === r.id ? null : r.id)}
                className="mt-2 text-xs text-t-amber-bright hover:text-t-amber"
              >
                {expanded === r.id ? "Hide conversation" : "Show conversation"}
              </button>
            )}
            {expanded === r.id && r.thread_excerpt && (
              <pre className="mt-2 max-h-64 overflow-y-auto whitespace-pre-wrap border border-t-line bg-t-panel-2 p-3 text-xs text-t-phos-dim">
                {r.thread_excerpt}
              </pre>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
