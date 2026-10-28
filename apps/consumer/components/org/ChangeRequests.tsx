"use client";
/**
 * Change requests (staff side lane S4, migration 109): staff ask the owner and
 * admins for a change to how the organization's Refinery works; the owner and
 * admins answer from a queue; both sides reply. Every step lands in the other
 * side's Inbox. Nothing is emailed or texted.
 *
 * <SuggestChangeForm target="/dashboard/today" onDone={...} />
 *     the form on its own, for "Suggest a change to your organization" on
 *     My setup (S2) or anywhere a locked setting is explained.
 * <ChangeRequestsPage />
 *     /dashboard/change-requests: the form, your requests, and (owner and
 *     admins) the requests waiting for an answer.
 */
import { useCallback, useEffect, useState } from "react";
import {
  CHANGE_REQUEST_KINDS, CHANGE_REQUEST_KIND_LABELS, CHANGE_REQUEST_STATUS_LABELS, CHANGE_REQUEST_ACTION_LABELS, CHANGE_REQUEST_TRANSITIONS,
  CHANGE_REQUEST_CARE_LINE, CHANGE_TITLE_MAX, CHANGE_BODY_MAX, type ChangeRequestKind, type ChangeRequestStatus,
} from "@crucible/core/src/teamTalkShared";

interface RequestView {
  id: string; kind: ChangeRequestKind; title: string; body: string | null; target: string | null; status: ChangeRequestStatus; answer: string | null;
  requested_by: string | null; requested_by_name: string | null; answered_by_name: string | null; answered_at: string | null;
  created_at: string; updated_at: string; reply_count: number; mine: boolean;
}
interface ReplyView { id: string; author_user_id: string | null; author_name: string | null; body: string; created_at: string }
interface Payload { requests: RequestView[]; view: "mine" | "queue"; manager: boolean; me: string; canWrite: boolean }

const field = "plain-field t-focus w-full bg-t-panel-2 border border-t-line text-sm text-t-white px-3 py-2";
const day = (s: string) => new Date(s).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });

