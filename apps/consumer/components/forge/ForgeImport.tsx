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
  IMPORT_QUESTION,
  importYesLabel,
  runHasAnswers,
  runLevel,
  signedOutDecision,
  type RunLevel,
} from "@/lib/forge-import";
import { sessionPending } from "@/lib/session-policy";
import { signOutOfForge } from "./ForgeAccountBar";
import { useImpersonating } from "./useImpersonating";

const MAX_TRIES_PER_PAGE = 2;

export function ForgeImport({ showPrompt = true }: { showPrompt?: boolean }) {
  const { data, status } = useSession();
  // The raw run (whoever's it is): this component is the one place that reads
  // it, in order to ask. Every page reads the owned view instead.
  const { rawSession: run, updateSession, clearSession } = useForgeSession();
  const pathname = usePathname();
  const authUser = data?.user as { id?: string; name?: string | null; email?: string | null; mfa?: unknown; claim?: unknown } | undefined;
  const user =
    status === "authenticated" && authUser?.id && !sessionPending(authUser)
      ? { id: authUser.id, name: authUser.name ?? null, email: authUser.email ?? null }
      : null;

  // An admin viewing as someone: this browser's run is the admin's, and the
  // account behind every Forge route is the person's. Nothing moves either
  // way until we know no one is being impersonated (M3).
  const impersonating = useImpersonating(!!user);
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
      if (!user || impersonating !== false || busy.current || tries.current >= MAX_TRIES_PER_PAGE) return;
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
    [run, updateSession, user?.id, impersonating] // eslint-disable-line react-hooks/exhaustive-deps
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
    if (impersonating !== false) return;
    const seen = madeHere.current;
    const d = importDecision(run, user, { madeHere: !!seen && seen.userId === user.id && seen.ok });
    if (d.action === "claim") updateSession({ _ownerUserId: user.id });
    else if (d.action === "clear") clearSession();
    else if (d.action === "save") void save(d.level, !owner);
    else if (d.action === "ask") setAsking({ level: d.level, name: d.name });
    // What this tab saw, for the next look: anything but an open question
    // means the run in hand is empty or this account's from here on.
    madeHere.current = { userId: user.id, ok: d.action !== "ask" };
  }, [status, user?.id, pathname, level, owner, synced, answered, r.startedAt, impersonating]); // eslint-disable-line react-hooks/exhaustive-deps

  // "Edit your resume" from the Refinery (lib/refinery-guards.ts
  // EDIT_RESUME_HREF): open this account's own saved resume, never the run on
  // this computer. Only when the browser holds nothing anyone told us (or the
  // person just said the run here is not theirs and it was erased); a run with
  // answers is asked about first, above, and stays hidden until then.
  const loadedFromAccount = useRef(false);
  const [fromRefinery, setFromRefinery] = useState(false);
  useEffect(() => {
    try {
      setFromRefinery(new URLSearchParams(window.location.search).get("from") === "refinery");
    } catch {
      setFromRefinery(false);
    }
  }, [pathname]);
  useEffect(() => {
    if (!fromRefinery || !user || asking || loadedFromAccount.current) return;
    if (impersonating !== false) return;
    if (owner || answered || r.isDemo === true) return;
    loadedFromAccount.current = true;
    fetch("/api/forge/load")
      .then((res) => (res.ok ? res.json() : null))
      .then((j) => {
        const saved = j?.data;
        if (!saved || typeof saved !== "object" || runLevel(saved) === 0) return;
        // Only this signed-in account's own saved run, never anyone else's
        // (the route answers for the effective account; M3).
        if (j?.userId !== user.id) return;
        // The account's own copy: marked as this account's and as saved, so
        // nothing here sends it back.
        updateSession({ ...saved, ...afterSave(saved, user.id, runLevel(saved)) } as any);
      })
      .catch(() => {
        loadedFromAccount.current = false;
      });
  }, [fromRefinery, user?.id, asking, owner, answered, impersonating]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!user || impersonating !== false) return null;

  if (asking && showPrompt) {
    return (
      <div className="mx-auto w-full max-w-2xl px-4 pt-4 sm:px-6" data-testid="forge-import-ask">
        <div role="dialog" aria-labelledby="forge-import-title" className="rounded-[5px] border border-t-amber bg-t-panel p-4 sm:p-5">
          <p id="forge-import-title" className="text-base font-semibold text-t-white">
            {IMPORT_QUESTION}
          </p>
          <p className="mt-1 text-sm leading-relaxed text-t-bone-dim">
            Nothing in it is used until you answer. If it isn&apos;t yours, we erase it from this computer.
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
              className="t-focus min-h-touch break-all rounded-[5px] border border-ws-amber bg-ws-amber px-4 text-sm font-semibold text-ws-bg hover:bg-ws-amber-bright"
            >
              {importYesLabel(user.email)}
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
              No, erase it
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
