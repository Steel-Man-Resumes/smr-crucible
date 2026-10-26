"use client";

/**
 * <EnrollmentsPanel> -- one person's programs, cohorts and caseloads, on
 * their page (house lane L3a, migration 103).
 *
 * One record per person per organization; enrollments are many. Staff who
 * hold org.enrollment.write enroll the person, move an enrollment along
 * (paused, finished, left) with a reason from a plain list, and reopen one
 * entered by mistake. There is no free-text reason box on purpose: a reason
 * box is where a court date gets typed. The organization's own id for the
 * person is optional and the form says it is never a DOC or case number.
 *
 * Rows come through the reach policy: staff only see enrollments of people
 * they already reach, which is everyone on this page.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ENROLLMENT_MOVES, ENROLLMENT_STATUS_LABELS, ENROLLABLE_KINDS, OPEN_ENROLLMENT_STATUSES, PROGRAM_ID_HELP, START_STATUSES,
  STATUS_REASON_LABELS, reasonsFor, type EnrollmentStatus, type StatusReason, type UnitKind,
} from "@crucible/core/src/orgStructureShared";
import { useOrgTerms } from "@/lib/use-org-terms";

interface Row {
  id: string; org_unit_id: string; unit_name: string; unit_kind: UnitKind; unit_status: string; status: EnrollmentStatus;
  enrolled_on: string | null; exited_on: string | null; exit_reason: StatusReason | null; primary_staff_name: string | null; program_participant_id: string | null;
}
interface UnitOpt { id: string; parent_id: string | null; name: string; kind: UnitKind; status: string }

const btn = "t-focus min-h-[44px] px-3 py-2 text-sm border rounded-[4px]";
const quiet = `${btn} bg-t-panel text-t-phos border-t-line hover:text-t-white`;
const primary = `${btn} bg-t-amber text-[#14100a] border-t-amber font-semibold disabled:opacity-50`;
const field = "plain-field t-focus bg-t-panel-2 border border-t-line text-sm text-t-white px-3 py-2 min-h-[44px]";
const day = (s: string | null) => (s ? new Date(`${s}T12:00:00Z`).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "");

/** Path of a unit, top first. */
function pathOf(units: UnitOpt[], id: string): string {
  const byId = new Map(units.map((u) => [u.id, u]));
  const out: string[] = []; let cur = byId.get(id); let g = 0;
  while (cur && g++ < 10) { out.unshift(cur.name); cur = cur.parent_id ? byId.get(cur.parent_id) : undefined; }
  return out.join(" / ");
}

