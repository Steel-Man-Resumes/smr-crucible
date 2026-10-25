"use client";

/**
 * <ClientPage> -- one participant, for the staff member working with them.
 *
 * WHAT IT WILL NOT DO. It never edits anything the participant made. A case
 * manager reads what was shared, asks for what was not, and keeps their own
 * notes. The participant stays the author of their own materials.
 *
 * A tab for something that is NOT shared is not hidden and is not an error. It
 * says plainly what it would show and offers to ask -- with a reason, because
 * the participant sees that reason word for word under this person's name.
 *
 * Every open of a shared item is written to a log the participant can read.
 * The page says so, above the content, every time. Which events fetch a
 * shared item is decided in one place: scopeToFetch (lib/org-person-view.ts).
 *
 * Layout (CRM lane C2, 2026-10-25): header card, the seven-station strip, an
 * at-a-glance row, five tabs, and a t.ROY rail. Same data doors as before:
 * /api/org/clients/[id], /api/org/prefs, /api/org/tasks. Nothing new is read.
 */
import { orgNoteDraftKey } from "@/lib/org-note-draft";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { OutcomesPanel } from "@/components/org/OutcomesPanel";
import { STAFF_TROY_READY } from "@/lib/staff-troy";
import { GlanceRow, PersonHeaderCard, PersonRail, Skeleton, StationStrip, TheirScreenBoard, scopeStateText } from "@/components/org/PersonOverview";
import {
  NOTE_CARE_LINE, PERSON_TABS, SHARE_SCOPES as SCOPES, capFirst, firstName, initialOpen, noteOwnershipLine, scopeToFetch,
  type OpenEvent, type PersonTab, type ShareScope as Scope,
} from "@/lib/org-person-view";
import { DEFAULT_STAFF_PREFS, NOTE_KINDS as KINDS, NOTE_KIND_LABELS, type StaffPrefs } from "@crucible/core/src/staffPrefsShared";

const STATUS_LABEL: Record<string, string> = {
  saved: "Saved", applied: "Applied", heard_back: "Heard back", interviewing: "Interviewing",
  offered: "Offered", hired: "Hired", started_work: "Started work", rejected: "Not selected", declined: "Declined",
};
const NOTE_KINDS = KINDS.map((k) => [k, NOTE_KIND_LABELS[k]] as const);
const LAST_TAB_KEY = "smr.staff.clientTab";

interface ScopeState { shared: boolean; sharedAt: string | null; requestPending: boolean; required: boolean; stoppedByParticipant: boolean; fromDate: string | null }
interface Client {
  userId: string; name: string | null; email: string | null; currentStage: number | null; identitySource?: "account" | "invite" | "none"; joinedAt: string | null;
  assignedStaffName: string | null; scopes: Record<Scope, ScopeState>; awaitingAcknowledgement: boolean;
  progress: { nextStepAction: string | null; applications: number; savedJobs: number; practiceSessions: number; hasTailoredResume: boolean; lastActiveAt: string | null } | null;
}
interface Note {
  id: string; kind: string; body: string; occurred_at: string; author_name: string | null;
  visible_to_participant: boolean; drafted_by_assistant: boolean; edited_at: string | null;
  author_user_id?: string | null;
  earlier?: { body: string; kind: string; replaced_at: string }[];
}

const day = (s: string | null) => (s ? new Date(s).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "--");

/** Resume and letter content is model-shaped JSON; show its text, never assume its keys. */
function readable(content: unknown, depth = 0): string[] {
  if (content == null || depth > 6) return [];
  if (typeof content === "string") return content.trim() ? [content.trim()] : [];
  if (typeof content === "number") return [String(content)];
  if (Array.isArray(content)) return content.flatMap((c) => readable(c, depth + 1));
  if (typeof content === "object") return Object.values(content as Record<string, unknown>).flatMap((c) => readable(c, depth + 1));
  return [];
}

