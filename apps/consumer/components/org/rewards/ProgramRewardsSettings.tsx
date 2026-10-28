"use client";

/**
 * <ProgramRewardsSettings> -- the owner's or an org admin's choices for staff
 * rewards (migration 111, lane S6): keep the thank you board on or off, allow
 * recognition notes, and describe in the program's own words any reward with
 * cash value (a gift card, a day off). That last one is the program's call,
 * never Steel Man's. Nothing here turns anyone's Wins on: each staff member
 * does that themselves. Lane S2 mounts this on Settings or Team (WIRING NEEDED).
 */
import { useEffect, useState } from "react";

interface Program { teamBoardOn: boolean; recognitionNotesOn: boolean; programRewards: string | null; canEdit: boolean }

export function ProgramRewardsSettings() {
  const [p, setP] = useState<Program | null>(null);
  const [words, setWords] = useState("");
  const [msg, setMsg] = useState("");
  useEffect(() => {
    fetch("/api/org/rewards", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).then((d) => {
      if (!d?.program) return;
      setP(d.program);
      setWords(d.program.programRewards ?? "");
    }).catch(() => {});
  }, []);
  async function save(next: Partial<Program>) {
    setMsg("");
    const res = await fetch("/api/org/rewards", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ program: next }) }).catch(() => null);
    const d = await res?.json().catch(() => ({}));
    if (!res?.ok) { setMsg(d?.error || "That did not save."); return; }
    setP({ ...(d.program as Program) });
    setMsg("Saved.");
  }
  if (!p || !p.canEdit) return null;
  return (
    <section aria-labelledby="program-rewards-heading" className="border border-t-line rounded-[4px] px-4 py-3 mb-4">
      <h2 id="program-rewards-heading" className="text-sm font-semibold text-t-white">Staff wins</h2>
      <p className="text-xs text-t-phos-dim">Each staff member turns Wins on for themselves. These choices are the program&apos;s.</p>
      <label className="mt-2 flex items-start gap-3 text-sm">
        <input type="checkbox" className="t-focus mt-1 h-5 w-5" checked={p.teamBoardOn} onChange={(e) => save({ teamBoardOn: e.target.checked })} />
        <span>Show the thank you board. It lists who thanked a colleague, never who was thanked, and only people who chose to be on it.</span>
      </label>
      <label className="mt-2 flex items-start gap-3 text-sm">
        <input type="checkbox" className="t-focus mt-1 h-5 w-5" checked={p.recognitionNotesOn} onChange={(e) => save({ recognitionNotesOn: e.target.checked })} />
        <span>Allow notes about a staff member&apos;s work for funder reports. Each note is used only with that person&apos;s yes.</span>
      </label>
      <label className="mt-3 block text-sm">Anything your program offers, in your words (optional)
        <textarea maxLength={500} rows={2} value={words} onChange={(e) => setWords(e.target.value)} className="t-focus block w-full mt-1 border border-t-line bg-t-bg p-2"
          placeholder="Each quarter we pick one good catch to celebrate at the team lunch." />
      </label>
      <button type="button" className="t-focus mt-2 min-h-[44px] px-3 text-sm underline underline-offset-4" onClick={() => save({ programRewards: words })}>Save</button>
      {msg && <p role="status" className="mt-1 text-xs text-t-phos-dim">{msg}</p>}
    </section>
  );
}