async function send(body: Record<string, unknown>): Promise<string | null> {
  try {
    const res = await fetch("/api/org/enrollments", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    return res.ok ? null : (await res.json().catch(() => ({}))).error || "That did not save. Nothing was changed.";
  } catch { return "That did not save. Check your connection and try again."; }
}

export function EnrollmentsPanel({ clientId, first }: { clientId: string; first: string }) {
  const t = useOrgTerms();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [units, setUnits] = useState<UnitOpt[]>([]);
  const [canEnroll, setCanEnroll] = useState(false);
  const [canManage, setCanManage] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [adding, setAdding] = useState(false);
  const [msg, setMsg] = useState<{ text: string; good?: boolean } | null>(null);

  const load = useCallback(async () => {
    try {
      const [e, s] = await Promise.all([
        fetch(`/api/org/enrollments?participant=${encodeURIComponent(clientId)}`).then((r) => (r.ok ? r.json() : null)),
        fetch("/api/org/structure").then((r) => (r.ok ? r.json() : null)),
      ]);
      if (!e || !s || s.ready === false) { setHidden(true); return; }
      setRows(e.enrollments ?? []); setCanEnroll(!!e.canEnroll); setUnits(s.units ?? []); setCanManage(!!s.canManage);
    } catch { setHidden(true); }
  }, [clientId]);
  useEffect(() => { load(); }, [load]);

  const openIn = useMemo(() => new Set((rows ?? []).filter((r) => OPEN_ENROLLMENT_STATUSES.includes(r.status)).map((r) => r.org_unit_id)), [rows]);
  const choices = units.filter((u) => u.status === "active" && ENROLLABLE_KINDS.includes(u.kind) && !openIn.has(u.id));

  if (hidden || !rows) return null;
  // Nothing to show and nothing to do: stay out of the way.
  if (rows.length === 0 && choices.length === 0 && !canManage) return null;

  const done = async (body: Record<string, unknown>, ok: string) => {
    setMsg(null);
    const err = await send(body);
    setMsg(err ? { text: err } : { text: ok, good: true });
    if (!err) await load();
    return !err;
  };

  return (
    <section aria-labelledby="enroll-heading" className="bg-t-panel border border-t-line rounded-[4px] p-4 mb-5">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
        <h2 id="enroll-heading" className="text-sm font-semibold text-t-white">{capFirst(t.plural("program"))}</h2>
        {canEnroll && choices.length > 0 && !adding && <button type="button" className={quiet} onClick={() => setAdding(true)}>Enroll {first}</button>}
      </div>
      {msg && <p role={msg.good ? "status" : "alert"} className={`text-xs mb-2 ${msg.good ? "text-t-phos" : "text-t-amber-bright"}`}>{msg.text}</p>}
      {rows.length === 0 ? (
        <p className="text-sm text-t-phos-dim">
          {capFirst(first)} is not in any {t.program} yet.
          {choices.length === 0 && canManage ? <> Add your {t.plural("program")} on <Link href="/dashboard/structure" className="t-focus underline underline-offset-4">Structure</Link>.</> : null}
        </p>
      ) : (
        <ul className="divide-y divide-t-line">
          {rows.map((r) => <EnrollmentItem key={r.id} r={r} path={pathOf(units, r.org_unit_id) || r.unit_name} canEnroll={canEnroll} first={first} act={done} />)}
        </ul>
      )}
      {adding && <EnrollForm first={first} clientId={clientId} choices={choices} units={units} programWord={t.program} act={done} onDone={() => setAdding(false)} />}
    </section>
  );
}

function capFirst(s: string) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }

function EnrollmentItem({ r, path, canEnroll, first, act }: { r: Row; path: string; canEnroll: boolean; first: string; act: (b: Record<string, unknown>, ok: string) => Promise<boolean> }) {
  const [to, setTo] = useState<EnrollmentStatus | "">("");
  const [reason, setReason] = useState<StatusReason | "">("");
  const isOpen = OPEN_ENROLLMENT_STATUSES.includes(r.status);
  const reasons = to ? reasonsFor(to) : [];
  const id = `enr-${r.id}`;
  const since = isOpen ? (r.enrolled_on ? `since ${day(r.enrolled_on)}` : "") : `${day(r.exited_on)}${r.exit_reason ? `, ${STATUS_REASON_LABELS[r.exit_reason].toLowerCase()}` : ""}`;
  return (
    <li className="py-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm text-t-white">{path}</p>
        <p className="text-xs text-t-phos">
          <span className={isOpen ? "text-t-white font-semibold" : ""}>{ENROLLMENT_STATUS_LABELS[r.status]}</span>{since ? ` · ${since}` : ""}
        </p>
      </div>
      {(r.primary_staff_name || r.program_participant_id) && (
        <p className="text-xs text-t-phos-dim">{[r.primary_staff_name ? `With ${r.primary_staff_name}` : "", r.program_participant_id ? `Your id: ${r.program_participant_id}` : ""].filter(Boolean).join(" · ")}</p>
      )}
      {canEnroll && (
        <form className="flex flex-wrap gap-2 items-end mt-2" onSubmit={async (e) => {
          e.preventDefault(); if (!to) return;
          if (await act({ action: "status", enrollmentId: r.id, status: to, reason: reason || null }, `${capFirst(first)} is now ${ENROLLMENT_STATUS_LABELS[to].toLowerCase()} in ${path}.`)) { setTo(""); setReason(""); }
        }}>
          <div>
            <label htmlFor={`${id}-to`} className="sr-only">Change status for {path}</label>
            <select id={`${id}-to`} value={to} onChange={(e) => { setTo(e.target.value as EnrollmentStatus); setReason(""); }} className={field}>
              <option value="">{isOpen ? "Change status..." : "Reopen..."}</option>
              {ENROLLMENT_MOVES[r.status].map((s) => <option key={s} value={s}>{ENROLLMENT_STATUS_LABELS[s]}</option>)}
            </select>
          </div>
          {reasons.length > 0 && (
            <div>
              <label htmlFor={`${id}-why`} className="sr-only">Why</label>
              <select id={`${id}-why`} value={reason} onChange={(e) => setReason(e.target.value as StatusReason)} className={field} required>
                <option value="">Why?</option>
                {reasons.map((x) => <option key={x} value={x}>{STATUS_REASON_LABELS[x]}</option>)}
              </select>
            </div>
          )}
          {to && <button className={primary} disabled={reasons.length > 0 && !reason}>Save</button>}
        </form>
      )}
    </li>
  );
}