async function post(body: Record<string, unknown>): Promise<string | null> {
  try {
    const res = await fetch("/api/org/change-requests", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    if (res.ok) return null;
    return (await res.json().catch(() => ({}))).error || "That did not save.";
  } catch { return "That did not save. Check the connection and try again."; }
}

export function SuggestChangeForm({ target, defaultKind = "other", onDone }: { target?: string; defaultKind?: ChangeRequestKind; onDone?: () => void }) {
  const [kind, setKind] = useState<ChangeRequestKind>(defaultKind);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  async function send() {
    setBusy(true); setMsg(null);
    const err = await post({ action: "create", kind, title, body, target: target ?? (typeof window !== "undefined" ? window.location.pathname : null) });
    setBusy(false);
    if (err) { setMsg(err); return; }
    setSent(true); setTitle(""); setBody(""); onDone?.();
  }
  return (
    <form onSubmit={(e) => { e.preventDefault(); send(); }} className="border border-t-line bg-t-panel p-4">
      <h2 className="text-sm font-semibold text-t-white">Suggest a change to your organization</h2>
      <p className="mt-1 mb-3 text-xs text-t-phos-dim">{CHANGE_REQUEST_CARE_LINE} Their answer comes to your Inbox.</p>
      <label htmlFor="cr-kind" className="mb-1 block text-xs text-t-phos-dim">What is it about?</label>
      <select id="cr-kind" value={kind} onChange={(e) => setKind(e.target.value as ChangeRequestKind)} className={`${field} mb-3`}>
        {CHANGE_REQUEST_KINDS.map((k) => <option key={k} value={k}>{CHANGE_REQUEST_KIND_LABELS[k]}</option>)}
      </select>
      <label htmlFor="cr-title" className="mb-1 block text-xs text-t-phos-dim">In a line, what would you change?</label>
      <input id="cr-title" value={title} onChange={(e) => { setTitle(e.target.value); setSent(false); }} maxLength={CHANGE_TITLE_MAX} placeholder="Add a field for work boot size" className={`${field} mb-3`} />
      <label htmlFor="cr-body" className="mb-1 block text-xs text-t-phos-dim">Why it would help (optional)</label>
      <textarea id="cr-body" rows={3} value={body} onChange={(e) => setBody(e.target.value)} maxLength={CHANGE_BODY_MAX} className={field} />
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button disabled={busy || title.trim().length < 3} className="t-focus min-h-touch bg-t-amber px-4 text-sm font-semibold text-[#14100a] disabled:opacity-50">{busy ? "Sending..." : "Send the suggestion"}</button>
        {sent && <span role="status" className="text-xs text-t-phos">Sent. You will see the answer in your Inbox.</span>}
      </div>
      {msg && <p role="alert" className="mt-2 text-xs text-t-amber-bright">{msg}</p>}
    </form>
  );
}

function RequestCard({ r, manager, canWrite, onChange }: { r: RequestView; manager: boolean; canWrite: boolean; onChange: () => void }) {
  const [open, setOpen] = useState(false);
  const [replies, setReplies] = useState<ReplyView[] | null>(null);
  const [reply, setReply] = useState("");
  const [moving, setMoving] = useState<ChangeRequestStatus | null>(null);
  const [answer, setAnswer] = useState(r.answer ?? "");
  const [msg, setMsg] = useState<string | null>(null);
  const loadReplies = useCallback(async () => {
    const res = await fetch(`/api/org/change-requests?id=${r.id}`).catch(() => null);
    const d = res && res.ok ? await res.json() : null;
    setReplies(d?.replies ?? []);
  }, [r.id]);
  useEffect(() => { if (open && replies === null) loadReplies(); }, [open, replies, loadReplies]);
  const act = async (body: Record<string, unknown>, after?: () => void) => { setMsg(null); const err = await post(body); if (err) setMsg(err); else { after?.(); onChange(); } };
  const next = CHANGE_REQUEST_TRANSITIONS[r.status];
  return (
    <li id={`cr-${r.id}`} className="scroll-mt-24 border border-t-line bg-t-panel p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-t-white">{r.title}</p>
          <p className="text-xs text-t-phos-dim">{CHANGE_REQUEST_KIND_LABELS[r.kind]} · {r.mine ? "You asked" : `${r.requested_by_name || "Someone who has left the team"} asked`} {day(r.created_at)}</p>
        </div>
        <span className={`border px-2 py-0.5 text-xs ${r.status === "open" ? "border-t-amber text-t-white" : "border-t-line text-t-phos"}`}>{CHANGE_REQUEST_STATUS_LABELS[r.status]}</span>
      </div>
      {r.body && <p className="mt-2 whitespace-pre-wrap text-sm text-t-phos">{r.body}</p>}
      {r.answer && <p className="mt-2 text-sm text-t-white"><span className="text-xs text-t-phos-dim">{r.answered_by_name || "An admin"} answered:</span> {r.answer}</p>}
      {manager && canWrite && next.length > 0 && (
        <div className="mt-3">
          {moving ? (
            <div>
              <label htmlFor={`ans-${r.id}`} className="mb-1 block text-xs text-t-phos-dim">{moving === "declined" ? "Say why, so they know what to do next." : "Anything to add? (optional)"}</label>
              <textarea id={`ans-${r.id}`} rows={2} value={answer} onChange={(e) => setAnswer(e.target.value)} maxLength={CHANGE_BODY_MAX} className={field} />
              <div className="mt-2 flex gap-4">
                <button type="button" disabled={moving === "declined" && answer.trim().length < 3} onClick={() => act({ action: "answer", id: r.id, status: moving, answer }, () => setMoving(null))}
                  className="t-focus text-xs text-t-phos underline underline-offset-4 hover:text-t-white disabled:opacity-50">{CHANGE_REQUEST_ACTION_LABELS[moving]}</button>
                <button type="button" onClick={() => setMoving(null)} className="t-focus text-xs text-t-phos-dim underline underline-offset-4 hover:text-t-white">Cancel</button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap gap-4">
              {next.map((s) => (
                <button key={s} type="button" onClick={() => { setMoving(s); if (s === "declined") setAnswer(""); }} className="t-focus text-xs text-t-phos underline underline-offset-4 hover:text-t-white">{CHANGE_REQUEST_ACTION_LABELS[s]}</button>
              ))}
            </div>
          )}
        </div>
      )}
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} className="t-focus mt-3 text-xs text-t-phos-dim underline underline-offset-4 hover:text-t-white">
        {open ? "Hide the conversation" : r.reply_count ? `Conversation (${r.reply_count})` : "Reply"}
      </button>
      {open && (
        <div className="mt-2">
          {replies === null ? <p className="text-xs text-t-phos-dim">Getting replies...</p> : (
            <ul className="space-y-2">
              {replies.map((x) => (
                <li key={x.id} className="border-l-2 border-t-line pl-3 text-sm">
                  <p className="text-xs text-t-phos-dim">{x.author_name || "Someone who has left the team"} · {day(x.created_at)}</p>
                  <p className="whitespace-pre-wrap text-t-white">{x.body}</p>
                </li>
              ))}
            </ul>
          )}
          {canWrite && (r.mine || manager) && (
            <div className="mt-2">
              <label htmlFor={`rep-${r.id}`} className="sr-only">Reply</label>
              <textarea id={`rep-${r.id}`} rows={2} value={reply} onChange={(e) => setReply(e.target.value)} maxLength={CHANGE_BODY_MAX} placeholder="Write a reply" className={field} />
              <button type="button" disabled={!reply.trim()} onClick={() => act({ action: "reply", id: r.id, body: reply }, () => { setReply(""); loadReplies(); })}
                className="t-focus mt-1 text-xs text-t-phos underline underline-offset-4 hover:text-t-white disabled:opacity-50">Send reply</button>
            </div>
          )}
        </div>
      )}
      {msg && <p role="alert" className="mt-2 text-xs text-t-amber-bright">{msg}</p>}
    </li>
  );
}

