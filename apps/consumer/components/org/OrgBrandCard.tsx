"use client";

/**
 * <OrgBrandCard> -- "Your logo" on Team & access.
 *
 * The owner uploads or removes the organization's logo. Everyone else who can
 * open this page sees the current mark and who can change it. The server
 * decides what is accepted (PNG, JPEG or WebP by the bytes, never SVG, up to
 * 512 KB, 2048 px a side); the browser checks below are only a quicker answer.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { OrgMark } from "@/components/org/OrgMark";

interface BrandState { orgId: string; name: string; brand: { hasLogo: boolean; tier: string }; canManage: boolean }

const MAX_BYTES = 512 * 1024;
const TYPES = ["image/png", "image/jpeg", "image/webp"];

export function OrgBrandCard() {
  const [state, setState] = useState<BrandState | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [version, setVersion] = useState(0);
  const input = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoadFailed(false);
    const res = await fetch("/api/org/brand", { cache: "no-store" }).catch(() => null);
    if (!res || !res.ok) { setLoadFailed(true); return; }
    setState(await res.json());
  }, []);
  useEffect(() => { load(); }, [load]);

  async function upload(file: File) {
    setMsg(null);
    if (!TYPES.includes(file.type)) { setMsg({ kind: "error", text: "Use a PNG, JPEG or WebP file. SVG logos are not accepted." }); return; }
    if (file.size > MAX_BYTES) { setMsg({ kind: "error", text: "That logo is over 512 KB. Save it smaller and try again." }); return; }
    setBusy(true);
    const body = new FormData();
    body.append("file", file);
    const res = await fetch("/api/org/brand", { method: "POST", body }).catch(() => null);
    const data = res ? await res.json().catch(() => ({})) : {};
    setBusy(false);
    if (!res || !res.ok) { setMsg({ kind: "error", text: data.error || "The logo did not save. Try again." }); return; }
    setVersion((v) => v + 1);
    setMsg({ kind: "ok", text: data.note ? `Saved. ${data.note}` : "Saved. Your team sees it the next time a page loads." });
    await load();
  }

  async function remove() {
    setMsg(null);
    if (!window.confirm("Remove your logo? Your team sees your initials instead.")) return;
    setBusy(true);
    const res = await fetch("/api/org/brand", { method: "DELETE" }).catch(() => null);
    const data = res ? await res.json().catch(() => ({})) : {};
    setBusy(false);
    if (!res || !res.ok) { setMsg({ kind: "error", text: data.error || "The logo was not removed. Try again." }); return; }
    setMsg({ kind: "ok", text: "Removed. Your team sees your initials instead." });
    await load();
  }

  if (loadFailed) {
    return (
      <section aria-label="Your logo" className="bg-t-panel border border-t-line p-5 mb-6">
        <p className="text-sm text-t-phos-dim">Your logo could not be loaded. <button type="button" onClick={load} className="t-focus min-h-touch underline">Try again</button></p>
      </section>
    );
  }
  if (!state) return null;

  const { orgId, name, brand, canManage } = state;
  // The previews ask for the new file after an upload; the rest of the app
  // picks it up within the hour its browser may keep the old one.
  const preview = (size: 40 | 120) => brand.hasLogo
    ? <img src={`/api/org/brand/${encodeURIComponent(orgId)}/logo?v=${version}`} alt={`${name} logo at ${size} pixels`} width={size} height={size} style={{ width: size, height: size }} className="flex-none rounded-[4px] bg-[#ece7d9] object-contain" />
    : <OrgMark orgId={orgId} name={name} hasLogo={false} size={size} />;

  return (
    <section aria-labelledby="org-logo-heading" className="bg-t-panel border border-t-line p-5 mb-6">
      <h2 id="org-logo-heading" className="font-semibold text-t-white">Your logo</h2>
      <p className="text-xs text-t-phos-dim mb-4 max-w-2xl">
        Shows on your team&apos;s screens. Participants see it next to Steel Man only when co-branding is on for your organization.
      </p>
      <div className="flex flex-wrap items-end gap-5">
        {preview(120)}
        {preview(40)}
        <div className="min-w-[220px] flex-1">
          {!brand.hasLogo && <p className="text-sm text-t-white mb-2">No logo yet. Your team sees your initials instead.</p>}
          {canManage ? (
            <>
              <div
                onDragOver={(e) => { e.preventDefault(); }}
                onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files?.[0]; if (f && !busy) upload(f); }}
                className="border border-dashed border-t-line-strong p-4 text-sm text-t-phos"
              >
                <label className="t-focus inline-flex min-h-touch cursor-pointer items-center underline hover:text-t-white">
                  {brand.hasLogo ? "Choose a new logo" : "Choose a logo"}
                  <input ref={input} type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" disabled={busy}
                    onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); if (input.current) input.current.value = ""; }} />
                </label>
                <span className="text-t-phos-dim"> or drop it here.</span>
                <p className="mt-1 text-xs text-t-phos-dim">PNG, JPEG or WebP, up to 512 KB. A square image reads best, at least 240 pixels on a side.</p>
              </div>
              {brand.hasLogo && (
                <button type="button" onClick={remove} disabled={busy} className="t-focus mt-3 min-h-touch text-xs text-t-amber-bright underline hover:text-t-amber disabled:opacity-40">
                  Remove
                </button>
              )}
            </>
          ) : (
            <p className="text-xs text-t-phos-dim">Only the organization&apos;s owner can change the logo.</p>
          )}
          {busy && <p role="status" className="mt-2 text-xs text-t-phos-dim">Saving the logo.</p>}
          {msg && <p role={msg.kind === "error" ? "alert" : "status"} className={`mt-2 text-xs ${msg.kind === "error" ? "text-t-amber-bright" : "text-t-phos"}`}>{msg.text}</p>}
        </div>
      </div>
    </section>
  );
}
