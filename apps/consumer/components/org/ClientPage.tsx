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
 * Every open of a shared tab is written to a log the participant can read.
 * The page says so, above the content, every time.
 */
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { JOURNEY_STAGES } from "@crucible/core/src/journeyStages";
import { DEFAULT_STAFF_PREFS, NOTE_KINDS as KINDS, NOTE_KIND_LABELS, type StaffPrefs } from "@crucible/core/src/staffPrefsShared";

type Scope = "applications" | "resume" | "documents";
const SCOPES: { key: Scope; label: string; wouldShow: string }[] = [
  { key: "applications", label: "Applications", wouldShow: "the jobs they are tracking, where each one stands, and their follow-up dates. Never their private notes on a job or the pay they wrote down." },
  { key: "resume", label: "Resumes", wouldShow: "the resumes in their library as they stand now, to read. Never the edit history, and never their disclosure plan." },
  { key: "documents", label: "Cover letters", wouldShow: "their cover letters as they stand now, to read." },
];
const STAGES = JOURNEY_STAGES.map((s) => s.long);
const STATUS_LABEL: Record<string, string> = {
  saved: "Saved", applied: "Applied", heard_back: "Heard back", interviewing: "Interviewing",
  offered: "Offered", hired: "Hired", started_work: "Started work", rejected: "Not selected", declined: "Declined",
};
const NOTE_KINDS = KINDS.map((k) => [k, NOTE_KIND_LABELS[k]] as const);
const LAST_TAB_KEY = "smr.staff.clientTab";

