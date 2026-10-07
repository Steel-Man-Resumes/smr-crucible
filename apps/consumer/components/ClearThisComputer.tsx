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

import { useState } from "react";
import { signOut, useSession } from "next-auth/react";
import { Eraser } from "lucide-react";
import { clearThisComputer, useForgeSession } from "@/lib/forge-context";

const LEAVE_TO = "https://steelmanresumes.com";

/** Plain hint beside the control: who it is for. */
const CLEAR_HINT = "(if you're on a public or shared computer)";

async function clearAndLeave(signedIn: boolean) {
  clearThisComputer();
  if (signedIn) {
    try {
      await signOut({ redirect: false });
    } catch {
      // The storage is already gone; leave anyway.
    }
  }
  window.location.replace(LEAVE_TO);
}

function hasForgeWork(session: Record<string, unknown>): boolean {
  return Object.keys(session).some(
    (k) => k !== "lastPageVisited" && k !== "pagesVisited" && k !== "_savedAt"
  );
}

/** Compact header button. Shows only once there is something to clear. */
export function ClearThisComputerButton() {
  const { session, clearSession } = useForgeSession();
  const { status } = useSession();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  if (!hasForgeWork(session as Record<string, unknown>)) return null;

  if (confirming) {
    return (
      <div className="flex items-center gap-2" role="group" aria-label="Clear this computer">
        <button
          type="button"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            clearSession();
            await clearAndLeave(status === "authenticated");
          }}
          className="t-focus inline-flex min-h-touch items-center rounded-[5px] border border-t-red bg-transparent px-3 py-2 text-sm font-medium whitespace-nowrap text-t-red transition-colors hover:bg-t-red hover:text-white disabled:opacity-60"
        >
          {busy ? "Clearing..." : "Yes, erase it"}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => setConfirming(false)}
          className="t-focus inline-flex min-h-touch items-center rounded-[5px] px-2 py-2 text-sm text-t-bone-dim hover:text-t-white"
        >
          Cancel
        </button>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setConfirming(true)}
      className="t-focus inline-flex min-h-touch items-center gap-2 rounded-[5px] border border-ws-bg/25 bg-transparent px-3 py-1.5 text-left text-sm font-medium text-t-bone-dim transition-colors hover:border-ws-bg/60 hover:text-ws-bg"
      aria-label={`Clear this computer: erase your Forge work from this browser ${CLEAR_HINT}`}
      title={`Erase your Forge work from this browser ${CLEAR_HINT}`}
    >
      <Eraser size={17} aria-hidden="true" className="flex-none" />
      <span className="flex flex-col leading-tight">
        <span>
          <span className="sm:hidden">Clear</span>
          <span className="hidden sm:inline">Clear this computer</span>
        </span>
        <span className="hidden text-[11px] font-normal sm:block">{CLEAR_HINT}</span>
      </span>
    </button>
  );
}

/** The end-of-run panel on the results page. */
export function ClearThisComputerPanel() {
  const { clearSession } = useForgeSession();
  const { status } = useSession();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  return (
    <div className="mt-8 border border-t-line bg-t-panel p-6">
      <h3 className="mb-2 text-lg font-bold leading-snug text-t-white">
        Using a library or shared computer?
      </h3>
      <p className="mb-4 text-sm leading-relaxed text-t-phos-dim">
        Your work is saved in this browser, not on our servers. Anyone who sits
        down here after you could open it. Download it, email it to yourself, or
        make your free account first. Then clear it before you walk away. This
        browser also forgets it on its own after a day with no use.
      </p>
      {confirming ? (
        <div className="flex flex-col gap-2 sm:flex-row">
          <button
            type="button"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              clearSession();
              await clearAndLeave(status === "authenticated");
            }}
            className="t-focus flex-1 border border-t-red px-4 py-3 text-sm font-semibold text-t-red transition-colors hover:bg-t-red hover:text-white disabled:opacity-60"
          >
            {busy ? "Clearing..." : "Yes, erase my work from this computer"}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => setConfirming(false)}
            className="t-focus flex-1 border border-t-line px-4 py-3 text-sm font-medium text-t-phos-dim transition-colors hover:border-t-phos-dim hover:text-t-white"
          >
            Not yet
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="t-focus inline-flex w-full items-center justify-center gap-2 border border-t-line px-4 py-3 text-sm font-semibold text-t-white transition-colors hover:border-t-phos-dim"
        >
          <Eraser size={17} aria-hidden="true" />
          Done, clear this computer
        </button>
      )}
    </div>
  );
}
