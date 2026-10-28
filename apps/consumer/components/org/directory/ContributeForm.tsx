"use client";

/**
 * <ContributeForm> -- one staff update to the shared employer and resource
 * directory (migration 112, lane S6). Four flows: a place we are missing, a
 * correction, "I checked with them", "I know someone who hires there".
 *
 * Everything goes to the SMR data owner's review queue; nothing publishes on
 * its own. The form has no field for a participant. The private box is for a
 * person's name or number, which is never published. Sending is the staff
 * member's click; t.ROY's draft card (draft_directory_contribution) opens this
 * form prefilled through `initial` (WIRING NEEDED for lane S1).
 */
import { useState } from "react";
import {
  CONTACT_METHODS, DOCUMENTED_METHODS, FLOW_LABELS, METHOD_LABELS, normalizeContribution,
  type ContactMethod, type ContributionFlow, type ContributionKind,
} from "@crucible/core/src/directoryContributionShared";

export interface ContributeInitial {
  flow?: ContributionFlow; targetKind?: ContributionKind; targetId?: string | null; name?: string | null;
  city?: string; state?: string; website?: string; phone?: string; change?: string; said?: string;
  interactionOn?: string | null; interactionMethod?: ContactMethod | null;
}

/**
 * The t.ROY draft card (draft_directory_contribution) as this form's starting
 * values. draftBody is the claim-checked wording; it goes in "said" or
 * "change". The staff member still checks everything and presses Send.
 */
export function initialFromDraft(card: {
  flow: ContributionFlow; targetKind: ContributionKind; listingId: string | null;
  fields: { name?: string; city?: string; state?: string; website?: string; phone?: string };
  interactionOn: string | null; interactionMethod: ContactMethod | null; draftBodyField: "said" | "change" | null;
}, draftBody: string | null): ContributeInitial {
  return {
    flow: card.flow, targetKind: card.targetKind, targetId: card.listingId, ...card.fields,
    interactionOn: card.interactionOn, interactionMethod: card.interactionMethod,
    ...(card.draftBodyField && draftBody ? { [card.draftBodyField]: draftBody } : {}),
  };
}

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const field = "t-focus block w-full mt-1 border border-t-line bg-t-bg p-2";

