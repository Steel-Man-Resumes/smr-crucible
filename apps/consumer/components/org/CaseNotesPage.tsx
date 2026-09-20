"use client";

/**
 * <CaseNotesPage> -- the record across this person's caseload, newest first.
 * Writing happens on a participant's page; this is for finding and reading.
 */
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { NOTE_KINDS, NOTE_KIND_LABELS, type NoteKind } from "@crucible/core/src/staffPrefsShared";

interface Note {
  id: string; client_user_id: string; client_name: string | null; kind: string; body: string; occurred_at: string;
  author_name: string | null; visible_to_participant: boolean; drafted_by_assistant: boolean; edited_at: string | null;
}
const day = (s: string) => new Date(s).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });

export function CaseNotesPage() {
  const [notes, setNotes] = useState<Note[] | null>(null);
  const [find, setFind] = useState("");
  const [kind, setKind] = useState<"" | NoteKind>("");
  useEffect(() => {
    fetch("/api/org/notes").then((r) => (r.ok ? r.json() : { notes: [] })).then((d) => setNotes(d.notes)).catch(() => setNotes([]));
  }, []);
  const shown = useMemo(() => {
    const q = find.trim().toLowerCase();
    return (notes ?? []).filter((n) => (!kind || n.kind === kind) && (!q || n.body.toLowerCase().includes(q) || (n.client_name || "").toLowerCase().includes(q)));
  }, [notes, find, kind]);

  return (
    <div className="max-w-4xl mx-auto px-4 py-10">
      <h1 className="text-2xl font-bold text-t-white mb-1">Case notes</h1>
      <p className="text-sm text-t-phos-dim mb-5 max-w-2xl">
        Your record, across everyone on your caseload. To add a note, open the person. Notes belong to your organization and cannot be deleted; a correction keeps the earlier wording.
      </p>
      <div className="flex flex-wrap gap-2 mb-5">
        <label className="sr-only" htmlFor="notes-find">Search notes</label>
        <input id="notes-find" type="search" value={find} onChange={(e) => setFind(e.target.value)} placeholder="Search by name or words"
          className="t-focus bg-t-panel border border-t-line text-sm text-t-white px-3 py-2 w-64" />
        <label className="sr-only" htmlFor="notes-kind">Type of note</label>
        <select id="notes-kind" value={kind} onChange={(e) => setKind(e.target.value as "" | NoteKind)} className="t-focus bg-t-panel border border-t-line text-sm text-t-phos px-3 py-2">
          <option value="">Every type</option>
          {NOTE_KINDS.map((k) => <option key={k} value={k}>{NOTE_KIND_LABELS[k]}</option>)}
        </select>
      </div>
      {!notes ? <p className="text-sm text-t-phos-dim">Loading...</p> : shown.length === 0 ? (
        <p className="text-sm text-t-phos-dim bg-t-panel border border-t-line px-5 py-8 text-center">
          {notes.length === 0 ? "No notes yet. Open a participant from your caseload to write the first one." : "Nothing matches that."}
        </p>
      ) : (
        <ol className="space-y-3">
          {shown.map((n) => (
            <li key={n.id} className="bg-t-panel border border-t-line p-4">
              <p className="text-xs text-t-phos-dim mb-1">
                <Link href={`/dashboard/clients/${n.client_user_id}`} className="t-focus text-t-white font-medium underline decoration-t-line underline-offset-4 hover:decoration-t-amber">
                  {n.client_name || "Participant"}
                </Link>{" "}· {NOTE_KIND_LABELS[n.kind as NoteKind] ?? "Note"} · {day(n.occurred_at)} · {n.author_name || "Staff"}
                {n.drafted_by_assistant ? " · drafted with t.ROY" : ""}{n.edited_at ? " · corrected" : ""}{n.visible_to_participant ? " · they can see this" : ""}
              </p>
              <p className="text-sm text-t-white whitespace-pre-wrap">{n.body}</p>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
