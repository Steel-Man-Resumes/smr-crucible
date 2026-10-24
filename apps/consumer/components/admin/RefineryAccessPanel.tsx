"use client";

/**
 * Admin panel: who may use the Refinery (migration 093). The public sign-up
 * switch, the house organization seat requests are approved into, and usage
 * per seat. Every action is checked again on the server (platform admin and a
 * second factor on this sign-in).
 */
import { useCallback, useEffect, useState } from "react";

export interface AdminPolicy {
  publicSignupOpen: boolean;
  closedAt: string | null;
  houseCodeId: string | null;
  houseName: string | null;
  seatsUsed: number | null;
  seatsMax: number | null;
  legacyCount: number;
}
interface Org { id: string; partner_name: string; times_redeemed: number; max_redemptions: number | null }
interface Usage { name: string; seatsUsed: number; seatsMax: number | null; seats: { user_id: string; name: string; email: string; redeemed_at: string; ops_today: number; ops_30d: number; counted_30d: number; cost_30d_usd: number; incomplete_30d: number; last_ai_at: string | null }[] }

/** "N left" for the approve button, or null when unknown or unlimited. */
export function seatsLeft(p: Pick<AdminPolicy, "seatsUsed" | "seatsMax"> | null): number | null {
  if (!p || p.seatsMax === null || p.seatsUsed === null) return null;
  return Math.max(0, p.seatsMax - p.seatsUsed);
}

export function RefineryAccessPanel({ onPolicy }: { onPolicy?: (p: AdminPolicy | null) => void }) {
  const [policy, setPolicy] = useState<AdminPolicy | null>(null);
  const [orgs, setOrgs] = useState<Org[]>([]);
  const [house, setHouse] = useState("");
  const [usage, setUsage] = useState<Usage | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirmClose, setConfirmClose] = useState(false);

  const load = useCallback(async () => {
    setError("");
    try {
      const res = await fetch("/api/admin/refinery-access", { cache: "no-store" });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error || "Refinery access could not be read.");
      setPolicy(body.policy); setOrgs(body.orgs ?? []); setHouse(body.policy?.houseCodeId ?? "");
      onPolicy?.(body.policy);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Refinery access could not be read.");
      onPolicy?.(null);
    }
  }, [onPolicy]);
  useEffect(() => { void load(); }, [load]);

  async function act(body: Record<string, unknown>) {
    setBusy(true); setError("");
    try {
      const res = await fetch("/api/admin/refinery-access", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const out = await res.json().catch(() => null);
      if (!res.ok) throw new Error(out?.error || "That did not save.");
      setConfirmClose(false);
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "That did not save.");
    } finally { setBusy(false); }
  }

  async function loadUsage(orgId: string) {
    setUsage(null); setError("");
    const res = await fetch(`/api/admin/refinery-access?usage=${encodeURIComponent(orgId)}`, { cache: "no-store" });
    const body = await res.json().catch(() => null);
    if (res.ok) setUsage(body); else setError(body?.error || "Usage could not be read.");
  }

  const left = seatsLeft(policy);
  return (
    <section className="border border-t-line bg-t-panel p-4" data-testid="refinery-access-panel">
      <h2 className="text-base font-semibold text-t-white">Refinery sign-ups</h2>
      {error && <p role="alert" className="mt-2 text-sm text-t-red">{error}</p>}
      {policy && (
        <div className="mt-3 space-y-4 text-sm text-t-phos">
          <p>
            Public sign-ups to the Refinery are <strong className="text-t-white">{policy.publicSignupOpen ? "open" : "closed"}</strong>.
            {policy.publicSignupOpen
              ? " Anyone with a free account can use it."
              : ` Only people with a seat can use it. ${policy.legacyCount} accounts from before the close keep theirs.`}
          </p>
          {policy.publicSignupOpen ? (
            confirmClose ? (
              <div className="border border-t-amber p-3">
                <p>Every account that exists right now keeps the Refinery. New accounts get the Forge and need a seat for the Refinery. You can open it again any time.</p>
                <div className="mt-2 flex gap-2">
                  <button type="button" disabled={busy} onClick={() => void act({ action: "close" })} className="t-focus min-h-touch bg-t-amber px-3 py-2 font-bold text-white disabled:opacity-50">Close public sign-ups</button>
                  <button type="button" disabled={busy} onClick={() => setConfirmClose(false)} className="t-focus min-h-touch border border-t-line px-3 py-2">Cancel</button>
                </div>
              </div>
            ) : (
              <button type="button" disabled={busy} onClick={() => setConfirmClose(true)} className="t-focus min-h-touch border border-t-line px-3 py-2 font-semibold text-t-white">Close public sign-ups...</button>
            )
          ) : (
            <button type="button" disabled={busy} onClick={() => void act({ action: "open" })} className="t-focus min-h-touch border border-t-line px-3 py-2 font-semibold text-t-white">Open public sign-ups again</button>
          )}

          <label className="block">House organization (seat requests are approved into it)
            <select value={house} disabled={busy} onChange={(e) => setHouse(e.target.value)} className="t-focus mt-1 block w-full border border-t-line bg-t-panel-2 px-3 py-2 text-t-white">
              <option value="">Not set</option>
              {orgs.map((o) => <option key={o.id} value={o.id}>{o.partner_name} ({o.times_redeemed}/{o.max_redemptions ?? "no limit"} seats)</option>)}
            </select>
          </label>
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={busy || house === (policy.houseCodeId ?? "")} onClick={() => void act({ action: "house", codeId: house || null })} className="t-focus min-h-touch border border-t-line px-3 py-2 font-semibold text-t-white disabled:opacity-50">Save house organization</button>
            {policy.houseCodeId && <button type="button" onClick={() => void loadUsage(policy.houseCodeId!)} className="t-focus min-h-touch border border-t-line px-3 py-2">Show usage per seat</button>}
          </div>
          {policy.houseName && <p>{policy.houseName}: {policy.seatsUsed} seats used{left !== null ? `, ${left} left` : ", no seat limit"}.</p>}
          {policy.houseCodeId && policy.seatsMax === null && <p className="text-t-amber-bright">This pool has no seat limit. Give it one before you share its code.</p>}

          {usage && (
            <div className="overflow-x-auto">
              <p className="font-semibold text-t-white">{usage.name}: {usage.seatsUsed} seats used{usage.seatsMax !== null ? ` of ${usage.seatsMax}` : ""}</p>
              <table className="mt-2 w-full text-xs">
                <thead><tr className="text-left text-t-phos-dim"><th className="pr-2">Person</th><th className="pr-2">Joined</th><th className="pr-2">AI today</th><th className="pr-2">AI 30 days</th><th className="pr-2">Counted</th><th className="pr-2">Cost 30 days</th><th className="pr-2">Unpriced</th><th>Last AI</th></tr></thead>
                <tbody>{usage.seats.map((s) => <tr key={s.user_id} className="border-t border-t-line">
                  <td className="pr-2">{s.name || s.email}</td><td className="pr-2">{new Date(s.redeemed_at).toLocaleDateString()}</td>
                  <td className="pr-2">{s.ops_today}</td><td className="pr-2">{s.ops_30d}</td><td className="pr-2">{s.counted_30d}</td>
                  <td className="pr-2">${Number(s.cost_30d_usd).toFixed(2)}</td><td className="pr-2">{s.incomplete_30d}</td>
                  <td>{s.last_ai_at ? new Date(s.last_ai_at).toLocaleDateString() : "none"}</td></tr>)}</tbody>
              </table>
              <p className="mt-1 text-t-phos-dim">Cost counts reservations until the bill is known. Not an invoice.</p>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