export function ChangeRequestsPage() {
  const [view, setView] = useState<"mine" | "queue" | null>(null);
  const [status, setStatus] = useState("active");
  const [data, setData] = useState<Payload | null>(null);
  const [failed, setFailed] = useState(false);
  const load = useCallback(async () => {
    setFailed(false);
    try {
      const qs = new URLSearchParams({ ...(view ? { view } : { view: "queue" }), ...(status === "all" ? {} : { status }) });
      const res = await fetch(`/api/org/change-requests?${qs}`);
      if (!res.ok) throw new Error();
      const d = (await res.json()) as Payload;
      setData(d);
      if (!view) setView(d.view);
    } catch { setFailed(true); }
  }, [view, status]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!data || typeof window === "undefined" || !window.location.hash.startsWith("#cr-")) return;
    document.getElementById(window.location.hash.slice(1))?.scrollIntoView({ block: "center" });
  }, [data]);
  const chip = (on: boolean) => `t-focus min-h-touch rounded-[4px] border px-3 text-xs ${on ? "border-t-amber text-t-white font-semibold" : "border-t-line text-t-phos-dim hover:text-t-white"}`;
  return (
    <div className="mx-auto max-w-4xl px-4 py-6">
      <h1 className="text-xl font-semibold text-t-white">Change requests</h1>
      <p className="mt-1 mb-4 text-sm text-t-phos-dim">Ideas for how your team&apos;s Refinery should work: fields, screens, lists, programs and sites, the words you use. The owner and admins answer here.</p>
      {data?.canWrite !== false && <div className="mb-6"><SuggestChangeForm target="/dashboard/change-requests" onDone={load} /></div>}
      <div className="mb-3 flex flex-wrap gap-2" role="group" aria-label="Show">
        {data?.manager && (
          <>
            <button type="button" aria-pressed={view === "queue"} onClick={() => setView("queue")} className={chip(view === "queue")}>Waiting for an answer from you</button>
            <button type="button" aria-pressed={view === "mine"} onClick={() => setView("mine")} className={chip(view === "mine")}>What you asked</button>
          </>
        )}
        <button type="button" aria-pressed={status === "active"} onClick={() => setStatus("active")} className={chip(status === "active")}>Open</button>
        <button type="button" aria-pressed={status === "all"} onClick={() => setStatus("all")} className={chip(status === "all")}>All</button>
      </div>
      {failed ? <p role="alert" className="text-sm text-t-white">Requests did not load. <button type="button" onClick={load} className="t-focus underline">Try again</button></p>
        : !data ? <p className="text-sm text-t-phos-dim">Getting requests...</p>
        : data.requests.length === 0 ? <p className="text-sm text-t-phos-dim">{data.view === "queue" ? "Nothing is waiting for an answer." : "You have not asked for a change yet."}</p>
        : <ul className="space-y-3">{data.requests.map((r) => <RequestCard key={r.id} r={r} manager={data.manager} canWrite={data.canWrite} onChange={load} />)}</ul>}
    </div>
  );
}
