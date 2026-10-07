"use client";

/**
 * Saves the Forge run in this browser to the account once someone is signed
 * in (fully: never while a second step is owed), and clears a run that is
 * marked for an account once nobody is signed in. The rules, including when to
 * ask, are in lib/forge-import.ts. This is the only way a run in this browser
 * enters an account.
 *
 * Renders nothing unless it has to ask, or has just saved someone's earlier
 * work (one quiet line).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { useSession } from "next-auth/react";
import { useForgeSession } from "@/lib/forge-context";
import {
  LAST_SYNCED_RUN_KEY,
  afterSave,
  importDecision,
  importPayload,
  importQuestion,
  runHasAnswers,
  runLevel,
  signedOutDecision,
  type RunLevel,
} from "@/lib/forge-import";
import { sessionPending } from "@/lib/session-policy";
import { signOutOfForge } from "./ForgeAccountBar";

const MAX_TRIES_PER_PAGE = 2;

export function ForgeImport({ showPrompt = true }: { showPrompt?: boolean }) {
  const { data, status } = useSession();
  const { session: run, updateSession, clearSession } = useForgeSession();
  const pathname = usePathname();
  const authUser = data?.user as { id?: string; name?: string | null; email?: string | null; mfa?: unknown; claim?: unknown } | undefined;
  const user =
    status === "authenticated" && authUser?.id && !sessionPending(authUser)
      ? { id: authUser.id, name: authUser.name ?? null, email: authUser.email ?? null }
      : null;

  const [asking, setAsking] = useState<{ level: RunLevel; name: string | null } | null>(null);
  const [note, setNote] = useState<"" | "saved" | "failed">("");
  const busy = useRef(false);
  const tries = useRef(0);
  // Whether the run, the last time this tab looked while this account was
  // signed in, was empty or already this account's (lib/forge-import.ts).
  const madeHere = useRef<{ userId: string; ok: boolean } | null>(null);

  useEffect(() => {
    tries.current = 0;
  }, [pathname]);

  const save = useCallback(
    async (level: RunLevel, announce: boolean) => {
      if (!user || busy.current || tries.current >= MAX_TRIES_PER_PAGE) return;
      busy.current = true;
      tries.current += 1;
      const snapshot = run as Record<string, any>;
      try {
        const res = await fetch("/api/forge/save", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(importPayload(snapshot)),
        });
        if (!res.ok) throw new Error(String(res.status));
        updateSession(afterSave(snapshot, user.id, level) as any);
        if (level === 2 && snapshot.startedAt) {
          try {
            localStorage.setItem(LAST_SYNCED_RUN_KEY, snapshot.startedAt);
          } catch {
            // storage unavailable: the run's own marks still record the save
          }
        }
        if (announce) setNote("saved");
      } catch {
        // The run is still in this browser; the next page tries again.
        if (announce) setNote("failed");
      } finally {
        busy.current = false;
      }
    },
    [run, updateSession, user?.id] // eslint-disable-line react-hooks/exhaustive-deps
  );

  const r = run as Record<string, any>;
  const level = runLevel(r);
  const owner = r._ownerUserId;
  const synced = r._syncedLevel;
  const answered = runHasAnswers(r);

  useEffect(() => {
    // Nobody signed in: a run marked for an account is that account's. Clear
    // it before the next person at this computer can see it or sign up with it.
    if (status === "unauthenticated") {
      madeHere.current = null;
      if (signedOutDecision(run) === "clear") clearSession();
      return;
    }
    if (!user || busy.current || asking) return;
    const seen = madeHere.current;
    const d = importDecision(run, user, { madeHere: !!seen && seen.userId === user.id && seen.ok });
    if (d.action === "claim") updateSession({ _ownerUserId: user.id });
    else if (d.action === "clear") clearSession();
    else if (d.action === "save") void save(d.level, !owner);
    else if (d.action === "ask") setAsking({ level: d.level, name: d.name });
    // What this tab saw, for the next look: anything but an open question
    // means the run in hand is empty or this account's from here on.
    madeHere.current = { userId: user.id, ok: d.action !== "ask" };
  }, [status, user?.id, pathname, level, owner, synced, answered, r.startedAt]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!user) return null;

  if (asking && showPrompt) {
    return (
      <div className="mx-auto w-full max-w-2xl px-4 pt-4 sm:px-6" data-testid="forge-import-ask">
        <div role="dialog" aria-labelledby="forge-import-title" className="rounded-[5px] border border-t-amber bg-t-panel p-4 sm:p-5">
          <p id="forge-import-title" className="text-base font-semibold text-t-white">
            {importQuestion(user.email, asking.name)}
          </p>
          <p className="mt-1 text-sm leading-relaxed text-t-bone-dim">
            If it&apos;s yours, we save it there so you don&apos;t lose it. If it isn&apos;t, we clear it from this computer.
          </p>
          <div className="mt-4 flex flex-col gap-2 sm:flex-row">
            <button
              type="button"
              onClick={() => {
                const level = asking.level;
                setAsking(null);
                madeHere.current = { userId: user.id, ok: true };
                void save(level, true);
              }}
              className="t-focus min-h-touch rounded-[5px] border border-ws-amber bg-ws-amber px-4 text-sm font-semibold text-ws-bg hover:bg-ws-amber-bright"
            >
              Yes, save it to my account
            </button>
            <button
              type="button"
              onClick={() => {
                setAsking(null);
                madeHere.current = { userId: user.id, ok: true };
                clearSession();
              }}
              className="t-focus min-h-touch rounded-[5px] border border-t-line px-4 text-sm font-medium text-t-white hover:border-t-line-strong"
            >
              No, clear it
            </button>
          </div>
          <p className="mt-3 text-sm text-t-bone-dim">
            {user.email ? `Not ${user.email}? ` : "Not your account? "}
            <button
              type="button"
              onClick={() => void signOutOfForge({ clearRun: true })}
              className="t-focus min-h-touch font-medium text-t-white underline underline-offset-4"
              data-testid="forge-import-sign-out"
            >
              Sign out
            </button>
          </p>
        </div>
      </div>
    );
  }

  if (note) {
    return (
      <div className="mx-auto w-full max-w-2xl px-4 pt-4 sm:px-6">
        <p role="status" data-testid="forge-import-note" className="flex items-center justify-between gap-3 rounded-[5px] border border-t-line bg-t-panel px-4 py-2 text-sm text-t-white">
          {note === "saved"
            ? "Your work so far is saved to your account."
            : "We couldn't save your work to your account yet. It's still on this computer, and we'll try again."}
          <button
            type="button"
            onClick={() => setNote("")}
            className="t-focus min-h-touch px-2 text-sm text-t-bone-dim hover:text-t-white"
            aria-label="Dismiss"
          >
            OK
          </button>
        </p>
      </div>
    );
  }

  return null;
}
