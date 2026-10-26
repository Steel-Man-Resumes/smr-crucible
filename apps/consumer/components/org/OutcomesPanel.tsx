"use client";

/**
 * <OutcomesPanel> -- what happened after hire, for one participant.
 *
 * The first question on the form is HOW YOU KNOW, not the wage, because that is
 * the part a funder report depends on and the part that gets skipped. "They
 * told me" is a perfectly good answer; it just must not be reported as
 * confirmed. Wage and hours are optional. A check-in that could not reach the
 * person is recorded as exactly that.
 *
 * CORRECTIONS (migration 102) never overwrite: a corrected check-in is a new
 * answer and the earlier one stays on file; a corrected placement keeps every
 * earlier value. Both need a reason, and both show under "History".
 */
import { capFirst } from "@/lib/org-person-view";
import { useCallback, useEffect, useState } from "react";

interface Check { id?: string; day_mark: number; status: string; method: string; checked_at: string }
interface HistoryItem { kind: "check" | "placement" | "ended"; at: string; by_name: string | null; reason: string | null; detail: Record<string, unknown> }
interface Outcome {
  id: string; employer: string; job_title: string | null; start_date: string; hourly_wage: string | null; hours_per_week: string | null;
  source: string; verification_method: string | null; verified_by_name: string | null; ended_on: string | null; end_reason: string | null;
  created_by_name: string | null; checks: Check[]; due_marks: number[]; history?: HistoryItem[];
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
      {rows.length === 0 && <p className="text-sm text-t-phos-dim mb-5">No placement on record for {first} yet. {capFirst(first)} marking a job as hired in their own tracker is theirs; this is your organization&apos;s record, and {first} can see it.</p>}

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
            {canWrite && <Corrections o={o} first={first} opts={opts} post={post} />}
            <History items={o.history ?? []} opts={opts} />
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
          <p className="text-xs text-t-phos-dim mt-3">{capFirst(first)} can see that this is on file. It cannot be deleted; a mistake is ended as &ldquo;entered by mistake&rdquo;, which keeps it out of every count.</p>
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

const FIELD: Record<string, string> = {
  employer: "employer", job_title: "job title", start_date: "first day", hourly_wage: "hourly wage", hours_per_week: "hours a week",
  source: "how it is known", verification_method: "how it was confirmed", verified: "when it was confirmed", ended_on: "last day", end_reason: "why it ended",
};
const shown = (v: unknown) => (v === null || v === undefined || v === "" ? "blank" : String(v));

/** The audit trail for one placement, newest first, in plain sentences. */
function History({ items, opts }: { items: HistoryItem[]; opts: { sources: Opt[]; methods: Opt[]; endReasons: Opt[] } }) {
  const [open, setOpen] = useState(false);
  if (items.length === 0) return null;
  const label = (field: string, v: unknown) =>
    field === "source" ? opts.sources.find((s) => s.value === v)?.label ?? shown(v)
      : field === "verification_method" ? opts.methods.find((m) => m.value === v)?.label ?? shown(v)
      : field === "end_reason" ? opts.endReasons.find((r) => r.value === v)?.label ?? shown(v)
      : field === "verified" ? (v ? new Date(String(v)).toLocaleDateString() : "not confirmed") : shown(v);
  const sentence = (h: HistoryItem) => {
    const who = h.by_name || "Someone on the team";
    if (h.kind === "check") {
      const d = h.detail as { day_mark?: number; from?: string; to?: string };
      return `${who} corrected the ${d.day_mark}-day check-in from "${STATUS[d.from ?? ""] ?? d.from}" to "${STATUS[d.to ?? ""] ?? d.to}".`;
    }
    const parts = Object.entries(h.detail as Record<string, { from: unknown; to: unknown }>)
      .map(([f, c]) => `${FIELD[f] ?? f} from ${label(f, c?.from)} to ${label(f, c?.to)}`);
    return h.kind === "ended" ? `${who} recorded that the job ended.` : `${who} corrected the ${parts.join("; ")}.`;
  };
  return (
    <div className="mt-3">
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="t-focus text-xs text-t-phos-dim underline underline-offset-4 hover:text-t-white">
        {open ? "Hide history" : `History (${items.length})`}
      </button>
      {open && (
        <ul className="mt-2 space-y-2 border-l border-t-line pl-3">
          {items.map((h, i) => (
            <li key={i} className="text-xs text-t-phos">
              <span className="text-t-phos-dim">{new Date(h.at).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}: </span>
              {sentence(h)}
              {h.reason && <span className="block text-t-phos-dim">Why: &ldquo;{h.reason}&rdquo;</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Correct a check-in answer or the placement's details. Both keep what was there before, and both need a reason. */
function Corrections({ o, first, opts, post }: {
  o: Outcome; first: string; opts: { sources: Opt[]; methods: Opt[]; endReasons: Opt[] }; post: (b: Record<string, unknown>) => Promise<boolean>;
}) {
  const [mode, setMode] = useState<null | "details" | number>(null);
  const answered = o.checks.filter((c) => c.id);
  if (mode === null) return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 mt-3">
      <button type="button" onClick={() => setMode("details")} className="t-focus text-xs text-t-phos-dim underline underline-offset-4 hover:text-t-white">Correct the details</button>
      {answered.map((c) => (
        <button key={c.day_mark} type="button" onClick={() => setMode(c.day_mark)} className="t-focus text-xs text-t-phos-dim underline underline-offset-4 hover:text-t-white">
          Correct the {c.day_mark}-day answer
        </button>
      ))}
    </div>
  );
  if (mode === "details") return <CorrectDetails o={o} opts={opts} onCancel={() => setMode(null)} onSave={async (b) => { if (await post({ action: "correct", outcomeId: o.id, ...b })) setMode(null); }} />;
  const c = answered.find((x) => x.day_mark === mode);
  if (!c) return null;
  return <CorrectCheck check={c} first={first} onCancel={() => setMode(null)} onSave={async (b) => { if (await post({ action: "correct_check", checkId: c.id, ...b })) setMode(null); }} />;
}

function CorrectCheck({ check, first, onSave, onCancel }: { check: Check; first: string; onSave: (b: Record<string, unknown>) => void; onCancel: () => void }) {
  const [status, setStatus] = useState(check.status === "employed" ? "not_employed" : "employed");
  const [method, setMethod] = useState(check.method === "could_not_reach" ? "participant_told_me" : check.method);
  const [reason, setReason] = useState("");
  const unknown = status === "unknown";
  return (
    <div className="border-t border-t-line pt-3 mt-3">
      <p className="text-sm text-t-white mb-2">Correct the {check.day_mark}-day answer. The answer on file now, &ldquo;{STATUS[check.status]}&rdquo;, stays in the history.</p>
      <div className="grid sm:grid-cols-2 gap-2">
        <div>
          <label htmlFor={`cc-s-${check.day_mark}`} className="block text-xs text-t-phos-dim mb-1">Is {first} still there?</label>
          <select id={`cc-s-${check.day_mark}`} className={input} value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="employed">Still there</option><option value="not_employed">No longer there</option><option value="unknown">Could not reach them</option>
          </select>
        </div>
        {!unknown && (
          <div>
            <label htmlFor={`cc-m-${check.day_mark}`} className="block text-xs text-t-phos-dim mb-1">How do you know?</label>
            <select id={`cc-m-${check.day_mark}`} className={input} value={method} onChange={(e) => setMethod(e.target.value)}>
              <option value="participant_told_me">They told me</option><option value="employer_confirmed">The employer confirmed it</option><option value="pay_stub_seen">I saw a pay stub</option>
            </select>
          </div>
        )}
        <div className="sm:col-span-2">
          <label htmlFor={`cc-r-${check.day_mark}`} className="block text-xs text-t-phos-dim mb-1">Why are you correcting it?</label>
          <input id={`cc-r-${check.day_mark}`} className={input} value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} placeholder="For example: picked the wrong answer" />
        </div>
      </div>
      <div className="flex gap-3 mt-3">
        <button type="button" disabled={reason.trim().length < 3} onClick={() => onSave({ status, method: unknown ? "could_not_reach" : method, reason })}
          className="t-focus text-xs border border-t-amber text-t-amber-bright px-3 py-1.5 disabled:opacity-50">Save the correction</button>
        <button type="button" onClick={onCancel} className="t-focus text-xs text-t-phos-dim underline underline-offset-4">Cancel</button>
      </div>
    </div>
  );
}

function CorrectDetails({ o, opts, onSave, onCancel }: { o: Outcome; opts: { sources: Opt[]; methods: Opt[] }; onSave: (b: Record<string, unknown>) => void; onCancel: () => void }) {
  const [f, setF] = useState({
    employer: o.employer, jobTitle: o.job_title ?? "", startDate: o.start_date, hourlyWage: o.hourly_wage ? String(Number(o.hourly_wage)) : "",
    hoursPerWeek: o.hours_per_week ? String(Number(o.hours_per_week)) : "", source: o.source, verificationMethod: o.verification_method ?? "", reason: "",
  });
  const id = (k: string) => `cd-${k}-${o.id.slice(0, 8)}`;
  return (
    <form onSubmit={(e) => { e.preventDefault(); onSave(f); }} className="border-t border-t-line pt-3 mt-3">
      <p className="text-sm text-t-white mb-2">Correct the details. What is on file now stays in the history.</p>
      <div className="grid sm:grid-cols-2 gap-2">
        <div className="sm:col-span-2">
          <label htmlFor={id("src")} className="block text-xs text-t-phos-dim mb-1">How do you know?</label>
          <select id={id("src")} className={input} value={f.source} onChange={(e) => setF({ ...f, source: e.target.value, verificationMethod: "" })}>
            {opts.sources.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </div>
        {f.source === "staff_verified" && (
          <div className="sm:col-span-2">
            <label htmlFor={id("vm")} className="block text-xs text-t-phos-dim mb-1">Confirmed how?</label>
            <select id={id("vm")} className={input} value={f.verificationMethod} onChange={(e) => setF({ ...f, verificationMethod: e.target.value })} required>
              <option value="">Choose one</option>
              {opts.methods.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
          </div>
        )}
        <div><label htmlFor={id("emp")} className="block text-xs text-t-phos-dim mb-1">Employer</label><input id={id("emp")} className={input} value={f.employer} onChange={(e) => setF({ ...f, employer: e.target.value })} required /></div>
        <div><label htmlFor={id("title")} className="block text-xs text-t-phos-dim mb-1">Job title (optional)</label><input id={id("title")} className={input} value={f.jobTitle} onChange={(e) => setF({ ...f, jobTitle: e.target.value })} /></div>
        <div><label htmlFor={id("start")} className="block text-xs text-t-phos-dim mb-1">First day</label><input id={id("start")} type="date" className={input} value={f.startDate} onChange={(e) => setF({ ...f, startDate: e.target.value })} required /></div>
        <div className="grid grid-cols-2 gap-2">
          <div><label htmlFor={id("wage")} className="block text-xs text-t-phos-dim mb-1">Hourly wage</label><input id={id("wage")} inputMode="decimal" className={input} value={f.hourlyWage} onChange={(e) => setF({ ...f, hourlyWage: e.target.value })} /></div>
          <div><label htmlFor={id("hours")} className="block text-xs text-t-phos-dim mb-1">Hours a week</label><input id={id("hours")} inputMode="decimal" className={input} value={f.hoursPerWeek} onChange={(e) => setF({ ...f, hoursPerWeek: e.target.value })} /></div>
        </div>
        <div className="sm:col-span-2">
          <label htmlFor={id("why")} className="block text-xs text-t-phos-dim mb-1">Why are you correcting it?</label>
          <input id={id("why")} className={input} value={f.reason} maxLength={500} onChange={(e) => setF({ ...f, reason: e.target.value })} placeholder="For example: typed the wrong start date" required />
        </div>
      </div>
      <div className="flex gap-3 mt-3">
        <button disabled={f.reason.trim().length < 3} className="t-focus text-xs border border-t-amber text-t-amber-bright px-3 py-1.5 disabled:opacity-50">Save the correction</button>
        <button type="button" onClick={onCancel} className="t-focus text-xs text-t-phos-dim underline underline-offset-4">Cancel</button>
      </div>
    </form>
  );
}
