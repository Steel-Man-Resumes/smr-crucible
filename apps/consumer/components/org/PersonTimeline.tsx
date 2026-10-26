"use client";
/**
 * One person's timeline (house lane L5, R14): every record the organization
 * keeps about them, newest first, with chips to narrow it and a link from each
 * line to where it lives. Reads /api/org/clients/[id]/timeline, which reads
 * only the organization's own records (no shared item is opened, so nothing
 * lands in their access log). Pages of 40, "Show older" for more.
 */
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { TIMELINE_CHIPS, type TimelineItem } from "@crucible/core/src/orgWorkflowShared";

const TYPE_LABEL: Record<string, string> = {
  note: "Note", correction: "Correction", task: "Task", ask: "Ask to share", outcome: "Job", retention: "Check-in",
  enrollment: "Program", referral: "Referral", activity: "Change",
};
const when = (s: string) => new Date(s).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
const time = (s: string) => new Date(s).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

export function PersonTimeline({ clientId, first }: { clientId: string; first: string }) {
  const [chips, setChips] = useState<string[]>([]);
  const [items, setItems] = useState<TimelineItem[] | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  const types = chips.length ? TIMELINE_CHIPS.filter((c) => chips.includes(c.key)).flatMap((c) => c.types) : [];
  const typesParam = types.join(",");
  const load = useCallback(async (cursor: string | null) => {
    setFailed(false);
    const qs = new URLSearchParams({ ...(typesParam ? { types: typesParam } : {}), ...(cursor ? { cursor } : {}) });
    try {
      const res = await fetch(`/api/org/clients/${clientId}/timeline?${qs}`);
      if (!res.ok) throw new Error();
      const d = (await res.json()) as { items: TimelineItem[]; next: string | null };
      setItems((prev) => (cursor && prev ? [...prev, ...d.items] : d.items));
      setNext(d.next);
    } catch { setFailed(true); if (!cursor) setItems([]); }
  }, [clientId, typesParam]);
  useEffect(() => { setItems(null); load(null); }, [load]);

  const toggle = (k: string) => setChips((c) => (c.includes(k) ? c.filter((x) => x !== k) : [...c, k]));
  // Group by day so a long history reads like a diary.
  const days: { day: string; rows: TimelineItem[] }[] = [];
  for (const i of items ?? []) {
    const d = when(i.at);
    if (days.length && days[days.length - 1].day === d) days[days.length - 1].rows.push(i);
    else days.push({ day: d, rows: [i] });
  }

  return (
    <section aria-labelledby="timeline-h">
      <h2 id="timeline-h" className="sr-only">Timeline</h2>
      <div role="group" aria-label="Show only" className="mb-4 flex flex-wrap gap-2">
        <button type="button" aria-pressed={chips.length === 0} onClick={() => setChips([])}
          className={`t-focus min-h-touch rounded-[4px] border px-3 text-xs ${chips.length === 0 ? "border-t-amber text-t-white font-semibold" : "border-t-line text-t-phos-dim hover:text-t-white"}`}>Everything</button>
        {TIMELINE_CHIPS.map((c) => (
          <button key={c.key} type="button" aria-pressed={chips.includes(c.key)} onClick={() => toggle(c.key)}
            className={`t-focus min-h-touch rounded-[4px] border px-3 text-xs ${chips.includes(c.key) ? "border-t-amber text-t-white font-semibold" : "border-t-line text-t-phos-dim hover:text-t-white"}`}>{c.label}</button>
        ))}
      </div>
      {failed && (
        <p role="alert" className="mb-3 border border-t-amber bg-t-panel px-4 py-3 text-sm text-t-white">
          The timeline did not load. Nothing was lost. <button type="button" onClick={() => load(null)} className="t-focus underline underline-offset-4">Try again</button>
        </p>
      )}
      {items === null ? <p className="text-sm text-t-phos-dim">Getting the timeline...</p>
        : items.length === 0 && !failed ? (
          <p className="text-sm text-t-phos-dim">{chips.length ? "Nothing of that kind yet." : `Nothing on record for ${first} yet. Notes, tasks, referrals and placements show here as they happen.`}</p>
        ) : (
          <ol className="space-y-5">
            {days.map((d) => (
              <li key={d.day}>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-t-phos-dim">{d.day}</h3>
                <ol className="space-y-2 border-l border-t-line pl-4">
                  {d.rows.map((i) => (
                    <li key={i.key} id={`tl-${i.key.replace(/:/g, "-")}`} className="relative bg-t-panel border border-t-line px-4 py-3 scroll-mt-24">
                      <span aria-hidden="true" className="absolute -left-[1.4rem] top-4 h-2 w-2 rounded-full bg-t-amber" />
                      <p className="text-xs text-t-phos-dim">
                        <span className="font-semibold text-t-amber-bright">{TYPE_LABEL[i.type] ?? "Record"}</span> · {time(i.at)}{i.actorName ? ` · ${i.actorName}` : ""}
                      </p>
                      <p className="mt-1 text-sm text-t-white">{i.title}</p>
                      {i.detail && <p className="mt-1 text-sm text-t-phos whitespace-pre-wrap line-clamp-4">{i.detail}</p>}
                      <Link href={i.href} className="t-focus mt-2 inline-flex min-h-touch items-center text-xs text-t-phos underline underline-offset-4 hover:text-t-white">Open where it lives</Link>
                    </li>
                  ))}
                </ol>
              </li>
            ))}
          </ol>
        )}
      {next && (
        <button type="button" disabled={loadingMore} onClick={async () => { setLoadingMore(true); await load(next); setLoadingMore(false); }}
          className="t-focus mt-5 min-h-touch border border-t-line px-4 text-sm text-t-phos hover:text-t-white disabled:opacity-50">
          {loadingMore ? "Getting more..." : "Show older"}
        </button>
      )}
    </section>
  );
}
