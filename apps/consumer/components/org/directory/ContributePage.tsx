"use client";

/**
 * <ContributePage> -- "Help the directory" (lane S6, migration 112): add a
 * place we are missing, and see what you sent and the answers. An owner or
 * org admin also sees what the program's staff sent (first names only).
 * Credit is recorded for the program; nothing about it shows publicly yet.
 */
import { useCallback, useEffect, useState } from "react";
import { FLOW_LABELS, STATUS_WORDS, type ContributionFlow, type ContributionStatus } from "@crucible/core/src/directoryContributionShared";
import { ContributeForm } from "./ContributeForm";

interface Row { id: string; flow: ContributionFlow; name: string | null; status: ContributionStatus; ownerAnswer: string | null; createdAt: string; recheckOn: string | null; mine: boolean; submitterFirstName: string | null }
const when = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

export function ContributePage() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [msg, setMsg] = useState("");
  const load = useCallback(() => {
    fetch("/api/org/directory-contributions", { cache: "no-store" }).then((r) => (r.ok ? r.json() : { contributions: [] })).then((d) => setRows(d.contributions ?? [])).catch(() => setRows([]));
  }, []);
  useEffect(() => { load(); }, [load]);
  async function withdraw(id: string) {
    const r = await fetch("/api/org/directory-contributions", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ id }) }).catch(() => null);
    setMsg(r?.ok ? "Taken back." : "That could not be taken back.");
    load();
  }
  const mine = (rows ?? []).filter((r) => r.mine);
  const team = (rows ?? []).filter((r) => !r.mine);
  return (
    <main className="mx-auto max-w-3xl p-5 space-y-5">
      <header>
        <h1 className="text-2xl font-bold text-t-white">Help the directory</h1>
        <p className="text-sm text-t-phos-dim">You know people who know people. When you check on a place, tell us. Steel Man reviews every update before anything changes on the public directory.</p>
      </header>
      {adding ? <ContributeForm onDone={() => { load(); setTimeout(() => setAdding(false), 2500); }} onCancel={() => setAdding(false)} />
        : <button type="button" onClick={() => setAdding(true)} className="t-focus min-h-[44px] px-4 text-sm font-semibold bg-t-amber text-[#14100a] rounded-[4px]">{FLOW_LABELS.new_place.title}</button>}
      <p className="text-xs text-t-phos-dim">To fix a listing or say you called them, use the buttons on that listing.</p>
      {msg && <p role="status" className="text-sm">{msg}</p>}
      <section aria-labelledby="mine-heading">
        <h2 id="mine-heading" className="font-semibold text-t-white">What you sent</h2>
        {rows === null ? <p role="status">Loading...</p> : mine.length === 0 ? <p className="text-sm text-t-phos-dim">Nothing yet.</p> : (
          <ul className="mt-2 space-y-2">{mine.map((r) => (
            <li key={r.id} className="border border-t-line rounded-[4px] p-3 text-sm">
              <p><span className="font-semibold">{FLOW_LABELS[r.flow].title}</span>{r.name ? `: ${r.name}` : ""} <span className="text-t-phos-dim">{when(r.createdAt)}</span></p>
              <p className="text-t-phos">{STATUS_WORDS[r.status]}{r.ownerAnswer ? ` "${r.ownerAnswer}"` : ""}{r.status === "approved" && r.recheckOn ? ` We will check it again by ${when(r.recheckOn)}.` : ""}</p>
              {(r.status === "received" || r.status === "needs_more") && <button type="button" className="t-focus min-h-[44px] text-xs underline" onClick={() => withdraw(r.id)}>Take it back</button>}
            </li>))}
          </ul>)}
      </section>
      {team.length > 0 && (
        <section aria-labelledby="team-heading">
          <h2 id="team-heading" className="font-semibold text-t-white">From your team</h2>
          <ul className="mt-2 space-y-1 text-sm">{team.map((r) => (
            <li key={r.id}>{r.submitterFirstName ?? "A colleague"}: {FLOW_LABELS[r.flow].title}{r.name ? `, ${r.name}` : ""}. <span className="text-t-phos-dim">{STATUS_WORDS[r.status]}</span></li>))}
          </ul>
        </section>)}
    </main>
  );
}
