"use client";

/**
 * "Leave this organization", one organization at a time (migration 093,
 * smr_leave_org). Asks once, says plainly what happens, then reloads.
 */
import { useState } from "react";
import { useSession } from "next-auth/react";

export const LEAVE_ORG_CONFIRM =
  "Leave this organization? They stop seeing anything you shared with them. Your own work stays yours. The seat is not handed back, and if this organization gave you your Refinery seat, you may need a new one to keep using the Refinery.";

export function LeaveOrgButton({ orgId, orgName }: { orgId: string; orgName: string }) {
  const { update } = useSession();
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function leave() {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/access-code/leave", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orgId }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error || "That did not save. Try again.");
      // The seat claim is read again from the database (auth.ts jwt update).
      await update().catch(() => undefined);
      window.location.reload();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "That did not save. Try again.");
      setBusy(false);
    }
  }

  if (!asking) {
    return (
      <button type="button" onClick={() => setAsking(true)} className="t-focus min-h-touch text-xs text-t-phos-dim underline underline-offset-2 hover:text-t-white">
        Leave this organization
      </button>
    );
  }
  return (
    <div role="alertdialog" aria-label={`Leave ${orgName}`} className="mt-2 border border-t-line bg-t-panel-2 p-3 text-sm text-t-phos">
      <p>{LEAVE_ORG_CONFIRM}</p>
      {error && <p role="alert" className="mt-2 text-t-red">{error}</p>}
      <div className="mt-3 flex gap-3">
        <button type="button" disabled={busy} onClick={() => void leave()} className="t-focus min-h-touch border border-t-red px-3 py-2 text-sm font-semibold text-t-red disabled:opacity-50">
          {busy ? "Leaving..." : `Leave ${orgName}`}
        </button>
        <button type="button" disabled={busy} onClick={() => setAsking(false)} className="t-focus min-h-touch border border-t-line px-3 py-2 text-sm text-t-phos">
          Stay
        </button>
      </div>
    </div>
  );
}
