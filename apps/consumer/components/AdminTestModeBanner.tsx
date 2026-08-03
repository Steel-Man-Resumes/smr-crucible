"use client";

import { useEffect, useState } from "react";
import { useRealTier, canSwitchView, getViewAs, setViewAs } from "@/lib/useUserTier";

/**
 * Persistent acting-as indicator (walkthrough C7 P0: when operating as another
 * role, make it abundantly clear on screen). Shown whenever an admin or
 * partner account is in client view. Without it, it is easy to forget which
 * mode you are in -- the source of "is this a bug, or am I just being gated?"
 * confusion. The gates and locks are real in client view.
 */
export function AdminTestModeBanner() {
  const realTier = useRealTier();
  const [active, setActive] = useState(false);

  useEffect(() => {
    const read = () => setActive(getViewAs() === "client");
    read();
    window.addEventListener("storage", read);
    return () => window.removeEventListener("storage", read);
  }, []);

  if (!canSwitchView(realTier) || !active) return null;

  const roleLabel = realTier === "admin" ? "admin" : "partner";

  return (
    <div className="flex flex-wrap items-center justify-center gap-3 bg-t-amber px-4 py-2 text-center text-sm font-medium text-white">
      <span>
        Viewing as a client -- your real role is {roleLabel}. The gates and
        locks are real.
      </span>
      <button
        type="button"
        onClick={() => {
          setViewAs(null);
          window.location.href = "/dashboard";
        }}
        className="t-focus bg-[#14100a] px-3 py-1 text-xs font-semibold text-t-amber-bright hover:bg-black"
      >
        Back to {roleLabel} view
      </button>
    </div>
  );
}