export function ClientPage({ clientId }: { clientId: string }) {
  const [client, setClient] = useState<Client | null>(null);
  const [notes, setNotes] = useState<Note[]>([]);
  const [viewer, setViewer] = useState<{ userId?: string; canWriteNotes: boolean; canRequest: boolean; canSuggest?: boolean } | null>(null);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [error, setError] = useState<"missing" | "failed" | null>(null);
  const [tab, setTab] = useState<PersonTab>("notes");
  const [item, setItem] = useState<Scope | null>(null);
  const [shared, setShared] = useState<Record<string, unknown>[] | null>(null);
  const [loadingTab, setLoadingTab] = useState(false);
  const [prefs, setPrefs] = useState<StaffPrefs>(DEFAULT_STAFF_PREFS);
  const [opened, setOpened] = useState(false);
  const [tasks, setTasks] = useState<TaskRow[] | null>(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch(`/api/org/clients/${clientId}`);
      if (!res.ok) { setError(res.status === 404 ? "missing" : "failed"); return; }
      const d = await res.json();
      setClient(d.client); setNotes(d.notes); setViewer(d.viewer); setSuggestions(d.suggestions ?? []);
    } catch { setError("failed"); }
  }, [clientId]);
  // The organization's own tasks for this person (not participant content; not logged, as before).
  const loadTasks = useCallback(() => {
    fetch(`/api/org/tasks?clientId=${clientId}`).then((r) => (r.ok ? r.json() : { tasks: [] })).then((d) => setTasks(d.tasks ?? [])).catch(() => setTasks([]));
  }, [clientId]);
  useEffect(() => { load(); loadTasks(); }, [load, loadTasks]);
  useEffect(() => {
    fetch("/api/org/prefs").then((r) => (r.ok ? r.json() : null)).then((d) => d?.effective && setPrefs(d.effective)).catch(() => {});
  }, []);

  /**
   * Every tab and item change goes through here. Fetching a shared item IS the
   * logged access: not on hover, not on page load (unless the staff member's
   * own start-tab setting says so), only when they ask to see it.
   */
  const go = useCallback(async (e: OpenEvent & { kind: "tab" | "item" }) => {
    if (!client) return;
    if (e.kind === "tab") { setTab(e.tab); setItem(null); setShared(null); }
    else { setTab("shared"); setItem(e.scope); setShared(null); }
    try { localStorage.setItem(LAST_TAB_KEY, e.kind === "item" ? e.scope : e.tab); } catch {}
    const scope = scopeToFetch(e, client.scopes);
    if (!scope) return;
    setLoadingTab(true);
    const res = await fetch(`/api/org/clients/${clientId}?scope=${scope}`).catch(() => null);
    const d = res && res.ok ? await res.json() : { rows: [] };
    setShared(d.rows ?? []); setLoadingTab(false);
  }, [client, clientId]);

  // Start where this person asked to start (Settings -> My workflow). A shared
  // item opens automatically only if it is already shared: landing on it is a
  // logged access, which they chose. Same rule as before, in initialOpen.
  useEffect(() => {
    if (!client || opened) return;
    setOpened(true);
    let last: string | null = null;
    try { last = localStorage.getItem(LAST_TAB_KEY); } catch {}
    const start = initialOpen(prefs.clientTab, last, client.scopes);
    if (start.scope) go({ kind: "item", scope: start.scope });
    else if (start.tab !== "notes") go({ kind: "tab", tab: start.tab });
  }, [client, opened, prefs.clientTab, go]);

  if (error === "missing") return (
    <Shell>
      <section className="bg-t-panel border border-t-line rounded-[4px] p-5">
        <p className="text-sm text-t-white">This person is not on your list, or the link is old.</p>
        <Link href="/dashboard/people" className="t-focus inline-block mt-3 text-sm font-semibold text-t-amber-bright underline underline-offset-4">Back to People</Link>
      </section>
    </Shell>
  );
  if (error) return (
    <Shell>
      <section role="alert" className="bg-t-panel border border-t-amber rounded-[4px] p-5">
        <p className="text-sm text-t-white">This page did not load. Nothing was lost.</p>
        <button type="button" onClick={load} className="t-focus mt-3 text-sm font-semibold text-t-amber-bright underline underline-offset-4">Try again</button>
      </section>
    </Shell>
  );
  if (!client) return <Shell><Skeleton /></Shell>;
  const first = firstName(client);
  const openTasks = tasks ? tasks.filter((t) => !t.done_at).length : null;

  return (
    <Shell>
      <PersonHeaderCard person={client} first={first} joined={day(client.joinedAt)} caseManager={client.assignedStaffName} copied={copied}
        onCopyEmail={() => { if (!client.email) return; navigator.clipboard?.writeText(client.email).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }).catch(() => {}); }} />
      <StationStrip person={client} first={first} />
      <GlanceRow person={client} openTasks={openTasks} fmtDay={(s) => day(s)} onPick={(t) => go({ kind: "tab", tab: t.tab })} />

      <div className={`grid gap-5 ${STAFF_TROY_READY ? "lg:grid-cols-[minmax(0,1fr)_17rem]" : ""}`}>
        <div className="min-w-0">
          <div role="tablist" aria-label="Participant sections" className="flex flex-wrap gap-1 border-b border-t-line mb-5">
            {PERSON_TABS.map(({ key, label }) => (
              <button key={key} role="tab" aria-selected={tab === key} onClick={() => go({ kind: "tab", tab: key })}
                className={`t-focus px-4 py-2 text-sm border-b-2 -mb-px ${tab === key ? "border-t-amber text-t-white font-semibold" : "border-transparent text-t-phos-dim hover:text-t-white"}`}>
                {label}
              </button>
            ))}
          </div>

          {tab === "tasks" ? (
            <>
              <TasksPanel clientId={clientId} first={first} tasks={tasks} reload={loadTasks} />
              <h2 className="text-xs font-semibold uppercase tracking-wide text-t-phos-dim mt-8 mb-3">Suggestions</h2>
              <SuggestionsPanel clientId={clientId} first={first} items={suggestions} canSuggest={!!viewer?.canSuggest} onChange={load} />
            </>
          ) : tab === "outcomes" ? (
            <OutcomesPanel clientId={clientId} first={first} />
          ) : tab === "screen" ? (
            <TheirScreenBoard person={client} first={first} onOpenItem={(s) => go({ kind: "item", scope: s })} />
          ) : tab === "notes" ? (
            <NotesPanel clientId={clientId} first={first} notes={notes} canWrite={!!viewer?.canWriteNotes} viewerId={viewer?.userId ?? null} onSaved={load}
              defaultKind={prefs.noteKind} />
          ) : (
            <SharedTab client={client} clientId={clientId} first={first} item={item} rows={shared} loading={loadingTab} viewer={viewer}
              suggestions={suggestions} onPick={(s) => go({ kind: "item", scope: s })} onChange={load} />
          )}
        </div>
        <PersonRail clientId={clientId} first={first} />
      </div>
    </Shell>
  );
}

