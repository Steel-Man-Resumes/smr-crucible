"use client";
/**
 * <OutboundBrandingControl> (migration 107, staff pass 2026-10-27 lane S2):
 * the platform admin's switch for how an organization's outgoing work is
 * branded, for Admin > Organizations > Manage. Co-branded with Steel Man
 * Resumes by default; the organization's own name only when it has bought
 * exclusive branding. No price here: what is sold is agreed outside the app.
 * The route and the database both refuse anyone but a platform admin.
 */
import { useEffect, useState } from "react";
import { orgOutboundBrand, type OrgBranding } from "@crucible/core/src/orgOutboundBrandShared";

const input = "w-full bg-t-bg border border-t-line px-3 py-2 text-sm text-t-white focus:border-t-amber outline-none";
const btn = "t-focus inline-flex items-center px-3 py-1.5 text-xs font-bold border border-t-amber text-t-amber-bright hover:bg-t-amber/10 disabled:opacity-50";

export const OUTBOUND_BRANDING_OPTIONS: readonly { value: OrgBranding; label: string }[] = [
  { value: "co_brand", label: "Co-branded with Steel Man Resumes (default)" },
  { value: "exclusive", label: "Organization's own name only (exclusive)" },
];

export function OutboundBrandingControl({ orgId, orgName }: { orgId: string; orgName: string }) {
  const [current, setCurrent] = useState<OrgBranding | null>(null);
  const [choice, setChoice] = useState<OrgBranding>("co_brand");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    let live = true;
    fetch(`/api/admin/orgs/outbound-brand?${new URLSearchParams({ orgId, name: orgName })}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (!live || !d) return; const b = d.branding === "exclusive" ? "exclusive" : "co_brand"; setCurrent(b); setChoice(b); })
      .catch(() => {});
    return () => { live = false; };
  }, [orgId, orgName]);

  async function save() {
    if (busy) return;
    setBusy(true); setMessage(null);
    try {
      const res = await fetch("/api/admin/orgs/outbound-brand", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ orgId, branding: choice }) });
      const d = await res.json().catch(() => ({}));
      if (res.ok) { setCurrent(choice); setMessage({ ok: true, text: `Outgoing reports and emails now read: ${orgOutboundBrand({ name: orgName, branding: choice }).line}.` }); }
      else setMessage({ ok: false, text: d?.error || "That did not save. Nothing changed." });
    } catch { setMessage({ ok: false, text: "That did not save. Nothing changed." }); }
    finally { setBusy(false); }
  }

  return (
    <div data-testid="outbound-branding">
      <div className="text-t-phos-dim mb-1">Outgoing reports and emails (prints, downloads, invites)</div>
      <div className="flex gap-2">
        <select className={input} value={choice} onChange={(e) => setChoice(e.target.value === "exclusive" ? "exclusive" : "co_brand")} aria-label="Outgoing branding">
          {OUTBOUND_BRANDING_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <button type="button" className={btn} disabled={busy || current === null || choice === current} onClick={() => void save()}>{busy ? "Saving" : "Set"}</button>
      </div>
      <p className="text-t-phos-dim mt-1">Reads now: {orgOutboundBrand({ name: orgName, branding: current ?? "co_brand" }).line}</p>
      {message && <p role={message.ok ? "status" : "alert"} className={`mt-1 ${message.ok ? "text-t-phos" : "text-t-red"}`}>{message.text}</p>}
    </div>
  );
}
