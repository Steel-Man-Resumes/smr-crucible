"use client";

/**
 * <OutcomesPanel> -- what happened after hire, for one participant.
 *
 * The first question on the form is HOW YOU KNOW, not the wage, because that is
 * the part a funder report depends on and the part that gets skipped. "They
 * told me" is a perfectly good answer; it just must not be reported as
 * confirmed. Wage and hours are optional. A check-in that could not reach the
 * person is recorded as exactly that.
 */
import { useCallback, useEffect, useState } from "react";

interface Check { day_mark: number; status: string; method: string; checked_at: string }
interface Outcome {
  id: string; employer: string; job_title: string | null; start_date: string; hourly_wage: string | null; hours_per_week: string | null;
  source: string; verification_method: string | null; verified_by_name: string | null; ended_on: string | null; end_reason: string | null;
  created_by_name: string | null; checks: Check[]; due_marks: number[];
}
interface Opt { value: string; label: string }
const day = (s: string) => new Date(s + "T12:00:00Z").toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
const STATUS: Record<string, string> = { employed: "Still there", not_employed: "No longer there", unknown: "Could not reach them" };
const input = "t-focus bg-t-panel-2 border border-t-line text-sm text-t-white px-3 py-2 w-full";

export function OutcomesPanel({ clientId, first }: { clientId: string; first: string }) {
  const [rows, setRows] = useState<Outcome[] | null>(null);
  const [opts, setOpts] = useState<{ sources: Opt[]; methods: Opt[]; endReasons: Opt[] } | null>(null);
  const [canWrite, setCanWrite] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [f, setF] = useState({ employer: "", jobTitle: "", startDate: "", hourlyWage: "", hoursPerWeek: "", source: "participant_reported", verificationMethod: "" });

  const load = useCallback(async () => {
    const d = await fetch(`/api/org/outcomes?clientId=${clientId}`).then((r) => (r.ok ? r.json() : null));
    if (d) { setRows(d.outcomes); setOpts(d.options); setCanWrite(d.canWrite); }
  }, [clientId]);
  useEffect(() => { load(); }, [load]);

  async function post(body: Record<string, unknown>) {
    setMsg(null);
    const res = await fetch("/api/org/outcomes", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    if (!res.ok) { setMsg((await res.json().catch(() => ({}))).error || "That did not save."); return false; }
    await load(); return true;
  }

  if (!rows || !opts) return <p className="text-sm text-t-phos-dim">Loading...</p>;
  return (
    <section>
      {msg && <p role="alert" className="text-xs text-t-amber-bright border border-t-amber bg-t-panel px-4 py-3 mb-4">{msg}</p>}
      {rows.length === 0 && <p className="text-sm text-t-phos-dim mb-5">No placement on record for {first} yet. {first} marking a job as hired in their own tracker is theirs; this is your organization&apos;s record, and {first} can see it.</p>}

      <ul className="space-y-4 mb-6">
        {rows.map((o) => (
          <li key={o.id} className="bg-t-panel border border-t-line p-5">
            <p className="font-semibold text-t-white">{o.job_title ? `${o.job_title}, ` : ""}{o.employer}</p>
            <p className="text-xs text-t-phos-dim mb-3">
              Started {day(o.start_date)}{o.hourly_wage ? ` · $${Number(o.hourly_wage).toFixed(2)} an hour` : ""}{o.hours_per_week ? ` · ${Number(o.hours_per_week)} hours a week` : ""}
              {" · "}{opts.sources.find((s) => s.value === o.source)?.label}{o.verification_method ? `: ${opts.methods.find((m) => m.value === o.verification_method)?.label?.toLowerCase()}${o.verified_by_name ? ` (${o.verified_by_name})` : ""}` : ""}
              {o.ended_on ? ` · ended ${day(o.ended_on)}: ${opts.endReasons.find((r) => r.value === o.end_reason)?.label?.toLowerCase()}` : ""}
            </p>
            <ul className="flex flex-wrap gap-2 mb-3">
              {[30, 60, 90, 180].map((m) => {
                const k = o.checks.find((c) => c.day_mark === m);
                return <li key={m} className={`text-xs px-2 py-1 border ${k ? (k.status === "employed" ? "border-t-amber text-t-amber-bright" : "border-t-line text-t-phos") : o.due_marks.includes(m) ? "border-t-amber text-t-white" : "border-t-line text-t-phos-dim"}`}>
                  {m} days: {k ? STATUS[k.status] : o.due_marks.includes(m) ? "due now" : "not yet"}
                </li>;
              })}
            </ul>
            {canWrite && o.due_marks.length > 0 && <CheckIn mark={o.due_marks[0]} first={first} onSave={(status, method) => post({ action: "check", outcomeId: o.id, dayMark: o.due_marks[0], status, method })} />}
            {canWrite && !o.ended_on && <EndIt reasons={opts.endReasons} onEnd={(endedOn, reason) => post({ action: "end", outcomeId: o.id, endedOn, reason })} />}
          </li>
        ))}
      </ul>

      {canWrite && (
        <form onSubmit={async (e) => { e.preventDefault(); if (await post({ action: "record", clientId, ...f })) setF({ employer: "", jobTitle: "", startDate: "", hourlyWage: "", hoursPerWeek: "", source: "participant_reported", verificationMethod: "" }); }}
          className="bg-t-panel border border-t-line p-5">
          <h3 className="font-semibold text-t-white mb-3">Record a placement</h3>
          <div className="grid sm:grid-cols-2 gap-3">
            <div className="sm:col-span-2">
              <label htmlFor="oc-source" className="block text-xs text-t-phos-dim mb-1">How do you know?</label>
              <select id="oc-source" className={input} value={f.source} onChange={(e) => setF({ ...f, source: e.target.value, verificationMethod: "" })}>
                {opts.sources.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
            </div>
            {f.source === "staff_verified" && (
              <div className="sm:col-span-2">
                <label htmlFor="oc-method" className="block text-xs text-t-phos-dim mb-1">Confirmed how?</label>
                <select id="oc-method" className={input} value={f.verificationMethod} onChange={(e) => setF({ ...f, verificationMethod: e.target.value })} required>
                  <option value="">Choose one</option>
                  {opts.methods.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
                </select>
              </div>
            )}
            <div><label htmlFor="oc-emp" className="block text-xs text-t-phos-dim mb-1">Employer</label><input id="oc-emp" className={input} value={f.employer} onChange={(e) => setF({ ...f, employer: e.target.value })} required /></div>
            <div><label htmlFor="oc-title" className="block text-xs text-t-phos-dim mb-1">Job title (optional)</label><input id="oc-title" className={input} value={f.jobTitle} onChange={(e) => setF({ ...f, jobTitle: e.target.value })} /></div>
            <div><label htmlFor="oc-start" className="block text-xs text-t-phos-dim mb-1">First day</label><input id="oc-start" type="date" className={input} value={f.startDate} onChange={(e) => setF({ ...f, startDate: e.target.value })} required /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><label htmlFor="oc-wage" className="block text-xs text-t-phos-dim mb-1">Hourly wage (optional)</label><input id="oc-wage" inputMode="decimal" className={input} value={f.hourlyWage} onChange={(e) => setF({ ...f, hourlyWage: e.target.value })} /></div>
              <div><label htmlFor="oc-hours" className="block text-xs text-t-phos-dim mb-1">Hours a week (optional)</label><input id="oc-hours" inputMode="decimal" className={input} value={f.hoursPerWeek} onChange={(e) => setF({ ...f, hoursPerWeek: e.target.value })} /></div>
            </div>
          </div>
          <button className="t-focus bg-t-amber text-[#14100a] text-sm font-semibold px-4 py-2 mt-4">Save placement</button>
          <p className="text-xs text-t-phos-dim mt-3">{first} can see that this is on file. It cannot be deleted; a mistake is ended as &ldquo;entered by mistake&rdquo;, which keeps it out of every count.</p>
        </form>
      )}
    </section>
  );
}

function CheckIn({ mark, first, onSave }: { mark: number; first: string; onSave: (status: string, method: string) => void }) {
  const [method, setMethod] = useState("participant_told_me");
  return (
    <div className="border-t border-t-line pt-3 mt-1">
      <p className="text-sm text-t-white mb-2">{mark}-day check-in: is {first} still there?</p>
      <div className="flex flex-wrap items-center gap-2">
        <label className="sr-only" htmlFor={`ci-${mark}`}>How do you know?</label>
        <select id={`ci-${mark}`} value={method} onChange={(e) => setMethod(e.target.value)} className="t-focus bg-t-panel-2 border border-t-line text-xs text-t-phos px-2 py-1.5">
          <option value="participant_told_me">They told me</option><option value="employer_confirmed">The employer confirmed it</option><option value="pay_stub_seen">I saw a pay stub</option>
        </select>
        <button onClick={() => onSave("employed", method)} className="t-focus text-xs border border-t-amber text-t-amber-bright px-3 py-1.5">Still there</button>
        <button onClick={() => onSave("not_employed", method)} className="t-focus text-xs border border-t-line text-t-phos px-3 py-1.5">No longer there</button>
        <button onClick={() => onSave("unknown", "could_not_reach")} className="t-focus text-xs border border-t-line text-t-phos-dim px-3 py-1.5">Could not reach them</button>
      </div>
    </div>
  );
}

function EndIt({ reasons, onEnd }: { reasons: Opt[]; onEnd: (endedOn: string, reason: string) => void }) {
  const [open, setOpen] = useState(false); const [on, setOn] = useState(""); const [why, setWhy] = useState("");
  if (!open) return <button onClick={() => setOpen(true)} className="t-focus text-xs text-t-phos-dim underline underline-offset-4 mt-3 hover:text-t-white">This job ended</button>;
  return (
    <div className="flex flex-wrap items-center gap-2 mt-3">
      <label className="sr-only" htmlFor="end-on">Last day</label><input id="end-on" type="date" value={on} onChange={(e) => setOn(e.target.value)} className="t-focus bg-t-panel-2 border border-t-line text-xs text-t-phos px-2 py-1.5" />
      <label className="sr-only" htmlFor="end-why">Why</label>
      <select id="end-why" value={why} onChange={(e) => setWhy(e.target.value)} className="t-focus bg-t-panel-2 border border-t-line text-xs text-t-phos px-2 py-1.5"><option value="">Why?</option>{reasons.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}</select>
      <button disabled={!on || !why} onClick={() => onEnd(on, why)} className="t-focus text-xs border border-t-line text-t-phos px-3 py-1.5 disabled:opacity-50">Save</button>
    </div>
  );
}
