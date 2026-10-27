"use client";

/**
 * <RewardsToggle> -- the staff member's own "Show my wins" switch and "Show my
 * name on the thank you board" (migration 111, lane S6). Off by default; only
 * the person changes it. Lane S2 mounts this on My setup (WIRING NEEDED).
 *
 * The switch saves at once (it is this person's own view). A failed save
 * puts it back and says so.
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { REWARDS_COPY } from "@crucible/core/src/staffRewardsShared";

interface Settings { rewardsOn: boolean; boardOk: boolean }

export function RewardsToggle({ showWinsLink = true, onChange }: { showWinsLink?: boolean; onChange?: (s: Settings) => void }) {
  const [s, setS] = useState<Settings | null>(null);
  const [viewing, setViewing] = useState(false);
  const [msg, setMsg] = useState("");
  useEffect(() => {
    let live = true;
    fetch("/api/org/rewards", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).then((d) => {
      if (!live || !d) return;
      setViewing(!!d.viewing);
      setS(d.settings ?? { rewardsOn: false, boardOk: true });
    }).catch(() => {});
    return () => { live = false; };
  }, []);

  async function save(next: Settings) {
    const before = s;
    setS(next);
    setMsg("");
    try {
      const res = await fetch("/api/org/rewards", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(next) });
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || "That did not save.");
      setMsg(next.rewardsOn ? "Wins are on. Only you see them." : "Wins are off.");
      onChange?.(next);
    } catch (e) {
      setS(before);
      setMsg(e instanceof Error ? e.message : "That did not save.");
    }
  }

  if (!s) return null;
  return (
    <section aria-labelledby="rewards-toggle-heading" className="border border-t-line rounded-[4px] px-4 py-3 mb-4">
      <h2 id="rewards-toggle-heading" className="text-sm font-semibold text-t-white">Wins</h2>
      <label className="mt-2 flex items-start gap-3 text-sm text-t-phos">
        <input type="checkbox" className="t-focus mt-1 h-5 w-5" checked={s.rewardsOn} disabled={viewing}
          onChange={(e) => save({ ...s, rewardsOn: e.target.checked })} />
        <span><span className="font-semibold text-t-white">{REWARDS_COPY.toggleLabel}</span><br /><span className="text-t-phos-dim">{REWARDS_COPY.toggleHelp}</span></span>
      </label>
      {s.rewardsOn && (
        <label className="mt-3 flex items-start gap-3 text-sm text-t-phos">
          <input type="checkbox" className="t-focus mt-1 h-5 w-5" checked={s.boardOk} disabled={viewing}
            onChange={(e) => save({ ...s, boardOk: e.target.checked })} />
          <span><span className="font-semibold text-t-white">{REWARDS_COPY.boardLabel}</span><br /><span className="text-t-phos-dim">{REWARDS_COPY.boardHelp}</span></span>
        </label>
      )}
      {viewing && <p className="mt-2 text-xs text-t-phos-dim">You are viewing as someone else. Only they can change this.</p>}
      {msg && <p role="status" className="mt-2 text-xs text-t-phos-dim">{msg}</p>}
      {showWinsLink && s.rewardsOn && <p className="mt-2 text-sm"><Link href="/dashboard/wins" className="t-focus text-t-amber-bright underline underline-offset-4">Open your wins</Link></p>}
    </section>
  );
}
