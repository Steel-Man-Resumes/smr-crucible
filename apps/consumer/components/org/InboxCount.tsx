"use client";
/**
 * The unread count beside "Inbox" in the staff nav (staff side lane S4).
 * One small request (/api/org/inbox?count=1) on mount, when the tab comes back
 * into view, and every two minutes while it is visible. Shows nothing at zero,
 * on any error, and before migration 109 is applied (the route answers 0).
 *
 * <InboxCountBadge />  renders " 3" style badge text with an accessible label.
 */
import { useEffect, useState } from "react";

const EVERY_MS = 2 * 60 * 1000;
const listeners = new Set<(n: number) => void>();

/** Tell every badge on the page the count changed (the Inbox page calls this after marking items). */
export function announceInboxCount(n: number) {
  listeners.forEach((l) => l(n));
}

export function useInboxCount(): number {
  const [n, setN] = useState(0);
  useEffect(() => {
    let alive = true;
    const get = () => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      fetch("/api/org/inbox?count=1").then((r) => (r.ok ? r.json() : null)).then((d) => { if (alive && typeof d?.unread === "number") setN(d.unread); }).catch(() => {});
    };
    get();
    const timer = setInterval(get, EVERY_MS);
    const onVis = () => get();
    document.addEventListener("visibilitychange", onVis);
    listeners.add(setN);
    return () => { alive = false; clearInterval(timer); document.removeEventListener("visibilitychange", onVis); listeners.delete(setN); };
  }, []);
  return n;
}

export function InboxCountBadge({ className = "" }: { className?: string }) {
  const n = useInboxCount();
  if (n <= 0) return null;
  return (
    <span aria-label={`${n} unread`} className={`ml-2 inline-flex min-w-[1.25rem] items-center justify-center rounded-full bg-t-amber px-1.5 text-[11px] font-semibold text-[#14100a] ${className}`}>
      {n > 99 ? "99+" : n}
    </span>
  );
}
