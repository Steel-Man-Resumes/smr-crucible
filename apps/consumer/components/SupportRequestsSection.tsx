/**
 * SupportRequestsSection -- admin Help & Feedback inbox (Phase 8.6).
 * Embedded on the Evidence Dashboard. The DB rows are the source of truth (the
 * notify email is best-effort and link-only). Filters by status + category,
 * replies per row (the reply surfaces in the user's Help center), and shows an
 * on-demand text digest (no email, no cron).
 */

"use client";

import { useCallback, useEffect, useState } from "react";
import {
  SUPPORT_CATEGORIES,
  SUPPORT_CATEGORY_LABELS,
  displaySupportStatus,
  type SupportCategory,
} from "@crucible/core/src/supportRequestShared";

interface SupportRequest {
  id: string;
  email: string | null;
  category: string | null;
  message: string;
  thread_excerpt: string | null;
  page: string | null;
  context: Record<string, unknown> | null;
  status: string;
  admin_reply: string | null;
  created_at: string;
  user_name: string | null;
}

// Admin-settable states (display names). Reply is its own action below.
const STATUS_ACTIONS = ["received", "seen", "fixed", "closed"] as const;

export function SupportRequestsSection() {
  const [requests, setRequests] = useState<SupportRequest[] | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [replyDraft, setReplyDraft] = useState<Record<string, string>>({});
  const [digest, setDigest] = useState<string | null>(null);

  const load = useCallback(() => {
    const params = new URLSearchParams();
    if (statusFilter) params.set("status", statusFilter);
    if (categoryFilter) params.set("category", categoryFilter);
    const qs = params.toString();
    fetch(`/api/admin/support-requests${qs ? `?${qs}` : ""}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => setRequests(j?.data ?? []))
      .catch(() => setRequests([]));
  }, [statusFilter, categoryFilter]);

  useEffect(load, [load]);

  async function setStatus(id: string, status: string) {
    setRequests((rs) =>
      rs ? rs.map((r) => (r.id === id ? { ...r, status } : r)) : rs
    );
    await fetch("/api/admin/support-requests", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, status }),
    }).catch(() => {});
  }

  async function sendReply(id: string) {
    const reply = (replyDraft[id] || "").trim();
    if (!reply) return;
    await fetch("/api/admin/support-requests", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, reply }),
    }).catch(() => {});
    setReplyDraft((d) => ({ ...d, [id]: "" }));
    load();
  }

  async function loadDigest() {
    const j = await fetch("/api/admin/support-requests?digest=1")
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null);
    setDigest(j?.digest ?? "Could not build the digest.");
  }

  const openCount =
    requests?.filter((r) => {
      const d = displaySupportStatus(r.status);
      return d !== "closed" && d !== "replied";
    }).length ?? 0;

  return (
    <div id="support" className="mt-10 scroll-mt-24">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
        <h2 className="text-lg font-semibold text-t-white">
          Help &amp; Feedback
          {openCount > 0 && (
            <span className="ml-2 rounded-[4px] bg-t-amber px-2 py-0.5 text-xs font-bold text-white">
              {openCount} open
            </span>
          )}
        </h2>
        <button
          onClick={loadDigest}
          className="text-xs px-3 py-1.5 border border-t-line text-t-phos-dim hover:text-t-amber-bright"
        >
          Show digest
        </button>
      </div>
      <p className="text-sm text-t-phos-dim mb-4">
        Messages users sent from the Help center or the assistant. Reply here --
        your reply shows up in their Help center.
      </p>

      {digest !== null && (
        <pre className="mb-4 whitespace-pre-wrap border border-t-line bg-t-panel-2 p-3 text-xs text-t-phos">
          {digest}
        </pre>
      )}

      {/* Filters */}
      <div className="mb-4 flex flex-wrap gap-2">
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="border border-t-line bg-t-panel-2 text-t-white px-2 py-1.5 text-xs focus:border-t-amber focus:outline-none"
        >
          <option value="">All statuses</option>
          {["received", "seen", "fixed", "replied", "closed"].map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <select
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
          className="border border-t-line bg-t-panel-2 text-t-white px-2 py-1.5 text-xs focus:border-t-amber focus:outline-none"
        >
          <option value="">All categories</option>
          {SUPPORT_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {SUPPORT_CATEGORY_LABELS[c]}
            </option>
          ))}
        </select>
      </div>

      {requests === null && <p className="text-sm text-t-phos-dim">Loading...</p>}
      {requests?.length === 0 && (
        <p className="text-sm text-t-phos-dim border border-t-line bg-t-panel p-4">
          No matching requests.
        </p>
      )}

      <div className="space-y-2">
        {requests?.map((r) => {
          const filedByAssistant = !!(r.context && (r.context as Record<string, unknown>).filedByAssistant);
          return (
            <div key={r.id} className="border border-t-line bg-t-panel p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <span className="text-sm font-medium text-t-white">
                    {r.user_name || "Unknown user"}
                  </span>
                  <span className="ml-2 text-xs text-t-phos-dim">
                    {r.category
                      ? SUPPORT_CATEGORY_LABELS[r.category as SupportCategory] ?? r.category
                      : "Message"}
                    {" -- "}
                    {r.email || "no email"}
                    {r.page ? ` -- from ${r.page}` : ""}
                    {" -- "}
                    {new Date(r.created_at).toLocaleString()}
                    {filedByAssistant ? " -- filed by t.ROY" : ""}
                  </span>
                </div>
                <div className="flex gap-1">
                  {STATUS_ACTIONS.map((s) => (
                    <button
                      key={s}
                      onClick={() => setStatus(r.id, s)}
                      className={`px-2 py-1 text-xs border transition-colors ${
                        displaySupportStatus(r.status) === s
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

              {r.admin_reply && (
                <div className="mt-3 border-l-2 border-t-amber pl-3">
                  <p className="text-xs font-semibold text-t-amber-bright mb-0.5">
                    Your reply (shown to the user):
                  </p>
                  <p className="whitespace-pre-wrap text-sm text-t-white">{r.admin_reply}</p>
                </div>
              )}

              {/* Reply box */}
              <div className="mt-3 flex flex-col sm:flex-row gap-2">
                <textarea
                  value={replyDraft[r.id] || ""}
                  onChange={(e) =>
                    setReplyDraft((d) => ({ ...d, [r.id]: e.target.value }))
                  }
                  rows={2}
                  maxLength={4000}
                  placeholder={r.admin_reply ? "Update your reply..." : "Write a reply..."}
                  className="flex-1 border border-t-line bg-t-panel-2 text-t-white px-3 py-2 text-sm focus:border-t-amber focus:outline-none"
                />
                <button
                  onClick={() => sendReply(r.id)}
                  disabled={!(replyDraft[r.id] || "").trim()}
                  className="self-start px-3 py-2 text-sm bg-t-amber text-white font-medium hover:bg-t-amber-bright disabled:opacity-50"
                >
                  {r.admin_reply ? "Update reply" : "Send reply"}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