/** What they shared: pick an item. Picking a shared one is the logged open. Exported for tests. */
export function SharedTab({ client, clientId, first, item, rows, loading, viewer, suggestions, onPick, onChange }: {
  client: Client; clientId: string; first: string; item: Scope | null; rows: Record<string, unknown>[] | null; loading: boolean;
  viewer: { canRequest: boolean; canSuggest?: boolean } | null; suggestions: Suggestion[]; onPick: (s: Scope) => void; onChange: () => void;
}) {
  const st = item ? client.scopes[item] : null;
  return (
    <section>
      <div role="group" aria-label="Shared items" className="flex flex-wrap gap-2 mb-4">
        {SCOPES.map((s) => {
          const state = client.scopes[s.key];
          return (
            <button key={s.key} type="button" aria-pressed={item === s.key} onClick={() => onPick(s.key)}
              className={`t-focus text-sm px-3 py-1.5 border rounded-[4px] ${item === s.key ? "border-t-amber bg-t-panel text-t-white font-semibold" : "border-t-line bg-t-panel text-t-phos-dim hover:text-t-white"}`}>
              {s.label} <span className="text-xs font-normal">· {scopeStateText(state, client.awaitingAcknowledgement)}</span>
            </button>
          );
        })}
      </div>
      {!item || !st ? (
        <p className="text-sm text-t-phos-dim bg-t-panel border border-t-line px-4 py-3">
          Pick one to open it. {capFirst(first)} can see that you opened a shared item, and when.
        </p>
      ) : st.shared ? (
        <div aria-live="polite">
          <p className="text-xs text-t-phos-dim bg-t-panel border border-t-line px-4 py-3 mb-4">
            {capFirst(first)} chose to share this with your organization on {day(st.sharedAt)} and can stop at any time.
            {" "}{capFirst(first)} can see that you opened it, and when. You can read it. You cannot change it.
            {st.fromDate ? ` Only what ${first} made on or after ${day(st.fromDate)} is included; earlier work is still private.` : ""}
          </p>
          {loading ? <p className="text-sm text-t-phos-dim">Opening...</p>
            : !rows ? (
              <button type="button" onClick={() => onPick(item)} className="t-focus text-sm font-semibold text-t-amber-bright underline underline-offset-4">
                Open {SCOPES.find((s) => s.key === item)!.label.toLowerCase()}
              </button>
            )
            : rows.length === 0 ? <p className="text-sm text-t-phos-dim">Shared, and there is nothing here yet.</p>
            : item === "applications" ? <Applications rows={rows} />
            : <Documents rows={rows} clientId={clientId} first={first} canComment={!!viewer?.canSuggest} comments={suggestions.filter((x) => x.kind === "comment")} onChange={onChange} />}
        </div>
      ) : st.required ? (
        <div className="bg-t-panel border border-t-line p-5">
          <h2 className="font-semibold text-t-white mb-2">
            {st.stoppedByParticipant ? `${capFirst(first)} stopped sharing this` : `${capFirst(first)} has not acknowledged the program's requirement yet`}
          </h2>
          <p className="text-sm text-t-phos-dim leading-relaxed">
            Your program requires this, and nothing opens until {first} has read the requirement and said so themselves. Nobody can acknowledge it for them, and {first} can still use everything in the meantime.
            {st.stoppedByParticipant ? " They acknowledged it and later chose to stop. That is a conversation to have with them, not something this screen can override." : " It is waiting for them in their Settings, under Who can see what."}
          </p>
        </div>
      ) : (
        <AskPanel clientId={clientId} first={first} scope={SCOPES.find((s) => s.key === item)!} pending={st.requestPending}
          canRequest={!!viewer?.canRequest} onAsked={onChange} />
      )}
    </section>
  );
}

interface TaskRow { id: string; title: string; due_on: string | null; shared_with_participant: boolean; done_at: string | null; done_by_participant: boolean; owner_name: string | null }

