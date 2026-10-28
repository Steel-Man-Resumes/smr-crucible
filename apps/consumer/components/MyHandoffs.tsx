"use client";
/**
 * What a case manager sent the person (staff pass S5, migration 110).
 *
 * <MyHandoffsCard>: on their dashboard, only while something is waiting.
 * <MyHandoffsPage>: /dashboard/from-your-case-manager, everything from the
 * last 30 days plus their shared list.
 *
 * Each thing has its own answer. Taking it saves it to THEIR OWN places
 * first, through the same routes as anything they find themselves:
 *   an employer or a job  -> /api/applications (their saved jobs)
 *   a place for help      -> /api/resource-lists (their saved help)
 *   a next step           -> their list from their case manager (server side)
 * and only then records the answer. Passing needs no reason, and nobody is
 * told one. Their case manager sees only taken or passed.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { HANDOFF_PROMISE, PASS_WORDS, TAKE_WORDS, TAKEN_WORDS, type HandoffItemKind } from "@crucible/core/src/staffHandoffShared";
import { bandLine, dayWords } from "@/lib/handoff-words";
import { MySharedTasks } from "@/components/MySharedTasks";

interface Item {
  id: string; kind: HandoffItemKind; status: "open" | "saved" | "dismissed"; title: string; why: string;
  job_title: string | null; company: string | null; location: string | null; apply_url: string | null; due_on: string | null;
  resource_ref: string | null;
  listing?: { stillListed: boolean; band: string | null; checkedAt: string | null; checkFailed?: boolean } | null;
}
interface Handoff { id: string; note: string; status: "sent" | "seen"; created_at: string; from_name: string | null; org_name: string | null; items: Item[] }

const post = (url: string, body: unknown) => fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

/**
 * Save first, then answer. Exported (with the fetch injectable) so the order
 * is tested: an answer is never recorded for something that did not save.
 */
export async function takeItem(it: Item, f: (url: string, body: unknown) => Promise<Response> = post): Promise<{ ok: true } | { ok: false; error: string }> {
  if (it.kind === "employer" || it.kind === "job") {
    const r = await f("/api/applications", { job_title: it.job_title, company: it.company, location: it.location, apply_url: it.apply_url, source: "staff_handoff", status: "saved" });
    if (!r.ok) return { ok: false, error: "That did not save to your jobs. Try again." };
  } else if (it.kind === "resource") {
    if (it.listing && !it.listing.stillListed) return { ok: false, error: "That place is no longer listed, so it cannot be saved. Ask your case manager about it." };
    const r = await f("/api/resource-lists", { serviceIds: [it.resource_ref] });
    if (!r.ok) { const d = await r.json().catch(() => ({})); return { ok: false, error: d.error || "That did not save to your help list. Try again." }; }
  }
  const a = await f("/api/handoffs", { action: "answer", itemId: it.id, answer: "take" });
  if (!a.ok) { const d = await a.json().catch(() => ({})); return { ok: false, error: d.error || "That did not save. Try again." }; }
  return { ok: true };
}

function useHandoffs() {
  const [handoffs, setHandoffs] = useState<Handoff[] | null>(null);
  const load = useCallback(() => {
    fetch("/api/handoffs", { cache: "no-store" }).then((r) => (r.ok ? r.json() : { handoffs: [] })).then((d) => setHandoffs(d.handoffs ?? [])).catch(() => setHandoffs([]));
  }, []);
  useEffect(() => { load(); }, [load]);
  return { handoffs, reload: load };
}

