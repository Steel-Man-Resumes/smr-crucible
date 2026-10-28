"use client";

/**
 * <WinsPage> -- a staff member's own wins (migration 111, lane S6).
 *
 * Off until the person turns it on. While off, only two things show, because
 * neither is a game: good catches colleagues sent (a thank you) and notes
 * your program asked to use in a funder report (they need your answer).
 * While on: time t.ROY saved you, milestones by kind, tools you opened, the
 * thank you board (thanks GIVEN only), your month (copy or print it to share
 * with your supervisor; nothing is sent for you), and your program's own
 * words about any reward with cash value.
 *
 * Never a score on client outcomes, records, notes written or contacts made.
 */
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ProgressCelebration } from "@/components/progression/ProgressCelebration";
import { RewardsToggle } from "./RewardsToggle";
import { GiveKudos } from "./GiveKudos";
import {
  MILESTONE_GROUP_LABELS, REWARDS_COPY, UNLOCKS, timeSavedWords, type MilestoneGroup, type UnlockKey,
} from "@crucible/core/src/staffRewardsShared";

interface Kudos { id: string; body: string; at: string; otherFirstName: string | null }
interface Milestone { key: string; title: string; detail: string; group: MilestoneGroup; earnedAt: string; seen: boolean }
interface Note { id: string; body: string; periodLabel: string | null; status: "asked" | "approved" | "declined" | "withdrawn" }
interface Wins {
  viewing: boolean;
  settings: { rewardsOn: boolean; boardOk: boolean };
  program?: { teamBoardOn: boolean; recognitionNotesOn: boolean; programRewards: string | null };
  kudos?: { received: Kudos[]; given: Kudos[] };
  recognition?: Note[];
  milestones?: Milestone[];
  newMilestones?: Milestone[];
  unlocks?: UnlockKey[];
  time?: { weekMinutes: number; monthMinutes: number };
  board?: { userId: string; firstName: string }[];
  recap?: { title: string; lines: string[]; text: string; empty: boolean } | null;
}

const when = (iso: string) => new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });

