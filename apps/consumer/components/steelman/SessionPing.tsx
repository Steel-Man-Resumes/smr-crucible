"use client";
/**
 * Sends session_start once per day on any signed-in Refinery page (memo Q5).
 * The server deduplicates by UTC day (app/api/activity/route.ts), so this
 * local marker only saves a request; it is never the source of truth.
 */
import { useEffect } from "react";
import { useSession } from "next-auth/react";
import { trackProgress } from "@/lib/track-progress";

const KEY = "refinery-session-day";

export function SessionPing() {
  const userId = useSession().data?.user?.id;
  useEffect(() => {
    if (!userId) return;
    const today = new Date().toISOString().slice(0, 10);
    const key = `${KEY}:${userId}`;
    try { if (localStorage.getItem(key) === today) return; localStorage.setItem(key, today); } catch { /* storage blocked: the server still dedupes */ }
    trackProgress("session_start");
  }, [userId]);
  return null;
}
