"use client";

import { useEffect, useState } from "react";
import { useRealTier } from "@/lib/useUserTier";

/**
 * Visible indicator when an admin is previewing the app as a client
 * (admin_test_mode === "client", toggled in Settings). Without it, it is easy to
 * forget which mode you are in -- the source of "is this a bug, or am I just
 * being gated?" confusion. Only renders for real admins, only when active.
 */
export function AdminTestModeBanner() {
  const realTier = useRealTier();
  const [active, setActive] = useState(false);

  useEffect(() => {
    const read = () => {
      try {
        setActive(localStorage.getItem("admin_test_mode") === "client");
      } catch {
        setActive(false);
      }
    };
    read();
    window.addEventListener("storage", read);
    return () => window.removeEventListener("storage", read);
  }, []);

  if (realTier !== "admin" || !active) return null;

  return (
    <div className="flex flex-wrap items-center justify-center gap-3 bg-t-amber px-4 py-2 text-center text-sm font-medium text-[#14100a] font-term">
      <span>Viewing as a client (admin test mode). The gates and locks are real.</span>
      <button
        type="button"
        onClick={() => {
          try {
            localStorage.removeItem("admin_test_mode");
          } catch {}
          window.location.reload();
        }}
        className="t-focus bg-[#14100a] px-3 py-1 text-xs font-semibold text-t-amber-bright hover:bg-black"
      >
        Exit test mode
      </button>
    </div>
  );
}
