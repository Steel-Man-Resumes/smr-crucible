"use client";

/**
 * <AuditPage> -- who did what in the organization, in plain sentences
 * (house lane L3b, migration 102). For `org.audit.view`.
 *
 * Every row is written by the database when the record changes, so nothing on
 * this page depends on someone remembering to log it. A row never holds what a
 * note, a task or a reason said: only that it happened, by whom, about whom.
 * People are named only as the organization may name them (by progress
 * sharing or the name typed on their invite), and someone outside this
 * viewer's reach never appears here.
 */
import { OUTBOUND_CSV_HELP } from "@crucible/core/src/orgOutboundBrandShared";
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";

interface Row { id: string; at: string; entity: string; action: string; sentence: string; who: string; person: string | null; personId: string | null; staffName: string | null }
interface Choice { id: string; name: string }
interface Choices { team: Choice[]; people: Choice[]; kinds: Choice[] }
interface Filters { participantId: string; staffId: string; entity: string; from: string; to: string }

const EMPTY: Filters = { participantId: "", staffId: "", entity: "", from: "", to: "" };
const field = "t-focus bg-t-panel-2 border border-t-line text-sm text-t-white px-3 py-2 w-full";
const dayLabel = (iso: string) => new Date(iso).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" });
const timeLabel = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

function query(f: Filters, extra: Record<string, string> = {}): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...f, ...extra })) if (v) p.set(k, v);
  const s = p.toString();
  return s ? `?${s}` : "";
}

