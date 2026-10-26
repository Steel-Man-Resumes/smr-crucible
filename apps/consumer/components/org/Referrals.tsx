"use client";
/**
 * Closed-loop referrals (house lane L5, R22): the person page's Referrals tab
 * and the organization's Referrals list share these pieces.
 *
 * A referral says where someone was sent, who owns the follow-through, and
 * when to look next. It moves one step at a time (sent, accepted, in touch,
 * help given, closed), and "closed" never claims anyone was helped: a close
 * without help given needs a reason. A referral to a partner organization
 * stays a draft until the person agrees to share their name with it.
 * Nothing here sends anything to anyone.
 */
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { REFERRAL_STATUS_LABELS, REFERRAL_ACTION_LABELS, REFERRAL_TRANSITIONS, referralNeedsReason, isReferralOverdue, type ReferralStatus, type ReferralToKind } from "@crucible/core/src/orgWorkflowShared";
import { useAutosaveDraft } from "@/lib/use-autosave-draft";
import { DraftStatus } from "@/components/org/DraftStatus";

export interface ReferralView {
  id: string; participant_user_id: string; participant_name: string | null; to_kind: ReferralToKind; to_name: string; reason: string | null;
  status: ReferralStatus; status_reason: string | null; owner_staff_id: string | null; owner_name: string | null; due_on: string | null;
  consent_ok: boolean; delivered_at: string | null; closed_at: string | null; created_at: string; created_by_name: string | null;
}
interface Payload { referrals: ReferralView[]; canWrite: boolean; me: string; owners: { id: string; name: string | null }[]; options: { partnerConsentLine: string } }
interface EventView { id: string; from_status: ReferralStatus | null; to_status: ReferralStatus; status_reason: string | null; owner_name: string | null; due_on: string | null; actor_name: string | null; at: string }

const today = () => new Date().toISOString().slice(0, 10);
const day = (s: string | null) => (s ? new Date(s.length === 10 ? s + "T12:00:00Z" : s).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "");
const field = "plain-field t-focus w-full bg-t-panel-2 border border-t-line text-sm text-t-white px-3 py-2";

