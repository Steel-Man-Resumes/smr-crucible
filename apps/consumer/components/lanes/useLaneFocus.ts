"use client";

/**
 * Today's task, as every lane screen reads it (Phase 5 lane R2).
 *
 * Signed in: the account's saved pick (/api/lane-focus, migration 083).
 * Signed out (the Forge before its sign-in wall), or before 083 is applied:
 * the pick this browser holds in the Forge run, passed in as `fallback`.
 * One fetch per page load is shared by every caller on the page.
 */

import { useCallback, useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { sessionPending } from "@/lib/session-policy";
import { isLaneTask, type LaneTask } from "@/lib/lane-task";
import { activeLaneStorageKey } from "@/lib/lanes";

export interface FocusState {
  /** False until the account's pick (or its absence) is known. */
  loaded: boolean;
  task: LaneTask | null;
  target: string | null;
  laneId: string | null;
  /** True when the pick came from the account, not this browser. */
  fromAccount: boolean;
}

export const LANE_FOCUS_CHANGED_EVENT = "lane-focus-changed";

type Server = { task: LaneTask; laneId: string | null; target: string | null; laneTarget: string | null } | null;
let cache: { uid: string; promise: Promise<Server> } | null = null;

function fetchFocus(uid: string): Promise<Server> {
  if (cache && cache.uid === uid) return cache.promise;
  const promise = fetch("/api/lane-focus", { cache: "no-store" })
    .then((r) => (r.ok ? r.json() : null))
    .then((j) => {
      const f = j?.focus;
      if (!f || !isLaneTask(f.task)) return null;
      return { task: f.task, laneId: f.laneId ?? null, target: f.target ?? null, laneTarget: typeof j.laneTarget === "string" ? j.laneTarget : null };
    })
    .catch(() => null);
  cache = { uid, promise };
  return promise;
}

/** The lane this browser last worked in, for this account (a convenience only). */
function rememberedLane(uid: string | null | undefined): string | null {
  const key = activeLaneStorageKey(uid);
  if (!key) return null;
  try {
    const v = localStorage.getItem(key);
    return v && v !== "main" ? v : null;
  } catch {
    return null;
  }
}

export function useLaneFocus(fallback?: { task?: unknown; target?: unknown }) {
  const { data, status } = useSession();
  const user = data?.user as { id?: string; mfa?: unknown; claim?: unknown } | undefined;
  const uid = status === "authenticated" && user?.id && !sessionPending(user) ? user.id : null;
  const fbTask = isLaneTask(fallback?.task) ? fallback!.task : null;
  const fbTarget = typeof fallback?.target === "string" && fallback.target.trim() ? fallback.target.trim() : null;
  const [state, setState] = useState<FocusState>({ loaded: false, task: null, target: null, laneId: null, fromAccount: false });

  useEffect(() => {
    if (status === "loading") return;
    let live = true;
    const load = () => {
      if (!uid) {
        setState({ loaded: true, task: fbTask, target: fbTarget, laneId: null, fromAccount: false });
        return;
      }
      fetchFocus(uid).then((s) => {
        if (!live) return;
        if (s) setState({ loaded: true, task: s.task, target: s.target ?? s.laneTarget ?? fbTarget, laneId: s.laneId, fromAccount: true });
        else setState({ loaded: true, task: fbTask, target: fbTarget, laneId: null, fromAccount: false });
      });
    };
    load();
    const onChange = () => {
      cache = null;
      load();
    };
    window.addEventListener(LANE_FOCUS_CHANGED_EVENT, onChange);
    return () => {
      live = false;
      window.removeEventListener(LANE_FOCUS_CHANGED_EVENT, onChange);
    };
  }, [uid, status, fbTask, fbTarget]);

  /** Save a new pick. Signed in, it goes to the account; either way the screen shows it at once. */
  const save = useCallback(
    async (task: LaneTask, target?: string | null): Promise<boolean> => {
      const nextTarget = target === undefined ? state.target : target && target.trim() ? target.trim() : null;
      if (!uid) {
        setState((s) => ({ ...s, loaded: true, task, target: nextTarget }));
        return true;
      }
      try {
        const post = (laneId: string | null) =>
          fetch("/api/lane-focus", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ task, target: nextTarget, laneId }),
          });
        const laneId = state.laneId ?? rememberedLane(uid);
        let r = await post(laneId);
        // A remembered lane that is no longer this account's: save on the main lane.
        if (r.status === 404 && laneId) r = await post(null);
        if (!r.ok) return false;
        setState((s) => ({ ...s, loaded: true, task, target: nextTarget }));
        cache = null;
        if (typeof window !== "undefined") window.dispatchEvent(new Event(LANE_FOCUS_CHANGED_EVENT));
        return r.ok;
      } catch {
        return false;
      }
    },
    [uid, state.target, state.laneId]
  );

  return { ...state, signedIn: !!uid, authLoading: status === "loading", save };
}