interface ScopeState { shared: boolean; sharedAt: string | null; requestPending: boolean }
interface Client {
  userId: string; name: string | null; email: string | null; currentStage: number; joinedAt: string | null;
  assignedStaffName: string | null; scopes: Record<Scope, ScopeState>;
}
interface Note {
  id: string; kind: string; body: string; occurred_at: string; author_name: string | null;
  visible_to_participant: boolean; drafted_by_assistant: boolean; edited_at: string | null;
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
  const [viewer, setViewer] = useState<{ canWriteNotes: boolean; canRequest: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Scope | "notes">("notes");
  const [shared, setShared] = useState<Record<string, unknown>[] | null>(null);
  const [loadingTab, setLoadingTab] = useState(false);
  const [prefs, setPrefs] = useState<StaffPrefs>(DEFAULT_STAFF_PREFS);
  const [opened, setOpened] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch(`/api/org/clients/${clientId}`);
    if (!res.ok) { setError(res.status === 404 ? "This person is not on your caseload, or does not exist." : "Could not load this participant."); return; }
    const d = await res.json();
    setClient(d.client); setNotes(d.notes); setViewer(d.viewer);
  }, [clientId]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    fetch("/api/org/prefs").then((r) => (r.ok ? r.json() : null)).then((d) => d?.effective && setPrefs(d.effective)).catch(() => {});
  }, []);

  const openTab = useCallback(async (next: Scope | "notes") => {
    setTab(next); setShared(null);
    try { localStorage.setItem(LAST_TAB_KEY, next); } catch {}
    if (next === "notes" || !client?.scopes[next].shared) return;
    // Opening a shared tab IS the logged access. Not on hover, not on page
    // load: only when the staff member actually asks to see it.
    setLoadingTab(true);
    const res = await fetch(`/api/org/clients/${clientId}?scope=${next}`);
    const d = res.ok ? await res.json() : { rows: [] };
    setShared(d.rows ?? []); setLoadingTab(false);
  }, [client, clientId]);

  // Start where this person asked to start (Settings -> My workflow). A tab is
  // only opened automatically if it is already shared: landing on a shared tab
  // is a logged access, which they chose; landing on an unshared one would just
  // be an "ask" form nobody asked for.
  useEffect(() => {
    if (!client || opened) return;
    setOpened(true);
    let want: string = prefs.clientTab;
    if (want === "last") { try { want = localStorage.getItem(LAST_TAB_KEY) || "notes"; } catch { want = "notes"; } }
    if (want !== "notes" && (want === "applications" || want === "resume" || want === "documents") && client.scopes[want].shared) openTab(want);
  }, [client, opened, prefs.clientTab, openTab]);

  if (error) return <Shell><p className="text-sm text-t-amber-bright border border-t-amber bg-t-panel px-4 py-3">{error}</p></Shell>;
  if (!client) return <Shell><p className="text-sm text-t-phos-dim">Loading...</p></Shell>;
  const first = (client.name || "This person").split(" ")[0];

  return (
    <Shell>
      <header className="mb-6">
        <h1 className="text-2xl font-bold text-t-white">{client.name || "Participant"}</h1>
        <p className="text-sm text-t-phos-dim mt-1">
          {client.email} · Stage {client.currentStage} of 6, {STAGES[client.currentStage] ?? ""} · Joined {day(client.joinedAt)}
          {client.assignedStaffName ? ` · Case manager: ${client.assignedStaffName}` : " · Unassigned"}
        </p>
        <ul className="flex flex-wrap gap-2 mt-3" aria-label="What this person has shared">
          {SCOPES.map((s) => {
            const st = client.scopes[s.key];
            const text = st.shared ? "Shared" : st.requestPending ? "Asked" : "Not shared";
            return (
              <li key={s.key} className={`text-xs px-2 py-1 border ${st.shared ? "border-t-amber text-t-amber-bright" : "border-t-line text-t-phos-dim"}`}>
                {s.label}: {text}
              </li>
            );
          })}
        </ul>
      </header>

      <div role="tablist" aria-label="Participant sections" className="flex flex-wrap gap-1 border-b border-t-line mb-5">
        {([["notes", "Your notes"], ...SCOPES.map((s) => [s.key, s.label])] as [Scope | "notes", string][]).map(([key, label]) => (
          <button key={key} role="tab" aria-selected={tab === key} onClick={() => openTab(key)}
            className={`t-focus px-4 py-2 text-sm border-b-2 -mb-px ${tab === key ? "border-t-amber text-t-white font-semibold" : "border-transparent text-t-phos-dim hover:text-t-white"}`}>
            {label}
          </button>
        ))}
      </div>

      {tab === "notes" ? (
        <NotesPanel clientId={clientId} first={first} notes={notes} canWrite={!!viewer?.canWriteNotes} onSaved={load}
          defaultKind={prefs.noteKind} defaultVisible={prefs.noteVisible} />
      ) : client.scopes[tab].shared ? (
        <section aria-live="polite">
          <p className="text-xs text-t-phos-dim bg-t-panel border border-t-line px-4 py-3 mb-4">
            {first} chose to share this with your organization on {day(client.scopes[tab].sharedAt)} and can stop at any time.
            {" "}{first} can see that you opened it, and when. You can read it. You cannot change it.
          </p>
          {loadingTab || !shared ? <p className="text-sm text-t-phos-dim">Loading...</p>
            : shared.length === 0 ? <p className="text-sm text-t-phos-dim">Shared, and there is nothing here yet.</p>
            : tab === "applications" ? <Applications rows={shared} /> : <Documents rows={shared} />}
        </section>
      ) : (
        <AskPanel clientId={clientId} first={first} scope={SCOPES.find((s) => s.key === tab)!} pending={client.scopes[tab].requestPending}
          canRequest={!!viewer?.canRequest} onAsked={load} />
      )}
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="max-w-4xl mx-auto px-4 py-6">
      <Link href="/dashboard" className="t-focus text-xs text-t-phos-dim hover:text-t-white">&larr; Back to your caseload</Link>
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

function Documents({ rows }: { rows: Record<string, unknown>[] }) {
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
      <h2 className="font-semibold text-t-white mb-2">{first} has not shared this with you</h2>
      <p className="text-sm text-t-phos-dim leading-relaxed mb-4">
        If they do, you would see {scope.wouldShow} It is their choice, and nothing here changes unless they say yes.
      </p>
      {pending ? (
        <p className="text-sm text-t-phos">You have asked. {first} will see your request the next time they sign in.</p>
      ) : canRequest ? (
        <>
          <label htmlFor="ask-reason" className="block text-xs uppercase text-t-phos-dim mb-1">
            Why would it help? {first} will read this, under your name.
          </label>
          <textarea id="ask-reason" value={reason} onChange={(e) => setReason(e.target.value)} rows={2} maxLength={500}
            placeholder="So I can help you get ready for Thursday's interview."
            className="t-focus w-full bg-t-panel-2 border border-t-line text-sm text-t-white px-3 py-2 mb-3" />
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

function NotesPanel({ clientId, first, notes, canWrite, onSaved, defaultKind, defaultVisible }: {
  clientId: string; first: string; notes: Note[]; canWrite: boolean; onSaved: () => void; defaultKind: string; defaultVisible: boolean;
}) {
  const [body, setBody] = useState("");
  const [kind, setKind] = useState(defaultKind);
  const [visible, setVisible] = useState(defaultVisible);
  // Preferences arrive a moment after the page; adopt them unless the person
  // has already started writing.
  useEffect(() => { if (!body) { setKind(defaultKind); setVisible(defaultVisible); } }, [defaultKind, defaultVisible]); // eslint-disable-line react-hooks/exhaustive-deps
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  async function save() {
    setBusy(true); setMsg(null);
    const res = await fetch(`/api/org/clients/${clientId}`, { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "add_note", body, kind, visibleToParticipant: visible }) });
    setBusy(false);
    if (res.ok) { setBody(""); setVisible(defaultVisible); setKind(defaultKind); onSaved(); } else setMsg((await res.json().catch(() => ({}))).error || "Could not save that.");
  }
  return (
    <section>
      {canWrite && (
        <div className="bg-t-panel border border-t-line p-5 mb-5">
          <label htmlFor="note-body" className="block font-semibold text-t-white mb-2">Add to your record</label>
          <textarea id="note-body" value={body} onChange={(e) => setBody(e.target.value)} rows={3} maxLength={8000}
            className="t-focus w-full bg-t-panel-2 border border-t-line text-sm text-t-white px-3 py-2 mb-3" />
          <div className="flex flex-wrap items-center gap-4">
            <label className="text-xs text-t-phos-dim">Type{" "}
              <select value={kind} onChange={(e) => setKind(e.target.value)} className="t-focus bg-t-panel border border-t-line text-xs text-t-phos px-2 py-1.5 ml-1">
                {NOTE_KINDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
            </label>
            <label className="text-xs text-t-phos-dim flex items-center gap-2">
              <input type="checkbox" checked={visible} onChange={(e) => setVisible(e.target.checked)} className="t-focus" />
              Let {first} see this note
            </label>
            <button onClick={save} disabled={busy || !body.trim()} className="t-focus bg-t-amber text-[#14100a] text-sm font-semibold px-4 py-2 disabled:opacity-50 ml-auto">
              {busy ? "Saving..." : "Save note"}
            </button>
          </div>
          <p className="text-xs text-t-phos-dim mt-3">
            Notes belong to your organization. They can be corrected, and earlier wording is kept. They cannot be deleted.
          </p>
          {msg && <p className="text-xs text-t-amber-bright mt-2" role="alert">{msg}</p>}
        </div>
      )}
      {notes.length === 0 ? <p className="text-sm text-t-phos-dim">No notes yet.</p> : (
        <ol className="space-y-3">
          {notes.map((n) => (
            <li key={n.id} className="bg-t-panel border border-t-line p-4">
              <p className="text-xs text-t-phos-dim mb-1">
                {NOTE_KINDS.find(([k]) => k === n.kind)?.[1] ?? "Note"} · {day(n.occurred_at)} · {n.author_name || "Staff"}
                {n.drafted_by_assistant ? " · drafted with t.ROY" : ""}{n.edited_at ? " · corrected" : ""}{n.visible_to_participant ? ` · ${first} can see this` : ""}
              </p>
              <p className="text-sm text-t-white whitespace-pre-wrap">{n.body}</p>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
