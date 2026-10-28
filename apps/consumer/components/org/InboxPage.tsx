"use client";
/**
 * The staff Inbox (staff side lane S4, migration 109): /dashboard/inbox.
 *
 * Everything that needs this person: mentions, replies, tasks a teammate gave
 * them, change requests (for the owner and admins) and answers to their own,
 * and notes to review. Each line opens where the thing lives (which checks
 * reach again). Only ever their own items. In-app only: nothing is emailed
 * or texted from here.
 *
 * ?view=team shows the Team board (comments about nobody in particular).
 */
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { TeamCommentsPanel } from "@/components/org/TeamComments";
import { NoteReviewQueue } from "@/components/org/NoteReview";
import { announceInboxCount } from "@/components/org/InboxCount";

interface Item { id: string; kind: string; sentence: string; href: string; created_at: string; read_at: string | null }
interface Payload { items: Item[]; unread: number; next: string | null; filters: { key: string; label: string }[]; canMark: boolean }

const when = (s: string) => {
  const d = new Date(s);
  const today = new Date().toDateString() === d.toDateString();
  return today ? d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }) : d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
};

async function mark(body: Record<string, unknown>): Promise<number | null> {
  try {
    const res = await fetch("/api/org/inbox", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    if (!res.ok) return null;
    const d = await res.json();
    return typeof d.unread === "number" ? d.unread : null;
  } catch { return null; }
}

export function InboxPage({ startView }: { startView?: "inbox" | "team" }) {
  const [view, setView] = useState<"inbox" | "team">(startView ?? "inbox");
  const [filter, setFilter] = useState("all");
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [data, setData] = useState<Payload | null>(null);
  const [failed, setFailed] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  const load = useCallback(async (before: string | null = null) => {
    setFailed(false);
    const qs = new URLSearchParams({ filter, ...(unreadOnly ? { unread: "1" } : {}), ...(before ? { before } : {}) });
    try {
      const res = await fetch(`/api/org/inbox?${qs}`);
      if (!res.ok) throw new Error();
      const d = (await res.json()) as Payload;
      setData((prev) => (before && prev ? { ...d, items: [...prev.items, ...d.items] } : d));
      announceInboxCount(d.unread);
    } catch { setFailed(true); }
  }, [filter, unreadOnly]);
  useEffect(() => { if (view === "inbox") load(); }, [load, view]);

  async function setRead(item: Item, read: boolean) {
    const unread = await mark({ action: read ? "read" : "unread", ids: [item.id] });
    if (unread === null) return;
    announceInboxCount(unread);
    setData((d) => d && { ...d, unread, items: d.items.map((i) => (i.id === item.id ? { ...i, read_at: read ? new Date().toISOString() : null } : i)) });
  }
  async function readAll() {
    const unread = await mark({ action: "read_all" });
    if (unread === null) return;
    announceInboxCount(unread);
    load();
  }

  const tab = (on: boolean) => `t-focus min-h-touch border-b-2 -mb-px px-4 text-sm ${on ? "border-t-amber text-t-white font-semibold" : "border-transparent text-t-phos-dim hover:text-t-white"}`;
  const chip = (on: boolean) => `t-focus min-h-touch rounded-[4px] border px-3 text-xs ${on ? "border-t-amber text-t-white font-semibold" : "border-t-line text-t-phos-dim hover:text-t-white"}`;

  return (
    <div className="mx-auto max-w-4xl px-4 py-6">
      <h1 className="text-xl font-semibold text-t-white">Inbox</h1>
      <p className="mt-1 mb-4 text-sm text-t-phos-dim">When a teammate mentions you, gives you a task, or answers a request, it shows up here. Only you see your Inbox.</p>
      <div role="tablist" aria-label="Inbox sections" className="mb-5 flex gap-1 border-b border-t-line">
        <button role="tab" aria-selected={view === "inbox"} onClick={() => setView("inbox")} className={tab(view === "inbox")}>
          For you{data && data.unread > 0 ? ` (${data.unread})` : ""}
        </button>
        <button role="tab" aria-selected={view === "team"} onClick={() => setView("team")} className={tab(view === "team")}>Team board</button>
        <Link href="/dashboard/change-requests" className="t-focus min-h-touch flex items-center px-4 text-sm text-t-phos-dim hover:text-t-white">Change requests</Link>
      </div>

      {view === "team" ? <TeamCommentsPanel clientId={null} /> : (
        <>
          <NoteReviewQueue />
          <div className="mb-3 flex flex-wrap items-center gap-2" role="group" aria-label="Show">
            {(data?.filters ?? [{ key: "all", label: "Everything" }]).map((f) => (
              <button key={f.key} type="button" aria-pressed={filter === f.key} onClick={() => setFilter(f.key)} className={chip(filter === f.key)}>{f.label}</button>
            ))}
            <label className="ml-2 flex min-h-touch items-center gap-2 text-xs text-t-phos-dim">
              <input type="checkbox" className="t-focus" checked={unreadOnly} onChange={(e) => setUnreadOnly(e.target.checked)} /> Only unread
            </label>
            {data?.canMark && data.unread > 0 && (
              <button type="button" onClick={readAll} className="t-focus ml-auto text-xs text-t-phos underline underline-offset-4 hover:text-t-white">Mark everything read</button>
            )}
          </div>
          {failed ? <p role="alert" className="text-sm text-t-white">Your Inbox did not load. <button type="button" onClick={() => load()} className="t-focus underline">Try again</button></p>
            : !data ? <p className="text-sm text-t-phos-dim">Getting your Inbox...</p>
            : data.items.length === 0 ? <p className="text-sm text-t-phos-dim">{unreadOnly ? "Nothing unread. You are caught up." : "Nothing here yet. When a teammate mentions you or gives you a task, it lands here."}</p>
            : (
              <ul className="divide-y divide-t-line border border-t-line bg-t-panel">
                {data.items.map((i) => (
                  <li key={i.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                    <span aria-hidden className={`h-2 w-2 shrink-0 rounded-full ${i.read_at ? "bg-transparent" : "bg-t-amber"}`} />
                    <Link href={i.href} onClick={() => { if (!i.read_at && data.canMark) setRead(i, true); }}
                      className={`t-focus min-w-0 flex-1 text-sm hover:underline ${i.read_at ? "text-t-phos" : "font-semibold text-t-white"}`}>
                      <span className="sr-only">{i.read_at ? "" : "Unread: "}</span>{i.sentence}
                    </Link>
                    <span className="text-xs text-t-phos-dim">{when(i.created_at)}</span>
                    {data.canMark && (
                      <button type="button" onClick={() => setRead(i, !i.read_at)} className="t-focus text-xs text-t-phos-dim underline underline-offset-4 hover:text-t-white">
                        {i.read_at ? "Mark unread" : "Mark read"}
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          {data?.next && (
            <button type="button" disabled={loadingMore} onClick={async () => { setLoadingMore(true); await load(data.next); setLoadingMore(false); }}
              className="t-focus mt-4 text-sm text-t-phos underline underline-offset-4 hover:text-t-white">{loadingMore ? "Getting more..." : "Show older"}</button>
          )}
        </>
      )}
    </div>
  );
}
