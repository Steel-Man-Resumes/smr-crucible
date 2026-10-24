"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRealTier } from "@/lib/useUserTier";
import type { ProgressRequest } from "@/lib/progression-ui";
import { RefineryAccessPanel, seatsLeft, type AdminPolicy } from "@/components/admin/RefineryAccessPanel";

interface AccessRequest extends ProgressRequest { userId: string; summary: string }
const POLICY_FIELDS = [
  ["starter_calls", "New account daily actions", 1, 100, 1],
  ["tailored_calls", "Daily actions after saved tailoring", 1, 100, 1],
  ["applied_calls", "Daily actions after confirmed application", 1, 100, 1],
  ["bonus_calls", "Actions in one approved bonus", 1, 10, 1],
  ["bonus_daily_cap", "Bonus actions per day", 0, 20, 1],
  ["bonus_monthly_cap", "Bonus actions per month", 0, 100, 1],
  ["daily_usd", "Daily admission budget (USD)", .1, 20, .01],
  ["reserve_usd", "Reservation per action (USD)", .01, 2, .01],
] as const;
type PolicyKey = typeof POLICY_FIELDS[number][0];
type Policy = Record<PolicyKey, number>;
type PolicyForm = Record<PolicyKey, string>;

/** The approve button for a seat request says where the seat comes from. */
function approveSeatLabel(policy: AdminPolicy | null): string {
  if (!policy?.houseCodeId) return "Approve (set a house organization first)";
  const left = seatsLeft(policy);
  return `Approve and give a seat from my organization (${left === null ? "no limit" : `${left} left`})`;
}