function HandoffBlock({ h, onChange }: { h: Handoff; onChange: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [said, setSaid] = useState<Record<string, string>>({});
  // "Opened" is a deliberate open (review r1 #4): pressing Open, or answering an item. Never merely showing up on the dashboard.
  const [open, setOpen] = useState(h.status !== "sent");
  const marked = useRef(false);
  function openIt() {
    setOpen(true);
    if (h.status === "sent" && !marked.current) { marked.current = true; post("/api/handoffs", { action: "seen", handoffId: h.id }).catch(() => {}); }
  }
  async function answer(it: Item, take: boolean) {
    setBusy(it.id);
    const res = take ? await takeItem(it).catch(() => ({ ok: false as const, error: "That did not save. Check the connection and try again." }))
      : await post("/api/handoffs", { action: "answer", itemId: it.id, answer: "pass" }).then((r) => (r.ok ? { ok: true as const } : { ok: false as const, error: "That did not save. Try again." }));
    setSaid((s) => ({ ...s, [it.id]: res.ok ? (take ? TAKEN_WORDS[it.kind] : "Passed.") : res.error }));
    setBusy(null);
    if (res.ok) onChange();
  }
  return (
    <article className="border-l-2 border-t-amber pl-3">
      <p className="text-xs text-t-phos-dim">{h.from_name || "Your case manager"}{h.org_name ? `, ${h.org_name}` : ""}, {dayWords(h.created_at)}</p>
      {!open ? (
        <button type="button" onClick={openIt} className="t-focus mt-2 border border-t-line text-sm text-t-phos px-3 py-1.5">
          Open it ({h.items.length} {h.items.length === 1 ? "thing" : "things"})
        </button>
      ) : (<>
      <p className="text-sm text-t-white mt-1 whitespace-pre-line">{h.note}</p>
      <ul className="mt-3 space-y-3">
        {h.items.map((it) => (
          <li key={it.id} className="bg-t-panel-2 border border-t-line p-3">
            <p className="text-sm text-t-white">{it.title}{it.kind !== "next_step" && it.location ? `, ${it.location}` : ""}</p>
            {(it.kind === "employer" || it.kind === "resource") && it.listing && (
              <p className="text-xs text-t-phos-dim mt-0.5">
                {it.listing.checkFailed ? "We could not check this listing just now." : !it.listing.stillListed ? "No longer listed." : `${bandLine(it.kind, it.listing.band)}${it.listing.checkedAt ? `, checked ${dayWords(it.listing.checkedAt)}` : ""}.`}
              </p>
            )}
            {it.kind === "next_step" && it.due_on && <p className="text-xs text-t-phos-dim mt-0.5">By {dayWords(it.due_on)}</p>}
            <p className="text-sm text-t-phos mt-1">{it.why}</p>
            {it.status === "open" ? (
              <div className="flex flex-wrap gap-3 mt-2">
                <button type="button" disabled={busy === it.id} onClick={() => answer(it, true)} className="t-focus bg-t-amber text-[#14100a] text-xs font-semibold px-3 py-1.5 disabled:opacity-50">{TAKE_WORDS[it.kind]}</button>
                {it.apply_url && <a href={it.apply_url} target="_blank" rel="noopener noreferrer" className="t-focus text-xs text-t-amber-bright underline underline-offset-4 self-center">See where to apply</a>}
                <button type="button" disabled={busy === it.id} onClick={() => answer(it, false)} className="t-focus text-xs text-t-phos-dim underline underline-offset-4 disabled:opacity-50">{PASS_WORDS}</button>
              </div>
            ) : (
              <p className="text-xs font-semibold text-t-amber-bright mt-2">{it.status === "saved" ? TAKEN_WORDS[it.kind] : "You passed on this one."}</p>
            )}
            {said[it.id] && <p role="status" className="text-xs text-t-phos mt-1">{said[it.id]}</p>}
          </li>
        ))}
      </ul>
      </>)}
    </article>
  );
}

/** The dashboard card: renders nothing unless something is waiting for an answer. */
export function MyHandoffsCard() {
  const { handoffs, reload } = useHandoffs();
  const open = (handoffs ?? []).filter((h) => h.items.some((i) => i.status === "open"));
  if (open.length === 0) return null;
  return (
    <section aria-labelledby="my-handoffs" className="bg-t-panel border border-t-line p-5">
      <h2 id="my-handoffs" className="font-semibold text-t-white">Your case manager found something for you</h2>
      <p className="text-xs text-t-phos-dim mt-1 mb-3">{HANDOFF_PROMISE}</p>
      <div className="space-y-5">{open.slice(0, 2).map((h) => <HandoffBlock key={h.id} h={h} onChange={reload} />)}</div>
      <Link href="/dashboard/from-your-case-manager" className="t-focus inline-block mt-4 text-xs text-t-amber-bright underline underline-offset-4">See everything from your case manager</Link>
    </section>
  );
}

export function MyHandoffsPage() {
  const { handoffs, reload } = useHandoffs();
  return (
    <div className="max-w-3xl px-4 py-8 space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-t-white">From your case manager</h1>
        <p className="text-sm text-t-phos-dim mt-2">{HANDOFF_PROMISE}</p>
      </header>
      <MySharedTasks />
      {handoffs === null ? <p className="text-sm text-t-phos-dim">Loading...</p>
        : handoffs.length === 0 ? <p className="text-sm text-t-phos-dim">Nothing new from your case manager in the last 30 days.</p>
        : <div className="space-y-6">{handoffs.map((h) => <HandoffBlock key={h.id} h={h} onChange={reload} />)}</div>}
    </div>
  );
}
