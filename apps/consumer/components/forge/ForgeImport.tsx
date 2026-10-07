"use client";

/**
 * Saves the Forge run in this browser to the account once someone is signed
 * in (fully: never while a second step is owed). The rules, including when to
 * ask "Is this yours?", are in lib/forge-import.ts.
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
  runLevel,
  type RunLevel,
} from "@/lib/forge-import";
import { isSamePerson } from "@/lib/is-same-person";
import { sessionPending } from "@/lib/session-policy";

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

  const level = runLevel(run as Record<string, any>);
  const owner = (run as Record<string, any>)._ownerUserId;
  const synced = (run as Record<string, any>)._syncedLevel;

  useEffect(() => {
    if (!user || busy.current || asking) return;
    const d = importDecision(run, user, isSamePerson);
    if (d.action === "claim") updateSession({ _ownerUserId: user.id });
    else if (d.action === "clear") clearSession();
    else if (d.action === "save") void save(d.level, !owner);
    else if (d.action === "ask") setAsking({ level: d.level, name: d.name });
  }, [user?.id, pathname, level, owner, synced]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!user) return null;

  if (asking && showPrompt) {
    return (
      <div className="mx-auto w-full max-w-2xl px-4 pt-4 sm:px-6" data-testid="forge-import-ask">
        <div role="dialog" aria-labelledby="forge-import-title" className="rounded-[5px] border border-t-amber bg-t-panel p-4 sm:p-5">
          <p id="forge-import-title" className="text-base font-semibold text-t-white">
            This computer has a resume in progress{asking.name ? ` for ${asking.name}` : ""}. Is it yours?
          </p>
          <p className="mt-1 text-sm leading-relaxed text-t-bone-dim">
            If it is, we save it to your account so you don&apos;t lose it. If it isn&apos;t, we clear it from this computer.
          </p>
          <div className="mt-4 flex flex-col gap-2 sm:flex-row">
            <button
              type="button"
              onClick={() => {
                const level = asking.level;
                setAsking(null);
                void save(level, true);
              }}
              className="t-focus min-h-touch rounded-[5px] border border-ws-amber bg-ws-amber px-4 text-sm font-semibold text-ws-bg hover:bg-ws-amber-bright"
            >
              Yes, it&apos;s mine. Save it.
            </button>
            <button
              type="button"
              onClick={() => {
                setAsking(null);
                clearSession();
              }}
              className="t-focus min-h-touch rounded-[5px] border border-t-line px-4 text-sm font-medium text-t-white hover:border-t-line-strong"
            >
              No, clear it
            </button>
          </div>
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
