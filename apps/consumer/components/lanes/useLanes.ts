"use client";

/**
 * The person's career lanes for any Refinery screen: the open and archived
 * lanes, which tool introductions they dismissed, and the lane they are
 * working in. The working lane is remembered per account in this browser (a
 * convenience; it falls back to main whenever the remembered lane is gone or
 * archived). Every screen using this hook stays in step through one event.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useSession } from "next-auth/react";
import type { CareerLane } from "@crucible/core/src/careerLaneShared";
import { MAIN_LANE_KEY } from "@crucible/core/src/careerLaneShared";
import {
  LANES_CHANGED_EVENT,
  activeLaneStorageKey,
  resolveActiveLane,
  type LaneChoice,
} from "@/lib/lanes";

interface LanesState {
  loaded: boolean;
  lanes: CareerLane[];
  archived: CareerLane[];
  introsSeen: Set<string>;
}

function readRemembered(userId: string | undefined): string | null {
  const key = activeLaneStorageKey(userId);
  if (!key) return null;
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function announce(kind: "list" | "active", from: number) {
  try {
    window.dispatchEvent(new CustomEvent(LANES_CHANGED_EVENT, { detail: { kind, from } }));
  } catch {
    // ignore
  }
}

export function useLanes() {
  const userId = useSession().data?.user?.id;
  const [state, setState] = useState<LanesState>({ loaded: false, lanes: [], archived: [], introsSeen: new Set() });
  const [active, setActiveState] = useState<LaneChoice>(MAIN_LANE_KEY);
  const lanesRef = useRef<CareerLane[]>([]);
  // The open lane holding the newest resume (server): where a screen opens
  // when the person has not picked a lane in this browser.
  const defaultRef = useRef<string | null>(null);
  const selfId = useRef(Math.random());
  const loadedRef = useRef(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/lanes");
      if (!res.ok) throw new Error(String(res.status));
      const d = await res.json();
      const lanes: CareerLane[] = Array.isArray(d.lanes) ? d.lanes : [];
      lanesRef.current = lanes;
      defaultRef.current = typeof d.defaultLaneId === "string" ? d.defaultLaneId : null;
      loadedRef.current = true;
      setState({
        loaded: true,
        lanes,
        archived: Array.isArray(d.archived) ? d.archived : [],
        introsSeen: new Set(Array.isArray(d.introsSeen) ? d.introsSeen : []),
      });
      setActiveState(resolveActiveLane(readRemembered(userId), lanes.map((l) => l.id), defaultRef.current));
    } catch {
      // No lanes reachable: the screen works in main, exactly as before lanes.
      loadedRef.current = true;
      setState((s) => ({ ...s, loaded: true }));
    }
  }, [userId]);

  useEffect(() => {
    if (!userId) return;
    load();
    const onChange = (e: Event) => {
      const detail = (e as CustomEvent).detail || {};
      if (detail.from === selfId.current) return;
      if (detail.kind === "list") load();
      else setActiveState(resolveActiveLane(readRemembered(userId), lanesRef.current.map((l) => l.id), defaultRef.current));
    };
    window.addEventListener(LANES_CHANGED_EVENT, onChange);
    return () => window.removeEventListener(LANES_CHANGED_EVENT, onChange);
  }, [userId, load]);

  /** Work in this lane from now on (main or a lane id). */
  const setActive = useCallback(
    (choice: LaneChoice) => {
      // Before the list arrives (a screen opening a resume by id), remember
      // the choice as given; load() resolves it against the real lanes.
      const next = loadedRef.current ? resolveActiveLane(choice, lanesRef.current.map((l) => l.id), defaultRef.current) : choice;
      if (loadedRef.current) setActiveState(next);
      const key = activeLaneStorageKey(userId);
      if (key) {
        try {
          localStorage.setItem(key, next);
        } catch {
          // ignore
        }
      }
      announce("active", selfId.current);
    },
    [userId]
  );

  /** Reload the lane list here and on every other lane screen. */
  const refresh = useCallback(async () => {
    await load();
    announce("list", selfId.current);
  }, [load]);

  /** Lanes created this session are not in lanesRef until load() returns; this sets one directly. */
  const adoptLane = useCallback(
    (lane: CareerLane) => {
      lanesRef.current = [...lanesRef.current.filter((l) => l.id !== lane.id), lane];
      setState((s) => ({ ...s, lanes: lanesRef.current }));
      setActive(lane.id);
      announce("list", selfId.current);
    },
    [setActive]
  );

  const dismissIntro = useCallback(async (laneKeyValue: string, tool: "tailor" | "library") => {
    setState((s) => ({ ...s, introsSeen: new Set([...s.introsSeen, `${laneKeyValue}:${tool}`]) }));
    try {
      await fetch("/api/lanes/intro", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ laneKey: laneKeyValue, tool }),
      });
    } catch {
      // Dismissed for this visit either way.
    }
  }, []);

  const activeLane = state.lanes.find((l) => l.id === active) ?? null;

  return { ...state, userId, active, activeLane, setActive, refresh, adoptLane, dismissIntro };
}

export type LanesApi = ReturnType<typeof useLanes>;
