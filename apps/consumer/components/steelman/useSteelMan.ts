"use client";
/**
 * One shared read of GET /api/steelman for every meter on the page (the nav
 * foot and the stats page), refreshed when work is saved. Never cached past
 * the page: each refresh asks the server again.
 */
import { useCallback, useEffect, useState } from "react";
import { PROGRESSION_CHANGED_EVENT } from "@/lib/progression-ui";
import type { SteelManPayload } from "@/lib/steelman/types";

type State = { status: "loading" | "ready" | "error" | "signed_out"; data: SteelManPayload | null };
let inflight: Promise<State> | null = null;
let last: State = { status: "loading", data: null };
const listeners = new Set<(s: State) => void>();
const REFRESH_EVENTS = [PROGRESSION_CHANGED_EVENT, "resume-saved", "application-saved", "interview-saved", "disclosure-saved", "forge-synced", "steelman-changed"];
const FOCUS_GAP_MS = 30_000;
let lastFetch = 0;

function isPayload(v: unknown): v is SteelManPayload {
  const p = v as SteelManPayload | null;
  return !!p && typeof p.score === "number" && typeof p.maxScore === "number" && !!p.band && typeof p.band.label === "string" && Array.isArray(p.components) && !!p.nextGain;
}

function load(): Promise<State> {
  if (inflight) return inflight;
  lastFetch = Date.now();
  inflight = fetch("/api/steelman", { cache: "no-store" }).then(async (r) => {
    if (r.status === 401) return { status: "signed_out" as const, data: null };
    const body = await r.json().catch(() => null);
    if (!r.ok || !isPayload(body)) throw new Error("meter unavailable");
    // New moments were recorded: let the progress bar show its celebration.
    if (Array.isArray(body.awarded) && body.awarded.length) window.dispatchEvent(new Event(PROGRESSION_CHANGED_EVENT));
    return { status: "ready" as const, data: body };
  }).catch(() => ({ status: "error" as const, data: last.data })).then((s) => {
    // Keep the last good numbers on a failed refresh: the bar never empties.
    last = s.status === "error" && last.data ? { status: "ready", data: last.data } : s;
    inflight = null;
    listeners.forEach((fn) => fn(last));
    return last;
  });
  return inflight;
}

export function useSteelMan() {
  const [state, setState] = useState<State>(last);
  const refresh = useCallback(() => { void load(); }, []);
  useEffect(() => {
    listeners.add(setState);
    void load();
    const onFocus = () => { if (Date.now() - lastFetch > FOCUS_GAP_MS) void load(); };
    REFRESH_EVENTS.forEach((e) => window.addEventListener(e, refresh));
    window.addEventListener("focus", onFocus);
    return () => { listeners.delete(setState); REFRESH_EVENTS.forEach((e) => window.removeEventListener(e, refresh)); window.removeEventListener("focus", onFocus); };
  }, [refresh]);
  return { ...state, refresh };
}
