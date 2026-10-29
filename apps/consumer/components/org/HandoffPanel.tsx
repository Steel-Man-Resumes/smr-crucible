"use client";
/**
 * <HandoffPanel> (staff pass S5): on a person's page, collect what is worth
 * their time and send it to them as one handoff: a short note plus up to ten
 * things (an employer with the hiring mark, a place for help, a next step).
 *
 * Things arrive from the directory picker here, from "Send to <first name>"
 * buttons elsewhere (connections, the directory, a t.ROY answer) through the
 * tab's handoff tray, or from a t.ROY draft. Nothing is sent until the staff
 * member reads it and presses Send. Below: what was sent before, and each
 * answer (waiting, taken, passed). Nothing else about the person comes back.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  HANDOFF_MAX_ITEMS, HANDOFF_NOTE_MAX, HANDOFF_STATUS_WORDS, ITEM_STATUS_WORDS, sendToLabel, type HandoffItemInput,
} from "@crucible/core/src/staffHandoffShared";
import { ListingContributeMenu } from "@/components/org/directory/ListingContributeMenu";
import { askListingNudge } from "@/lib/listing-nudge-client";
import { addToTray, clearTray, itemKey, readTray, removeFromTray, trayOwner, updateTrayItem, TRAY_EVENT, type Tray } from "@/lib/handoff-tray";
import { useEffectiveRole } from "@/components/RoleProvider";
import { dayWords, evidenceWords, whenWords } from "@/lib/handoff-words";

interface ItemView { id: string; kind: string; status: "open" | "saved" | "dismissed" | "withdrawn"; title: string; why: string; due_on: string | null }
interface HandoffView {
  id: string; note: string; status: "sent" | "seen" | "withdrawn"; drafted_by_assistant: boolean; created_at: string; seen_at: string | null;
  author_name: string | null; items: ItemView[]; canWithdraw: boolean;
}
interface DirResult { kind: "employer" | "resource"; id: string; name: string; location: string | null; roleTypes?: string | null; applyUrl?: string | null; area?: string; band?: string | null; bandLine: string; checkedAt: string | null }

/** The listing's standing and date, said once ("Checked Oct 22, 2026", never "Checked. checked Oct 22"). */
export function resultStanding(r: DirResult): string {
  if (r.band !== undefined) return evidenceWords(r.kind, r.band, r.checkedAt);
  return r.kind === "employer" && r.checkedAt ? `${r.bandLine}, checked ${dayWords(r.checkedAt)}` : r.bandLine;
}

const field = "plain-field t-focus w-full bg-t-panel-2 border border-t-line text-sm text-t-white px-3 py-2";
const small = "t-focus text-xs text-t-amber-bright underline underline-offset-4";

/** The first role word from a listing's role types ("forklift, warehouse" -> "Forklift"). */
export function firstRole(roleTypes: string | null | undefined, fallback = ""): string {
  const t = String(roleTypes ?? "").split(/[,;/]/)[0]?.trim() ?? "";
  return t ? (t[0].toUpperCase() + t.slice(1)).slice(0, 200) : fallback;
}

/** The directory item a result becomes. The why line starts from the listing's own standing. */
export function resultToItem(r: DirResult, roleHint: string): HandoffItemInput {
  if (r.kind === "employer") {
    return { kind: "employer", employerId: r.id, name: r.name, role: firstRole(r.roleTypes, roleHint) || roleHint || "Open roles", location: r.location, applyUrl: r.applyUrl ?? null,
      why: `${resultStanding(r)}.` };
  }
  return { kind: "resource", resourceId: r.id, name: r.name, why: `${r.area ?? "Help"} near ${r.location || "you"}. ${r.bandLine}.` };
}

function itemLabel(it: HandoffItemInput): string {
  if (it.kind === "employer") return `${it.role} at ${it.name}`;
  if (it.kind === "resource") return it.name;
  if (it.kind === "next_step") return it.step;
  return `${it.jobTitle} at ${it.company}`;
}
const KIND_WORDS: Record<string, string> = { employer: "Employer", resource: "Place for help", next_step: "Next step", job: "Job" };

