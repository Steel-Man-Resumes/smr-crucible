"use client";

/**
 * <ContributionQueue> -- the SMR data owner's review of staff directory
 * contributions (lane S6, migration 112). Approve with what it turned out to
 * be, ask for more, or not use; revert an approval within 30 days. For an
 * approved call or visit, "Record the call" writes the documented
 * interaction (employer: relationship confirmation in the program's name;
 * resource: the R3 event bound to the live check id you give). Approving
 * never publishes by itself; band and tier rules decide what shows.
 */
import { useCallback, useEffect, useState } from "react";
import { FLOW_LABELS, METHOD_LABELS, OUTCOMES_FOR_FLOW, STATUS_WORDS, type ContributionFlow, type ContributionOutcome, type ContributionStatus, type ContactMethod } from "@crucible/core/src/directoryContributionShared";

interface Row {
  id: string; orgName: string | null; submitterName: string | null; flow: ContributionFlow; targetKind: string; targetId: string | null; targetName: string | null;
  details: Record<string, string>; interactionOn: string | null; interactionMethod: ContactMethod | null; sourceUrl: string | null; privateNote: string | null;
  creditOrgOk: boolean; creditPersonOk: boolean; status: ContributionStatus; outcome: ContributionOutcome | null; createdAt: string; decidedAt: string | null; appliedAt: string | null;
}
const OUTCOME_WORDS: Record<ContributionOutcome, string> = { verified_call: "Verified call or visit", warm_intro: "Warm introduction", correction: "Correction", new_row: "New row" };

export function ContributionQueue() {
  const [status, setStatus] = useState("open");
  const [rows, setRows] = useState<Row[] | null>(null);
  const [err, setErr] = useState("");
  const [answer, setAnswer] = useState<Record<string, string>>({});
  const [checkId, setCheckId] = useState<Record<string, string>>({});
  const load = useCallback(() => {
    setErr("");
    fetch(`/api/admin/directory-contributions?status=${status}`, { cache: "no-store" }).then(async (r) => {
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || "Owner access required.");
      setRows(d.data);
    }).catch((e) => { setErr(e.message); setRows([]); });
  }, [status]);
  useEffect(() => { load(); }, [load]);
  async function post(body: Record<string, unknown>) {
    setErr("");
    const r = await fetch("/api/admin/directory-contributions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
    const d = await r?.json().catch(() => ({}));
    if (!r?.ok) setErr(d?.error || "That could not be saved.");
    load();
  }
  return (
    <main className="mx-auto max-w-4xl p-5">
      <h1 className="text-2xl font-bold">Staff directory contributions</h1>
      <p className="my-2 text-sm">From program staff. Private notes show only here. Approving records the decision and the program&apos;s credit; it does not publish. Credit is never shown publicly until the listing wording is decided.</p>
      <label className="text-sm">Show <select value={status} onChange={(e) => setStatus(e.target.value)} className="border border-t-line bg-t-bg p-2">
        {["open", "approved", "not_used", "withdrawn", "all"].map((s) => <option key={s} value={s}>{s.replace("_", " ")}</option>)}</select></label>
      {err && <p role="alert" className="mt-2">{err}</p>}
      {rows === null ? <p role="status">Loading...</p> : rows.length === 0 ? <p className="mt-3">Nothing here.</p> : (
        <ul className="mt-3 space-y-3">{rows.map((r) => (
          <li key={r.id} className="border border-t-line p-3 text-sm">
            <p className="font-semibold">{FLOW_LABELS[r.flow].title}: {r.targetName ?? r.details.name ?? "(no name)"} <span className="font-normal">({r.targetKind})</span></p>
            <p>From {r.submitterName ?? "a staff member"} at {r.orgName ?? "a program"}, {new Date(r.createdAt).toLocaleDateString()}. Credit: program {r.creditOrgOk ? "yes" : "no"}, person {r.creditPersonOk ? "yes" : "no"}.</p>
            {Object.entries(r.details).filter(([k]) => k !== "name").map(([k, v]) => <p key={k}><span className="font-semibold">{k}:</span> {v}</p>)}
            {r.interactionOn && <p><span className="font-semibold">Contact:</span> {r.interactionMethod ? METHOD_LABELS[r.interactionMethod] : ""} on {r.interactionOn}</p>}
            {r.sourceUrl && <p><span className="font-semibold">Source:</span> {r.sourceUrl}</p>}
            {r.privateNote && <p className="border-l-2 border-t-amber pl-2"><span className="font-semibold">Private:</span> {r.privateNote}</p>}
            {r.targetId && <p className="text-xs">Listing id {r.targetId}</p>}
            <p className="mt-1">{STATUS_WORDS[r.status]}{r.outcome ? ` (${OUTCOME_WORDS[r.outcome]})` : ""}{r.appliedAt ? " Recorded as a partner staff call." : ""}</p>
            {r.flow === "called_today" && <p className="text-xs"><span className="font-semibold">Source:</span> partner staff call ({r.orgName ?? "a program"}), not Steel Man&apos;s own contact. It is recorded with provenance partner_staff and shows that way in directory_contact_provenance_v.</p>}
            {(r.status === "received" || r.status === "needs_more") && (
              <div className="mt-2 space-y-2">
                <input maxLength={300} placeholder="Short answer to the staff member (optional)" value={answer[r.id] ?? ""} onChange={(e) => setAnswer({ ...answer, [r.id]: e.target.value })} className="block w-full border border-t-line bg-t-bg p-2" />
                <div className="flex flex-wrap gap-3">
                  {OUTCOMES_FOR_FLOW[r.flow].filter((o) => o !== "verified_call" || (r.interactionMethod && ["phone_call", "in_person", "email_reply", "site_visit"].includes(r.interactionMethod))).map((o) => (
                    <button key={o} type="button" className="min-h-touch text-t-steel underline" onClick={() => post({ action: "decide", id: r.id, status: "approved", outcome: o, answer: answer[r.id] })}>Approve as {OUTCOME_WORDS[o].toLowerCase()}</button>))}
                  <button type="button" className="min-h-touch text-t-steel underline" onClick={() => post({ action: "decide", id: r.id, status: "needs_more", answer: answer[r.id] })}>Ask for more</button>
                  <button type="button" className="min-h-touch text-t-steel underline" onClick={() => post({ action: "decide", id: r.id, status: "not_used", answer: answer[r.id] })}>Not used</button>
                </div>
              </div>)}
            {r.status === "approved" && r.outcome === "verified_call" && !r.appliedAt && (
              <div className="mt-2 flex flex-wrap items-end gap-3">
                <label>{r.targetKind === "resource" ? "Live check id this call confirmed" : "Employer place id (optional)"}
                  <input value={checkId[r.id] ?? ""} onChange={(e) => setCheckId({ ...checkId, [r.id]: e.target.value })} className="block border border-t-line bg-t-bg p-2 w-80" /></label>
                <button type="button" className="min-h-touch text-t-steel underline" onClick={() => post(r.targetKind === "resource"
                  ? { action: "record_call", id: r.id, checkId: checkId[r.id] }
                  : { action: "record_call", id: r.id, placeId: checkId[r.id] || null })}>Record the call</button>
              </div>)}
            {r.status === "approved" && !r.appliedAt && r.decidedAt && Date.now() - Date.parse(r.decidedAt) < 30 * 86_400_000 && (
              <button type="button" className="mt-1 min-h-touch text-t-steel underline" onClick={() => post({ action: "decide", id: r.id, status: "not_used", answer: answer[r.id] })}>Revert approval</button>)}
          </li>))}
        </ul>)}
    </main>
  );
}
