"use client";
/**
 * The phone number and other names your organization keeps for a person
 * (house lane L5). Your organization's own record, like the name on an invite:
 * it makes search and the duplicate check work. Never a DOC or case number.
 */
import { useEffect, useState } from "react";

export function ParticipantContactPanel({ clientId, first }: { clientId: string; first: string }) {
  const [data, setData] = useState<{ contact: { phone: string | null; aliases: string[] }; canWrite: boolean } | null>(null);
  const [phone, setPhone] = useState("");
  const [aliases, setAliases] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    fetch(`/api/org/clients/${clientId}/contact`).then((r) => (r.ok ? r.json() : null)).then((d) => {
      if (!d) return;
      setData(d); setPhone(d.contact.phone ?? ""); setAliases((d.contact.aliases ?? []).join(", "));
    }).catch(() => {});
  }, [clientId]);
  if (!data) return null;
  const summary = [data.contact.phone, data.contact.aliases?.length ? `also goes by ${data.contact.aliases.join(", ")}` : null].filter(Boolean).join(" · ");
  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setMsg(null);
    const res = await fetch(`/api/org/clients/${clientId}/contact`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ phone, aliases }) }).catch(() => null);
    setBusy(false);
    if (res?.ok) { setMsg({ ok: true, text: "Saved." }); setData({ ...data!, contact: { phone: phone.trim() || null, aliases: aliases.split(",").map((s) => s.trim()).filter(Boolean).slice(0, 5) } }); }
    else setMsg({ ok: false, text: (await res?.json().catch(() => ({})))?.error || "That did not save." });
  }
  return (
    <details className="mb-5 border border-t-line bg-t-panel px-4 py-2">
      <summary className="t-focus flex min-h-touch cursor-pointer items-center text-sm text-t-phos">
        Phone and other names{summary ? <span className="ml-2 text-xs text-t-phos-dim">{summary}</span> : <span className="ml-2 text-xs text-t-phos-dim">none on file</span>}
      </summary>
      <form onSubmit={save} className="py-3">
        <p className="mb-3 text-xs text-t-phos-dim">Your organization&apos;s record, so you can find {first} by phone or by a name they go by. Never a DOC number or a case number.</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-xs text-t-phos-dim">Phone
            <input value={phone} onChange={(e) => setPhone(e.target.value)} disabled={!data.canWrite} inputMode="tel" maxLength={40}
              className="plain-field t-focus mt-1 w-full border border-t-line bg-t-panel-2 px-3 py-2 text-sm text-t-white" />
          </label>
          <label className="text-xs text-t-phos-dim">Other names they go by (comma between, up to five)
            <input value={aliases} onChange={(e) => setAliases(e.target.value)} disabled={!data.canWrite} maxLength={600}
              className="plain-field t-focus mt-1 w-full border border-t-line bg-t-panel-2 px-3 py-2 text-sm text-t-white" />
          </label>
        </div>
        {data.canWrite && <button disabled={busy} className="t-focus mt-3 min-h-touch border border-t-line px-4 text-sm text-t-phos hover:text-t-white disabled:opacity-50">{busy ? "Saving..." : "Save"}</button>}
        {msg && <p role={msg.ok ? "status" : "alert"} className={`mt-2 text-xs ${msg.ok ? "text-t-phos" : "text-t-amber-bright"}`}>{msg.text}</p>}
      </form>
    </details>
  );
}