export function AuditPage() {
  const [filters, setFilters] = useState<Filters>(EMPTY);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [nextBefore, setNextBefore] = useState<string | null>(null);
  const [choices, setChoices] = useState<Choices | null>(null);
  const [canExport, setCanExport] = useState(false);
  const [error, setError] = useState<"forbidden" | "failed" | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  const load = useCallback(async (f: Filters) => {
    setError(null); setRows(null);
    try {
      const r = await fetch(`/api/org/activity${query(f)}`);
      if (r.status === 401 || r.status === 403) { setError("forbidden"); return; }
      if (!r.ok) { setError("failed"); return; }
      const d = await r.json();
      setRows(d.rows); setNextBefore(d.nextBefore); setCanExport(!!d.canExport);
      if (d.choices) setChoices(d.choices);
    } catch { setError("failed"); }
  }, []);
  useEffect(() => { load(filters); }, [load, filters]);

  async function more() {
    if (!nextBefore) return;
    setLoadingMore(true);
    try {
      const r = await fetch(`/api/org/activity${query(filters, { before: nextBefore })}`);
      if (r.ok) { const d = await r.json(); setRows((prev) => [...(prev ?? []), ...d.rows]); setNextBefore(d.nextBefore); }
    } finally { setLoadingMore(false); }
  }

  const days = useMemo(() => {
    const out: { day: string; rows: Row[] }[] = [];
    for (const r of rows ?? []) {
      const d = dayLabel(r.at);
      if (out.length && out[out.length - 1].day === d) out[out.length - 1].rows.push(r); else out.push({ day: d, rows: [r] });
    }
    return out;
  }, [rows]);
  const filtered = Object.values(filters).some(Boolean);
  const set = (k: keyof Filters) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setFilters((f) => ({ ...f, [k]: e.target.value }));

  if (error === "forbidden") return (
    <div className="max-w-4xl mx-auto px-4 py-10">
      <p role="alert" className="text-sm text-t-white border border-t-line bg-t-panel px-4 py-3">
        The activity log is for the people who answer for your organization. Ask your owner for access.
      </p>
    </div>
  );

  return (
    <div className="max-w-4xl mx-auto px-4 py-10">
      <h1 className="text-2xl font-bold text-t-white mb-1">Activity log</h1>
      <p className="text-sm text-t-phos-dim mb-6 max-w-2xl">
        Who did what, and when. The system writes each line the moment a record changes, and nobody can edit or remove one.
        It says that a note was written or a check-in corrected, never what the note or the reason said.
      </p>

      <form onSubmit={(e) => e.preventDefault()} className="bg-t-panel border border-t-line p-4 mb-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3" aria-label="Filter the activity log">
        <div>
          <label htmlFor="al-person" className="block text-xs text-t-phos-dim mb-1">Person</label>
          <select id="al-person" className={field} value={filters.participantId} onChange={set("participantId")}>
            <option value="">Everyone</option>
            {choices?.people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="al-staff" className="block text-xs text-t-phos-dim mb-1">Team member</label>
          <select id="al-staff" className={field} value={filters.staffId} onChange={set("staffId")}>
            <option value="">Anyone</option>
            {choices?.team.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="al-kind" className="block text-xs text-t-phos-dim mb-1">Kind</label>
          <select id="al-kind" className={field} value={filters.entity} onChange={set("entity")}>
            <option value="">All kinds</option>
            {choices?.kinds.map((k) => <option key={k.id} value={k.id}>{k.name}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="al-from" className="block text-xs text-t-phos-dim mb-1">From</label>
          <input id="al-from" type="date" className={field} value={filters.from} onChange={set("from")} />
        </div>
        <div>
          <label htmlFor="al-to" className="block text-xs text-t-phos-dim mb-1">To</label>
          <input id="al-to" type="date" className={field} value={filters.to} onChange={set("to")} />
        </div>
        <div className="sm:col-span-2 lg:col-span-5 flex flex-wrap items-center gap-3">
          {filtered && <button type="button" onClick={() => setFilters(EMPTY)} className="t-focus text-xs text-t-phos underline underline-offset-4 hover:text-t-white">Clear filters</button>}
          {canExport && (
            <>
              <a href={`/api/org/activity${query(filters, { format: "csv" })}`} title={OUTBOUND_CSV_HELP} aria-describedby="audit-csv-help" className="t-focus text-xs border border-t-line text-t-phos px-3 py-1.5 hover:text-t-white">
                Download as a spreadsheet (CSV)
              </a>
              <span id="audit-csv-help" className="text-[11px] text-t-phos-dim">{OUTBOUND_CSV_HELP}</span>
            </>
          )}
          {canExport && <span className="text-xs text-t-phos-dim">Downloads are recorded too.</span>}
        </div>
      </form>

      {error === "failed" && (
        <div role="alert" className="text-sm text-t-white border border-t-amber bg-t-panel px-4 py-3 mb-4">
          The log did not load. Nothing was lost.
          <button type="button" onClick={() => load(filters)} className="t-focus ml-3 font-semibold text-t-amber-bright underline underline-offset-4">Try again</button>
        </div>
      )}
      {!rows && !error && (
        <div aria-busy="true" aria-label="Loading" className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-12 bg-t-panel border border-t-line rounded-[4px] animate-pulse" />)}
        </div>
      )}
      {rows && rows.length === 0 && (
        <p className="text-sm text-t-phos-dim bg-t-panel border border-t-line px-5 py-8 text-center">
          {filtered ? "Nothing matches these filters." : "Nothing yet. Notes, tasks, placements, check-ins, caseload changes, sharing and team changes appear here as they happen."}
        </p>
      )}
      {days.map((d) => (
        <section key={d.day} className="mb-6">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-t-amber-bright mb-2 pb-2 border-b border-t-line">{d.day}</h2>
          <ul className="space-y-1">
            {d.rows.map((r) => (
              <li key={r.id} className="flex gap-3 items-baseline text-sm py-1.5">
                <time dateTime={r.at} className="text-xs text-t-phos-dim w-16 shrink-0 tabular-nums">{timeLabel(r.at)}</time>
                <span className="text-t-white min-w-0 break-words">
                  {r.sentence}
                  {r.personId && (
                    <> <Link href={`/dashboard/clients/${r.personId}`} className="t-focus text-xs text-t-phos underline decoration-t-line underline-offset-4 hover:decoration-t-amber whitespace-nowrap">Open their page</Link></>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ))}
      {nextBefore && (
        <button type="button" onClick={more} disabled={loadingMore} className="t-focus text-sm border border-t-line text-t-phos px-4 py-2 disabled:opacity-50">
          {loadingMore ? "Loading..." : "Show older"}
        </button>
      )}
    </div>
  );
}
