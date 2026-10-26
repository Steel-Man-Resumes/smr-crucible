"use client";

import { useEffect, useRef, useState } from "react";
import { useSession } from "next-auth/react";
import { PasswordInput } from "@/components/auth/PasswordInput";
import type { DeleteMode } from "@/lib/deletion-confirmation";

/** Each destructive action owns its proof field, explanation and inline error. */
export function DeleteDataControls({ isOrgStaff, onDeleted }: {
  isOrgStaff: boolean;
  onDeleted: () => Promise<void>;
}) {
  const { data: session } = useSession();
  const userId = session?.user?.id;
  const [mode, setMode] = useState<DeleteMode | null>(null);
  const [hasPassword, setHasPassword] = useState<boolean | null>(null);
  const [password, setPassword] = useState("");
  const [typed, setTyped] = useState("");
  const [error, setError] = useState("");
  const [requirementsError, setRequirementsError] = useState("");
  const [retry, setRetry] = useState(0);
  const [deleting, setDeleting] = useState(false);
  const [deleted, setDeleted] = useState(false);
  const [signOutError, setSignOutError] = useState(false);
  const inFlight = useRef(false);

  useEffect(() => {
    setHasPassword(null);
    setRequirementsError("");
    if (!mode || !userId) return;
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch("/api/user/security-status", { cache: "no-store", signal: controller.signal });
        const data = await response.json();
        if (!response.ok || data.userId !== userId || typeof data.hasPassword !== "boolean") throw new Error("unavailable");
        if (!controller.signal.aborted) setHasPassword(data.hasPassword);
      } catch {
        if (!controller.signal.aborted) setRequirementsError("We couldn't check the confirmation this account needs. Try again.");
      }
    })();
    return () => controller.abort();
  }, [mode, userId, retry]);

  function choose(next: DeleteMode | null) {
    if (inFlight.current) return;
    setMode(next);
    setPassword("");
    setTyped("");
    setError("");
    setHasPassword(null);
  }

  async function finish() {
    setSignOutError(false);
    try {
      await onDeleted();
    } catch {
      setSignOutError(true);
    }
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!mode || !userId || hasPassword === null || inFlight.current || deleted) return;
    if (hasPassword ? !password : typed !== "DELETE") return;
    inFlight.current = true;
    setDeleting(true);
    setError("");
    try {
      const response = await fetch("/api/user/delete-data", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          confirm: true,
          expectedUserId: userId,
          deleteAccount: mode === "account",
          ...(hasPassword ? { password } : { typedConfirmation: typed }),
        }),
      });
      const result = await response.json().catch(() => null);
      if (!response.ok || result?.success !== true) {
        if (result?.code === "password_required" || result?.code === "password_incorrect") setHasPassword(true);
        if (result?.code === "confirmation_required") setHasPassword(false);
        setError(result?.error || "Deletion did not finish. You can retry; some data may already have been removed.");
        return;
      }
      setPassword("");
      setTyped("");
      setDeleted(true);
      await finish();
    } catch {
      setError("We couldn't confirm whether deletion finished. You can retry; some data may already have been removed.");
    } finally {
      inFlight.current = false;
      setDeleting(false);
    }
  }

  if (deleted) {
    return <div className="border border-t-line bg-t-panel p-5" role="status">
      <p className="text-t-white">{mode === "account" ? "Your account was deleted." : "Your data was deleted. Your login stays."}</p>
      {signOutError ? <>
        <p className="mt-2 text-sm text-t-phos-dim">Sign-out did not finish. You do not need to delete again.</p>
        <button type="button" onClick={() => void finish()} className="t-focus mt-3 min-h-touch text-t-amber-bright underline">Finish signing out</button>
      </> : <p className="mt-2 text-sm text-t-phos-dim">Signing you out...</p>}
    </div>;
  }

  return <>
    {(["data", "account"] as const).map((action) => {
      const active = mode === action;
      const id = `delete-${action}`;
      return <div key={action} className="border border-t-red bg-t-panel p-5" id={id}>
        <h3 className="font-semibold text-t-white">{action === "data" ? "Delete my data" : "Delete my account"}</h3>
        <p className="mt-1 text-sm text-t-phos-dim">
          {action === "account"
            ? "Remove your saved work and your login. You will be signed out. This cannot be undone."
            : isOrgStaff
              ? "Erase data belonging to your account and remove your program links. Other people's records stay. Your login stays. This cannot be undone."
              : "Erase your saved work and history and remove your program links. Your login stays, so you can start again. This cannot be undone."}
        </p>
        {!active ? <button type="button" disabled={deleting || !userId} onClick={() => choose(action)} className="t-focus mt-3 min-h-touch border border-t-red px-4 py-2 text-sm text-t-red disabled:opacity-50">
          {action === "data" ? "Delete data" : "Delete account"}
        </button> : <form onSubmit={submit} className="mt-4 space-y-3" aria-label={action === "data" ? "Confirm data deletion" : "Confirm account deletion"}>
          <p className="break-words text-sm text-t-white">Account: {session?.user?.email || "your signed-in account"}</p>
          {requirementsError ? <div>
            <p role="alert" className="text-sm text-t-red">{requirementsError}</p>
            <button type="button" onClick={() => setRetry((n) => n + 1)} className="t-focus min-h-touch text-sm text-t-amber-bright underline">Check again</button>
          </div> : hasPassword === null ? <p role="status" className="text-sm text-t-phos-dim">Checking this account...</p> : hasPassword ? <>
            <p id={`${id}-help`} className="text-sm text-t-phos-dim">This account has a password. Enter it here to confirm deletion, even if you signed in with an email link or Google.</p>
            <label htmlFor={`${id}-password`} className="block text-sm text-t-white">Current account password</label>
            <PasswordInput id={`${id}-password`} value={password} onChange={(event) => { setPassword(event.target.value); setError(""); }} autoComplete="current-password" required disabled={deleting} aria-describedby={`${id}-help`} className="w-full min-h-touch border border-t-line bg-t-bg px-3 py-2 text-sm text-t-white" />
            <a href="/forgot-password" className="t-focus inline-block min-h-touch py-2 text-sm text-t-amber-bright underline">Forgot your password? Reset it first</a>
          </> : <>
            <p id={`${id}-help`} className="text-sm text-t-phos-dim">This account has no password. Type DELETE below to confirm deletion.</p>
            <label htmlFor={`${id}-confirmation`} className="block text-sm text-t-white">Type DELETE</label>
            <input id={`${id}-confirmation`} value={typed} onChange={(event) => { setTyped(event.target.value); setError(""); }} autoComplete="off" spellCheck={false} required disabled={deleting} aria-describedby={`${id}-help`} className="w-full min-h-touch border border-t-line bg-t-bg px-3 py-2 text-sm text-t-white" />
          </>}
          {error && <p role="alert" className="text-sm text-t-red">{error}</p>}
          <div className="flex flex-wrap gap-3">
            <button type="button" disabled={deleting} onClick={() => choose(null)} className="t-focus min-h-touch px-3 py-2 text-sm text-t-phos-dim">Cancel</button>
            <button type="submit" disabled={deleting || !userId || hasPassword === null || (hasPassword ? !password : typed !== "DELETE")} className="t-focus min-h-touch bg-t-red px-4 py-2 text-sm font-bold text-white disabled:opacity-50">
              {deleting ? "Deleting..." : action === "data" ? "Permanently delete my data" : "Permanently delete my account"}
            </button>
          </div>
        </form>}
      </div>;
    })}
  </>;
}
