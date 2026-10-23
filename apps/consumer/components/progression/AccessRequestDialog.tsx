"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { AccessRequestKind, ProgressSelection, ProgressStep, ProgressRequest, UnlockResult } from "@/lib/progression-ui";

export function AccessRequestDialog({ step, kind, selection, reply, onClose, onChanged }: {
  step: ProgressStep; kind: AccessRequestKind; selection: ProgressSelection; reply?: ProgressRequest; onClose: () => void; onChanged: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [mounted, setMounted] = useState(false);
  const [reason, setReason] = useState("");
  const [result, setResult] = useState<UnlockResult | null>(null);
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);
  const [consent, setConsent] = useState(false);
  const key = useRef<string | null>(reply?.idempotencyKey ?? null);
  const alive = useRef(true);
  const latestRequest = useRef(0);
  const needsReview = result?.outcome === "review_required";
  const complete = result?.outcome === "granted" || result?.outcome === "pending" || result?.outcome === "denied";
  const title = reply ? `Reply to Troy about ${step.label}` : kind === "feedback" ? "Share honest feedback" : kind === "bug" ? "Report a problem" : kind === "ai_bonus" ? "Ask for extra AI actions" : `Ask t.ROY to open ${step.label}`;

  useEffect(() => {
    alive.current = true;
    setMounted(true);
    return () => { alive.current = false; };
  }, []);
  useEffect(() => {
    if (!mounted) return;
    const dialog = ref.current;
    if (!dialog) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog.showModal();
    return () => {
      dialog.close();
      document.body.style.overflow = overflow;
      if (previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, [mounted]);

  async function submit(escalate: boolean) {
    if (sending || reason.trim().length < 5 || (escalate && !consent)) return;
    setSending(true);
    setError("");
    const sequence = ++latestRequest.current;
    key.current ??= crypto.randomUUID();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20_000);
    try {
      const response = await fetch("/api/progression/unlock", {
        method: "POST", headers: { "Content-Type": "application/json" }, signal: controller.signal,
        body: JSON.stringify({ stepId: step.id, requestKind: kind, reason: reason.trim(), idempotencyKey: key.current, selection,
          ...(escalate ? { escalate: true, consentToShare: true, summary: result?.summary || `${title}: ${reason.trim()}` } : {}) }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(typeof body?.error === "string" ? body.error : "That request did not save. Try again.");
      const next = (body?.data ?? body) as UnlockResult;
      if (!["granted", "review_required", "pending", "denied"].includes(next?.outcome) || typeof next.message !== "string") throw new Error("The result could not be confirmed. Try again with the same request.");
      onChanged();
      if (alive.current && sequence === latestRequest.current) setResult(next);
    } catch (caught) {
      if (alive.current && sequence === latestRequest.current) setError(caught instanceof Error && caught.name !== "AbortError" ? caught.message : "The request could not be confirmed. Try again; the same request will be reused.");
    } finally {
      clearTimeout(timeout);
      if (alive.current && sequence === latestRequest.current) setSending(false);
    }
  }

  if (!mounted) return null;
  return createPortal(<dialog ref={ref} className="progress-access-dialog" aria-labelledby="progress-access-title" aria-describedby="progress-access-description"
    onCancel={(event) => { event.preventDefault(); onClose(); }}>
    <div className="progress-access-heading"><div><p className="text-xs font-semibold text-t-amber-bright">t.ROY · your AI coach</p><h2 id="progress-access-title" className="mt-1 text-xl font-bold text-t-white">{title}</h2></div><button type="button" onClick={onClose} aria-label="Close access request" className="t-focus min-h-touch px-3 text-t-phos-dim">Close</button></div>
    <div className="mt-4 space-y-4 text-sm text-t-phos">
      <p id="progress-access-description">{reply ? "Answer Troy’s question in your own words. You choose what to share." : kind === "feedback" || kind === "bug" ? "Tell us what happened and what would help. You will review the summary before sending it to Troy." : kind === "ai_bonus" ? "Tell me what you want to finish. Extra actions depend on approved rewards and account limits." : step.reason || "This guided tool normally follows saved preparation. Tell me why opening it now would help."}</p>
      <p className="text-xs text-t-phos-dim">Early access opens a tool. It does not mark the preparation completed. You do not need to share personal hardship.</p>
      {reply?.decisionNote ? <p className="border-l-2 border-t-amber pl-3">Troy asked: {reply.decisionNote}</p> : null}
      {!complete ? <form onSubmit={(event) => { event.preventDefault(); void submit(needsReview || !!reply); }} className="space-y-4">
        <label className="block font-medium text-t-white">{reply ? "Your reply" : "What do you need to do?"}
          <textarea autoFocus required minLength={5} maxLength={1000} rows={4} disabled={sending || needsReview} value={reason} onChange={(event) => { setReason(event.target.value); setResult(null); setConsent(false); if (!reply) key.current = null; }} className="t-focus mt-2 block w-full resize-y border border-t-line bg-t-panel-2 px-3 py-2 font-normal text-t-white disabled:opacity-75" />
          <span className="mt-1 block text-xs font-normal text-t-phos-dim">{reason.trim().length > 0 && reason.trim().length < 5 ? "Add a little more so I know what you need." : "A short sentence is enough."}</span>
        </label>
        {needsReview ? <div className="space-y-3 border border-t-line bg-t-panel-2 p-4">
          <p className="font-semibold text-t-white">Troy needs to review this request.</p>
          <p>{result.message}</p>
          <div><p className="text-xs font-semibold text-t-phos-dim">Summary Troy will see</p><p className="mt-1 whitespace-pre-wrap break-words">{result.summary || `${title}: ${reason.trim()}`}</p></div>
          <p className="text-xs text-t-phos-dim">This shares the request and selected tool. Your chat transcript is not attached. There is no promised response time.</p>
          <label className="flex items-start gap-2"><input type="checkbox" checked={consent} disabled={sending} onChange={(event) => setConsent(event.target.checked)} className="t-focus mt-1" /><span>I agree to share this summary with Troy for review.</span></label>
          <button type="button" disabled={sending} onClick={() => { setResult(null); setConsent(false); if (!reply) key.current = null; }} className="t-focus min-h-touch text-xs underline">Edit my reason</button>
        </div> : null}
        {reply ? <div className="space-y-3 border border-t-line p-3"><p className="text-xs text-t-phos-dim">Your reply above will be added to this existing request. No chat transcript is attached.</p><label className="flex items-start gap-2"><input type="checkbox" checked={consent} disabled={sending} onChange={(event) => setConsent(event.target.checked)} className="t-focus mt-1" /><span>I agree to send this reply to Troy.</span></label></div> : null}
        {error ? <p role="alert" className="border border-t-red p-3 text-t-red">{error}</p> : null}
        <div className="flex flex-wrap items-center justify-between gap-3"><button type="button" onClick={onClose} className="t-focus min-h-touch px-3 text-t-phos-dim underline">Keep working</button><button type="submit" disabled={sending || reason.trim().length < 5 || ((needsReview || !!reply) && !consent)} className="t-focus min-h-touch bg-t-amber px-4 py-2 font-semibold text-white disabled:opacity-50">{sending ? "Checking..." : reply ? "Send reply to Troy" : needsReview ? "Send request to Troy" : "Ask t.ROY"}</button></div>
      </form> : <div role="status" className="space-y-3 border border-t-line p-4"><p className="font-semibold text-t-white">{result.outcome === "granted" ? kind === "ai_bonus" ? "Your allowance was updated." : "Early access is open." : result.outcome === "pending" ? "Your request is saved for review." : "This request was not granted."}</p><p>{result.message}</p>{result.outcome === "granted" && kind === "unlock" ? <p className="text-xs text-t-phos-dim">Your progress still reflects the work you have saved.</p> : null}<button type="button" onClick={onClose} className="t-focus min-h-touch bg-t-amber px-4 py-2 font-semibold text-white">Keep going</button></div>}
    </div>
  </dialog>, document.body);
}