export function WinsPage({ accountId = "staff" }: { accountId?: string }) {
  const [w, setW] = useState<Wins | null>(null);
  const [error, setError] = useState(false);
  const [msg, setMsg] = useState("");
  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/org/rewards", { cache: "no-store" });
      if (!r.ok) throw new Error();
      setW(await r.json());
      setError(false);
    } catch { setError(true); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const newest = w?.newMilestones?.[0];
  useEffect(() => {
    if (!newest) return;
    fetch("/api/org/rewards", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "seen", keys: (w?.newMilestones ?? []).map((m) => m.key) }) }).catch(() => {});
  }, [newest, w?.newMilestones]);

  async function answer(id: string, status: "approved" | "declined" | "withdrawn") {
    setMsg("");
    const r = await fetch("/api/org/recognition", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ id, status }) }).catch(() => null);
    setMsg(r?.ok ? (status === "approved" ? "Thank you. Your program may use it." : status === "declined" ? "Understood. It will not be used." : "Taken back. It will not be used.") : "That did not save.");
    load();
  }
  async function withdraw(id: string) {
    const r = await fetch("/api/org/kudos", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ id }) }).catch(() => null);
    setMsg(r?.ok ? "Taken back." : "That did not save.");
    load();
  }
  async function copyRecap(text: string) {
    try { await navigator.clipboard.writeText(text); setMsg("Copied. Paste it wherever you share with your supervisor."); }
    catch { setMsg("Select the text and copy it."); }
  }

  if (error) return <main className="p-5"><p role="alert">Wins could not load. <button type="button" className="t-focus underline" onClick={load}>Try again</button></p></main>;
  if (!w) return <main className="p-5"><p role="status">Loading your wins...</p></main>;
  if (w.viewing) return <main className="p-5"><h1 className="text-2xl font-bold">Wins</h1><p className="mt-2">Wins are private to each staff member, so they do not show while you view as someone else.</p></main>;

  const on = w.settings.rewardsOn;
  const asked = (w.recognition ?? []).filter((n) => n.status === "asked");
  const answered = (w.recognition ?? []).filter((n) => n.status !== "asked");
  const groups = (Object.keys(MILESTONE_GROUP_LABELS) as MilestoneGroup[]).map((g) => ({ g, items: (w.milestones ?? []).filter((m) => m.group === g) })).filter((x) => x.items.length);
  const opened = new Set(w.unlocks ?? []);

  return (
    <main className="mx-auto max-w-3xl p-5 space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-t-white">Wins</h1>
        <p className="text-sm text-t-phos-dim">For you. Nothing here counts notes, calls, or anyone&apos;s results.</p>
      </header>
      {msg && <p role="status" className="text-sm text-t-phos">{msg}</p>}
      {on && newest && <ProgressCelebration accountId={accountId} celebration={{ id: `staff:${newest.key}`, title: newest.title, detail: newest.detail }} />}

      {asked.length > 0 && (
        <section aria-labelledby="wins-recognition" className="border border-t-amber rounded-[4px] p-4">
          <h2 id="wins-recognition" className="font-semibold text-t-white">{REWARDS_COPY.recognitionTitle}</h2>
          <p className="text-sm text-t-phos-dim">{REWARDS_COPY.recognitionHelp}</p>
          <ul className="mt-3 space-y-3">{asked.map((n) => (
            <li key={n.id}>
              <p className="text-t-phos">&ldquo;{n.body}&rdquo;{n.periodLabel ? <span className="text-t-phos-dim"> ({n.periodLabel})</span> : null}</p>
              <div className="flex gap-3 mt-1">
                <button type="button" className="t-focus min-h-[44px] px-4 text-sm font-semibold bg-t-amber text-[#14100a] rounded-[4px]" onClick={() => answer(n.id, "approved")}>Yes, use it</button>
                <button type="button" className="t-focus min-h-[44px] px-3 text-sm underline underline-offset-4" onClick={() => answer(n.id, "declined")}>No thanks</button>
              </div>
            </li>))}
          </ul>
        </section>
      )}

      {!on && (
        <section aria-labelledby="wins-off" className="space-y-2">
          <h2 id="wins-off" className="font-semibold text-t-white">{REWARDS_COPY.offTitle}</h2>
          <p className="text-sm text-t-phos-dim">{REWARDS_COPY.offBody}</p>
          <RewardsToggle showWinsLink={false} onChange={() => load()} />
        </section>
      )}

      {on && w.time && (
        <section aria-labelledby="wins-time" className="border border-t-line rounded-[4px] p-4">
          <h2 id="wins-time" className="font-semibold text-t-white">{REWARDS_COPY.timeTitle}</h2>
          <p className="mt-1 text-t-phos">{timeSavedWords(w.time.weekMinutes) ? `This week t.ROY saved you ${timeSavedWords(w.time.weekMinutes)}.` : "No t.ROY drafts used this week yet."}
            {timeSavedWords(w.time.monthMinutes) ? ` This month, ${timeSavedWords(w.time.monthMinutes)}.` : ""}</p>
          <p className="text-xs text-t-phos-dim">{REWARDS_COPY.timeHelp}</p>
        </section>
      )}

      <section aria-labelledby="wins-kudos" className="border border-t-line rounded-[4px] p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="wins-kudos" className="font-semibold text-t-white">{REWARDS_COPY.kudosTitle}</h2>
          <GiveKudos onSent={load} />
        </div>
        {(w.kudos?.received ?? []).length === 0 ? <p className="text-sm text-t-phos-dim mt-2">None yet. They will show here when a colleague sends one.</p> : (
          <ul className="mt-2 space-y-2">{(w.kudos?.received ?? []).map((k) => (
            <li key={k.id} className="text-sm"><span className="font-semibold text-t-white">{k.otherFirstName ?? "A colleague"}</span> <span className="text-t-phos-dim">{when(k.at)}</span><br /><span className="text-t-phos">&ldquo;{k.body}&rdquo;</span></li>))}
          </ul>)}
        {(w.kudos?.given ?? []).length > 0 && (
          <details className="mt-3"><summary className="t-focus cursor-pointer text-sm text-t-phos-dim">Ones you sent ({(w.kudos?.given ?? []).length})</summary>
            <ul className="mt-2 space-y-2">{(w.kudos?.given ?? []).map((k) => (
              <li key={k.id} className="text-sm">To <span className="font-semibold">{k.otherFirstName ?? "a colleague"}</span>: &ldquo;{k.body}&rdquo;
                <button type="button" className="t-focus ml-2 min-h-[44px] text-xs underline" onClick={() => withdraw(k.id)}>Take back</button></li>))}
            </ul>
          </details>)}
      </section>

      {on && (
        <section aria-labelledby="wins-milestones" className="border border-t-line rounded-[4px] p-4">
          <h2 id="wins-milestones" className="font-semibold text-t-white">Milestones</h2>
          {groups.length === 0 ? <p className="text-sm text-t-phos-dim mt-1">Your first ones come from everyday good practice: closing a referral loop with a reason, saving your own view, using a t.ROY draft, thanking a colleague.</p>
            : groups.map(({ g, items }) => (
              <div key={g} className="mt-3"><h3 className="text-sm font-semibold text-t-phos">{MILESTONE_GROUP_LABELS[g]}</h3>
                <ul className="mt-1 space-y-1">{items.map((m) => <li key={m.key} className="text-sm"><span className="text-t-white">{m.title}</span> <span className="text-t-phos-dim">{when(m.earnedAt)}. {m.detail}</span></li>)}</ul>
              </div>))}
          <h3 className="mt-4 text-sm font-semibold text-t-phos">Tools you can open</h3>
          <ul className="mt-1 space-y-1">{UNLOCKS.map((u) => (
            <li key={u.key} className="text-sm"><span className={opened.has(u.key) ? "text-t-white" : "text-t-phos-dim"}>{opened.has(u.key) ? "Open: " : "Not yet: "}{u.label}.</span> <span className="text-t-phos-dim">{opened.has(u.key) ? u.detail : u.howToEarn}</span></li>))}
          </ul>
          <p className="mt-3 text-sm"><Link href="/dashboard/contribute" className="t-focus text-t-amber-bright underline underline-offset-4">Help keep the directory true</Link></p>
        </section>
      )}

      {on && w.program?.teamBoardOn && (
        <section aria-labelledby="wins-board" className="border border-t-line rounded-[4px] p-4">
          <h2 id="wins-board" className="font-semibold text-t-white">{REWARDS_COPY.boardTitle}</h2>
          {(w.board ?? []).length === 0 ? <p className="text-sm text-t-phos-dim mt-1">{REWARDS_COPY.boardEmpty}</p> : (
            <ul className="mt-2 flex flex-wrap gap-3">{(w.board ?? []).map((b) => <li key={b.userId} className="text-sm border border-t-line rounded-[4px] px-3 py-1">{b.firstName}</li>)}</ul>)}
          <p className="mt-2 text-xs text-t-phos-dim">{REWARDS_COPY.boardHelp}</p>
        </section>
      )}

      {on && w.recap && (
        <section aria-labelledby="wins-recap" className="border border-t-line rounded-[4px] p-4 wins-recap">
          <h2 id="wins-recap" className="font-semibold text-t-white">{REWARDS_COPY.recapTitle}</h2>
          <p className="text-xs text-t-phos-dim">{REWARDS_COPY.recapHelp}</p>
          <h3 className="mt-2 text-sm font-semibold">{w.recap.title}</h3>
          <ul className="mt-1 list-disc pl-5 text-sm space-y-1">{w.recap.lines.map((l, i) => <li key={i}>{l}</li>)}</ul>
          <div className="mt-3 flex gap-3">
            <button type="button" className="t-focus min-h-[44px] px-3 text-sm underline underline-offset-4" onClick={() => copyRecap(w.recap!.text)}>Copy</button>
            <button type="button" className="t-focus min-h-[44px] px-3 text-sm underline underline-offset-4" onClick={() => window.print()}>Print</button>
          </div>
        </section>
      )}

      {on && w.program?.programRewards && (
        <section aria-labelledby="wins-program" className="border border-t-line rounded-[4px] p-4">
          <h2 id="wins-program" className="font-semibold text-t-white">{REWARDS_COPY.programRewardsTitle}</h2>
          <p className="text-sm text-t-phos mt-1">{w.program.programRewards}</p>
        </section>
      )}

      {answered.length > 0 && (
        <details className="text-sm"><summary className="t-focus cursor-pointer text-t-phos-dim">Notes you already answered ({answered.length})</summary>
          <ul className="mt-2 space-y-2">{answered.map((n) => (
            <li key={n.id}>&ldquo;{n.body}&rdquo; <span className="text-t-phos-dim">{n.status === "approved" ? "You said yes." : n.status === "declined" ? "You said no." : "You took it back."}</span>
              {n.status === "approved" && <button type="button" className="t-focus ml-2 min-h-[44px] text-xs underline" onClick={() => answer(n.id, "withdrawn")}>Take it back</button>}
              {n.status === "declined" && <button type="button" className="t-focus ml-2 min-h-[44px] text-xs underline" onClick={() => answer(n.id, "approved")}>Use it after all</button>}
            </li>))}
          </ul>
        </details>
      )}

      {on && <RewardsToggle showWinsLink={false} onChange={() => load()} />}
    </main>
  );
}
