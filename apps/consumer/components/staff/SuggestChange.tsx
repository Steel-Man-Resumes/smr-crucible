"use client";
/**
 * <SuggestChange> (staff pass 2026-10-27, lane S2): the "Suggest a change to
 * your organization" form on My setup. Posts through lib/change-request-client.ts
 * to lane S4's route; My setup mounts it only when that route is merged
 * (STAFF_FEATURES.changeRequests).
 */
import { useState } from "react";
import { CHANGE_REQUEST_AREAS, CHANGE_REQUEST_MAX, changeRequestError, sendChangeRequest, type ChangeRequestArea } from "@/lib/change-request-client";

const card = "bg-t-panel border border-t-line p-5";

/** "Suggest a change to your organization": a plain note to the people who run it. */
export function SuggestChange() {
  const [area, setArea] = useState<ChangeRequestArea | "">("");
  const [text, setText] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = useState<string | null>(null);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (state === "sending") return;
    const problem = changeRequestError(area, text);
    if (problem) { setError(problem); return; }
    setState("sending"); setError(null);
    const res = await sendChangeRequest(area as ChangeRequestArea, text);
    if (res.ok) { setState("sent"); setText(""); setArea(""); }
    else { setState("idle"); setError(res.error); }
  }

  return (
    <section id="suggest" aria-labelledby="suggest-h" className={`${card} mb-8 scroll-mt-32`}>
      <h2 id="suggest-h" className="text-lg font-bold text-t-white mb-1">Suggest a change to your organization</h2>
      <p className="text-sm text-t-phos-dim mb-4">
        Fields, layouts, programs and what staff can change are set by the people who run your organization. Tell them what would help. Their answer comes back to you.
      </p>
      {state === "sent" ? (
        <div role="status" className="text-sm text-t-white">
          <p>Sent. You will see their answer when they reply.</p>
          <button type="button" onClick={() => setState("idle")} className="t-focus mt-3 text-sm font-semibold text-t-amber-bright underline underline-offset-4">Suggest something else</button>
        </div>
      ) : (
        <form onSubmit={send} className="space-y-3">
          <div>
            <label htmlFor="suggest-area" className="block text-sm font-semibold text-t-white mb-1">What is it about?</label>
            <select id="suggest-area" value={area} onChange={(e) => setArea(e.target.value as ChangeRequestArea | "")}
              className="t-focus w-full sm:w-80 min-h-touch bg-t-panel-2 border border-t-line text-sm text-t-white px-3 py-2">
              <option value="">Pick one</option>
              {CHANGE_REQUEST_AREAS.map((a) => <option key={a.key} value={a.key}>{a.label}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="suggest-text" className="block text-sm font-semibold text-t-white mb-1">What should change, and why would it help?</label>
            <p id="suggest-text-help" className="text-xs text-t-phos-dim mb-2">Leave out the names and record details of the people you serve.</p>
            <textarea id="suggest-text" value={text} onChange={(e) => setText(e.target.value)} rows={4} maxLength={CHANGE_REQUEST_MAX}
              aria-describedby="suggest-text-help" placeholder="For example: show Retention check-ins first on Today for case managers. We miss them on busy days."
              className="t-focus w-full bg-t-panel-2 border border-t-line text-sm text-t-white px-3 py-2" />
          </div>
          {error && <p role="alert" className="text-sm text-t-amber-bright">{error}</p>}
          <button type="submit" disabled={state === "sending"}
            className="t-focus min-h-touch bg-t-amber text-[#14100a] text-sm font-semibold px-4 py-2 disabled:opacity-50">
            {state === "sending" ? "Sending..." : "Send suggestion"}
          </button>
        </form>
      )}
    </section>
  );
}
