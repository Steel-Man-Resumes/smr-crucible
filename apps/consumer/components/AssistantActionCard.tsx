"use client";
import { useRef, useState } from "react";
import { useTranslations } from "next-intl";

/** A model tool can propose; only the person's button invokes the authenticated write. */
export function AssistantActionCard({ result, onSaved }: { result: Record<string, unknown>; onSaved: (revisionId?: string) => void }) {
  const t = useTranslations("refineryShell.actionCard");
  const [state, setState] = useState<"ready" | "saving" | "saved" | "error">("ready");
  const busy = useRef(false);
  const [error, setError] = useState("");
  const [savedStatus, setSavedStatus] = useState("");
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
      if (!response.ok) throw new Error(data.error || t("savingFailed"));
      setSavedStatus(correction ? t("savedRevision", { status: data.status }) : t("savedResources"));
      setState("saved");
      onSaved(correction ? data.revisionId : undefined);
    } catch (e) { setState("error"); setError(e instanceof Error ? e.message : t("couldNotSave")); }
    finally { busy.current = false; }
  };
  return <div className="rounded-md border border-gray-300 bg-white p-3 text-sm text-gray-900">
    {correction ? <><p className="font-medium">{t("reviewTitle")}</p><p className="mt-2 whitespace-pre-wrap">{t("before")} {String(result.before ?? "")}</p><p className="mt-2 whitespace-pre-wrap">{t("after")} {String(result.after ?? "")}</p><p className="mt-2 text-xs">{t("confirmTrue")}</p></> : <><p className="font-medium">{t("saveTitle")}</p><p>{Array.isArray(result.names) ? result.names.map(String).join(", ") : t("selected")}</p></>}
    {state === "saved" && <p role="status" className="mt-2">{savedStatus}</p>}
    {state === "error" && <p role="alert" className="mt-2 text-red-700">{error}</p>}
    <button type="button" disabled={state === "saving" || state === "saved" || state === "error"} onClick={save} className="mt-3 min-h-touch rounded border border-gray-400 px-3 py-2 disabled:opacity-60">{state === "saved" ? t("saved") : state === "saving" ? t("saving") : correction ? t("apply") : t("saveButton")}</button>
  </div>;
}
