"use client";

/**
 * Admin: premium access (migration 078). Troy's side of "Ask SMR for access":
 * open requests, live grants, and a grant form with a required reason and an
 * optional end date. The server checks platform admin and two-step on every
 * call (requirePlatformAdmin). Nothing here sends email.
 */

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRealTier } from "@/lib/useUserTier";
import { PREMIUM_TOOL_IDS, PREMIUM_TOOL_LABELS, type PremiumToolId } from "@/lib/premium";

interface Req { id: string; user_id: string; email: string | null; name: string | null; tool: PremiumToolId; note: string | null; created_at: string }
interface Grant { id: string; user_id: string; email: string | null; name: string | null; tools: PremiumToolId[]; reason: string; ends_at: string | null; granted_at: string }

const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "");

export default function AdminPremiumPage() {
  const realTier = useRealTier();
  const [requests, setRequests] = useState<Req[] | null>(null);
  const [grants, setGrants] = useState<Grant[]>([]);
  const [notReady, setNotReady] = useState(false);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [form, setForm] = useState<{ email: string; userId: string | null; requestId: string | null; tools: PremiumToolId[]; reason: string; endsAt: string }>({
    email: "", userId: null, requestId: null, tools: [...PREMIUM_TOOL_IDS], reason: "", endsAt: "",
  });

  const load = useCallback(() => {
    fetch("/api/admin/premium")
      .then((r) => (r.ok ? r.json() : r.json().then((j) => Promise.reject(j.error || r.status))))
      .then((j) => {
        setRequests(j.data.requests);
        setGrants(j.data.grants);
        setNotReady(!!j.notReady);
      })
      .catch((e) => setError(typeof e === "string" ? e : "Could not load premium access."));
  }, []);
  useEffect(load, [load]);

  async function post(body: Record<string, unknown>) {
    setMsg("");
    const res = await fetch("/api/admin/premium", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) { setMsg(j.error || "That did not work."); return false; }
    load();
    return true;
  }

  async function grant(e: React.FormEvent) {
    e.preventDefault();
    const ok = await post({
      action: "grant",
      ...(form.userId ? { userId: form.userId } : { email: form.email }),
      requestId: form.requestId,
      tools: form.tools,
      reason: form.reason,
      endsAt: form.endsAt || null,
    });
    if (ok) {
      setMsg("Granted. It opens for them on their next page load.");
      setForm({ email: "", userId: null, requestId: null, tools: [...PREMIUM_TOOL_IDS], reason: "", endsAt: "" });
    }
  }

  if (realTier !== "admin") return <div className="max-w-4xl mx-auto px-4 py-12 text-t-phos-dim">Admins only.</div>;

  return (
    <div className="max-w-4xl space-y-8">
      <div>
        <Link href="/dashboard/admin" className="text-sm text-t-phos-dim underline">Back to admin</Link>
        <h1 className="mt-2 text-2xl font-bold text-t-white">Premium access</h1>
        <p className="mt-1 text-sm text-t-phos-dim">
          Local resources, interview coaching and one-click apply. Members of a sponsoring organization have them already.
          Grant them here, case by case. A reason is required; an end date is optional. Nobody is emailed.
        </p>
      </div>
      {notReady && <p className="border border-t-amber p-3 text-sm text-t-amber-bright">Migration 078 is not applied on this database, so premium tools are open to everyone here.</p>}
      {error && <p className="text-sm text-t-red">{error}</p>}
      {msg && <p role="status" className="text-sm text-t-phos">{msg}</p>}

      <section className="border border-t-line bg-t-panel p-5" data-testid="admin-premium-requests">
        <h2 className="text-lg font-semibold text-t-white">Requests</h2>
        {!requests && !error && <p className="mt-2 text-sm text-t-phos-dim">Loading...</p>}
        {requests && requests.length === 0 && <p className="mt-2 text-sm text-t-phos-dim">No open requests.</p>}
        <ul className="mt-3 space-y-3">
          {(requests ?? []).map((r) => (
            <li key={r.id} className="border border-t-line p-3 text-sm">
              <p className="text-t-white">
                <span className="font-semibold">{r.name || r.email || "Unknown"}</span>
                {r.email && r.name ? ` (${r.email})` : ""} asked for {PREMIUM_TOOL_LABELS[r.tool]} on {day(r.created_at)}.
              </p>
              {r.note && <p className="mt-1 text-t-phos">&ldquo;{r.note}&rdquo;</p>}
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  className="t-focus min-h-touch border border-t-amber px-3 text-t-amber-bright"
                  onClick={() => setForm({ email: r.email ?? "", userId: r.user_id, requestId: r.id, tools: [r.tool], reason: "", endsAt: "" })}
                >
                  Grant
                </button>
                <button type="button" className="t-focus min-h-touch border border-t-line px-3 text-t-phos" onClick={() => void post({ action: "decline", requestId: r.id })}>
                  Decline
                </button>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section className="border border-t-line bg-t-panel p-5">
        <h2 className="text-lg font-semibold text-t-white">Grant access</h2>
        <form onSubmit={grant} className="mt-3 grid gap-3" data-testid="admin-premium-grant">
          <label className="text-sm text-t-phos-dim">
            Account email
            <input
              type="email"
              required={!form.userId}
              disabled={!!form.userId}
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value, userId: null, requestId: null })}
              className="mt-1 block w-full border border-t-line bg-t-panel-2 px-3 py-2 text-t-white"
            />
          </label>
          <fieldset className="text-sm text-t-phos-dim">
            <legend>Tools</legend>
            {PREMIUM_TOOL_IDS.map((t) => (
              <label key={t} className="mr-4 inline-flex items-center gap-2 text-t-white">
                <input
                  type="checkbox"
                  checked={form.tools.includes(t)}
                  onChange={(e) => setForm({ ...form, tools: e.target.checked ? [...form.tools, t] : form.tools.filter((x) => x !== t) })}
                />
                {PREMIUM_TOOL_LABELS[t]}
              </label>
            ))}
          </fieldset>
          <label className="text-sm text-t-phos-dim">
            Reason (required)
            <input
              required
              minLength={3}
              maxLength={500}
              value={form.reason}
              onChange={(e) => setForm({ ...form, reason: e.target.value })}
              className="mt-1 block w-full border border-t-line bg-t-panel-2 px-3 py-2 text-t-white"
            />
          </label>
          <label className="text-sm text-t-phos-dim">
            End date (optional)
            <input
              type="date"
              value={form.endsAt}
              onChange={(e) => setForm({ ...form, endsAt: e.target.value })}
              className="mt-1 block border border-t-line bg-t-panel-2 px-3 py-2 text-t-white"
            />
          </label>
          <div className="flex gap-2">
            <button type="submit" className="t-focus min-h-touch bg-t-amber px-4 font-bold text-white">Grant</button>
            {form.userId && (
              <button type="button" className="t-focus min-h-touch border border-t-line px-4 text-t-phos" onClick={() => setForm({ email: "", userId: null, requestId: null, tools: [...PREMIUM_TOOL_IDS], reason: "", endsAt: "" })}>
                Clear
              </button>
            )}
          </div>
        </form>
      </section>

      <section className="border border-t-line bg-t-panel p-5">
        <h2 className="text-lg font-semibold text-t-white">Live grants</h2>
        {grants.length === 0 && <p className="mt-2 text-sm text-t-phos-dim">None yet.</p>}
        <ul className="mt-3 space-y-3">
          {grants.map((g) => (
            <li key={g.id} className="border border-t-line p-3 text-sm">
              <p className="text-t-white">
                <span className="font-semibold">{g.name || g.email || "Unknown"}</span>: {g.tools.map((t) => PREMIUM_TOOL_LABELS[t]).join(", ")}
              </p>
              <p className="mt-1 text-t-phos-dim">
                {g.reason}. Granted {day(g.granted_at)}{g.ends_at ? `, ends ${day(g.ends_at)}` : ", no end date"}.
              </p>
              <button type="button" className="t-focus mt-2 min-h-touch border border-t-line px-3 text-t-phos" onClick={() => void post({ action: "revoke", grantId: g.id })}>
                Revoke
              </button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
