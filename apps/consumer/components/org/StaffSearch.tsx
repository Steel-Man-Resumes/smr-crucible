"use client";
/**
 * Find a person (house lane L5, R12): name, another name they go by, email,
 * phone or a program id, any case, small typos forgiven. Only people the
 * staff member works with come back, and only by what staff may already see
 * of them. `compact` is the header box (the boss mounts it in the shell);
 * the full page lives at /dashboard/search.
 */
import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { useOrgTerms } from "@/lib/use-org-terms";

interface Hit { user_id: string; name: string | null; email: string | null; phone: string | null; matched_on: string; mine: boolean }
const MATCHED: Record<string, string> = { name: "name", other_name: "another name", email: "email", phone: "phone", program_id: "program id" };

export function StaffSearch({ compact = false, autoFocus = false }: { compact?: boolean; autoFocus?: boolean }) {
  const [q, setQ] = useState("");
  const [scope, setScope] = useState<"all" | "mine">("all");
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [seesAll, setSeesAll] = useState(true);
  const seq = useRef(0);
  const words = useOrgTerms();
  const id = useId();

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) { setHits(null); return; }
    const mineSeq = ++seq.current;
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/org/search?${new URLSearchParams({ q: term, scope })}`);
        if (!res.ok) throw new Error();
        const d = await res.json();
        if (mineSeq !== seq.current) return; // an older answer arriving late
        setHits(d.hits ?? []); setSeesAll(!!d.seesAll); setFailed(false);
      } catch { if (mineSeq === seq.current) setFailed(true); }
    }, 200);
    return () => clearTimeout(t);
  }, [q, scope]);

  return (
    <div className={compact ? "relative" : ""} role="search">
      <label htmlFor={`${id}-q`} className={compact ? "sr-only" : "block text-sm font-semibold text-t-white mb-2"}>Find a person</label>
      <input id={`${id}-q`} type="search" value={q} onChange={(e) => setQ(e.target.value)} autoFocus={autoFocus} autoComplete="off"
        placeholder="Name, email, phone or program id"
        aria-controls={`${id}-results`}
        className="plain-field t-focus w-full rounded-[4px] border border-t-line bg-t-panel-2 px-3 py-2 text-sm text-t-white" />
      {!compact && seesAll && (
        <div role="group" aria-label="Search in" className="mt-2 flex gap-2 text-xs">
          {(["all", "mine"] as const).map((s) => (
            <button key={s} type="button" aria-pressed={scope === s} onClick={() => setScope(s)}
              className={`t-focus min-h-touch rounded-[4px] border px-3 ${scope === s ? "border-t-amber text-t-white font-semibold" : "border-t-line text-t-phos-dim"}`}>
              {s === "all" ? "Everyone I can see" : `My ${words.caseload}`}
            </button>
          ))}
        </div>
      )}
      <div id={`${id}-results`} aria-live="polite" className={compact && hits ? "absolute z-30 mt-1 w-full max-h-96 overflow-y-auto border border-t-line bg-t-panel shadow-lg" : "mt-3"}>
        {failed && <p role="alert" className="px-3 py-2 text-xs text-t-amber-bright">Search did not answer. Try again in a moment.</p>}
        {hits && hits.length === 0 && !failed && (
          <p className="px-3 py-2 text-sm text-t-phos-dim">Nobody you work with matches &ldquo;{q.trim()}&rdquo;. Search covers names, other names, email, phone and program ids you can already see.</p>
        )}
        {hits && hits.length > 0 && (
          <ul className={compact ? "" : "space-y-2"}>
            {hits.map((h) => (
              <li key={h.user_id}>
                <Link href={`/dashboard/clients/${h.user_id}`}
                  className={`t-focus flex min-h-touch flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm hover:bg-t-panel-2 ${compact ? "" : "border border-t-line bg-t-panel"}`}>
                  <span className="text-t-white">{h.name || "Name not shared"}{h.mine ? <span className="ml-2 text-xs text-t-amber-bright">yours</span> : null}</span>
                  <span className="text-xs text-t-phos-dim">{[h.email, h.phone].filter(Boolean).join(" · ")}{` · matched on ${MATCHED[h.matched_on] ?? "name"}`}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
