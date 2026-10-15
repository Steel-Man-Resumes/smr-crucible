"use client";
import { useRef, useState } from "react";

/** A model tool can propose; only the person's button invokes the authenticated write. */
export function AssistantActionCard({ result, onSaved }: { result: Record<string, unknown>; onSaved: (message: string, revisionId?: string) => void }) {
  const [state, setState] = useState<"ready" | "saving" | "saved" | "error">("ready");
  const busy = useRef(false);
  const [error, setError] = useState("");
  const correction = result.action === "correct_document";
  const save = async () => {
    if (busy.current || state === "saved") return;
    busy.current = true; setState("saving");
    try {
      const response = await fetch(correction ? "/api/assistant/correction" : "/api/resource-lists", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(correction
          ? { confirmed: true, revisionId: result.revisionId, before: result.before, after: result.after }
          : { serviceIds: result.serviceIds, chainKeys: result.chainKeys }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Saving failed. Reopen the page to check your saved work before trying again.");
      setState("saved");
      onSaved(correction ? `The correction was saved as a ${data.status} revision. I will review it on the document page.` : "The selected resources were saved. This does not mean I contacted or received the services.", correction ? data.revisionId : undefined);
    } catch (e) { setState("error"); setError(e instanceof Error ? e.message : "Could not save."); }
    finally { busy.current = false; }
  };
  return <div className="rounded-md border border-gray-300 bg-white p-3 text-sm text-gray-900">
    {correction ? <><p className="font-medium">Review this correction</p><p className="mt-2 whitespace-pre-wrap">Before: {String(result.before ?? "")}</p><p className="mt-2 whitespace-pre-wrap">After: {String(result.after ?? "")}</p><p className="mt-2 text-xs">Confirm the wording is true. The saved revision still goes through the document checks.</p></> : <><p className="font-medium">Save these resources?</p><p>{Array.isArray(result.names) ? result.names.map(String).join(", ") : "Selected services and steps"}</p></>}
    {state === "error" && <p role="alert" className="mt-2 text-red-700">{error}</p>}
    <button type="button" disabled={state === "saving" || state === "saved" || state === "error"} onClick={save} className="mt-3 min-h-touch rounded border border-gray-400 px-3 py-2 disabled:opacity-60">{state === "saved" ? "Saved" : state === "saving" ? "Saving..." : correction ? "Apply this correction" : "Save resources"}</button>
  </div>;
}
