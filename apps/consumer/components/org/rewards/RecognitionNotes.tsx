"use client";

/**
 * <RecognitionNotes> -- for the owner or an org admin: write a short note
 * about a staff member's work for a funder report, and see each answer
 * (migration 111, lane S6). The note is used only after that person says yes,
 * and they can take it back; `forReport` holds only those. Lane S2 mounts this
 * on Team (WIRING NEEDED); a funder report reads listRecognitionForReport.
 */
import { useCallback, useEffect, useState } from "react";

interface Note { id: string; aboutFirstName: string | null; body: string; periodLabel: string | null; status: string }
const STATUS: Record<string, string> = { asked: "Waiting for their answer", approved: "They said yes", declined: "They said no", withdrawn: "They took it back" };

export function RecognitionNotes() {
  const [notes, setNotes] = useState<Note[] | null>(null);
  const [staff, setStaff] = useState<{ userId: string; name: string | null }[]>([]);
  const [about, setAbout] = useState("");
  const [body, setBody] = useState("");
  const [period, setPeriod] = useState("");
  const [msg, setMsg] = useState("");
  const load = useCallback(() => {
    fetch("/api/org/recognition", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).then((d) => {
      if (!d) return;
      setNotes(d.notes ?? []);
      setStaff(d.staff ?? []);
    }).catch(() => {});
  }, []);
  useEffect(() => { load(); }, [load]);
  async function write(e: React.FormEvent) {
    e.preventDefault();
    setMsg("");
    const res = await fetch("/api/org/recognition", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ aboutUserId: about, body, periodLabel: period || null }) }).catch(() => null);
    const d = await res?.json().catch(() => ({}));
    if (!res?.ok) { setMsg(d?.error || "That did not save."); return; }
    setBody(""); setPeriod("");
    setMsg("Sent to them to answer. It is used only if they say yes.");
    load();
  }
  if (notes === null) return null;
  return (
    <section aria-labelledby="recognition-heading" className="border border-t-line rounded-[4px] px-4 py-3 mb-4">
      <h2 id="recognition-heading" className="text-sm font-semibold text-t-white">Recognize someone&apos;s work</h2>
      <p className="text-xs text-t-phos-dim">For a funder report. They see it first, and it is used only with their yes.</p>
      <form onSubmit={write} className="mt-2 space-y-2">
        <label className="block text-sm">Who
          <select required value={about} onChange={(e) => setAbout(e.target.value)} className="t-focus block w-full mt-1 border border-t-line bg-t-bg p-2">
            <option value="">Pick a staff member</option>
            {staff.map((s) => <option key={s.userId} value={s.userId}>{s.name ?? "A staff member"}</option>)}
          </select>
        </label>
        <label className="block text-sm">What they did
          <textarea required minLength={10} maxLength={500} rows={3} value={body} onChange={(e) => setBody(e.target.value)} className="t-focus block w-full mt-1 border border-t-line bg-t-bg p-2"
            placeholder="Built the bus pass checklist the whole team uses now." />
        </label>
        <label className="block text-sm">For which report (optional)
          <input maxLength={60} value={period} onChange={(e) => setPeriod(e.target.value)} className="t-focus block w-full mt-1 border border-t-line bg-t-bg p-2" placeholder="Fall 2026 report" />
        </label>
        <button type="submit" className="t-focus min-h-[44px] px-4 text-sm font-semibold bg-t-amber text-[#14100a] rounded-[4px]">Ask them</button>
      </form>
      {msg && <p role="status" className="mt-2 text-xs text-t-phos-dim">{msg}</p>}
      {notes.length > 0 && (
        <ul className="mt-3 space-y-2 text-sm">{notes.map((n) => (
          <li key={n.id}><span className="font-semibold">{n.aboutFirstName ?? "Staff member"}</span>: &ldquo;{n.body}&rdquo; <span className="text-t-phos-dim">{STATUS[n.status] ?? n.status}{n.periodLabel ? `, ${n.periodLabel}` : ""}</span></li>))}
        </ul>)}
    </section>
  );
}
