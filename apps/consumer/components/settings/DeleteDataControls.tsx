"use client";

import { useEffect, useRef, useState } from "react";
import { useSession } from "next-auth/react";
import { useTranslations } from "next-intl";
import { PasswordInput } from "@/components/auth/PasswordInput";
import type { DeleteMode } from "@/lib/deletion-confirmation";

/** Each destructive action owns its proof field, explanation and inline error. */
export function DeleteDataControls({ isOrgStaff, onDeleted }: {
  isOrgStaff: boolean;
  onDeleted: () => Promise<void>;
}) {
  const t = useTranslations("refineryAccount.deleteData");
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
        if (!controller.signal.aborted) setRequirementsError(t("requirementsError"));
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
        setError(result?.error || t("notFinished"));
        return;
      }
      setPassword("");
      setTyped("");
      setDeleted(true);
      await finish();
    } catch {
      setError(t("unconfirmed"));
    } finally {
      inFlight.current = false;
      setDeleting(false);
    }
  }

  if (deleted) {
    return <div className="border border-t-line bg-t-panel p-5" role="status">
      <p className="text-t-white">{mode === "account" ? t("accountDeleted") : t("dataDeleted")}</p>
      {signOutError ? <>
        <p className="mt-2 text-sm text-t-phos-dim">{t("signOutFailed")}</p>
        <button type="button" onClick={() => void finish()} className="t-focus mt-3 min-h-touch text-t-amber-bright underline">{t("finishSignOut")}</button>
      </> : <p className="mt-2 text-sm text-t-phos-dim">{t("signingOut")}</p>}
    </div>;
  }

  return <>
    {(["data", "account"] as const).map((action) => {
      const active = mode === action;
      const id = `delete-${action}`;
      return <div key={action} className="border border-t-red bg-t-panel p-5" id={id} data-tour={action === "data" ? "settings-delete-data" : "settings-delete-account"}>
        <h3 className="font-semibold text-t-white">{action === "data" ? t("data.title") : t("account.title")}</h3>
        <p className="mt-1 text-sm text-t-phos-dim">
          {action === "account"
            ? t("account.body")
            : isOrgStaff
              ? t("data.bodyStaff")
              : t("data.body")}
        </p>
        {!active ? <button type="button" disabled={deleting || !userId} onClick={() => choose(action)} className="t-focus mt-3 min-h-touch border border-t-red px-4 py-2 text-sm text-t-red disabled:opacity-50">
          {action === "data" ? t("data.button") : t("account.button")}
        </button> : <form onSubmit={submit} className="mt-4 space-y-3" aria-label={action === "data" ? t("data.confirmAria") : t("account.confirmAria")}>
          <p className="break-words text-sm text-t-white">{t("accountLine", { account: session?.user?.email || t("yourAccount") })}</p>
          {requirementsError ? <div>
            <p role="alert" className="text-sm text-t-red">{requirementsError}</p>
            <button type="button" onClick={() => setRetry((n) => n + 1)} className="t-focus min-h-touch text-sm text-t-amber-bright underline">{t("checkAgain")}</button>
          </div> : hasPassword === null ? <p role="status" className="text-sm text-t-phos-dim">{t("checking")}</p> : hasPassword ? <>
            <p id={`${id}-help`} className="text-sm text-t-phos-dim">{t("hasPassword")}</p>
            <label htmlFor={`${id}-password`} className="block text-sm text-t-white">{t("passwordLabel")}</label>
            <PasswordInput id={`${id}-password`} value={password} onChange={(event) => { setPassword(event.target.value); setError(""); }} autoComplete="current-password" required disabled={deleting} aria-describedby={`${id}-help`} className="w-full min-h-touch border border-t-line bg-t-bg px-3 py-2 text-sm text-t-white" />
            <a href="/forgot-password" className="t-focus inline-block min-h-touch py-2 text-sm text-t-amber-bright underline">{t("forgot")}</a>
          </> : <>
            <p id={`${id}-help`} className="text-sm text-t-phos-dim">{t("noPassword")}</p>
            <label htmlFor={`${id}-confirmation`} className="block text-sm text-t-white">{t("typeDelete")}</label>
            <input id={`${id}-confirmation`} value={typed} onChange={(event) => { setTyped(event.target.value); setError(""); }} autoComplete="off" spellCheck={false} required disabled={deleting} aria-describedby={`${id}-help`} className="w-full min-h-touch border border-t-line bg-t-bg px-3 py-2 text-sm text-t-white" />
          </>}
          {error && <p role="alert" className="text-sm text-t-red">{error}</p>}
          <div className="flex flex-wrap gap-3">
            <button type="button" disabled={deleting} onClick={() => choose(null)} className="t-focus min-h-touch px-3 py-2 text-sm text-t-phos-dim">{t("cancel")}</button>
            <button type="submit" disabled={deleting || !userId || hasPassword === null || (hasPassword ? !password : typed !== "DELETE")} className="t-focus min-h-touch bg-t-red px-4 py-2 text-sm font-bold text-white disabled:opacity-50">
              {deleting ? t("deleting") : action === "data" ? t("data.confirmButton") : t("account.confirmButton")}
            </button>
          </div>
        </form>}
      </div>;
    })}
  </>;
}