export function HandoffPanel({ clientId, first, viewerId, canSend: canSendProp }: { clientId: string; first: string; viewerId: string | null; canSend?: boolean }) {
  const [handoffs, setHandoffs] = useState<HandoffView[] | null>(null);
  const [canSend, setCanSend] = useState<boolean>(!!canSendProp);
  const [failed, setFailed] = useState(false);
  const [tray, setTray] = useState<Tray>({ items: [], updatedAt: 0 });
  const [nudge, setNudge] = useState<{ kind: "employer" | "resource"; id: string; name: string; line: string } | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const label = sendToLabel(first);
  // The tray is keyed by organization, staff member and person (review r1 #5).
  const owner = trayOwner(useEffectiveRole()?.orgId ?? null, viewerId);

  const load = useCallback(async () => {
    setFailed(false);
    try {
      const res = await fetch(`/api/org/clients/${clientId}/handoffs`, { cache: "no-store" });
      if (!res.ok) throw new Error();
      const d = await res.json();
      setHandoffs(d.handoffs ?? []); setCanSend(!!d.canSend);
    } catch { setFailed(true); }
  }, [clientId]);
  useEffect(() => { load(); }, [load]);

  const refreshTray = useCallback(() => {
    if (!owner) return;
    const t = readTray(owner, clientId);
    setTray(t);
    if (t.note && !note) setNote(t.note);
  }, [owner, clientId, note]);
  useEffect(() => {
    refreshTray();
    const on = () => refreshTray();
    window.addEventListener(TRAY_EVENT, on);
    return () => window.removeEventListener(TRAY_EVENT, on);
  }, [refreshTray]);

  async function send() {
    if (!owner) return;
    setBusy(true); setMsg(null);
    try {
      const res = await fetch(`/api/org/clients/${clientId}/handoffs`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "send", note, items: tray.items, draftedByAssistant: !!tray.draftedByAssistant }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { setMsg(d.error || "That did not send. Nothing went to them. Try again."); return; }
      const sent = tray.items;
      clearTray(owner, clientId); setNote(""); setMsg(`Sent. ${first} will see it on their dashboard and can take or pass on each one.`);
      // S6: ask once about the first listed place in what was sent (at most once a week per listing).
      setNudge(null);
      const listed = sent.find((it) => it.kind === "employer" || it.kind === "resource");
      if (listed) {
        const ref = listed.kind === "employer" ? { kind: "employer" as const, id: listed.employerId, name: listed.name } : listed.kind === "resource" ? { kind: "resource" as const, id: listed.resourceId, name: listed.name } : null;
        if (ref) askListingNudge(ref.kind, ref.id).then((line) => { if (line) setNudge({ ...ref, line }); });
      }
      load();
    } catch { setMsg("That did not send. Check the connection and try again."); }
    finally { setBusy(false); }
  }

  async function withdraw(id: string) {
    setMsg(null);
    const res = await fetch(`/api/org/clients/${clientId}/handoffs`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "withdraw", handoffId: id }) }).catch(() => null);
    if (!res?.ok) { const d = await res?.json().catch(() => ({})); setMsg(d?.error || "That did not withdraw. Try again."); return; }
    load();
  }

  return (
    <section id="handoff" aria-labelledby="handoff-h" className="bg-t-panel border border-t-line p-5 mt-6">
      <h2 id="handoff-h" className="font-semibold text-t-white">Send to {first}</h2>
      <p className="text-xs text-t-phos-dim mt-1">
        A short note and a few things worth their time. {first} sees it on their dashboard and decides about each one. You see whether they opened it, and whether they took or passed on each one. Nothing else comes back.
      </p>

      {canSend && owner ? (
        <div className="mt-4 space-y-4">
          {tray.draftedByAssistant && (
            <p className="text-xs text-t-amber-bright border-l-2 border-t-amber pl-2">Drafted with t.ROY. Read every line before you send it.</p>
          )}
          {tray.items.length === 0 ? (
            <p className="text-sm text-t-phos-dim">Nothing picked yet. Add an employer or a place for help from the directory below, a next step, or use a {`"${label}"`} button on a connection.</p>
          ) : (
            <ol className="space-y-3">
              {tray.items.map((it) => <TrayItem key={itemKey(it)} it={it} onChange={(next) => updateTrayItem(owner, clientId, itemKey(it), next)} onRemove={() => removeFromTray(owner, clientId, itemKey(it))} />)}
            </ol>
          )}
          <DirectoryPicker disabled={tray.items.length >= HANDOFF_MAX_ITEMS} onAdd={(it) => { const r = addToTray(owner, clientId, it); setMsg(r === "already" ? "That one is already picked." : r === "full" ? `A handoff holds at most ${HANDOFF_MAX_ITEMS} things.` : r === "unavailable" ? "This browser tab could not keep it. Try again." : null); }} />
          <StepAdder onAdd={(it) => { const r = addToTray(owner, clientId, it); setMsg(r === "already" ? "That step is already picked." : r === "full" ? `A handoff holds at most ${HANDOFF_MAX_ITEMS} things.` : null); }} />
          <label className="block">
            <span className="text-xs font-semibold text-t-phos">Your note to {first}</span>
            <textarea className={`${field} mt-1`} rows={3} maxLength={HANDOFF_NOTE_MAX} value={note} onChange={(e) => setNote(e.target.value)}
              placeholder={`${first}, I found a few things that fit what you are going for.`} />
          </label>
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" disabled={busy || tray.items.length === 0 || note.trim().length < 3} onClick={send}
              className="t-focus bg-t-amber text-[#14100a] text-sm font-semibold px-4 py-2 disabled:opacity-50">{busy ? "Sending..." : label}</button>
            {tray.items.length > 0 && <button type="button" className={small} onClick={() => { clearTray(owner, clientId); setNote(""); }}>Clear</button>}
          </div>
        </div>
      ) : (
        <p className="text-sm text-t-phos-dim mt-3">Your role can see what was sent but cannot send. Ask the person who runs your program if you need to.</p>
      )}
      {msg && <p role="status" className="text-sm text-t-phos mt-3">{msg}</p>}
      {nudge && <div className="mt-2"><ListingContributeMenu kind={nudge.kind} id={nudge.id} name={nudge.name} nudgeLine={nudge.line} /></div>}

      <h3 className="text-xs font-semibold uppercase tracking-wide text-t-phos-dim mt-6 mb-2">Sent before</h3>
      {failed ? (
        <p className="text-sm text-t-phos-dim">This did not load. <button type="button" className={small} onClick={load}>Try again</button></p>
      ) : !handoffs ? (
        <p className="text-sm text-t-phos-dim">Loading...</p>
      ) : handoffs.length === 0 ? (
        <p className="text-sm text-t-phos-dim">Nothing sent to {first} yet.</p>
      ) : (
        <ul className="space-y-4">
          {handoffs.map((h) => (
            <li key={h.id} className="border-l-2 border-t-line pl-3">
              <p className="text-xs text-t-phos-dim">
                {whenWords(h.created_at)}{h.author_name ? `, from ${h.author_name}` : ""}{h.drafted_by_assistant ? ", drafted with t.ROY" : ""}. {HANDOFF_STATUS_WORDS[h.status]}.
              </p>
              <p className="text-sm text-t-white mt-1 whitespace-pre-line">{h.note}</p>
              <ul className="mt-2 space-y-1">
                {h.items.map((i) => (
                  <li key={i.id} className="text-sm text-t-phos">
                    <span className="text-t-phos-dim">{KIND_WORDS[i.kind] ?? "Item"}:</span> {i.title}
                    <span className="ml-2 text-xs font-semibold text-t-amber-bright">{ITEM_STATUS_WORDS[i.status]}</span>
                  </li>
                ))}
              </ul>
              {h.canWithdraw && <button type="button" className={`${small} mt-2`} onClick={() => withdraw(h.id)}>Withdraw what is still waiting</button>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function TrayItem({ it, onChange, onRemove }: { it: HandoffItemInput; onChange: (next: HandoffItemInput) => void; onRemove: () => void }) {
  return (
    <li className="border border-t-line p-3">
      <p className="text-sm text-t-white"><span className="text-t-phos-dim">{KIND_WORDS[it.kind]}:</span> {itemLabel(it)}</p>
      {it.kind === "employer" && (
        <label className="block mt-2">
          <span className="text-xs text-t-phos-dim">Kind of job to look at there (goes on their saved jobs)</span>
          <input className={`${field} mt-1`} maxLength={200} value={it.role} onChange={(e) => onChange({ ...it, role: e.target.value })} />
        </label>
      )}
      <label className="block mt-2">
        <span className="text-xs text-t-phos-dim">Why it might help (they read this)</span>
        <textarea className={`${field} mt-1`} rows={2} maxLength={1500} value={it.why} onChange={(e) => onChange({ ...it, why: e.target.value })} />
      </label>
      <button type="button" className={`${small} mt-2`} onClick={onRemove}>Take it out</button>
    </li>
  );
}

function DirectoryPicker({ onAdd, disabled }: { onAdd: (it: HandoffItemInput) => void; disabled: boolean }) {
  const [kind, setKind] = useState<"employer" | "resource">("employer");
  const [q, setQ] = useState(""); const [state, setState] = useState(""); const [city, setCity] = useState(""); const [area, setArea] = useState("jobs");
  const [results, setResults] = useState<DirResult[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const qs = useMemo(() => new URLSearchParams(kind === "employer" ? { kind, q, state } : { kind, state, city, area }).toString(), [kind, q, state, city, area]);
  async function search(e: React.FormEvent) {
    e.preventDefault(); setErr(null);
    const res = await fetch(`/api/org/handoffs/directory?${qs}`).catch(() => null);
    const d = await res?.json().catch(() => ({}));
    if (!res?.ok) { setErr(d?.error || "The directory did not load. Try again."); setResults(null); return; }
    setResults(d.results ?? []);
  }
  return (
    <details className="border border-t-line p-3">
      <summary className="t-focus cursor-pointer text-sm font-semibold text-t-phos">Add from the directory</summary>
      <form onSubmit={search} className="mt-3 grid gap-2 sm:grid-cols-[auto_1fr_5rem_auto] items-end">
        <select className={field} value={kind} onChange={(e) => { setKind(e.target.value as "employer" | "resource"); setResults(null); }} aria-label="What to look for">
          <option value="employer">Employers</option><option value="resource">Places for help</option>
        </select>
        {kind === "employer" ? (
          <input className={field} placeholder="Kind of work, like forklift" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Kind of work" />
        ) : (
          <div className="grid grid-cols-2 gap-2">
            <input className={field} placeholder="City" value={city} onChange={(e) => setCity(e.target.value)} aria-label="City" />
            <select className={field} value={area} onChange={(e) => setArea(e.target.value)} aria-label="Kind of help">
              <option value="jobs">Job help</option><option value="training">Training</option><option value="id_documents">ID and papers</option>
              <option value="transportation">Getting there</option><option value="clothing">Work clothes</option><option value="education">School</option>
            </select>
          </div>
        )}
        <input className={field} placeholder="State" maxLength={2} value={state} onChange={(e) => setState(e.target.value.toUpperCase())} aria-label="State, two letters" />
        <button type="submit" className="t-focus border border-t-line text-sm text-t-phos px-3 py-2">Look</button>
      </form>
      {err && <p role="status" className="text-sm text-t-phos mt-2">{err}</p>}
      {results && (results.length === 0 ? <p className="text-sm text-t-phos-dim mt-2">Nothing listed for that yet.</p> : (
        <ul className="mt-3 space-y-2">
          {results.map((r) => (
            <li key={r.id} className="flex items-start justify-between gap-3 text-sm">
              <span className="text-t-white">{r.name}<span className="block text-xs text-t-phos-dim">{[r.location, resultStanding(r)].filter(Boolean).join(". ")}</span></span>
              <button type="button" disabled={disabled} className="t-focus shrink-0 border border-t-line text-xs text-t-phos px-2 py-1 disabled:opacity-50" onClick={() => onAdd(resultToItem(r, q.trim()))}>Add</button>
            </li>
          ))}
        </ul>
      ))}
    </details>
  );
}

function StepAdder({ onAdd }: { onAdd: (it: HandoffItemInput) => void }) {
  const [step, setStep] = useState(""); const [due, setDue] = useState(""); const [why, setWhy] = useState("");
  return (
    <details className="border border-t-line p-3">
      <summary className="t-focus cursor-pointer text-sm font-semibold text-t-phos">Add a next step</summary>
      <div className="mt-3 grid gap-2">
        <input className={field} maxLength={200} placeholder="Bring your state ID on Tuesday" value={step} onChange={(e) => setStep(e.target.value)} aria-label="The next step" />
        <input className={field} type="date" value={due} onChange={(e) => setDue(e.target.value)} aria-label="By when (optional)" />
        <textarea className={field} rows={2} maxLength={1500} placeholder="Why it helps" value={why} onChange={(e) => setWhy(e.target.value)} aria-label="Why it helps" />
        <p className="text-xs text-t-phos-dim">If they take it, it goes on their list from you, where they can tick it off.</p>
        <button type="button" disabled={step.trim().length < 2 || why.trim().length < 3} className="t-focus justify-self-start border border-t-line text-sm text-t-phos px-3 py-1.5 disabled:opacity-50"
          onClick={() => { onAdd({ kind: "next_step", step: step.trim(), dueOn: due || null, why: why.trim() }); setStep(""); setDue(""); setWhy(""); }}>Add</button>
      </div>
    </details>
  );
}
