"use client";

/**
 * <GiveKudos> -- "Send a good catch": thank a colleague for a piece of work
 * (migration 111, lane S6). Mount it beside a task, a note or a referral with
 * workKind and workId, or with no work at all (WIRING NEEDED lists the spots).
 *
 * Only the two of you see it. A participant's name is allowed only when it is
 * sent from that person's own task, note or referral and you both can see
 * them; record details are refused. Sending is always the person's click.
 */
import { useEffect, useState } from "react";
import { REWARDS_COPY, KUDOS_MAX } from "@crucible/core/src/staffRewardsShared";

interface Colleague { userId: string; name: string | null }

export function GiveKudos({ toUserId, workKind, workId, compact = false, onSent }: {
  toUserId?: string; workKind?: "task" | "note" | "referral" | "listing" | "other"; workId?: string; compact?: boolean; onSent?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [people, setPeople] = useState<Colleague[]>([]);
  const [to, setTo] = useState(toUserId ?? "");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  useEffect(() => {
    if (!open || people.length) return;
    fetch("/api/org/kudos", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).then((d) => setPeople(d?.colleagues ?? [])).catch(() => {});
  }, [open, people.length]);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg("");
    try {
      const res = await fetch("/api/org/kudos", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ toUserId: to, body, workKind, workId }) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d?.error || "That did not send.");
      setBody("");
      setOpen(false);
      setMsg("Sent. Thank you for noticing.");
      onSent?.();
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "That did not send.");
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <span className="inline-flex flex-col">
        <button type="button" onClick={() => setOpen(true)}
          className={`t-focus min-h-[44px] ${compact ? "px-2 text-xs" : "px-3 text-sm"} text-t-amber-bright underline underline-offset-4`}>
          {REWARDS_COPY.kudosGiveLabel}
        </button>
        {msg && <span role="status" className="text-xs text-t-phos-dim">{msg}</span>}
      </span>
    );
  }
  return (
    <form onSubmit={send} className="border border-t-line rounded-[4px] p-3 my-2 max-w-md" aria-label={REWARDS_COPY.kudosGiveLabel}>
      <p className="text-xs text-t-phos-dim mb-2">{REWARDS_COPY.kudosHelp}</p>
      <p className="text-xs text-t-phos-dim mb-2">{REWARDS_COPY.kudosCare}</p>
      {!toUserId && (
        <label className="block text-sm text-t-phos mb-2">Who
          <select required value={to} onChange={(e) => setTo(e.target.value)} className="t-focus block w-full mt-1 border border-t-line bg-t-bg p-2">
            <option value="">Pick a colleague</option>
            {people.map((p) => <option key={p.userId} value={p.userId}>{p.name ?? "A colleague"}</option>)}
          </select>
        </label>
      )}
      <label className="block text-sm text-t-phos">What they did well
        <textarea required minLength={3} maxLength={KUDOS_MAX} rows={3} value={body} onChange={(e) => setBody(e.target.value)}
          className="t-focus block w-full mt-1 border border-t-line bg-t-bg p-2" placeholder="Thanks for catching the bus pass deadline." />
      </label>
      <div className="mt-2 flex gap-3">
        <button type="submit" disabled={busy || !to || body.trim().length < 3} className="t-focus min-h-[44px] px-4 text-sm font-semibold bg-t-amber text-[#14100a] rounded-[4px] disabled:opacity-60">Send</button>
        <button type="button" onClick={() => { setOpen(false); setMsg(""); }} className="t-focus min-h-[44px] px-3 text-sm text-t-phos-dim underline underline-offset-4">Cancel</button>
      </div>
      {msg && <p role="alert" className="mt-2 text-xs text-t-phos">{msg}</p>}
    </form>
  );
}
