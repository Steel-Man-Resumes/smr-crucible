"use client";
/**
 * Team talk on a person's page, and the team thread (staff side lane S4,
 * migration 109). Staff talk to each other here; the person never sees it.
 *
 * <TeamCommentsPanel clientId={id} first="Jordan" />   comments about one person
 * <TeamCommentsPanel clientId={null} />                 the team thread (about nobody)
 *
 * @mentions: type "@" and a name, or press "Mention someone". Only teammates
 * who can see this person are offered; anyone else is refused with a plain
 * line (by the route and again by the database). A mention lands in their
 * Inbox. Comments are never deleted; a correction keeps the earlier wording.
 * Reads and writes /api/org/comments only. Nothing is sent outside the app.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { COMMENT_CARE_LINE, TEAM_THREAD_CARE_LINE } from "@crucible/core/src/teamTalkShared";

interface Mentioned { id: string; name: string | null }
interface CommentView {
  id: string; participant_user_id: string | null; parent_id: string | null; author_user_id: string | null; author_name: string | null;
  body: string; mentioned: Mentioned[]; created_at: string; edited_at: string | null; earlier_count: number;
}
interface Payload { comments: CommentView[]; mentionable: Mentioned[]; me: string; canWrite: boolean; careLine: string; max: number }

const field = "plain-field t-focus w-full bg-t-panel-2 border border-t-line text-sm text-t-white px-3 py-2";
const stamp = (s: string) => new Date(s).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

async function post(body: Record<string, unknown>): Promise<{ ok: boolean; error?: string; versions?: { body: string; replaced_at: string; replaced_by_name: string | null }[] }> {
  try {
    const res = await fetch("/api/org/comments", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const d = await res.json().catch(() => ({}));
    return res.ok ? { ok: true, ...d } : { ok: false, error: d.error || "That did not save." };
  } catch { return { ok: false, error: "That did not save. Check the connection and try again." }; }
}

/** The "@word" being typed right before the caret, if any. Pure, for tests. */
export function mentionQuery(text: string, caret: number): { start: number; query: string } | null {
  const before = text.slice(0, caret);
  // "@", then at most two words (a first and last name), right before the caret.
  const m = /(^|\s)@([\p{L}'-]{0,30}(?: [\p{L}'-]{0,30})?)$/u.exec(before);
  if (!m) return null;
  const query = m[2];
  return { start: before.length - query.length - 1, query };
}

