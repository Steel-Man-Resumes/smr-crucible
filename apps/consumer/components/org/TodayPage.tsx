"use client";

/**
 * <TodayPage> -- who needs me, why, and the one thing to do about it.
 *
 * Grouped by REASON, because "what kind of day is this" is the first thing a
 * case manager wants to know. Every line is a sentence already written, with
 * one action. Sections can be hidden (Settings -> My workflow); a section with
 * nothing in it does not render. An empty Today says so plainly rather than
 * looking broken.
 *
 * What is NOT here is as deliberate as what is: someone who shares nothing
 * appears for nothing derived from their work. The page says that once, at the
 * bottom, so an empty section is never mistaken for "nothing is happening".
 */
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

interface Item { key: string; section: string; clientId: string | null; clientName: string | null; reason: string; when: string | null; action: { label: string; href: string }; taskId?: string }
interface Payload { items: Item[]; sections: { key: string; label: string }[]; hidden: string[]; canAddTasks: boolean }

export function TodayPage() {
  const [d, setD] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState(""); const [due, setDue] = useState("");
  const load = useCallback(async () => {
    const res = await fetch("/api/org/today");
    if (!res.ok) { setError("Could not load your day."); return; }
    setD(await res.json());
  }, []);
  useEffect(() => { load(); }, [load]);

  async function task(body: Record<string, unknown>) {
    await fetch("/api/org/tasks", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    load();
  }

  if (error) return <div className="max-w-4xl mx-auto px-4 py-10"><p role="alert" className="text-sm text-t-amber-bright border border-t-amber bg-t-panel px-4 py-3">{error}</p></div>;
  if (!d) return <div className="max-w-4xl mx-auto px-4 py-10 text-sm text-t-phos-dim">Loading...</div>;
  const shown = d.sections.filter((s) => !d.hidden.includes(s.key));
  const total = d.items.filter((i) => !d.hidden.includes(i.section)).length;

  return (
    <div className="max-w-4xl mx-auto px-4 py-10">
      <h1 className="text-2xl font-bold text-t-white mb-1">Today</h1>
      <p className="text-sm text-t-phos-dim mb-6">
        {total === 0 ? "Nothing is waiting on you right now." : `${total} ${total === 1 ? "thing" : "things"} worth your attention, grouped by why.`}
      </p>

      {d.canAddTasks && (
        <form onSubmit={(e) => { e.preventDefault(); if (title.trim().length < 2) return; task({ action: "add", title, dueOn: due || null }); setTitle(""); setDue(""); }}
          className="flex flex-wrap gap-2 mb-8">
          <label className="sr-only" htmlFor="today-task">Add a task for yourself</label>
          <input id="today-task" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Add a task for yourself" maxLength={300}
            className="t-focus flex-1 min-w-[14rem] bg-t-panel border border-t-line text-sm text-t-white px-3 py-2" />
          <label className="sr-only" htmlFor="today-due">Due date</label>
          <input id="today-due" type="date" value={due} onChange={(e) => setDue(e.target.value)} className="t-focus bg-t-panel border border-t-line text-sm text-t-phos px-3 py-2" />
          <button className="t-focus bg-t-amber text-[#14100a] text-sm font-semibold px-4 py-2 disabled:opacity-50" disabled={title.trim().length < 2}>Add</button>
        </form>
      )}

      {shown.map((s) => {
        const items = d.items.filter((i) => i.section === s.key);
        if (items.length === 0) return null;
        return (
          <section key={s.key} className="mb-7">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-t-amber-bright mb-2 pb-2 border-b border-t-line">{s.label} · {items.length}</h2>
            <ul className="space-y-2">
              {items.map((i) => (
                <li key={i.key} className="bg-t-panel border border-t-line px-4 py-3 flex flex-wrap items-center justify-between gap-3">
                  <p className="text-sm text-t-white flex-1 min-w-[14rem]">{i.reason}</p>
                  <div className="flex items-center gap-4">
                    {i.taskId && <button onClick={() => task({ action: "done", taskId: i.taskId })} className="t-focus text-xs text-t-phos underline underline-offset-4 hover:text-t-white">Mark done</button>}
                    {i.action.href !== "#" && (
                      <Link href={i.action.href} className="t-focus text-xs font-semibold text-t-amber-bright underline underline-offset-4 hover:text-t-amber whitespace-nowrap">{i.action.label}</Link>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        );
      })}

      <p className="text-xs text-t-phos-dim mt-8 max-w-2xl">
        Interviews and follow-up dates appear here only for people who chose to share their applications, and they can see that those dates showed up on your list. Someone who shares nothing will not appear for any of that, which is their choice, not a sign that nothing is happening. Choose which sections you see in Settings, under My workflow.
      </p>
    </div>
  );
}