async function post(body: Record<string, unknown>): Promise<{ ok: boolean; error?: string; note?: string | null; events?: EventView[] }> {
  try {
    const res = await fetch("/api/org/referrals", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const d = await res.json().catch(() => ({}));
    return res.ok ? { ok: true, ...d } : { ok: false, error: d.error || "That did not save." };
  } catch { return { ok: false, error: "That did not save. Check the connection and try again." }; }
}

export function useReferrals(query: Record<string, string>) {
  const [data, setData] = useState<Payload | null>(null);
  const [failed, setFailed] = useState(false);
  const qs = new URLSearchParams(query).toString();
  const load = useCallback(async () => {
    setFailed(false);
    try {
      const res = await fetch(`/api/org/referrals?${qs}`);
      if (!res.ok) throw new Error();
      setData(await res.json());
    } catch { setFailed(true); }
  }, [qs]);
  useEffect(() => { load(); }, [load]);
  return { data, failed, reload: load };
}

/** One referral: where, why, where it stands, the next step, and its history. */
export function ReferralCard({ r, canWrite, owners, showPerson, consentLine, onChange }: {
  r: ReferralView; canWrite: boolean; owners: { id: string; name: string | null }[]; showPerson?: boolean; consentLine: string; onChange: () => void;
}) {
  const [moving, setMoving] = useState<ReferralStatus | null>(null);
  const [reason, setReason] = useState("");
  const [due, setDue] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState<EventView[] | null>(null);
  const overdue = isReferralOverdue(r, today());
  const next = REFERRAL_TRANSITIONS[r.status];
  const blocked = r.to_kind === "partner_org" && !r.consent_ok;

  async function go(to: ReferralStatus) {
    setBusy(true); setMsg(null);
    const res = await post({ action: "move", referralId: r.id, to, reason: reason || null, dueOn: due || null });
    setBusy(false);
    if (!res.ok) { setMsg(res.error ?? null); return; }
    setMoving(null); setReason(""); setDue(""); setHistory(null); onChange();
  }
  async function update(body: Record<string, unknown>) {
    setBusy(true); setMsg(null);
    const res = await post({ action: "update", referralId: r.id, ...body });
    setBusy(false);
    if (!res.ok) setMsg(res.error ?? null); else onChange();
  }
  async function toggleHistory() {
    if (history) { setHistory(null); return; }
    const res = await post({ action: "history", referralId: r.id });
    setHistory(res.ok ? res.events ?? [] : []);
  }

  return (
    <li id={`referral-${r.id}`} className={`bg-t-panel border px-4 py-3 scroll-mt-24 ${overdue ? "border-t-amber" : "border-t-line"}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          {showPerson && (
            <p className="text-xs text-t-phos-dim">
              <Link href={`/dashboard/clients/${r.participant_user_id}?tab=referrals`} className="t-focus underline underline-offset-4 hover:text-t-white">{r.participant_name || "Name not shared"}</Link>
            </p>
          )}
          <p className="text-sm font-semibold text-t-white">To {r.to_name}</p>
          {r.reason && <p className="text-sm text-t-phos whitespace-pre-wrap">{r.reason}</p>}
          <p className="mt-1 text-xs text-t-phos-dim">
            {r.owner_name ? `Owner: ${r.owner_name}` : "No owner"}
            {r.due_on ? ` · ${overdue ? "was due" : "next look"} ${day(r.due_on)}` : ""}
            {` · made ${day(r.created_at)}`}{r.created_by_name ? ` by ${r.created_by_name}` : ""}
          </p>
        </div>
        <p className={`text-xs px-2 py-1 border ${r.status === "closed" ? "border-t-line text-t-phos-dim" : overdue ? "border-t-amber text-t-amber-bright" : "border-t-line text-t-white"}`}>
          {REFERRAL_STATUS_LABELS[r.status]}{r.status === "closed" ? (r.delivered_at ? ", help was given" : ", no help recorded") : ""}{overdue ? " · past due" : ""}
        </p>
      </div>
      {r.status_reason && <p className="mt-1 text-xs text-t-phos">Why: {r.status_reason}</p>}
      {blocked && r.status === "draft" && <p className="mt-2 border border-t-line bg-t-panel-2 px-3 py-2 text-xs text-t-phos">{consentLine}</p>}

      {canWrite && r.status !== "closed" && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {next.filter((s) => !(blocked && s !== "closed")).map((s) => (
            <button key={s} type="button" disabled={busy} onClick={() => { setMoving(s); setMsg(null); }}
              aria-pressed={moving === s}
              className={`t-focus min-h-touch border px-3 text-xs ${moving === s ? "border-t-amber text-t-white" : "border-t-line text-t-phos hover:text-t-white"} disabled:opacity-50`}>
              {REFERRAL_ACTION_LABELS[s]}
            </button>
          ))}
          <label className="flex items-center gap-1 text-xs text-t-phos-dim">Next look
            <input type="date" defaultValue={r.due_on ?? ""} onBlur={(e) => { if (e.target.value !== (r.due_on ?? "")) update({ dueOn: e.target.value || null }); }}
              className="plain-field t-focus border border-t-line bg-t-panel-2 px-2 py-1 text-xs text-t-phos" />
          </label>
          {owners.length > 0 && (
            <label className="flex items-center gap-1 text-xs text-t-phos-dim">Owner
              <select value={r.owner_staff_id ?? ""} onChange={(e) => update({ ownerId: e.target.value || null })}
                className="t-focus border border-t-line bg-t-panel px-2 py-1 text-xs text-t-phos">
                <option value="">Nobody</option>
                {owners.map((o) => <option key={o.id} value={o.id}>{o.name || "Staff member"}</option>)}
              </select>
            </label>
          )}
        </div>
      )}
      {moving && (
        <div className="mt-3 border-t border-t-line pt-3">
          <label htmlFor={`rr-${r.id}`} className="block text-xs text-t-phos-dim mb-1">
            {referralNeedsReason(moving, !!r.delivered_at) ? "What happened? (needed)" : "Anything to add? (optional)"}
          </label>
          <textarea id={`rr-${r.id}`} rows={2} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} className={field} />
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <label className="text-xs text-t-phos-dim">Next look (leave empty for the usual)
              <input type="date" value={due} onChange={(e) => setDue(e.target.value)} className="plain-field t-focus ml-2 border border-t-line bg-t-panel-2 px-2 py-1 text-xs text-t-phos" />
            </label>
            <button type="button" disabled={busy || (referralNeedsReason(moving, !!r.delivered_at) && reason.trim().length < 2)} onClick={() => go(moving)}
              className="t-focus min-h-touch bg-t-amber px-4 text-xs font-semibold text-[#14100a] disabled:opacity-50">{busy ? "Saving..." : REFERRAL_ACTION_LABELS[moving]}</button>
            <button type="button" onClick={() => { setMoving(null); setReason(""); }} className="t-focus text-xs text-t-phos-dim underline">Cancel</button>
          </div>
        </div>
      )}
      {msg && <p role="alert" className="mt-2 text-xs text-t-amber-bright">{msg}</p>}
      <button type="button" onClick={toggleHistory} className="t-focus mt-2 min-h-touch text-xs text-t-phos-dim underline underline-offset-4 hover:text-t-white">
        {history ? "Hide history" : "History"}
      </button>
      {history && (
        <ol className="mt-1 space-y-1 border-l border-t-line pl-3">
          {history.map((e) => (
            <li key={e.id} className="text-xs text-t-phos">
              <span className="text-t-phos-dim">{day(e.at)}{e.actor_name ? `, ${e.actor_name}` : ""}:</span>{" "}
              {e.from_status ? `${REFERRAL_STATUS_LABELS[e.from_status]} to ${REFERRAL_STATUS_LABELS[e.to_status].toLowerCase()}` : `Made (${REFERRAL_STATUS_LABELS[e.to_status].toLowerCase()})`}
              {e.status_reason ? `. ${e.status_reason}` : ""}{e.due_on ? `. Next look ${day(e.due_on)}` : ""}
            </li>
          ))}
        </ol>
      )}
    </li>
  );
}

interface Listing { service_id: string; label: string; city: string | null; state: string | null; phone: string | null; last_checked: string | null }

/** Make a referral for one person. */
function NewReferral({ clientId, first, userId, consentLine, onMade }: { clientId: string; first: string; userId: string | null; consentLine: string; onMade: () => void }) {
  const [kind, setKind] = useState<ReferralToKind>("directory_resource");
  const [q, setQ] = useState("");
  const [listings, setListings] = useState<Listing[]>([]);
  const [picked, setPicked] = useState<Listing | null>(null);
  const [toName, setToName] = useState("");
  const [reason, setReason] = useState("");
  const [send, setSend] = useState(true);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const draft = useAutosaveDraft({ userId, clientId, kind: "referral_reason", value: reason, setValue: setReason });

  useEffect(() => {
    if (kind !== "directory_resource" || q.trim().length < 2 || picked) { setListings([]); return; }
    const t = setTimeout(() => {
      fetch(`/api/org/referrals/directory?q=${encodeURIComponent(q.trim())}`).then((r) => (r.ok ? r.json() : { listings: [] })).then((d) => setListings(d.listings ?? [])).catch(() => setListings([]));
    }, 300);
    return () => clearTimeout(t);
  }, [q, kind, picked]);

  async function make(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setMsg(null);
    const res = await post({ action: "create", clientId, toKind: kind, resourceId: picked?.service_id ?? null, toName: kind === "directory_resource" ? null : toName, reason, send: kind !== "partner_org" && send });
    setBusy(false);
    if (!res.ok) { setMsg({ kind: "err", text: res.error ?? "That did not save." }); return; }
    draft.clear();
    setReason(""); setToName(""); setPicked(null); setQ("");
    setMsg({ kind: "ok", text: res.note || "Referral saved. It is on the list below with its next date." });
    onMade();
  }
  const ready = (kind === "directory_resource" ? !!picked : toName.trim().length >= 2) && !busy;
  return (
    <form onSubmit={make} className="bg-t-panel border border-t-line p-5 mb-5">
      <h3 className="font-semibold text-t-white mb-1">Refer {first} somewhere</h3>
      <p className="text-xs text-t-phos-dim mb-3">This keeps your organization&apos;s record of where they were sent and who follows up. It sends nothing to anyone.</p>
      <fieldset className="mb-3 flex flex-wrap gap-4 text-sm text-t-phos">
        <legend className="sr-only">Where to</legend>
        {([["directory_resource", "A listing in the help directory"], ["other", "Somewhere else"], ["partner_org", "A partner organization"]] as const).map(([v, l]) => (
          <label key={v} className="flex min-h-touch items-center gap-2"><input type="radio" name="refkind" className="t-focus" checked={kind === v} onChange={() => { setKind(v); setPicked(null); setMsg(null); }} />{l}</label>
        ))}
      </fieldset>
      {kind === "directory_resource" ? (
        picked ? (
          <p className="mb-3 text-sm text-t-white">{picked.label}{picked.city ? ` · ${picked.city}${picked.state ? `, ${picked.state}` : ""}` : ""}
            <button type="button" onClick={() => setPicked(null)} className="t-focus ml-3 text-xs text-t-phos-dim underline">Pick another</button></p>
        ) : (
          <div className="mb-3">
            <label htmlFor="ref-q" className="block text-xs text-t-phos-dim mb-1">Search the directory by name or town (never type the person&apos;s name here)</label>
            <input id="ref-q" value={q} onChange={(e) => setQ(e.target.value)} className={field} autoComplete="off" />
            {listings.length > 0 && (
              <ul className="mt-1 border border-t-line bg-t-panel-2">
                {listings.map((l) => (
                  <li key={l.service_id}>
                    <button type="button" onClick={() => setPicked(l)} className="t-focus block w-full min-h-touch px-3 py-2 text-left text-sm text-t-phos hover:bg-t-panel hover:text-t-white">
                      {l.label}<span className="text-xs text-t-phos-dim">{l.city ? ` · ${l.city}${l.state ? `, ${l.state}` : ""}` : ""}{l.last_checked ? ` · checked ${day(l.last_checked)}` : ""}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )
      ) : (
        <div className="mb-3">
          <label htmlFor="ref-to" className="block text-xs text-t-phos-dim mb-1">{kind === "partner_org" ? "Which organization" : "Where, or who"}</label>
          <input id="ref-to" value={toName} onChange={(e) => setToName(e.target.value)} maxLength={200} className={field} />
        </div>
      )}
      {kind === "partner_org" && <p className="mb-3 border border-t-line bg-t-panel-2 px-3 py-2 text-xs text-t-phos">{consentLine}</p>}
      <label htmlFor="ref-why" className="block text-xs text-t-phos-dim mb-1">What it is for (staff only)</label>
      <textarea id="ref-why" rows={2} maxLength={1000} value={reason} onChange={(e) => setReason(e.target.value)} onBlur={draft.onBlur} className={field}
        placeholder="Work boots before the first shift" />
      <DraftStatus restoredAt={draft.restoredAt} statusText={draft.statusText} onStartOver={() => { setReason(""); draft.clear(); }} onDismiss={draft.dismissRestored} />
      <p className="mt-1 text-[11px] text-t-phos-dim">Do not record diagnoses, treatment, medication or anything from a court file here.</p>
      {kind !== "partner_org" && (
        <label className="mt-3 flex min-h-touch items-center gap-2 text-xs text-t-phos-dim">
          <input type="checkbox" className="t-focus" checked={send} onChange={(e) => setSend(e.target.checked)} />
          Already made the call or handed them the number: mark it sent
        </label>
      )}
      <button disabled={!ready} className="t-focus mt-3 min-h-touch bg-t-amber px-4 text-sm font-semibold text-[#14100a] disabled:opacity-50">{busy ? "Saving..." : "Save referral"}</button>
      {msg && <p role={msg.kind === "err" ? "alert" : "status"} className={`mt-2 text-xs ${msg.kind === "err" ? "text-t-amber-bright" : "text-t-phos"}`}>{msg.text}</p>}
    </form>
  );
}

/** The person page's Referrals tab. */
export function ReferralsPanel({ clientId, first, userId }: { clientId: string; first: string; userId: string | null }) {
  const { data, failed, reload } = useReferrals({ clientId, filter: "all" });
  if (failed) return <p role="alert" className="text-sm text-t-white">Referrals did not load. <button type="button" onClick={reload} className="t-focus underline">Try again</button></p>;
  if (!data) return <p className="text-sm text-t-phos-dim">Getting referrals...</p>;
  return (
    <section>
      {data.canWrite && <NewReferral clientId={clientId} first={first} userId={userId} consentLine={data.options.partnerConsentLine} onMade={reload} />}
      {data.referrals.length === 0 ? <p className="text-sm text-t-phos-dim">No referrals yet. When you send {first} somewhere for help, record it here so someone follows up.</p> : (
        <ul className="space-y-2">
          {data.referrals.map((r) => <ReferralCard key={r.id} r={r} canWrite={data.canWrite} owners={data.owners} consentLine={data.options.partnerConsentLine} onChange={reload} />)}
        </ul>
      )}
    </section>
  );
}

const FILTERS: { key: string; label: string }[] = [
  { key: "open", label: "Open" }, { key: "overdue", label: "Past due" }, { key: "draft", label: "Drafts" }, { key: "sent", label: "Waiting on an answer" },
  { key: "service_delivered", label: "Help given, not closed" }, { key: "closed", label: "Closed" }, { key: "all", label: "All" },
];

/** The organization's referrals, filtered by status, mine or everyone I reach. */
export function ReferralsPage() {
  const [filter, setFilter] = useState("open");
  const [mine, setMine] = useState(true);
  const { data, failed, reload } = useReferrals({ filter, ...(mine ? { mine: "1" } : {}) });
  return (
    <div className="max-w-5xl mx-auto px-4 py-6">
      <h1 className="text-xl font-semibold text-t-white">Referrals</h1>
      <p className="mt-1 mb-4 text-sm text-t-phos-dim">Where people were sent for help, who is following up, and what came of it. A referral is not done until someone records what happened.</p>
      <div role="group" aria-label="Show" className="mb-3 flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <button key={f.key} type="button" aria-pressed={filter === f.key} onClick={() => setFilter(f.key)}
            className={`t-focus min-h-touch rounded-[4px] border px-3 text-xs ${filter === f.key ? "border-t-amber text-t-white font-semibold" : "border-t-line text-t-phos-dim hover:text-t-white"}`}>{f.label}</button>
        ))}
      </div>
      <label className="mb-4 flex min-h-touch items-center gap-2 text-xs text-t-phos-dim">
        <input type="checkbox" className="t-focus" checked={mine} onChange={(e) => setMine(e.target.checked)} /> Only the ones I own
      </label>
      {failed ? <p role="alert" className="text-sm text-t-white">Referrals did not load. <button type="button" onClick={reload} className="t-focus underline">Try again</button></p>
        : !data ? <p className="text-sm text-t-phos-dim">Getting referrals...</p>
        : data.referrals.length === 0 ? <p className="text-sm text-t-phos-dim">{filter === "overdue" ? "Nothing past due." : "No referrals here."} New referrals are made from a person&apos;s page, under Referrals.</p>
        : (
          <ul className="space-y-2">
            {data.referrals.map((r) => <ReferralCard key={r.id} r={r} canWrite={data.canWrite} owners={data.owners} showPerson consentLine={data.options.partnerConsentLine} onChange={reload} />)}
          </ul>
        )}
    </div>
  );
}
