"use client";

/**
 * The cards t.ROY's view tools leave in the chat (staff build S3). Lane S1
 * owns the chat (components/AssistantChat.tsx) and mounts these from the
 * tool results (see viewToolCards below and WIRING NEEDED in the S3 report).
 *
 *  <ViewChangeDoneCard>       after change_my_view or undo_my_view_change:
 *                             "Done: ..." with Undo. Her own view changed at
 *                             once (Troy's one exception); the card tells the
 *                             open screens to read it again.
 *  <SharedViewProposalCard>   after propose_shared_view: nothing is saved
 *                             until a person presses a button. A manager can
 *                             Share with everyone; anyone can Save as my own
 *                             view (if their organization allows personal
 *                             views; the server decides).
 */
import { useEffect, useRef, useState, type ReactElement } from "react";
import { announceViewChanged } from "@/lib/view-change-events";

/**
 * Model-written words (a view's name) arrive ONLY in `draftBody`, which the
 * route claim-checks and may hold back; every other field is server words.
 */
export interface ViewChangeResult { status?: string; changeId?: string | null; summary?: string; draftBody?: string; error?: string }
export interface SharedViewProposal { status?: string; draftBody?: string; proposal?: { definition: unknown; roleDefault: string | null }; canConfirm?: boolean; note?: string; leftOut?: string }

const btn = "min-h-touch rounded-[5px] border px-3 py-1.5 text-xs font-medium transition-colors";

export function ViewChangeDoneCard({ result }: { result: ViewChangeResult }) {
  const [undone, setUndone] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const told = useRef(false);
  useEffect(() => {
    // Tell Today, People and My setup to read the change (once per card).
    if (result.status === "applied" && !told.current) { told.current = true; announceViewChanged({ summary: result.summary }); }
  }, [result.status, result.summary]);
  if (result.status !== "applied") return null;
  async function undo() {
    if (!result.changeId) return;
    setErr(null);
    try {
      const res = await fetch("/api/org/prefs/changes", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "undo", id: result.changeId }) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { setErr(d.error || "That did not undo. Try again."); return; }
      setUndone(d.summary ?? "Undone");
      announceViewChanged({ summary: d.summary });
    } catch { setErr("That did not undo. Try again."); }
  }
  return (
    <div role="status" className="flex flex-wrap items-center gap-2 rounded-[5px] border border-[#b9cdbd] bg-[#f5f6f4] px-3 py-2 text-xs text-[#344b38]" data-testid="view-change-card">
      <span>{undone ? `${undone.replace(/\.$/, "")}.` : `Done: ${String(result.draftBody || result.summary || "").replace(/\.$/, "")}. Only your screen changed.`}</span>
      {!undone && result.changeId && (
        <button type="button" onClick={undo} className={`${btn} border-[#b9cdbd] bg-white hover:bg-[#e3ede5]`}>Undo</button>
      )}
      {err && <span role="alert" className="text-[#8a3b12]">{err}</span>}
    </div>
  );
}

export function SharedViewProposalCard({ result }: { result: SharedViewProposal }) {
  const [done, setDone] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const p = result.proposal;
  // No name (held back by the claim check): nothing to save from here.
  const name = (result.draftBody ?? "").trim().slice(0, 60);
  if (result.status !== "needs_confirmation" || !p || !name) return null;
  async function save(shared: boolean) {
    setBusy(true); setErr(null);
    try {
      const res = await fetch("/api/org/views", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "create", surface: "caseload", name, definition: p!.definition, shared, roleDefault: shared ? p!.roleDefault : null }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { setErr(d.error || "That did not save. Try again."); return; }
      setDone(shared ? `Shared "${name}" with everyone. It is in the view menu on People.` : `Saved "${name}" as your own view.`);
      announceViewChanged({ summary: name });
    } catch { setErr("That did not save. Try again."); }
    finally { setBusy(false); }
  }
  return (
    <div className="rounded-[5px] border border-[#b9cdbd] bg-[#f5f6f4] px-3 py-2 text-xs text-[#344b38]" data-testid="shared-view-card">
      <p className="font-semibold">A view for People: &quot;{name}&quot;</p>
      <p className="mt-0.5">{done ?? result.note ?? "Nothing is saved yet."}</p>
      {!done && result.leftOut && <p className="mt-0.5 text-[#5b5b5b]">{result.leftOut}</p>}
      {!done && (
        <div className="mt-2 flex flex-wrap gap-2">
          {result.canConfirm && (
            <button type="button" disabled={busy} onClick={() => save(true)} className={`${btn} border-[#4f6b57] bg-[#4f6b57] text-white hover:bg-[#3d5745] disabled:opacity-50`}>Share with everyone</button>
          )}
          <button type="button" disabled={busy} onClick={() => save(false)} className={`${btn} border-[#b9cdbd] bg-white hover:bg-[#e3ede5] disabled:opacity-50`}>Save as my own view</button>
        </div>
      )}
      {err && <p role="alert" className="mt-1 text-[#8a3b12]">{err}</p>}
    </div>
  );
}

/**
 * The cards for one assistant message's tool results, in order. S1 calls
 * this with the message's tool invocations (toolName + result) and renders
 * what comes back under the reply once it has finished.
 */
export function viewToolCards(invocations: readonly { toolName?: string; state?: string; result?: unknown }[]): { key: number; node: ReactElement }[] {
  return invocations.flatMap((inv, i) => {
    if (inv.state !== "result") return [];
    if (inv.toolName === "change_my_view" || inv.toolName === "undo_my_view_change") {
      const r = inv.result as ViewChangeResult;
      return r?.status === "applied" ? [{ key: i, node: <ViewChangeDoneCard key={`v${i}`} result={r} /> }] : [];
    }
    if (inv.toolName === "propose_shared_view") {
      const r = inv.result as SharedViewProposal;
      return r?.status === "needs_confirmation" ? [{ key: i, node: <SharedViewProposalCard key={`p${i}`} result={r} /> }] : [];
    }
    return [];
  });
}