export function ContributeForm({ initial = {}, flows, onDone, onCancel }: {
  initial?: ContributeInitial; flows?: ContributionFlow[]; onDone?: (id: string) => void; onCancel?: () => void;
}) {
  const listed = !!initial.targetId;
  const allowed = flows ?? (listed ? (["called_today", "correction", ...(initial.targetKind === "employer" ? ["knows_someone"] : [])] as ContributionFlow[]) : ["new_place"]);
  const [flow, setFlow] = useState<ContributionFlow>(initial.flow && allowed.includes(initial.flow) ? initial.flow : allowed[0]);
  const [kind, setKind] = useState<ContributionKind>(initial.targetKind ?? "employer");
  const [d, setD] = useState({
    name: initial.name ?? "", city: initial.city ?? "", state: initial.state ?? "", website: initial.website ?? "",
    phone: initial.phone ?? "", change: initial.change ?? "", said: initial.said ?? "",
  });
  const [on, setOn] = useState(initial.interactionOn ?? today());
  const [method, setMethod] = useState<ContactMethod | "">(initial.interactionMethod ?? (flow === "called_today" ? "phone_call" : ""));
  const [privateNote, setPrivateNote] = useState("");
  const [creditPerson, setCreditPerson] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const set = (k: keyof typeof d) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setD({ ...d, [k]: e.target.value });

  const payload = () => ({
    flow, targetKind: flow === "knows_someone" ? "employer" : kind, targetId: listed ? initial.targetId : null,
    details: flow === "new_place" ? { name: d.name, city: d.city, state: d.state.toUpperCase(), website: d.website, phone: d.phone }
      : flow === "correction" ? { name: initial.name ?? undefined, change: d.change }
      : flow === "called_today" ? { name: initial.name ?? undefined, said: d.said }
      : { name: listed ? initial.name ?? undefined : d.name },
    interactionOn: flow === "called_today" ? on : null,
    interactionMethod: flow === "called_today" ? (method || null) : (flow === "correction" && method ? method : null),
    privateNote: flow === "knows_someone" || flow === "called_today" ? privateNote || null : null,
    creditPersonOk: creditPerson,
  });

  async function send(e: React.FormEvent) {
    e.preventDefault();
    setMsg("");
    const p = payload();
    const check = normalizeContribution(p, today());
    if (!check.ok) { setMsg(check.error); return; }
    setBusy(true);
    try {
      const res = await fetch("/api/org/directory-contributions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(p) });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error || "That did not send.");
      setMsg(body.earlier ? "You already sent this today. We kept your first one, and it is waiting for review." : "Sent for review. Thank you. You will see the answer under Help the directory.");
      onDone?.(body.id);
    } catch (err) {
      setMsg(err instanceof Error ? err.message : "That did not send.");
    } finally { setBusy(false); }
  }

  return (
    <form onSubmit={send} className="border border-t-line rounded-[4px] p-4 space-y-3 max-w-xl" aria-label="Update the directory">
      {allowed.length > 1 && (
        <fieldset><legend className="text-sm font-semibold text-t-white">What is this about?</legend>
          <div className="mt-1 flex flex-wrap gap-3">{allowed.map((f) => (
            <label key={f} className="flex items-center gap-2 text-sm min-h-[44px]">
              <input type="radio" name="contribution-flow" className="t-focus" checked={flow === f} onChange={() => { setFlow(f); if (f === "called_today" && !method) setMethod("phone_call"); }} />
              {FLOW_LABELS[f].title}
            </label>))}
          </div>
        </fieldset>
      )}
      <p className="text-sm text-t-phos-dim">{FLOW_LABELS[flow].help}{initial.name && listed ? ` About: ${initial.name}.` : ""}</p>

      {flow === "new_place" && (<>
        <fieldset className="flex gap-4"><legend className="sr-only">Kind of place</legend>
          <label className="flex items-center gap-2 text-sm min-h-[44px]"><input type="radio" name="contribution-kind" className="t-focus" checked={kind === "employer"} onChange={() => setKind("employer")} />An employer</label>
          <label className="flex items-center gap-2 text-sm min-h-[44px]"><input type="radio" name="contribution-kind" className="t-focus" checked={kind === "resource"} onChange={() => setKind("resource")} />A local help program</label>
        </fieldset>
        <label className="block text-sm">Name<input required maxLength={200} value={d.name} onChange={set("name")} className={field} /></label>
        <div className="flex gap-3">
          <label className="block text-sm flex-1">City<input maxLength={200} value={d.city} onChange={set("city")} className={field} /></label>
          <label className="block text-sm w-24">State<input required maxLength={2} pattern="[A-Za-z]{2}" value={d.state} onChange={set("state")} className={field} /></label>
        </div>
        <label className="block text-sm">Website (optional)<input type="url" maxLength={200} value={d.website} onChange={set("website")} className={field} placeholder="https://" /></label>
        <label className="block text-sm">Main phone (the organization&apos;s line, optional)<input maxLength={30} value={d.phone} onChange={set("phone")} className={field} /></label>
      </>)}

      {flow === "correction" && (<>
        <label className="block text-sm">What should change?<textarea required maxLength={600} rows={3} value={d.change} onChange={set("change")} className={field} placeholder="They moved to 12 Pine St. The phone is now the front desk line." /></label>
        <label className="block text-sm">How do you know? (optional)
          <select value={method} onChange={(e) => setMethod(e.target.value as ContactMethod)} className={field}>
            <option value="">Pick one</option>
            {CONTACT_METHODS.map((m) => <option key={m} value={m}>{METHOD_LABELS[m]}</option>)}
          </select>
        </label>
      </>)}

      {flow === "called_today" && (<>
        <div className="flex flex-wrap gap-3">
          <label className="block text-sm">When<input type="date" required value={on} max={today()} onChange={(e) => setOn(e.target.value)} className={field} /></label>
          <label className="block text-sm flex-1">How
            <select required value={method} onChange={(e) => setMethod(e.target.value as ContactMethod)} className={field}>
              {DOCUMENTED_METHODS.map((m) => <option key={m} value={m}>{METHOD_LABELS[m]}</option>)}
            </select>
          </label>
        </div>
        <label className="block text-sm">What did they say?<textarea required maxLength={600} rows={3} value={d.said} onChange={set("said")} className={field} placeholder="Still open Tuesdays 9 to 1. No ID needed the first visit." /></label>
        <label className="block text-sm">Who you talked to (private, optional)
          <input maxLength={1000} value={privateNote} onChange={(e) => setPrivateNote(e.target.value)} className={field} placeholder="Only the directory owner sees this. Never published." />
        </label>
      </>)}

      {flow === "knows_someone" && (<>
        {!listed && <label className="block text-sm">Which employer?<input required maxLength={200} value={d.name} onChange={set("name")} className={field} /></label>}
        <label className="block text-sm">Who you know there, and how to reach them (private)
          <textarea required maxLength={1000} rows={2} value={privateNote} onChange={(e) => setPrivateNote(e.target.value)} className={field} placeholder="Only the directory owner sees this. We never publish a person's name or number." />
        </label>
      </>)}

      <label className="flex items-start gap-2 text-xs text-t-phos-dim">
        <input type="checkbox" className="t-focus mt-0.5" checked={creditPerson} onChange={(e) => setCreditPerson(e.target.checked)} />
        If this is ever credited, my name may be used with my program&apos;s. (Off: only the program.)
      </label>
      <div className="flex gap-3">
        <button type="submit" disabled={busy} className="t-focus min-h-[44px] px-4 text-sm font-semibold bg-t-amber text-[#14100a] rounded-[4px] disabled:opacity-60">Send for review</button>
        {onCancel && <button type="button" onClick={onCancel} className="t-focus min-h-[44px] px-3 text-sm underline underline-offset-4">Cancel</button>}
      </div>
      <p className="text-xs text-t-phos-dim">Nothing goes on the public directory until it is reviewed. Leave out anyone on your caseload and anything about a record.</p>
      {msg && <p role="status" className="text-sm text-t-phos">{msg}</p>}
    </form>
  );
}
