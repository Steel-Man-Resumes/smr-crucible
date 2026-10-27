"use client";
/**
 * Supervisor review of case notes (staff side lane S4, migration 109). Shows
 * only when the organization switched on "Supervisor review of case notes".
 *
 * useNoteReviews(clientId)  one request for every note on a person's page
 * <NoteReviewBar ... />     under one note: its state, and the next step for
 *                           the viewer (send it, or approve / send it back)
 * <NoteReviewQueue />       notes waiting for the owner or an admin
 *
 * A note waiting for review is read-only, an approved note is locked, and
 * sending one back needs a comment: the database enforces all three; this
 * only shows the buttons that can work. Reads and writes /api/org/note-review.
 */
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { NOTE_REVIEW_STATUS_LABELS, NOTE_REVIEW_COMMENT_MAX, type NoteReviewStatus } from "@crucible/core/src/teamTalkShared";

interface ReviewEvent { to_status: NoteReviewStatus; from_status: NoteReviewStatus | null; actor_name: string | null; comment: string | null; at: string }
interface ReviewState { note_id: string; status: NoteReviewStatus; updated_at: string; events: ReviewEvent[] }
export interface NoteReviewsData { enabled: boolean; reviewer: boolean; reviews: ReviewState[]; me: string; canWrite: boolean }

const field = "plain-field t-focus w-full bg-t-panel-2 border border-t-line text-sm text-t-white px-3 py-2";
const day = (s: string) => new Date(s).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });

async function post(body: Record<string, unknown>): Promise<string | null> {
  try {
    const res = await fetch("/api/org/note-review", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    if (res.ok) return null;
    return (await res.json().catch(() => ({}))).error || "That did not go through.";
  } catch { return "That did not go through. Check the connection and try again."; }
}

export function useNoteReviews(clientId: string) {
  const [data, setData] = useState<NoteReviewsData | null>(null);
  const load = useCallback(() => {
    fetch(`/api/org/note-review?clientId=${clientId}`).then((r) => (r.ok ? r.json() : null)).then((d) => setData(d)).catch(() => setData(null));
  }, [clientId]);
  useEffect(() => { load(); }, [load]);
  return { data, reload: load };
}

/** Pure: what the viewer can do with this note now. Exported for tests. */
export function reviewStep(input: { status: NoteReviewStatus | null; authorId: string | null; me: string; reviewer: boolean }):
  "send" | "resend" | "decide" | "wait" | "none" {
  const mine = !!input.authorId && input.authorId === input.me;
  if (mine && (input.status === null)) return "send";
  if (mine && input.status === "sent_back") return "resend";
  if (!mine && input.reviewer && input.status === "pending") return "decide";
  if (input.status === "pending") return "wait";
  return "none";
}

export function NoteReviewBar({ noteId, authorId, data, onChange }: { noteId: string; authorId: string | null; data: NoteReviewsData | null; onChange: () => void }) {
  const [sendingBack, setSendingBack] = useState(false);
  const [comment, setComment] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  if (!data?.enabled) return null;
  const review = data.reviews.find((r) => r.note_id === noteId) ?? null;
  const status = review?.status ?? null;
  const step = data.canWrite ? reviewStep({ status, authorId, me: data.me, reviewer: data.reviewer }) : "none";
  const lastBack = review?.events.slice().reverse().find((e) => e.to_status === "sent_back") ?? null;
  const act = async (body: Record<string, unknown>) => { setMsg(null); const err = await post(body); if (err) setMsg(err); else { setSendingBack(false); setComment(""); onChange(); } };
  return (
    <div className="mt-2 border-t border-t-line pt-2 text-xs">
      <p className="text-t-phos-dim">
        Review: <span className={status === "approved" ? "text-t-white" : status === "sent_back" ? "text-t-amber-bright" : "text-t-phos"}>{NOTE_REVIEW_STATUS_LABELS[status ?? "draft"]}</span>
        {review ? ` · ${day(review.updated_at)}` : ""}
      </p>
      {status === "sent_back" && lastBack?.comment && (
        <p className="mt-1 text-t-phos"><span className="text-t-phos-dim">{lastBack.actor_name || "The reviewer"} asked:</span> {lastBack.comment}</p>
      )}
      <div className="mt-1 flex flex-wrap gap-4">
        {(step === "send" || step === "resend") && (
          <button type="button" onClick={() => act({ action: "submit", noteId })} className="t-focus text-t-phos underline underline-offset-4 hover:text-t-white">
            {step === "resend" ? "Send it back for review" : "Send for review"}
          </button>
        )}
        {step === "decide" && !sendingBack && (
          <>
            <button type="button" onClick={() => act({ action: "decide", noteId, decision: "approve" })} className="t-focus text-t-phos underline underline-offset-4 hover:text-t-white">Approve and lock</button>
            <button type="button" onClick={() => setSendingBack(true)} className="t-focus text-t-phos-dim underline underline-offset-4 hover:text-t-white">Send back with a comment</button>
          </>
        )}
      </div>
      {sendingBack && (
        <div className="mt-2">
          <label className="mb-1 block text-t-phos-dim" htmlFor={`back-${noteId}`}>What should change? They see this.</label>
          <textarea id={`back-${noteId}`} rows={2} maxLength={NOTE_REVIEW_COMMENT_MAX} value={comment} onChange={(e) => setComment(e.target.value)} className={field} />
          <div className="mt-1 flex gap-4">
            <button type="button" disabled={comment.trim().length < 3} onClick={() => act({ action: "decide", noteId, decision: "send_back", comment })}
              className="t-focus text-t-phos underline underline-offset-4 hover:text-t-white disabled:opacity-50">Send it back</button>
            <button type="button" onClick={() => setSendingBack(false)} className="t-focus text-t-phos-dim underline underline-offset-4 hover:text-t-white">Cancel</button>
          </div>
        </div>
      )}
      {msg && <p role="alert" className="mt-1 text-t-amber-bright">{msg}</p>}
    </div>
  );
}

interface QueueItem { note_id: string; participant_user_id: string; participant_name: string | null; author_name: string | null; kind: string; waiting_since: string }

/** Notes waiting for review, for the owner and org admins. Renders nothing for anyone else, or when none wait. */
export function NoteReviewQueue() {
  const [queue, setQueue] = useState<QueueItem[] | null>(null);
  useEffect(() => {
    fetch("/api/org/note-review?queue=1").then((r) => (r.ok ? r.json() : null)).then((d) => setQueue(d?.queue ?? null)).catch(() => setQueue(null));
  }, []);
  if (!queue || queue.length === 0) return null;
  return (
    <section aria-labelledby="review-queue-h" className="mb-6 border border-t-line bg-t-panel p-4">
      <h2 id="review-queue-h" className="text-sm font-semibold text-t-white">Notes waiting for your review ({queue.length})</h2>
      <ul className="mt-2 space-y-1">
        {queue.map((n) => (
          <li key={n.note_id} className="text-sm">
            <Link href={`/dashboard/clients/${n.participant_user_id}?tab=notes#note-${n.note_id}`} className="t-focus text-t-phos underline underline-offset-4 hover:text-t-white">
              {n.author_name || "A teammate"}&apos;s note about {n.participant_name || "a person who has not shared their name"}
            </Link>
            <span className="text-xs text-t-phos-dim"> · waiting since {day(n.waiting_since)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