/** A box that writes a comment, with @ suggestions from the people who may be mentioned. */
function Composer({ mentionable, placeholder, submitLabel, initial, initialMentions, onSubmit, onCancel, max }: {
  mentionable: Mentioned[]; placeholder: string; submitLabel: string; initial?: string; initialMentions?: Mentioned[];
  onSubmit: (body: string, mentions: string[]) => Promise<string | null>; onCancel?: () => void; max: number;
}) {
  const [text, setText] = useState(initial ?? "");
  const [picked, setPicked] = useState<Mentioned[]>(initialMentions ?? []);
  const [caret, setCaret] = useState(0);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const box = useRef<HTMLTextAreaElement | null>(null);
  const q = mentionQuery(text, caret);
  const suggestions = useMemo(() => {
    if (!q && !pickerOpen) return [];
    const needle = (q?.query ?? "").trim().toLowerCase();
    return mentionable.filter((m) => !picked.some((p) => p.id === m.id) && (!needle || (m.name ?? "").toLowerCase().includes(needle))).slice(0, 6);
  }, [q, pickerOpen, mentionable, picked]);

  function choose(m: Mentioned) {
    const name = m.name?.trim() || "teammate";
    if (q) {
      const next = `${text.slice(0, q.start)}@${name} ${text.slice(caret)}`;
      setText(next);
      const pos = q.start + name.length + 2;
      requestAnimationFrame(() => { box.current?.setSelectionRange(pos, pos); box.current?.focus(); });
    }
    setPicked((p) => (p.some((x) => x.id === m.id) ? p : [...p, m]));
    setPickerOpen(false);
  }

  async function submit() {
    if (!text.trim() || busy) return;
    setBusy(true); setMsg(null);
    const err = await onSubmit(text, picked.map((p) => p.id));
    setBusy(false);
    if (err) { setMsg(err); return; }
    setText(""); setPicked([]);
  }

  return (
    <div className="relative">
      <textarea ref={box} value={text} maxLength={max} rows={3} placeholder={placeholder} aria-label={placeholder}
        onChange={(e) => { setText(e.target.value); setCaret(e.target.selectionStart ?? e.target.value.length); }}
        onSelect={(e) => setCaret((e.target as HTMLTextAreaElement).selectionStart ?? 0)}
        onKeyDown={(e) => {
          if (suggestions.length && e.key === "Enter" && !e.shiftKey) { e.preventDefault(); choose(suggestions[0]); }
          else if (e.key === "Escape") setPickerOpen(false);
          else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); submit(); }
        }}
        className={field} />
      {suggestions.length > 0 && (
        <ul role="listbox" aria-label="Teammates who can see this" className="absolute z-10 mt-1 w-full max-w-xs border border-t-line bg-t-panel shadow-lg">
          {suggestions.map((m) => (
            <li key={m.id} role="option" aria-selected={false}>
              <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => choose(m)}
                className="t-focus block w-full px-3 py-2 text-left text-sm text-t-white hover:bg-t-panel-2">{m.name || "A teammate"}</button>
            </li>
          ))}
        </ul>
      )}
      {picked.length > 0 && (
        <p className="mt-2 flex flex-wrap items-center gap-2 text-xs text-t-phos-dim">
          Mentioning:
          {picked.map((p) => (
            <span key={p.id} className="inline-flex items-center gap-1 border border-t-line px-2 py-0.5 text-t-phos">
              {p.name || "A teammate"}
              <button type="button" aria-label={`Do not mention ${p.name || "this teammate"}`} onClick={() => setPicked((x) => x.filter((y) => y.id !== p.id))}
                className="t-focus text-t-phos-dim hover:text-t-white">x</button>
            </span>
          ))}
        </p>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <button type="button" disabled={!text.trim() || busy} onClick={submit}
          className="t-focus min-h-touch bg-t-amber px-4 text-sm font-semibold text-[#14100a] disabled:opacity-50">{busy ? "Saving..." : submitLabel}</button>
        {mentionable.length > 0 && (
          <button type="button" onClick={() => setPickerOpen((v) => !v)} aria-expanded={pickerOpen}
            className="t-focus min-h-touch text-xs text-t-phos underline underline-offset-4 hover:text-t-white">Mention someone</button>
        )}
        {onCancel && <button type="button" onClick={onCancel} className="t-focus min-h-touch text-xs text-t-phos-dim underline underline-offset-4 hover:text-t-white">Cancel</button>}
        <span className="text-xs text-t-phos-dim">{text.length > max - 200 ? `${max - text.length} characters left` : ""}</span>
      </div>
      {msg && <p role="alert" className="mt-2 text-xs text-t-amber-bright">{msg}</p>}
    </div>
  );
}

function CommentItem({ c, data, replies, onChange, isReply }: { c: CommentView; data: Payload; replies: CommentView[]; onChange: () => void; isReply?: boolean }) {
  const [replying, setReplying] = useState(false);
  const [editing, setEditing] = useState(false);
  const [earlier, setEarlier] = useState<{ body: string; replaced_at: string; replaced_by_name: string | null }[] | null>(null);
  const mine = !!c.author_user_id && c.author_user_id === data.me;
  return (
    <li id={`comment-${c.id}`} className={`scroll-mt-24 ${isReply ? "border-l-2 border-t-line pl-4" : "border border-t-line bg-t-panel p-4"}`}>
      <p className="text-xs text-t-phos-dim">
        <span className="font-semibold text-t-white">{c.author_name || "Someone who has left the team"}</span> · {stamp(c.created_at)}
        {c.edited_at ? " · corrected" : ""}
      </p>
      {editing ? (
        <div className="mt-2">
          <Composer mentionable={data.mentionable} placeholder="Correct your comment" submitLabel="Save the correction" initial={c.body} max={data.max}
            onCancel={() => setEditing(false)}
            onSubmit={async (body) => { const r = await post({ action: "correct", commentId: c.id, body }); if (r.ok) { setEditing(false); onChange(); } return r.ok ? null : r.error ?? null; }} />
          <p className="mt-1 text-xs text-t-phos-dim">The earlier wording is kept with it.</p>
        </div>
      ) : (
        <p className="mt-1 whitespace-pre-wrap break-words text-sm text-t-white">{c.body}</p>
      )}
      {c.mentioned.length > 0 && <p className="mt-1 text-xs text-t-phos-dim">Mentioned: {c.mentioned.map((m) => m.name || "a teammate").join(", ")}</p>}
      <div className="mt-2 flex flex-wrap gap-4">
        {data.canWrite && !isReply && <button type="button" onClick={() => setReplying((v) => !v)} className="t-focus text-xs text-t-phos underline underline-offset-4 hover:text-t-white">Reply</button>}
        {data.canWrite && mine && !editing && <button type="button" onClick={() => setEditing(true)} className="t-focus text-xs text-t-phos-dim underline underline-offset-4 hover:text-t-white">Correct</button>}
        {c.earlier_count > 0 && (
          <button type="button" onClick={async () => { if (earlier) { setEarlier(null); return; } const r = await post({ action: "history", commentId: c.id }); setEarlier(r.versions ?? []); }}
            className="t-focus text-xs text-t-phos-dim underline underline-offset-4 hover:text-t-white">{earlier ? "Hide earlier wording" : `Earlier wording (${c.earlier_count})`}</button>
        )}
      </div>
      {earlier && (
        <ul className="mt-2 space-y-1">
          {earlier.map((v, i) => <li key={i} className="text-xs text-t-phos-dim"><span className="whitespace-pre-wrap">{v.body}</span> ({v.replaced_by_name || "a teammate"} changed it {stamp(v.replaced_at)})</li>)}
        </ul>
      )}
      {replies.length > 0 && <ul className="mt-3 space-y-3">{replies.map((r) => <CommentItem key={r.id} c={r} data={data} replies={[]} onChange={onChange} isReply />)}</ul>}
      {replying && (
        <div className="mt-3">
          <Composer mentionable={data.mentionable} placeholder="Write a reply" submitLabel="Reply" max={data.max} onCancel={() => setReplying(false)}
            onSubmit={async (body, mentions) => {
              const r = await post({ action: "add", clientId: c.participant_user_id, parentId: c.id, body, mentions });
              if (r.ok) { setReplying(false); onChange(); }
              return r.ok ? null : r.error ?? null;
            }} />
        </div>
      )}
    </li>
  );
}