/** What you and this person have agreed to do. A shared task shows on THEIR dashboard, and they can tick it. */
function TasksPanel({ clientId, first, tasks, reload }: { clientId: string; first: string; tasks: TaskRow[] | null; reload: () => void }) {
  const [title, setTitle] = useState(""); const [due, setDue] = useState(""); const [shared, setShared] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);
  const load = reload;
  async function post(body: Record<string, unknown>) {
    setMsg(null);
    const res = await fetch("/api/org/tasks", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    if (!res.ok) setMsg((await res.json().catch(() => ({}))).error || "That did not save.");
    load();
  }
  return (
    <section>
      <form onSubmit={(e) => { e.preventDefault(); if (title.trim().length < 2) return; post({ action: "add", title, dueOn: due || null, clientId, shared }); setTitle(""); setDue(""); }}
        className="bg-t-panel border border-t-line p-5 mb-5">
        <label htmlFor="task-title" className="block font-semibold text-t-white mb-2">Add a task</label>
        <div className="flex flex-wrap gap-2">
          <input id="task-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={300} placeholder="Bring your ID and Social Security card Thursday"
            className="plain-field t-focus flex-1 min-w-[14rem] bg-t-panel-2 border border-t-line text-sm text-t-white px-3 py-2" />
          <label className="sr-only" htmlFor="task-due">Due date</label>
          <input id="task-due" type="date" value={due} onChange={(e) => setDue(e.target.value)} className="plain-field t-focus bg-t-panel-2 border border-t-line text-sm text-t-phos px-3 py-2" />
          <button disabled={title.trim().length < 2} className="t-focus bg-t-amber text-[#14100a] text-sm font-semibold px-4 py-2 disabled:opacity-50">Add</button>
        </div>
        <label className="text-xs text-t-phos-dim flex items-center gap-2 mt-3">
          <input type="checkbox" className="t-focus" checked={shared} onChange={(e) => setShared(e.target.checked)} />
          Show this on {first}&apos;s dashboard so they can tick it off. Untick it for a reminder that is only yours.
        </label>
        {msg && <p role="alert" className="text-xs text-t-amber-bright mt-2">{msg}</p>}
      </form>
      {!tasks ? <p className="text-sm text-t-phos-dim">Getting tasks...</p> : tasks.length === 0 ? <p className="text-sm text-t-phos-dim">No tasks yet. A task you add here can show on {first}&apos;s dashboard, or stay yours.</p> : (
        <ul className="space-y-2">
          {tasks.map((t) => (
            <li key={t.id} className="bg-t-panel border border-t-line px-4 py-3 flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className={`text-sm ${t.done_at ? "text-t-phos-dim line-through" : "text-t-white"}`}>{t.title}</p>
                <p className="text-xs text-t-phos-dim">
                  {t.due_on ? `Due ${day(t.due_on + "T12:00:00Z")} · ` : ""}{t.shared_with_participant ? `${capFirst(first)} can see this` : "Only staff can see this"}
                  {t.done_at ? ` · done${t.done_by_participant ? ` by ${first}` : ""}` : ""}
                </p>
              </div>
              <div className="flex gap-4">
                <button onClick={() => post({ action: t.done_at ? "reopen" : "done", taskId: t.id })} className="t-focus text-xs text-t-phos underline underline-offset-4 hover:text-t-white">{t.done_at ? "Reopen" : "Mark done"}</button>
                {!t.done_at && <button onClick={() => post({ action: "cancel", taskId: t.id })} className="t-focus text-xs text-t-phos-dim underline underline-offset-4 hover:text-t-white">Cancel</button>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

interface Suggestion {
  id: string; kind: "job" | "comment"; job_title: string | null; company: string | null; location: string | null; apply_url: string | null;
  artifact_id: string | null; quote: string | null; body: string; status: "open" | "saved" | "dismissed" | "withdrawn"; author_name: string | null; created_at: string;
}
const SUGGESTION_STATUS: Record<Suggestion["status"], string> = { open: "Waiting for them", saved: "They took it up", dismissed: "Not for them", withdrawn: "Withdrawn" };

async function postClient(clientId: string, body: Record<string, unknown>): Promise<string | null> {
  const res = await fetch(`/api/org/clients/${clientId}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return res.ok ? null : (await res.json().catch(() => ({}))).error || "That did not save.";
}

/** A comment sits BESIDE the document. It never changes it; the participant decides what to do with it. */
function CommentBox({ clientId, artifactId, first, canComment, existing, onChange }: {
  clientId: string; artifactId: string; first: string; canComment: boolean; existing: Suggestion[]; onChange: () => void;
}) {
  const [body, setBody] = useState(""); const [quote, setQuote] = useState(""); const [msg, setMsg] = useState<string | null>(null);
  return (
    <div className="border-t border-t-line mt-4 pt-3">
      {existing.map((c) => (
        <p key={c.id} className="text-xs text-t-phos mb-2">
          <span className="text-t-phos-dim">{c.author_name || "Staff"}, {day(c.created_at)} · {SUGGESTION_STATUS[c.status]}:</span> {c.quote ? `On "${c.quote}": ` : ""}{c.body}
        </p>
      ))}
      {canComment && (
        <form onSubmit={async (e) => { e.preventDefault(); const err = await postClient(clientId, { action: "comment", artifactId, body, quote }); setMsg(err); if (!err) { setBody(""); setQuote(""); onChange(); } }}>
          <label htmlFor={`cq-${artifactId}`} className="sr-only">The words your comment is about (optional)</label>
          <input id={`cq-${artifactId}`} value={quote} onChange={(e) => setQuote(e.target.value)} maxLength={500} placeholder="The words it is about (optional)"
            className="plain-field t-focus w-full bg-t-panel-2 border border-t-line text-xs text-t-white px-3 py-1.5 mb-2" />
          <label htmlFor={`cb-${artifactId}`} className="sr-only">Your comment</label>
          <textarea id={`cb-${artifactId}`} value={body} onChange={(e) => setBody(e.target.value)} rows={2} maxLength={1500} placeholder={`A suggestion for ${first}. They will see it under your name and decide what to do with it.`}
            className="plain-field t-focus w-full bg-t-panel-2 border border-t-line text-sm text-t-white px-3 py-2 mb-2" />
          <button disabled={body.trim().length < 3} className="t-focus border border-t-line text-xs text-t-phos px-3 py-1.5 disabled:opacity-50">Send comment</button>
          {msg && <span role="alert" className="text-xs text-t-amber-bright ml-3">{msg}</span>}
        </form>
      )}
    </div>
  );
}

function SuggestionsPanel({ clientId, first, items, canSuggest, onChange }: { clientId: string; first: string; items: Suggestion[]; canSuggest: boolean; onChange: () => void }) {
  const [f, setF] = useState({ jobTitle: "", company: "", location: "", applyUrl: "", why: "" });
  const [msg, setMsg] = useState<string | null>(null);
  const field = "plain-field t-focus bg-t-panel-2 border border-t-line text-sm text-t-white px-3 py-2 w-full";
  return (
    <section>
      {canSuggest && (
        <form className="bg-t-panel border border-t-line p-5 mb-5" onSubmit={async (e) => { e.preventDefault(); const err = await postClient(clientId, { action: "suggest_job", ...f }); setMsg(err); if (!err) { setF({ jobTitle: "", company: "", location: "", applyUrl: "", why: "" }); onChange(); } }}>
          <h3 className="font-semibold text-t-white mb-1">Suggest a job</h3>
          <p className="text-xs text-t-phos-dim mb-3">It shows up on {first}&apos;s dashboard under your name. It only becomes one of their saved jobs if they save it.</p>
          <div className="grid sm:grid-cols-2 gap-3">
            <div><label htmlFor="sj-title" className="block text-xs text-t-phos-dim mb-1">Job title</label><input id="sj-title" className={field} value={f.jobTitle} onChange={(e) => setF({ ...f, jobTitle: e.target.value })} required /></div>
            <div><label htmlFor="sj-co" className="block text-xs text-t-phos-dim mb-1">Employer</label><input id="sj-co" className={field} value={f.company} onChange={(e) => setF({ ...f, company: e.target.value })} required /></div>
            <div><label htmlFor="sj-loc" className="block text-xs text-t-phos-dim mb-1">Location (optional)</label><input id="sj-loc" className={field} value={f.location} onChange={(e) => setF({ ...f, location: e.target.value })} /></div>
            <div><label htmlFor="sj-url" className="block text-xs text-t-phos-dim mb-1">Link to the posting (optional, https)</label><input id="sj-url" type="url" className={field} value={f.applyUrl} onChange={(e) => setF({ ...f, applyUrl: e.target.value })} placeholder="https://" /></div>
            <div className="sm:col-span-2"><label htmlFor="sj-why" className="block text-xs text-t-phos-dim mb-1">Why it might suit them</label><textarea id="sj-why" rows={2} maxLength={1500} className={field} value={f.why} onChange={(e) => setF({ ...f, why: e.target.value })} required /></div>
          </div>
          <button className="plain-field t-focus bg-t-amber text-[#14100a] text-sm font-semibold px-4 py-2 mt-3">Send suggestion</button>
          {msg && <p role="alert" className="text-xs text-t-amber-bright mt-2">{msg}</p>}
        </form>
      )}
      {items.length === 0 ? <p className="text-sm text-t-phos-dim">Nothing suggested yet. To comment on a resume or letter, open it under What they shared.</p> : (
        <ul className="space-y-2">
          {items.map((s) => (
            <li key={s.id} className="bg-t-panel border border-t-line px-4 py-3 flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm text-t-white">{s.kind === "job" ? `${s.job_title} at ${s.company}` : "Comment on a shared document"}</p>
                <p className="text-sm text-t-phos">{s.quote ? `On "${s.quote}": ` : ""}{s.body}</p>
                <p className="text-xs text-t-phos-dim mt-1">{s.author_name || "Staff"} · {day(s.created_at)}</p>
              </div>
              <div className="text-right">
                <p className={`text-xs px-2 py-1 border inline-block ${s.status === "saved" ? "border-t-amber text-t-amber-bright" : "border-t-line text-t-phos-dim"}`}>{SUGGESTION_STATUS[s.status]}</p>
                {s.status === "open" && canSuggest && <button onClick={async () => { await postClient(clientId, { action: "withdraw_suggestion", suggestionId: s.id }); onChange(); }} className="t-focus block ml-auto mt-2 text-xs text-t-phos-dim underline hover:text-t-white">Withdraw</button>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="person-page max-w-6xl mx-auto px-4 py-6">
      <Link href="/dashboard/people" className="t-focus text-xs text-t-phos-dim hover:text-t-white">&larr; Back to People</Link>
      <div className="mt-4">{children}</div>
    </div>
  );
}

function Applications({ rows }: { rows: Record<string, unknown>[] }) {
  return (
    <div className="overflow-x-auto bg-t-panel border border-t-line">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs uppercase text-t-phos-dim border-b border-t-line">
            <th className="px-4 py-3 font-semibold">Job</th><th className="px-4 py-3 font-semibold">Status</th>
            <th className="px-4 py-3 font-semibold">Applied</th><th className="px-4 py-3 font-semibold">Follow up</th>
            <th className="px-4 py-3 font-semibold">Materials</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={String(r.id)} className="border-b border-t-line last:border-0">
              <td className="px-4 py-3">
                <div className="font-medium text-t-white">{String(r.job_title || "Untitled role")}</div>
                <div className="text-xs text-t-phos-dim">{[r.company, r.location].filter(Boolean).join(" · ")}</div>
              </td>
              <td className="px-4 py-3 text-t-white">{STATUS_LABEL[String(r.status)] ?? String(r.status)}</td>
              <td className="px-4 py-3 text-t-phos-dim">{day(r.applied_at as string | null)}</td>
              <td className="px-4 py-3 text-t-phos-dim">{day(r.follow_up_at as string | null)}</td>
              <td className="px-4 py-3 text-xs text-t-phos-dim">
                {[r.has_tailored_resume ? "Tailored resume" : null, r.has_cover_letter ? "Cover letter" : null].filter(Boolean).join(", ") || "--"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

interface ResumeShape {
  contact?: { name?: string; city?: string; state?: string };
  summary?: string;
  skills?: string[];
  experience?: { id?: string; title?: string; company?: string; startDate?: string; endDate?: string; bullets?: string[] }[];
  education?: { id?: string; credential?: string; institution?: string; year?: string }[];
  text?: string;
}

/**
 * Read-only rendering of what the participant wrote. Known shapes are laid out
 * properly; anything else falls back to its plain text, so a future format
 * shows up readable rather than as an empty card.
 *
 * Deliberately NOT shown even though it is in the resume: phone and email. The
 * case manager already has the person's contact details from the caseload, and
 * a read-only view of a resume is for helping with the resume.
 */
function ArtifactBody({ content }: { content: unknown }) {
  const c = (content ?? {}) as ResumeShape;
  if (typeof c.text === "string") return <p className="whitespace-pre-wrap">{c.text}</p>;
  const known = c.summary || c.experience?.length || c.skills?.length || c.education?.length;
  if (!known) return <>{readable(content).slice(0, 80).map((line, i) => <p key={i}>{line}</p>)}</>;
  return (
    <div className="space-y-4">
      {c.contact?.name && <p className="text-t-white font-semibold">{c.contact.name}{c.contact.city ? ` · ${[c.contact.city, c.contact.state].filter(Boolean).join(", ")}` : ""}</p>}
      {c.summary && <p>{c.summary}</p>}
      {!!c.skills?.length && (
        <div><h4 className="text-xs uppercase text-t-phos-dim mb-1">Skills</h4><p>{c.skills.join(" · ")}</p></div>
      )}
      {!!c.experience?.length && (
        <div>
          <h4 className="text-xs uppercase text-t-phos-dim mb-1">Experience</h4>
          <ul className="space-y-3">
            {c.experience.map((e, i) => (
              <li key={e.id ?? i}>
                <p className="text-t-white">{[e.title, e.company].filter(Boolean).join(", ")}</p>
                <p className="text-xs text-t-phos-dim">{[e.startDate, e.endDate].filter(Boolean).join(" to ")}</p>
                {!!e.bullets?.length && <ul className="list-disc pl-5 mt-1 space-y-0.5">{e.bullets.map((b, j) => <li key={j}>{b}</li>)}</ul>}
              </li>
            ))}
          </ul>
        </div>
      )}
      {!!c.education?.length && (
        <div>
          <h4 className="text-xs uppercase text-t-phos-dim mb-1">Education and training</h4>
          <ul>{c.education.map((e, i) => <li key={e.id ?? i}>{[e.credential, e.institution, e.year].filter(Boolean).join(", ")}</li>)}</ul>
        </div>
      )}
    </div>
  );
}

function Documents({ rows, clientId, first, canComment, comments, onChange }: {
  rows: Record<string, unknown>[]; clientId: string; first: string; canComment: boolean; comments: Suggestion[]; onChange: () => void;
}) {
  return (
    <div className="space-y-4">
      {rows.map((r) => {
        const target = (r.target_context ?? {}) as { targetJob?: string; targetCompany?: string };
        const meta = ((r.content as { meta?: { targetJob?: string; targetCompany?: string } } | null)?.meta) ?? {};
        const job = target.targetJob || meta.targetJob;
        const company = target.targetCompany || meta.targetCompany;
        return (
          <article key={String(r.id)} className="bg-t-panel border border-t-line p-5">
            <h3 className="text-sm font-semibold text-t-white mb-1">
              {job ? `For ${job}${company ? ` at ${company}` : ""}` : "General"}
              {r.is_current ? <span className="ml-2 text-xs text-t-amber-bright">pinned as their main resume</span> : null}
            </h3>
            <p className="text-xs text-t-phos-dim mb-3">Last changed {day(r.updated_at as string)}</p>
            <div className="text-sm text-t-phos leading-relaxed max-h-[32rem] overflow-y-auto">
              <ArtifactBody content={r.content} />
            </div>
            <CommentBox clientId={clientId} artifactId={String(r.id)} first={first} canComment={canComment}
              existing={comments.filter((c) => c.artifact_id === String(r.id))} onChange={onChange} />
          </article>
        );
      })}
    </div>
  );
}

function AskPanel({ clientId, first, scope, pending, canRequest, onAsked }: {
  clientId: string; first: string; scope: { key: Scope; label: string; wouldShow: string }; pending: boolean; canRequest: boolean; onAsked: () => void;
}) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  async function ask() {
    setBusy(true); setMsg(null);
    const res = await fetch(`/api/org/clients/${clientId}`, { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "request_sharing", scope: scope.key, reason }) });
    setBusy(false);
    if (res.ok) { setReason(""); onAsked(); } else setMsg((await res.json().catch(() => ({}))).error || "Could not send that.");
  }
  return (
    <section className="bg-t-panel border border-t-line p-5">
      <h2 className="font-semibold text-t-white mb-2">{capFirst(first)} has not shared this with you</h2>
      <p className="text-sm text-t-phos-dim leading-relaxed mb-4">
        If they do, you would see {scope.wouldShow} It is their choice, and nothing here changes unless they say yes.
      </p>
      {pending ? (
        <p className="text-sm text-t-phos">You have asked. {capFirst(first)} will see your request the next time they sign in.</p>
      ) : canRequest ? (
        <>
          <label htmlFor="ask-reason" className="block text-xs uppercase text-t-phos-dim mb-1">
            Why would it help? {capFirst(first)} will read this, under your name.
          </label>
          <textarea id="ask-reason" value={reason} onChange={(e) => setReason(e.target.value)} rows={2} maxLength={500}
            placeholder="So I can help you get ready for Thursday's interview."
            className="plain-field t-focus w-full bg-t-panel-2 border border-t-line text-sm text-t-white px-3 py-2 mb-3" />
          <button onClick={ask} disabled={busy || reason.trim().length < 3}
            className="t-focus bg-t-amber text-[#14100a] text-sm font-semibold px-4 py-2 disabled:opacity-50">
            {busy ? "Sending..." : `Ask ${first} to share this`}
          </button>
          {msg && <p className="text-xs text-t-amber-bright mt-2" role="alert">{msg}</p>}
        </>
      ) : null}
    </section>
  );
}

function NotesPanel({ clientId, first, notes, canWrite, viewerId, onSaved, defaultKind }: {
  clientId: string; first: string; notes: Note[]; canWrite: boolean; viewerId: string | null; onSaved: () => void; defaultKind: string;
}) {
  const [body, setBody] = useState("");
  const [kind, setKind] = useState(defaultKind);
  // Preferences arrive a moment after the page; adopt them unless the person
  // has already started writing.
  useEffect(() => { if (!body) setKind(defaultKind); }, [defaultKind]); // eslint-disable-line react-hooks/exhaustive-deps
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ id: string; body: string } | null>(null);
  // A draft t.ROY wrote, placed here from the assistant. It is NOT saved:
  // it sits in this box, marked, until the staff member saves or discards it.
  const draftKey = viewerId ? orgNoteDraftKey(viewerId, clientId) : null;
  const [draft, setDraft] = useState<{ purpose: "case_note" | "check_in" } | null>(null);
  useEffect(() => {
    if (!draftKey) return;
    try {
      const raw = sessionStorage.getItem(draftKey);
      if (!raw) return;
      const d = JSON.parse(raw) as { body?: unknown; purpose?: unknown };
      if (typeof d.body !== "string" || !d.body.trim()) return;
      setBody(d.body.slice(0, 8000));
      const purpose = d.purpose === "case_note" ? "case_note" : "check_in";
      // A check-in nobody has sent is a 'draft' until a person marks it sent.
      // A case note draft keeps the staff member's own default kind.
      if (purpose === "check_in") setKind("draft");
      setDraft({ purpose });
    } catch { /* no draft */ }
  }, [draftKey]);
  function clearDraft() {
    try { if (draftKey) sessionStorage.removeItem(draftKey); } catch { /* ignore */ }
    setDraft(null);
  }
  async function save() {
    setBusy(true); setMsg(null);
    const res = await fetch(`/api/org/clients/${clientId}`, { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "add_note", body, kind, draftedByAssistant: !!draft }) });
    setBusy(false);
    if (res.ok) { setBody(""); setKind(defaultKind); clearDraft(); onSaved(); } else setMsg((await res.json().catch(() => ({}))).error || "Could not save that.");
  }
  // A draft check-in becomes an "Email" only when the person who saved it
  // says they sent it. The kind change is kept as an earlier version.
  async function markSent(n: Note) {
    setBusy(true); setMsg(null);
    const res = await fetch(`/api/org/clients/${clientId}`, { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "edit_note", noteId: n.id, body: n.body, kind: "email" }) });
    setBusy(false);
    if (res.ok) onSaved(); else setMsg((await res.json().catch(() => ({}))).error || "Could not mark it sent.");
  }
  async function saveCorrection() {
    if (!editing) return;
    setBusy(true); setMsg(null);
    const res = await fetch(`/api/org/clients/${clientId}`, { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "edit_note", noteId: editing.id, body: editing.body }) });
    setBusy(false);
    if (res.ok) { setEditing(null); onSaved(); } else setMsg((await res.json().catch(() => ({}))).error || "Could not save that correction.");
  }
  return (
    <section>
      {canWrite && (
        <div className="bg-t-panel border border-t-line p-5 mb-5">
          <label htmlFor="note-body" className="block font-semibold text-t-white mb-2">Add to your record</label>
          {draft && (
            <div role="status" className="border border-t-amber bg-t-panel-2 px-3 py-2 mb-3 text-xs text-t-amber-bright">
              {draft.purpose === "check_in"
                ? "Draft check-in from t.ROY. Nothing was sent. If you save it, it is filed as a draft until you mark it sent."
                : "Draft case note from t.ROY. It is not saved. Read it, fix anything that is wrong, then save it or throw it away."}
              {" "}If you save it, the note says it was drafted with t.ROY.
              <button type="button" onClick={() => { setBody(""); setKind(defaultKind); clearDraft(); }} className="t-focus ml-2 underline">Throw it away</button>
            </div>
          )}
          <textarea id="note-body" value={body} onChange={(e) => setBody(e.target.value)} rows={3} maxLength={8000}
            className="plain-field t-focus w-full bg-t-panel-2 border border-t-line text-sm text-t-white px-3 py-2 mb-3" />
          <div className="flex flex-wrap items-center gap-4">
            <label className="text-xs text-t-phos-dim">Type{" "}
              <select value={kind} onChange={(e) => setKind(e.target.value)} className="t-focus bg-t-panel border border-t-line text-xs text-t-phos px-2 py-1.5 ml-1">
                {kind === "draft" && <option value="draft">Check-in draft, not sent</option>}
                {NOTE_KINDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
            </label>
            <button onClick={save} disabled={busy || !body.trim()} className="t-focus bg-t-amber text-[#14100a] text-sm font-semibold px-4 py-2 disabled:opacity-50 ml-auto">
              {busy ? "Saving..." : "Save note"}
            </button>
          </div>
          <p className="text-xs text-t-phos-dim mt-3">{noteOwnershipLine(first)}</p>
          <p className="text-[11px] text-t-phos-dim mt-1" data-note-care="">{NOTE_CARE_LINE}</p>
          {msg && <p className="text-xs text-t-amber-bright mt-2" role="alert">{msg}</p>}
        </div>
      )}
      {notes.length === 0 ? <p className="text-sm text-t-phos-dim">No notes yet. Notes you save show here, newest first.</p> : (
        <ol className="space-y-3">
          {notes.map((n) => {
            const mine = canWrite && !!viewerId && n.author_user_id === viewerId;
            const isEditing = editing?.id === n.id;
            return (
              <li key={n.id} className="bg-t-panel border border-t-line p-4">
                <p className="text-xs text-t-phos-dim mb-1">
                  {n.kind === "draft" ? "Check-in draft, not sent" : NOTE_KINDS.find(([k]) => k === n.kind)?.[1] ?? "Note"} · {day(n.occurred_at)} · {n.author_name || "Staff"}
                  {n.drafted_by_assistant ? " · drafted with t.ROY" : ""}{n.edited_at ? ` · corrected ${day(n.edited_at)}` : ""}
                </p>
                {isEditing ? (
                  <div>
                    <label htmlFor={`fix-${n.id}`} className="sr-only">Corrected wording</label>
                    <textarea id={`fix-${n.id}`} value={editing.body} onChange={(e) => setEditing({ id: n.id, body: e.target.value })} rows={3} maxLength={8000}
                      className="plain-field t-focus w-full bg-t-panel-2 border border-t-line text-sm text-t-white px-3 py-2 mb-2" />
                    <div className="flex gap-3">
                      <button onClick={saveCorrection} disabled={busy || !editing.body.trim() || editing.body.trim() === n.body}
                        className="t-focus bg-t-amber text-[#14100a] text-xs font-semibold px-3 py-1.5 disabled:opacity-50">{busy ? "Saving..." : "Save correction"}</button>
                      <button onClick={() => setEditing(null)} className="t-focus text-xs text-t-phos-dim underline">Cancel</button>
                    </div>
                    <p className="text-[11px] text-t-phos-dim mt-1">The current wording is kept as an earlier version.</p>
                  </div>
                ) : (
                  <p className="text-sm text-t-white whitespace-pre-wrap">{n.body}</p>
                )}
                {!isEditing && mine && (
                  <span className="flex flex-wrap gap-4 mt-2">
                    <button onClick={() => setEditing({ id: n.id, body: n.body })} className="t-focus text-xs text-t-phos underline">Correct this note</button>
                    {n.kind === "draft" && (
                      <button onClick={() => markSent(n)} disabled={busy} className="t-focus text-xs text-t-amber-bright underline">I sent it</button>
                    )}
                  </span>
                )}
                {(n.earlier?.length ?? 0) > 0 && (
                  <details className="mt-2">
                    <summary className="text-xs text-t-phos-dim cursor-pointer">Earlier wording ({n.earlier!.length})</summary>
                    <ol className="mt-2 space-y-2">
                      {n.earlier!.map((v, i) => (
                        <li key={i} className="border-l border-t-line pl-3">
                          <p className="text-[11px] text-t-phos-dim">Replaced {day(v.replaced_at)}</p>
                          <p className="text-xs text-t-phos whitespace-pre-wrap">{v.body}</p>
                        </li>
                      ))}
                    </ol>
                  </details>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
