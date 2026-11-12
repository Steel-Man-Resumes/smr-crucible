"use client";

/**
 * "Done, clear this computer": for people using the Forge on a library,
 * reentry-center or other shared computer. An anonymous run lives only in
 * this browser, so without this the next person at the keyboard could open
 * the last person's resume and record answers.
 *
 * Two steps (ask, then confirm) so nobody erases a finished package by a
 * stray tap. Clearing wipes this site's browser storage, signs out anyone
 * signed in, and leaves the Forge with a full page load so nothing stays in
 * memory either.
 */

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { Eraser } from "lucide-react";
import { useTranslations } from "next-intl";
import { clearThisComputer, useForgeSession } from "@/lib/forge-context";
import { confirmedSignOut } from "@/lib/confirmed-sign-out";

const LEAVE_TO = "https://steelmanresumes.com";

export async function clearAndLeave(signedIn: boolean, clearSession: () => void) {
  if (signedIn) {
    await confirmedSignOut();
  }
  clearSession();
  clearThisComputer();
  window.location.replace(LEAVE_TO);
}

function hasForgeWork(session: Record<string, unknown>): boolean {
  return Object.keys(session).some(
    (k) => k !== "lastPageVisited" && k !== "pagesVisited" && k !== "_savedAt"
  );
}

/** Compact header button. Shows only once there is something to clear. */
export function ClearThisComputerButton() {
  const t = useTranslations("ui.clearThisComputer");
  const tc = useTranslations("common.actions");
  // Plain hint beside the control: who it is for.
  const hint = t("hint");
  const { session, clearSession } = useForgeSession();
  const { status } = useSession();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // The saved run lives in browser storage, which the server never sees.
  // Decide after mount so the server and first browser render match.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  if (!mounted || (!confirming && !hasForgeWork(session as Record<string, unknown>))) return null;

  if (confirming) {
    return (
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label={t("groupAria")}>
        {error && <p role="alert" className="w-full text-sm text-t-red">{error}</p>}
        <button
          type="button"
          disabled={busy || status === "loading"}
          onClick={async () => {
            setBusy(true);
            setError("");
            try { await clearAndLeave(status === "authenticated", clearSession); }
            catch { setError(t("signOutError")); }
            finally { setBusy(false); }
          }}
          className="t-focus inline-flex min-h-touch items-center rounded-[5px] border border-t-red bg-transparent px-3 py-2 text-sm font-medium whitespace-nowrap text-t-red transition-colors hover:bg-t-red hover:text-white disabled:opacity-60"
        >
          {busy ? t("clearing") : t("confirmYes")}
        </button>
        <button
          type="button"
          disabled={busy || status === "loading"}
          onClick={() => setConfirming(false)}
          className="t-focus inline-flex min-h-touch items-center rounded-[5px] px-2 py-2 text-sm text-t-bone-dim hover:text-t-white"
        >
          {tc("cancel")}
        </button>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setConfirming(true)}
      className="t-focus inline-flex min-h-touch items-center gap-2 rounded-[5px] border border-ws-bg/25 bg-transparent px-3 py-1.5 text-left text-sm font-medium text-t-bone-dim transition-colors hover:border-ws-bg/60 hover:text-ws-bg"
      aria-label={t("buttonAria", { hint })}
      title={t("buttonTitle", { hint })}
    >
      <Eraser size={17} aria-hidden="true" className="flex-none" />
      <span className="flex flex-col leading-tight">
        <span>
          <span className="sm:hidden">{t("short")}</span>
          <span className="hidden sm:inline">{t("long")}</span>
        </span>
        <span className="hidden text-[11px] font-normal sm:block">{hint}</span>
      </span>
    </button>
  );
}

/** The end-of-run panel on the results page. */
export function ClearThisComputerPanel() {
  const t = useTranslations("ui.clearThisComputer");
  const { clearSession } = useForgeSession();
  const { status } = useSession();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  return (
    <div className="mt-8 border border-t-line bg-t-panel p-6">
      <h3 className="mb-2 text-lg font-bold leading-snug text-t-white">
        {t("panel.title")}
      </h3>
      <p className="mb-4 text-sm leading-relaxed text-t-phos-dim">
        {status === "authenticated"
          ? t("panel.signedInNote")
          : t("panel.anonymousNote")}
      </p>
      {error && <p role="alert" className="mb-3 text-sm text-t-red">{error}</p>}
      {confirming ? (
        <div className="flex flex-col gap-2 sm:flex-row">
          <button
            type="button"
            disabled={busy || status === "loading"}
            onClick={async () => {
              setBusy(true);
              setError("");
              try { await clearAndLeave(status === "authenticated", clearSession); }
              catch { setError(t("signOutError")); }
              finally { setBusy(false); }
            }}
            className="t-focus flex-1 border border-t-red px-4 py-3 text-sm font-semibold text-t-red transition-colors hover:bg-t-red hover:text-white disabled:opacity-60"
          >
            {busy ? t("clearing") : t("panel.confirmYes")}
          </button>
          <button
            type="button"
            disabled={busy || status === "loading"}
            onClick={() => setConfirming(false)}
            className="t-focus flex-1 border border-t-line px-4 py-3 text-sm font-medium text-t-phos-dim transition-colors hover:border-t-phos-dim hover:text-t-white"
          >
            {t("panel.notYet")}
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="t-focus inline-flex w-full items-center justify-center gap-2 border border-t-line px-4 py-3 text-sm font-semibold text-t-white transition-colors hover:border-t-phos-dim"
        >
          <Eraser size={17} aria-hidden="true" />
          {t("panel.start")}
        </button>
      )}
    </div>
  );
}