export function TeamCommentsPanel({ clientId, first }: { clientId: string | null; first?: string }) {
  const [data, setData] = useState<Payload | null>(null);
  const [failed, setFailed] = useState(false);
  const load = useCallback(async () => {
    setFailed(false);
    try {
      const res = await fetch(`/api/org/comments${clientId ? `?clientId=${clientId}` : ""}`);
      if (!res.ok) throw new Error();
      setData(await res.json());
    } catch { setFailed(true); }
  }, [clientId]);
  useEffect(() => { load(); }, [load]);
  // Land on #comment-<id> from the Inbox or the timeline.
  useEffect(() => {
    if (!data || typeof window === "undefined" || !window.location.hash.startsWith("#comment-")) return;
    const el = document.getElementById(window.location.hash.slice(1));
    if (el) { el.scrollIntoView({ block: "center" }); el.classList.add("ring-1", "ring-t-amber"); setTimeout(() => el.classList.remove("ring-1", "ring-t-amber"), 2500); }
  }, [data]);

  const top = (data?.comments ?? []).filter((c) => !c.parent_id).slice().reverse();
  const repliesOf = (id: string) => (data?.comments ?? []).filter((c) => c.parent_id === id);
  const about = clientId ? `about ${first || "this person"}` : "for the whole team";

  return (
    <section aria-labelledby="team-talk-h">
      <h2 id="team-talk-h" className="text-sm font-semibold text-t-white">{clientId ? "Team talk" : "Team board"}</h2>
      <p className="mt-1 mb-3 text-xs text-t-phos-dim">{data?.careLine ?? COMMENT_CARE_LINE}{clientId ? "" : ` ${TEAM_THREAD_CARE_LINE}`}</p>
      {failed ? <p role="alert" className="text-sm text-t-white">Comments did not load. <button type="button" onClick={load} className="t-focus underline">Try again</button></p>
        : !data ? <p className="text-sm text-t-phos-dim">Getting comments...</p>
        : (
          <>
            {data.canWrite && (
              <div className="mb-5 border border-t-line bg-t-panel p-4">
                <Composer mentionable={data.mentionable} max={data.max} submitLabel="Post to the team"
                  placeholder={`Write to your team ${about}. Type @ to mention someone.`}
                  onSubmit={async (body, mentions) => { const r = await post({ action: "add", clientId, body, mentions }); if (r.ok) load(); return r.ok ? null : r.error ?? null; }} />
                {clientId && data.mentionable.length === 0 && <p className="mt-2 text-xs text-t-phos-dim">Nobody else on your team can see {first || "this person"} yet, so there is nobody to mention.</p>}
              </div>
            )}
            {top.length === 0 ? <p className="text-sm text-t-phos-dim">No comments yet.</p> : (
              <ul className="space-y-3">{top.map((c) => <CommentItem key={c.id} c={c} data={data} replies={repliesOf(c.id)} onChange={load} />)}</ul>
            )}
          </>
        )}
    </section>
  );
}