export default function AccessRequestsPage() {
  const tier = useRealTier();
  const [requests, setRequests] = useState<AccessRequest[] | null>(null);
  const [policy, setPolicy] = useState<PolicyForm | null>(null);
  const [policyDirty, setPolicyDirty] = useState(false);
  const policyDirtyRef = useRef(false);
  policyDirtyRef.current = policyDirty;
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [reload, setReload] = useState(0);
  const [seatPolicy, setSeatPolicy] = useState<AdminPolicy | null>(null);
  // Paging (review 1, N-6): the queue shows 100 at a time, open ones first.
  const [offset, setOffset] = useState(0);
  const [openTotal, setOpenTotal] = useState<number | null>(null);
  const requestSequence = useRef(0);
  const live = useRef(true);
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  const load = useCallback(async () => {
    if (tier !== "admin") return;
    const sequence = ++requestSequence.current;
    setError("");
    try {
      const response = await fetch(`/api/admin/access-requests?offset=${offset}`, { cache: "no-store" });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(response.status === 403 ? "Platform admin access and two-step verification are required." : body?.error || "Requests could not be loaded.");
      if (!Array.isArray(body?.requests)) throw new Error("Requests could not be loaded.");
      if (!live.current || sequence !== requestSequence.current) return;
      setRequests(body.requests);
      setOpenTotal(typeof body.openTotal === "number" ? body.openTotal : null);
      if (!policyDirtyRef.current && body.policy) setPolicy(Object.fromEntries(POLICY_FIELDS.map(([key]) => [key, String(body.policy[key])])) as PolicyForm);
    } catch (caught) {
      if (live.current && sequence === requestSequence.current) setError(caught instanceof Error ? caught.message : "Requests could not be loaded.");
    }
  }, [tier, offset]);
  useEffect(() => { void load(); }, [load, reload]);

  async function decide(request: AccessRequest, decision: "approve" | "deny" | "question") {
    const note = notes[request.id]?.trim();
    if (busy || !note || note.length < 3) return;
    setBusy(request.id); setError(""); setMessage("");
    try {
      const response = await fetch("/api/admin/access-requests", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: request.id, decision, note }) });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.error || "The decision did not save.");
      if (live.current) { setMessage(decision === "question" ? "Question saved for the participant." : request.kind === "seat" && decision === "approve" ? (body?.emailFailed ? "Seat offered. The email did not send; they will see it on the seat page when they sign in." : "Seat offered from your organization. They accept it on the seat page, and the Refinery opens for them when they say yes.") : "Decision saved and applied by the server."); await load(); }
    } catch (caught) { if (live.current) setError(caught instanceof Error ? caught.message : "The decision did not save."); }
    finally { if (live.current) setBusy(null); }
  }

  async function savePolicy(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!policy || busy) return;
    const next = Object.fromEntries(POLICY_FIELDS.map(([key]) => [key, Number(policy[key])])) as Policy;
    if (Object.values(next).some((value) => !Number.isFinite(value))) { setError("Enter a number in every allowance field."); return; }
    setBusy("policy"); setError(""); setMessage("");
    try {
      const response = await fetch("/api/admin/access-policy", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(next) });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.error || "Allowance settings did not save.");
      if (live.current) { policyDirtyRef.current = false; setPolicyDirty(false); setMessage("Allowance settings saved. Existing accounts retain their established allowance."); await load(); }
    } catch (caught) { if (live.current) setError(caught instanceof Error ? caught.message : "Allowance settings did not save."); }
    finally { if (live.current) setBusy(null); }
  }

  if (tier !== "admin") return <p className="py-10 text-sm text-t-phos-dim">Platform admin access is required.</p>;
  return <div className="max-w-4xl space-y-6">
    <header><Link href="/dashboard/admin" className="t-focus inline-flex min-h-touch items-center text-sm text-t-amber-bright underline">Back to admin</Link><h1 className="mt-2 text-2xl font-bold text-t-white">Access requests</h1><p className="mt-2 text-sm leading-relaxed text-t-phos-dim">Review the participant’s shared summary. Early access opens a guided tool without marking preparation completed. Bonus approval uses server caps. No external message is sent here.</p></header>
    {error ? <div role="alert" className="border border-t-red p-4 text-sm text-t-red"><p>{error}</p><button type="button" disabled={!!busy} onClick={() => setReload((value) => value + 1)} className="t-focus min-h-touch underline">Reload requests</button></div> : null}
    {message ? <p role="status" className="border border-t-line p-4 text-sm text-t-phos">{message}</p> : null}
    <RefineryAccessPanel onPolicy={setSeatPolicy} />
    <details className="border border-t-line bg-t-panel p-4"><summary className="t-focus min-h-touch cursor-pointer text-base font-semibold text-t-white">Allowance settings</summary><p className="mt-3 text-sm leading-relaxed text-t-phos-dim">Existing accounts retain their allowance. These daily actions are pooled across covered Refinery text AI workflows. Failed generations refund actions; provider cost still counts. Dollar limits reserve admission budget and do not guarantee an absolute bill ceiling. Premium access and pricing use their existing controls.</p>
      {policy ? <form onSubmit={savePolicy} className="mt-4 space-y-4"><div className="grid gap-4 sm:grid-cols-2">{POLICY_FIELDS.map(([key, label, min, max, step]) => <label key={key} className="block text-sm text-t-phos">{label}<input type="number" required min={min} max={max} step={step} disabled={!!busy} value={policy[key]} onChange={(event) => { setPolicy((current) => current ? { ...current, [key]: event.target.value } : current); setPolicyDirty(true); }} className="t-focus mt-1 block w-full border border-t-line bg-t-panel-2 px-3 py-2 text-t-white" /></label>)}</div><p className="text-xs text-t-phos-dim">Starting allowance ≤ tailored allowance ≤ application allowance. The server validates bounds and applies the policy after real platform admin and two-step checks.</p><button type="submit" disabled={!!busy || !policyDirty} className="t-focus min-h-touch bg-t-amber px-4 py-2 text-sm font-bold text-white disabled:opacity-50">{busy === "policy" ? "Saving..." : "Save allowance settings"}</button></form> : <p className="mt-3 text-sm text-t-phos-dim">Load the queue to inspect current settings.</p>}
    </details>
    {requests === null && !error ? <p role="status" className="text-sm text-t-phos-dim">Loading requests...</p> : null}
    {requests?.length === 0 ? <p className="border border-t-line p-5 text-sm text-t-phos-dim">No access requests.</p> : null}
    {openTotal !== null ? <p className="text-sm text-t-phos-dim">{openTotal} open {openTotal === 1 ? "request" : "requests"} in all. Showing {offset + 1} to {offset + (requests?.length ?? 0)}.</p> : null}
    <div className="flex gap-2">
      {offset > 0 ? <button type="button" disabled={!!busy} onClick={() => setOffset((o) => Math.max(0, o - 100))} className="t-focus min-h-touch border border-t-line px-3 py-2 text-sm text-t-white">Newer</button> : null}
      {(requests?.length ?? 0) >= 100 ? <button type="button" disabled={!!busy} onClick={() => setOffset((o) => o + 100)} className="t-focus min-h-touch border border-t-line px-3 py-2 text-sm text-t-white">Older</button> : null}
    </div>
    <ul className="space-y-4">{requests?.map((request) => {
      const open = request.status === "pending" || request.status === "question";
      return <li key={request.id} className="border border-t-line bg-t-panel p-5"><div className="flex flex-wrap justify-between gap-2 text-xs text-t-phos-dim"><p>Account {request.userId.slice(0, 8)} · {request.kind === "seat" ? "Seat" : `${request.kind.replace(/_/g, " ")} · ${request.stepId}`}</p><p>{request.status.replace(/_/g, " ")}</p></div><p className="mt-3 whitespace-pre-wrap break-words text-sm leading-relaxed text-t-white">{request.summary}</p>{request.decisionNote ? <p className="mt-3 whitespace-pre-wrap text-sm text-t-phos-dim">Last response: {request.decisionNote}</p> : null}
        {open ? <div className="mt-4 space-y-3"><label className="block text-sm text-t-phos">Response the participant will see<textarea maxLength={1000} rows={3} disabled={!!busy} value={notes[request.id] ?? ""} onChange={(event) => setNotes((current) => ({ ...current, [request.id]: event.target.value }))} className="t-focus mt-1 block w-full border border-t-line bg-t-panel-2 px-3 py-2 text-t-white" /></label><div className="flex flex-wrap gap-2">{([["approve", request.kind === "seat" ? approveSeatLabel(seatPolicy) : "Approve"], ["deny", "Deny"], ["question", "Ask a question"]] as const).map(([decision, label]) => <button type="button" key={decision} disabled={!!busy || (notes[request.id]?.trim().length ?? 0) < 3} onClick={() => void decide(request, decision)} className="t-focus min-h-touch border border-t-line px-3 py-2 text-sm font-semibold text-t-white disabled:opacity-50">{busy === request.id ? "Saving..." : label}</button>)}</div></div> : null}
      </li>;
    })}</ul>
  </div>;
}