function EnrollForm({ first, clientId, choices, units, programWord, act, onDone }: {
  first: string; clientId: string; choices: UnitOpt[]; units: UnitOpt[]; programWord: string;
  act: (b: Record<string, unknown>, ok: string) => Promise<boolean>; onDone: () => void;
}) {
  const [unitId, setUnitId] = useState(choices[0]?.id ?? "");
  const [status, setStatus] = useState<EnrollmentStatus>("enrolled");
  const [pid, setPid] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <form className="mt-3 pt-3 border-t border-t-line grid gap-3 sm:grid-cols-2" onSubmit={async (e) => {
      e.preventDefault(); if (!unitId || busy) return;
      setBusy(true);
      const name = pathOf(units, unitId);
      const ok = await act({ action: "create", participantId: clientId, unitId, status, programParticipantId: pid.trim() || null }, `${capFirst(first)} is ${ENROLLMENT_STATUS_LABELS[status].toLowerCase()} in ${name}.`);
      setBusy(false);
      if (ok) onDone();
    }}>
      <div className="sm:col-span-2">
        <label htmlFor="enroll-unit" className="block text-xs text-t-phos-dim mb-1">Which {programWord}, cohort or caseload</label>
        <select id="enroll-unit" value={unitId} onChange={(e) => setUnitId(e.target.value)} className={`${field} w-full`}>
          {choices.map((u) => <option key={u.id} value={u.id}>{pathOf(units, u.id)}</option>)}
        </select>
      </div>
      <div>
        <label htmlFor="enroll-status" className="block text-xs text-t-phos-dim mb-1">Start as</label>
        <select id="enroll-status" value={status} onChange={(e) => setStatus(e.target.value as EnrollmentStatus)} className={`${field} w-full`}>
          {START_STATUSES.map((s) => <option key={s} value={s}>{ENROLLMENT_STATUS_LABELS[s]}</option>)}
        </select>
      </div>
      <div>
        <label htmlFor="enroll-pid" className="block text-xs text-t-phos-dim mb-1">Your own id for {first} (optional)</label>
        <input id="enroll-pid" value={pid} maxLength={40} onChange={(e) => setPid(e.target.value)} aria-describedby="enroll-pid-help" className={`${field} w-full`} />
        <p id="enroll-pid-help" className="text-xs text-t-phos-dim mt-1">{PROGRAM_ID_HELP}</p>
      </div>
      <p className="sm:col-span-2 text-xs text-t-phos-dim">This also lets the staff in that {programWord} work with {first}. Every change is recorded with who made it.</p>
      <div className="sm:col-span-2 flex gap-2">
        <button className={primary} disabled={!unitId || busy}>{busy ? "Saving..." : "Enroll"}</button>
        <button type="button" className={quiet} onClick={onDone}>Cancel</button>
      </div>
    </form>
  );
}
